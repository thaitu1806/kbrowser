import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeDatabase } from '../../../database/index';
import { Scheduler } from '../scheduler';
import { QueueManager } from '../queue-manager';
import type { RPASchedule } from '../../../../shared/types/rpa-orchestrator';
import path from 'path';
import fs from 'fs';
import os from 'os';

function createSchedule(overrides: Partial<RPASchedule> = {}): RPASchedule {
  const now = new Date().toISOString();
  return {
    id: `sched-${Math.random().toString(36).slice(2)}`,
    profileId: 'p1',
    scriptId: 's1',
    cronExpression: '0 * * * *', // every hour
    executionOrder: 'ordered',
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('Scheduler', () => {
  let db: Database.Database;
  let dbPath: string;
  let queueManager: QueueManager;
  let scheduler: Scheduler;

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `test-scheduler-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    );
    db = initializeDatabase(dbPath);

    // Insert prerequisite data: user, profiles, script
    db.prepare(`
      INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
      VALUES ('u1', 'testuser', 'hash', 'admin', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
    `).run();

    db.prepare(`
      INSERT INTO profiles (id, name, browser_type, owner_id, created_at, updated_at)
      VALUES ('p1', 'Profile 1', 'chromium', 'u1', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
    `).run();

    db.prepare(`
      INSERT INTO profiles (id, name, browser_type, owner_id, created_at, updated_at)
      VALUES ('p2', 'Profile 2', 'chromium', 'u1', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
    `).run();

    db.prepare(`
      INSERT INTO rpa_scripts (id, name, owner_id, actions, error_handling, created_at, updated_at)
      VALUES ('s1', 'Script 1', 'u1', '[]', 'stop', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
    `).run();

    queueManager = new QueueManager(db);
    scheduler = new Scheduler(db, queueManager);
  });

  afterEach(() => {
    scheduler.destroy();
    db.close();
    try {
      fs.unlinkSync(dbPath);
      fs.unlinkSync(dbPath + '-wal');
      fs.unlinkSync(dbPath + '-shm');
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('register()', () => {
    it('should add a schedule and it appears in getActive()', () => {
      const schedule = createSchedule({ id: 'sched-1' });
      scheduler.register(schedule);

      const active = scheduler.getActive();
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe('sched-1');
      expect(active[0].profileId).toBe('p1');
      expect(active[0].scriptId).toBe('s1');
      expect(active[0].cronExpression).toBe('0 * * * *');
      expect(active[0].status).toBe('active');
    });

    it('should persist schedule to rpa_schedules table', () => {
      const schedule = createSchedule({ id: 'sched-persist' });
      scheduler.register(schedule);

      const row = db.prepare('SELECT * FROM rpa_schedules WHERE id = ?').get('sched-persist') as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(row.id).toBe('sched-persist');
      expect(row.profile_id).toBe('p1');
      expect(row.script_id).toBe('s1');
      expect(row.cron_expression).toBe('0 * * * *');
      expect(row.status).toBe('active');
      expect(row.execution_order).toBe('ordered');
    });

    it('should register multiple schedules', () => {
      const schedule1 = createSchedule({ id: 'sched-1', profileId: 'p1' });
      const schedule2 = createSchedule({ id: 'sched-2', profileId: 'p2' });

      scheduler.register(schedule1);
      scheduler.register(schedule2);

      const active = scheduler.getActive();
      expect(active).toHaveLength(2);
    });
  });

  describe('cancel()', () => {
    it('should remove a schedule from active list', () => {
      const schedule = createSchedule({ id: 'sched-cancel' });
      scheduler.register(schedule);

      expect(scheduler.getActive()).toHaveLength(1);

      scheduler.cancel('sched-cancel');

      expect(scheduler.getActive()).toHaveLength(0);
    });

    it('should set status to cancelled in DB', () => {
      const schedule = createSchedule({ id: 'sched-cancel-db' });
      scheduler.register(schedule);

      scheduler.cancel('sched-cancel-db');

      const row = db.prepare('SELECT * FROM rpa_schedules WHERE id = ?').get('sched-cancel-db') as Record<string, unknown>;
      expect(row.status).toBe('cancelled');
    });

    it('should not affect other active schedules', () => {
      const schedule1 = createSchedule({ id: 'sched-keep', profileId: 'p1' });
      const schedule2 = createSchedule({ id: 'sched-remove', profileId: 'p2' });

      scheduler.register(schedule1);
      scheduler.register(schedule2);

      scheduler.cancel('sched-remove');

      const active = scheduler.getActive();
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe('sched-keep');
    });

    it('should handle cancelling a non-existent schedule gracefully', () => {
      // Should not throw
      expect(() => scheduler.cancel('non-existent')).not.toThrow();
    });
  });

  describe('restore()', () => {
    it('should recover active schedules from DB after restart', () => {
      // Register schedules with the first scheduler instance
      const schedule1 = createSchedule({ id: 'sched-restore-1', profileId: 'p1' });
      const schedule2 = createSchedule({ id: 'sched-restore-2', profileId: 'p2' });

      scheduler.register(schedule1);
      scheduler.register(schedule2);

      // Destroy the first scheduler (simulating app shutdown)
      scheduler.destroy();

      // Create a new scheduler instance (simulating app restart)
      const newScheduler = new Scheduler(db, queueManager);
      newScheduler.restore();

      const active = newScheduler.getActive();
      expect(active).toHaveLength(2);

      const ids = active.map((s) => s.id).sort();
      expect(ids).toEqual(['sched-restore-1', 'sched-restore-2']);

      newScheduler.destroy();
    });

    it('should not restore cancelled schedules', () => {
      const schedule = createSchedule({ id: 'sched-cancelled' });
      scheduler.register(schedule);
      scheduler.cancel('sched-cancelled');

      // Destroy and create new scheduler
      scheduler.destroy();
      const newScheduler = new Scheduler(db, queueManager);
      newScheduler.restore();

      const active = newScheduler.getActive();
      expect(active).toHaveLength(0);

      newScheduler.destroy();
    });

    it('should auto-expire schedules with endTime in the past during restore', () => {
      const pastEndTime = new Date(Date.now() - 60000).toISOString(); // 1 minute ago
      const schedule = createSchedule({
        id: 'sched-expired-restore',
        endTime: pastEndTime,
      });
      scheduler.register(schedule);

      // Destroy and create new scheduler
      scheduler.destroy();
      const newScheduler = new Scheduler(db, queueManager);
      newScheduler.restore();

      const active = newScheduler.getActive();
      expect(active).toHaveLength(0);

      // Verify it was marked as expired in DB
      const row = db.prepare('SELECT * FROM rpa_schedules WHERE id = ?').get('sched-expired-restore') as Record<string, unknown>;
      expect(row.status).toBe('expired');

      newScheduler.destroy();
    });
  });

  describe('expired schedule handling', () => {
    it('should auto-cancel schedule with endTime in the past during restore', () => {
      const pastEndTime = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
      const schedule = createSchedule({
        id: 'sched-past-end',
        endTime: pastEndTime,
      });
      scheduler.register(schedule);

      scheduler.destroy();
      const newScheduler = new Scheduler(db, queueManager);
      newScheduler.restore();

      // Should not be in active list
      expect(newScheduler.getActive()).toHaveLength(0);

      // Should be marked expired in DB
      const row = db.prepare('SELECT status FROM rpa_schedules WHERE id = ?').get('sched-past-end') as Record<string, unknown>;
      expect(row.status).toBe('expired');

      newScheduler.destroy();
    });

    it('should not expire schedule with endTime in the future', () => {
      const futureEndTime = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now
      const schedule = createSchedule({
        id: 'sched-future-end',
        endTime: futureEndTime,
      });
      scheduler.register(schedule);

      scheduler.destroy();
      const newScheduler = new Scheduler(db, queueManager);
      newScheduler.restore();

      const active = newScheduler.getActive();
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe('sched-future-end');

      newScheduler.destroy();
    });

    it('should not expire schedule without endTime', () => {
      const schedule = createSchedule({
        id: 'sched-no-end',
        endTime: undefined,
      });
      scheduler.register(schedule);

      scheduler.destroy();
      const newScheduler = new Scheduler(db, queueManager);
      newScheduler.restore();

      const active = newScheduler.getActive();
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe('sched-no-end');

      newScheduler.destroy();
    });
  });

  describe('destroy()', () => {
    it('should clean up all timers and active schedules', () => {
      const schedule1 = createSchedule({ id: 'sched-d1', profileId: 'p1' });
      const schedule2 = createSchedule({ id: 'sched-d2', profileId: 'p2' });

      scheduler.register(schedule1);
      scheduler.register(schedule2);

      // destroy should not throw
      expect(() => scheduler.destroy()).not.toThrow();
    });

    it('should be safe to call destroy multiple times', () => {
      const schedule = createSchedule({ id: 'sched-multi-destroy' });
      scheduler.register(schedule);

      scheduler.destroy();
      expect(() => scheduler.destroy()).not.toThrow();
    });

    it('should not affect DB records when destroyed', () => {
      const schedule = createSchedule({ id: 'sched-destroy-db' });
      scheduler.register(schedule);

      scheduler.destroy();

      // Schedule should still be active in DB (destroy only cleans up timers)
      const row = db.prepare('SELECT status FROM rpa_schedules WHERE id = ?').get('sched-destroy-db') as Record<string, unknown>;
      expect(row.status).toBe('active');
    });
  });

  describe('getNextExecutionTime()', () => {
    it('should return a valid future date for valid cron expressions', () => {
      const nextTime = scheduler.getNextExecutionTime('0 * * * *'); // every hour
      const now = new Date();

      expect(nextTime).toBeInstanceOf(Date);
      expect(nextTime.getTime()).toBeGreaterThan(now.getTime());
    });

    it('should return a time within the next minute for "* * * * *"', () => {
      const nextTime = scheduler.getNextExecutionTime('* * * * *'); // every minute
      const now = new Date();

      // Should be within the next 60 seconds (plus a small buffer for test execution)
      const diffMs = nextTime.getTime() - now.getTime();
      expect(diffMs).toBeGreaterThan(0);
      expect(diffMs).toBeLessThanOrEqual(61000); // at most ~61 seconds
    });

    it('should return correct time for "0 0 * * *" (daily at midnight)', () => {
      const nextTime = scheduler.getNextExecutionTime('0 0 * * *');
      const now = new Date();

      expect(nextTime.getTime()).toBeGreaterThan(now.getTime());
      expect(nextTime.getMinutes()).toBe(0);
      expect(nextTime.getHours()).toBe(0);
    });

    it('should return correct time for "*/5 * * * *" (every 5 minutes)', () => {
      const nextTime = scheduler.getNextExecutionTime('*/5 * * * *');
      const now = new Date();

      expect(nextTime.getTime()).toBeGreaterThan(now.getTime());
      expect(nextTime.getMinutes() % 5).toBe(0);
    });

    it('should return correct time for "0 0 * * 0" (weekly on Sunday)', () => {
      const nextTime = scheduler.getNextExecutionTime('0 0 * * 0');
      const now = new Date();

      expect(nextTime.getTime()).toBeGreaterThan(now.getTime());
      expect(nextTime.getDay()).toBe(0); // Sunday
      expect(nextTime.getHours()).toBe(0);
      expect(nextTime.getMinutes()).toBe(0);
    });

    it('should throw for invalid cron expression with too few fields', () => {
      expect(() => scheduler.getNextExecutionTime('* *')).toThrow('Invalid cron expression');
    });
  });
});
