/**
 * Property-based tests for Action Logger (P25–P27).
 *
 * Uses fast-check to verify correctness properties defined in the design document.
 * Each test uses a fresh SQLite database for isolation.
 */

import { describe, it, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { initializeDatabase } from '../../../database/index';
import { ActionLogger } from '../action-logger';
import { assertProperty, propertyTag } from '../../../../test-helpers/fast-check-helpers';
import type { Role } from '../../../../shared/types';

// ---------------------------------------------------------------------------
// Arbitraries (generators)
// ---------------------------------------------------------------------------

/** Valid action types for profile operations. */
const arbActionType: fc.Arbitrary<string> = fc.constantFrom('open', 'close', 'edit', 'delete');

/** Valid usernames: lowercase alpha, 3–12 chars. */
const arbUsername: fc.Arbitrary<string> = fc.stringOf(
  fc.char().filter((c) => c.charCodeAt(0) >= 97 && c.charCodeAt(0) <= 122),
  { minLength: 3, maxLength: 12 },
);

/** Valid ISO 8601 timestamps within a reasonable range (2024-01-01 to 2024-12-31). */
const arbTimestamp: fc.Arbitrary<string> = fc
  .integer({ min: 1704067200000, max: 1735689599000 }) // 2024-01-01 to 2024-12-31
  .map((ms) => new Date(ms).toISOString());

/** Ordered pair of timestamps (start <= end). */
const arbDateRange: fc.Arbitrary<{ startDate: string; endDate: string }> = fc
  .tuple(
    fc.integer({ min: 1704067200000, max: 1735689599000 }),
    fc.integer({ min: 1704067200000, max: 1735689599000 }),
  )
  .map(([a, b]) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return {
      startDate: new Date(lo).toISOString(),
      endDate: new Date(hi).toISOString(),
    };
  });

/** Valid profile IDs. */
const arbProfileId: fc.Arbitrary<string> = fc
  .stringOf(fc.hexaString({ minLength: 1, maxLength: 1 }), { minLength: 8, maxLength: 8 })
  .map((s) => `profile-${s}`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let counter = 0;

function uniqueUsername(base: string): string {
  return `${base}-${++counter}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Creates a user in the database and returns the user ID. */
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

// ---------------------------------------------------------------------------
// Shared test setup / teardown
// ---------------------------------------------------------------------------

let db: Database.Database;
let dbPath: string;
let logger: ActionLogger;

function setup() {
  counter = 0;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  dbPath = path.join(os.tmpdir(), `prop-action-logger-${suffix}.db`);
  db = initializeDatabase(dbPath);
  logger = new ActionLogger(db);
}

function teardown() {
  try { db.close(); } catch { /* ignore */ }
  try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
  try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
  try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('ActionLogger property tests', () => {
  beforeEach(() => {
    setup();
  });

  afterEach(() => {
    teardown();
  });

  /**
   * **Validates: Requirements 12.1**
   *
   * Property 25: Nhật ký hành động chứa đầy đủ thông tin
   *
   * For any user action on a profile (open, close, edit, delete), the log entry
   * must contain username, action type, related profile, and timestamp.
   */
  it(
    propertyTag(25, 'Nhật ký hành động chứa đầy đủ thông tin'),
    async () => {
      await assertProperty(
        fc.asyncProperty(
          arbUsername,
          arbActionType,
          arbProfileId,
          arbTimestamp,
          async (username, action, profileId, timestamp) => {
            // Create a fresh user for each iteration to avoid unique constraint conflicts
            const uname = uniqueUsername(username);
            const userId = createTestUser(db, uname);

            // Log the action
            await logger.log({
              userId,
              username: uname,
              action,
              profileId,
              details: {},
              timestamp,
            });

            // Query back the log entry
            const results = await logger.query({ userId });

            // Must have at least one result
            if (results.length === 0) return false;

            const entry = results[0];

            // Verify all required fields are present and correct
            if (entry.username !== uname) return false;
            if (entry.action !== action) return false;
            if (entry.profileId !== profileId) return false;
            if (entry.timestamp !== timestamp) return false;

            // Verify id is a valid UUID
            if (!entry.id || typeof entry.id !== 'string' || entry.id.length === 0) return false;

            // Verify userId is present
            if (entry.userId !== userId) return false;

            return true;
          },
        ),
      );
    },
  );

  /**
   * **Validates: Requirements 12.2**
   *
   * Property 26: Lọc nhật ký trả về kết quả chính xác
   *
   * For any log filter (by user, action type, time range), all returned results
   * must satisfy the filter conditions, and no matching records should be missed.
   */
  it(
    propertyTag(26, 'Lọc nhật ký trả về kết quả chính xác'),
    async () => {
      await assertProperty(
        fc.asyncProperty(
          // Generate 2–6 log entries with varied attributes
          fc.array(
            fc.record({
              action: arbActionType,
              timestamp: arbTimestamp,
            }),
            { minLength: 2, maxLength: 6 },
          ),
          // Generate a filter: optionally filter by action and/or date range
          fc.record({
            filterByAction: fc.option(arbActionType, { nil: undefined }),
            filterByDateRange: fc.option(arbDateRange, { nil: undefined }),
          }),
          async (entries, filterSpec) => {
            // Create two users so we can also test userId filtering
            const uname1 = uniqueUsername('alice');
            const uname2 = uniqueUsername('bob');
            const userId1 = createTestUser(db, uname1);
            const userId2 = createTestUser(db, uname2);

            // Insert log entries, alternating between users
            for (let i = 0; i < entries.length; i++) {
              const isUser1 = i % 2 === 0;
              await logger.log({
                userId: isUser1 ? userId1 : userId2,
                username: isUser1 ? uname1 : uname2,
                action: entries[i].action,
                profileId: `profile-${i}`,
                details: {},
                timestamp: entries[i].timestamp,
              });
            }

            // Build the filter
            const filter: {
              userId?: string;
              action?: string;
              startDate?: string;
              endDate?: string;
              limit?: number;
            } = { limit: 1000 };

            // Randomly decide to filter by userId1
            const filterByUser = entries.length > 2; // filter by user when we have enough entries
            if (filterByUser) {
              filter.userId = userId1;
            }

            if (filterSpec.filterByAction !== undefined) {
              filter.action = filterSpec.filterByAction;
            }

            if (filterSpec.filterByDateRange !== undefined) {
              filter.startDate = filterSpec.filterByDateRange.startDate;
              filter.endDate = filterSpec.filterByDateRange.endDate;
            }

            // Query with the filter
            const results = await logger.query(filter);

            // Condition 1: All returned results must satisfy the filter
            for (const entry of results) {
              if (filter.userId && entry.userId !== filter.userId) return false;
              if (filter.action && entry.action !== filter.action) return false;
              if (filter.startDate && entry.timestamp < filter.startDate) return false;
              if (filter.endDate && entry.timestamp > filter.endDate) return false;
            }

            // Condition 2: No matching records should be missed
            // Query ALL logs (no filter) and manually check which ones should match
            const allLogs = await logger.query({ limit: 1000 });
            const expectedMatches = allLogs.filter((entry) => {
              if (filter.userId && entry.userId !== filter.userId) return false;
              if (filter.action && entry.action !== filter.action) return false;
              if (filter.startDate && entry.timestamp < filter.startDate) return false;
              if (filter.endDate && entry.timestamp > filter.endDate) return false;
              return true;
            });

            if (results.length !== expectedMatches.length) return false;

            // Verify same set of IDs
            const resultIds = new Set(results.map((r) => r.id));
            const expectedIds = new Set(expectedMatches.map((r) => r.id));
            for (const id of expectedIds) {
              if (!resultIds.has(id)) return false;
            }

            return true;
          },
        ),
      );
    },
  );

  /**
   * **Validates: Requirements 12.4**
   *
   * Property 27: User chỉ xem nhật ký của mình
   *
   * For any user with role User, when querying logs, results must only contain
   * log entries of that user.
   */
  it(
    propertyTag(27, 'User chỉ xem nhật ký của mình'),
    async () => {
      await assertProperty(
        fc.asyncProperty(
          // Number of log entries per user (1–4)
          fc.integer({ min: 1, max: 4 }),
          fc.integer({ min: 1, max: 4 }),
          // Optional action filter
          fc.option(arbActionType, { nil: undefined }),
          async (numLogsUser1, numLogsUser2, actionFilter) => {
            // Create two users with role 'user'
            const uname1 = uniqueUsername('userA');
            const uname2 = uniqueUsername('userB');
            const userId1 = createTestUser(db, uname1, 'user');
            const userId2 = createTestUser(db, uname2, 'user');

            const actions = ['open', 'close', 'edit', 'delete'];

            // Insert logs for user 1
            for (let i = 0; i < numLogsUser1; i++) {
              await logger.log({
                userId: userId1,
                username: uname1,
                action: actions[i % actions.length],
                profileId: `profile-u1-${i}`,
                details: {},
                timestamp: new Date(1704067200000 + i * 3600000).toISOString(),
              });
            }

            // Insert logs for user 2
            for (let i = 0; i < numLogsUser2; i++) {
              await logger.log({
                userId: userId2,
                username: uname2,
                action: actions[i % actions.length],
                profileId: `profile-u2-${i}`,
                details: {},
                timestamp: new Date(1704067200000 + i * 3600000).toISOString(),
              });
            }

            // Build filter (optionally filter by action)
            const filter: { action?: string; limit?: number } = { limit: 1000 };
            if (actionFilter !== undefined) {
              filter.action = actionFilter;
            }

            // User 1 queries with role 'user' — should only see their own logs
            const resultsUser1 = await logger.query(filter, 'user', userId1);
            for (const entry of resultsUser1) {
              if (entry.userId !== userId1) return false;
            }

            // User 2 queries with role 'user' — should only see their own logs
            const resultsUser2 = await logger.query(filter, 'user', userId2);
            for (const entry of resultsUser2) {
              if (entry.userId !== userId2) return false;
            }

            // Verify completeness: user1's results should contain all their matching logs
            const allLogs = await logger.query({ limit: 1000 });
            const expectedUser1 = allLogs.filter((e) => {
              if (e.userId !== userId1) return false;
              if (filter.action && e.action !== filter.action) return false;
              return true;
            });
            if (resultsUser1.length !== expectedUser1.length) return false;

            const expectedUser2 = allLogs.filter((e) => {
              if (e.userId !== userId2) return false;
              if (filter.action && e.action !== filter.action) return false;
              return true;
            });
            if (resultsUser2.length !== expectedUser2.length) return false;

            // Verify admin can see all logs (no restriction)
            const adminUname = uniqueUsername('admin');
            const adminId = createTestUser(db, adminUname, 'admin');
            const adminResults = await logger.query(filter, 'admin', adminId);

            // Admin results should include logs from both users (matching the filter)
            const expectedAll = allLogs.filter((e) => {
              if (filter.action && e.action !== filter.action) return false;
              return true;
            });
            if (adminResults.length !== expectedAll.length) return false;

            return true;
          },
        ),
      );
    },
  );
});
