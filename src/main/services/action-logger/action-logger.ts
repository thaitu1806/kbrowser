/**
 * Action Logger Service
 *
 * Ghi và truy vấn nhật ký hành động của người dùng:
 * username, action, profileId, timestamp.
 * Hỗ trợ bộ lọc, phân quyền xem nhật ký và chính sách lưu trữ 90 ngày.
 */

import crypto from 'crypto';
import type Database from 'better-sqlite3';
import type { ActionLogEntry, LogFilter } from '../../../shared/types';
import type { Role } from '../../../shared/types';

/** Number of days to retain action logs before cleanup. */
const RETENTION_DAYS = 90;

export class ActionLogger {
  private db: Database.Database;

  /**
   * @param db - A better-sqlite3 database instance (already initialized with schema).
   */
  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Logs a user action to the action_logs table.
   *
   * Steps:
   * 1. Generate UUID for log entry ID
   * 2. Serialize details as JSON
   * 3. Insert into action_logs table
   *
   * @param entry - The action log entry to record (id and timestamp are auto-generated if missing)
   */
  async log(entry: Omit<ActionLogEntry, 'id' | 'timestamp'> & { id?: string; timestamp?: string }): Promise<void> {
    const id = entry.id || crypto.randomUUID();
    const timestamp = entry.timestamp || new Date().toISOString();
    const details = typeof entry.details === 'string'
      ? entry.details
      : JSON.stringify(entry.details ?? {});

    this.db
      .prepare(
        `INSERT INTO action_logs (id, user_id, username, action, profile_id, details, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, entry.userId, entry.username, entry.action, entry.profileId ?? null, details, timestamp);
  }

  /**
   * Queries action logs with optional filters and role-based access control.
   *
   * Access rules:
   * - Admin/Manager (or when callerRole is not provided): can see all logs
   * - User: automatically filtered to only show logs for callerUserId
   *
   * Supported filters:
   * - userId: filter by user ID
   * - action: filter by action type
   * - startDate: filter logs on or after this ISO 8601 date
   * - endDate: filter logs on or before this ISO 8601 date
   * - limit: maximum number of results (default: 100)
   * - offset: number of results to skip (default: 0)
   *
   * @param filter - LogFilter criteria
   * @param callerRole - Role of the user making the query
   * @param callerUserId - ID of the user making the query
   * @returns Array of ActionLogEntry matching the filter
   */
  async query(
    filter: LogFilter,
    callerRole?: Role,
    callerUserId?: string,
  ): Promise<ActionLogEntry[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    // Role-based access: User can only see their own logs
    if (callerRole === 'user' && callerUserId) {
      conditions.push('user_id = ?');
      params.push(callerUserId);
    }

    // Apply optional filters
    if (filter.userId) {
      conditions.push('user_id = ?');
      params.push(filter.userId);
    }

    if (filter.action) {
      conditions.push('action = ?');
      params.push(filter.action);
    }

    if (filter.startDate) {
      conditions.push('timestamp >= ?');
      params.push(filter.startDate);
    }

    if (filter.endDate) {
      conditions.push('timestamp <= ?');
      params.push(filter.endDate);
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;

    const sql = `SELECT id, user_id, username, action, profile_id, details, timestamp
                 FROM action_logs
                 ${whereClause}
                 ORDER BY timestamp DESC
                 LIMIT ? OFFSET ?`;

    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string;
      user_id: string;
      username: string;
      action: string;
      profile_id: string | null;
      details: string | null;
      timestamp: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      username: row.username,
      action: row.action,
      profileId: row.profile_id ?? undefined,
      details: row.details ? JSON.parse(row.details) : {},
      timestamp: row.timestamp,
    }));
  }

  /**
   * Deletes all action logs older than 90 days.
   *
   * @returns The number of deleted records
   */
  cleanup(): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
    const cutoffISO = cutoffDate.toISOString();

    const result = this.db
      .prepare('DELETE FROM action_logs WHERE timestamp < ?')
      .run(cutoffISO);

    return result.changes;
  }
}
