/**
 * RBAC System types.
 * Types for role-based access control, users, and permissions.
 */

/** User roles in the system. */
export type Role = 'admin' | 'manager' | 'user';

/** Actions that can be performed on a profile. */
export type ProfileAction = 'view' | 'open' | 'edit' | 'delete' | 'share';

/** Granular permissions for shared profile access. */
export type Permission = 'use' | 'edit' | 'delete' | 'share';

/** Full user entity with role and profile access info. */
export interface User {
  id: string;
  username: string;
  role: Role;
  profileAccess: ProfileAccessEntry[];
}

/** Request payload for creating a new user. */
export interface CreateUserRequest {
  username: string;
  password: string;
  role: Role;
}

/** Result of an access check operation. */
export interface AccessResult {
  allowed: boolean;
  reason?: string;
}

/** A single profile access entry mapping a profile to its permissions. */
export interface ProfileAccessEntry {
  profileId: string;
  permissions: Permission[];
}
