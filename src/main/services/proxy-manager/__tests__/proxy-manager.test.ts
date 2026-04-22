import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { initializeDatabase } from '../../../database/index';
import { ProxyManager } from '../proxy-manager';
import type { ProxyCheckerFn } from '../proxy-manager';
import type { ProxyConfig, ProxyCheckResult } from '../../../../shared/types';
import { AppErrorCode } from '../../../../shared/types';

/** Creates a mock proxy checker that returns alive with a given response time. */
function makeAliveChecker(responseTimeMs = 150): ProxyCheckerFn {
  return async (): Promise<ProxyCheckResult> => ({
    status: 'alive',
    responseTimeMs,
    checkedAt: new Date().toISOString(),
  });
}

/** Creates a mock proxy checker that returns dead. */
function makeDeadChecker(): ProxyCheckerFn {
  return async (): Promise<ProxyCheckResult> => ({
    status: 'dead',
    responseTimeMs: 30000,
    checkedAt: new Date().toISOString(),
  });
}

/** Helper to create a test user in the database (required by FK constraints). */
function insertTestUser(db: Database.Database, userId: string): void {
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
     VALUES (?, 'testuser', 'hash', 'admin', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`,
  ).run(userId);
}

/** Helper to create a test profile in the database. */
function insertTestProfile(db: Database.Database, profileId: string, ownerId: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO profiles (id, name, browser_type, owner_id, status, created_at, updated_at)
     VALUES (?, 'Test Profile', 'chromium', ?, 'closed', ?, ?)`,
  ).run(profileId, ownerId, now, now);
}

describe('ProxyManager.addProxy', () => {
  let db: Database.Database;
  let dbPath: string;
  let manager: ProxyManager;

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `test-proxy-add-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    db = initializeDatabase(dbPath);
    manager = new ProxyManager(db, makeAliveChecker());
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
  });

  it('should create a proxy with a valid UUID id', async () => {
    const config: ProxyConfig = { protocol: 'http', host: '192.168.1.1', port: 8080 };
    const proxy = await manager.addProxy(config);

    expect(proxy.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('should store correct fields for HTTP proxy', async () => {
    const config: ProxyConfig = { protocol: 'http', host: '10.0.0.1', port: 3128 };
    const proxy = await manager.addProxy(config);

    expect(proxy.protocol).toBe('http');
    expect(proxy.host).toBe('10.0.0.1');
    expect(proxy.port).toBe(3128);
    expect(proxy.username).toBeUndefined();
    expect(proxy.password).toBeUndefined();
    expect(proxy.status).toBeNull();
    expect(proxy.responseTimeMs).toBeNull();
    expect(proxy.lastCheckedAt).toBeNull();
  });

  it('should store correct fields for HTTPS proxy with credentials', async () => {
    const config: ProxyConfig = {
      protocol: 'https',
      host: 'proxy.example.com',
      port: 443,
      username: 'user1',
      password: 'pass1',
    };
    const proxy = await manager.addProxy(config);

    expect(proxy.protocol).toBe('https');
    expect(proxy.host).toBe('proxy.example.com');
    expect(proxy.port).toBe(443);
    expect(proxy.username).toBe('user1');
    expect(proxy.password).toBe('pass1');
  });

  it('should store correct fields for SOCKS5 proxy', async () => {
    const config: ProxyConfig = {
      protocol: 'socks5',
      host: 'socks.example.com',
      port: 1080,
      username: 'socksuser',
      password: 'sockspass',
    };
    const proxy = await manager.addProxy(config);

    expect(proxy.protocol).toBe('socks5');
    expect(proxy.host).toBe('socks.example.com');
    expect(proxy.port).toBe(1080);
    expect(proxy.username).toBe('socksuser');
    expect(proxy.password).toBe('sockspass');
  });

  it('should insert proxy record into the database', async () => {
    const config: ProxyConfig = { protocol: 'http', host: '1.2.3.4', port: 8080 };
    const proxy = await manager.addProxy(config);

    const row = db.prepare('SELECT * FROM proxies WHERE id = ?').get(proxy.id) as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.protocol).toBe('http');
    expect(row.host).toBe('1.2.3.4');
    expect(row.port).toBe(8080);
    expect(row.username).toBeNull();
    expect(row.password).toBeNull();
    expect(row.status).toBeNull();
  });

  it('should create unique IDs for multiple proxies', async () => {
    const config: ProxyConfig = { protocol: 'http', host: '1.2.3.4', port: 8080 };
    const proxy1 = await manager.addProxy(config);
    const proxy2 = await manager.addProxy(config);

    expect(proxy1.id).not.toBe(proxy2.id);
  });
});


describe('ProxyManager.removeProxy', () => {
  let db: Database.Database;
  let dbPath: string;
  let manager: ProxyManager;

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `test-proxy-rm-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    db = initializeDatabase(dbPath);
    manager = new ProxyManager(db, makeAliveChecker());
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
  });

  it('should delete proxy from database', async () => {
    const proxy = await manager.addProxy({ protocol: 'http', host: '1.2.3.4', port: 8080 });

    // Verify it exists
    const before = db.prepare('SELECT id FROM proxies WHERE id = ?').get(proxy.id);
    expect(before).toBeTruthy();

    await manager.removeProxy(proxy.id);

    // Verify it's gone
    const after = db.prepare('SELECT id FROM proxies WHERE id = ?').get(proxy.id);
    expect(after).toBeUndefined();
  });

  it('should throw for non-existent proxy', async () => {
    try {
      await manager.removeProxy('non-existent-id');
      expect.unreachable('Should have thrown');
    } catch (err: unknown) {
      const error = err as Error & { code: number };
      expect(error.code).toBe(AppErrorCode.PROXY_DEAD);
      expect(error.message).toContain('non-existent-id');
    }
  });

  it('should set profile proxy_id to NULL when proxy is deleted (ON DELETE SET NULL)', async () => {
    const ownerId = 'owner-rm-test';
    const profileId = 'profile-rm-test';
    insertTestUser(db, ownerId);
    insertTestProfile(db, profileId, ownerId);

    const proxy = await manager.addProxy({ protocol: 'http', host: '1.2.3.4', port: 8080 });
    await manager.assignToProfile(proxy.id, profileId);

    // Verify proxy is assigned
    const before = db.prepare('SELECT proxy_id FROM profiles WHERE id = ?').get(profileId) as { proxy_id: string | null };
    expect(before.proxy_id).toBe(proxy.id);

    await manager.removeProxy(proxy.id);

    // Verify proxy_id is now NULL
    const after = db.prepare('SELECT proxy_id FROM profiles WHERE id = ?').get(profileId) as { proxy_id: string | null };
    expect(after.proxy_id).toBeNull();
  });
});


describe('ProxyManager.assignToProfile', () => {
  let db: Database.Database;
  let dbPath: string;
  let manager: ProxyManager;
  const ownerId = 'owner-assign';
  const profileId = 'profile-assign';

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `test-proxy-assign-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    db = initializeDatabase(dbPath);
    manager = new ProxyManager(db, makeAliveChecker());

    insertTestUser(db, ownerId);
    insertTestProfile(db, profileId, ownerId);
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
  });

  it('should update profile proxy_id in the database', async () => {
    const proxy = await manager.addProxy({ protocol: 'http', host: '1.2.3.4', port: 8080 });
    await manager.assignToProfile(proxy.id, profileId);

    const row = db.prepare('SELECT proxy_id FROM profiles WHERE id = ?').get(profileId) as { proxy_id: string | null };
    expect(row.proxy_id).toBe(proxy.id);
  });

  it('should throw for non-existent proxy', async () => {
    try {
      await manager.assignToProfile('non-existent-proxy', profileId);
      expect.unreachable('Should have thrown');
    } catch (err: unknown) {
      const error = err as Error & { code: number };
      expect(error.code).toBe(AppErrorCode.PROXY_DEAD);
    }
  });

  it('should throw for non-existent profile', async () => {
    const proxy = await manager.addProxy({ protocol: 'http', host: '1.2.3.4', port: 8080 });

    try {
      await manager.assignToProfile(proxy.id, 'non-existent-profile');
      expect.unreachable('Should have thrown');
    } catch (err: unknown) {
      const error = err as Error & { code: number };
      expect(error.code).toBe(AppErrorCode.PROFILE_NOT_FOUND);
    }
  });

  it('should allow reassigning a different proxy to the same profile', async () => {
    const proxy1 = await manager.addProxy({ protocol: 'http', host: '1.1.1.1', port: 8080 });
    const proxy2 = await manager.addProxy({ protocol: 'socks5', host: '2.2.2.2', port: 1080 });

    await manager.assignToProfile(proxy1.id, profileId);
    let row = db.prepare('SELECT proxy_id FROM profiles WHERE id = ?').get(profileId) as { proxy_id: string | null };
    expect(row.proxy_id).toBe(proxy1.id);

    await manager.assignToProfile(proxy2.id, profileId);
    row = db.prepare('SELECT proxy_id FROM profiles WHERE id = ?').get(profileId) as { proxy_id: string | null };
    expect(row.proxy_id).toBe(proxy2.id);
  });
});


describe('ProxyManager.checkProxy', () => {
  let db: Database.Database;
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `test-proxy-check-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    db = initializeDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
  });

  it('should return alive status when proxy is reachable', async () => {
    const manager = new ProxyManager(db, makeAliveChecker(200));
    const proxy = await manager.addProxy({ protocol: 'http', host: '1.2.3.4', port: 8080 });

    const result = await manager.checkProxy(proxy.id);

    expect(result.status).toBe('alive');
    expect(result.responseTimeMs).toBe(200);
    expect(result.checkedAt).toBeTruthy();
    expect(new Date(result.checkedAt).toISOString()).toBe(result.checkedAt);
  });

  it('should return dead status when proxy is unreachable', async () => {
    const manager = new ProxyManager(db, makeDeadChecker());
    const proxy = await manager.addProxy({ protocol: 'http', host: '1.2.3.4', port: 8080 });

    const result = await manager.checkProxy(proxy.id);

    expect(result.status).toBe('dead');
    expect(result.responseTimeMs).toBe(30000);
    expect(result.checkedAt).toBeTruthy();
  });

  it('should update proxy status in the database after check', async () => {
    const manager = new ProxyManager(db, makeAliveChecker(100));
    const proxy = await manager.addProxy({ protocol: 'http', host: '1.2.3.4', port: 8080 });

    await manager.checkProxy(proxy.id);

    const row = db.prepare('SELECT status, response_time_ms, last_checked_at FROM proxies WHERE id = ?').get(proxy.id) as {
      status: string;
      response_time_ms: number;
      last_checked_at: string;
    };

    expect(row.status).toBe('alive');
    expect(row.response_time_ms).toBe(100);
    expect(row.last_checked_at).toBeTruthy();
  });

  it('should update proxy status to dead in the database', async () => {
    const manager = new ProxyManager(db, makeDeadChecker());
    const proxy = await manager.addProxy({ protocol: 'http', host: '1.2.3.4', port: 8080 });

    await manager.checkProxy(proxy.id);

    const row = db.prepare('SELECT status FROM proxies WHERE id = ?').get(proxy.id) as { status: string };
    expect(row.status).toBe('dead');
  });

  it('should throw for non-existent proxy', async () => {
    const manager = new ProxyManager(db, makeAliveChecker());

    try {
      await manager.checkProxy('non-existent-id');
      expect.unreachable('Should have thrown');
    } catch (err: unknown) {
      const error = err as Error & { code: number };
      expect(error.code).toBe(AppErrorCode.PROXY_DEAD);
    }
  });

  it('should pass correct config to the checker function', async () => {
    let receivedConfig: ProxyConfig | null = null;
    const spyChecker: ProxyCheckerFn = async (config) => {
      receivedConfig = config;
      return { status: 'alive', responseTimeMs: 50, checkedAt: new Date().toISOString() };
    };

    const manager = new ProxyManager(db, spyChecker);
    const proxy = await manager.addProxy({
      protocol: 'socks5',
      host: 'socks.test.com',
      port: 1080,
      username: 'user',
      password: 'pass',
    });

    await manager.checkProxy(proxy.id);

    expect(receivedConfig).not.toBeNull();
    expect(receivedConfig!.protocol).toBe('socks5');
    expect(receivedConfig!.host).toBe('socks.test.com');
    expect(receivedConfig!.port).toBe(1080);
    expect(receivedConfig!.username).toBe('user');
    expect(receivedConfig!.password).toBe('pass');
  });
});


describe('ProxyManager.getProxyForProfile', () => {
  let db: Database.Database;
  let dbPath: string;
  let manager: ProxyManager;
  const ownerId = 'owner-getproxy';
  const profileId = 'profile-getproxy';

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `test-proxy-getfor-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    db = initializeDatabase(dbPath);
    manager = new ProxyManager(db, makeAliveChecker());

    insertTestUser(db, ownerId);
    insertTestProfile(db, profileId, ownerId);
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
  });

  it('should return null when no proxy is assigned', async () => {
    const result = await manager.getProxyForProfile(profileId);
    expect(result).toBeNull();
  });

  it('should return the assigned proxy', async () => {
    const proxy = await manager.addProxy({
      protocol: 'https',
      host: 'proxy.test.com',
      port: 443,
      username: 'user',
      password: 'pass',
    });
    await manager.assignToProfile(proxy.id, profileId);

    const result = await manager.getProxyForProfile(profileId);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(proxy.id);
    expect(result!.protocol).toBe('https');
    expect(result!.host).toBe('proxy.test.com');
    expect(result!.port).toBe(443);
    expect(result!.username).toBe('user');
    expect(result!.password).toBe('pass');
  });

  it('should return null for non-existent profile', async () => {
    const result = await manager.getProxyForProfile('non-existent-profile');
    expect(result).toBeNull();
  });
});


describe('ProxyManager.getPlaywrightProxyConfig', () => {
  let db: Database.Database;
  let dbPath: string;
  let manager: ProxyManager;

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `test-proxy-pw-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    db = initializeDatabase(dbPath);
    manager = new ProxyManager(db, makeAliveChecker());
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
  });

  it('should return Playwright-compatible config for HTTP proxy', async () => {
    const proxy = await manager.addProxy({ protocol: 'http', host: '1.2.3.4', port: 8080 });
    const config = manager.getPlaywrightProxyConfig(proxy.id);

    expect(config).not.toBeNull();
    expect(config!.server).toBe('http://1.2.3.4:8080');
    expect(config!.username).toBeUndefined();
    expect(config!.password).toBeUndefined();
  });

  it('should return Playwright-compatible config for SOCKS5 proxy with credentials', async () => {
    const proxy = await manager.addProxy({
      protocol: 'socks5',
      host: 'socks.example.com',
      port: 1080,
      username: 'user',
      password: 'pass',
    });
    const config = manager.getPlaywrightProxyConfig(proxy.id);

    expect(config).not.toBeNull();
    expect(config!.server).toBe('socks5://socks.example.com:1080');
    expect(config!.username).toBe('user');
    expect(config!.password).toBe('pass');
  });

  it('should return null for non-existent proxy', () => {
    const config = manager.getPlaywrightProxyConfig('non-existent-id');
    expect(config).toBeNull();
  });
});


describe('ProxyManager.validateProxyBeforeLaunch', () => {
  let db: Database.Database;
  let dbPath: string;
  const ownerId = 'owner-validate';
  const profileId = 'profile-validate';

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `test-proxy-validate-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    db = initializeDatabase(dbPath);

    insertTestUser(db, ownerId);
    insertTestProfile(db, profileId, ownerId);
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
  });

  it('should return no_proxy when no proxy is assigned', async () => {
    const manager = new ProxyManager(db, makeAliveChecker());
    const result = await manager.validateProxyBeforeLaunch(profileId);

    expect(result.status).toBe('no_proxy');
    expect(result.proxy).toBeNull();
    expect(result.message).toContain('No proxy assigned');
  });

  it('should return ready when assigned proxy is alive', async () => {
    const manager = new ProxyManager(db, makeAliveChecker(100));
    const proxy = await manager.addProxy({ protocol: 'http', host: '1.2.3.4', port: 8080 });
    await manager.assignToProfile(proxy.id, profileId);

    const result = await manager.validateProxyBeforeLaunch(profileId);

    expect(result.status).toBe('ready');
    expect(result.proxy).not.toBeNull();
    expect(result.proxy!.id).toBe(proxy.id);
    expect(result.message).toContain('alive');
  });

  it('should return dead when assigned proxy is not responding', async () => {
    const manager = new ProxyManager(db, makeDeadChecker());
    const proxy = await manager.addProxy({ protocol: 'http', host: '1.2.3.4', port: 8080 });
    await manager.assignToProfile(proxy.id, profileId);

    const result = await manager.validateProxyBeforeLaunch(profileId);

    expect(result.status).toBe('dead');
    expect(result.proxy).not.toBeNull();
    expect(result.proxy!.id).toBe(proxy.id);
    expect(result.message).toContain('not responding');
    expect(result.message).toContain('alternative');
  });
});
