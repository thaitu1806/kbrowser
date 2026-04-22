/**
 * Smoke Tests: Server Port & 90-Day Retention Policy
 *
 * - Verify server starts on configurable port
 * - Verify 90-day retention cleanup works
 *
 * Task 14.5
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import request from 'supertest';
import { initializeDatabase } from '../../main/database/index';
import { LocalAPIServer } from '../../main/services/local-api/local-api-server';
import { ActionLogger } from '../../main/services/action-logger/action-logger';
import type { ProfileManager } from '../../main/services/profile-manager/profile-manager';

describe('Smoke: Server Port Configuration', () => {
  let apiServer: LocalAPIServer;

  beforeEach(() => {
    // Create a mock ProfileManager (minimal for smoke test)
    const mockPM = {
      listProfiles: vi.fn(async () => []),
      openProfile: vi.fn(),
      closeProfile: vi.fn(),
    } as unknown as ProfileManager;

    apiServer = new LocalAPIServer(mockPM, 'smoke-test-key');
  });

  afterEach(async () => {
    await apiServer.stop();
  });

  it('should start on the default port 5015', async () => {
    // Start on default port
    await apiServer.start(5015);

    // Verify server is responding
    const res = await request('http://localhost:5015')
      .get('/api/v1/profiles')
      .set('X-API-Key', 'smoke-test-key')
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });

  it('should start on a custom port', async () => {
    const customPort = 5099;
    await apiServer.start(customPort);

    const res = await request(`http://localhost:${customPort}`)
      .get('/api/v1/profiles')
      .set('X-API-Key', 'smoke-test-key')
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });

  it('should stop cleanly', async () => {
    await apiServer.start(0); // random port
    await apiServer.stop();
    // Stopping again should not throw
    await apiServer.stop();
  });
});

describe('Smoke: 90-Day Retention Policy', () => {
  let db: Database.Database;
  let dbPath: string;
  let logger: ActionLogger;
  const userId = 'retention-test-user';

  beforeEach(() => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    dbPath = path.join(os.tmpdir(), `test-retention-${suffix}.db`);
    db = initializeDatabase(dbPath);

    // Insert test user
    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
       VALUES (?, 'retentionuser', 'hash', 'admin', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`,
    ).run(userId);

    logger = new ActionLogger(db);
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
  });

  it('should delete logs older than 90 days', async () => {
    // Insert a log from 100 days ago
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 100);

    await logger.log({
      userId,
      username: 'retentionuser',
      action: 'old_action',
      details: { info: 'old log' },
      timestamp: oldDate.toISOString(),
    });

    // Insert a recent log
    await logger.log({
      userId,
      username: 'retentionuser',
      action: 'recent_action',
      details: { info: 'recent log' },
      timestamp: new Date().toISOString(),
    });

    // Verify both logs exist
    const allLogs = await logger.query({});
    expect(allLogs).toHaveLength(2);

    // Run cleanup
    const deleted = logger.cleanup();
    expect(deleted).toBe(1);

    // Verify only recent log remains
    const remainingLogs = await logger.query({});
    expect(remainingLogs).toHaveLength(1);
    expect(remainingLogs[0].action).toBe('recent_action');
  });

  it('should keep logs that are exactly 89 days old', async () => {
    const borderDate = new Date();
    borderDate.setDate(borderDate.getDate() - 89);

    await logger.log({
      userId,
      username: 'retentionuser',
      action: 'border_action',
      details: {},
      timestamp: borderDate.toISOString(),
    });

    const deleted = logger.cleanup();
    expect(deleted).toBe(0);

    const logs = await logger.query({});
    expect(logs).toHaveLength(1);
  });

  it('should delete multiple old logs in one cleanup', async () => {
    // Insert 5 logs from 91-95 days ago
    for (let i = 91; i <= 95; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      await logger.log({
        userId,
        username: 'retentionuser',
        action: `old_action_${i}`,
        details: {},
        timestamp: date.toISOString(),
      });
    }

    // Insert 2 recent logs
    await logger.log({
      userId,
      username: 'retentionuser',
      action: 'recent_1',
      details: {},
      timestamp: new Date().toISOString(),
    });
    await logger.log({
      userId,
      username: 'retentionuser',
      action: 'recent_2',
      details: {},
      timestamp: new Date().toISOString(),
    });

    const deleted = logger.cleanup();
    expect(deleted).toBe(5);

    const remaining = await logger.query({});
    expect(remaining).toHaveLength(2);
  });

  it('should return 0 when no old logs exist', async () => {
    await logger.log({
      userId,
      username: 'retentionuser',
      action: 'fresh_action',
      details: {},
      timestamp: new Date().toISOString(),
    });

    const deleted = logger.cleanup();
    expect(deleted).toBe(0);
  });
});
