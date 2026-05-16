/**
 * Queue Manager
 *
 * Manages the RPA task queue using SQLite for persistence.
 * Each profile has an independent queue ordered by queue_position.
 * Supports priority enqueueing (front of queue) and normal enqueueing (back of queue).
 */

import type Database from 'better-sqlite3';
import type { RPATask, TaskStatus } from '../../../shared/types/rpa-orchestrator';

/**
 * Maps a database row (snake_case) to an RPATask interface (camelCase).
 */
function rowToTask(row: Record<string, unknown>): RPATask {
  return {
    id: row.id as string,
    profileId: row.profile_id as string,
    scriptId: row.script_id as string,
    batchId: row.batch_id as string | undefined,
    status: row.status as TaskStatus,
    executionOrder: row.execution_order as RPATask['executionOrder'],
    taskType: row.task_type as RPATask['taskType'],
    priority: (row.priority as number) === 1,
    queuePosition: row.queue_position as number,
    actionsCompleted: row.actions_completed as number,
    totalActions: row.total_actions as number,
    currentAction: row.current_action as string | undefined,
    errorMessage: row.error_message as string | undefined,
    errorDetails: row.error_details
      ? JSON.parse(row.error_details as string)
      : undefined,
    startedAt: row.started_at as string | undefined,
    completedAt: row.completed_at as string | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export class QueueManager {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Add a task to the end of the queue for its profile.
   * queue_position = max(queue_position) + 1 among pending tasks for that profile.
   */
  enqueue(task: RPATask): void {
    const maxPos = this.db
      .prepare(
        `SELECT MAX(queue_position) as max_pos FROM rpa_tasks
         WHERE profile_id = ? AND status = 'pending'`
      )
      .get(task.profileId) as { max_pos: number | null } | undefined;

    const queuePosition = (maxPos?.max_pos ?? -1) + 1;

    this.db
      .prepare(
        `INSERT INTO rpa_tasks (
          id, profile_id, script_id, batch_id, status, execution_order,
          task_type, priority, queue_position, actions_completed, total_actions,
          current_action, error_message, error_details, started_at, completed_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        task.id,
        task.profileId,
        task.scriptId,
        task.batchId ?? null,
        task.status,
        task.executionOrder,
        task.taskType,
        task.priority ? 1 : 0,
        queuePosition,
        task.actionsCompleted,
        task.totalActions,
        task.currentAction ?? null,
        task.errorMessage ?? null,
        task.errorDetails ? JSON.stringify(task.errorDetails) : null,
        task.startedAt ?? null,
        task.completedAt ?? null,
        task.createdAt,
        task.updatedAt
      );
  }

  /**
   * Add a priority task to the front of the queue for its profile.
   * queue_position = min(queue_position) - 1 among pending tasks for that profile.
   */
  enqueuePriority(task: RPATask): void {
    const minPos = this.db
      .prepare(
        `SELECT MIN(queue_position) as min_pos FROM rpa_tasks
         WHERE profile_id = ? AND status = 'pending'`
      )
      .get(task.profileId) as { min_pos: number | null } | undefined;

    const queuePosition = (minPos?.min_pos ?? 1) - 1;

    this.db
      .prepare(
        `INSERT INTO rpa_tasks (
          id, profile_id, script_id, batch_id, status, execution_order,
          task_type, priority, queue_position, actions_completed, total_actions,
          current_action, error_message, error_details, started_at, completed_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        task.id,
        task.profileId,
        task.scriptId,
        task.batchId ?? null,
        task.status,
        task.executionOrder,
        task.taskType,
        task.priority ? 1 : 0,
        queuePosition,
        task.actionsCompleted,
        task.totalActions,
        task.currentAction ?? null,
        task.errorMessage ?? null,
        task.errorDetails ? JSON.stringify(task.errorDetails) : null,
        task.startedAt ?? null,
        task.completedAt ?? null,
        task.createdAt,
        task.updatedAt
      );
  }

  /**
   * Get and dequeue the next pending task for a specific profile.
   * Returns the task with the lowest queue_position and status='pending',
   * then updates its status to 'running'.
   */
  dequeue(profileId: string): RPATask | null {
    const row = this.db
      .prepare(
        `SELECT * FROM rpa_tasks
         WHERE profile_id = ? AND status = 'pending'
         ORDER BY queue_position ASC
         LIMIT 1`
      )
      .get(profileId) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE rpa_tasks SET status = 'running', started_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(now, now, row.id);

    const task = rowToTask(row);
    task.status = 'running';
    task.startedAt = now;
    task.updatedAt = now;
    return task;
  }

  /**
   * Get and dequeue the next pending task across all profiles.
   * Returns the task with the lowest queue_position globally and status='pending',
   * then updates its status to 'running'.
   */
  dequeueNext(): RPATask | null {
    const row = this.db
      .prepare(
        `SELECT * FROM rpa_tasks
         WHERE status = 'pending'
         ORDER BY queue_position ASC
         LIMIT 1`
      )
      .get() as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE rpa_tasks SET status = 'running', started_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(now, now, row.id);

    const task = rowToTask(row);
    task.status = 'running';
    task.startedAt = now;
    task.updatedAt = now;
    return task;
  }

  /**
   * Peek at the next pending task for a profile without changing its status.
   */
  peek(profileId: string): RPATask | null {
    const row = this.db
      .prepare(
        `SELECT * FROM rpa_tasks
         WHERE profile_id = ? AND status = 'pending'
         ORDER BY queue_position ASC
         LIMIT 1`
      )
      .get(profileId) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    return rowToTask(row);
  }

  /**
   * Remove a task from the queue by marking it as cancelled.
   */
  remove(taskId: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE rpa_tasks SET status = 'cancelled', updated_at = ?
         WHERE id = ?`
      )
      .run(now, taskId);
  }

  /**
   * Get all pending tasks for a profile, ordered by queue_position.
   */
  getQueue(profileId: string): RPATask[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM rpa_tasks
         WHERE profile_id = ? AND status = 'pending'
         ORDER BY queue_position ASC`
      )
      .all(profileId) as Record<string, unknown>[];

    return rows.map(rowToTask);
  }

  /**
   * Get all pending tasks across all profiles, ordered by queue_position.
   */
  getAllPending(): RPATask[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM rpa_tasks
         WHERE status = 'pending'
         ORDER BY queue_position ASC`
      )
      .all() as Record<string, unknown>[];

    return rows.map(rowToTask);
  }

  /**
   * Update the status of a task.
   * If status is 'running', set started_at.
   * If 'completed' or 'failed', set completed_at.
   */
  updateStatus(taskId: string, status: TaskStatus): void {
    const now = new Date().toISOString();

    if (status === 'running') {
      this.db
        .prepare(
          `UPDATE rpa_tasks SET status = ?, started_at = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(status, now, now, taskId);
    } else if (status === 'completed' || status === 'failed') {
      this.db
        .prepare(
          `UPDATE rpa_tasks SET status = ?, completed_at = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(status, now, now, taskId);
    } else {
      this.db
        .prepare(
          `UPDATE rpa_tasks SET status = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(status, now, taskId);
    }
  }

  /**
   * Count tasks with status='running'.
   */
  getRunningCount(): number {
    const result = this.db
      .prepare(`SELECT COUNT(*) as count FROM rpa_tasks WHERE status = 'running'`)
      .get() as { count: number };

    return result.count;
  }
}
