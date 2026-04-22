/**
 * Property-based test for P13 (IP rotation interval round-trip) and
 * unit tests for retry logic edge cases.
 *
 * Uses fast-check to verify that configureRotation + getRotationConfig
 * is a round-trip for any valid RotationConfig, and that rotateIP
 * respects the MAX_RETRIES (3) contract.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { initializeDatabase } from '../../../database/index';
import { IPRotationService } from '../ip-rotation';
import type { RotationProviderFn } from '../ip-rotation';
import { assertProperty, propertyTag } from '../../../../test-helpers/fast-check-helpers';
import type { RotationConfig } from '../../../../shared/types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Helper to create a test user in the database (required by FK constraints). */
function insertTestUser(db: Database.Database, userId: string): void {
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
     VALUES (?, ?, 'hash', 'admin', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`,
  ).run(userId, `user-${userId}`);
}

/** Helper to create a test profile in the database. */
function insertTestProfile(db: Database.Database, profileId: string, ownerId: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO profiles (id, name, browser_type, owner_id, status, created_at, updated_at)
     VALUES (?, 'Test Profile', 'chromium', ?, 'closed', ?, ?)`,
  ).run(profileId, ownerId, now, now);
}

/** Creates a provider that always succeeds with a given IP. */
function makeSuccessProvider(ip: string): RotationProviderFn {
  return async () => ({ ip });
}

/** Creates a provider that always returns null (failure). */
function makeFailureProvider(): RotationProviderFn {
  return async () => null;
}

/** Creates a provider that returns results from a sequence, then null. */
function makeSequenceProvider(results: ({ ip: string } | null)[]): RotationProviderFn {
  let index = 0;
  return async () => {
    if (index >= results.length) return null;
    return results[index++];
  };
}

// ---------------------------------------------------------------------------
// Arbitraries (generators)
// ---------------------------------------------------------------------------

/** Valid rotation interval in seconds (30–3600). */
const arbIntervalSeconds: fc.Arbitrary<number> = fc.integer({ min: 30, max: 3600 });

/** Valid provider name. */
const arbProvider: fc.Arbitrary<'luminati' | 'oxylabs'> = fc.constantFrom(
  'luminati' as const,
  'oxylabs' as const,
);

/** Valid API key string (alphanumeric + dashes, 8–64 chars). */
const arbApiKey: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
  { minLength: 8, maxLength: 64 },
);

/** Valid RotationConfig. */
const arbRotationConfig: fc.Arbitrary<RotationConfig> = fc
  .tuple(fc.boolean(), arbIntervalSeconds, arbProvider, arbApiKey)
  .map(([enabled, intervalSeconds, provider, apiKey]) => ({
    enabled,
    intervalSeconds,
    provider,
    apiKey,
  }));

// ---------------------------------------------------------------------------
// Shared test setup / teardown
// ---------------------------------------------------------------------------

let db: Database.Database;
let dbPath: string;
const ownerId = 'owner-p13';
const profileId = 'profile-p13';

function setup(providerFn?: RotationProviderFn) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  dbPath = path.join(os.tmpdir(), `prop-ip-rotation-${suffix}.db`);
  db = initializeDatabase(dbPath);

  insertTestUser(db, ownerId);
  insertTestProfile(db, profileId, ownerId);

  return new IPRotationService(db, providerFn ?? makeSuccessProvider('1.2.3.4'));
}

function teardown() {
  try { db.close(); } catch { /* ignore */ }
  try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
  try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
  try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Property test: P13
// ---------------------------------------------------------------------------

describe('IPRotationService property tests', () => {
  let service: IPRotationService;

  beforeEach(() => {
    service = setup();
  });

  afterEach(() => {
    teardown();
  });

  /**
   * **Validates: Requirements 6.2**
   *
   * Property 13: Xoay vòng IP theo đúng khoảng thời gian
   *
   * For any valid RotationConfig, configureRotation + getRotationConfig is a
   * round-trip: the stored config matches the original exactly, including the
   * intervalSeconds field that controls rotation timing.
   *
   * Since real timing cannot be tested in unit tests, we verify the property
   * that the configured interval is stored and retrieved without loss.
   * Additionally, rotateIP always completes within MAX_RETRIES (3) attempts.
   */
  it(
    propertyTag(13, 'Xoay vòng IP theo đúng khoảng thời gian'),
    async () => {
      await assertProperty(
        fc.asyncProperty(arbRotationConfig, async (config) => {
          // 1. Configure rotation
          await service.configureRotation(profileId, config);

          // 2. Read it back
          const stored = service.getRotationConfig(profileId);
          if (!stored) return false;

          // 3. Verify round-trip: all fields must match exactly
          if (stored.enabled !== config.enabled) return false;
          if (stored.intervalSeconds !== config.intervalSeconds) return false;
          if (stored.provider !== config.provider) return false;
          if (stored.apiKey !== config.apiKey) return false;

          // 4. Verify rotateIP completes within MAX_RETRIES (3) attempts
          const result = await service.rotateIP(profileId);
          if (result.attempts < 1 || result.attempts > 3) return false;

          return true;
        }),
      );
    },
  );
});

// ---------------------------------------------------------------------------
// Property test: rotateIP always returns within MAX_RETRIES
// ---------------------------------------------------------------------------

describe('IPRotationService rotateIP retry property', () => {
  afterEach(() => {
    teardown();
  });

  it('rotateIP always returns within MAX_RETRIES attempts (success or failure)', async () => {
    // Use a provider that randomly succeeds or fails
    const arbProviderBehavior = fc.array(
      fc.option(
        fc.tuple(
          fc.integer({ min: 1, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 1, max: 255 }),
        ).map(([a, b, c, d]) => ({ ip: `${a}.${b}.${c}.${d}` })),
        { nil: null },
      ),
      { minLength: 3, maxLength: 10 },
    );

    await assertProperty(
      fc.asyncProperty(arbProviderBehavior, async (providerResults) => {
        const service = setup(makeSequenceProvider(providerResults));

        const config: RotationConfig = {
          enabled: true,
          intervalSeconds: 60,
          provider: 'luminati',
          apiKey: 'test-key-123',
        };
        await service.configureRotation(profileId, config);

        const result = await service.rotateIP(profileId);

        // Must always complete within 1-3 attempts
        if (result.attempts < 1 || result.attempts > 3) return false;

        // If success, must have a newIP
        if (result.success && !result.newIP) return false;

        // If failure, must have an error message
        if (!result.success && !result.error) return false;

        return true;
      }),
    );
  });

  it('on provider failure, exactly 3 attempts are made', async () => {
    await assertProperty(
      fc.asyncProperty(arbApiKey, arbProvider, async (apiKey, provider) => {
        let callCount = 0;
        const countingFailProvider: RotationProviderFn = async () => {
          callCount++;
          return null;
        };

        const service = setup(countingFailProvider);

        const config: RotationConfig = {
          enabled: true,
          intervalSeconds: 120,
          provider,
          apiKey,
        };
        await service.configureRotation(profileId, config);

        callCount = 0;
        const result = await service.rotateIP(profileId);

        if (result.success) return false;
        if (result.attempts !== 3) return false;
        if (callCount !== 3) return false;

        return true;
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Unit tests: retry edge cases
// ---------------------------------------------------------------------------

describe('IPRotationService retry edge cases', () => {
  afterEach(() => {
    teardown();
  });

  it('should succeed when provider succeeds on 3rd attempt', async () => {
    const service = setup(
      makeSequenceProvider([null, null, { ip: '10.20.30.40' }]),
    );
    await service.configureRotation(profileId, {
      enabled: true,
      intervalSeconds: 60,
      provider: 'luminati',
      apiKey: 'key-123',
    });

    const result = await service.rotateIP(profileId);

    expect(result.success).toBe(true);
    expect(result.newIP).toBe('10.20.30.40');
    expect(result.attempts).toBe(3);
    expect(result.error).toBeUndefined();
  });

  it('should fail when provider returns same IP as current on all attempts', async () => {
    // First rotation sets current IP to '1.1.1.1'
    // Second rotation: provider returns '1.1.1.1' three times (same as current)
    const service = setup(
      makeSequenceProvider([
        { ip: '1.1.1.1' }, // first rotation — succeeds (no current IP)
        { ip: '1.1.1.1' }, // second rotation attempt 1 — same as current
        { ip: '1.1.1.1' }, // second rotation attempt 2 — same as current
        { ip: '1.1.1.1' }, // second rotation attempt 3 — same as current
      ]),
    );
    await service.configureRotation(profileId, {
      enabled: true,
      intervalSeconds: 60,
      provider: 'oxylabs',
      apiKey: 'key-456',
    });

    // First rotation succeeds
    const first = await service.rotateIP(profileId);
    expect(first.success).toBe(true);
    expect(first.newIP).toBe('1.1.1.1');

    // Second rotation: all 3 attempts return same IP as current
    const second = await service.rotateIP(profileId);
    expect(second.success).toBe(false);
    expect(second.attempts).toBe(3);
    expect(second.error).toContain('same as current');
  });

  it('should fail when provider alternates between null and same IP', async () => {
    // First rotation sets current IP to '5.5.5.5'
    // Second rotation: alternates null and same IP
    const service = setup(
      makeSequenceProvider([
        { ip: '5.5.5.5' }, // first rotation — succeeds
        null,               // second rotation attempt 1 — provider failure
        { ip: '5.5.5.5' }, // second rotation attempt 2 — same as current
        null,               // second rotation attempt 3 — provider failure
      ]),
    );
    await service.configureRotation(profileId, {
      enabled: true,
      intervalSeconds: 300,
      provider: 'luminati',
      apiKey: 'key-789',
    });

    // First rotation succeeds
    const first = await service.rotateIP(profileId);
    expect(first.success).toBe(true);
    expect(first.newIP).toBe('5.5.5.5');

    // Second rotation: alternates between null and same IP — all 3 fail
    const second = await service.rotateIP(profileId);
    expect(second.success).toBe(false);
    expect(second.attempts).toBe(3);
    expect(second.error).toBeTruthy();
  });
});
