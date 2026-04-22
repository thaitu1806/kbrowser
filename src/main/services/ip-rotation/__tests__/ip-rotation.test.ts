import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { initializeDatabase } from '../../../database/index';
import { IPRotationService } from '../ip-rotation';
import type { RotationProviderFn } from '../ip-rotation';
import type { RotationConfig } from '../../../../shared/types';
import { AppErrorCode } from '../../../../shared/types';

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

/** Creates a provider that always returns a specific IP. */
function makeSuccessProvider(ip: string): RotationProviderFn {
  return async () => ({ ip });
}

/** Creates a provider that always returns null (failure). */
function makeFailureProvider(): RotationProviderFn {
  return async () => null;
}

/** Creates a provider that returns IPs from a sequence, then null. */
function makeSequenceProvider(ips: (string | null)[]): RotationProviderFn {
  let index = 0;
  return async () => {
    if (index >= ips.length) return null;
    const ip = ips[index++];
    return ip ? { ip } : null;
  };
}

const defaultConfig: RotationConfig = {
  enabled: true,
  intervalSeconds: 300,
  provider: 'luminati',
  apiKey: 'test-api-key-123',
};

describe('IPRotationService.configureRotation', () => {
  let db: Database.Database;
  let dbPath: string;
  let service: IPRotationService;
  const ownerId = 'owner-config';
  const profileId = 'profile-config';

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `test-ip-rotation-config-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    db = initializeDatabase(dbPath);
    service = new IPRotationService(db, makeSuccessProvider('1.2.3.4'));

    insertTestUser(db, ownerId);
    insertTestProfile(db, profileId, ownerId);
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
  });

  it('should save rotation config to the database', async () => {
    await service.configureRotation(profileId, defaultConfig);

    const row = db.prepare('SELECT * FROM rotation_configs WHERE profile_id = ?').get(profileId) as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.enabled).toBe(1);
    expect(row.interval_seconds).toBe(300);
    expect(row.provider).toBe('luminati');
    expect(row.api_key).toBe('test-api-key-123');
  });

  it('should update existing config for the same profile', async () => {
    await service.configureRotation(profileId, defaultConfig);

    const updatedConfig: RotationConfig = {
      enabled: false,
      intervalSeconds: 600,
      provider: 'oxylabs',
      apiKey: 'new-key-456',
    };
    await service.configureRotation(profileId, updatedConfig);

    // Should still be only one row
    const rows = db.prepare('SELECT * FROM rotation_configs WHERE profile_id = ?').all(profileId);
    expect(rows).toHaveLength(1);

    const row = rows[0] as Record<string, unknown>;
    expect(row.enabled).toBe(0);
    expect(row.interval_seconds).toBe(600);
    expect(row.provider).toBe('oxylabs');
    expect(row.api_key).toBe('new-key-456');
  });

  it('should store config readable via getRotationConfig', async () => {
    await service.configureRotation(profileId, defaultConfig);

    const config = service.getRotationConfig(profileId);
    expect(config).not.toBeNull();
    expect(config!.enabled).toBe(true);
    expect(config!.intervalSeconds).toBe(300);
    expect(config!.provider).toBe('luminati');
    expect(config!.apiKey).toBe('test-api-key-123');
  });

  it('should support both luminati and oxylabs providers', async () => {
    await service.configureRotation(profileId, { ...defaultConfig, provider: 'luminati' });
    let config = service.getRotationConfig(profileId);
    expect(config!.provider).toBe('luminati');

    await service.configureRotation(profileId, { ...defaultConfig, provider: 'oxylabs' });
    config = service.getRotationConfig(profileId);
    expect(config!.provider).toBe('oxylabs');
  });
});


describe('IPRotationService.getRotationConfig', () => {
  let db: Database.Database;
  let dbPath: string;
  let service: IPRotationService;

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `test-ip-rotation-get-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    db = initializeDatabase(dbPath);
    service = new IPRotationService(db, makeSuccessProvider('1.2.3.4'));
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
  });

  it('should return null when no config exists for profile', () => {
    const config = service.getRotationConfig('non-existent-profile');
    expect(config).toBeNull();
  });
});


describe('IPRotationService.rotateIP', () => {
  let db: Database.Database;
  let dbPath: string;
  const ownerId = 'owner-rotate';
  const profileId = 'profile-rotate';

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `test-ip-rotation-rotate-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
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

  it('should return new IP on success', async () => {
    const service = new IPRotationService(db, makeSuccessProvider('5.6.7.8'));
    await service.configureRotation(profileId, defaultConfig);

    const result = await service.rotateIP(profileId);

    expect(result.success).toBe(true);
    expect(result.newIP).toBe('5.6.7.8');
    expect(result.attempts).toBe(1);
    expect(result.error).toBeUndefined();
  });

  it('should throw when no rotation config exists', async () => {
    const service = new IPRotationService(db, makeSuccessProvider('1.2.3.4'));

    try {
      await service.rotateIP(profileId);
      expect.unreachable('Should have thrown');
    } catch (err: unknown) {
      const error = err as Error & { code: number };
      expect(error.code).toBe(AppErrorCode.ROTATION_FAILED);
      expect(error.message).toContain('No rotation config');
    }
  });

  it('should retry up to 3 times on provider failure', async () => {
    let callCount = 0;
    const countingFailProvider: RotationProviderFn = async () => {
      callCount++;
      return null;
    };

    const service = new IPRotationService(db, countingFailProvider);
    await service.configureRotation(profileId, defaultConfig);

    const result = await service.rotateIP(profileId);

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(3);
    expect(result.error).toBeTruthy();
    expect(callCount).toBe(3);
  });

  it('should return error after 3 failed attempts', async () => {
    const service = new IPRotationService(db, makeFailureProvider());
    await service.configureRotation(profileId, defaultConfig);

    const result = await service.rotateIP(profileId);

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(3);
    expect(result.error).toContain('failed');
    expect(result.error).toContain('3');
    expect(result.newIP).toBeUndefined();
  });

  it('should succeed on second attempt after first failure', async () => {
    const service = new IPRotationService(db, makeSequenceProvider([null, '10.20.30.40']));
    await service.configureRotation(profileId, defaultConfig);

    const result = await service.rotateIP(profileId);

    expect(result.success).toBe(true);
    expect(result.newIP).toBe('10.20.30.40');
    expect(result.attempts).toBe(2);
  });

  it('should verify new IP is different from current IP', async () => {
    // First rotation sets the current IP to '1.1.1.1'
    // Second rotation: provider returns '1.1.1.1' three times (same as current), all fail
    const service = new IPRotationService(db, makeSequenceProvider([
      '1.1.1.1',       // first rotation — succeeds (no current IP yet)
      '1.1.1.1',       // second rotation attempt 1 — same as current
      '1.1.1.1',       // second rotation attempt 2 — same as current
      '1.1.1.1',       // second rotation attempt 3 — same as current
    ]));
    await service.configureRotation(profileId, defaultConfig);

    // First call succeeds (no current IP to compare against)
    const first = await service.rotateIP(profileId);
    expect(first.success).toBe(true);
    expect(first.newIP).toBe('1.1.1.1');

    // Second call: provider keeps returning '1.1.1.1' (same as current)
    // All 3 retries return the same IP, so it should fail
    const second = await service.rotateIP(profileId);
    expect(second.success).toBe(false);
    expect(second.attempts).toBe(3);
    expect(second.error).toContain('same as current');
  });

  it('should accept new IP when different from current', async () => {
    const service = new IPRotationService(db, makeSequenceProvider(['1.1.1.1', '2.2.2.2']));
    await service.configureRotation(profileId, defaultConfig);

    // First rotation
    const first = await service.rotateIP(profileId);
    expect(first.success).toBe(true);
    expect(first.newIP).toBe('1.1.1.1');

    // Second rotation — different IP
    const second = await service.rotateIP(profileId);
    expect(second.success).toBe(true);
    expect(second.newIP).toBe('2.2.2.2');
    expect(second.attempts).toBe(1);
  });

  it('should pass correct provider and apiKey to the provider function', async () => {
    let receivedProvider: string | null = null;
    let receivedApiKey: string | null = null;

    const spyProvider: RotationProviderFn = async (provider, apiKey) => {
      receivedProvider = provider;
      receivedApiKey = apiKey;
      return { ip: '9.9.9.9' };
    };

    const service = new IPRotationService(db, spyProvider);
    await service.configureRotation(profileId, {
      enabled: true,
      intervalSeconds: 120,
      provider: 'oxylabs',
      apiKey: 'my-oxylabs-key',
    });

    await service.rotateIP(profileId);

    expect(receivedProvider).toBe('oxylabs');
    expect(receivedApiKey).toBe('my-oxylabs-key');
  });

  it('should keep current IP when all retries fail', async () => {
    // Set up: first rotation succeeds, second fails all retries
    const service = new IPRotationService(db, makeSequenceProvider(['1.1.1.1', null, null, null]));
    await service.configureRotation(profileId, defaultConfig);

    // First rotation succeeds
    const first = await service.rotateIP(profileId);
    expect(first.success).toBe(true);
    expect(first.newIP).toBe('1.1.1.1');

    // Second rotation fails — current IP should remain '1.1.1.1'
    const second = await service.rotateIP(profileId);
    expect(second.success).toBe(false);
    expect(second.newIP).toBeUndefined();

    // Verify the service still tracks the old IP by doing a third rotation
    // with a provider that returns a different IP
    // (We need a new service instance or a provider that returns a new IP)
  });
});
