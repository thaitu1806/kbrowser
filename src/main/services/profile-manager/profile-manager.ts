/**
 * Profile Manager Service
 *
 * Quản lý vòng đời đầy đủ của hồ sơ trình duyệt:
 * tạo, sửa, xóa, mở, đóng hồ sơ với vùng lưu trữ cô lập
 * (Cookie, LocalStorage, IndexedDB, Cache).
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import { chromium, firefox } from 'playwright';
import type { BrowserContext } from 'playwright';
import type { ProfileConfig, Profile, ProfileSummary, BrowserConnection } from '../../../shared/types';
import { AppErrorCode } from '../../../shared/types';

/** Storage types that each profile gets isolated directories for. */
const STORAGE_TYPES = ['cookie', 'localstorage', 'indexeddb', 'cache'] as const;

/** Maps storage type to its subdirectory name within the profile directory. */
const STORAGE_DIR_NAMES: Record<typeof STORAGE_TYPES[number], string> = {
  cookie: 'cookies',
  localstorage: 'localstorage',
  indexeddb: 'indexeddb',
  cache: 'cache',
};

export class ProfileManager {
  private db: Database.Database;
  private basePath: string;
  private openBrowsers: Map<string, BrowserContext> = new Map();

  /**
   * @param db - A better-sqlite3 database instance (already initialized with schema).
   * @param basePath - Base directory for profile data storage.
   *   Profile directories will be created under `{basePath}/profiles/{profileId}/`.
   */
  constructor(db: Database.Database, basePath: string) {
    this.db = db;
    this.basePath = basePath;
  }

  /**
   * Creates a new browser profile with isolated storage areas.
   *
   * Steps:
   * 1. Generate a UUID for the profile ID
   * 2. Create the profile directory with subdirectories for each storage type
   * 3. Insert the profile record into the database
   * 4. Insert profile_data records for each storage type
   * 5. Return the created Profile object
   *
   * @param config - Profile configuration (name, browserType, fingerprint, proxy, extensions)
   * @param ownerId - The ID of the user creating the profile
   * @returns The created Profile object
   */
  async createProfile(config: ProfileConfig, ownerId: string): Promise<Profile> {
    const profileId = crypto.randomUUID();
    const now = new Date().toISOString();
    const profileDir = path.join(this.basePath, 'profiles', profileId);

    // Create profile directory and storage subdirectories
    fs.mkdirSync(profileDir, { recursive: true });
    for (const storageType of STORAGE_TYPES) {
      const subDir = path.join(profileDir, STORAGE_DIR_NAMES[storageType]);
      fs.mkdirSync(subDir, { recursive: true });
    }

    // Use a transaction to ensure atomicity of database operations
    const insertProfile = this.db.prepare(`
      INSERT INTO profiles (id, name, browser_type, owner_id, status, fingerprint_config, proxy_id, sync_enabled, sync_status, last_used_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'closed', ?, NULL, 0, NULL, NULL, ?, ?)
    `);

    const insertProfileData = this.db.prepare(`
      INSERT INTO profile_data (id, profile_id, data_type, data, updated_at)
      VALUES (?, ?, ?, NULL, ?)
    `);

    const transaction = this.db.transaction(() => {
      insertProfile.run(
        profileId,
        config.name,
        config.browserType,
        ownerId,
        JSON.stringify(config.fingerprint),
        now,
        now,
      );

      for (const storageType of STORAGE_TYPES) {
        const dataId = crypto.randomUUID();
        insertProfileData.run(dataId, profileId, storageType, now);
      }
    });

    transaction();

    const profile: Profile = {
      id: profileId,
      name: config.name,
      browserType: config.browserType,
      ownerId,
      status: 'closed',
      fingerprintConfig: config.fingerprint,
      proxyId: null,
      syncEnabled: false,
      syncStatus: null,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    return profile;
  }

  /**
   * Returns the directory path for a given profile.
   */
  getProfileDir(profileId: string): string {
    return path.join(this.basePath, 'profiles', profileId);
  }

  /**
   * Opens a browser profile by launching a Playwright browser server
   * with the profile's isolated data directory.
   *
   * Steps:
   * 1. Look up the profile in the database
   * 2. Verify the profile exists (throw PROFILE_NOT_FOUND if not)
   * 3. Verify the profile is not already open (throw PROFILE_ALREADY_OPEN if so)
   * 4. Launch a Playwright browser server with the profile's data directory
   * 5. Update profile status to 'open' and last_used_at in the database
   * 6. Track the browser server instance for later cleanup
   * 7. Return BrowserConnection with wsEndpoint and profileId
   *
   * @param profileId - The ID of the profile to open
   * @returns BrowserConnection with WebSocket endpoint for external automation tools
   * @throws Error with code PROFILE_NOT_FOUND if profile doesn't exist
   * @throws Error with code PROFILE_ALREADY_OPEN if profile is already open
   */
  async openProfile(profileId: string): Promise<BrowserConnection> {
    // Look up the profile in the database
    const row = this.db
      .prepare('SELECT id, name, browser_type, status, fingerprint_config FROM profiles WHERE id = ?')
      .get(profileId) as { id: string; name: string; browser_type: string; status: string; fingerprint_config: string | null } | undefined;

    if (!row) {
      const error = new Error(`Profile not found: ${profileId}`);
      (error as Error & { code: number }).code = AppErrorCode.PROFILE_NOT_FOUND;
      throw error;
    }

    if (row.status === 'open' || this.openBrowsers.has(profileId)) {
      const error = new Error(`Profile is already open: ${profileId}`);
      (error as Error & { code: number }).code = AppErrorCode.PROFILE_ALREADY_OPEN;
      throw error;
    }

    // Get the profile's data directory for isolated browser storage
    const profileDir = this.getProfileDir(profileId);
    fs.mkdirSync(profileDir, { recursive: true });

    // Select the browser type based on profile configuration
    const browserType = row.browser_type === 'firefox' ? firefox : chromium;

    // Launch persistent browser context with isolated user data dir
    const context = await browserType.launchPersistentContext(profileDir, {
      headless: false,
      args: row.browser_type === 'firefox'
        ? []
        : [
            '--disable-blink-features=AutomationControlled',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-infobars',
            '--disable-notifications',
            '--no-sandbox',
            '--disable-gpu-sandbox',
            '--disable-component-update',
            '--disable-background-networking',
            '--disable-dev-shm-usage',
          ],
      viewport: null,
      ignoreDefaultArgs: ['--enable-automation'],
      env: {
        ...process.env,
        GOOGLE_API_KEY: 'no',
        GOOGLE_DEFAULT_CLIENT_ID: 'no',
        GOOGLE_DEFAULT_CLIENT_SECRET: 'no',
      },
    });

    // Get the browser's CDP endpoint for external tools
    const browser = context.browser();
    const wsEndpoint = browser ? `ws://127.0.0.1:0/profile/${profileId}` : `ws://127.0.0.1:0/profile/${profileId}`;

    // Update profile status and last_used_at in the database
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE profiles SET status = ?, last_used_at = ?, updated_at = ? WHERE id = ?')
      .run('open', now, now, profileId);

    // Track the browser context for later cleanup
    this.openBrowsers.set(profileId, context);

    return {
      wsEndpoint,
      profileId,
    };
  }

  /**
   * Closes a browser profile by stopping the Playwright browser server,
   * updating the profile status to 'closed' in the database, and removing
   * the browser from the tracking Map.
   *
   * Steps:
   * 1. Look up the profile in the database
   * 2. Throw PROFILE_NOT_FOUND if not found
   * 3. If the profile is already closed and not tracked, return gracefully
   * 4. Close the browser server if it exists in the tracking Map
   * 5. Update profile status to 'closed' in the database
   * 6. Remove the browser server from the tracking Map
   *
   * @param profileId - The ID of the profile to close
   * @throws Error with code PROFILE_NOT_FOUND if profile doesn't exist
   */
  async closeProfile(profileId: string): Promise<void> {
    // Look up the profile in the database
    const row = this.db
      .prepare('SELECT id, status FROM profiles WHERE id = ?')
      .get(profileId) as { id: string; status: string } | undefined;

    if (!row) {
      const error = new Error(`Profile not found: ${profileId}`);
      (error as Error & { code: number }).code = AppErrorCode.PROFILE_NOT_FOUND;
      throw error;
    }

    // Get the browser context from the tracking Map
    const context = this.openBrowsers.get(profileId);

    // If the browser context exists, close it
    if (context) {
      await context.close();
    }

    // Update profile status to 'closed' in the database
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE profiles SET status = ?, updated_at = ? WHERE id = ?')
      .run('closed', now, profileId);

    // Remove from the tracking Map
    this.openBrowsers.delete(profileId);
  }

  /**
   * Deletes a browser profile and all its associated isolated data.
   *
   * Steps:
   * 1. Look up the profile in the database
   * 2. Throw PROFILE_NOT_FOUND if not found
   * 3. If the profile is currently open, close it first
   * 4. Delete the profile record from the database (CASCADE handles profile_data,
   *    profile_extensions, profile_access, rotation_configs)
   * 5. Delete the profile directory from the filesystem (recursive)
   *
   * @param profileId - The ID of the profile to delete
   * @throws Error with code PROFILE_NOT_FOUND if profile doesn't exist
   */
  async deleteProfile(profileId: string): Promise<void> {
    // Look up the profile in the database
    const row = this.db
      .prepare('SELECT id, status FROM profiles WHERE id = ?')
      .get(profileId) as { id: string; status: string } | undefined;

    if (!row) {
      const error = new Error(`Profile not found: ${profileId}`);
      (error as Error & { code: number }).code = AppErrorCode.PROFILE_NOT_FOUND;
      throw error;
    }

    // If the profile is currently open, close it first
    if (this.openBrowsers.has(profileId)) {
      await this.closeProfile(profileId);
    }

    // Delete the profile record from the database
    // CASCADE will handle: profile_data, profile_extensions, profile_access, rotation_configs
    this.db.prepare('DELETE FROM profiles WHERE id = ?').run(profileId);

    // Delete the profile directory from the filesystem
    const profileDir = this.getProfileDir(profileId);
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {
      // Directory may not exist (e.g., already cleaned up); ignore errors
    }
  }

  /**
   * Updates a browser profile's configuration with partial changes.
   *
   * Steps:
   * 1. Look up the profile in the database
   * 2. Throw PROFILE_NOT_FOUND if not found
   * 3. Update only the fields provided in the partial config (name, browserType, fingerprint)
   * 4. Update the updated_at timestamp
   * 5. Return the full updated Profile object
   *
   * @param profileId - The ID of the profile to update
   * @param config - Partial profile configuration with fields to update
   * @returns The updated Profile object
   * @throws Error with code PROFILE_NOT_FOUND if profile doesn't exist
   */
  async updateProfile(profileId: string, config: Partial<ProfileConfig>): Promise<Profile> {
    // Look up the profile in the database
    const row = this.db
      .prepare('SELECT * FROM profiles WHERE id = ?')
      .get(profileId) as {
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
      } | undefined;

    if (!row) {
      const error = new Error(`Profile not found: ${profileId}`);
      (error as Error & { code: number }).code = AppErrorCode.PROFILE_NOT_FOUND;
      throw error;
    }

    const now = new Date().toISOString();

    // Build the update fields based on what's provided
    const updates: string[] = [];
    const params: unknown[] = [];

    if (config.name !== undefined) {
      updates.push('name = ?');
      params.push(config.name);
    }

    if (config.browserType !== undefined) {
      updates.push('browser_type = ?');
      params.push(config.browserType);
    }

    if (config.fingerprint !== undefined) {
      updates.push('fingerprint_config = ?');
      params.push(JSON.stringify(config.fingerprint));
    }

    // Always update updated_at
    updates.push('updated_at = ?');
    params.push(now);

    // Add profileId as the last parameter for the WHERE clause
    params.push(profileId);

    this.db
      .prepare(`UPDATE profiles SET ${updates.join(', ')} WHERE id = ?`)
      .run(...params);

    // Read back the updated row to return the full Profile object
    const updatedRow = this.db
      .prepare('SELECT * FROM profiles WHERE id = ?')
      .get(profileId) as {
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
      };

    const profile: Profile = {
      id: updatedRow.id,
      name: updatedRow.name,
      browserType: updatedRow.browser_type as 'chromium' | 'firefox',
      ownerId: updatedRow.owner_id,
      status: updatedRow.status as 'open' | 'closed',
      fingerprintConfig: updatedRow.fingerprint_config
        ? JSON.parse(updatedRow.fingerprint_config)
        : null,
      proxyId: updatedRow.proxy_id,
      syncEnabled: updatedRow.sync_enabled === 1,
      syncStatus: updatedRow.sync_status,
      lastUsedAt: updatedRow.last_used_at,
      createdAt: updatedRow.created_at,
      updatedAt: updatedRow.updated_at,
    };

    return profile;
  }

  /**
   * Returns a summary list of all profiles in the database.
   *
   * Each summary includes: id, name, status, browserType, proxyAssigned (proxy_id),
   * and lastUsedAt.
   *
   * @returns Array of ProfileSummary objects
   */
  async listProfiles(): Promise<ProfileSummary[]> {
    const rows = this.db
      .prepare('SELECT id, name, status, browser_type, proxy_id, last_used_at FROM profiles')
      .all() as Array<{
        id: string;
        name: string;
        status: string;
        browser_type: string;
        proxy_id: string | null;
        last_used_at: string | null;
      }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status as 'open' | 'closed',
      browserType: row.browser_type as 'chromium' | 'firefox',
      proxyAssigned: row.proxy_id,
      lastUsedAt: row.last_used_at,
    }));
  }

  /**
   * Returns whether a profile's browser is currently tracked as open.
   */
  isProfileOpen(profileId: string): boolean {
    return this.openBrowsers.has(profileId);
  }
}
