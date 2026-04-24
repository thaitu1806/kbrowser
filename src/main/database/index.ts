/**
 * Database initialization and connection management.
 * Uses better-sqlite3 for synchronous SQLite access in the Electron main process.
 */

import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import { SCHEMA_SQL } from './schema';

let db: Database.Database | null = null;

/**
 * Returns the path to the database file in the app's user data directory.
 * In test environments, this can be overridden.
 */
export function getDatabasePath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'digital-identity.db');
}

/**
 * Initializes and returns the SQLite database connection.
 * - Creates the database file in the app's user data directory if it doesn't exist.
 * - Enables WAL mode for better concurrent read performance.
 * - Enables foreign key enforcement.
 * - Creates all tables if they don't exist.
 *
 * Subsequent calls return the same database instance (singleton).
 */
export function getDatabase(): Database.Database {
  if (db) {
    return db;
  }

  const dbPath = getDatabasePath();
  db = new Database(dbPath);

  // Enable WAL mode for better performance
  db.pragma('journal_mode = WAL');

  // Enable foreign key constraints
  db.pragma('foreign_keys = ON');

  // Create all tables
  db.exec(SCHEMA_SQL);

  // Run migrations
  runMigrations(db);

  return db;
}

/**
 * Runs safe migrations that can't be expressed in CREATE TABLE IF NOT EXISTS.
 * Each migration checks if it's needed before applying.
 */
function runMigrations(instance: Database.Database): void {
  // Add deleted_at column for soft delete (trash feature)
  const columns = instance.pragma('table_info(profiles)') as Array<{ name: string }>;
  if (!columns.some((c) => c.name === 'deleted_at')) {
    instance.exec('ALTER TABLE profiles ADD COLUMN deleted_at TEXT DEFAULT NULL');
  }
}

/**
 * Initializes and returns a database connection at a custom path.
 * Useful for testing or when the Electron app context is not available.
 */
export function initializeDatabase(dbPath: string): Database.Database {
  const instance = new Database(dbPath);

  // Enable WAL mode for better performance
  instance.pragma('journal_mode = WAL');

  // Enable foreign key constraints
  instance.pragma('foreign_keys = ON');

  // Create all tables
  instance.exec(SCHEMA_SQL);

  // Run migrations
  runMigrations(instance);

  return instance;
}

/**
 * Closes the database connection and resets the singleton.
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
