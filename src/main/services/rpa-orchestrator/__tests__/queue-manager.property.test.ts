// Feature: profile-rpa, Property 3: Priority task luôn ở đầu hàng đợi
/**
 * Property-Based Test: Priority task ordering
 *
 * For any queue with N pending tasks, a new priority task must have the smallest
 * queue_position among all pending tasks for that profile.
 *
 * **Validates: Requirements 2.5**
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import Database from 'better-sqlite3';
import { initializeDatabase } from '../../../database/index';
import { QueueManager } from '../queue-manager';
import type { RPATask } from '../../../../shared/types/rpa-orchestrator';
import path from 'path';
import fs from 'fs';
import os from 'os';

describe('QueueManager Property Tests', () => {
  let db: Database.Database;
  let dbPath: string;
  let queueManager: QueueManager;

  const PROFILE_ID = 'p1';
  const SCRIPT_ID = 's1';

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `test-queue-prop-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    );
    db = initializeDatabase(dbPath);

    // Insert prerequisite data: user, profile, rpa_script
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
   * Helper: create an RPATask object with given id and priority flag.
   */
  function createTask(id: string, priority: boolean): RPATask {
    const now = new Date().toISOString();
    return {
      id,
      profileId: PROFILE_ID,
      scriptId: SCRIPT_ID,
      status: 'pending',
      executionOrder: 'ordered',
      taskType: 'common',
      priority,
      queuePosition: 0, // Will be assigned by enqueue/enqueuePriority
      actionsCompleted: 0,
      totalActions: 5,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Helper: create an RPATask object with given id, profileId, and priority flag.
   */
  function createTaskForProfile(id: string, profileId: string, priority: boolean): RPATask {
    const now = new Date().toISOString();
    return {
      id,
      profileId,
      scriptId: SCRIPT_ID,
      status: 'pending',
      executionOrder: 'ordered',
      taskType: 'common',
      priority,
      queuePosition: 0, // Will be assigned by enqueue/enqueuePriority
      actionsCompleted: 0,
      totalActions: 5,
      createdAt: now,
      updatedAt: now,
    };
  }

  // Feature: profile-rpa, Property 3: Priority task luôn ở đầu hàng đợi
  it('Property 3: priority task always gets the smallest queue_position among pending tasks', () => {
    fc.assert(
      fc.property(
        // Generate a number of normal tasks to pre-populate the queue (1 to 20)
        fc.integer({ min: 1, max: 20 }),
        (numExistingTasks) => {
          // Clear the rpa_tasks table for a fresh run
          db.prepare('DELETE FROM rpa_tasks').run();

          // Enqueue N normal (non-priority) tasks
          for (let i = 0; i < numExistingTasks; i++) {
            const task = createTask(`task-normal-${i}`, false);
            queueManager.enqueue(task);
          }

          // Verify we have N pending tasks
          const pendingBefore = queueManager.getQueue(PROFILE_ID);
          expect(pendingBefore).toHaveLength(numExistingTasks);

          // Now enqueue a priority task
          const priorityTask = createTask('task-priority', true);
          queueManager.enqueuePriority(priorityTask);

          // Get all pending tasks after priority enqueue
          const pendingAfter = queueManager.getQueue(PROFILE_ID);
          expect(pendingAfter).toHaveLength(numExistingTasks + 1);

          // The priority task must have the smallest queue_position
          const priorityTaskInQueue = pendingAfter.find((t) => t.id === 'task-priority');
          expect(priorityTaskInQueue).toBeDefined();

          const allPositions = pendingAfter.map((t) => t.queuePosition);
          const minPosition = Math.min(...allPositions);

          expect(priorityTaskInQueue!.queuePosition).toBe(minPosition);

          // Additionally, the priority task should be the first in the ordered queue
          // (getQueue returns ordered by queue_position ASC)
          expect(pendingAfter[0].id).toBe('task-priority');
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: profile-rpa, Property 6: Queue isolation — hàng đợi độc lập giữa các hồ sơ
  it('Property 6: adding a task to profile A queue does not change profile B queue', () => {
    /**
     * Property-Based Test: Queue isolation
     *
     * For any two profiles A and B, adding a task to A's queue does not change B's queue
     * (same count and same task IDs).
     *
     * **Validates: Requirements 3.1**
     */
    fc.assert(
      fc.property(
        // Generate number of tasks for profile A (1 to 10)
        fc.integer({ min: 1, max: 10 }),
        // Generate number of pre-existing tasks for profile B (0 to 10)
        fc.integer({ min: 0, max: 10 }),
        // Generate number of new tasks to add to profile A (1 to 10)
        fc.integer({ min: 1, max: 10 }),
        (numTasksA, numTasksB, numNewTasksA) => {
          // Clear the rpa_tasks table for a fresh run
          db.prepare('DELETE FROM rpa_tasks').run();

          const profileA = 'p1';
          const profileB = 'p2';

          // Pre-populate profile A's queue
          for (let i = 0; i < numTasksA; i++) {
            const task = createTaskForProfile(`a-existing-${i}`, profileA, false);
            queueManager.enqueue(task);
          }

          // Pre-populate profile B's queue
          for (let i = 0; i < numTasksB; i++) {
            const task = createTaskForProfile(`b-existing-${i}`, profileB, false);
            queueManager.enqueue(task);
          }

          // Snapshot profile B's queue before adding tasks to A
          const queueBBefore = queueManager.getQueue(profileB);
          const queueBBeforeIds = queueBBefore.map((t) => t.id);
          const queueBBeforeCount = queueBBefore.length;

          // Add new tasks to profile A's queue
          for (let i = 0; i < numNewTasksA; i++) {
            const task = createTaskForProfile(`a-new-${i}`, profileA, false);
            queueManager.enqueue(task);
          }

          // Verify profile B's queue is unchanged
          const queueBAfter = queueManager.getQueue(profileB);
          const queueBAfterIds = queueBAfter.map((t) => t.id);
          const queueBAfterCount = queueBAfter.length;

          // Same count
          expect(queueBAfterCount).toBe(queueBBeforeCount);

          // Same task IDs (in same order)
          expect(queueBAfterIds).toEqual(queueBBeforeIds);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: profile-rpa, Property 7: Enqueue appends với status pending
  it('Property 7: new non-priority task has status=pending and queue_position greater than all existing tasks', () => {
    /**
     * Property-Based Test: Enqueue appends with status pending
     *
     * For any profile with a running task and N existing pending tasks,
     * a new non-priority task must have status='pending' and queue_position
     * greater than all existing tasks' queue_positions.
     *
     * **Validates: Requirements 3.2**
     */
    fc.assert(
      fc.property(
        // Generate number of existing pending tasks (1 to 15)
        fc.integer({ min: 1, max: 15 }),
        (numExistingTasks) => {
          // Clear the rpa_tasks table for a fresh run
          db.prepare('DELETE FROM rpa_tasks').run();

          // Enqueue a task and set it to running to simulate a profile with a running task
          const runningTask = createTask('task-running', false);
          queueManager.enqueue(runningTask);
          queueManager.updateStatus('task-running', 'running');

          // Enqueue N pending tasks
          for (let i = 0; i < numExistingTasks; i++) {
            const task = createTask(`task-existing-${i}`, false);
            queueManager.enqueue(task);
          }

          // Record all existing pending tasks' queue_positions before adding new task
          const pendingBefore = queueManager.getQueue(PROFILE_ID);
          const existingPositions = pendingBefore.map((t) => t.queuePosition);
          const maxExistingPosition = Math.max(...existingPositions);

          // Enqueue a new non-priority task
          const newTask = createTask('task-new', false);
          queueManager.enqueue(newTask);

          // Retrieve the new task from the queue
          const pendingAfter = queueManager.getQueue(PROFILE_ID);
          const newTaskInQueue = pendingAfter.find((t) => t.id === 'task-new');

          // The new task must exist in the pending queue
          expect(newTaskInQueue).toBeDefined();

          // The new task must have status='pending'
          expect(newTaskInQueue!.status).toBe('pending');

          // The new task's queue_position must be greater than all existing tasks' positions
          expect(newTaskInQueue!.queuePosition).toBeGreaterThan(maxExistingPosition);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: profile-rpa, Property 9: Cancellation of pending tasks
  it('Property 9: after cancellation, a pending task has status cancelled and is not picked up by dequeue', () => {
    /**
     * Property-Based Test: Cancellation of pending tasks
     *
     * For any pending task, after calling updateStatus(taskId, 'cancelled') or remove(taskId),
     * the task's status is 'cancelled' and it is not returned by dequeue() or dequeueNext().
     *
     * **Validates: Requirements 3.4**
     */
    fc.assert(
      fc.property(
        // Generate number of pending tasks (2 to 15) — at least 2 so we can cancel one and check dequeue
        fc.integer({ min: 2, max: 15 }),
        // Generate which task index to cancel (0-based, will be clamped to valid range)
        fc.integer({ min: 0, max: 14 }),
        // Choose cancellation method: true = remove(), false = updateStatus(_, 'cancelled')
        fc.boolean(),
        (numTasks, cancelIndexRaw, useRemove) => {
          // Clear the rpa_tasks table for a fresh run
          db.prepare('DELETE FROM rpa_tasks').run();

          // Clamp cancel index to valid range
          const cancelIndex = cancelIndexRaw % numTasks;

          // Enqueue N pending tasks
          const taskIds: string[] = [];
          for (let i = 0; i < numTasks; i++) {
            const taskId = `task-${i}`;
            taskIds.push(taskId);
            const task = createTask(taskId, false);
            queueManager.enqueue(task);
          }

          // Verify all tasks are pending
          const pendingBefore = queueManager.getQueue(PROFILE_ID);
          expect(pendingBefore).toHaveLength(numTasks);

          // Cancel the selected task using one of the two methods
          const cancelledTaskId = taskIds[cancelIndex];
          if (useRemove) {
            queueManager.remove(cancelledTaskId);
          } else {
            queueManager.updateStatus(cancelledTaskId, 'cancelled');
          }

          // Verify the cancelled task's status is 'cancelled' in the database
          const row = db
            .prepare('SELECT status FROM rpa_tasks WHERE id = ?')
            .get(cancelledTaskId) as { status: string } | undefined;
          expect(row).toBeDefined();
          expect(row!.status).toBe('cancelled');

          // Verify the cancelled task is NOT in the pending queue
          const pendingAfter = queueManager.getQueue(PROFILE_ID);
          const cancelledInQueue = pendingAfter.find((t) => t.id === cancelledTaskId);
          expect(cancelledInQueue).toBeUndefined();

          // Verify dequeue does not return the cancelled task
          // Dequeue all remaining tasks and ensure none is the cancelled one
          const dequeuedIds: string[] = [];
          let dequeued = queueManager.dequeue(PROFILE_ID);
          while (dequeued !== null) {
            dequeuedIds.push(dequeued.id);
            dequeued = queueManager.dequeue(PROFILE_ID);
          }

          // The cancelled task must never be dequeued
          expect(dequeuedIds).not.toContain(cancelledTaskId);

          // All other tasks should have been dequeued (numTasks - 1)
          expect(dequeuedIds).toHaveLength(numTasks - 1);
        }
      ),
      { numRuns: 100 }
    );
  });
});
