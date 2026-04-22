/**
 * Integration Test: Cloud Sync
 *
 * Tests cloud sync flow with mock CloudStorageAdapter:
 * - Create profile, sync to cloud
 * - Download on a "different machine" (new CloudSync instance, same adapter)
 * - Verify fingerprint is preserved
 * - Test conflict detection and resolution
 *
 * Task 14.2
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { initializeDatabase } from '../../main/database/index';
import { ProfileManager } from '../../main/services/profile-manager/profile-manager';
import { CloudSync } from '../../main/services/cloud-sync/cloud-sync';
import type { CloudStorageAdapter } from '../../main/services/cloud-sync/cloud-sync';
import type { FingerprintConfig, ProfileConfig } from '../../shared/types';

// Mock Playwright
vi.mock('playwright', () => {
  const mockBrowserServer = {
    wsEndpoint: () => 'ws://127.0.0.1:9222/devtools/browser/mock-id',
    close: vi.fn(async () => {}),
  };
  return {
    chromium: { launchServer: vi.fn(async () => mockBrowserServer) },
    firefox: { launchServer: vi.fn(async () => mockBrowserServer) },
  };
});

function makeFingerprint(): FingerprintConfig {
  return {
    canvas: { noiseLevel: 0.7 },
    webgl: { noiseLevel: 0.4 },
    audioContext: { frequencyOffset: 0.02 },
    cpu: { cores: 4 },
    ram: { sizeGB: 8 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    fonts: ['Helvetica', 'Arial'],
    webrtc: 'proxy' as const,
    platform: 'MacIntel',
    appVersion: '5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    oscpu: 'Intel Mac OS X 10_15_7',
  };
}

/** Creates a mock CloudStorageAdapter backed by an in-memory Map. */
function createMockAdapter(): CloudStorageAdapter & {
  storage: Map<string, Buffer>;
  versions: Map<string, number>;
} {
  const storage = new Map<string, Buffer>();
  const versions = new Map<string, number>();
  return {
    storage,
    versions,
    upload: vi.fn(async (profileId: string, data: Buffer) => {
      storage.set(profileId, data);
    }),
    download: vi.fn(async (profileId: string) => {
      const data = storage.get(profileId);
      if (!data) return null;
      return { data, version: versions.get(profileId) || 0 };
    }),
    getVersion: vi.fn(async (profileId: string) => versions.get(profileId) || 0),
    setVersion: vi.fn(async (profileId: string, version: number) => {
      versions.set(profileId, version);
    }),
  };
}

describe('Integration: Cloud Sync', () => {
  let db1: Database.Database;
  let db1Path: string;
  let basePath1: string;
  let db2: Database.Database;
  let db2Path: string;
  let adapter: ReturnType<typeof createMockAdapter>;
  let encryptionKey: Buffer;
  const ownerId = 'cloud-sync-owner';

  beforeEach(() => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    db1Path = path.join(os.tmpdir(), `test-cloud-sync-m1-${suffix}.db`);
    db2Path = path.join(os.tmpdir(), `test-cloud-sync-m2-${suffix}.db`);
    basePath1 = path.join(os.tmpdir(), `test-profiles-cs-${suffix}`);
    fs.mkdirSync(basePath1, { recursive: true });

    db1 = initializeDatabase(db1Path);
    db2 = initializeDatabase(db2Path);

    // Insert test user on both "machines"
    const insertUser = (db: Database.Database) => {
      db.prepare(
        `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
         VALUES (?, 'syncuser', 'hash', 'admin', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`,
      ).run(ownerId);
    };
    insertUser(db1);
    insertUser(db2);

    adapter = createMockAdapter();
    encryptionKey = crypto.randomBytes(32);
  });

  afterEach(() => {
    db1.close();
    db2.close();
    for (const p of [db1Path, db2Path]) {
      try { fs.unlinkSync(p); } catch { /* ignore */ }
      try { fs.unlinkSync(p + '-wal'); } catch { /* ignore */ }
      try { fs.unlinkSync(p + '-shm'); } catch { /* ignore */ }
    }
    try { fs.rmSync(basePath1, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('should sync a profile to cloud and download on a different machine', async () => {
    // Machine 1: Create profile and sync
    const profileManager1 = new ProfileManager(db1, basePath1);
    const cloudSync1 = new CloudSync(db1, adapter, encryptionKey);

    const fpConfig = makeFingerprint();
    const profile = await profileManager1.createProfile(
      { name: 'Synced Profile', browserType: 'chromium', fingerprint: fpConfig },
      ownerId,
    );

    const syncResult = await cloudSync1.syncProfile(profile.id);
    expect(syncResult.success).toBe(true);
    expect(syncResult.bytesTransferred).toBeGreaterThan(0);

    // Machine 2: Download the profile using a new CloudSync instance
    const cloudSync2 = new CloudSync(db2, adapter, encryptionKey);
    const downloadedProfile = await cloudSync2.downloadProfile(profile.id);

    expect(downloadedProfile.id).toBe(profile.id);
    expect(downloadedProfile.name).toBe('Synced Profile');
    expect(downloadedProfile.browserType).toBe('chromium');

    // Verify fingerprint is preserved
    expect(downloadedProfile.fingerprintConfig).toEqual(fpConfig);
    expect(downloadedProfile.fingerprintConfig.canvas.noiseLevel).toBe(0.7);
    expect(downloadedProfile.fingerprintConfig.cpu.cores).toBe(4);
    expect(downloadedProfile.fingerprintConfig.ram.sizeGB).toBe(8);
    expect(downloadedProfile.fingerprintConfig.userAgent).toBe(fpConfig.userAgent);
    expect(downloadedProfile.fingerprintConfig.fonts).toEqual(fpConfig.fonts);
  });

  it('should detect conflict when both machines edit the same profile', async () => {
    const cloudSync1 = new CloudSync(db1, adapter, encryptionKey);

    // Machine 1: Create and sync profile
    const fpConfig = makeFingerprint();
    const now = new Date().toISOString();
    const profileId = crypto.randomUUID();
    db1.prepare(`
      INSERT INTO profiles (id, name, browser_type, owner_id, status, fingerprint_config,
                            sync_enabled, sync_status, created_at, updated_at)
      VALUES (?, ?, 'chromium', ?, 'closed', ?, 1, 'pending', ?, ?)
    `).run(profileId, 'Conflict Profile', ownerId, JSON.stringify(fpConfig), now, now);

    await cloudSync1.syncProfile(profileId);

    // Simulate Machine 2 editing the profile (remote version becomes newer)
    const futureVersion = Date.now() + 100000;
    adapter.versions.set(profileId, futureVersion);

    // Machine 1 tries to sync again — should detect conflict
    const conflictResult = await cloudSync1.syncProfile(profileId);
    expect(conflictResult.success).toBe(false);
    expect(conflictResult.conflict).toBe(true);

    // Verify sync status is 'conflict'
    const status = await cloudSync1.getSyncStatus(profileId);
    expect(status).toBe('conflict');
  });

  it('should resolve conflict with local version', async () => {
    const cloudSync1 = new CloudSync(db1, adapter, encryptionKey);

    const fpConfig = makeFingerprint();
    const now = new Date().toISOString();
    const profileId = crypto.randomUUID();
    db1.prepare(`
      INSERT INTO profiles (id, name, browser_type, owner_id, status, fingerprint_config,
                            sync_enabled, sync_status, created_at, updated_at)
      VALUES (?, ?, 'chromium', ?, 'closed', ?, 1, 'pending', ?, ?)
    `).run(profileId, 'Local Wins', ownerId, JSON.stringify(fpConfig), now, now);

    await cloudSync1.syncProfile(profileId);

    // Put in conflict state
    db1.prepare('UPDATE profiles SET sync_status = ? WHERE id = ?').run('conflict', profileId);

    // Resolve with local
    await cloudSync1.resolveConflict(profileId, 'local');

    const status = await cloudSync1.getSyncStatus(profileId);
    expect(status).toBe('synced');
  });

  it('should resolve conflict with remote version and preserve fingerprint', async () => {
    const cloudSync1 = new CloudSync(db1, adapter, encryptionKey);

    const fpConfig = makeFingerprint();
    const now = new Date().toISOString();
    const profileId = crypto.randomUUID();
    db1.prepare(`
      INSERT INTO profiles (id, name, browser_type, owner_id, status, fingerprint_config,
                            sync_enabled, sync_status, created_at, updated_at)
      VALUES (?, ?, 'chromium', ?, 'closed', ?, 1, 'pending', ?, ?)
    `).run(profileId, 'Original Name', ownerId, JSON.stringify(fpConfig), now, now);

    // Sync to upload original
    await cloudSync1.syncProfile(profileId);

    // Modify local and set conflict
    db1.prepare('UPDATE profiles SET name = ?, sync_status = ? WHERE id = ?')
      .run('Modified Local', 'conflict', profileId);

    // Resolve with remote — should restore original
    await cloudSync1.resolveConflict(profileId, 'remote');

    const row = db1.prepare('SELECT name, fingerprint_config FROM profiles WHERE id = ?')
      .get(profileId) as { name: string; fingerprint_config: string };
    expect(row.name).toBe('Original Name');
    expect(JSON.parse(row.fingerprint_config)).toEqual(fpConfig);
  });

  it('should encrypt data before uploading (not plaintext)', async () => {
    const cloudSync1 = new CloudSync(db1, adapter, encryptionKey);

    const fpConfig = makeFingerprint();
    const now = new Date().toISOString();
    const profileId = crypto.randomUUID();
    db1.prepare(`
      INSERT INTO profiles (id, name, browser_type, owner_id, status, fingerprint_config,
                            sync_enabled, sync_status, created_at, updated_at)
      VALUES (?, ?, 'chromium', ?, 'closed', ?, 1, 'pending', ?, ?)
    `).run(profileId, 'Secret Profile Name', ownerId, JSON.stringify(fpConfig), now, now);

    await cloudSync1.syncProfile(profileId);

    const uploadedData = adapter.storage.get(profileId)!;
    const uploadedStr = uploadedData.toString('utf-8');
    expect(uploadedStr).not.toContain('Secret Profile Name');
  });
});
