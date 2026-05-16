// Feature: profile-rpa, Property 13: Schedule persistence round-trip
/**
 * Property-Based Test: Schedule persistence round-trip
 *
 * For any set of active schedules saved to DB, after restore() all schedules
 * are recovered with same cronExpression, profileId, scriptId, status='active'.
 *
 * **Validates: Requirements 5.5**
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import Database from 'better-sqlite3';
import { initializeDatabase } from '../../../database/index';
import { Scheduler } from '../scheduler';
import { QueueManager } from '../queue-manager';
import type { RPASchedule } from '../../../../shared/types/rpa-orchestrator';
import path from 'path';
import fs from 'fs';
import os from 'os';

describe('Scheduler Property Tests', () => {
  let db: Database.Database;
  let dbPath: string;
  let queueManager: QueueManager;

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `test-scheduler-prop-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    );
    db = initializeDatabase(dbPath);

    // Insert prerequisite data: user
    db.prepare(`
      INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
      VALUES ('u1', 'testuser', 'hash', 'admin', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
    `).run();

    queueManager = new QueueManager(db);
  });

  afterEach(() => {
    db.close();
    try {
      fs.unlinkSync(dbPath);
      fs.unlinkSync(dbPath + '-wal');
      fs.unlinkSync(dbPath + '-shm');
    } catch {
      // Ignore cleanup errors
    }
  });

  /**
   * Helper: ensure a profile exists in the database.
   */
  function ensureProfileExists(profileId: string): void {
    const existing = db
      .prepare('SELECT id FROM profiles WHERE id = ?')
      .get(profileId) as { id: string } | undefined;
    if (!existing) {
      db.prepare(`
        INSERT INTO profiles (id, name, browser_type, owner_id, created_at, updated_at)
        VALUES (?, ?, 'chromium', 'u1', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
      `).run(profileId, `Profile ${profileId}`);
    }
  }

  /**
   * Helper: ensure a script exists in the database.
   */
  function ensureScriptExists(scriptId: string): void {
    const existing = db
      .prepare('SELECT id FROM rpa_scripts WHERE id = ?')
      .get(scriptId) as { id: string } | undefined;
    if (!existing) {
      db.prepare(`
        INSERT INTO rpa_scripts (id, name, owner_id, actions, error_handling, created_at, updated_at)
        VALUES (?, 'Generated Script', 'u1', '[]', 'stop', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
      `).run(scriptId);
    }
  }

  // Arbitraries
  const cronExprArb = fc.constantFrom(
    '* * * * *',
    '0 * * * *',
    '0 0 * * *',
    '0 0 * * 0',
    '*/5 * * * *'
  );
  const executionOrderArb = fc.constantFrom<'ordered' | 'random'>('ordered', 'random');
  const profileIdArb = fc.uuid();
  const scriptIdArb = fc.uuid();

  const scheduleArb = fc.record({
    id: fc.uuid(),
    profileId: profileIdArb,
    scriptId: scriptIdArb,
    cronExpression: cronExprArb,
    executionOrder: executionOrderArb,
  });

  // Feature: profile-rpa, Property 13: Schedule persistence round-trip
  it('Property 13: after restore(), all active schedules are recovered with same cronExpression, profileId, scriptId, status', () => {
    fc.assert(
      fc.property(
        fc.array(scheduleArb, { minLength: 1, maxLength: 5 }),
        (schedules) => {
          // Clean up schedules table for a fresh run
          db.prepare('DELETE FROM rpa_schedules').run();
          db.prepare('DELETE FROM rpa_tasks').run();

          // Ensure all referenced profiles and scripts exist
          for (const s of schedules) {
            ensureProfileExists(s.profileId);
            ensureScriptExists(s.scriptId);
          }

          // Deduplicate by schedule id to avoid primary key conflicts
          const uniqueSchedules = new Map<string, typeof schedules[number]>();
          for (const s of schedules) {
            uniqueSchedules.set(s.id, s);
          }
          const schedulesToRegister = Array.from(uniqueSchedules.values());

          // Create a Scheduler instance and register all schedules
          const scheduler1 = new Scheduler(db, queueManager);
          const now = new Date().toISOString();

          for (const s of schedulesToRegister) {
            const schedule: RPASchedule = {
              id: s.id,
              profileId: s.profileId,
              scriptId: s.scriptId,
              cronExpression: s.cronExpression,
              executionOrder: s.executionOrder,
              status: 'active',
              createdAt: now,
              updatedAt: now,
            };
            scheduler1.register(schedule);
          }

          // Destroy the first scheduler (clears timers, simulates restart)
          scheduler1.destroy();

          // Create a new Scheduler instance and restore from DB
          const scheduler2 = new Scheduler(db, queueManager);
          scheduler2.restore();

          // Verify all schedules are recovered
          const activeSchedules = scheduler2.getActive();

          expect(activeSchedules.length).toBe(schedulesToRegister.length);

          // Verify each registered schedule is present with correct data
          for (const original of schedulesToRegister) {
            const restored = activeSchedules.find((a) => a.id === original.id);
            expect(restored).toBeDefined();
            expect(restored!.cronExpression).toBe(original.cronExpression);
            expect(restored!.profileId).toBe(original.profileId);
            expect(restored!.scriptId).toBe(original.scriptId);
            expect(restored!.status).toBe('active');
          }

          // Clean up timers
          scheduler2.destroy();
        }
      ),
      { numRuns: 100 }
    );
  });
});
