/**
 * Cloud Sync Service
 *
 * Đồng bộ dữ liệu hồ sơ giữa các máy tính qua cloud storage:
 * mã hóa dữ liệu AES-256-GCM, phát hiện xung đột, resume sync từ checkpoint.
 *
 * Uses an injectable CloudStorageAdapter for testability (no real PostgreSQL needed).
 */

import crypto from 'crypto';
import type Database from 'better-sqlite3';
import type { SyncResult, SyncStatus, Profile } from '../../../shared/types';
import { AppErrorCode } from '../../../shared/types';

/** Injectable cloud storage interface for testability. */
export interface CloudStorageAdapter {
  upload(profileId: string, encryptedData: Buffer): Promise<void>;
  download(profileId: string): Promise<{ data: Buffer; version: number } | null>;
  getVersion(profileId: string): Promise<number>;
  setVersion(profileId: string, version: number): Promise<void>;
}

/** Checkpoint tracking for resume sync. */
interface SyncCheckpoint {
  profileId: string;
  bytesTransferred: number;
  totalBytes: number;
  encryptedData: Buffer;
  timestamp: string;
}

/** AES-256-GCM encryption constants. */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export class CloudSync {
  private db: Database.Database;
  private adapter: CloudStorageAdapter;
  private encryptionKey: Buffer;
  private checkpoints: Map<string, SyncCheckpoint> = new Map();

  /**
   * @param db - A better-sqlite3 database instance (already initialized with schema).
   * @param adapter - Cloud storage adapter for upload/download operations.
   * @param encryptionKey - 32-byte key for AES-256-GCM encryption.
   */
  constructor(db: Database.Database, adapter: CloudStorageAdapter, encryptionKey: Buffer) {
    if (encryptionKey.length !== 32) {
      throw new Error('Encryption key must be exactly 32 bytes for AES-256-GCM');
    }
    this.db = db;
    this.adapter = adapter;
    this.encryptionKey = encryptionKey;
  }

  /**
   * Encrypts data using AES-256-GCM.
   * Output format: [IV (12 bytes)] [Auth Tag (16 bytes)] [Ciphertext]
   */
  encrypt(data: Buffer): Buffer {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]);
  }

  /**
   * Decrypts data encrypted with AES-256-GCM.
   * Expects format: [IV (12 bytes)] [Auth Tag (16 bytes)] [Ciphertext]
   */
  decrypt(encryptedData: Buffer): Buffer {
    if (encryptedData.length < IV_LENGTH + AUTH_TAG_LENGTH) {
      const error = new Error('Encrypted data is too short to contain IV and auth tag');
      (error as Error & { code: number }).code = AppErrorCode.SYNC_ENCRYPTION_ERROR;
      throw error;
    }

    const iv = encryptedData.subarray(0, IV_LENGTH);
    const authTag = encryptedData.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = encryptedData.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    try {
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      const error = new Error('Failed to decrypt data: authentication failed');
      (error as Error & { code: number }).code = AppErrorCode.SYNC_ENCRYPTION_ERROR;
      throw error;
    }
  }

  /**
   * Reads the full profile row from the local database.
   */
  private getProfileRow(profileId: string): {
    id: string;
    name: string;
    browser_type: string;
    owner_id: string;
    status: string;
    fingerprint_config: string | null;
    proxy_id: string | null;
    sync_enabled: number;
    sync_status: string | null;
    last_used_at: string | null;
    created_at: string;
    updated_at: string;
  } | undefined {
    return this.db
      .prepare('SELECT * FROM profiles WHERE id = ?')
      .get(profileId) as ReturnType<CloudSync['getProfileRow']>;
  }

  /**
   * Gets the local version of a profile based on its updated_at timestamp.
   * Returns a numeric hash of the timestamp for version comparison.
   */
  private getLocalVersion(profileId: string): number {
    const row = this.db
      .prepare('SELECT updated_at FROM profiles WHERE id = ?')
      .get(profileId) as { updated_at: string } | undefined;

    if (!row) return 0;
    return new Date(row.updated_at).getTime();
  }

  /**
   * Updates the sync_status field for a profile in the local database.
   */
  private updateSyncStatus(profileId: string, status: SyncStatus | null): void {
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE profiles SET sync_status = ?, updated_at = ? WHERE id = ?')
      .run(status, now, profileId);
  }

  /**
   * Task 11.1: syncProfile()
   *
   * Encrypts and uploads profile data to cloud storage.
   *
   * Steps:
   * 1. Read profile data from local SQLite
   * 2. Check for conflicts (compare local vs remote version)
   * 3. If conflict detected, set sync_status to 'conflict' and return
   * 4. Encrypt data using AES-256-GCM
   * 5. Upload encrypted data via the cloud adapter
   * 6. Update sync_status to 'synced' in local DB
   * 7. Return SyncResult
   */
  async syncProfile(profileId: string): Promise<SyncResult> {
    const row = this.getProfileRow(profileId);
    if (!row) {
      const error = new Error(`Profile not found: ${profileId}`);
      (error as Error & { code: number }).code = AppErrorCode.PROFILE_NOT_FOUND;
      throw error;
    }

    // Check for existing checkpoint (resume sync)
    const checkpoint = this.checkpoints.get(profileId);
    if (checkpoint) {
      return this.resumeSync(profileId);
    }

    // Serialize profile data to JSON
    const profileData = {
      id: row.id,
      name: row.name,
      browserType: row.browser_type,
      ownerId: row.owner_id,
      status: row.status,
      fingerprintConfig: row.fingerprint_config ? JSON.parse(row.fingerprint_config) : null,
      proxyId: row.proxy_id,
      syncEnabled: row.sync_enabled === 1,
      lastUsedAt: row.last_used_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    const plaintext = Buffer.from(JSON.stringify(profileData), 'utf-8');

    // Task 11.4: Conflict detection — compare local version with remote version
    const localVersion = this.getLocalVersion(profileId);
    let remoteVersion: number;
    try {
      remoteVersion = await this.adapter.getVersion(profileId);
    } catch {
      const error = new Error(`Network error during sync for profile: ${profileId}`);
      (error as Error & { code: number }).code = AppErrorCode.SYNC_NETWORK_ERROR;
      this.updateSyncStatus(profileId, 'error');
      throw error;
    }

    // If remote version is newer than what we last synced, there's a conflict
    if (remoteVersion > 0 && remoteVersion > localVersion) {
      this.updateSyncStatus(profileId, 'conflict');
      return {
        success: false,
        conflict: true,
        bytesTransferred: 0,
      };
    }

    // Encrypt the profile data
    const encryptedData = this.encrypt(plaintext);

    // Save checkpoint before upload (Task 11.3: resume sync)
    this.checkpoints.set(profileId, {
      profileId,
      bytesTransferred: 0,
      totalBytes: encryptedData.length,
      encryptedData,
      timestamp: new Date().toISOString(),
    });

    try {
      // Upload encrypted data via the cloud adapter
      await this.adapter.upload(profileId, encryptedData);

      // Update remote version
      const newVersion = Date.now();
      await this.adapter.setVersion(profileId, newVersion);

      // Update local sync_status to 'synced'
      this.updateSyncStatus(profileId, 'synced');

      // Clear checkpoint on success
      this.checkpoints.delete(profileId);

      return {
        success: true,
        conflict: false,
        bytesTransferred: encryptedData.length,
      };
    } catch {
      // Keep checkpoint for resume (Task 11.3)
      this.updateSyncStatus(profileId, 'error');
      const error = new Error(`Network error during sync upload for profile: ${profileId}`);
      (error as Error & { code: number }).code = AppErrorCode.SYNC_NETWORK_ERROR;
      throw error;
    }
  }

  /**
   * Task 11.2: downloadProfile()
   *
   * Downloads and decrypts profile data from cloud, restores fingerprint config.
   *
   * Steps:
   * 1. Download encrypted data via cloud adapter
   * 2. Decrypt data using AES-256-GCM
   * 3. Parse JSON and restore profile config including fingerprint
   * 4. Return Profile object
   */
  async downloadProfile(profileId: string): Promise<Profile> {
    let remoteData: { data: Buffer; version: number } | null;
    try {
      remoteData = await this.adapter.download(profileId);
    } catch {
      const error = new Error(`Network error during download for profile: ${profileId}`);
      (error as Error & { code: number }).code = AppErrorCode.SYNC_NETWORK_ERROR;
      throw error;
    }

    if (!remoteData) {
      const error = new Error(`Profile not found in cloud: ${profileId}`);
      (error as Error & { code: number }).code = AppErrorCode.PROFILE_NOT_FOUND;
      throw error;
    }

    // Decrypt the data
    const decrypted = this.decrypt(remoteData.data);
    const profileData = JSON.parse(decrypted.toString('utf-8'));

    // Restore profile in local database
    const now = new Date().toISOString();
    const existingRow = this.getProfileRow(profileId);

    if (existingRow) {
      // Update existing profile with remote data
      this.db
        .prepare(`
          UPDATE profiles
          SET name = ?, browser_type = ?, fingerprint_config = ?,
              proxy_id = ?, sync_status = 'synced', updated_at = ?
          WHERE id = ?
        `)
        .run(
          profileData.name,
          profileData.browserType,
          profileData.fingerprintConfig ? JSON.stringify(profileData.fingerprintConfig) : null,
          profileData.proxyId || null,
          now,
          profileId,
        );
    } else {
      // Insert new profile from remote data
      this.db
        .prepare(`
          INSERT INTO profiles (id, name, browser_type, owner_id, status, fingerprint_config,
                                proxy_id, sync_enabled, sync_status, last_used_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'closed', ?, NULL, 1, 'synced', NULL, ?, ?)
        `)
        .run(
          profileId,
          profileData.name,
          profileData.browserType,
          profileData.ownerId,
          profileData.fingerprintConfig ? JSON.stringify(profileData.fingerprintConfig) : null,
          profileData.createdAt || now,
          now,
        );
    }

    // Build and return the Profile object
    const profile: Profile = {
      id: profileId,
      name: profileData.name,
      browserType: profileData.browserType,
      ownerId: profileData.ownerId,
      status: 'closed',
      fingerprintConfig: profileData.fingerprintConfig,
      proxyId: profileData.proxyId || null,
      syncEnabled: true,
      syncStatus: 'synced',
      lastUsedAt: profileData.lastUsedAt || null,
      createdAt: profileData.createdAt || now,
      updatedAt: now,
    };

    return profile;
  }

  /**
   * Task 11.3: Resume sync
   *
   * Continues a previously interrupted sync from the saved checkpoint.
   * If a checkpoint exists for the profile, uses the already-encrypted data
   * to retry the upload.
   */
  async resumeSync(profileId: string): Promise<SyncResult> {
    const checkpoint = this.checkpoints.get(profileId);
    if (!checkpoint) {
      // No checkpoint — perform a fresh sync
      this.checkpoints.delete(profileId); // ensure clean state
      return this.syncProfile(profileId);
    }

    try {
      // Retry upload with the saved encrypted data
      await this.adapter.upload(profileId, checkpoint.encryptedData);

      // Update remote version
      const newVersion = Date.now();
      await this.adapter.setVersion(profileId, newVersion);

      // Update local sync_status to 'synced'
      this.updateSyncStatus(profileId, 'synced');

      const bytesTransferred = checkpoint.totalBytes;

      // Clear checkpoint on success
      this.checkpoints.delete(profileId);

      return {
        success: true,
        conflict: false,
        bytesTransferred,
      };
    } catch {
      // Keep checkpoint for next retry
      this.updateSyncStatus(profileId, 'error');
      const error = new Error(`Resume sync failed for profile: ${profileId}`);
      (error as Error & { code: number }).code = AppErrorCode.SYNC_NETWORK_ERROR;
      throw error;
    }
  }

  /**
   * Task 11.4: getSyncStatus()
   *
   * Returns the current sync status of a profile.
   */
  async getSyncStatus(profileId: string): Promise<SyncStatus> {
    const row = this.db
      .prepare('SELECT sync_status FROM profiles WHERE id = ?')
      .get(profileId) as { sync_status: string | null } | undefined;

    if (!row) {
      const error = new Error(`Profile not found: ${profileId}`);
      (error as Error & { code: number }).code = AppErrorCode.PROFILE_NOT_FOUND;
      throw error;
    }

    return (row.sync_status as SyncStatus) || 'pending';
  }

  /**
   * Task 11.5: resolveConflict()
   *
   * Resolves a sync conflict by choosing either local or remote version.
   *
   * - 'local': overwrite remote with local data
   * - 'remote': overwrite local with remote data
   * - Clears conflict status after resolution
   */
  async resolveConflict(profileId: string, resolution: 'local' | 'remote'): Promise<void> {
    const row = this.getProfileRow(profileId);
    if (!row) {
      const error = new Error(`Profile not found: ${profileId}`);
      (error as Error & { code: number }).code = AppErrorCode.PROFILE_NOT_FOUND;
      throw error;
    }

    // Verify profile is actually in conflict state
    if (row.sync_status !== 'conflict') {
      const error = new Error(`Profile is not in conflict state: ${profileId}`);
      (error as Error & { code: number }).code = AppErrorCode.SYNC_CONFLICT;
      throw error;
    }

    if (resolution === 'local') {
      // Overwrite remote with local data: serialize, encrypt, upload
      const profileData = {
        id: row.id,
        name: row.name,
        browserType: row.browser_type,
        ownerId: row.owner_id,
        status: row.status,
        fingerprintConfig: row.fingerprint_config ? JSON.parse(row.fingerprint_config) : null,
        proxyId: row.proxy_id,
        syncEnabled: row.sync_enabled === 1,
        lastUsedAt: row.last_used_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };

      const plaintext = Buffer.from(JSON.stringify(profileData), 'utf-8');
      const encryptedData = this.encrypt(plaintext);

      await this.adapter.upload(profileId, encryptedData);
      const newVersion = Date.now();
      await this.adapter.setVersion(profileId, newVersion);

      // Clear conflict status
      this.updateSyncStatus(profileId, 'synced');
    } else {
      // resolution === 'remote': overwrite local with remote data
      const remoteData = await this.adapter.download(profileId);
      if (!remoteData) {
        const error = new Error(`Remote profile not found: ${profileId}`);
        (error as Error & { code: number }).code = AppErrorCode.PROFILE_NOT_FOUND;
        throw error;
      }

      const decrypted = this.decrypt(remoteData.data);
      const profileData = JSON.parse(decrypted.toString('utf-8'));

      const now = new Date().toISOString();
      this.db
        .prepare(`
          UPDATE profiles
          SET name = ?, browser_type = ?, fingerprint_config = ?,
              proxy_id = ?, sync_status = 'synced', updated_at = ?
          WHERE id = ?
        `)
        .run(
          profileData.name,
          profileData.browserType,
          profileData.fingerprintConfig ? JSON.stringify(profileData.fingerprintConfig) : null,
          profileData.proxyId || null,
          now,
          profileId,
        );
    }
  }

  /**
   * Returns whether a checkpoint exists for the given profile.
   * Useful for checking if a sync can be resumed.
   */
  hasCheckpoint(profileId: string): boolean {
    return this.checkpoints.has(profileId);
  }

  /**
   * Clears the checkpoint for a given profile.
   */
  clearCheckpoint(profileId: string): void {
    this.checkpoints.delete(profileId);
  }
}
