/**
 * Shared TypeScript types and interfaces.
 * Re-exports all type definitions used across the main process,
 * renderer process, and services.
 */

// Profile Manager types
export type {
  ProfileConfig,
  Profile,
  ProfileSummary,
  BrowserConnection,
} from './profile';

// Fingerprint Spoofer types
export type {
  FingerprintConfig,
  FingerprintData,
  ValidationResult,
} from './fingerprint';

// Proxy Manager types
export type {
  ProxyConfig,
  Proxy,
  ProxyCheckResult,
  RotationConfig,
  RotationResult,
} from './proxy';

// RPA Engine types
export type {
  RPAScript,
  RPAAction,
  RPAActionType,
  RPAExecutionResult,
  RPAError,
  RPATemplate,
  ActionCategory,
} from './rpa';

export { ACTION_CATEGORIES } from './rpa';

// RBAC System types
export type {
  Role,
  ProfileAction,
  Permission,
  User,
  CreateUserRequest,
  AccessResult,
  ProfileAccessEntry,
} from './rbac';

// Cloud Sync types
export type {
  SyncResult,
  SyncStatus,
} from './sync';

// Extension Center types
export type {
  Extension,
} from './extension';

// Action Logger types
export type {
  ActionLogEntry,
  LogFilter,
} from './logger';

// Error types
export { AppErrorCode } from './errors';
