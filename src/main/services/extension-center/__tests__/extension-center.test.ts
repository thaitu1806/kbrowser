import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { initializeDatabase } from '../../../database/index';
import { ExtensionCenter } from '../extension-center';
import { AppErrorCode } from '../../../../shared/types';

/** ZIP magic bytes: PK\x03\x04 followed by some padding */
function makeZipBuffer(): Buffer {
  const buf = Buffer.alloc(64);
  buf[0] = 0x50; // P
  buf[1] = 0x4b; // K
  buf[2] = 0x03;
  buf[3] = 0x04;
  return buf;
}

/** Helper: create a fresh database and ExtensionCenter for each test. */
function setupTestDb() {
  const dbPath = path.join(
    os.tmpdir(),
    `test-ext-center-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  const db = initializeDatabase(dbPath);
  const center = new ExtensionCenter(db);
  return { db, dbPath, center };
}

function cleanupTestDb(db: Database.Database, dbPath: string) {
  db.close();
  try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
  try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
  try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
}

/** Helper: create a user and profile in the database for assignment tests. */
function createTestProfile(db: Database.Database, profileName: string = 'test-profile'): string {
  const userId = `user-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const profileId = `profile-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
     VALUES (?, ?, 'hash', 'admin', ?, ?)`,
  ).run(userId, `user-${profileName}`, now, now);

  db.prepare(
    `INSERT INTO profiles (id, name, browser_type, owner_id, status, created_at, updated_at)
     VALUES (?, ?, 'chromium', ?, 'closed', ?, ?)`,
  ).run(profileId, profileName, userId, now, now);

  return profileId;
}

// ─── uploadExtension (Task 10.1) ────────────────────────────────────────────

describe('ExtensionCenter.uploadExtension', () => {
  let db: Database.Database;
  let dbPath: string;
  let center: ExtensionCenter;

  beforeEach(() => {
    ({ db, dbPath, center } = setupTestDb());
  });

  afterEach(() => {
    cleanupTestDb(db, dbPath);
  });

  it('should accept a valid .zip file and return an Extension', async () => {
    const zipBuf = makeZipBuffer();
    const ext = await center.uploadExtension(zipBuf, 'ublock-origin-1.52.0.zip');

    expect(ext.id).toMatch(/^[0-9a-f]{8}-/);
    expect(ext.name).toBe('ublock-origin');
    expect(ext.version).toBe('1.52.0');
    expect(ext.source).toBe('upload');
    expect(ext.assignedProfiles).toEqual([]);
  });

  it('should store the extension in the database', async () => {
    const zipBuf = makeZipBuffer();
    const ext = await center.uploadExtension(zipBuf, 'my-ext-2.0.zip');

    const row = db.prepare('SELECT * FROM extensions WHERE id = ?').get(ext.id) as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.name).toBe('my-ext');
    expect(row.version).toBe('2.0');
    expect(row.source).toBe('upload');
    expect(row.file_data).toBeTruthy();
  });

  it('should reject a non-zip file with INVALID_EXTENSION_FORMAT', async () => {
    const notZip = Buffer.from('this is not a zip file');

    await expect(center.uploadExtension(notZip, 'bad-file.zip')).rejects.toThrow(
      'Invalid extension format',
    );

    try {
      await center.uploadExtension(notZip, 'bad-file.zip');
    } catch (err: unknown) {
      expect((err as Error & { code: number }).code).toBe(AppErrorCode.INVALID_EXTENSION_FORMAT);
    }
  });

  it('should reject an empty buffer', async () => {
    const empty = Buffer.alloc(0);

    await expect(center.uploadExtension(empty, 'empty.zip')).rejects.toThrow(
      'Invalid extension format',
    );
  });

  it('should reject a buffer shorter than 4 bytes', async () => {
    const short = Buffer.from([0x50, 0x4b]);

    await expect(center.uploadExtension(short, 'short.zip')).rejects.toThrow(
      'Invalid extension format',
    );
  });

  it('should parse filename without version as name with default version', async () => {
    const zipBuf = makeZipBuffer();
    const ext = await center.uploadExtension(zipBuf, 'simple-extension.zip');

    expect(ext.name).toBe('simple-extension');
    expect(ext.version).toBe('1.0.0');
  });

  it('should parse filename with two-part version', async () => {
    const zipBuf = makeZipBuffer();
    const ext = await center.uploadExtension(zipBuf, 'addon-3.14.zip');

    expect(ext.name).toBe('addon');
    expect(ext.version).toBe('3.14');
  });
});

// ─── downloadFromStore (Task 10.2) ──────────────────────────────────────────

describe('ExtensionCenter.downloadFromStore', () => {
  let db: Database.Database;
  let dbPath: string;
  let center: ExtensionCenter;

  beforeEach(() => {
    ({ db, dbPath, center } = setupTestDb());
  });

  afterEach(() => {
    cleanupTestDb(db, dbPath);
  });

  it('should accept a valid Chrome Web Store URL and create an extension', async () => {
    const url = 'https://chromewebstore.google.com/detail/ublock-origin/cjpalhdlnbpafiamejdnhcphjbkeiagm';
    const ext = await center.downloadFromStore(url);

    expect(ext.id).toMatch(/^[0-9a-f]{8}-/);
    expect(ext.name).toBe('ublock origin');
    expect(ext.version).toBe('1.0.0');
    expect(ext.source).toBe('store');
    expect(ext.assignedProfiles).toEqual([]);
  });

  it('should store the extension in the database', async () => {
    const url = 'https://chromewebstore.google.com/detail/dark-reader/eimadpbcbfnmbkopoojfekhnkhdbieeh';
    const ext = await center.downloadFromStore(url);

    const row = db.prepare('SELECT * FROM extensions WHERE id = ?').get(ext.id) as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.name).toBe('dark reader');
    expect(row.source).toBe('store');
  });

  it('should reject an invalid URL', async () => {
    await expect(
      center.downloadFromStore('https://example.com/not-a-store'),
    ).rejects.toThrow('Invalid Chrome Web Store URL');
  });

  it('should reject a URL with wrong domain', async () => {
    await expect(
      center.downloadFromStore('https://addons.mozilla.org/en-US/firefox/addon/ublock-origin/'),
    ).rejects.toThrow('Invalid Chrome Web Store URL');
  });

  it('should use the downloader function when provided', async () => {
    const fakeBuffer = makeZipBuffer();
    const downloader = async (_url: string) => fakeBuffer;

    const url = 'https://chromewebstore.google.com/detail/test-ext/abcdefghijklmnopqrstuvwxyzabcdef';
    const ext = await center.downloadFromStore(url, downloader);

    expect(ext.source).toBe('store');

    // Verify file_data was stored
    const row = db.prepare('SELECT file_data FROM extensions WHERE id = ?').get(ext.id) as { file_data: Buffer | null };
    expect(row.file_data).toBeTruthy();
  });

  it('should work without a downloader (placeholder entry)', async () => {
    const url = 'https://chromewebstore.google.com/detail/some-ext/abcdefghijklmnopqrstuvwxyzabcdef';
    const ext = await center.downloadFromStore(url);

    const row = db.prepare('SELECT file_data FROM extensions WHERE id = ?').get(ext.id) as { file_data: Buffer | null };
    expect(row.file_data).toBeNull();
  });
});

// ─── assignToProfiles (Task 10.3) ───────────────────────────────────────────

describe('ExtensionCenter.assignToProfiles', () => {
  let db: Database.Database;
  let dbPath: string;
  let center: ExtensionCenter;

  beforeEach(() => {
    ({ db, dbPath, center } = setupTestDb());
  });

  afterEach(() => {
    cleanupTestDb(db, dbPath);
  });

  it('should assign an extension to multiple profiles', async () => {
    const zipBuf = makeZipBuffer();
    const ext = await center.uploadExtension(zipBuf, 'test-ext-1.0.0.zip');

    const p1 = createTestProfile(db, 'profile-a');
    const p2 = createTestProfile(db, 'profile-b');

    await center.assignToProfiles(ext.id, [p1, p2]);

    const rows = db
      .prepare('SELECT profile_id FROM profile_extensions WHERE extension_id = ?')
      .all(ext.id) as Array<{ profile_id: string }>;

    expect(rows.map((r) => r.profile_id).sort()).toEqual([p1, p2].sort());
  });

  it('should skip duplicate assignments (INSERT OR IGNORE)', async () => {
    const zipBuf = makeZipBuffer();
    const ext = await center.uploadExtension(zipBuf, 'test-ext-1.0.0.zip');
    const p1 = createTestProfile(db, 'profile-dup');

    await center.assignToProfiles(ext.id, [p1]);
    await center.assignToProfiles(ext.id, [p1]); // duplicate

    const rows = db
      .prepare('SELECT profile_id FROM profile_extensions WHERE extension_id = ?')
      .all(ext.id);

    expect(rows).toHaveLength(1);
  });

  it('should throw when extension does not exist', async () => {
    const p1 = createTestProfile(db, 'profile-x');

    await expect(
      center.assignToProfiles('non-existent-id', [p1]),
    ).rejects.toThrow('Extension not found');
  });

  it('should reflect assigned profiles in listExtensions', async () => {
    const zipBuf = makeZipBuffer();
    const ext = await center.uploadExtension(zipBuf, 'test-ext-1.0.0.zip');
    const p1 = createTestProfile(db, 'profile-list-a');
    const p2 = createTestProfile(db, 'profile-list-b');

    await center.assignToProfiles(ext.id, [p1, p2]);

    const extensions = await center.listExtensions();
    const found = extensions.find((e) => e.id === ext.id);
    expect(found).toBeTruthy();
    expect(found!.assignedProfiles.sort()).toEqual([p1, p2].sort());
  });
});

// ─── removeExtension (Task 10.4) ────────────────────────────────────────────

describe('ExtensionCenter.removeExtension', () => {
  let db: Database.Database;
  let dbPath: string;
  let center: ExtensionCenter;

  beforeEach(() => {
    ({ db, dbPath, center } = setupTestDb());
  });

  afterEach(() => {
    cleanupTestDb(db, dbPath);
  });

  it('should remove the extension from the database', async () => {
    const zipBuf = makeZipBuffer();
    const ext = await center.uploadExtension(zipBuf, 'to-remove-1.0.0.zip');

    await center.removeExtension(ext.id);

    const row = db.prepare('SELECT id FROM extensions WHERE id = ?').get(ext.id);
    expect(row).toBeUndefined();
  });

  it('should cascade-delete profile_extensions entries', async () => {
    const zipBuf = makeZipBuffer();
    const ext = await center.uploadExtension(zipBuf, 'cascade-test-1.0.0.zip');
    const p1 = createTestProfile(db, 'profile-cascade');

    await center.assignToProfiles(ext.id, [p1]);

    // Verify assignment exists
    let rows = db
      .prepare('SELECT * FROM profile_extensions WHERE extension_id = ?')
      .all(ext.id);
    expect(rows).toHaveLength(1);

    await center.removeExtension(ext.id);

    // Verify cascade deletion
    rows = db
      .prepare('SELECT * FROM profile_extensions WHERE extension_id = ?')
      .all(ext.id);
    expect(rows).toHaveLength(0);
  });

  it('should not throw when removing a non-existent extension', async () => {
    await expect(center.removeExtension('does-not-exist')).resolves.toBeUndefined();
  });

  it('should not appear in listExtensions after removal', async () => {
    const zipBuf = makeZipBuffer();
    const ext = await center.uploadExtension(zipBuf, 'list-remove-1.0.0.zip');

    await center.removeExtension(ext.id);

    const extensions = await center.listExtensions();
    expect(extensions.find((e) => e.id === ext.id)).toBeUndefined();
  });
});

// ─── getExtensionsForProfile (Task 10.5) ────────────────────────────────────

describe('ExtensionCenter.getExtensionsForProfile', () => {
  let db: Database.Database;
  let dbPath: string;
  let center: ExtensionCenter;

  beforeEach(() => {
    ({ db, dbPath, center } = setupTestDb());
  });

  afterEach(() => {
    cleanupTestDb(db, dbPath);
  });

  it('should return extensions assigned to a profile', async () => {
    const zipBuf = makeZipBuffer();
    const ext1 = await center.uploadExtension(zipBuf, 'ext-a-1.0.0.zip');
    const ext2 = await center.uploadExtension(zipBuf, 'ext-b-2.0.0.zip');
    const profileId = createTestProfile(db, 'profile-get');

    await center.assignToProfiles(ext1.id, [profileId]);
    await center.assignToProfiles(ext2.id, [profileId]);

    const extensions = await center.getExtensionsForProfile(profileId);

    expect(extensions).toHaveLength(2);
    const names = extensions.map((e) => e.name).sort();
    expect(names).toEqual(['ext-a', 'ext-b']);
  });

  it('should return empty array for a profile with no extensions', async () => {
    const profileId = createTestProfile(db, 'profile-empty');

    const extensions = await center.getExtensionsForProfile(profileId);
    expect(extensions).toEqual([]);
  });

  it('should not return extensions assigned to other profiles', async () => {
    const zipBuf = makeZipBuffer();
    const ext = await center.uploadExtension(zipBuf, 'exclusive-1.0.0.zip');
    const p1 = createTestProfile(db, 'profile-p1');
    const p2 = createTestProfile(db, 'profile-p2');

    await center.assignToProfiles(ext.id, [p1]);

    const extensionsP2 = await center.getExtensionsForProfile(p2);
    expect(extensionsP2).toHaveLength(0);

    const extensionsP1 = await center.getExtensionsForProfile(p1);
    expect(extensionsP1).toHaveLength(1);
    expect(extensionsP1[0].name).toBe('exclusive');
  });

  it('should include assignedProfiles in the returned extensions', async () => {
    const zipBuf = makeZipBuffer();
    const ext = await center.uploadExtension(zipBuf, 'shared-ext-1.0.0.zip');
    const p1 = createTestProfile(db, 'profile-shared-1');
    const p2 = createTestProfile(db, 'profile-shared-2');

    await center.assignToProfiles(ext.id, [p1, p2]);

    const extensions = await center.getExtensionsForProfile(p1);
    expect(extensions).toHaveLength(1);
    expect(extensions[0].assignedProfiles.sort()).toEqual([p1, p2].sort());
  });

  it('should not return extensions after they are removed', async () => {
    const zipBuf = makeZipBuffer();
    const ext = await center.uploadExtension(zipBuf, 'removable-1.0.0.zip');
    const profileId = createTestProfile(db, 'profile-remove-check');

    await center.assignToProfiles(ext.id, [profileId]);
    await center.removeExtension(ext.id);

    const extensions = await center.getExtensionsForProfile(profileId);
    expect(extensions).toHaveLength(0);
  });
});

// ─── listExtensions ─────────────────────────────────────────────────────────

describe('ExtensionCenter.listExtensions', () => {
  let db: Database.Database;
  let dbPath: string;
  let center: ExtensionCenter;

  beforeEach(() => {
    ({ db, dbPath, center } = setupTestDb());
  });

  afterEach(() => {
    cleanupTestDb(db, dbPath);
  });

  it('should return empty array when no extensions exist', async () => {
    const extensions = await center.listExtensions();
    expect(extensions).toEqual([]);
  });

  it('should return all uploaded and store extensions', async () => {
    const zipBuf = makeZipBuffer();
    await center.uploadExtension(zipBuf, 'uploaded-ext-1.0.0.zip');
    await center.downloadFromStore(
      'https://chromewebstore.google.com/detail/store-ext/abcdefghijklmnopqrstuvwxyzabcdef',
    );

    const extensions = await center.listExtensions();
    expect(extensions).toHaveLength(2);

    const sources = extensions.map((e) => e.source).sort();
    expect(sources).toEqual(['store', 'upload']);
  });

  it('should include assigned profiles for each extension', async () => {
    const zipBuf = makeZipBuffer();
    const ext = await center.uploadExtension(zipBuf, 'with-profiles-1.0.0.zip');
    const p1 = createTestProfile(db, 'list-profile-a');

    await center.assignToProfiles(ext.id, [p1]);

    const extensions = await center.listExtensions();
    const found = extensions.find((e) => e.id === ext.id);
    expect(found!.assignedProfiles).toEqual([p1]);
  });
});
