/**
 * Shared TypeScript types and interfaces.
 * Re-exports all type definitions used across the main process,
 * renderer process, and services.
 */
export type { ProfileConfig, Profile, ProfileSummary, BrowserConnection, } from './profile';
export type { FingerprintConfig, FingerprintData, ValidationResult, } from './fingerprint';
export type { ProxyConfig, Proxy, ProxyCheckResult, RotationConfig, RotationResult, } from './proxy';
export type { RPAScript, RPAAction, RPAExecutionResult, RPAError, RPATemplate, } from './rpa';
export type { Role, ProfileAction, Permission, User, CreateUserRequest, AccessResult, ProfileAccessEntry, } from './rbac';
export type { SyncResult, SyncStatus, } from './sync';
export type { Extension, } from './extension';
export type { ActionLogEntry, LogFilter, } from './logger';
export { AppErrorCode } from './errors';
//# sourceMappingURL=index.d.ts.map