import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { initializeDatabase } from '../../../database/index';
import { CloudSync } from '../cloud-sync';
import type { CloudStorageAdapter } from '../cloud-sync';
import { AppErrorCode } from '../../../../shared/types';

/** Helper to create a valid FingerprintConfig for testing. */
function makeFingerprint() {
  return {
    canvas: { noiseLevel: 0.5 },
    webgl: { noiseLevel: 0.3 },
    audioContext: { frequencyOffset: 0.01 },
    cpu: { cores: 4 },
    ram: { sizeGB: 8 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    fonts: ['Arial', 'Verdana'],
    webrtc: 'disable' as const,
    platform: 'Win32',
    appVersion: '5.0 (Windows NT 10.0; Win64; x64)',
    oscpu: 'Windows NT 10.0; Win64; x64',
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
    upload: vi.fn(async (profileId: string, encryptedData: Buffer) => {
      storage.set(profileId, encryptedData);
    }),
    download: vi.fn(async (profileId: string) => {
      const data = storage.get(profileId);
      if (!data) return null;
      return { data, version: versions.get(profileId) || 0 };
    }),
    getVersion: vi.fn(async (profileId: string) => {
      return versions.get(profileId) || 0;
    }),
    setVersion: vi.fn(async (profileId: string, version: number) => {
      versions.set(profileId, version);
    }),
  };
}

/** Generates a 32-byte encryption key for testing. */
function makeEncryptionKey(): Buffer {
  return crypto.randomBytes(32);
}

describe('CloudSync', () => {
  let db: Database.Database;
  let dbPath: string;
  let adapter: ReturnType<typeof createMockAdapter>;
  let encryptionKey: Buffer;
  let cloudSync: CloudSync;
  const ownerId = 'test-owner-sync';

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `test-cloud-sync-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    db = initializeDatabase(dbPath);

    // Insert a test user (required by foreign key constraint)
    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
       VALUES (?, 'testuser', 'hash', 'admin', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`,
    ).run(ownerId);

    adapter = createMockAdapter();
    encryptionKey = makeEncryptionKey();
    cloudSync = new CloudSync(db, adapter, encryptionKey);
  });

  afterEach(() => {
    db.close();
    try {
      fs.unlinkSync(dbPath);
      fs.unlinkSync(dbPath + '-wal');
      fs.unlinkSync(dbPath + '-shm');
    } catch {
      // Ignore cleanup errors
    }
  });

  /** Helper to insert a profile into the database. */
  function insertProfile(profileId: string, name: string = 'Test Profile') {
    const now = new Date().toISOString();
    const fingerprint = makeFingerprint();
    db.prepare(`
      INSERT INTO profiles (id, name, browser_type, owner_id, status, fingerprint_config,
                            sync_enabled, sync_status, created_at, updated_at)
      VALUES (?, ?, 'chromium', ?, 'closed', ?, 1, 'pending', ?, ?)
    `).run(profileId, name, ownerId, JSON.stringify(fingerprint), now, now);
    return { profileId, name, fingerprint, now };
  }

  // --- Constructor tests ---

  describe('constructor', () => {
    it('should throw if encryption key is not 32 bytes', () => {
      expect(() => new CloudSync(db, adapter, Buffer.alloc(16))).toThrow(
        'Encryption key must be exactly 32 bytes',
      );
    });

    it('should accept a valid 32-byte encryption key', () => {
      expect(() => new CloudSync(db, adapter, makeEncryptionKey())).not.toThrow();
    });
  });

  // --- Encryption/Decryption tests ---

  describe('encrypt/decrypt', () => {
    it('should encrypt and decrypt data round-trip', () => {
      const original = Buffer.from('Hello, World!', 'utf-8');
      const encrypted = cloudSync.encrypt(original);
      const decrypted = cloudSync.decrypt(encrypted);
      expect(decrypted.toString('utf-8')).toBe('Hello, World!');
    });

    it('should produce different ciphertext for the same plaintext (random IV)', () => {
      const original = Buffer.from('Same data', 'utf-8');
      const encrypted1 = cloudSync.encrypt(original);
      const encrypted2 = cloudSync.encrypt(original);
      expect(encrypted1.equals(encrypted2)).toBe(false);
    });

    it('should produce encrypted data that is not plaintext readable', () => {
      const original = Buffer.from('Sensitive profile data with fingerprint', 'utf-8');
      const encrypted = cloudSync.encrypt(original);
      const encryptedStr = encrypted.toString('utf-8');
      expect(encryptedStr).not.toContain('Sensitive profile data');
      expect(encryptedStr).not.toContain('fingerprint');
    });

    it('should throw SYNC_ENCRYPTION_ERROR for tampered data', () => {
      const original = Buffer.from('Test data', 'utf-8');
      const encrypted = cloudSync.encrypt(original);

      // Tamper with the ciphertext
      encrypted[encrypted.length - 1] ^= 0xff;

      try {
        cloudSync.decrypt(encrypted);
        expect.unreachable('Should have thrown');
      } catch (err: unknown) {
        const error = err as Error & { code: number };
        expect(error.code).toBe(AppErrorCode.SYNC_ENCRYPTION_ERROR);
      }
    });

    it('should throw SYNC_ENCRYPTION_ERROR for data too short', () => {
      try {
        cloudSync.decrypt(Buffer.alloc(10));
        expect.unreachable('Should have thrown');
      } catch (err: unknown) {
        const error = err as Error & { code: number };
        expect(error.code).toBe(AppErrorCode.SYNC_ENCRYPTION_ERROR);
      }
    });

    it('should fail to decrypt with a different key', () => {
      const original = Buffer.from('Secret data', 'utf-8');
      const encrypted = cloudSync.encrypt(original);

      const otherKey = makeEncryptionKey();
      const otherSync = new CloudSync(db, adapter, otherKey);

      try {
        otherSync.decrypt(encrypted);
        expect.unreachable('Should have thrown');
      } catch (err: unknown) {
        const error = err as Error & { code: number };
        expect(error.code).toBe(AppErrorCode.SYNC_ENCRYPTION_ERROR);
      }
    });
  });

  // --- Task 11.1: syncProfile tests ---

  describe('syncProfile', () => {
    it('should throw PROFILE_NOT_FOUND for non-existent profile', async () => {
      try {
        await cloudSync.syncProfile('non-existent-id');
        expect.unreachable('Should have thrown');
      } catch (err: unknown) {
        const error = err as Error & { code: number };
        expect(error.code).toBe(AppErrorCode.PROFILE_NOT_FOUND);
      }
    });

    it('should encrypt and upload profile data successfully', async () => {
      const { profileId } = insertProfile('profile-sync-1');

      const result = await cloudSync.syncProfile(profileId);

      expect(result.success).toBe(true);
      expect(result.conflict).toBe(false);
      expect(result.bytesTransferred).toBeGreaterThan(0);
      expect(adapter.upload).toHaveBeenCalledTimes(1);
      expect(adapter.setVersion).toHaveBeenCalledTimes(1);
    });

    it('should update sync_status to synced after successful sync', async () => {
      const { profileId } = insertProfile('profile-sync-2');

      await cloudSync.syncProfile(profileId);

      const row = db
        .prepare('SELECT sync_status FROM profiles WHERE id = ?')
        .get(profileId) as { sync_status: string };
      expect(row.sync_status).toBe('synced');
    });

    it('should upload encrypted data (not plaintext)', async () => {
      const { profileId, name } = insertProfile('profile-sync-3', 'My Secret Profile');

      await cloudSync.syncProfile(profileId);

      const uploadedData = adapter.storage.get(profileId)!;
      const uploadedStr = uploadedData.toString('utf-8');
      expect(uploadedStr).not.toContain('My Secret Profile');
      expect(uploadedStr).not.toContain(name);
    });

    it('should clear checkpoint after successful sync', async () => {
      const { profileId } = insertProfile('profile-sync-4');

      await cloudSync.syncProfile(profileId);

      expect(cloudSync.hasCheckpoint(profileId)).toBe(false);
    });
  });

  // --- Task 11.2: downloadProfile tests ---

  describe('downloadProfile', () => {
    it('should throw PROFILE_NOT_FOUND when profile not in cloud', async () => {
      try {
        await cloudSync.downloadProfile('non-existent-cloud');
        expect.unreachable('Should have thrown');
      } catch (err: unknown) {
        const error = err as Error & { code: number };
        expect(error.code).toBe(AppErrorCode.PROFILE_NOT_FOUND);
      }
    });

    it('should download and decrypt profile data', async () => {
      const { profileId, fingerprint } = insertProfile('profile-dl-1');

      // First sync to upload
      await cloudSync.syncProfile(profileId);

      // Now download
      const profile = await cloudSync.downloadProfile(profileId);

      expect(profile.id).toBe(profileId);
      expect(profile.name).toBe('Test Profile');
      expect(profile.browserType).toBe('chromium');
      expect(profile.fingerprintConfig).toEqual(fingerprint);
      expect(profile.syncStatus).toBe('synced');
    });

    it('should restore fingerprint config correctly', async () => {
      const { profileId, fingerprint } = insertProfile('profile-dl-2');

      await cloudSync.syncProfile(profileId);
      const profile = await cloudSync.downloadProfile(profileId);

      expect(profile.fingerprintConfig.canvas.noiseLevel).toBe(fingerprint.canvas.noiseLevel);
      expect(profile.fingerprintConfig.webgl.noiseLevel).toBe(fingerprint.webgl.noiseLevel);
      expect(profile.fingerprintConfig.cpu.cores).toBe(fingerprint.cpu.cores);
      expect(profile.fingerprintConfig.ram.sizeGB).toBe(fingerprint.ram.sizeGB);
      expect(profile.fingerprintConfig.userAgent).toBe(fingerprint.userAgent);
      expect(profile.fingerprintConfig.fonts).toEqual(fingerprint.fonts);
      expect(profile.fingerprintConfig.webrtc).toBe(fingerprint.webrtc);
      expect(profile.fingerprintConfig.platform).toBe(fingerprint.platform);
    });

    it('should update existing profile in local DB when downloading', async () => {
      const { profileId } = insertProfile('profile-dl-3', 'Original Name');

      await cloudSync.syncProfile(profileId);

      // Modify the profile name locally
      db.prepare('UPDATE profiles SET name = ? WHERE id = ?').run('Modified Name', profileId);

      // Download should restore the original synced data
      const profile = await cloudSync.downloadProfile(profileId);
      expect(profile.name).toBe('Original Name');
    });

    it('should insert new profile in local DB when downloading to a new machine', async () => {
      const { profileId, fingerprint } = insertProfile('profile-dl-4');

      // Sync to upload
      await cloudSync.syncProfile(profileId);

      // Delete local profile to simulate a new machine
      db.prepare('DELETE FROM profiles WHERE id = ?').run(profileId);

      // Download should create the profile
      const profile = await cloudSync.downloadProfile(profileId);
      expect(profile.id).toBe(profileId);
      expect(profile.fingerprintConfig).toEqual(fingerprint);

      // Verify it's in the database
      const row = db
        .prepare('SELECT id, name FROM profiles WHERE id = ?')
        .get(profileId) as { id: string; name: string };
      expect(row).toBeTruthy();
      expect(row.name).toBe('Test Profile');
    });
  });

  // --- Task 11.3: Resume sync tests ---

  describe('resumeSync', () => {
    it('should resume from checkpoint after interrupted sync', async () => {
      const { profileId } = insertProfile('profile-resume-1');

      // Simulate an interrupted sync by making upload fail once
      let callCount = 0;
      adapter.upload = vi.fn(async (id: string, data: Buffer) => {
        callCount++;
        if (callCount === 1) {
          // First call: save data but throw to simulate interruption
          adapter.storage.set(id, data);
          throw new Error('Network interrupted');
        }
        // Second call: succeed
        adapter.storage.set(id, data);
      });

      // First sync attempt should fail
      try {
        await cloudSync.syncProfile(profileId);
      } catch {
        // Expected to fail
      }

      // Checkpoint should exist
      expect(cloudSync.hasCheckpoint(profileId)).toBe(true);

      // Resume should succeed
      const result = await cloudSync.resumeSync(profileId);
      expect(result.success).toBe(true);
      expect(result.bytesTransferred).toBeGreaterThan(0);

      // Checkpoint should be cleared
      expect(cloudSync.hasCheckpoint(profileId)).toBe(false);
    });

    it('should update sync_status to synced after successful resume', async () => {
      const { profileId } = insertProfile('profile-resume-2');

      // Simulate interrupted sync
      let callCount = 0;
      adapter.upload = vi.fn(async (id: string, data: Buffer) => {
        callCount++;
        if (callCount === 1) {
          adapter.storage.set(id, data);
          throw new Error('Network interrupted');
        }
        adapter.storage.set(id, data);
      });

      try {
        await cloudSync.syncProfile(profileId);
      } catch {
        // Expected
      }

      await cloudSync.resumeSync(profileId);

      const row = db
        .prepare('SELECT sync_status FROM profiles WHERE id = ?')
        .get(profileId) as { sync_status: string };
      expect(row.sync_status).toBe('synced');
    });

    it('should perform fresh sync when no checkpoint exists', async () => {
      const { profileId } = insertProfile('profile-resume-3');

      // No checkpoint exists, resumeSync should do a fresh sync
      const result = await cloudSync.resumeSync(profileId);
      expect(result.success).toBe(true);
      expect(result.bytesTransferred).toBeGreaterThan(0);
    });
  });

  // --- Task 11.4: Conflict detection tests ---

  describe('conflict detection', () => {
    it('should detect conflict when remote version is newer', async () => {
      const { profileId } = insertProfile('profile-conflict-1');

      // Set remote version to be newer than local
      const futureTime = Date.now() + 100000;
      adapter.versions.set(profileId, futureTime);

      const result = await cloudSync.syncProfile(profileId);

      expect(result.success).toBe(false);
      expect(result.conflict).toBe(true);
      expect(result.bytesTransferred).toBe(0);
    });

    it('should set sync_status to conflict when conflict detected', async () => {
      const { profileId } = insertProfile('profile-conflict-2');

      const futureTime = Date.now() + 100000;
      adapter.versions.set(profileId, futureTime);

      await cloudSync.syncProfile(profileId);

      const row = db
        .prepare('SELECT sync_status FROM profiles WHERE id = ?')
        .get(profileId) as { sync_status: string };
      expect(row.sync_status).toBe('conflict');
    });

    it('should not detect conflict when remote version is 0 (first sync)', async () => {
      const { profileId } = insertProfile('profile-conflict-3');

      // Remote version is 0 (default) — no conflict
      const result = await cloudSync.syncProfile(profileId);
      expect(result.success).toBe(true);
      expect(result.conflict).toBe(false);
    });

    it('should not detect conflict when local is up to date', async () => {
      const { profileId } = insertProfile('profile-conflict-4');

      // Set remote version to be older than local
      adapter.versions.set(profileId, 1000);

      const result = await cloudSync.syncProfile(profileId);
      expect(result.success).toBe(true);
      expect(result.conflict).toBe(false);
    });
  });

  // --- Task 11.5: resolveConflict tests ---

  describe('resolveConflict', () => {
    it('should throw PROFILE_NOT_FOUND for non-existent profile', async () => {
      try {
        await cloudSync.resolveConflict('non-existent', 'local');
        expect.unreachable('Should have thrown');
      } catch (err: unknown) {
        const error = err as Error & { code: number };
        expect(error.code).toBe(AppErrorCode.PROFILE_NOT_FOUND);
      }
    });

    it('should throw SYNC_CONFLICT when profile is not in conflict state', async () => {
      insertProfile('profile-resolve-1');

      try {
        await cloudSync.resolveConflict('profile-resolve-1', 'local');
        expect.unreachable('Should have thrown');
      } catch (err: unknown) {
        const error = err as Error & { code: number };
        expect(error.code).toBe(AppErrorCode.SYNC_CONFLICT);
      }
    });

    it('should resolve conflict with local: upload local data to remote', async () => {
      const { profileId } = insertProfile('profile-resolve-2', 'Local Version');

      // Put profile in conflict state
      db.prepare('UPDATE profiles SET sync_status = ? WHERE id = ?').run('conflict', profileId);

      await cloudSync.resolveConflict(profileId, 'local');

      // Verify remote was updated
      expect(adapter.upload).toHaveBeenCalled();
      expect(adapter.setVersion).toHaveBeenCalled();

      // Verify sync_status is now 'synced'
      const row = db
        .prepare('SELECT sync_status FROM profiles WHERE id = ?')
        .get(profileId) as { sync_status: string };
      expect(row.sync_status).toBe('synced');
    });

    it('should resolve conflict with remote: overwrite local with remote data', async () => {
      const { profileId, fingerprint } = insertProfile('profile-resolve-3', 'Local Version');

      // First sync to upload the original data
      await cloudSync.syncProfile(profileId);

      // Modify local profile name
      db.prepare('UPDATE profiles SET name = ?, sync_status = ? WHERE id = ?')
        .run('Modified Local', 'conflict', profileId);

      // Resolve with remote — should restore original name
      await cloudSync.resolveConflict(profileId, 'remote');

      const row = db
        .prepare('SELECT name, sync_status FROM profiles WHERE id = ?')
        .get(profileId) as { name: string; sync_status: string };
      expect(row.name).toBe('Local Version'); // Original synced name
      expect(row.sync_status).toBe('synced');
    });

    it('should preserve fingerprint when resolving with remote', async () => {
      const { profileId, fingerprint } = insertProfile('profile-resolve-4');

      // Sync to upload
      await cloudSync.syncProfile(profileId);

      // Put in conflict state
      db.prepare('UPDATE profiles SET sync_status = ? WHERE id = ?').run('conflict', profileId);

      // Resolve with remote
      await cloudSync.resolveConflict(profileId, 'remote');

      const row = db
        .prepare('SELECT fingerprint_config FROM profiles WHERE id = ?')
        .get(profileId) as { fingerprint_config: string };
      const restoredFp = JSON.parse(row.fingerprint_config);
      expect(restoredFp).toEqual(fingerprint);
    });
  });

  // --- getSyncStatus tests ---

  describe('getSyncStatus', () => {
    it('should return pending for a new profile', async () => {
      insertProfile('profile-status-1');
      const status = await cloudSync.getSyncStatus('profile-status-1');
      expect(status).toBe('pending');
    });

    it('should return synced after successful sync', async () => {
      insertProfile('profile-status-2');
      await cloudSync.syncProfile('profile-status-2');
      const status = await cloudSync.getSyncStatus('profile-status-2');
      expect(status).toBe('synced');
    });

    it('should return conflict when conflict detected', async () => {
      insertProfile('profile-status-3');
      adapter.versions.set('profile-status-3', Date.now() + 100000);
      await cloudSync.syncProfile('profile-status-3');
      const status = await cloudSync.getSyncStatus('profile-status-3');
      expect(status).toBe('conflict');
    });

    it('should throw PROFILE_NOT_FOUND for non-existent profile', async () => {
      try {
        await cloudSync.getSyncStatus('non-existent');
        expect.unreachable('Should have thrown');
      } catch (err: unknown) {
        const error = err as Error & { code: number };
        expect(error.code).toBe(AppErrorCode.PROFILE_NOT_FOUND);
      }
    });
  });
});
