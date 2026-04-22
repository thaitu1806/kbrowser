/**
 * Property-based tests for Proxy Manager (P12) and unit tests for proxy protocols.
 *
 * Uses fast-check to verify the round-trip correctness property for proxy configs,
 * and unit tests to verify each protocol type (HTTP, HTTPS, SOCKS5) works correctly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { initializeDatabase } from '../../../database/index';
import { ProxyManager } from '../proxy-manager';
import type { ProxyCheckerFn } from '../proxy-manager';
import { assertProperty, propertyTag } from '../../../../test-helpers/fast-check-helpers';
import type { ProxyConfig, ProxyCheckResult } from '../../../../shared/types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Creates a mock proxy checker that always returns alive. */
function makeAliveChecker(): ProxyCheckerFn {
  return async (): Promise<ProxyCheckResult> => ({
    status: 'alive',
    responseTimeMs: 100,
    checkedAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Arbitraries (generators)
// ---------------------------------------------------------------------------

/** Valid proxy protocol. */
const arbProtocol: fc.Arbitrary<'http' | 'https' | 'socks5'> = fc.constantFrom(
  'http' as const,
  'https' as const,
  'socks5' as const,
);

/** Valid hostname: either an IPv4 address or a simple hostname. */
const arbHost: fc.Arbitrary<string> = fc.oneof(
  // IPv4 addresses
  fc
    .tuple(
      fc.integer({ min: 1, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 1, max: 255 }),
    )
    .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`),
  // Hostnames like proxy.example.com
  fc
    .tuple(
      fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), {
        minLength: 1,
        maxLength: 12,
      }),
      fc.constantFrom('example', 'proxy', 'test', 'server'),
      fc.constantFrom('com', 'net', 'org', 'io'),
    )
    .map(([sub, domain, tld]) => `${sub}.${domain}.${tld}`),
);

/** Valid port number (1-65535). */
const arbPort: fc.Arbitrary<number> = fc.integer({ min: 1, max: 65535 });

/** Optional username string (printable ASCII, 1-30 chars). */
const arbOptionalUsername: fc.Arbitrary<string | undefined> = fc.option(
  fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-'.split('')),
    { minLength: 1, maxLength: 30 },
  ),
  { nil: undefined },
);

/** Optional password string (printable ASCII, 1-50 chars). */
const arbOptionalPassword: fc.Arbitrary<string | undefined> = fc.option(
  fc.stringOf(
    fc.char().filter((c) => c.charCodeAt(0) >= 33 && c.charCodeAt(0) < 127),
    { minLength: 1, maxLength: 50 },
  ),
  { nil: undefined },
);

/** Valid ProxyConfig with consistent optional credentials (both or neither). */
const arbProxyConfig: fc.Arbitrary<ProxyConfig> = fc
  .tuple(arbProtocol, arbHost, arbPort, arbOptionalUsername, arbOptionalPassword)
  .map(([protocol, host, port, username, password]) => {
    const config: ProxyConfig = { protocol, host, port };
    // If both username and password are present, include them
    if (username !== undefined && password !== undefined) {
      config.username = username;
      config.password = password;
    }
    return config;
  });

// ---------------------------------------------------------------------------
// Shared test setup / teardown
// ---------------------------------------------------------------------------

let db: Database.Database;
let dbPath: string;
let manager: ProxyManager;

function setup() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  dbPath = path.join(os.tmpdir(), `prop-proxy-${suffix}.db`);
  db = initializeDatabase(dbPath);
  manager = new ProxyManager(db, makeAliveChecker());
}

function teardown() {
  try { db.close(); } catch { /* ignore */ }
  try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
  try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
  try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Property test: P12
// ---------------------------------------------------------------------------

describe('ProxyManager property tests', () => {
  beforeEach(() => {
    setup();
  });

  afterEach(() => {
    teardown();
  });

  /**
   * **Validates: Requirements 5.2**
   *
   * Property 12: Lưu cấu hình proxy là round-trip
   *
   * For any valid ProxyConfig, after saving and loading, all fields
   * (protocol, host, port, username, password) must be equivalent to the original.
   */
  it(
    propertyTag(12, 'Lưu cấu hình proxy là round-trip'),
    async () => {
      await assertProperty(
        fc.asyncProperty(arbProxyConfig, async (config) => {
          // 1. Add the proxy
          const proxy = await manager.addProxy(config);

          // 2. Read it back from the database
          const row = db.prepare(
            'SELECT protocol, host, port, username, password FROM proxies WHERE id = ?',
          ).get(proxy.id) as {
            protocol: string;
            host: string;
            port: number;
            username: string | null;
            password: string | null;
          };

          // 3. Verify all fields match the original config
          if (row.protocol !== config.protocol) return false;
          if (row.host !== config.host) return false;
          if (row.port !== config.port) return false;

          // username: config may have undefined, DB stores null
          const expectedUsername = config.username ?? null;
          if (row.username !== expectedUsername) return false;

          // password: config may have undefined, DB stores null
          const expectedPassword = config.password ?? null;
          if (row.password !== expectedPassword) return false;

          // Also verify the returned Proxy object matches
          if (proxy.protocol !== config.protocol) return false;
          if (proxy.host !== config.host) return false;
          if (proxy.port !== config.port) return false;
          if ((proxy.username ?? null) !== expectedUsername) return false;
          if ((proxy.password ?? null) !== expectedPassword) return false;

          return true;
        }),
      );
    },
  );
});

// ---------------------------------------------------------------------------
// Unit tests: proxy protocol round-trip
// ---------------------------------------------------------------------------

describe('Proxy protocol round-trip unit tests', () => {
  beforeEach(() => {
    setup();
  });

  afterEach(() => {
    teardown();
  });

  it('should round-trip an HTTP proxy without credentials', async () => {
    const config: ProxyConfig = { protocol: 'http', host: '192.168.1.100', port: 8080 };
    const proxy = await manager.addProxy(config);

    const row = db.prepare(
      'SELECT protocol, host, port, username, password FROM proxies WHERE id = ?',
    ).get(proxy.id) as { protocol: string; host: string; port: number; username: string | null; password: string | null };

    expect(row.protocol).toBe('http');
    expect(row.host).toBe('192.168.1.100');
    expect(row.port).toBe(8080);
    expect(row.username).toBeNull();
    expect(row.password).toBeNull();
  });

  it('should round-trip an HTTP proxy with credentials', async () => {
    const config: ProxyConfig = {
      protocol: 'http',
      host: '10.0.0.1',
      port: 3128,
      username: 'httpuser',
      password: 'httppass',
    };
    const proxy = await manager.addProxy(config);

    const row = db.prepare(
      'SELECT protocol, host, port, username, password FROM proxies WHERE id = ?',
    ).get(proxy.id) as { protocol: string; host: string; port: number; username: string | null; password: string | null };

    expect(row.protocol).toBe('http');
    expect(row.host).toBe('10.0.0.1');
    expect(row.port).toBe(3128);
    expect(row.username).toBe('httpuser');
    expect(row.password).toBe('httppass');
  });

  it('should round-trip an HTTPS proxy without credentials', async () => {
    const config: ProxyConfig = { protocol: 'https', host: 'secure.proxy.io', port: 443 };
    const proxy = await manager.addProxy(config);

    const row = db.prepare(
      'SELECT protocol, host, port, username, password FROM proxies WHERE id = ?',
    ).get(proxy.id) as { protocol: string; host: string; port: number; username: string | null; password: string | null };

    expect(row.protocol).toBe('https');
    expect(row.host).toBe('secure.proxy.io');
    expect(row.port).toBe(443);
    expect(row.username).toBeNull();
    expect(row.password).toBeNull();
  });

  it('should round-trip an HTTPS proxy with credentials', async () => {
    const config: ProxyConfig = {
      protocol: 'https',
      host: 'proxy.example.com',
      port: 8443,
      username: 'httpsuser',
      password: 'httpspass',
    };
    const proxy = await manager.addProxy(config);

    const row = db.prepare(
      'SELECT protocol, host, port, username, password FROM proxies WHERE id = ?',
    ).get(proxy.id) as { protocol: string; host: string; port: number; username: string | null; password: string | null };

    expect(row.protocol).toBe('https');
    expect(row.host).toBe('proxy.example.com');
    expect(row.port).toBe(8443);
    expect(row.username).toBe('httpsuser');
    expect(row.password).toBe('httpspass');
  });

  it('should round-trip a SOCKS5 proxy without credentials', async () => {
    const config: ProxyConfig = { protocol: 'socks5', host: '172.16.0.1', port: 1080 };
    const proxy = await manager.addProxy(config);

    const row = db.prepare(
      'SELECT protocol, host, port, username, password FROM proxies WHERE id = ?',
    ).get(proxy.id) as { protocol: string; host: string; port: number; username: string | null; password: string | null };

    expect(row.protocol).toBe('socks5');
    expect(row.host).toBe('172.16.0.1');
    expect(row.port).toBe(1080);
    expect(row.username).toBeNull();
    expect(row.password).toBeNull();
  });

  it('should round-trip a SOCKS5 proxy with credentials', async () => {
    const config: ProxyConfig = {
      protocol: 'socks5',
      host: 'socks.darknet.org',
      port: 9050,
      username: 'socksuser',
      password: 'sockspass',
    };
    const proxy = await manager.addProxy(config);

    const row = db.prepare(
      'SELECT protocol, host, port, username, password FROM proxies WHERE id = ?',
    ).get(proxy.id) as { protocol: string; host: string; port: number; username: string | null; password: string | null };

    expect(row.protocol).toBe('socks5');
    expect(row.host).toBe('socks.darknet.org');
    expect(row.port).toBe(9050);
    expect(row.username).toBe('socksuser');
    expect(row.password).toBe('sockspass');
  });

  it('should preserve port boundary values (1 and 65535)', async () => {
    const configMin: ProxyConfig = { protocol: 'http', host: '1.1.1.1', port: 1 };
    const configMax: ProxyConfig = { protocol: 'http', host: '1.1.1.1', port: 65535 };

    const proxyMin = await manager.addProxy(configMin);
    const proxyMax = await manager.addProxy(configMax);

    const rowMin = db.prepare('SELECT port FROM proxies WHERE id = ?').get(proxyMin.id) as { port: number };
    const rowMax = db.prepare('SELECT port FROM proxies WHERE id = ?').get(proxyMax.id) as { port: number };

    expect(rowMin.port).toBe(1);
    expect(rowMax.port).toBe(65535);
  });
});
