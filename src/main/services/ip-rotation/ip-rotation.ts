/**
 * IP Rotation Service
 *
 * Manages automatic IP rotation through Luminati and Oxylabs provider APIs.
 * Supports configuring rotation intervals per profile, rotating IPs with
 * verification, and retry logic (max 3 attempts).
 */

import crypto from 'crypto';
import type Database from 'better-sqlite3';
import type { RotationConfig, RotationResult } from '../../../shared/types';
import { AppErrorCode } from '../../../shared/types';

/** Maximum number of retry attempts for IP rotation. */
const MAX_ROTATION_RETRIES = 3;

/**
 * Injectable function type for fetching a new IP from a rotation provider.
 * Returns { ip: string } on success, or null on failure.
 *
 * In production, this calls the Luminati or Oxylabs API.
 * In tests, it can be replaced with a mock.
 */
export type RotationProviderFn = (
  provider: 'luminati' | 'oxylabs',
  apiKey: string,
) => Promise<{ ip: string } | null>;

/**
 * Default provider function that calls the real Luminati/Oxylabs API.
 * In a real implementation, this would make HTTP requests to the provider's endpoint.
 */
export const defaultRotationProvider: RotationProviderFn = async (
  provider: 'luminati' | 'oxylabs',
  apiKey: string,
): Promise<{ ip: string } | null> => {
  try {
    const { default: https } = await import('https');

    const url =
      provider === 'luminati'
        ? `https://luminati.io/api/rotate?api_key=${encodeURIComponent(apiKey)}`
        : `https://api.oxylabs.io/v1/rotate?api_key=${encodeURIComponent(apiKey)}`;

    return await new Promise<{ ip: string } | null>((resolve) => {
      const req = https.get(url, { timeout: 15_000 }, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data) as { ip?: string };
            if (parsed.ip) {
              resolve({ ip: parsed.ip });
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
    });
  } catch {
    return null;
  }
};

/** Row shape returned when reading a rotation config from the database. */
interface RotationConfigRow {
  id: string;
  profile_id: string;
  enabled: number;
  interval_seconds: number;
  provider: string;
  api_key: string;
  created_at: string;
}

export class IPRotationService {
  private db: Database.Database;
  private providerFn: RotationProviderFn;

  /**
   * Tracks the current IP per profile so we can verify a rotation
   * actually produced a different IP.
   */
  private currentIPs: Map<string, string> = new Map();

  /**
   * @param db - A better-sqlite3 database instance (already initialized with schema).
   * @param providerFn - Optional injectable rotation provider for testability.
   *   Defaults to `defaultRotationProvider` which makes real HTTPS requests.
   */
  constructor(db: Database.Database, providerFn?: RotationProviderFn) {
    this.db = db;
    this.providerFn = providerFn ?? defaultRotationProvider;
  }

  /**
   * Saves or updates the IP rotation configuration for a profile.
   * If a config already exists for the profile, it is replaced.
   *
   * @param profileId - The profile to configure rotation for
   * @param config - Rotation settings (enabled, interval, provider, apiKey)
   */
  async configureRotation(profileId: string, config: RotationConfig): Promise<void> {
    const existing = this.db
      .prepare('SELECT id FROM rotation_configs WHERE profile_id = ?')
      .get(profileId) as { id: string } | undefined;

    if (existing) {
      this.db
        .prepare(
          `UPDATE rotation_configs
           SET enabled = ?, interval_seconds = ?, provider = ?, api_key = ?
           WHERE profile_id = ?`,
        )
        .run(
          config.enabled ? 1 : 0,
          config.intervalSeconds,
          config.provider,
          config.apiKey,
          profileId,
        );
    } else {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      this.db
        .prepare(
          `INSERT INTO rotation_configs (id, profile_id, enabled, interval_seconds, provider, api_key, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          profileId,
          config.enabled ? 1 : 0,
          config.intervalSeconds,
          config.provider,
          config.apiKey,
          now,
        );
    }
  }

  /**
   * Reads the rotation configuration for a profile from the database.
   *
   * @param profileId - The profile to look up
   * @returns The RotationConfig, or null if none is configured
   */
  getRotationConfig(profileId: string): RotationConfig | null {
    const row = this.db
      .prepare('SELECT * FROM rotation_configs WHERE profile_id = ?')
      .get(profileId) as RotationConfigRow | undefined;

    if (!row) {
      return null;
    }

    return {
      enabled: row.enabled === 1,
      intervalSeconds: row.interval_seconds,
      provider: row.provider as RotationConfig['provider'],
      apiKey: row.api_key,
    };
  }

  /**
   * Rotates the IP for a profile by calling the configured provider API.
   *
   * - Loads the rotation config from the database
   * - Calls the provider to get a new IP
   * - Verifies the new IP is different from the current one
   * - Retries up to 3 times on failure (provider returns null or same IP)
   * - After 3 failures, returns error and keeps the current IP
   *
   * @param profileId - The profile to rotate IP for
   * @returns RotationResult with success status, new IP, attempt count, and optional error
   */
  async rotateIP(profileId: string): Promise<RotationResult> {
    const config = this.getRotationConfig(profileId);

    if (!config) {
      const error = new Error(`No rotation config found for profile: ${profileId}`);
      (error as Error & { code: number }).code = AppErrorCode.ROTATION_FAILED;
      throw error;
    }

    const currentIP = this.currentIPs.get(profileId);

    for (let attempt = 1; attempt <= MAX_ROTATION_RETRIES; attempt++) {
      const result = await this.providerFn(config.provider, config.apiKey);

      if (!result) {
        // Provider returned null — failed attempt
        if (attempt === MAX_ROTATION_RETRIES) {
          return {
            success: false,
            attempts: MAX_ROTATION_RETRIES,
            error: `IP rotation failed after ${MAX_ROTATION_RETRIES} attempts: provider returned no IP`,
          };
        }
        continue;
      }

      // Verify the new IP is different from the current one
      if (currentIP && result.ip === currentIP) {
        // Same IP — count as a failed attempt
        if (attempt === MAX_ROTATION_RETRIES) {
          return {
            success: false,
            attempts: MAX_ROTATION_RETRIES,
            error: `IP rotation failed after ${MAX_ROTATION_RETRIES} attempts: new IP same as current`,
          };
        }
        continue;
      }

      // Success — update the tracked IP and return
      this.currentIPs.set(profileId, result.ip);
      return {
        success: true,
        newIP: result.ip,
        attempts: attempt,
      };
    }

    // Should not reach here, but just in case
    return {
      success: false,
      attempts: MAX_ROTATION_RETRIES,
      error: `IP rotation failed after ${MAX_ROTATION_RETRIES} attempts`,
    };
  }
}
