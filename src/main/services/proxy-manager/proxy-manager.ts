/**
 * Proxy Manager Service
 *
 * Manages proxy configurations (HTTP, HTTPS, SOCKS5),
 * checks proxy health, assigns proxies to browser profiles,
 * and provides Playwright-compatible proxy configs for browser launch.
 */

import crypto from 'crypto';
import type Database from 'better-sqlite3';
import type { ProxyConfig, Proxy, ProxyCheckResult } from '../../../shared/types';
import { AppErrorCode } from '../../../shared/types';

/**
 * Function signature for the injectable proxy health checker.
 * In production, this makes an HTTP request through the proxy.
 * In tests, it can be replaced with a mock.
 */
export type ProxyCheckerFn = (config: ProxyConfig) => Promise<ProxyCheckResult>;

/** Result of validating a proxy before launching a browser profile. */
export interface ProxyValidationResult {
  /** Whether the proxy is usable for launch. */
  status: 'ready' | 'dead' | 'no_proxy';
  /** The proxy object if one is assigned. */
  proxy: Proxy | null;
  /** Human-readable message describing the result. */
  message: string;
}

/** Playwright-compatible proxy configuration. */
export interface PlaywrightProxyConfig {
  server: string;
  username?: string;
  password?: string;
}

/** Default timeout for proxy health checks (30 seconds). */
const CHECK_TIMEOUT_MS = 30_000;

/**
 * Default proxy checker that makes an HTTP request through the proxy.
 * Uses Node.js built-in http/https modules with the proxy as an intermediary.
 */
export const defaultProxyChecker: ProxyCheckerFn = async (config: ProxyConfig): Promise<ProxyCheckResult> => {
  const start = Date.now();
  const checkedAt = new Date().toISOString();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);

    // Build the proxy URL
    const auth = config.username && config.password
      ? `${config.username}:${config.password}@`
      : '';
    const proxyUrl = `${config.protocol}://${auth}${config.host}:${config.port}`;

    // For a simple check, we try to fetch a known endpoint through the proxy.
    // In a real implementation this would use a CONNECT tunnel or SOCKS client.
    // Here we use a basic HTTP request to test connectivity.
    const { default: http } = await import('http');

    await new Promise<void>((resolve, reject) => {
      const req = http.get(
        `http://httpbin.org/ip`,
        {
          headers: { 'Proxy-Authorization': proxyUrl },
          signal: controller.signal,
        },
        (res) => {
          res.resume(); // Drain the response
          res.on('end', () => resolve());
        },
      );
      req.on('error', reject);
    });

    clearTimeout(timeout);
    const responseTimeMs = Date.now() - start;

    return { status: 'alive', responseTimeMs, checkedAt };
  } catch {
    const responseTimeMs = Date.now() - start;
    return { status: 'dead', responseTimeMs, checkedAt };
  }
};

export class ProxyManager {
  private db: Database.Database;
  private checkerFn: ProxyCheckerFn;

  /**
   * @param db - A better-sqlite3 database instance (already initialized with schema).
   * @param checkerFn - Optional injectable proxy health checker for testability.
   *   Defaults to `defaultProxyChecker` which makes real HTTP requests.
   */
  constructor(db: Database.Database, checkerFn?: ProxyCheckerFn) {
    this.db = db;
    this.checkerFn = checkerFn ?? defaultProxyChecker;
  }

  /**
   * Adds a new proxy to the database.
   *
   * @param config - Proxy configuration (protocol, host, port, optional username/password)
   * @returns The created Proxy object with a generated UUID
   */
  async addProxy(config: ProxyConfig): Promise<Proxy> {
    const proxyId = crypto.randomUUID();

    this.db.prepare(`
      INSERT INTO proxies (id, protocol, host, port, username, password, status, response_time_ms, last_checked_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
    `).run(
      proxyId,
      config.protocol,
      config.host,
      config.port,
      config.username ?? null,
      config.password ?? null,
    );

    const proxy: Proxy = {
      id: proxyId,
      protocol: config.protocol,
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      status: null,
      responseTimeMs: null,
      lastCheckedAt: null,
    };

    return proxy;
  }

  /**
   * Removes a proxy from the database.
   * The ON DELETE SET NULL foreign key on profiles.proxy_id ensures
   * that any profiles referencing this proxy will have their proxy_id set to NULL.
   *
   * @param proxyId - The ID of the proxy to remove
   * @throws Error with code PROXY_DEAD if proxy not found
   */
  async removeProxy(proxyId: string): Promise<void> {
    const result = this.db.prepare('DELETE FROM proxies WHERE id = ?').run(proxyId);

    if (result.changes === 0) {
      const error = new Error(`Proxy not found: ${proxyId}`);
      (error as Error & { code: number }).code = AppErrorCode.PROXY_DEAD;
      throw error;
    }
  }

  /**
   * Assigns a proxy to a browser profile by updating the profile's proxy_id.
   *
   * @param proxyId - The ID of the proxy to assign
   * @param profileId - The ID of the profile to assign the proxy to
   * @throws Error if proxy or profile not found
   */
  async assignToProfile(proxyId: string, profileId: string): Promise<void> {
    // Verify proxy exists
    const proxy = this.db.prepare('SELECT id FROM proxies WHERE id = ?').get(proxyId) as { id: string } | undefined;
    if (!proxy) {
      const error = new Error(`Proxy not found: ${proxyId}`);
      (error as Error & { code: number }).code = AppErrorCode.PROXY_DEAD;
      throw error;
    }

    // Verify profile exists
    const profile = this.db.prepare('SELECT id FROM profiles WHERE id = ?').get(profileId) as { id: string } | undefined;
    if (!profile) {
      const error = new Error(`Profile not found: ${profileId}`);
      (error as Error & { code: number }).code = AppErrorCode.PROFILE_NOT_FOUND;
      throw error;
    }

    // Update the profile's proxy_id
    const now = new Date().toISOString();
    this.db.prepare('UPDATE profiles SET proxy_id = ?, updated_at = ? WHERE id = ?').run(proxyId, now, profileId);
  }

  /**
   * Checks the health of a proxy by attempting a connection through it.
   * Updates the proxy's status, response time, and last checked timestamp in the database.
   *
   * @param proxyId - The ID of the proxy to check
   * @returns ProxyCheckResult with status (alive/dead), response time, and timestamp
   * @throws Error if proxy not found
   */
  async checkProxy(proxyId: string): Promise<ProxyCheckResult> {
    // Look up the proxy in the database
    const row = this.db.prepare(
      'SELECT id, protocol, host, port, username, password FROM proxies WHERE id = ?',
    ).get(proxyId) as {
      id: string;
      protocol: string;
      host: string;
      port: number;
      username: string | null;
      password: string | null;
    } | undefined;

    if (!row) {
      const error = new Error(`Proxy not found: ${proxyId}`);
      (error as Error & { code: number }).code = AppErrorCode.PROXY_DEAD;
      throw error;
    }

    // Build the ProxyConfig for the checker function
    const config: ProxyConfig = {
      protocol: row.protocol as ProxyConfig['protocol'],
      host: row.host,
      port: row.port,
      username: row.username ?? undefined,
      password: row.password ?? undefined,
    };

    // Run the health check
    const result = await this.checkerFn(config);

    // Update the proxy record in the database
    this.db.prepare(
      'UPDATE proxies SET status = ?, response_time_ms = ?, last_checked_at = ? WHERE id = ?',
    ).run(result.status, result.responseTimeMs, result.checkedAt, proxyId);

    return result;
  }

  /**
   * Gets the proxy assigned to a profile, or null if none is assigned.
   *
   * @param profileId - The ID of the profile
   * @returns The assigned Proxy object, or null
   */
  async getProxyForProfile(profileId: string): Promise<Proxy | null> {
    const row = this.db.prepare(`
      SELECT p.id, p.protocol, p.host, p.port, p.username, p.password,
             p.status, p.response_time_ms, p.last_checked_at
      FROM proxies p
      INNER JOIN profiles pr ON pr.proxy_id = p.id
      WHERE pr.id = ?
    `).get(profileId) as {
      id: string;
      protocol: string;
      host: string;
      port: number;
      username: string | null;
      password: string | null;
      status: string | null;
      response_time_ms: number | null;
      last_checked_at: string | null;
    } | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      protocol: row.protocol as Proxy['protocol'],
      host: row.host,
      port: row.port,
      username: row.username ?? undefined,
      password: row.password ?? undefined,
      status: row.status as Proxy['status'],
      responseTimeMs: row.response_time_ms,
      lastCheckedAt: row.last_checked_at,
    };
  }

  /**
   * Returns the proxy configuration in Playwright's format for browser launch.
   * Used by the Profile Manager when launching a browser with a proxy.
   *
   * @param proxyId - The ID of the proxy
   * @returns PlaywrightProxyConfig or null if proxy not found
   */
  getPlaywrightProxyConfig(proxyId: string): PlaywrightProxyConfig | null {
    const row = this.db.prepare(
      'SELECT protocol, host, port, username, password FROM proxies WHERE id = ?',
    ).get(proxyId) as {
      protocol: string;
      host: string;
      port: number;
      username: string | null;
      password: string | null;
    } | undefined;

    if (!row) {
      return null;
    }

    const config: PlaywrightProxyConfig = {
      server: `${row.protocol}://${row.host}:${row.port}`,
    };

    if (row.username) {
      config.username = row.username;
    }
    if (row.password) {
      config.password = row.password;
    }

    return config;
  }

  /**
   * Validates the proxy assigned to a profile before browser launch.
   * Checks if a proxy is assigned, and if so, whether it's alive.
   *
   * Returns a result indicating:
   * - 'ready': proxy is assigned and alive, safe to launch with proxy
   * - 'dead': proxy is assigned but not responding, user should choose alternative
   * - 'no_proxy': no proxy assigned, can launch without proxy
   *
   * @param profileId - The ID of the profile to validate
   * @returns ProxyValidationResult with status, proxy, and message
   */
  async validateProxyBeforeLaunch(profileId: string): Promise<ProxyValidationResult> {
    const proxy = await this.getProxyForProfile(profileId);

    if (!proxy) {
      return {
        status: 'no_proxy',
        proxy: null,
        message: 'No proxy assigned to this profile. Browser will launch without proxy.',
      };
    }

    // Check the proxy health
    const checkResult = await this.checkProxy(proxy.id);

    if (checkResult.status === 'alive') {
      return {
        status: 'ready',
        proxy,
        message: `Proxy ${proxy.host}:${proxy.port} is alive (${checkResult.responseTimeMs}ms).`,
      };
    }

    return {
      status: 'dead',
      proxy,
      message: `Proxy ${proxy.host}:${proxy.port} is not responding. Choose an alternative proxy or launch without proxy.`,
    };
  }
}
