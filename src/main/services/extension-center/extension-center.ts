/**
 * Extension Center Service
 *
 * Quản lý tập trung tiện ích mở rộng trình duyệt:
 * tải lên, tải từ Chrome Web Store, gán cho nhóm hồ sơ,
 * xác thực file .zip và tự động cài đặt.
 */

import crypto from 'crypto';
import type Database from 'better-sqlite3';
import type { Extension } from '../../../shared/types';
import { AppErrorCode } from '../../../shared/types';

/** ZIP magic bytes: PK\x03\x04 */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** Chrome Web Store URL pattern */
const CHROME_STORE_REGEX =
  /^https:\/\/chromewebstore\.google\.com\/detail\/([^/]+)\/([a-z]{32})$/;

/**
 * Optional downloader function signature for downloadFromStore.
 * Accepts a Chrome Web Store URL and returns the extension file buffer.
 * Injected for testability — production code can supply a real HTTP downloader.
 */
export type StoreDownloader = (url: string) => Promise<Buffer>;

export class ExtensionCenter {
  private db: Database.Database;

  /**
   * @param db - A better-sqlite3 database instance (already initialized with schema).
   */
  constructor(db: Database.Database) {
    this.db = db;
  }

  // ─── uploadExtension (Task 10.1) ──────────────────────────────────────────

  /**
   * Validates a .zip file and stores the extension in the database.
   *
   * Steps:
   * 1. Validate the buffer starts with ZIP magic bytes (PK\x03\x04)
   * 2. Extract name and version from the filename heuristic
   * 3. Insert into extensions table with source='upload'
   * 4. Return the Extension object
   *
   * @param file - The raw file buffer
   * @param filename - Original filename (e.g. "ublock-origin-1.52.0.zip")
   * @throws Error with code INVALID_EXTENSION_FORMAT if not a valid .zip
   */
  async uploadExtension(file: Buffer, filename: string): Promise<Extension> {
    // Validate ZIP magic bytes
    if (file.length < 4 || !file.subarray(0, 4).equals(ZIP_MAGIC)) {
      const err = new Error('Invalid extension format: file is not a valid .zip archive');
      (err as Error & { code: number }).code = AppErrorCode.INVALID_EXTENSION_FORMAT;
      throw err;
    }

    const { name, version } = this.parseFilename(filename);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO extensions (id, name, version, source, file_data, uploaded_at)
         VALUES (?, ?, ?, 'upload', ?, ?)`,
      )
      .run(id, name, version, file, now);

    return {
      id,
      name,
      version,
      source: 'upload',
      assignedProfiles: [],
    };
  }

  // ─── downloadFromStore (Task 10.2) ────────────────────────────────────────

  /**
   * Downloads an extension from a Chrome Web Store URL.
   *
   * Steps:
   * 1. Validate the URL matches the Chrome Web Store pattern
   * 2. If a downloader function is provided, call it to get the file buffer
   * 3. Otherwise create a placeholder entry (actual download requires HTTP client)
   * 4. Store in extensions table with source='store'
   *
   * @param storeUrl - Chrome Web Store URL
   * @param downloader - Optional function to actually download the extension
   * @throws Error with code INVALID_EXTENSION_FORMAT if URL is not a valid Chrome Web Store URL
   */
  async downloadFromStore(
    storeUrl: string,
    downloader?: StoreDownloader,
  ): Promise<Extension> {
    const match = storeUrl.match(CHROME_STORE_REGEX);
    if (!match) {
      const err = new Error(
        'Invalid Chrome Web Store URL. Expected format: https://chromewebstore.google.com/detail/<name>/<id>',
      );
      (err as Error & { code: number }).code = AppErrorCode.INVALID_EXTENSION_FORMAT;
      throw err;
    }

    const extensionSlug = match[1];
    const name = extensionSlug.replace(/-/g, ' ');

    let fileData: Buffer | null = null;
    if (downloader) {
      fileData = await downloader(storeUrl);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO extensions (id, name, version, source, file_data, uploaded_at)
         VALUES (?, ?, '1.0.0', 'store', ?, ?)`,
      )
      .run(id, name, fileData, now);

    return {
      id,
      name,
      version: '1.0.0',
      source: 'store',
      assignedProfiles: [],
    };
  }

  // ─── assignToProfiles (Task 10.3) ─────────────────────────────────────────

  /**
   * Assigns an extension to one or more profiles.
   * Uses INSERT OR IGNORE to skip duplicates.
   *
   * @param extensionId - The extension ID
   * @param profileIds - Array of profile IDs to assign the extension to
   */
  async assignToProfiles(
    extensionId: string,
    profileIds: string[],
  ): Promise<void> {
    // Verify extension exists
    const ext = this.db
      .prepare('SELECT id FROM extensions WHERE id = ?')
      .get(extensionId);
    if (!ext) {
      const err = new Error(`Extension not found: ${extensionId}`);
      (err as Error & { code: number }).code = AppErrorCode.EXTENSION_INSTALL_FAILED;
      throw err;
    }

    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO profile_extensions (profile_id, extension_id) VALUES (?, ?)',
    );

    const assignAll = this.db.transaction((ids: string[]) => {
      for (const profileId of ids) {
        insert.run(profileId, extensionId);
      }
    });

    assignAll(profileIds);
  }

  // ─── removeExtension (Task 10.4) ──────────────────────────────────────────

  /**
   * Removes an extension from the store and all assigned profiles.
   * The CASCADE on profile_extensions handles cleanup automatically.
   *
   * @param extensionId - The extension ID to remove
   */
  async removeExtension(extensionId: string): Promise<void> {
    this.db
      .prepare('DELETE FROM extensions WHERE id = ?')
      .run(extensionId);
  }

  // ─── getExtensionsForProfile (Task 10.5) ──────────────────────────────────

  /**
   * Returns all extensions assigned to a specific profile.
   * Used by ProfileManager when launching a browser to ensure
   * all assigned extensions are installed.
   *
   * @param profileId - The profile ID
   * @returns Array of Extension objects assigned to the profile
   */
  async getExtensionsForProfile(profileId: string): Promise<Extension[]> {
    const rows = this.db
      .prepare(
        `SELECT e.id, e.name, e.version, e.source
         FROM extensions e
         INNER JOIN profile_extensions pe ON pe.extension_id = e.id
         WHERE pe.profile_id = ?`,
      )
      .all(profileId) as Array<{
      id: string;
      name: string;
      version: string;
      source: 'upload' | 'store';
    }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      version: row.version,
      source: row.source,
      assignedProfiles: this.getAssignedProfileIds(row.id),
    }));
  }

  // ─── listExtensions ───────────────────────────────────────────────────────

  /**
   * Lists all extensions in the store with their assigned profiles.
   *
   * @returns Array of all Extension objects
   */
  async listExtensions(): Promise<Extension[]> {
    const rows = this.db
      .prepare('SELECT id, name, version, source FROM extensions')
      .all() as Array<{
      id: string;
      name: string;
      version: string;
      source: 'upload' | 'store';
    }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      version: row.version,
      source: row.source,
      assignedProfiles: this.getAssignedProfileIds(row.id),
    }));
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Parses a filename to extract extension name and version.
   * Heuristic: "some-extension-1.2.3.zip" → name="some-extension", version="1.2.3"
   * Falls back to the full basename as name and "1.0.0" as version.
   */
  private parseFilename(filename: string): { name: string; version: string } {
    // Strip .zip extension
    const base = filename.replace(/\.zip$/i, '');

    // Try to match a version pattern at the end: name-1.2.3 or name-1.2
    const versionMatch = base.match(/^(.+?)-(\d+\.\d+(?:\.\d+)?)$/);
    if (versionMatch) {
      return {
        name: versionMatch[1],
        version: versionMatch[2],
      };
    }

    return { name: base, version: '1.0.0' };
  }

  /**
   * Returns the list of profile IDs assigned to a given extension.
   */
  private getAssignedProfileIds(extensionId: string): string[] {
    const rows = this.db
      .prepare('SELECT profile_id FROM profile_extensions WHERE extension_id = ?')
      .all(extensionId) as Array<{ profile_id: string }>;

    return rows.map((r) => r.profile_id);
  }
}
