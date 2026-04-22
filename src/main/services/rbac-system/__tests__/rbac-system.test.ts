import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { initializeDatabase } from '../../../database/index';
import { RBACSystem } from '../rbac-system';
import type { CreateUserRequest, Role, Permission, ProfileAction } from '../../../../shared/types';

/** Helper to create a test profile owned by a given user. Returns the profile ID. */
function createTestProfile(db: Database.Database, ownerId: string, name = 'Test Profile'): string {
  const profileId = `profile-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO profiles (id, name, browser_type, owner_id, status, created_at, updated_at)
     VALUES (?, ?, 'chromium', ?, 'closed', ?, ?)`,
  ).run(profileId, name, ownerId, now, now);
  return profileId;
}

// ─── createUser ───────────────────────────────────────────────────────────────

describe('RBACSystem.createUser', () => {
  let db: Database.Database;
  let dbPath: string;
  let rbac: RBACSystem;

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `test-rbac-create-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    db = initializeDatabase(dbPath);
    rbac = new RBACSystem(db);
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
  });

  it('should return a User with a valid UUID id', async () => {
    const request: CreateUserRequest = { username: 'alice', password: 'secret123', role: 'admin' };
    const user = await rbac.createUser(request);

    expect(user.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('should set correct username and role', async () => {
    const user = await rbac.createUser({ username: 'bob', password: 'pass', role: 'manager' });

    expect(user.username).toBe('bob');
    expect(user.role).toBe('manager');
    expect(user.profileAccess).toEqual([]);
  });

  it('should hash the password in the database (not store plaintext)', async () => {
    await rbac.createUser({ username: 'charlie', password: 'mypassword', role: 'user' });

    const row = db.prepare('SELECT password_hash FROM users WHERE username = ?').get('charlie') as {
      password_hash: string;
    };

    expect(row.password_hash).not.toBe('mypassword');
    expect(row.password_hash).toMatch(/^\$2[aby]?\$/); // bcrypt hash prefix
  });

  it('should generate a unique API key', async () => {
    const user1 = await rbac.createUser({ username: 'u1', password: 'p', role: 'user' });
    const user2 = await rbac.createUser({ username: 'u2', password: 'p', role: 'user' });

    const row1 = db.prepare('SELECT api_key FROM users WHERE id = ?').get(user1.id) as { api_key: string };
    const row2 = db.prepare('SELECT api_key FROM users WHERE id = ?').get(user2.id) as { api_key: string };

    expect(row1.api_key).toBeTruthy();
    expect(row2.api_key).toBeTruthy();
    expect(row1.api_key).not.toBe(row2.api_key);
  });

  it('should not include password hash in the returned User object', async () => {
    const user = await rbac.createUser({ username: 'dave', password: 'secret', role: 'admin' });

    // The User type should not have passwordHash
    expect((user as Record<string, unknown>).passwordHash).toBeUndefined();
    expect((user as Record<string, unknown>).password_hash).toBeUndefined();
    expect((user as Record<string, unknown>).password).toBeUndefined();
  });

  it('should support all three roles', async () => {
    const roles: Role[] = ['admin', 'manager', 'user'];
    for (const role of roles) {
      const user = await rbac.createUser({ username: `user-${role}`, password: 'p', role });
      expect(user.role).toBe(role);
    }
  });

  it('should insert the user record into the database', async () => {
    const user = await rbac.createUser({ username: 'eve', password: 'pw', role: 'user' });

    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as Record<string, unknown>;

    expect(row).toBeTruthy();
    expect(row.username).toBe('eve');
    expect(row.role).toBe('user');
    expect(row.created_at).toBeTruthy();
    expect(row.updated_at).toBeTruthy();
  });
});

// ─── checkAccess ──────────────────────────────────────────────────────────────

describe('RBACSystem.checkAccess', () => {
  let db: Database.Database;
  let dbPath: string;
  let rbac: RBACSystem;

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `test-rbac-access-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    db = initializeDatabase(dbPath);
    rbac = new RBACSystem(db);
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
  });

  it('should allow admin to perform any action on any profile', async () => {
    const admin = await rbac.createUser({ username: 'admin1', password: 'p', role: 'admin' });
    const otherUser = await rbac.createUser({ username: 'other', password: 'p', role: 'user' });
    const profileId = createTestProfile(db, otherUser.id);

    const actions: ProfileAction[] = ['view', 'open', 'edit', 'delete', 'share'];
    for (const action of actions) {
      const result = rbac.checkAccess(admin.id, profileId, action);
      expect(result.allowed).toBe(true);
    }
  });

  it('should deny access for non-existent user', async () => {
    const admin = await rbac.createUser({ username: 'admin2', password: 'p', role: 'admin' });
    const profileId = createTestProfile(db, admin.id);

    const result = rbac.checkAccess('non-existent-user', profileId, 'view');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('User not found');
  });

  it('should deny access for non-existent profile (non-admin)', async () => {
    const user = await rbac.createUser({ username: 'user1', password: 'p', role: 'user' });

    const result = rbac.checkAccess(user.id, 'non-existent-profile', 'view');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Profile not found');
  });

  it('should allow manager to access profiles they own', async () => {
    const manager = await rbac.createUser({ username: 'mgr1', password: 'p', role: 'manager' });
    const profileId = createTestProfile(db, manager.id);

    const actions: ProfileAction[] = ['view', 'open', 'edit', 'delete', 'share'];
    for (const action of actions) {
      const result = rbac.checkAccess(manager.id, profileId, action);
      expect(result.allowed).toBe(true);
    }
  });

  it('should deny manager access to profiles they do not own and have no grant for', async () => {
    const manager = await rbac.createUser({ username: 'mgr2', password: 'p', role: 'manager' });
    const otherUser = await rbac.createUser({ username: 'other2', password: 'p', role: 'user' });
    const profileId = createTestProfile(db, otherUser.id);

    const result = rbac.checkAccess(manager.id, profileId, 'view');
    expect(result.allowed).toBe(false);
  });

  it('should allow manager with granted access for matching permissions', async () => {
    const manager = await rbac.createUser({ username: 'mgr3', password: 'p', role: 'manager' });
    const owner = await rbac.createUser({ username: 'owner3', password: 'p', role: 'admin' });
    const profileId = createTestProfile(db, owner.id);

    // Grant 'use' permission to manager
    await rbac.shareProfile(profileId, manager.id, ['use']);

    // 'use' grants 'view' and 'open'
    expect(rbac.checkAccess(manager.id, profileId, 'view').allowed).toBe(true);
    expect(rbac.checkAccess(manager.id, profileId, 'open').allowed).toBe(true);
    // 'use' does NOT grant 'edit', 'delete', 'share'
    expect(rbac.checkAccess(manager.id, profileId, 'edit').allowed).toBe(false);
    expect(rbac.checkAccess(manager.id, profileId, 'delete').allowed).toBe(false);
    expect(rbac.checkAccess(manager.id, profileId, 'share').allowed).toBe(false);
  });

  it('should deny user access to profiles without explicit grant', async () => {
    const user = await rbac.createUser({ username: 'user2', password: 'p', role: 'user' });
    const owner = await rbac.createUser({ username: 'owner4', password: 'p', role: 'admin' });
    const profileId = createTestProfile(db, owner.id);

    const result = rbac.checkAccess(user.id, profileId, 'view');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('does not have access');
  });

  it('should allow user with use permission to view and open', async () => {
    const user = await rbac.createUser({ username: 'user3', password: 'p', role: 'user' });
    const owner = await rbac.createUser({ username: 'owner5', password: 'p', role: 'admin' });
    const profileId = createTestProfile(db, owner.id);

    await rbac.shareProfile(profileId, user.id, ['use']);

    expect(rbac.checkAccess(user.id, profileId, 'view').allowed).toBe(true);
    expect(rbac.checkAccess(user.id, profileId, 'open').allowed).toBe(true);
  });

  it('should deny user with only use permission from editing and deleting', async () => {
    const user = await rbac.createUser({ username: 'user4', password: 'p', role: 'user' });
    const owner = await rbac.createUser({ username: 'owner6', password: 'p', role: 'admin' });
    const profileId = createTestProfile(db, owner.id);

    await rbac.shareProfile(profileId, user.id, ['use']);

    expect(rbac.checkAccess(user.id, profileId, 'edit').allowed).toBe(false);
    expect(rbac.checkAccess(user.id, profileId, 'delete').allowed).toBe(false);
    expect(rbac.checkAccess(user.id, profileId, 'share').allowed).toBe(false);
  });

  it('should allow user with edit permission to edit', async () => {
    const user = await rbac.createUser({ username: 'user5', password: 'p', role: 'user' });
    const owner = await rbac.createUser({ username: 'owner7', password: 'p', role: 'admin' });
    const profileId = createTestProfile(db, owner.id);

    await rbac.shareProfile(profileId, user.id, ['use', 'edit']);

    expect(rbac.checkAccess(user.id, profileId, 'view').allowed).toBe(true);
    expect(rbac.checkAccess(user.id, profileId, 'open').allowed).toBe(true);
    expect(rbac.checkAccess(user.id, profileId, 'edit').allowed).toBe(true);
    expect(rbac.checkAccess(user.id, profileId, 'delete').allowed).toBe(false);
  });

  it('should allow user with all permissions to perform all actions', async () => {
    const user = await rbac.createUser({ username: 'user6', password: 'p', role: 'user' });
    const owner = await rbac.createUser({ username: 'owner8', password: 'p', role: 'admin' });
    const profileId = createTestProfile(db, owner.id);

    await rbac.shareProfile(profileId, user.id, ['use', 'edit', 'delete', 'share']);

    const actions: ProfileAction[] = ['view', 'open', 'edit', 'delete', 'share'];
    for (const action of actions) {
      expect(rbac.checkAccess(user.id, profileId, action).allowed).toBe(true);
    }
  });
});

// ─── updateRole ───────────────────────────────────────────────────────────────

describe('RBACSystem.updateRole', () => {
  let db: Database.Database;
  let dbPath: string;
  let rbac: RBACSystem;

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `test-rbac-role-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    db = initializeDatabase(dbPath);
    rbac = new RBACSystem(db);
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
  });

  it('should update user role in the database', async () => {
    const user = await rbac.createUser({ username: 'roletest1', password: 'p', role: 'user' });

    await rbac.updateRole(user.id, 'manager');

    const row = db.prepare('SELECT role FROM users WHERE id = ?').get(user.id) as { role: string };
    expect(row.role).toBe('manager');
  });

  it('should apply new role immediately for subsequent checkAccess calls', async () => {
    const user = await rbac.createUser({ username: 'roletest2', password: 'p', role: 'user' });
    const owner = await rbac.createUser({ username: 'owner-role', password: 'p', role: 'admin' });
    const profileId = createTestProfile(db, owner.id);

    // As a user without access, should be denied
    expect(rbac.checkAccess(user.id, profileId, 'view').allowed).toBe(false);

    // Promote to admin
    await rbac.updateRole(user.id, 'admin');

    // Now should be allowed (admin has full access)
    expect(rbac.checkAccess(user.id, profileId, 'view').allowed).toBe(true);
    expect(rbac.checkAccess(user.id, profileId, 'delete').allowed).toBe(true);
  });

  it('should throw for non-existent user', async () => {
    try {
      await rbac.updateRole('non-existent-user', 'admin');
      expect.unreachable('Should have thrown');
    } catch (err: unknown) {
      const error = err as Error & { code: number };
      expect(error.code).toBeTruthy();
      expect(error.message).toContain('non-existent-user');
    }
  });

  it('should downgrade role and restrict access immediately', async () => {
    const user = await rbac.createUser({ username: 'roletest3', password: 'p', role: 'admin' });
    const otherOwner = await rbac.createUser({ username: 'other-owner', password: 'p', role: 'admin' });
    const profileId = createTestProfile(db, otherOwner.id);

    // As admin, should have access
    expect(rbac.checkAccess(user.id, profileId, 'edit').allowed).toBe(true);

    // Downgrade to user
    await rbac.updateRole(user.id, 'user');

    // Without explicit access, should be denied
    expect(rbac.checkAccess(user.id, profileId, 'edit').allowed).toBe(false);
  });
});

// ─── shareProfile ─────────────────────────────────────────────────────────────

describe('RBACSystem.shareProfile', () => {
  let db: Database.Database;
  let dbPath: string;
  let rbac: RBACSystem;

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `test-rbac-share-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    db = initializeDatabase(dbPath);
    rbac = new RBACSystem(db);
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
  });

  it('should create a profile_access record', async () => {
    const owner = await rbac.createUser({ username: 'share-owner', password: 'p', role: 'admin' });
    const target = await rbac.createUser({ username: 'share-target', password: 'p', role: 'user' });
    const profileId = createTestProfile(db, owner.id);

    await rbac.shareProfile(profileId, target.id, ['use', 'edit']);

    const row = db
      .prepare('SELECT * FROM profile_access WHERE user_id = ? AND profile_id = ?')
      .get(target.id, profileId) as Record<string, unknown>;

    expect(row).toBeTruthy();
    expect(JSON.parse(row.permissions as string)).toEqual(['use', 'edit']);
  });

  it('should replace permissions when sharing again', async () => {
    const owner = await rbac.createUser({ username: 'share-owner2', password: 'p', role: 'admin' });
    const target = await rbac.createUser({ username: 'share-target2', password: 'p', role: 'user' });
    const profileId = createTestProfile(db, owner.id);

    // First share with 'use' only
    await rbac.shareProfile(profileId, target.id, ['use']);

    // Update to include 'edit' and 'delete'
    await rbac.shareProfile(profileId, target.id, ['use', 'edit', 'delete']);

    const row = db
      .prepare('SELECT permissions FROM profile_access WHERE user_id = ? AND profile_id = ?')
      .get(target.id, profileId) as { permissions: string };

    expect(JSON.parse(row.permissions)).toEqual(['use', 'edit', 'delete']);
  });

  it('should not expose passwords stored in profile_data', async () => {
    const owner = await rbac.createUser({ username: 'share-owner3', password: 'p', role: 'admin' });
    const target = await rbac.createUser({ username: 'share-target3', password: 'p', role: 'user' });
    const profileId = createTestProfile(db, owner.id);

    // Simulate stored password data in profile_data
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO profile_data (id, profile_id, data_type, data, updated_at)
       VALUES (?, ?, 'cookie', ?, ?)`,
    ).run('pd-1', profileId, Buffer.from('secret-password-data'), now);

    await rbac.shareProfile(profileId, target.id, ['use']);

    // The profile_access record should NOT contain any password data
    const accessRow = db
      .prepare('SELECT * FROM profile_access WHERE user_id = ? AND profile_id = ?')
      .get(target.id, profileId) as Record<string, unknown>;

    expect(accessRow).toBeTruthy();
    // Only permissions and metadata — no data field
    expect(accessRow.data).toBeUndefined();

    // The profile_data is separate and not accessible through profile_access
    const dataRows = db
      .prepare('SELECT * FROM profile_data WHERE profile_id = ?')
      .all(profileId);
    expect(dataRows.length).toBeGreaterThan(0);
  });

  it('should grant access that checkAccess recognizes', async () => {
    const owner = await rbac.createUser({ username: 'share-owner4', password: 'p', role: 'admin' });
    const target = await rbac.createUser({ username: 'share-target4', password: 'p', role: 'user' });
    const profileId = createTestProfile(db, owner.id);

    // Before sharing, user has no access
    expect(rbac.checkAccess(target.id, profileId, 'view').allowed).toBe(false);

    // Share with 'use' permission
    await rbac.shareProfile(profileId, target.id, ['use']);

    // Now user should have view and open access
    expect(rbac.checkAccess(target.id, profileId, 'view').allowed).toBe(true);
    expect(rbac.checkAccess(target.id, profileId, 'open').allowed).toBe(true);
  });
});

// ─── revokeAccess ─────────────────────────────────────────────────────────────

describe('RBACSystem.revokeAccess', () => {
  let db: Database.Database;
  let dbPath: string;
  let rbac: RBACSystem;

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `test-rbac-revoke-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    db = initializeDatabase(dbPath);
    rbac = new RBACSystem(db);
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
  });

  it('should delete the profile_access record', async () => {
    const owner = await rbac.createUser({ username: 'revoke-owner', password: 'p', role: 'admin' });
    const target = await rbac.createUser({ username: 'revoke-target', password: 'p', role: 'user' });
    const profileId = createTestProfile(db, owner.id);

    await rbac.shareProfile(profileId, target.id, ['use']);

    // Verify access exists
    const before = db
      .prepare('SELECT * FROM profile_access WHERE user_id = ? AND profile_id = ?')
      .get(target.id, profileId);
    expect(before).toBeTruthy();

    await rbac.revokeAccess(profileId, target.id);

    // Verify access is gone
    const after = db
      .prepare('SELECT * FROM profile_access WHERE user_id = ? AND profile_id = ?')
      .get(target.id, profileId);
    expect(after).toBeUndefined();
  });

  it('should deny access after revocation', async () => {
    const owner = await rbac.createUser({ username: 'revoke-owner2', password: 'p', role: 'admin' });
    const target = await rbac.createUser({ username: 'revoke-target2', password: 'p', role: 'user' });
    const profileId = createTestProfile(db, owner.id);

    await rbac.shareProfile(profileId, target.id, ['use', 'edit']);

    // Verify access works
    expect(rbac.checkAccess(target.id, profileId, 'view').allowed).toBe(true);

    await rbac.revokeAccess(profileId, target.id);

    // Verify access is denied
    expect(rbac.checkAccess(target.id, profileId, 'view').allowed).toBe(false);
  });

  it('should invoke session callback when revoking access', async () => {
    const owner = await rbac.createUser({ username: 'revoke-owner3', password: 'p', role: 'admin' });
    const target = await rbac.createUser({ username: 'revoke-target3', password: 'p', role: 'user' });
    const profileId = createTestProfile(db, owner.id);

    await rbac.shareProfile(profileId, target.id, ['use']);

    let callbackInvoked = false;
    rbac.registerSessionCallback(profileId, target.id, () => {
      callbackInvoked = true;
    });

    await rbac.revokeAccess(profileId, target.id);

    expect(callbackInvoked).toBe(true);
  });

  it('should clean up session callback after invocation', async () => {
    const owner = await rbac.createUser({ username: 'revoke-owner4', password: 'p', role: 'admin' });
    const target = await rbac.createUser({ username: 'revoke-target4', password: 'p', role: 'user' });
    const profileId = createTestProfile(db, owner.id);

    await rbac.shareProfile(profileId, target.id, ['use']);

    let callCount = 0;
    rbac.registerSessionCallback(profileId, target.id, () => {
      callCount++;
    });

    await rbac.revokeAccess(profileId, target.id);
    expect(callCount).toBe(1);

    // Re-share and revoke again — callback should NOT fire again (it was cleaned up)
    await rbac.shareProfile(profileId, target.id, ['use']);
    await rbac.revokeAccess(profileId, target.id);
    expect(callCount).toBe(1);
  });

  it('should handle revoking access that does not exist gracefully', async () => {
    const owner = await rbac.createUser({ username: 'revoke-owner5', password: 'p', role: 'admin' });
    const target = await rbac.createUser({ username: 'revoke-target5', password: 'p', role: 'user' });
    const profileId = createTestProfile(db, owner.id);

    // No access was granted — revoking should not throw
    await expect(rbac.revokeAccess(profileId, target.id)).resolves.toBeUndefined();
  });
});

// ─── getUser ──────────────────────────────────────────────────────────────────

describe('RBACSystem.getUser', () => {
  let db: Database.Database;
  let dbPath: string;
  let rbac: RBACSystem;

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `test-rbac-getuser-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    db = initializeDatabase(dbPath);
    rbac = new RBACSystem(db);
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
  });

  it('should return null for non-existent user', () => {
    const user = rbac.getUser('non-existent');
    expect(user).toBeNull();
  });

  it('should return user with profile access entries', async () => {
    const owner = await rbac.createUser({ username: 'getuser-owner', password: 'p', role: 'admin' });
    const target = await rbac.createUser({ username: 'getuser-target', password: 'p', role: 'user' });
    const profileId = createTestProfile(db, owner.id);

    await rbac.shareProfile(profileId, target.id, ['use', 'edit']);

    const user = rbac.getUser(target.id);
    expect(user).not.toBeNull();
    expect(user!.username).toBe('getuser-target');
    expect(user!.role).toBe('user');
    expect(user!.profileAccess).toHaveLength(1);
    expect(user!.profileAccess[0].profileId).toBe(profileId);
    expect(user!.profileAccess[0].permissions).toEqual(['use', 'edit']);
  });
});
