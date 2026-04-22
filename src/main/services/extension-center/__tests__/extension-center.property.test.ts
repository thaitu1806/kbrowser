/**
 * Property-based tests for Extension Center (P28–P30).
 *
 * Uses fast-check to verify correctness properties defined in the design document.
 * Each test uses a fresh SQLite database for isolation.
 */

import { describe, it, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { initializeDatabase } from '../../../database/index';
import { ExtensionCenter } from '../extension-center';
import { AppErrorCode } from '../../../../shared/types';
import { assertProperty, propertyTag } from '../../../../test-helpers/fast-check-helpers';

// ---------------------------------------------------------------------------
// ZIP magic bytes constant
// ---------------------------------------------------------------------------

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

// ---------------------------------------------------------------------------
// Arbitraries (generators)
// ---------------------------------------------------------------------------

/**
 * Generates a valid ZIP buffer: starts with PK\x03\x04 magic bytes
 * followed by random padding (8–128 bytes total).
 */
const arbValidZipBuffer: fc.Arbitrary<Buffer> = fc
  .array(fc.integer({ min: 0, max: 255 }), { minLength: 4, maxLength: 124 })
  .map((randomBytes) => {
    const buf = Buffer.alloc(4 + randomBytes.length);
    ZIP_MAGIC.copy(buf, 0);
    for (let i = 0; i < randomBytes.length; i++) {
      buf[4 + i] = randomBytes[i];
    }
    return buf;
  });

/**
 * Generates an invalid buffer that does NOT start with ZIP magic bytes.
 * Either too short (<4 bytes) or has wrong leading bytes.
 */
const arbInvalidBuffer: fc.Arbitrary<Buffer> = fc.oneof(
  // Empty buffer
  fc.constant(Buffer.alloc(0)),
  // Buffer shorter than 4 bytes
  fc
    .array(fc.integer({ min: 0, max: 255 }), { minLength: 1, maxLength: 3 })
    .map((bytes) => Buffer.from(bytes)),
  // Buffer >= 4 bytes but first 4 bytes are NOT ZIP magic
  fc
    .array(fc.integer({ min: 0, max: 255 }), { minLength: 4, maxLength: 64 })
    .filter((bytes) => {
      return (
        bytes[0] !== 0x50 ||
        bytes[1] !== 0x4b ||
        bytes[2] !== 0x03 ||
        bytes[3] !== 0x04
      );
    })
    .map((bytes) => Buffer.from(bytes)),
);

/**
 * Generates a valid extension filename: alphanumeric name with optional version.
 * Format: "name-1.0.0.zip" or "name.zip"
 */
const arbExtensionFilename: fc.Arbitrary<string> = fc.oneof(
  // With version: name-X.Y.Z.zip
  fc
    .tuple(
      fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), {
        minLength: 3,
        maxLength: 12,
      }),
      fc.integer({ min: 0, max: 9 }),
      fc.integer({ min: 0, max: 99 }),
      fc.integer({ min: 0, max: 99 }),
    )
    .map(([name, major, minor, patch]) => `${name}-${major}.${minor}.${patch}.zip`),
  // Without version: name.zip
  fc
    .stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), {
      minLength: 3,
      maxLength: 12,
    })
    .map((name) => `${name}.zip`),
);

/**
 * Generates a group of unique profile IDs (1–8 profiles).
 */
const arbProfileGroup: fc.Arbitrary<string[]> = fc
  .array(
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), {
      minLength: 4,
      maxLength: 8,
    }),
    { minLength: 1, maxLength: 8 },
  )
  .map((names) => [...new Set(names)]) // deduplicate
  .filter((names) => names.length >= 1)
  .map((names) => names.map((n) => `profile-${n}`));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let db: Database.Database;
let dbPath: string;
let center: ExtensionCenter;

function setup() {
  iterCounter = 0;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  dbPath = path.join(os.tmpdir(), `prop-ext-center-${suffix}.db`);
  db = initializeDatabase(dbPath);
  center = new ExtensionCenter(db);
}

function teardown() {
  try { db.close(); } catch { /* ignore */ }
  try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
  try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
  try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
}

let iterCounter = 0;

/**
 * Creates a user and profile in the database with a unique ID per iteration.
 * Returns the actual profile ID used (suffixed to avoid collisions across iterations).
 */
function createTestProfile(baseProfileId: string): string {
  iterCounter++;
  const suffix = `${iterCounter}-${Math.random().toString(36).slice(2)}`;
  const profileId = `${baseProfileId}-${suffix}`;
  const userId = `user-${suffix}`;
  const now = new Date().toISOString();
  const username = `uname-${suffix}`;

  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
     VALUES (?, ?, 'hash', 'admin', ?, ?)`,
  ).run(userId, username, now, now);

  db.prepare(
    `INSERT INTO profiles (id, name, browser_type, owner_id, status, created_at, updated_at)
     VALUES (?, ?, 'chromium', ?, 'closed', ?, ?)`,
  ).run(profileId, `name-${profileId}`, userId, now, now);

  return profileId;
}

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('ExtensionCenter property tests', () => {
  beforeEach(() => {
    setup();
  });

  afterEach(() => {
    teardown();
  });

  /**
   * **Validates: Requirements 13.1, 13.6**
   *
   * Property 28: Xác thực file tiện ích mở rộng
   *
   * For any file uploaded to Extension Center, if the file is a valid .zip
   * containing an extension manifest, it must be accepted. Otherwise it must
   * be rejected with a specific error message.
   */
  it(
    propertyTag(28, 'Xác thực file tiện ích mở rộng'),
    async () => {
      await assertProperty(
        fc.asyncProperty(
          fc.oneof(
            // Valid ZIP buffer with filename
            fc.tuple(arbValidZipBuffer, arbExtensionFilename).map(([buf, name]) => ({
              buffer: buf,
              filename: name,
              shouldAccept: true,
            })),
            // Invalid buffer with filename
            fc.tuple(arbInvalidBuffer, arbExtensionFilename).map(([buf, name]) => ({
              buffer: buf,
              filename: name,
              shouldAccept: false,
            })),
          ),
          async ({ buffer, filename, shouldAccept }) => {
            if (shouldAccept) {
              // Valid ZIP must be accepted
              const ext = await center.uploadExtension(buffer, filename);

              // Must return a valid Extension object
              if (!ext.id || typeof ext.id !== 'string' || ext.id.length === 0) return false;
              if (!ext.name || typeof ext.name !== 'string') return false;
              if (!ext.version || typeof ext.version !== 'string') return false;
              if (ext.source !== 'upload') return false;
              if (!Array.isArray(ext.assignedProfiles)) return false;

              // Must be persisted in the database
              const row = db
                .prepare('SELECT id FROM extensions WHERE id = ?')
                .get(ext.id);
              if (!row) return false;
            } else {
              // Invalid buffer must be rejected
              try {
                await center.uploadExtension(buffer, filename);
                // Should not reach here
                return false;
              } catch (err: unknown) {
                const error = err as Error & { code?: number };
                // Must have a specific error message
                if (!error.message || !error.message.includes('Invalid extension format')) {
                  return false;
                }
                // Must have the correct error code
                if (error.code !== AppErrorCode.INVALID_EXTENSION_FORMAT) return false;
              }
            }

            return true;
          },
        ),
      );
    },
  );

  /**
   * **Validates: Requirements 13.3**
   *
   * Property 29: Gán tiện ích cài đặt cho tất cả hồ sơ trong nhóm
   *
   * For any extension and group of profiles, when assigning the extension
   * to the group, all profiles in the group must have the extension in
   * their installed list.
   */
  it(
    propertyTag(29, 'Gán tiện ích cài đặt cho tất cả hồ sơ trong nhóm'),
    async () => {
      await assertProperty(
        fc.asyncProperty(
          arbExtensionFilename,
          arbProfileGroup,
          async (filename, baseProfileIds) => {
            // Upload a valid extension
            const zipBuf = Buffer.alloc(64);
            ZIP_MAGIC.copy(zipBuf, 0);
            const ext = await center.uploadExtension(zipBuf, filename);

            // Create all profiles in the group (get unique IDs back)
            const profileIds = baseProfileIds.map((pid) => createTestProfile(pid));

            // Assign extension to the group
            await center.assignToProfiles(ext.id, profileIds);

            // Verify: every profile in the group must have the extension
            for (const pid of profileIds) {
              const extensions = await center.getExtensionsForProfile(pid);
              const found = extensions.find((e) => e.id === ext.id);
              if (!found) return false;
            }

            // Verify via listExtensions: assignedProfiles must contain all group members
            const allExts = await center.listExtensions();
            const listed = allExts.find((e) => e.id === ext.id);
            if (!listed) return false;

            for (const pid of profileIds) {
              if (!listed.assignedProfiles.includes(pid)) return false;
            }

            return true;
          },
        ),
      );
    },
  );

  /**
   * **Validates: Requirements 13.5**
   *
   * Property 30: Xóa tiện ích gỡ khỏi tất cả hồ sơ
   *
   * For any extension assigned to profiles, when removing the extension
   * from the central store, the extension must be removed from all
   * assigned profiles.
   */
  it(
    propertyTag(30, 'Xóa tiện ích gỡ khỏi tất cả hồ sơ'),
    async () => {
      await assertProperty(
        fc.asyncProperty(
          arbExtensionFilename,
          arbProfileGroup,
          async (filename, baseProfileIds) => {
            // Upload a valid extension
            const zipBuf = Buffer.alloc(64);
            ZIP_MAGIC.copy(zipBuf, 0);
            const ext = await center.uploadExtension(zipBuf, filename);

            // Create all profiles and assign the extension
            const profileIds = baseProfileIds.map((pid) => createTestProfile(pid));
            await center.assignToProfiles(ext.id, profileIds);

            // Verify assignment exists before removal
            for (const pid of profileIds) {
              const before = await center.getExtensionsForProfile(pid);
              if (!before.find((e) => e.id === ext.id)) return false;
            }

            // Remove the extension from the central store
            await center.removeExtension(ext.id);

            // Verify: extension must be gone from ALL profiles
            for (const pid of profileIds) {
              const after = await center.getExtensionsForProfile(pid);
              if (after.find((e) => e.id === ext.id)) return false;
            }

            // Verify: extension must not appear in listExtensions
            const allExts = await center.listExtensions();
            if (allExts.find((e) => e.id === ext.id)) return false;

            // Verify: no orphan rows in profile_extensions
            const orphans = db
              .prepare('SELECT * FROM profile_extensions WHERE extension_id = ?')
              .all(ext.id);
            if (orphans.length > 0) return false;

            return true;
          },
        ),
      );
    },
  );
});
