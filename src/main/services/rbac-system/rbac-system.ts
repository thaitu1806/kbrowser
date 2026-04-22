/**
 * RBAC System Service
 *
 * Hệ thống phân quyền dựa trên vai trò (Admin/Manager/User):
 * quản lý người dùng, kiểm tra quyền truy cập hồ sơ,
 * chia sẻ và thu hồi quyền.
 */

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import type Database from 'better-sqlite3';
import type {
  Role,
  ProfileAction,
  Permission,
  User,
  CreateUserRequest,
  AccessResult,
  ProfileAccessEntry,
} from '../../../shared/types';
import { AppErrorCode } from '../../../shared/types';

/** Number of bcrypt salt rounds for password hashing. */
const BCRYPT_SALT_ROUNDS = 10;

/**
 * Maps Permission values to the ProfileAction(s) they grant.
 * - 'use' grants 'view' and 'open'
 * - 'edit' grants 'edit'
 * - 'delete' grants 'delete'
 * - 'share' grants 'share'
 */
const PERMISSION_TO_ACTIONS: Record<Permission, ProfileAction[]> = {
  use: ['view', 'open'],
  edit: ['edit'],
  delete: ['delete'],
  share: ['share'],
};

export class RBACSystem {
  private db: Database.Database;

  /**
   * Callbacks registered for session disconnection when access is revoked.
   * Key: `${profileId}:${userId}`
   */
  private sessionCallbacks: Map<string, () => void | Promise<void>> = new Map();

  /**
   * @param db - A better-sqlite3 database instance (already initialized with schema).
   */
  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Creates a new user account with the specified role.
   *
   * Steps:
   * 1. Generate UUID for user ID
   * 2. Hash password with bcrypt
   * 3. Generate a unique API key
   * 4. Insert into users table
   * 5. Return User object (without password hash)
   *
   * @param request - CreateUserRequest with username, password, and role
   * @returns The created User object
   */
  async createUser(request: CreateUserRequest): Promise<User> {
    const userId = crypto.randomUUID();
    const now = new Date().toISOString();
    const passwordHash = await bcrypt.hash(request.password, BCRYPT_SALT_ROUNDS);
    const apiKey = crypto.randomUUID();

    this.db
      .prepare(
        `INSERT INTO users (id, username, password_hash, role, api_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, request.username, passwordHash, request.role, apiKey, now, now);

    const user: User = {
      id: userId,
      username: request.username,
      role: request.role,
      profileAccess: [],
    };

    return user;
  }

  /**
   * Checks whether a user is allowed to perform a specific action on a profile.
   *
   * Access rules:
   * - Admin: always allowed for all actions
   * - Manager: allowed for profiles they own or have been granted access to
   * - User: only allowed for profiles they have explicit access to,
   *   and only for actions matching their permissions
   *
   * @param userId - The ID of the user requesting access
   * @param profileId - The ID of the profile being accessed
   * @param action - The action being attempted
   * @returns AccessResult with allowed flag and optional reason
   */
  checkAccess(userId: string, profileId: string, action: ProfileAction): AccessResult {
    // Look up the user
    const userRow = this.db
      .prepare('SELECT id, role FROM users WHERE id = ?')
      .get(userId) as { id: string; role: Role } | undefined;

    if (!userRow) {
      return { allowed: false, reason: 'User not found' };
    }

    // Admin: always allowed
    if (userRow.role === 'admin') {
      return { allowed: true };
    }

    // Manager: allowed for profiles they own
    const profileRow = this.db
      .prepare('SELECT id, owner_id FROM profiles WHERE id = ?')
      .get(profileId) as { id: string; owner_id: string } | undefined;

    if (!profileRow) {
      return { allowed: false, reason: 'Profile not found' };
    }

    if (userRow.role === 'manager') {
      // Manager owns the profile
      if (profileRow.owner_id === userId) {
        return { allowed: true };
      }

      // Manager has been granted access
      const accessRow = this.db
        .prepare('SELECT permissions FROM profile_access WHERE user_id = ? AND profile_id = ?')
        .get(userId, profileId) as { permissions: string } | undefined;

      if (accessRow) {
        const permissions: Permission[] = JSON.parse(accessRow.permissions);
        if (this.isActionAllowedByPermissions(action, permissions)) {
          return { allowed: true };
        }
        return {
          allowed: false,
          reason: `Manager does not have permission for action '${action}' on this profile`,
        };
      }

      return { allowed: false, reason: 'Manager does not have access to this profile' };
    }

    // User: only allowed for profiles they have explicit access to
    if (userRow.role === 'user') {
      const accessRow = this.db
        .prepare('SELECT permissions FROM profile_access WHERE user_id = ? AND profile_id = ?')
        .get(userId, profileId) as { permissions: string } | undefined;

      if (!accessRow) {
        return { allowed: false, reason: 'User does not have access to this profile' };
      }

      const permissions: Permission[] = JSON.parse(accessRow.permissions);
      if (this.isActionAllowedByPermissions(action, permissions)) {
        return { allowed: true };
      }

      return {
        allowed: false,
        reason: `User does not have permission for action '${action}' on this profile`,
      };
    }

    return { allowed: false, reason: 'Unknown role' };
  }

  /**
   * Updates a user's role. The new role takes effect immediately
   * for subsequent checkAccess calls.
   *
   * @param userId - The ID of the user whose role is being changed
   * @param role - The new role to assign
   * @throws Error with code ACCESS_DENIED if user not found
   */
  async updateRole(userId: string, role: Role): Promise<void> {
    const row = this.db
      .prepare('SELECT id FROM users WHERE id = ?')
      .get(userId) as { id: string } | undefined;

    if (!row) {
      const error = new Error(`User not found: ${userId}`);
      (error as Error & { code: number }).code = AppErrorCode.ACCESS_DENIED;
      throw error;
    }

    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?')
      .run(role, now, userId);
  }

  /**
   * Grants profile access to a target user with specified permissions.
   * Passwords stored in the profile are NOT exposed — they live in profile_data,
   * not in profile_access.
   *
   * If the target user already has access, the permissions are replaced.
   *
   * @param profileId - The ID of the profile to share
   * @param targetUserId - The ID of the user receiving access
   * @param permissions - Array of permissions to grant
   */
  async shareProfile(
    profileId: string,
    targetUserId: string,
    permissions: Permission[],
  ): Promise<void> {
    const now = new Date().toISOString();

    // Use INSERT OR REPLACE to handle both new and existing access records
    this.db
      .prepare(
        `INSERT OR REPLACE INTO profile_access (user_id, profile_id, permissions, granted_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(targetUserId, profileId, JSON.stringify(permissions), now);
  }

  /**
   * Revokes a user's access to a profile and disconnects any active session.
   *
   * Steps:
   * 1. Delete the profile_access record
   * 2. Invoke any registered session callback for disconnection
   *
   * @param profileId - The ID of the profile
   * @param targetUserId - The ID of the user whose access is being revoked
   */
  async revokeAccess(profileId: string, targetUserId: string): Promise<void> {
    // Delete the profile_access record
    this.db
      .prepare('DELETE FROM profile_access WHERE user_id = ? AND profile_id = ?')
      .run(targetUserId, profileId);

    // Invoke session disconnection callback if registered
    const key = `${profileId}:${targetUserId}`;
    const callback = this.sessionCallbacks.get(key);
    if (callback) {
      await callback();
      this.sessionCallbacks.delete(key);
    }
  }

  /**
   * Registers a callback to be invoked when a user's access to a profile is revoked.
   * This allows external code (e.g., ProfileManager) to disconnect active sessions.
   *
   * @param profileId - The profile ID
   * @param userId - The user ID
   * @param callback - Function to call when access is revoked
   */
  registerSessionCallback(
    profileId: string,
    userId: string,
    callback: () => void | Promise<void>,
  ): void {
    const key = `${profileId}:${userId}`;
    this.sessionCallbacks.set(key, callback);
  }

  /**
   * Unregisters a session callback.
   *
   * @param profileId - The profile ID
   * @param userId - The user ID
   */
  unregisterSessionCallback(profileId: string, userId: string): void {
    const key = `${profileId}:${userId}`;
    this.sessionCallbacks.delete(key);
  }

  /**
   * Retrieves a user by ID, including their profile access entries.
   *
   * @param userId - The ID of the user to retrieve
   * @returns The User object or null if not found
   */
  getUser(userId: string): User | null {
    const row = this.db
      .prepare('SELECT id, username, role FROM users WHERE id = ?')
      .get(userId) as { id: string; username: string; role: Role } | undefined;

    if (!row) {
      return null;
    }

    const accessRows = this.db
      .prepare('SELECT profile_id, permissions FROM profile_access WHERE user_id = ?')
      .all(userId) as Array<{ profile_id: string; permissions: string }>;

    const profileAccess: ProfileAccessEntry[] = accessRows.map((r) => ({
      profileId: r.profile_id,
      permissions: JSON.parse(r.permissions),
    }));

    return {
      id: row.id,
      username: row.username,
      role: row.role,
      profileAccess,
    };
  }

  /**
   * Checks whether a given action is allowed by a set of permissions.
   */
  private isActionAllowedByPermissions(
    action: ProfileAction,
    permissions: Permission[],
  ): boolean {
    for (const perm of permissions) {
      const allowedActions = PERMISSION_TO_ACTIONS[perm];
      if (allowedActions && allowedActions.includes(action)) {
        return true;
      }
    }
    return false;
  }
}
