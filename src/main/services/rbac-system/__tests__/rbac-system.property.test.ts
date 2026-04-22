/**
 * Property-based tests for RBAC System (P21–P24).
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
import { RBACSystem } from '../rbac-system';
import { propertyTag } from '../../../../test-helpers/fast-check-helpers';
import type { Role, Permission, ProfileAction } from '../../../../shared/types';

/**
 * RBAC property tests use fewer iterations (20) because each iteration
 * calls bcrypt.hash() which is intentionally slow (~100ms per call).
 * 20 iterations × 2 users per iteration = 40 bcrypt hashes ≈ 4 seconds.
 */
const RBAC_PBT_PARAMS: fc.Parameters<unknown> = { numRuns: 20 };

async function assertRBACProperty<Ts extends [unknown, ...unknown[]]>(
  property: fc.IAsyncProperty<Ts> | fc.IProperty<Ts>,
): Promise<void> {
  await fc.assert(property, RBAC_PBT_PARAMS as fc.Parameters<Ts>);
}

// ---------------------------------------------------------------------------
// Arbitraries (generators)
// ---------------------------------------------------------------------------

/** Valid user roles. */
const arbRole: fc.Arbitrary<Role> = fc.constantFrom('admin' as const, 'manager' as const, 'user' as const);

/** Valid permissions. */
const arbPermission: fc.Arbitrary<Permission> = fc.constantFrom(
  'use' as const,
  'edit' as const,
  'delete' as const,
  'share' as const,
);

/** Non-empty subset of permissions. */
const arbPermissions: fc.Arbitrary<Permission[]> = fc
  .uniqueArray(arbPermission, { minLength: 1, maxLength: 4 })
  .map((perms) => [...perms]);

/** Valid profile actions. */
const arbProfileAction: fc.Arbitrary<ProfileAction> = fc.constantFrom(
  'view' as const,
  'open' as const,
  'edit' as const,
  'delete' as const,
  'share' as const,
);

/** Unique username generator (printable ASCII, no spaces). */
const arbUsername = fc.stringOf(
  fc.char().filter((c) => c.charCodeAt(0) >= 97 && c.charCodeAt(0) <= 122),
  { minLength: 3, maxLength: 15 },
);

// ---------------------------------------------------------------------------
// Permission-to-action mapping (mirrors the implementation)
// ---------------------------------------------------------------------------

const PERMISSION_TO_ACTIONS: Record<Permission, ProfileAction[]> = {
  use: ['view', 'open'],
  edit: ['edit'],
  delete: ['delete'],
  share: ['share'],
};

/** Returns the set of actions allowed by a given set of permissions. */
function allowedActions(permissions: Permission[]): Set<ProfileAction> {
  const actions = new Set<ProfileAction>();
  for (const perm of permissions) {
    for (const action of PERMISSION_TO_ACTIONS[perm]) {
      actions.add(action);
    }
  }
  return actions;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Counter for generating unique usernames within a test run. */
let usernameCounter = 0;

function uniqueUsername(base: string): string {
  return `${base}-${++usernameCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Creates a test profile owned by a given user. Returns the profile ID. */
function createTestProfile(
  db: Database.Database,
  ownerId: string,
  fingerprintConfig?: string,
): string {
  const profileId = `profile-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const now = new Date().toISOString();
  const fpConfig = fingerprintConfig ?? JSON.stringify({
    canvas: { noiseLevel: 0.5 },
    webgl: { noiseLevel: 0.5 },
    audioContext: { frequencyOffset: 0.1 },
    cpu: { cores: 4 },
    ram: { sizeGB: 8 },
    userAgent: 'Mozilla/5.0',
    fonts: ['Arial', 'Helvetica'],
    webrtc: 'disable',
    platform: 'Win32',
    appVersion: '5.0',
    oscpu: 'Windows NT 10.0',
  });
  db.prepare(
    `INSERT INTO profiles (id, name, browser_type, owner_id, status, fingerprint_config, created_at, updated_at)
     VALUES (?, ?, 'chromium', ?, 'closed', ?, ?, ?)`,
  ).run(profileId, `Profile-${profileId.slice(0, 8)}`, ownerId, fpConfig, now, now);
  return profileId;
}

/** Inserts simulated password data into profile_data for a profile. */
function insertPasswordData(db: Database.Database, profileId: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO profile_data (id, profile_id, data_type, data, updated_at)
     VALUES (?, ?, 'cookie', ?, ?)`,
  ).run(
    `pd-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    profileId,
    Buffer.from(JSON.stringify({ passwords: ['secret123', 'p@ssw0rd'] })),
    now,
  );
}

// ---------------------------------------------------------------------------
// Shared test setup / teardown
// ---------------------------------------------------------------------------

let db: Database.Database;
let dbPath: string;
let rbac: RBACSystem;

function setup() {
  usernameCounter = 0;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  dbPath = path.join(os.tmpdir(), `prop-rbac-${suffix}.db`);
  db = initializeDatabase(dbPath);
  rbac = new RBACSystem(db);
}

function teardown() {
  try { db.close(); } catch { /* ignore */ }
  try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
  try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
  try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('RBACSystem property tests', () => {
  beforeEach(() => {
    setup();
  });

  afterEach(() => {
    teardown();
  });

  /**
   * **Validates: Requirements 10.3, 10.5**
   *
   * Property 21: RBAC kiểm soát truy cập hồ sơ
   *
   * For any user with role User and any profile:
   * - If the user has no access grant, all operations (view, open, edit, delete) must be denied.
   * - If only 'use' permission, edit and delete must be denied.
   */
  it(
    propertyTag(21, 'RBAC kiểm soát truy cập hồ sơ'),
    async () => {
      await assertRBACProperty(
        fc.asyncProperty(
          arbProfileAction,
          fc.option(arbPermissions, { nil: undefined }),
          async (action, maybePermissions) => {
            // Create an admin owner and a 'user' role user
            const owner = await rbac.createUser({
              username: uniqueUsername('owner'),
              password: 'pw',
              role: 'admin',
            });
            const user = await rbac.createUser({
              username: uniqueUsername('user'),
              password: 'pw',
              role: 'user',
            });
            const profileId = createTestProfile(db, owner.id);

            if (maybePermissions === undefined) {
              // No access grant — all operations must be denied
              const result = rbac.checkAccess(user.id, profileId, action);
              if (result.allowed) return false;
            } else {
              // Grant specific permissions
              await rbac.shareProfile(profileId, user.id, maybePermissions);

              const allowed = allowedActions(maybePermissions);
              const result = rbac.checkAccess(user.id, profileId, action);

              if (allowed.has(action)) {
                // Action should be allowed
                if (!result.allowed) return false;
              } else {
                // Action should be denied
                if (result.allowed) return false;
              }

              // Specific check: if only 'use' permission, edit and delete must be denied
              if (
                maybePermissions.length === 1 &&
                maybePermissions[0] === 'use'
              ) {
                const editResult = rbac.checkAccess(user.id, profileId, 'edit');
                const deleteResult = rbac.checkAccess(user.id, profileId, 'delete');
                if (editResult.allowed || deleteResult.allowed) return false;
              }
            }

            return true;
          },
        ),
      );
    },
  );

  /**
   * **Validates: Requirements 10.4**
   *
   * Property 22: Thay đổi vai trò áp dụng quyền mới
   *
   * For any role change, the new access rights must be applied immediately
   * for the next checkAccess call.
   */
  it(
    propertyTag(22, 'Thay đổi vai trò áp dụng quyền mới'),
    async () => {
      await assertRBACProperty(
        fc.asyncProperty(
          arbRole,
          arbRole,
          arbProfileAction,
          async (initialRole, newRole, action) => {
            const owner = await rbac.createUser({
              username: uniqueUsername('owner'),
              password: 'pw',
              role: 'admin',
            });
            const user = await rbac.createUser({
              username: uniqueUsername('target'),
              password: 'pw',
              role: initialRole,
            });
            const profileId = createTestProfile(db, owner.id);

            // Check access before role change
            const beforeResult = rbac.checkAccess(user.id, profileId, action);

            // Change role
            await rbac.updateRole(user.id, newRole);

            // Check access after role change
            const afterResult = rbac.checkAccess(user.id, profileId, action);

            // Verify the new role's access rules apply immediately
            if (newRole === 'admin') {
              // Admin always has access
              if (!afterResult.allowed) return false;
            } else if (newRole === 'manager') {
              // Manager: only if they own the profile or have explicit access
              // Since owner is a different user and no explicit access was granted,
              // manager should be denied
              if (afterResult.allowed) return false;
            } else {
              // User: only with explicit access grant (none given)
              if (afterResult.allowed) return false;
            }

            // Verify the result changed appropriately when role changed
            // (e.g., admin -> user should lose access, user -> admin should gain access)
            if (initialRole === newRole) {
              // Same role — access should not change
              if (beforeResult.allowed !== afterResult.allowed) return false;
            }

            return true;
          },
        ),
      );
    },
  );

  /**
   * **Validates: Requirements 11.1**
   *
   * Property 23: Chia sẻ hồ sơ không tiết lộ mật khẩu
   *
   * For any profile with stored password data, when shared with another user,
   * the recipient cannot access or view the stored passwords.
   * (Verify that profile_access records don't contain password data.)
   */
  it(
    propertyTag(23, 'Chia sẻ hồ sơ không tiết lộ mật khẩu'),
    async () => {
      await assertRBACProperty(
        fc.asyncProperty(
          arbPermissions,
          async (permissions) => {
            const owner = await rbac.createUser({
              username: uniqueUsername('owner'),
              password: 'pw',
              role: 'admin',
            });
            const recipient = await rbac.createUser({
              username: uniqueUsername('recipient'),
              password: 'pw',
              role: 'user',
            });
            const profileId = createTestProfile(db, owner.id);

            // Insert simulated password data into profile_data
            insertPasswordData(db, profileId);

            // Share the profile
            await rbac.shareProfile(profileId, recipient.id, permissions);

            // Verify: profile_access record should only contain permissions metadata,
            // NOT any password or profile_data content
            const accessRow = db
              .prepare('SELECT * FROM profile_access WHERE user_id = ? AND profile_id = ?')
              .get(recipient.id, profileId) as Record<string, unknown>;

            if (!accessRow) return false;

            // The access record should only have: user_id, profile_id, permissions, granted_at
            const accessKeys = Object.keys(accessRow);
            const allowedKeys = ['user_id', 'profile_id', 'permissions', 'granted_at'];
            for (const key of accessKeys) {
              if (!allowedKeys.includes(key)) return false;
            }

            // The permissions field should only contain the granted permissions array
            const storedPermissions = JSON.parse(accessRow.permissions as string);
            if (JSON.stringify(storedPermissions) !== JSON.stringify(permissions)) return false;

            // Verify no password data leaked into the permissions field
            const permStr = accessRow.permissions as string;
            if (permStr.includes('secret') || permStr.includes('password') || permStr.includes('p@ss')) {
              return false;
            }

            // Verify the profile_data (containing passwords) is NOT accessible
            // through the profile_access table — they are separate tables
            const profileDataRows = db
              .prepare('SELECT * FROM profile_data WHERE profile_id = ?')
              .all(profileId) as Array<Record<string, unknown>>;

            // Password data should still exist in profile_data (not deleted)
            if (profileDataRows.length === 0) return false;

            // But the recipient's access record has no reference to profile_data
            if ('data' in accessRow) return false;
            if ('password' in accessRow) return false;
            if ('password_hash' in accessRow) return false;

            return true;
          },
        ),
      );
    },
  );

  /**
   * **Validates: Requirements 11.2**
   *
   * Property 24: Chia sẻ hồ sơ giữ nguyên fingerprint
   *
   * For any shared profile, the fingerprint configuration must remain
   * unchanged before and after sharing.
   */
  it(
    propertyTag(24, 'Chia sẻ hồ sơ giữ nguyên fingerprint'),
    async () => {
      await assertRBACProperty(
        fc.asyncProperty(
          arbPermissions,
          fc.record({
            canvas: fc.record({ noiseLevel: fc.double({ min: 0, max: 1, noNaN: true }) }),
            webgl: fc.record({ noiseLevel: fc.double({ min: 0, max: 1, noNaN: true }) }),
            audioContext: fc.record({
              frequencyOffset: fc.double({ min: -1, max: 1, noNaN: true }),
            }),
            cpu: fc.record({ cores: fc.integer({ min: 1, max: 32 }) }),
            ram: fc.record({ sizeGB: fc.integer({ min: 1, max: 64 }) }),
            userAgent: fc.constant('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'),
            fonts: fc.array(fc.constantFrom('Arial', 'Helvetica', 'Times New Roman'), {
              minLength: 1,
              maxLength: 5,
            }),
            webrtc: fc.constantFrom('disable' as const, 'proxy' as const, 'real' as const),
            platform: fc.constantFrom('Win32', 'Linux x86_64', 'MacIntel'),
            appVersion: fc.constant('5.0 (Windows NT 10.0; Win64; x64)'),
            oscpu: fc.constantFrom('Windows NT 10.0', 'Linux x86_64', 'Intel Mac OS X 10.15'),
          }),
          async (permissions, fingerprintConfig) => {
            const owner = await rbac.createUser({
              username: uniqueUsername('owner'),
              password: 'pw',
              role: 'admin',
            });
            const recipient = await rbac.createUser({
              username: uniqueUsername('recipient'),
              password: 'pw',
              role: 'user',
            });

            const fpConfigStr = JSON.stringify(fingerprintConfig);
            const profileId = createTestProfile(db, owner.id, fpConfigStr);

            // Read fingerprint config BEFORE sharing
            const beforeRow = db
              .prepare('SELECT fingerprint_config FROM profiles WHERE id = ?')
              .get(profileId) as { fingerprint_config: string };
            const fpBefore = beforeRow.fingerprint_config;

            // Share the profile
            await rbac.shareProfile(profileId, recipient.id, permissions);

            // Read fingerprint config AFTER sharing
            const afterRow = db
              .prepare('SELECT fingerprint_config FROM profiles WHERE id = ?')
              .get(profileId) as { fingerprint_config: string };
            const fpAfter = afterRow.fingerprint_config;

            // Fingerprint must be identical before and after sharing
            if (fpBefore !== fpAfter) return false;

            // Also verify the parsed objects are deeply equal
            const parsedBefore = JSON.parse(fpBefore);
            const parsedAfter = JSON.parse(fpAfter);
            if (JSON.stringify(parsedBefore) !== JSON.stringify(parsedAfter)) return false;

            return true;
          },
        ),
      );
    },
  );
});
