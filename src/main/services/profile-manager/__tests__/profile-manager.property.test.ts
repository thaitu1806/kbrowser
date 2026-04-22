/**
 * Property-based tests for Profile Manager (P1–P4).
 *
 * Uses fast-check to verify correctness properties defined in the design document.
 * Playwright is mocked because these tests focus on database and filesystem operations.
 */

import { describe, it, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { initializeDatabase } from '../../../database/index';
import { ProfileManager } from '../profile-manager';
import { assertProperty, propertyTag } from '../../../../test-helpers/fast-check-helpers';
import type { ProfileConfig, FingerprintConfig } from '../../../../shared/types';

// Mock Playwright — we don't launch real browsers in property tests
vi.mock('playwright', () => {
  const mockBrowserServer = {
    wsEndpoint: () => 'ws://127.0.0.1:9222/devtools/browser/mock-id',
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    chromium: { launchServer: vi.fn().mockResolvedValue(mockBrowserServer) },
    firefox: { launchServer: vi.fn().mockResolvedValue(mockBrowserServer) },
  };
});

// ---------------------------------------------------------------------------
// Arbitraries (generators)
// ---------------------------------------------------------------------------

/** Non-empty profile name (1–50 chars, printable ASCII without control chars). */
const arbProfileName = fc
  .stringOf(fc.char().filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127), {
    minLength: 1,
    maxLength: 50,
  });

/** Browser type: 'chromium' | 'firefox'. */
const arbBrowserType: fc.Arbitrary<'chromium' | 'firefox'> = fc.constantFrom(
  'chromium' as const,
  'firefox' as const,
);

/** Valid FingerprintConfig. */
const arbFingerprintConfig: fc.Arbitrary<FingerprintConfig> = fc.record({
  canvas: fc.record({ noiseLevel: fc.double({ min: 0, max: 1, noNaN: true }) }),
  webgl: fc.record({ noiseLevel: fc.double({ min: 0, max: 1, noNaN: true }) }),
  audioContext: fc.record({ frequencyOffset: fc.double({ min: -1, max: 1, noNaN: true }) }),
  cpu: fc.record({ cores: fc.integer({ min: 1, max: 32 }) }),
  ram: fc.record({ sizeGB: fc.integer({ min: 1, max: 64 }) }),
  userAgent: fc.stringOf(fc.char().filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127), {
    minLength: 1,
    maxLength: 100,
  }),
  fonts: fc.array(
    fc.stringOf(fc.char().filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127), {
      minLength: 1,
      maxLength: 30,
    }),
    { minLength: 0, maxLength: 10 },
  ),
  webrtc: fc.constantFrom('disable' as const, 'proxy' as const, 'real' as const),
  platform: fc.stringOf(fc.char().filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127), {
    minLength: 1,
    maxLength: 30,
  }),
  appVersion: fc.stringOf(
    fc.char().filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127),
    { minLength: 1, maxLength: 60 },
  ),
  oscpu: fc.stringOf(fc.char().filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127), {
    minLength: 1,
    maxLength: 60,
  }),
});

/** Valid ProfileConfig. */
const arbProfileConfig: fc.Arbitrary<ProfileConfig> = fc.record({
  name: arbProfileName,
  browserType: arbBrowserType,
  fingerprint: arbFingerprintConfig,
});

/** Partial ProfileConfig for updates (at least one field present). */
const arbPartialProfileConfig: fc.Arbitrary<Partial<ProfileConfig>> = fc
  .record({
    name: fc.option(arbProfileName, { nil: undefined }),
    browserType: fc.option(arbBrowserType, { nil: undefined }),
    fingerprint: fc.option(arbFingerprintConfig, { nil: undefined }),
  })
  .filter(
    (cfg) => cfg.name !== undefined || cfg.browserType !== undefined || cfg.fingerprint !== undefined,
  );

// ---------------------------------------------------------------------------
// Shared test setup / teardown
// ---------------------------------------------------------------------------

const STORAGE_SUBDIRS = ['cookies', 'localstorage', 'indexeddb', 'cache'] as const;
const ownerId = 'prop-test-owner';

let db: Database.Database;
let dbPath: string;
let basePath: string;
let manager: ProfileManager;

function setup() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  dbPath = path.join(os.tmpdir(), `prop-pm-${suffix}.db`);
  db = initializeDatabase(dbPath);

  basePath = path.join(os.tmpdir(), `prop-profiles-${suffix}`);
  fs.mkdirSync(basePath, { recursive: true });

  // Insert a test user (foreign key requirement)
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
     VALUES (?, 'propuser', 'hash', 'admin', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`,
  ).run(ownerId);

  manager = new ProfileManager(db, basePath);
}

function teardown() {
  try { db.close(); } catch { /* ignore */ }
  try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
  try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
  try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
  try { fs.rmSync(basePath, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('ProfileManager property tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setup();
  });

  afterEach(() => {
    teardown();
  });

  /**
   * **Validates: Requirements 1.1**
   *
   * Property 1: Tạo hồ sơ tạo vùng lưu trữ cô lập
   *
   * For any valid ProfileConfig, creating a new profile must produce isolated
   * Cookie, LocalStorage, IndexedDB, and Cache storage directories that do not
   * overlap with any existing profile.
   */
  it(
    propertyTag(1, 'Tạo hồ sơ tạo vùng lưu trữ cô lập'),
    async () => {
      await assertProperty(
        fc.asyncProperty(
          arbProfileConfig,
          arbProfileConfig,
          async (config1, config2) => {
            const profile1 = await manager.createProfile(config1, ownerId);
            const profile2 = await manager.createProfile(config2, ownerId);

            const dir1 = manager.getProfileDir(profile1.id);
            const dir2 = manager.getProfileDir(profile2.id);

            // Each profile has its own directory
            if (dir1 === dir2) return false;

            // All 4 storage subdirectories exist for both profiles
            for (const sub of STORAGE_SUBDIRS) {
              if (!fs.existsSync(path.join(dir1, sub))) return false;
              if (!fs.existsSync(path.join(dir2, sub))) return false;
            }

            // Storage paths are isolated (no overlap)
            for (const sub of STORAGE_SUBDIRS) {
              const p1 = path.join(dir1, sub);
              const p2 = path.join(dir2, sub);
              if (p1 === p2) return false;
            }

            // Database records: each profile has 4 profile_data rows
            const data1 = db
              .prepare('SELECT data_type FROM profile_data WHERE profile_id = ? ORDER BY data_type')
              .all(profile1.id) as Array<{ data_type: string }>;
            const data2 = db
              .prepare('SELECT data_type FROM profile_data WHERE profile_id = ? ORDER BY data_type')
              .all(profile2.id) as Array<{ data_type: string }>;

            const expectedTypes = ['cache', 'cookie', 'indexeddb', 'localstorage'];
            if (JSON.stringify(data1.map((r) => r.data_type)) !== JSON.stringify(expectedTypes))
              return false;
            if (JSON.stringify(data2.map((r) => r.data_type)) !== JSON.stringify(expectedTypes))
              return false;

            return true;
          },
        ),
      );
    },
  );

  /**
   * **Validates: Requirements 1.4**
   *
   * Property 2: Xóa hồ sơ xóa toàn bộ dữ liệu liên quan
   *
   * For any existing browser profile, deleting it must remove all isolated data
   * (Cookie, LocalStorage, IndexedDB, Cache) and configuration from the system.
   */
  it(
    propertyTag(2, 'Xóa hồ sơ xóa toàn bộ dữ liệu liên quan'),
    async () => {
      await assertProperty(
        fc.asyncProperty(arbProfileConfig, async (config) => {
          const profile = await manager.createProfile(config, ownerId);
          const profileDir = manager.getProfileDir(profile.id);

          // Verify profile exists before deletion
          if (!fs.existsSync(profileDir)) return false;

          const dbRowBefore = db
            .prepare('SELECT id FROM profiles WHERE id = ?')
            .get(profile.id);
          if (!dbRowBefore) return false;

          const dataBefore = db
            .prepare('SELECT id FROM profile_data WHERE profile_id = ?')
            .all(profile.id);
          if (dataBefore.length !== 4) return false;

          // Delete the profile
          await manager.deleteProfile(profile.id);

          // Profile directory must be gone
          if (fs.existsSync(profileDir)) return false;

          // Profile record must be gone
          const dbRowAfter = db
            .prepare('SELECT id FROM profiles WHERE id = ?')
            .get(profile.id);
          if (dbRowAfter !== undefined) return false;

          // All profile_data records must be gone (CASCADE)
          const dataAfter = db
            .prepare('SELECT id FROM profile_data WHERE profile_id = ?')
            .all(profile.id);
          if (dataAfter.length !== 0) return false;

          return true;
        }),
      );
    },
  );

  /**
   * **Validates: Requirements 1.5**
   *
   * Property 3: Cập nhật cấu hình hồ sơ là round-trip
   *
   * For any profile and any valid configuration change, after saving and
   * reloading, the read configuration must be equivalent to the saved one.
   */
  it(
    propertyTag(3, 'Cập nhật cấu hình hồ sơ là round-trip'),
    async () => {
      await assertProperty(
        fc.asyncProperty(
          arbProfileConfig,
          arbPartialProfileConfig,
          async (initialConfig, partialUpdate) => {
            const profile = await manager.createProfile(initialConfig, ownerId);

            // Apply the partial update
            const updated = await manager.updateProfile(profile.id, partialUpdate);

            // Compute expected values after the update
            const expectedName =
              partialUpdate.name !== undefined ? partialUpdate.name : initialConfig.name;
            const expectedBrowserType =
              partialUpdate.browserType !== undefined
                ? partialUpdate.browserType
                : initialConfig.browserType;
            const expectedFingerprint =
              partialUpdate.fingerprint !== undefined
                ? partialUpdate.fingerprint
                : initialConfig.fingerprint;

            // The returned profile must reflect the update
            if (updated.name !== expectedName) return false;
            if (updated.browserType !== expectedBrowserType) return false;
            if (JSON.stringify(updated.fingerprintConfig) !== JSON.stringify(expectedFingerprint))
              return false;

            // Read back from the database directly to verify round-trip
            const row = db
              .prepare('SELECT name, browser_type, fingerprint_config FROM profiles WHERE id = ?')
              .get(profile.id) as {
                name: string;
                browser_type: string;
                fingerprint_config: string | null;
              };

            if (row.name !== expectedName) return false;
            if (row.browser_type !== expectedBrowserType) return false;

            const storedFp = row.fingerprint_config
              ? JSON.parse(row.fingerprint_config)
              : null;
            if (JSON.stringify(storedFp) !== JSON.stringify(expectedFingerprint)) return false;

            return true;
          },
        ),
      );
    },
  );

  /**
   * **Validates: Requirements 1.6, 7.4**
   *
   * Property 4: Danh sách hồ sơ chứa đầy đủ thông tin
   *
   * For any set of profiles, when querying the profile list, each item must
   * contain name, status (open/closed), assigned proxy, and last used time.
   */
  it(
    propertyTag(4, 'Danh sách hồ sơ chứa đầy đủ thông tin'),
    async () => {
      await assertProperty(
        fc.asyncProperty(
          fc.array(arbProfileConfig, { minLength: 1, maxLength: 5 }),
          async (configs) => {
            // Create all profiles
            const created = [];
            for (const cfg of configs) {
              created.push(await manager.createProfile(cfg, ownerId));
            }

            // Query the list
            const list = await manager.listProfiles();

            // Every created profile must appear in the list
            for (const profile of created) {
              const found = list.find((s) => s.id === profile.id);
              if (!found) return false;

              // Must contain name
              if (typeof found.name !== 'string' || found.name.length === 0) return false;

              // Must contain status ('open' or 'closed')
              if (found.status !== 'open' && found.status !== 'closed') return false;

              // Must contain proxyAssigned field (string | null)
              if (!('proxyAssigned' in found)) return false;

              // Must contain lastUsedAt field (string | null)
              if (!('lastUsedAt' in found)) return false;
            }

            // List length must match the number of profiles in the database
            const dbCount = (
              db.prepare('SELECT COUNT(*) as cnt FROM profiles').get() as { cnt: number }
            ).cnt;
            if (list.length !== dbCount) return false;

            return true;
          },
        ),
      );
    },
  );
});
