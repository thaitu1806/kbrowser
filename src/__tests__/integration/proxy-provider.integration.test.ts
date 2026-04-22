/**
 * Integration Test: Proxy Provider (Luminati/Oxylabs mock)
 *
 * Tests IP rotation with mock provider:
 * - Configure IP rotation with mock provider
 * - Rotate IP successfully
 * - Test retry logic with failing provider
 * - Verify IP verification
 *
 * Task 14.4
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { initializeDatabase } from '../../main/database/index';
import { IPRotationService } from '../../main/services/ip-rotation/ip-rotation';
import type { RotationProviderFn } from '../../main/services/ip-rotation/ip-rotation';

describe('Integration: Proxy Provider (IP Rotation)', () => {
  let db: Database.Database;
  let dbPath: string;
  const ownerId = 'rotation-test-owner';
  const profileId = 'rotation-test-profile';

  beforeEach(() => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    dbPath = path.join(os.tmpdir(), `test-proxy-provider-${suffix}.db`);
    db = initializeDatabase(dbPath);

    // Insert test user and profile
    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
       VALUES (?, 'rotuser', 'hash', 'admin', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`,
    ).run(ownerId);

    db.prepare(`
      INSERT INTO profiles (id, name, browser_type, owner_id, status, created_at, updated_at)
      VALUES (?, 'Rotation Profile', 'chromium', ?, 'closed', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
    `).run(profileId, ownerId);
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
  });

  it('should configure rotation and rotate IP successfully with Luminati mock', async () => {
    let callCount = 0;
    const mockProvider: RotationProviderFn = async (provider, _apiKey) => {
      callCount++;
      expect(provider).toBe('luminati');
      return { ip: `1.2.3.${callCount}` };
    };

    const service = new IPRotationService(db, mockProvider);

    // Configure rotation
    await service.configureRotation(profileId, {
      enabled: true,
      intervalSeconds: 300,
      provider: 'luminati',
      apiKey: 'test-luminati-key',
    });

    // Verify config was saved
    const config = service.getRotationConfig(profileId);
    expect(config).not.toBeNull();
    expect(config!.provider).toBe('luminati');
    expect(config!.intervalSeconds).toBe(300);
    expect(config!.enabled).toBe(true);

    // Rotate IP
    const result = await service.rotateIP(profileId);
    expect(result.success).toBe(true);
    expect(result.newIP).toBeDefined();
    expect(result.attempts).toBe(1);
  });

  it('should configure rotation and rotate IP with Oxylabs mock', async () => {
    const mockProvider: RotationProviderFn = async (provider, _apiKey) => {
      expect(provider).toBe('oxylabs');
      return { ip: '10.20.30.40' };
    };

    const service = new IPRotationService(db, mockProvider);

    await service.configureRotation(profileId, {
      enabled: true,
      intervalSeconds: 600,
      provider: 'oxylabs',
      apiKey: 'test-oxylabs-key',
    });

    const result = await service.rotateIP(profileId);
    expect(result.success).toBe(true);
    expect(result.newIP).toBe('10.20.30.40');
  });

  it('should retry up to 3 times when provider fails', async () => {
    let callCount = 0;
    const failingProvider: RotationProviderFn = async () => {
      callCount++;
      return null; // Always fail
    };

    const service = new IPRotationService(db, failingProvider);

    await service.configureRotation(profileId, {
      enabled: true,
      intervalSeconds: 300,
      provider: 'luminati',
      apiKey: 'test-key',
    });

    const result = await service.rotateIP(profileId);
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(3);
    expect(result.error).toContain('failed after 3 attempts');
    expect(callCount).toBe(3);
  });

  it('should retry when provider returns same IP as current', async () => {
    let callCount = 0;
    const sameIPProvider: RotationProviderFn = async () => {
      callCount++;
      // First rotation succeeds with IP A
      // Second rotation keeps returning IP A (same as current)
      if (callCount <= 1) return { ip: '5.5.5.5' };
      return { ip: '5.5.5.5' }; // Same IP
    };

    const service = new IPRotationService(db, sameIPProvider);

    await service.configureRotation(profileId, {
      enabled: true,
      intervalSeconds: 300,
      provider: 'luminati',
      apiKey: 'test-key',
    });

    // First rotation — should succeed
    const result1 = await service.rotateIP(profileId);
    expect(result1.success).toBe(true);
    expect(result1.newIP).toBe('5.5.5.5');

    // Second rotation — same IP, should fail after retries
    const result2 = await service.rotateIP(profileId);
    expect(result2.success).toBe(false);
    expect(result2.error).toContain('same as current');
  });

  it('should verify new IP is different from current', async () => {
    let callCount = 0;
    const changingProvider: RotationProviderFn = async () => {
      callCount++;
      return { ip: `192.168.1.${callCount}` };
    };

    const service = new IPRotationService(db, changingProvider);

    await service.configureRotation(profileId, {
      enabled: true,
      intervalSeconds: 120,
      provider: 'oxylabs',
      apiKey: 'test-key',
    });

    // First rotation
    const result1 = await service.rotateIP(profileId);
    expect(result1.success).toBe(true);
    expect(result1.newIP).toBe('192.168.1.1');

    // Second rotation — should get a different IP
    const result2 = await service.rotateIP(profileId);
    expect(result2.success).toBe(true);
    expect(result2.newIP).toBe('192.168.1.2');
    expect(result2.newIP).not.toBe(result1.newIP);
  });

  it('should throw when no rotation config exists', async () => {
    const mockProvider: RotationProviderFn = async () => ({ ip: '1.1.1.1' });
    const service = new IPRotationService(db, mockProvider);

    // Use a profile with no rotation config
    const noConfigProfileId = 'no-config-profile';
    db.prepare(`
      INSERT INTO profiles (id, name, browser_type, owner_id, status, created_at, updated_at)
      VALUES (?, 'No Config', 'chromium', ?, 'closed', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
    `).run(noConfigProfileId, ownerId);

    await expect(service.rotateIP(noConfigProfileId)).rejects.toThrow(
      'No rotation config found',
    );
  });

  it('should update rotation config when called again', async () => {
    const mockProvider: RotationProviderFn = async () => ({ ip: '1.1.1.1' });
    const service = new IPRotationService(db, mockProvider);

    await service.configureRotation(profileId, {
      enabled: true,
      intervalSeconds: 300,
      provider: 'luminati',
      apiKey: 'key-1',
    });

    // Update config
    await service.configureRotation(profileId, {
      enabled: false,
      intervalSeconds: 600,
      provider: 'oxylabs',
      apiKey: 'key-2',
    });

    const config = service.getRotationConfig(profileId);
    expect(config!.enabled).toBe(false);
    expect(config!.intervalSeconds).toBe(600);
    expect(config!.provider).toBe('oxylabs');
    expect(config!.apiKey).toBe('key-2');
  });
});
