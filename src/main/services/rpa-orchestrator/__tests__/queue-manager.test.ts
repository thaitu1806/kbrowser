import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeDatabase } from '../../../database/index';
import { QueueManager } from '../queue-manager';
import type { RPATask } from '../../../../shared/types/rpa-orchestrator';
import path from 'path';
import fs from 'fs';
import os from 'os';

function createTask(overrides: Partial<RPATask> = {}): RPATask {
  const now = new Date().toISOString();
  return {
    id: `task-${Math.random().toString(36).slice(2)}`,
    profileId: 'p1',
    scriptId: 's1',
    status: 'pending',
    executionOrder: 'ordered',
    taskType: 'common',
    priority: false,
    queuePosition: 0,
    actionsCompleted: 0,
    totalActions: 5,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('QueueManager', () => {
  let db: Database.Database;
  let dbPath: string;
  let queueManager: QueueManager;

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `test-queue-manager-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
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

  describe('dequeue on empty queue', () => {
    it('should return null when dequeue is called on an empty queue', () => {
      const result = queueManager.dequeue('p1');
      expect(result).toBeNull();
    });

    it('should return null when dequeue is called for a profile with no pending tasks', () => {
      // Add a task and mark it completed
      const task = createTask({ id: 'task-1', profileId: 'p1' });
      queueManager.enqueue(task);
      queueManager.updateStatus('task-1', 'completed');

      const result = queueManager.dequeue('p1');
      expect(result).toBeNull();
    });
  });

  describe('dequeueNext on empty queue', () => {
    it('should return null when dequeueNext is called with no pending tasks globally', () => {
      const result = queueManager.dequeueNext();
      expect(result).toBeNull();
    });

    it('should return null when all tasks are completed or cancelled', () => {
      const task1 = createTask({ id: 'task-1', profileId: 'p1' });
      const task2 = createTask({ id: 'task-2', profileId: 'p2' });
      queueManager.enqueue(task1);
      queueManager.enqueue(task2);
      queueManager.updateStatus('task-1', 'completed');
      queueManager.updateStatus('task-2', 'cancelled');

      const result = queueManager.dequeueNext();
      expect(result).toBeNull();
    });
  });

  describe('peek on empty queue', () => {
    it('should return null when peek is called on an empty queue', () => {
      const result = queueManager.peek('p1');
      expect(result).toBeNull();
    });

    it('should return null when peek is called for a profile with only running tasks', () => {
      const task = createTask({ id: 'task-1', profileId: 'p1' });
      queueManager.enqueue(task);
      queueManager.dequeue('p1'); // transitions to running

      const result = queueManager.peek('p1');
      expect(result).toBeNull();
    });
  });

  describe('duplicate task IDs', () => {
    it('should throw when inserting a task with a duplicate ID', () => {
      const task1 = createTask({ id: 'dup-id', profileId: 'p1' });
      const task2 = createTask({ id: 'dup-id', profileId: 'p1' });

      queueManager.enqueue(task1);
      expect(() => queueManager.enqueue(task2)).toThrow();
    });

    it('should throw when inserting a priority task with a duplicate ID', () => {
      const task1 = createTask({ id: 'dup-id', profileId: 'p1' });
      const task2 = createTask({ id: 'dup-id', profileId: 'p1', priority: true });

      queueManager.enqueue(task1);
      expect(() => queueManager.enqueuePriority(task2)).toThrow();
    });
  });

  describe('queue ordering after multiple enqueue/dequeue cycles', () => {
    it('should maintain FIFO order for normal enqueue operations', () => {
      const task1 = createTask({ id: 'task-1', profileId: 'p1' });
      const task2 = createTask({ id: 'task-2', profileId: 'p1' });
      const task3 = createTask({ id: 'task-3', profileId: 'p1' });

      queueManager.enqueue(task1);
      queueManager.enqueue(task2);
      queueManager.enqueue(task3);

      const dequeued1 = queueManager.dequeue('p1');
      const dequeued2 = queueManager.dequeue('p1');
      const dequeued3 = queueManager.dequeue('p1');

      expect(dequeued1?.id).toBe('task-1');
      expect(dequeued2?.id).toBe('task-2');
      expect(dequeued3?.id).toBe('task-3');
    });

    it('should place priority tasks before normal tasks', () => {
      const task1 = createTask({ id: 'task-1', profileId: 'p1' });
      const task2 = createTask({ id: 'task-2', profileId: 'p1' });
      const priorityTask = createTask({ id: 'task-priority', profileId: 'p1', priority: true });

      queueManager.enqueue(task1);
      queueManager.enqueue(task2);
      queueManager.enqueuePriority(priorityTask);

      const dequeued1 = queueManager.dequeue('p1');
      expect(dequeued1?.id).toBe('task-priority');
    });

    it('should maintain correct order after interleaved enqueue and dequeue', () => {
      const task1 = createTask({ id: 'task-1', profileId: 'p1' });
      const task2 = createTask({ id: 'task-2', profileId: 'p1' });

      queueManager.enqueue(task1);
      const dequeued1 = queueManager.dequeue('p1');
      expect(dequeued1?.id).toBe('task-1');

      queueManager.enqueue(task2);
      const task3 = createTask({ id: 'task-3', profileId: 'p1' });
      queueManager.enqueue(task3);

      const dequeued2 = queueManager.dequeue('p1');
      const dequeued3 = queueManager.dequeue('p1');
      expect(dequeued2?.id).toBe('task-2');
      expect(dequeued3?.id).toBe('task-3');
    });

    it('should handle multiple priority tasks in LIFO order (last priority added is first out)', () => {
      const task1 = createTask({ id: 'task-1', profileId: 'p1' });
      queueManager.enqueue(task1);

      const priority1 = createTask({ id: 'priority-1', profileId: 'p1', priority: true });
      queueManager.enqueuePriority(priority1);

      const priority2 = createTask({ id: 'priority-2', profileId: 'p1', priority: true });
      queueManager.enqueuePriority(priority2);

      const dequeued1 = queueManager.dequeue('p1');
      const dequeued2 = queueManager.dequeue('p1');
      const dequeued3 = queueManager.dequeue('p1');

      expect(dequeued1?.id).toBe('priority-2');
      expect(dequeued2?.id).toBe('priority-1');
      expect(dequeued3?.id).toBe('task-1');
    });
  });

  describe('getRunningCount accuracy', () => {
    it('should return 0 when no tasks are running', () => {
      expect(queueManager.getRunningCount()).toBe(0);
    });

    it('should return correct count after dequeue transitions tasks to running', () => {
      const task1 = createTask({ id: 'task-1', profileId: 'p1' });
      const task2 = createTask({ id: 'task-2', profileId: 'p2' });

      queueManager.enqueue(task1);
      queueManager.enqueue(task2);

      queueManager.dequeue('p1');
      expect(queueManager.getRunningCount()).toBe(1);

      queueManager.dequeue('p2');
      expect(queueManager.getRunningCount()).toBe(2);
    });

    it('should decrease running count when tasks complete', () => {
      const task1 = createTask({ id: 'task-1', profileId: 'p1' });
      const task2 = createTask({ id: 'task-2', profileId: 'p2' });

      queueManager.enqueue(task1);
      queueManager.enqueue(task2);
      queueManager.dequeue('p1');
      queueManager.dequeue('p2');

      expect(queueManager.getRunningCount()).toBe(2);

      queueManager.updateStatus('task-1', 'completed');
      expect(queueManager.getRunningCount()).toBe(1);

      queueManager.updateStatus('task-2', 'failed');
      expect(queueManager.getRunningCount()).toBe(0);
    });
  });

  describe('getAllPending returns all pending tasks across profiles', () => {
    it('should return empty array when no pending tasks exist', () => {
      const result = queueManager.getAllPending();
      expect(result).toEqual([]);
    });

    it('should return pending tasks from multiple profiles', () => {
      const task1 = createTask({ id: 'task-1', profileId: 'p1' });
      const task2 = createTask({ id: 'task-2', profileId: 'p2' });
      const task3 = createTask({ id: 'task-3', profileId: 'p1' });

      queueManager.enqueue(task1);
      queueManager.enqueue(task2);
      queueManager.enqueue(task3);

      const pending = queueManager.getAllPending();
      expect(pending).toHaveLength(3);

      const ids = pending.map((t) => t.id);
      expect(ids).toContain('task-1');
      expect(ids).toContain('task-2');
      expect(ids).toContain('task-3');
    });

    it('should not include running, completed, or cancelled tasks', () => {
      const task1 = createTask({ id: 'task-1', profileId: 'p1' });
      const task2 = createTask({ id: 'task-2', profileId: 'p1' });
      const task3 = createTask({ id: 'task-3', profileId: 'p2' });

      queueManager.enqueue(task1);
      queueManager.enqueue(task2);
      queueManager.enqueue(task3);

      queueManager.dequeue('p1'); // task-1 becomes running
      queueManager.updateStatus('task-3', 'cancelled');

      const pending = queueManager.getAllPending();
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe('task-2');
    });
  });

  describe('updateStatus transitions', () => {
    it('should update status from pending to running and set startedAt', () => {
      const task = createTask({ id: 'task-1', profileId: 'p1' });
      queueManager.enqueue(task);

      queueManager.updateStatus('task-1', 'running');

      const queue = db.prepare('SELECT * FROM rpa_tasks WHERE id = ?').get('task-1') as Record<string, unknown>;
      expect(queue.status).toBe('running');
      expect(queue.started_at).not.toBeNull();
    });

    it('should update status to completed and set completedAt', () => {
      const task = createTask({ id: 'task-1', profileId: 'p1' });
      queueManager.enqueue(task);
      queueManager.updateStatus('task-1', 'running');

      queueManager.updateStatus('task-1', 'completed');

      const row = db.prepare('SELECT * FROM rpa_tasks WHERE id = ?').get('task-1') as Record<string, unknown>;
      expect(row.status).toBe('completed');
      expect(row.completed_at).not.toBeNull();
    });

    it('should update status to failed and set completedAt', () => {
      const task = createTask({ id: 'task-1', profileId: 'p1' });
      queueManager.enqueue(task);
      queueManager.updateStatus('task-1', 'running');

      queueManager.updateStatus('task-1', 'failed');

      const row = db.prepare('SELECT * FROM rpa_tasks WHERE id = ?').get('task-1') as Record<string, unknown>;
      expect(row.status).toBe('failed');
      expect(row.completed_at).not.toBeNull();
    });

    it('should update status to cancelled without setting completedAt', () => {
      const task = createTask({ id: 'task-1', profileId: 'p1' });
      queueManager.enqueue(task);

      queueManager.updateStatus('task-1', 'cancelled');

      const row = db.prepare('SELECT * FROM rpa_tasks WHERE id = ?').get('task-1') as Record<string, unknown>;
      expect(row.status).toBe('cancelled');
      expect(row.completed_at).toBeNull();
    });
  });

  describe('remove() removes task from queue', () => {
    it('should mark a pending task as cancelled', () => {
      const task = createTask({ id: 'task-1', profileId: 'p1' });
      queueManager.enqueue(task);

      queueManager.remove('task-1');

      const row = db.prepare('SELECT * FROM rpa_tasks WHERE id = ?').get('task-1') as Record<string, unknown>;
      expect(row.status).toBe('cancelled');
    });

    it('should not be returned by dequeue after removal', () => {
      const task1 = createTask({ id: 'task-1', profileId: 'p1' });
      const task2 = createTask({ id: 'task-2', profileId: 'p1' });

      queueManager.enqueue(task1);
      queueManager.enqueue(task2);

      queueManager.remove('task-1');

      const dequeued = queueManager.dequeue('p1');
      expect(dequeued?.id).toBe('task-2');
    });

    it('should not appear in getQueue after removal', () => {
      const task1 = createTask({ id: 'task-1', profileId: 'p1' });
      const task2 = createTask({ id: 'task-2', profileId: 'p1' });

      queueManager.enqueue(task1);
      queueManager.enqueue(task2);

      queueManager.remove('task-1');

      const queue = queueManager.getQueue('p1');
      expect(queue).toHaveLength(1);
      expect(queue[0].id).toBe('task-2');
    });

    it('should not appear in getAllPending after removal', () => {
      const task = createTask({ id: 'task-1', profileId: 'p1' });
      queueManager.enqueue(task);

      queueManager.remove('task-1');

      const pending = queueManager.getAllPending();
      expect(pending).toHaveLength(0);
    });
  });

  describe('getQueue returns profile-specific pending tasks', () => {
    it('should return only pending tasks for the specified profile', () => {
      const task1 = createTask({ id: 'task-1', profileId: 'p1' });
      const task2 = createTask({ id: 'task-2', profileId: 'p2' });
      const task3 = createTask({ id: 'task-3', profileId: 'p1' });

      queueManager.enqueue(task1);
      queueManager.enqueue(task2);
      queueManager.enqueue(task3);

      const p1Queue = queueManager.getQueue('p1');
      expect(p1Queue).toHaveLength(2);
      expect(p1Queue[0].id).toBe('task-1');
      expect(p1Queue[1].id).toBe('task-3');

      const p2Queue = queueManager.getQueue('p2');
      expect(p2Queue).toHaveLength(1);
      expect(p2Queue[0].id).toBe('task-2');
    });

    it('should return tasks ordered by queue_position', () => {
      const task1 = createTask({ id: 'task-1', profileId: 'p1' });
      const task2 = createTask({ id: 'task-2', profileId: 'p1' });
      const priorityTask = createTask({ id: 'task-priority', profileId: 'p1', priority: true });

      queueManager.enqueue(task1);
      queueManager.enqueue(task2);
      queueManager.enqueuePriority(priorityTask);

      const queue = queueManager.getQueue('p1');
      expect(queue[0].id).toBe('task-priority');
      expect(queue[1].id).toBe('task-1');
      expect(queue[2].id).toBe('task-2');
    });
  });
});
