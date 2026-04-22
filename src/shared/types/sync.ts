/**
 * Cloud Sync types.
 * Types for profile synchronization between devices.
 */

/** Result of a sync operation. */
export interface SyncResult {
  success: boolean;
  conflict?: boolean;
  bytesTransferred: number;
}

/** Current sync status of a profile. */
export type SyncStatus = 'synced' | 'pending' | 'conflict' | 'error';
