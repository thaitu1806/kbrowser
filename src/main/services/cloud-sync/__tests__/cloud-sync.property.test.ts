/**
 * Property-based tests for Cloud Sync (P5, P6).
 *
 * Uses fast-check to verify correctness properties defined in the design document.
 * Tests use a mock CloudStorageAdapter backed by an in-memory Map.
 */

import { describe, it, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { initializeDatabase } from '../../../database/index';
import { CloudSync } from '../cloud-sync';
import type { CloudStorageAdapter } from '../cloud-sync';
import { assertProperty, propertyTag } from '../../../../test-helpers/fast-check-helpers';

// ---------------------------------------------------------------------------
// Mock CloudStorageAdapter (same pattern as unit tests)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Arbitraries (generators)
// ---------------------------------------------------------------------------

/** Non-empty profile name (1–50 chars, printable ASCII). */
const arbProfileName = fc.stringOf(
  fc.char().filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127),
  { minLength: 1, maxLength: 50 },
);

/** Browser type: 'chromium' | 'firefox'. */
const arbBrowserType: fc.Arbitrary<'chromium' | 'firefox'> = fc.constantFrom(
  'chromium' as const,
  'firefox' as const,
);

/** Valid fingerprint config for profile insertion. */
const arbFingerprintConfig = fc.record({
  canvas: fc.record({ noiseLevel: fc.double({ min: 0, max: 1, noNaN: true }) }),
  webgl: fc.record({ noiseLevel: fc.double({ min: 0, max: 1, noNaN: true }) }),
  audioContext: fc.record({
    frequencyOffset: fc.double({ min: -1, max: 1, noNaN: true }),
  }),
  cpu: fc.record({ cores: fc.integer({ min: 1, max: 32 }) }),
  ram: fc.record({ sizeGB: fc.integer({ min: 1, max: 64 }) }),
  userAgent: fc.stringOf(
    fc.char().filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127),
    { minLength: 1, maxLength: 100 },
  ),
  fonts: fc.array(
    fc.stringOf(
      fc.char().filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127),
      { minLength: 1, maxLength: 30 },
    ),
    { minLength: 0, maxLength: 5 },
  ),
  webrtc: fc.constantFrom('disable' as const, 'proxy' as const, 'real' as const),
  platform: fc.stringOf(
    fc.char().filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127),
    { minLength: 1, maxLength: 30 },
  ),
  appVersion: fc.stringOf(
    fc.char().filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127),
    { minLength: 1, maxLength: 60 },
  ),
  oscpu: fc.stringOf(
    fc.char().filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127),
    { minLength: 1, maxLength: 60 },
  ),
});

/** Composite arbitrary for a profile record to insert into the DB. */
const arbProfileData = fc.record({
  name: arbProfileName,
  browserType: arbBrowserType,
  fingerprint: arbFingerprintConfig,
});

// ---------------------------------------------------------------------------
// Shared test setup / teardown
// ---------------------------------------------------------------------------

const ownerId = 'prop-test-sync-owner';

let db: Database.Database;
let dbPath: string;
let adapter: ReturnType<typeof createMockAdapter>;
let encryptionKey: Buffer;
let cloudSync: CloudSync;

function setup() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  dbPath = path.join(os.tmpdir(), `prop-cloud-sync-${suffix}.db`);
  db = initializeDatabase(dbPath);

  // Insert a test user (foreign key requirement)
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
     VALUES (?, 'propsyncuser', 'hash', 'admin', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`,
  ).run(ownerId);

  adapter = createMockAdapter();
  encryptionKey = crypto.randomBytes(32);
  cloudSync = new CloudSync(db, adapter, encryptionKey);
}

function teardown() {
  try { db.close(); } catch { /* ignore */ }
  try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
  try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
  try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
}

/** Insert a profile into the database and return its id. */
function insertProfile(
  profileId: string,
  name: string,
  browserType: 'chromium' | 'firefox',
  fingerprint: Record<string, unknown>,
): string {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO profiles (id, name, browser_type, owner_id, status, fingerprint_config,
                          sync_enabled, sync_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'closed', ?, 1, 'pending', ?, ?)
  `).run(profileId, name, browserType, ownerId, JSON.stringify(fingerprint), now, now);
  return profileId;
}

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('CloudSync property tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setup();
  });

  afterEach(() => {
    teardown();
  });

  /**
   * **Validates: Requirements 2.4**
   *
   * Property 5: Phát hiện xung đột đồng bộ
   *
   * For any synced profile, when two machines make different edits (simulated
   * by setting the remote version higher than the local version), the system
   * must detect the conflict and not automatically overwrite data.
   */
  it(
    propertyTag(5, 'Phát hiện xung đột đồng bộ'),
    async () => {
      let counter = 0;

      await assertProperty(
        fc.asyncProperty(arbProfileData, async (profileData) => {
          counter++;
          const profileId = `conflict-prop-${counter}`;

          // Insert a profile into the local database
          insertProfile(
            profileId,
            profileData.name,
            profileData.browserType,
            profileData.fingerprint,
          );

          // Simulate "another machine" having already edited and synced:
          // set the remote version to be much higher than the local updated_at timestamp
          const futureVersion = Date.now() + 1_000_000;
          adapter.versions.set(profileId, futureVersion);

          // Attempt to sync — should detect conflict
          const result = await cloudSync.syncProfile(profileId);

          // The system must detect the conflict
          if (result.success !== false) return false;
          if (result.conflict !== true) return false;
          if (result.bytesTransferred !== 0) return false;

          // The system must NOT have uploaded any data (no automatic overwrite)
          const uploadedData = adapter.storage.get(profileId);
          if (uploadedData !== undefined) return false;

          // The sync_status in the database must be 'conflict'
          const row = db
            .prepare('SELECT sync_status FROM profiles WHERE id = ?')
            .get(profileId) as { sync_status: string };
          if (row.sync_status !== 'conflict') return false;

          return true;
        }),
      );
    },
  );

  /**
   * **Validates: Requirements 2.5**
   *
   * Property 6: Mã hóa dữ liệu trước khi đồng bộ
   *
   * For any profile data synced to cloud, the payload must be encrypted
   * and not readable as plaintext. Additionally, decrypting the encrypted
   * data must recover the original plaintext (round-trip).
   */
  it(
    propertyTag(6, 'Mã hóa dữ liệu trước khi đồng bộ'),
    async () => {
      await assertProperty(
        fc.asyncProperty(arbProfileData, async (profileData) => {
          // Build a plaintext JSON payload similar to what syncProfile serializes
          const profilePayload = {
            name: profileData.name,
            browserType: profileData.browserType,
            fingerprintConfig: profileData.fingerprint,
          };
          const plaintext = Buffer.from(JSON.stringify(profilePayload), 'utf-8');

          // Encrypt the data
          const encrypted = cloudSync.encrypt(plaintext);

          // 1) The encrypted output must differ from the plaintext
          if (encrypted.equals(plaintext)) return false;

          // 2) The encrypted output must not contain the full plaintext JSON.
          //    Also check that recognizable JSON structure keys are not readable.
          const encryptedStr = encrypted.toString('utf-8');
          const plaintextStr = plaintext.toString('utf-8');
          if (encryptedStr.includes(plaintextStr)) return false;
          if (encryptedStr.includes('"fingerprintConfig"')) return false;
          if (encryptedStr.includes('"browserType"')) return false;

          // 3) Decrypt round-trip: decrypting must recover the original plaintext
          const decrypted = cloudSync.decrypt(encrypted);
          if (!decrypted.equals(plaintext)) return false;

          // 4) Verify the decrypted JSON parses back to the original payload
          const parsed = JSON.parse(decrypted.toString('utf-8'));
          if (parsed.name !== profileData.name) return false;
          if (parsed.browserType !== profileData.browserType) return false;
          if (
            JSON.stringify(parsed.fingerprintConfig) !==
            JSON.stringify(profileData.fingerprint)
          ) {
            return false;
          }

          return true;
        }),
      );
    },
  );
});
