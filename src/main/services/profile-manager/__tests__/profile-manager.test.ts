import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { initializeDatabase } from '../../../database/index';
import { ProfileManager } from '../profile-manager';
import type { ProfileConfig } from '../../../../shared/types';

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

describe('ProfileManager.createProfile', () => {
  let db: Database.Database;
  let dbPath: string;
  let basePath: string;
  let manager: ProfileManager;
  const ownerId = 'test-owner-1';

  beforeEach(() => {
    // Create temp database
    dbPath = path.join(
      os.tmpdir(),
      `test-pm-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    db = initializeDatabase(dbPath);

    // Create temp base path for profile directories
    basePath = path.join(
      os.tmpdir(),
      `test-profiles-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    fs.mkdirSync(basePath, { recursive: true });

    // Insert a test user (required by foreign key constraint)
    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
       VALUES (?, 'testuser', 'hash', 'admin', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`,
    ).run(ownerId);

    manager = new ProfileManager(db, basePath);
  });

  afterEach(() => {
    db.close();
    // Clean up temp files
    try {
      fs.unlinkSync(dbPath);
      fs.unlinkSync(dbPath + '-wal');
      fs.unlinkSync(dbPath + '-shm');
    } catch {
      // Ignore cleanup errors
    }
    try {
      fs.rmSync(basePath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should return a Profile with a valid UUID id', async () => {
    const config: ProfileConfig = {
      name: 'Test Profile',
      browserType: 'chromium',
      fingerprint: makeFingerprint(),
    };

    const profile = await manager.createProfile(config, ownerId);

    // UUID v4 format
    expect(profile.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('should set correct profile fields from config', async () => {
    const config: ProfileConfig = {
      name: 'My Chromium Profile',
      browserType: 'chromium',
      fingerprint: makeFingerprint(),
    };

    const profile = await manager.createProfile(config, ownerId);

    expect(profile.name).toBe('My Chromium Profile');
    expect(profile.browserType).toBe('chromium');
    expect(profile.ownerId).toBe(ownerId);
    expect(profile.status).toBe('closed');
    expect(profile.fingerprintConfig).toEqual(config.fingerprint);
    expect(profile.proxyId).toBeNull();
    expect(profile.syncEnabled).toBe(false);
    expect(profile.syncStatus).toBeNull();
    expect(profile.lastUsedAt).toBeNull();
    expect(profile.createdAt).toBeTruthy();
    expect(profile.updatedAt).toBeTruthy();
  });

  it('should support firefox browser type', async () => {
    const config: ProfileConfig = {
      name: 'Firefox Profile',
      browserType: 'firefox',
      fingerprint: makeFingerprint(),
    };

    const profile = await manager.createProfile(config, ownerId);
    expect(profile.browserType).toBe('firefox');
  });

  it('should create profile directory with storage subdirectories', async () => {
    const config: ProfileConfig = {
      name: 'Dir Test',
      browserType: 'chromium',
      fingerprint: makeFingerprint(),
    };

    const profile = await manager.createProfile(config, ownerId);
    const profileDir = manager.getProfileDir(profile.id);

    expect(fs.existsSync(profileDir)).toBe(true);
    expect(fs.existsSync(path.join(profileDir, 'cookies'))).toBe(true);
    expect(fs.existsSync(path.join(profileDir, 'localstorage'))).toBe(true);
    expect(fs.existsSync(path.join(profileDir, 'indexeddb'))).toBe(true);
    expect(fs.existsSync(path.join(profileDir, 'cache'))).toBe(true);
  });

  it('should insert profile record into the database', async () => {
    const config: ProfileConfig = {
      name: 'DB Test',
      browserType: 'chromium',
      fingerprint: makeFingerprint(),
    };

    const profile = await manager.createProfile(config, ownerId);

    const row = db
      .prepare('SELECT * FROM profiles WHERE id = ?')
      .get(profile.id) as Record<string, unknown>;

    expect(row).toBeTruthy();
    expect(row.name).toBe('DB Test');
    expect(row.browser_type).toBe('chromium');
    expect(row.owner_id).toBe(ownerId);
    expect(row.status).toBe('closed');
    expect(JSON.parse(row.fingerprint_config as string)).toEqual(config.fingerprint);
  });

  it('should insert profile_data records for all 4 storage types', async () => {
    const config: ProfileConfig = {
      name: 'Data Test',
      browserType: 'chromium',
      fingerprint: makeFingerprint(),
    };

    const profile = await manager.createProfile(config, ownerId);

    const rows = db
      .prepare('SELECT * FROM profile_data WHERE profile_id = ? ORDER BY data_type')
      .all(profile.id) as Array<Record<string, unknown>>;

    expect(rows).toHaveLength(4);

    const dataTypes = rows.map((r) => r.data_type).sort();
    expect(dataTypes).toEqual(['cache', 'cookie', 'indexeddb', 'localstorage']);
  });

  it('should create unique profile IDs for multiple profiles', async () => {
    const config: ProfileConfig = {
      name: 'Profile',
      browserType: 'chromium',
      fingerprint: makeFingerprint(),
    };

    const profile1 = await manager.createProfile(config, ownerId);
    const profile2 = await manager.createProfile(config, ownerId);

    expect(profile1.id).not.toBe(profile2.id);
  });

  it('should create isolated directories for each profile', async () => {
    const config: ProfileConfig = {
      name: 'Isolation Test',
      browserType: 'chromium',
      fingerprint: makeFingerprint(),
    };

    const profile1 = await manager.createProfile(config, ownerId);
    const profile2 = await manager.createProfile(config, ownerId);

    const dir1 = manager.getProfileDir(profile1.id);
    const dir2 = manager.getProfileDir(profile2.id);

    expect(dir1).not.toBe(dir2);
    expect(fs.existsSync(dir1)).toBe(true);
    expect(fs.existsSync(dir2)).toBe(true);
  });

  it('should store fingerprint config as JSON in the database', async () => {
    const fingerprint = makeFingerprint();
    fingerprint.cpu.cores = 16;
    fingerprint.ram.sizeGB = 32;

    const config: ProfileConfig = {
      name: 'FP Test',
      browserType: 'firefox',
      fingerprint,
    };

    const profile = await manager.createProfile(config, ownerId);

    const row = db
      .prepare('SELECT fingerprint_config FROM profiles WHERE id = ?')
      .get(profile.id) as Record<string, unknown>;

    const storedFp = JSON.parse(row.fingerprint_config as string);
    expect(storedFp.cpu.cores).toBe(16);
    expect(storedFp.ram.sizeGB).toBe(32);
  });
});


// --- openProfile tests (with mocked Playwright) ---

import { vi } from 'vitest';
import { AppErrorCode } from '../../../../shared/types';

// Mock Playwright so we don't launch real browsers in tests
vi.mock('playwright', () => {
  const mockBrowserServer = {
    wsEndpoint: () => 'ws://127.0.0.1:9222/devtools/browser/mock-id',
    close: vi.fn().mockResolvedValue(undefined),
  };

  return {
    chromium: {
      launchServer: vi.fn().mockResolvedValue(mockBrowserServer),
    },
    firefox: {
      launchServer: vi.fn().mockResolvedValue(mockBrowserServer),
    },
  };
});

describe('ProfileManager.openProfile', () => {
  let db: Database.Database;
  let dbPath: string;
  let basePath: string;
  let manager: ProfileManager;
  const ownerId = 'test-owner-open';

  beforeEach(() => {
    vi.clearAllMocks();

    dbPath = path.join(
      os.tmpdir(),
      `test-pm-open-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    db = initializeDatabase(dbPath);

    basePath = path.join(
      os.tmpdir(),
      `test-profiles-open-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    fs.mkdirSync(basePath, { recursive: true });

    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
       VALUES (?, 'testuser', 'hash', 'admin', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`,
    ).run(ownerId);

    manager = new ProfileManager(db, basePath);
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
    try {
      fs.rmSync(basePath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should throw PROFILE_NOT_FOUND for a non-existent profile', async () => {
    try {
      await manager.openProfile('non-existent-id');
      expect.unreachable('Should have thrown');
    } catch (err: unknown) {
      const error = err as Error & { code: number };
      expect(error.code).toBe(AppErrorCode.PROFILE_NOT_FOUND);
      expect(error.message).toContain('non-existent-id');
    }
  });

  it('should throw PROFILE_ALREADY_OPEN when profile is already open', async () => {
    const config: ProfileConfig = {
      name: 'Already Open Test',
      browserType: 'chromium',
      fingerprint: makeFingerprint(),
    };
    const profile = await manager.createProfile(config, ownerId);

    // Open the profile first
    await manager.openProfile(profile.id);

    // Try to open again
    try {
      await manager.openProfile(profile.id);
      expect.unreachable('Should have thrown');
    } catch (err: unknown) {
      const error = err as Error & { code: number };
      expect(error.code).toBe(AppErrorCode.PROFILE_ALREADY_OPEN);
      expect(error.message).toContain(profile.id);
    }
  });

  it('should return a BrowserConnection with wsEndpoint and profileId', async () => {
    const config: ProfileConfig = {
      name: 'Connection Test',
      browserType: 'chromium',
      fingerprint: makeFingerprint(),
    };
    const profile = await manager.createProfile(config, ownerId);

    const connection = await manager.openProfile(profile.id);

    expect(connection.wsEndpoint).toBe('ws://127.0.0.1:9222/devtools/browser/mock-id');
    expect(connection.profileId).toBe(profile.id);
  });

  it('should update profile status to open in the database', async () => {
    const config: ProfileConfig = {
      name: 'Status Test',
      browserType: 'chromium',
      fingerprint: makeFingerprint(),
    };
    const profile = await manager.createProfile(config, ownerId);

    await manager.openProfile(profile.id);

    const row = db
      .prepare('SELECT status, last_used_at FROM profiles WHERE id = ?')
      .get(profile.id) as { status: string; last_used_at: string };

    expect(row.status).toBe('open');
    expect(row.last_used_at).toBeTruthy();
    // Verify last_used_at is a valid ISO timestamp
    expect(new Date(row.last_used_at).toISOString()).toBe(row.last_used_at);
  });

  it('should track the profile as open via isProfileOpen()', async () => {
    const config: ProfileConfig = {
      name: 'Track Test',
      browserType: 'chromium',
      fingerprint: makeFingerprint(),
    };
    const profile = await manager.createProfile(config, ownerId);

    expect(manager.isProfileOpen(profile.id)).toBe(false);

    await manager.openProfile(profile.id);

    expect(manager.isProfileOpen(profile.id)).toBe(true);
  });

  it('should launch chromium for chromium profiles', async () => {
    const { chromium: mockChromium } = await import('playwright');

    const config: ProfileConfig = {
      name: 'Chromium Launch Test',
      browserType: 'chromium',
      fingerprint: makeFingerprint(),
    };
    const profile = await manager.createProfile(config, ownerId);

    await manager.openProfile(profile.id);

    expect(mockChromium.launchServer).toHaveBeenCalledTimes(1);
  });

  it('should launch firefox for firefox profiles', async () => {
    const { firefox: mockFirefox } = await import('playwright');

    const config: ProfileConfig = {
      name: 'Firefox Launch Test',
      browserType: 'firefox',
      fingerprint: makeFingerprint(),
    };
    const profile = await manager.createProfile(config, ownerId);

    await manager.openProfile(profile.id);

    expect(mockFirefox.launchServer).toHaveBeenCalledTimes(1);
  });
});


// --- closeProfile tests ---

describe('ProfileManager.closeProfile', () => {
  let db: Database.Database;
  let dbPath: string;
  let basePath: string;
  let manager: ProfileManager;
  const ownerId = 'test-owner-close';

  beforeEach(() => {
    vi.clearAllMocks();

    dbPath = path.join(
      os.tmpdir(),
      `test-pm-close-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    db = initializeDatabase(dbPath);

    basePath = path.join(
      os.tmpdir(),
      `test-profiles-close-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    fs.mkdirSync(basePath, { recursive: true });

    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
       VALUES (?, 'testuser', 'hash', 'admin', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`,
    ).run(ownerId);

    manager = new ProfileManager(db, basePath);
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
    try {
      fs.rmSync(basePath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should close browser and update status to closed', async () => {
    const config: ProfileConfig = {
      name: 'Close Test',
      browserType: 'chromium',
      fingerprint: makeFingerprint(),
    };
    const profile = await manager.createProfile(config, ownerId);

    // Open the profile first
    await manager.openProfile(profile.id);

    // Verify it's open
    const rowBefore = db
      .prepare('SELECT status FROM profiles WHERE id = ?')
      .get(profile.id) as { status: string };
    expect(rowBefore.status).toBe('open');

    // Close the profile
    await manager.closeProfile(profile.id);

    // Verify status is now 'closed' in the database
    const rowAfter = db
      .prepare('SELECT status FROM profiles WHERE id = ?')
      .get(profile.id) as { status: string };
    expect(rowAfter.status).toBe('closed');

    // Verify the mock browser server's close() was called
    const { chromium: mockChromium } = await import('playwright');
    const mockServer = await mockChromium.launchServer({});
    // The close method on the original mock should have been called
    expect(mockServer.close).toHaveBeenCalled();
  });

  it('should remove profile from openBrowsers tracking', async () => {
    const config: ProfileConfig = {
      name: 'Tracking Test',
      browserType: 'chromium',
      fingerprint: makeFingerprint(),
    };
    const profile = await manager.createProfile(config, ownerId);

    // Open the profile
    await manager.openProfile(profile.id);
    expect(manager.isProfileOpen(profile.id)).toBe(true);

    // Close the profile
    await manager.closeProfile(profile.id);
    expect(manager.isProfileOpen(profile.id)).toBe(false);
  });

  it('should throw PROFILE_NOT_FOUND for non-existent profiles', async () => {
    try {
      await manager.closeProfile('non-existent-id');
      expect.unreachable('Should have thrown');
    } catch (err: unknown) {
      const error = err as Error & { code: number };
      expect(error.code).toBe(AppErrorCode.PROFILE_NOT_FOUND);
      expect(error.message).toContain('non-existent-id');
    }
  });

  it('should handle closing an already-closed profile gracefully', async () => {
    const config: ProfileConfig = {
      name: 'Already Closed Test',
      browserType: 'chromium',
      fingerprint: makeFingerprint(),
    };
    const profile = await manager.createProfile(config, ownerId);

    // Profile is created with status 'closed' and never opened
    // Closing it again should not throw
    await expect(manager.closeProfile(profile.id)).resolves.toBeUndefined();

    // Verify status is still 'closed'
    const row = db
      .prepare('SELECT status FROM profiles WHERE id = ?')
      .get(profile.id) as { status: string };
    expect(row.status).toBe('closed');
  });
});


// --- deleteProfile tests ---

describe('ProfileManager.deleteProfile', () => {
  let db: Database.Database;
  let dbPath: string;
  let basePath: string;
  let manager: ProfileManager;
  const ownerId = 'test-owner-delete';

  beforeEach(() => {
    vi.clearAllMocks();

    dbPath = path.join(
      os.tmpdir(),
      `test-pm-delete-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    db = initializeDatabase(dbPath);

    basePath = path.join(
      os.tmpdir(),
      `test-profiles-delete-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    fs.mkdirSync(basePath, { recursive: true });

    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
       VALUES (?, 'testuser', 'hash', 'admin', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`,
    ).run(ownerId);

    manager = new ProfileManager(db, basePath);
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
    try {
      fs.rmSync(basePath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should delete profile record from database', async () => {
    const config: ProfileConfig = {
      name: 'Delete DB Test',
      browserType: 'chromium',
      fingerprint: makeFingerprint(),
    };
    const profile = await manager.createProfile(config, ownerId);

    // Verify profile exists
    const rowBefore = db
      .prepare('SELECT id FROM profiles WHERE id = ?')
      .get(profile.id);
    expect(rowBefore).toBeTruthy();

    await manager.deleteProfile(profile.id);

    // Verify profile is gone
    const rowAfter = db
      .prepare('SELECT id FROM profiles WHERE id = ?')
      .get(profile.id);
    expect(rowAfter).toBeUndefined();
  });

  it('should delete all profile_data records via CASCADE', async () => {
    const config: ProfileConfig = {
      name: 'Delete Data Test',
      browserType: 'chromium',
      fingerprint: makeFingerprint(),
    };
    const profile = await manager.createProfile(config, ownerId);

    // Verify profile_data records exist (4 storage types)
    const dataBefore = db
      .prepare('SELECT * FROM profile_data WHERE profile_id = ?')
      .all(profile.id);
    expect(dataBefore).toHaveLength(4);

    await manager.deleteProfile(profile.id);

    // Verify all profile_data records are gone
    const dataAfter = db
      .prepare('SELECT * FROM profile_data WHERE profile_id = ?')
      .all(profile.id);
    expect(dataAfter).toHaveLength(0);
  });

  it('should delete the profile directory from filesystem', async () => {
    const config: ProfileConfig = {
      name: 'Delete Dir Test',
      browserType: 'chromium',
      fingerprint: makeFingerprint(),
    };
    const profile = await manager.createProfile(config, ownerId);
    const profileDir = manager.getProfileDir(profile.id);

    // Verify directory exists
    expect(fs.existsSync(profileDir)).toBe(true);
    expect(fs.existsSync(path.join(profileDir, 'cookies'))).toBe(true);

    await manager.deleteProfile(profile.id);

    // Verify directory is gone
    expect(fs.existsSync(profileDir)).toBe(false);
  });

  it('should throw PROFILE_NOT_FOUND for non-existent profiles', async () => {
    try {
      await manager.deleteProfile('non-existent-id');
      expect.unreachable('Should have thrown');
    } catch (err: unknown) {
      const error = err as Error & { code: number };
      expect(error.code).toBe(AppErrorCode.PROFILE_NOT_FOUND);
      expect(error.message).toContain('non-existent-id');
    }
  });

  it('should close an open profile before deleting', async () => {
    const config: ProfileConfig = {
      name: 'Close Before Delete Test',
      browserType: 'chromium',
      fingerprint: makeFingerprint(),
    };
    const profile = await manager.createProfile(config, ownerId);

    // Open the profile
    await manager.openProfile(profile.id);
    expect(manager.isProfileOpen(profile.id)).toBe(true);

    // Delete should close it first, then delete
    await manager.deleteProfile(profile.id);

    // Verify profile is no longer tracked as open
    expect(manager.isProfileOpen(profile.id)).toBe(false);

    // Verify profile record is gone from database
    const row = db
      .prepare('SELECT id FROM profiles WHERE id = ?')
      .get(profile.id);
    expect(row).toBeUndefined();

    // Verify the mock browser server's close() was called
    const { chromium: mockChromium } = await import('playwright');
    const mockServer = await mockChromium.launchServer({});
    expect(mockServer.close).toHaveBeenCalled();
  });

  it('should handle deleting a profile whose directory does not exist', async () => {
    const config: ProfileConfig = {
      name: 'No Dir Test',
      browserType: 'chromium',
      fingerprint: makeFingerprint(),
    };
    const profile = await manager.createProfile(config, ownerId);
    const profileDir = manager.getProfileDir(profile.id);

    // Manually remove the directory before calling deleteProfile
    fs.rmSync(profileDir, { recursive: true, force: true });
    expect(fs.existsSync(profileDir)).toBe(false);

    // deleteProfile should not throw even though directory is already gone
    await expect(manager.deleteProfile(profile.id)).resolves.toBeUndefined();

    // Verify profile record is still deleted from database
    const row = db
      .prepare('SELECT id FROM profiles WHERE id = ?')
      .get(profile.id);
    expect(row).toBeUndefined();
  });
});


// --- updateProfile tests ---

describe('ProfileManager.updateProfile', () => {
  let db: Database.Database;
  let dbPath: string;
  let basePath: string;
  let manager: ProfileManager;
  const ownerId = 'test-owner-update';

  beforeEach(() => {
    vi.clearAllMocks();

    dbPath = path.join(
      os.tmpdir(),
      `test-pm-update-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    db = initializeDatabase(dbPath);

    basePath = path.join(
      os.tmpdir(),
      `test-profiles-update-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    fs.mkdirSync(basePath, { recursive: true });

    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
       VALUES (?, 'testuser', 'hash', 'admin', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`,
    ).run(ownerId);

    manager = new ProfileManager(db, basePath);
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
    try {
      fs.rmSync(basePath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should update profile name', async () => {
    const config: ProfileConfig = {
      name: 'Original Name',
      browserType: 'chromium',
      fingerprint: makeFingerprint(),
    };
    const profile = await manager.createProfile(config, ownerId);

    const updated = await manager.updateProfile(profile.id, { name: 'New Name' });

    expect(updated.name).toBe('New Name');
    // Other fields should remain unchanged
    expect(updated.browserType).toBe('chromium');
    expect(updated.fingerprintConfig).toEqual(config.fingerprint);
  });

  it('should update fingerprint config', async () => {
    const config: ProfileConfig = {
      name: 'FP Update Test',
      browserType: 'chromium',
      fingerprint: makeFingerprint(),
    };
    const profile = await manager.createProfile(config, ownerId);

    const newFingerprint = makeFingerprint();
    newFingerprint.cpu.cores = 16;
    newFingerprint.ram.sizeGB = 32;
    newFingerprint.userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';

    const updated = await manager.updateProfile(profile.id, { fingerprint: newFingerprint });

    expect(updated.fingerprintConfig).toEqual(newFingerprint);
    expect(updated.fingerprintConfig.cpu.cores).toBe(16);
    expect(updated.fingerprintConfig.ram.sizeGB).toBe(32);
    // Other fields should remain unchanged
    expect(updated.name).toBe('FP Update Test');
    expect(updated.browserType).toBe('chromium');
  });

  it('should update browser type', async () => {
    const config: ProfileConfig = {
      name: 'Browser Type Test',
      browserType: 'chromium',
      fingerprint: makeFingerprint(),
    };
    const profile = await manager.createProfile(config, ownerId);

    const updated = await manager.updateProfile(profile.id, { browserType: 'firefox' });

    expect(updated.browserType).toBe('firefox');
    // Other fields should remain unchanged
    expect(updated.name).toBe('Browser Type Test');
    expect(updated.fingerprintConfig).toEqual(config.fingerprint);
  });

  it('should handle partial updates (only update provided fields)', async () => {
    const originalFingerprint = makeFingerprint();
    const config: ProfileConfig = {
      name: 'Partial Update Test',
      browserType: 'chromium',
      fingerprint: originalFingerprint,
    };
    const profile = await manager.createProfile(config, ownerId);

    // Only update name — browserType and fingerprint should remain unchanged
    const updated = await manager.updateProfile(profile.id, { name: 'Updated Name Only' });

    expect(updated.name).toBe('Updated Name Only');
    expect(updated.browserType).toBe('chromium');
    expect(updated.fingerprintConfig).toEqual(originalFingerprint);
    expect(updated.id).toBe(profile.id);
    expect(updated.ownerId).toBe(ownerId);
    expect(updated.status).toBe('closed');
  });

  it('should throw PROFILE_NOT_FOUND for non-existent profiles', async () => {
    try {
      await manager.updateProfile('non-existent-id', { name: 'New Name' });
      expect.unreachable('Should have thrown');
    } catch (err: unknown) {
      const error = err as Error & { code: number };
      expect(error.code).toBe(AppErrorCode.PROFILE_NOT_FOUND);
      expect(error.message).toContain('non-existent-id');
    }
  });

  it('should update updated_at timestamp', async () => {
    const config: ProfileConfig = {
      name: 'Timestamp Test',
      browserType: 'chromium',
      fingerprint: makeFingerprint(),
    };
    const profile = await manager.createProfile(config, ownerId);
    const originalUpdatedAt = profile.updatedAt;

    // Small delay to ensure timestamp differs
    await new Promise((resolve) => setTimeout(resolve, 10));

    const updated = await manager.updateProfile(profile.id, { name: 'Timestamp Updated' });

    expect(updated.updatedAt).not.toBe(originalUpdatedAt);
    // Verify it's a valid ISO timestamp
    expect(new Date(updated.updatedAt).toISOString()).toBe(updated.updatedAt);
    // Verify the new timestamp is after the original
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(
      new Date(originalUpdatedAt).getTime(),
    );
  });
});


// --- listProfiles tests ---

describe('ProfileManager.listProfiles', () => {
  let db: Database.Database;
  let dbPath: string;
  let basePath: string;
  let manager: ProfileManager;
  const ownerId = 'test-owner-list';

  beforeEach(() => {
    vi.clearAllMocks();

    dbPath = path.join(
      os.tmpdir(),
      `test-pm-list-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    db = initializeDatabase(dbPath);

    basePath = path.join(
      os.tmpdir(),
      `test-profiles-list-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    fs.mkdirSync(basePath, { recursive: true });

    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
       VALUES (?, 'testuser', 'hash', 'admin', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`,
    ).run(ownerId);

    manager = new ProfileManager(db, basePath);
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
    try {
      fs.rmSync(basePath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should return empty array when no profiles exist', async () => {
    const profiles = await manager.listProfiles();
    expect(profiles).toEqual([]);
  });

  it('should return all profiles with correct fields', async () => {
    const config1: ProfileConfig = {
      name: 'Profile Alpha',
      browserType: 'chromium',
      fingerprint: makeFingerprint(),
    };
    const config2: ProfileConfig = {
      name: 'Profile Beta',
      browserType: 'firefox',
      fingerprint: makeFingerprint(),
    };

    await manager.createProfile(config1, ownerId);
    await manager.createProfile(config2, ownerId);

    const profiles = await manager.listProfiles();

    expect(profiles).toHaveLength(2);

    const alpha = profiles.find((p) => p.name === 'Profile Alpha');
    const beta = profiles.find((p) => p.name === 'Profile Beta');

    expect(alpha).toBeDefined();
    expect(alpha!.status).toBe('closed');
    expect(alpha!.browserType).toBe('chromium');
    expect(alpha!.proxyAssigned).toBeNull();
    expect(alpha!.lastUsedAt).toBeNull();
    expect(alpha!.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    expect(beta).toBeDefined();
    expect(beta!.status).toBe('closed');
    expect(beta!.browserType).toBe('firefox');
    expect(beta!.proxyAssigned).toBeNull();
    expect(beta!.lastUsedAt).toBeNull();
  });

  it('should include proxy assignment info', async () => {
    // Insert a proxy into the database
    const proxyId = 'test-proxy-id-1';
    db.prepare(
      `INSERT INTO proxies (id, protocol, host, port, username, password, status, response_time_ms, last_checked_at)
       VALUES (?, 'http', '127.0.0.1', 8080, 'user', 'pass', 'alive', 100, '2024-01-01T00:00:00Z')`,
    ).run(proxyId);

    const config: ProfileConfig = {
      name: 'Proxy Profile',
      browserType: 'chromium',
      fingerprint: makeFingerprint(),
    };
    const profile = await manager.createProfile(config, ownerId);

    // Assign proxy to the profile directly in the database
    db.prepare('UPDATE profiles SET proxy_id = ? WHERE id = ?').run(proxyId, profile.id);

    const profiles = await manager.listProfiles();

    expect(profiles).toHaveLength(1);
    expect(profiles[0].proxyAssigned).toBe(proxyId);
  });

  it('should include last used timestamp', async () => {
    const config: ProfileConfig = {
      name: 'Last Used Profile',
      browserType: 'chromium',
      fingerprint: makeFingerprint(),
    };
    const profile = await manager.createProfile(config, ownerId);

    // Open the profile to set last_used_at
    await manager.openProfile(profile.id);

    const profiles = await manager.listProfiles();

    expect(profiles).toHaveLength(1);
    expect(profiles[0].lastUsedAt).toBeTruthy();
    // Verify it's a valid ISO timestamp
    expect(new Date(profiles[0].lastUsedAt!).toISOString()).toBe(profiles[0].lastUsedAt);
    expect(profiles[0].status).toBe('open');
  });
});
