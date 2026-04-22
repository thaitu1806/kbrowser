import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { initializeDatabase } from '../../../database/index';
import { ActionLogger } from '../action-logger';
import type { Role } from '../../../../shared/types';

/** Helper: create a user in the database and return the user ID. */
function createTestUser(
  db: Database.Database,
  username: string,
  role: Role = 'admin',
): string {
  const userId = `user-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
     VALUES (?, ?, 'hash', ?, ?, ?)`,
  ).run(userId, username, role, now, now);
  return userId;
}

/** Helper: create a fresh database and ActionLogger for each test. */
function setupTestDb() {
  const dbPath = path.join(
    os.tmpdir(),
    `test-action-logger-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  const db = initializeDatabase(dbPath);
  const logger = new ActionLogger(db);
  return { db, dbPath, logger };
}

function cleanupTestDb(db: Database.Database, dbPath: string) {
  db.close();
  try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
  try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
  try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
}

// ─── ActionLogger.log() ─────────────────────────────────────────────────────

describe('ActionLogger.log', () => {
  let db: Database.Database;
  let dbPath: string;
  let logger: ActionLogger;

  beforeEach(() => {
    ({ db, dbPath, logger } = setupTestDb());
  });

  afterEach(() => {
    cleanupTestDb(db, dbPath);
  });

  it('should insert a log entry with all required fields', async () => {
    const userId = createTestUser(db, 'alice');

    await logger.log({
      userId,
      username: 'alice',
      action: 'open_profile',
      profileId: 'profile-1',
      details: { browser: 'chromium' },
      timestamp: '2024-01-15T10:00:00.000Z',
    });

    const row = db.prepare('SELECT * FROM action_logs WHERE user_id = ?').get(userId) as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.username).toBe('alice');
    expect(row.action).toBe('open_profile');
    expect(row.profile_id).toBe('profile-1');
    expect(row.timestamp).toBe('2024-01-15T10:00:00.000Z');
    expect(JSON.parse(row.details as string)).toEqual({ browser: 'chromium' });
  });

  it('should generate a UUID for the log entry id', async () => {
    const userId = createTestUser(db, 'bob');

    await logger.log({
      userId,
      username: 'bob',
      action: 'create_profile',
      details: {},
      timestamp: '2024-01-15T10:00:00.000Z',
    });

    const row = db.prepare('SELECT id FROM action_logs WHERE user_id = ?').get(userId) as { id: string };
    expect(row.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('should handle null profileId', async () => {
    const userId = createTestUser(db, 'charlie');

    await logger.log({
      userId,
      username: 'charlie',
      action: 'login',
      details: {},
      timestamp: '2024-01-15T10:00:00.000Z',
    });

    const row = db.prepare('SELECT profile_id FROM action_logs WHERE user_id = ?').get(userId) as { profile_id: string | null };
    expect(row.profile_id).toBeNull();
  });

  it('should serialize details object as JSON', async () => {
    const userId = createTestUser(db, 'dave');

    await logger.log({
      userId,
      username: 'dave',
      action: 'edit_profile',
      profileId: 'p-1',
      details: { field: 'name', oldValue: 'old', newValue: 'new' },
      timestamp: '2024-01-15T10:00:00.000Z',
    });

    const row = db.prepare('SELECT details FROM action_logs WHERE user_id = ?').get(userId) as { details: string };
    const parsed = JSON.parse(row.details);
    expect(parsed.field).toBe('name');
    expect(parsed.oldValue).toBe('old');
    expect(parsed.newValue).toBe('new');
  });

  it('should allow logging multiple entries for the same user', async () => {
    const userId = createTestUser(db, 'eve');

    await logger.log({
      userId,
      username: 'eve',
      action: 'open_profile',
      details: {},
      timestamp: '2024-01-15T10:00:00.000Z',
    });
    await logger.log({
      userId,
      username: 'eve',
      action: 'close_profile',
      details: {},
      timestamp: '2024-01-15T10:01:00.000Z',
    });

    const rows = db.prepare('SELECT * FROM action_logs WHERE user_id = ?').all(userId);
    expect(rows).toHaveLength(2);
  });
});

// ─── ActionLogger.query() ───────────────────────────────────────────────────

describe('ActionLogger.query', () => {
  let db: Database.Database;
  let dbPath: string;
  let logger: ActionLogger;

  beforeEach(() => {
    ({ db, dbPath, logger } = setupTestDb());
  });

  afterEach(() => {
    cleanupTestDb(db, dbPath);
  });

  it('should return all logs when no filter is applied', async () => {
    const userId = createTestUser(db, 'alice');

    await logger.log({ userId, username: 'alice', action: 'open', details: {}, timestamp: '2024-01-15T10:00:00.000Z' });
    await logger.log({ userId, username: 'alice', action: 'close', details: {}, timestamp: '2024-01-15T10:01:00.000Z' });

    const results = await logger.query({});
    expect(results).toHaveLength(2);
  });

  it('should filter by userId', async () => {
    const userId1 = createTestUser(db, 'alice');
    const userId2 = createTestUser(db, 'bob');

    await logger.log({ userId: userId1, username: 'alice', action: 'open', details: {}, timestamp: '2024-01-15T10:00:00.000Z' });
    await logger.log({ userId: userId2, username: 'bob', action: 'open', details: {}, timestamp: '2024-01-15T10:01:00.000Z' });

    const results = await logger.query({ userId: userId1 });
    expect(results).toHaveLength(1);
    expect(results[0].username).toBe('alice');
  });

  it('should filter by action', async () => {
    const userId = createTestUser(db, 'alice');

    await logger.log({ userId, username: 'alice', action: 'open', details: {}, timestamp: '2024-01-15T10:00:00.000Z' });
    await logger.log({ userId, username: 'alice', action: 'close', details: {}, timestamp: '2024-01-15T10:01:00.000Z' });
    await logger.log({ userId, username: 'alice', action: 'open', details: {}, timestamp: '2024-01-15T10:02:00.000Z' });

    const results = await logger.query({ action: 'open' });
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.action === 'open')).toBe(true);
  });

  it('should filter by startDate', async () => {
    const userId = createTestUser(db, 'alice');

    await logger.log({ userId, username: 'alice', action: 'a1', details: {}, timestamp: '2024-01-10T10:00:00.000Z' });
    await logger.log({ userId, username: 'alice', action: 'a2', details: {}, timestamp: '2024-01-15T10:00:00.000Z' });
    await logger.log({ userId, username: 'alice', action: 'a3', details: {}, timestamp: '2024-01-20T10:00:00.000Z' });

    const results = await logger.query({ startDate: '2024-01-15T00:00:00.000Z' });
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.timestamp >= '2024-01-15T00:00:00.000Z')).toBe(true);
  });

  it('should filter by endDate', async () => {
    const userId = createTestUser(db, 'alice');

    await logger.log({ userId, username: 'alice', action: 'a1', details: {}, timestamp: '2024-01-10T10:00:00.000Z' });
    await logger.log({ userId, username: 'alice', action: 'a2', details: {}, timestamp: '2024-01-15T10:00:00.000Z' });
    await logger.log({ userId, username: 'alice', action: 'a3', details: {}, timestamp: '2024-01-20T10:00:00.000Z' });

    const results = await logger.query({ endDate: '2024-01-15T23:59:59.999Z' });
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.timestamp <= '2024-01-15T23:59:59.999Z')).toBe(true);
  });

  it('should filter by date range (startDate + endDate)', async () => {
    const userId = createTestUser(db, 'alice');

    await logger.log({ userId, username: 'alice', action: 'a1', details: {}, timestamp: '2024-01-10T10:00:00.000Z' });
    await logger.log({ userId, username: 'alice', action: 'a2', details: {}, timestamp: '2024-01-15T10:00:00.000Z' });
    await logger.log({ userId, username: 'alice', action: 'a3', details: {}, timestamp: '2024-01-20T10:00:00.000Z' });

    const results = await logger.query({
      startDate: '2024-01-12T00:00:00.000Z',
      endDate: '2024-01-18T00:00:00.000Z',
    });
    expect(results).toHaveLength(1);
    expect(results[0].action).toBe('a2');
  });

  it('should support limit and offset for pagination', async () => {
    const userId = createTestUser(db, 'alice');

    for (let i = 0; i < 5; i++) {
      await logger.log({
        userId,
        username: 'alice',
        action: `action-${i}`,
        details: {},
        timestamp: `2024-01-${String(15 + i).padStart(2, '0')}T10:00:00.000Z`,
      });
    }

    // Get first 2 (ordered by timestamp DESC, so newest first)
    const page1 = await logger.query({ limit: 2, offset: 0 });
    expect(page1).toHaveLength(2);

    // Get next 2
    const page2 = await logger.query({ limit: 2, offset: 2 });
    expect(page2).toHaveLength(2);

    // No overlap between pages
    const page1Ids = page1.map((r) => r.id);
    const page2Ids = page2.map((r) => r.id);
    expect(page1Ids.some((id) => page2Ids.includes(id))).toBe(false);
  });

  it('should return results ordered by timestamp descending', async () => {
    const userId = createTestUser(db, 'alice');

    await logger.log({ userId, username: 'alice', action: 'first', details: {}, timestamp: '2024-01-10T10:00:00.000Z' });
    await logger.log({ userId, username: 'alice', action: 'second', details: {}, timestamp: '2024-01-15T10:00:00.000Z' });
    await logger.log({ userId, username: 'alice', action: 'third', details: {}, timestamp: '2024-01-20T10:00:00.000Z' });

    const results = await logger.query({});
    expect(results[0].action).toBe('third');
    expect(results[1].action).toBe('second');
    expect(results[2].action).toBe('first');
  });

  it('should deserialize details JSON back to object', async () => {
    const userId = createTestUser(db, 'alice');

    await logger.log({
      userId,
      username: 'alice',
      action: 'edit',
      details: { key: 'value', nested: { a: 1 } },
      timestamp: '2024-01-15T10:00:00.000Z',
    });

    const results = await logger.query({});
    expect(results[0].details).toEqual({ key: 'value', nested: { a: 1 } });
  });

  it('should return empty array when no logs match', async () => {
    const results = await logger.query({ userId: 'non-existent' });
    expect(results).toEqual([]);
  });

  it('should combine multiple filters', async () => {
    const userId1 = createTestUser(db, 'alice');
    const userId2 = createTestUser(db, 'bob');

    await logger.log({ userId: userId1, username: 'alice', action: 'open', details: {}, timestamp: '2024-01-15T10:00:00.000Z' });
    await logger.log({ userId: userId1, username: 'alice', action: 'close', details: {}, timestamp: '2024-01-15T11:00:00.000Z' });
    await logger.log({ userId: userId2, username: 'bob', action: 'open', details: {}, timestamp: '2024-01-15T12:00:00.000Z' });

    const results = await logger.query({ userId: userId1, action: 'open' });
    expect(results).toHaveLength(1);
    expect(results[0].username).toBe('alice');
    expect(results[0].action).toBe('open');
  });
});

// ─── Role-based log access ──────────────────────────────────────────────────

describe('ActionLogger role-based access', () => {
  let db: Database.Database;
  let dbPath: string;
  let logger: ActionLogger;

  beforeEach(() => {
    ({ db, dbPath, logger } = setupTestDb());
  });

  afterEach(() => {
    cleanupTestDb(db, dbPath);
  });

  it('should allow admin to see all logs', async () => {
    const userId1 = createTestUser(db, 'alice', 'admin');
    const userId2 = createTestUser(db, 'bob', 'user');

    await logger.log({ userId: userId1, username: 'alice', action: 'open', details: {}, timestamp: '2024-01-15T10:00:00.000Z' });
    await logger.log({ userId: userId2, username: 'bob', action: 'close', details: {}, timestamp: '2024-01-15T11:00:00.000Z' });

    const results = await logger.query({}, 'admin', userId1);
    expect(results).toHaveLength(2);
  });

  it('should allow manager to see all logs', async () => {
    const userId1 = createTestUser(db, 'alice', 'manager');
    const userId2 = createTestUser(db, 'bob', 'user');

    await logger.log({ userId: userId1, username: 'alice', action: 'open', details: {}, timestamp: '2024-01-15T10:00:00.000Z' });
    await logger.log({ userId: userId2, username: 'bob', action: 'close', details: {}, timestamp: '2024-01-15T11:00:00.000Z' });

    const results = await logger.query({}, 'manager', userId1);
    expect(results).toHaveLength(2);
  });

  it('should restrict user to only see their own logs', async () => {
    const userId1 = createTestUser(db, 'alice', 'user');
    const userId2 = createTestUser(db, 'bob', 'user');

    await logger.log({ userId: userId1, username: 'alice', action: 'open', details: {}, timestamp: '2024-01-15T10:00:00.000Z' });
    await logger.log({ userId: userId2, username: 'bob', action: 'close', details: {}, timestamp: '2024-01-15T11:00:00.000Z' });
    await logger.log({ userId: userId1, username: 'alice', action: 'edit', details: {}, timestamp: '2024-01-15T12:00:00.000Z' });

    const results = await logger.query({}, 'user', userId1);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.userId === userId1)).toBe(true);
  });

  it('should apply user role filter even when userId filter is different', async () => {
    const userId1 = createTestUser(db, 'alice', 'user');
    const userId2 = createTestUser(db, 'bob', 'user');

    await logger.log({ userId: userId1, username: 'alice', action: 'open', details: {}, timestamp: '2024-01-15T10:00:00.000Z' });
    await logger.log({ userId: userId2, username: 'bob', action: 'close', details: {}, timestamp: '2024-01-15T11:00:00.000Z' });

    // User alice tries to query bob's logs — should get nothing because role filter restricts to alice
    const results = await logger.query({ userId: userId2 }, 'user', userId1);
    expect(results).toHaveLength(0);
  });

  it('should allow query without role (no restriction)', async () => {
    const userId1 = createTestUser(db, 'alice');
    const userId2 = createTestUser(db, 'bob');

    await logger.log({ userId: userId1, username: 'alice', action: 'open', details: {}, timestamp: '2024-01-15T10:00:00.000Z' });
    await logger.log({ userId: userId2, username: 'bob', action: 'close', details: {}, timestamp: '2024-01-15T11:00:00.000Z' });

    const results = await logger.query({});
    expect(results).toHaveLength(2);
  });
});

// ─── ActionLogger.cleanup() ─────────────────────────────────────────────────

describe('ActionLogger.cleanup', () => {
  let db: Database.Database;
  let dbPath: string;
  let logger: ActionLogger;

  beforeEach(() => {
    ({ db, dbPath, logger } = setupTestDb());
  });

  afterEach(() => {
    cleanupTestDb(db, dbPath);
  });

  it('should delete logs older than 90 days', async () => {
    const userId = createTestUser(db, 'alice');

    // Log from 100 days ago
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 100);

    await logger.log({
      userId,
      username: 'alice',
      action: 'old_action',
      details: {},
      timestamp: oldDate.toISOString(),
    });

    // Log from today
    await logger.log({
      userId,
      username: 'alice',
      action: 'recent_action',
      details: {},
      timestamp: new Date().toISOString(),
    });

    const deleted = logger.cleanup();
    expect(deleted).toBe(1);

    const remaining = db.prepare('SELECT * FROM action_logs').all();
    expect(remaining).toHaveLength(1);
  });

  it('should not delete logs within 90 days', async () => {
    const userId = createTestUser(db, 'alice');

    // Log from 89 days ago (within retention)
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 89);

    await logger.log({
      userId,
      username: 'alice',
      action: 'recent_action',
      details: {},
      timestamp: recentDate.toISOString(),
    });

    const deleted = logger.cleanup();
    expect(deleted).toBe(0);

    const remaining = db.prepare('SELECT * FROM action_logs').all();
    expect(remaining).toHaveLength(1);
  });

  it('should return the number of deleted records', async () => {
    const userId = createTestUser(db, 'alice');

    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 100);

    // Insert 3 old logs
    for (let i = 0; i < 3; i++) {
      await logger.log({
        userId,
        username: 'alice',
        action: `old-${i}`,
        details: {},
        timestamp: oldDate.toISOString(),
      });
    }

    // Insert 1 recent log
    await logger.log({
      userId,
      username: 'alice',
      action: 'recent',
      details: {},
      timestamp: new Date().toISOString(),
    });

    const deleted = logger.cleanup();
    expect(deleted).toBe(3);
  });

  it('should return 0 when no logs need cleanup', async () => {
    const userId = createTestUser(db, 'alice');

    await logger.log({
      userId,
      username: 'alice',
      action: 'recent',
      details: {},
      timestamp: new Date().toISOString(),
    });

    const deleted = logger.cleanup();
    expect(deleted).toBe(0);
  });

  it('should return 0 when there are no logs at all', () => {
    const deleted = logger.cleanup();
    expect(deleted).toBe(0);
  });

  it('should handle boundary case at exactly 90 days', async () => {
    const userId = createTestUser(db, 'alice');

    // Log from exactly 91 days ago (should be deleted)
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 91);

    await logger.log({
      userId,
      username: 'alice',
      action: 'boundary_old',
      details: {},
      timestamp: oldDate.toISOString(),
    });

    const deleted = logger.cleanup();
    expect(deleted).toBe(1);
  });
});
