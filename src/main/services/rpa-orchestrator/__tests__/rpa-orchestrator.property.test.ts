// Feature: profile-rpa, Property 1: Batch task creation tạo đúng số lượng task
/**
 * Property-Based Test: Batch task creation count
 *
 * For any non-empty profile list and valid script ID, batch creates exactly N tasks
 * with correct associations (where N = profileIds.length).
 *
 * **Validates: Requirements 1.2, 1.3, 4.1**
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import Database from 'better-sqlite3';
import { initializeDatabase } from '../../../database/index';
import { RPAOrchestrator } from '../rpa-orchestrator';
import type { BatchExecuteConfig } from '../../../../shared/types/rpa-orchestrator';
import path from 'path';
import fs from 'fs';
import os from 'os';

describe('RPAOrchestrator Property Tests', () => {
  let db: Database.Database;
  let dbPath: string;
  let orchestrator: RPAOrchestrator;

  // Minimal mocks for ProfileManager and RPAEngine (not used in createBatchTasks)
  const mockProfileManager = {
    openProfile: async () => ({}),
    closeProfile: async () => {},
  };

  const mockRpaEngine = {
    executeScript: async () => ({ success: true, actionsCompleted: 5, totalActions: 5 }),
  };

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `test-orchestrator-prop-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    );
    db = initializeDatabase(dbPath);

    // Insert prerequisite data: user
    db.prepare(`
      INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
      VALUES ('u1', 'testuser', 'hash', 'admin', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
    `).run();

    orchestrator = new RPAOrchestrator(db, mockProfileManager, mockRpaEngine);
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
      `).run(profileId, `Profile ${profileId.slice(0, 8)}`);
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
        VALUES (?, 'Test Script', 'u1', '[]', 'stop', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
      `).run(scriptId);
    }
  }

  // Arbitraries
  const executionOrderArb = fc.constantFrom<'ordered' | 'random'>('ordered', 'random');
  const taskTypeArb = fc.constantFrom<'common' | 'scheduled'>('common', 'scheduled');
  const priorityArb = fc.boolean();
  const scriptIdArb = fc.uuid();
  // Generate 1-20 unique profile IDs
  const profileIdsArb = fc
    .uniqueArray(fc.uuid(), { minLength: 1, maxLength: 20 })
    .filter((arr) => arr.length >= 1);

  // Feature: profile-rpa, Property 2: Invalid script rejection
  /**
   * Property 2: Invalid script rejection
   *
   * For any non-existent script ID (UUID not in rpa_scripts table),
   * task creation must fail and no tasks are persisted in the database.
   *
   * **Validates: Requirements 1.4**
   */
  it('Property 2: For any non-existent script ID, task creation must fail and no tasks are persisted', () => {
    fc.assert(
      fc.property(
        fc.uuid(), // non-existent scriptId (never inserted into DB)
        fc.uuid(), // profileId
        executionOrderArb,
        taskTypeArb,
        priorityArb,
        profileIdsArb,
        (nonExistentScriptId, profileId, executionOrder, taskType, priority, profileIds) => {
          // Clean up tasks from previous iteration
          db.prepare('DELETE FROM rpa_tasks').run();

          // Ensure the profile exists (so the only reason for failure is the script)
          ensureProfileExists(profileId);
          for (const pid of profileIds) {
            ensureProfileExists(pid);
          }

          // DO NOT insert the script — that's the point (it doesn't exist)

          // createTask must throw for non-existent script
          expect(() => {
            orchestrator.createTask(profileId, nonExistentScriptId, {
              executionOrder,
              taskType,
              priority,
            });
          }).toThrow();

          // Verify no tasks were persisted
          const countAfterCreateTask = db
            .prepare('SELECT COUNT(*) as count FROM rpa_tasks')
            .get() as { count: number };
          expect(countAfterCreateTask.count).toBe(0);

          // createBatchTasks must also throw for non-existent script
          const config: BatchExecuteConfig = {
            scriptId: nonExistentScriptId,
            profileIds,
            executionOrder,
            taskType,
            priority,
          };

          expect(() => {
            orchestrator.createBatchTasks(config);
          }).toThrow();

          // Verify no tasks were persisted after batch attempt
          const countAfterBatch = db
            .prepare('SELECT COUNT(*) as count FROM rpa_tasks')
            .get() as { count: number };
          expect(countAfterBatch.count).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: profile-rpa, Property 4: Ordered execution bảo toàn thứ tự
  /**
   * Property 4: Ordered execution bảo toàn thứ tự
   *
   * For any profile list with execution_order='ordered', the queue_position of tasks
   * must preserve the input order (i.e., task for profileIds[0] has lowest queue_position,
   * profileIds[1] has next, etc.)
   *
   * **Validates: Requirements 2.2**
   */
  it('Property 4: For any profile list with execution_order=ordered, queue_positions preserve input order', () => {
    fc.assert(
      fc.property(
        profileIdsArb,
        scriptIdArb,
        taskTypeArb,
        priorityArb,
        (profileIds, scriptId, taskType, priority) => {
          // Clean up tasks from previous iteration
          db.prepare('DELETE FROM rpa_tasks').run();

          // Ensure all profiles exist in the DB
          for (const profileId of profileIds) {
            ensureProfileExists(profileId);
          }

          // Ensure the script exists in the DB
          ensureScriptExists(scriptId);

          // Build the batch config with executionOrder='ordered'
          const config: BatchExecuteConfig = {
            scriptId,
            profileIds,
            executionOrder: 'ordered',
            taskType,
            priority,
          };

          // Create batch tasks
          const tasks = orchestrator.createBatchTasks(config);

          // Property: tasks are created in the same order as profileIds input
          expect(tasks.length).toBe(profileIds.length);

          // Verify queue_positions are strictly increasing in input order
          for (let i = 0; i < tasks.length; i++) {
            // Each task corresponds to the i-th profileId in the input
            expect(tasks[i].profileId).toBe(profileIds[i]);
          }

          // Verify queue_positions from DB preserve the input order
          // Fetch tasks ordered by queue_position and confirm they match input order
          const batchId = tasks[0].batchId;
          const dbTasks = db
            .prepare(
              `SELECT profile_id, queue_position FROM rpa_tasks
               WHERE batch_id = ?
               ORDER BY queue_position ASC`
            )
            .all(batchId) as Array<{ profile_id: string; queue_position: number }>;

          // The order of tasks by queue_position must match the input profileIds order
          for (let i = 0; i < profileIds.length; i++) {
            expect(dbTasks[i].profile_id).toBe(profileIds[i]);
          }

          // Additionally verify queue_positions are strictly increasing
          for (let i = 1; i < dbTasks.length; i++) {
            expect(dbTasks[i].queue_position).toBeGreaterThan(dbTasks[i - 1].queue_position);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: profile-rpa, Property 1: Batch task creation tạo đúng số lượng task
  it('Property 1: createBatchTasks creates exactly N tasks with correct associations', () => {
    fc.assert(
      fc.property(
        profileIdsArb,
        scriptIdArb,
        executionOrderArb,
        taskTypeArb,
        priorityArb,
        (profileIds, scriptId, executionOrder, taskType, priority) => {
          // Clean up tasks from previous iteration
          db.prepare('DELETE FROM rpa_tasks').run();

          // Ensure all profiles exist in the DB
          for (const profileId of profileIds) {
            ensureProfileExists(profileId);
          }

          // Ensure the script exists in the DB
          ensureScriptExists(scriptId);

          // Build the batch config
          const config: BatchExecuteConfig = {
            scriptId,
            profileIds,
            executionOrder,
            taskType,
            priority,
          };

          // Create batch tasks
          const tasks = orchestrator.createBatchTasks(config);

          // Property: exactly N tasks are created (N = profileIds.length)
          expect(tasks.length).toBe(profileIds.length);

          // Property: each task has the correct scriptId
          for (const task of tasks) {
            expect(task.scriptId).toBe(scriptId);
          }

          // Property: the set of profileIds in tasks matches the input set exactly
          const taskProfileIds = new Set(tasks.map((t) => t.profileId));
          const inputProfileIds = new Set(profileIds);
          expect(taskProfileIds).toEqual(inputProfileIds);

          // Property: each task is associated with a unique profile from the input
          expect(taskProfileIds.size).toBe(profileIds.length);

          // Property: all tasks share the same batchId
          const batchIds = new Set(tasks.map((t) => t.batchId));
          expect(batchIds.size).toBe(1);
          expect(tasks[0].batchId).toBeDefined();

          // Property: all tasks are persisted in the database
          const dbCount = db
            .prepare('SELECT COUNT(*) as count FROM rpa_tasks WHERE batch_id = ?')
            .get(tasks[0].batchId) as { count: number };
          expect(dbCount.count).toBe(profileIds.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});
