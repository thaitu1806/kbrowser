/**
 * RPA Orchestrator
 *
 * Main entry point for the RPA Orchestrator module.
 * Wires together QueueManager, Scheduler, ConcurrencyController, and ConfigStore
 * to provide a unified API for task creation, cancellation, scheduling,
 * configuration, and query operations.
 *
 * Extends EventEmitter to support real-time status updates via IPC events.
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type {
  RPATask,
  RPASchedule,
  ProfileRPAConfig,
  BatchExecuteConfig,
  BatchReport,
  ScheduleConfig,
  TaskStatus,
  TaskProgressEvent,
} from '../../../shared/types/rpa-orchestrator';
import { QueueManager } from './queue-manager';
import { Scheduler } from './scheduler';
import { ConcurrencyController } from './concurrency-controller';
import { ConfigStore } from './config-store';
import type { LoadConfigResult } from './config-store';

/** Default maximum concurrency if not specified */
const DEFAULT_MAX_CONCURRENCY = 3;

/** Interval in milliseconds for the queue processing loop */
const PROCESSING_INTERVAL_MS = 500;

/** Tracks batch execution state */
interface BatchTracker {
  batchId: string;
  totalProfiles: number;
  successCount: number;
  failureCount: number;
  errors: Array<{ profileId: string; error: string }>;
  startedAt: string;
  taskIds: Set<string>;
  resolve: (report: BatchReport) => void;
}

export class RPAOrchestrator extends EventEmitter {
  private db: Database.Database;
  private profileManager: any;
  private rpaEngine: any;
  private queueManager: QueueManager;
  private scheduler: Scheduler;
  private concurrencyController: ConcurrencyController;
  private configStore: ConfigStore;

  /** Whether queue processing is currently active */
  private isProcessing: boolean = false;

  /** Interval ID for the processing loop */
  private processingIntervalId: ReturnType<typeof setInterval> | null = null;

  /** Map of batchId → BatchTracker for tracking batch completion */
  private batchTrackers: Map<string, BatchTracker> = new Map();

  constructor(
    db: Database.Database,
    profileManager: any,
    rpaEngine: any,
    options?: { maxConcurrency?: number }
  ) {
    super();
    this.db = db;
    this.profileManager = profileManager;
    this.rpaEngine = rpaEngine;

    const maxConcurrency = options?.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;

    this.queueManager = new QueueManager(db);
    this.concurrencyController = new ConcurrencyController(maxConcurrency);
    this.configStore = new ConfigStore(db);
    this.scheduler = new Scheduler(db, this.queueManager);
  }

  // ─── Task Management ───────────────────────────────────────────────────────

  /**
   * Create a single RPA task for a profile.
   * Validates that the script exists, creates the task, and enqueues it.
   * If config.priority is true, the task is placed at the front of the queue.
   */
  createTask(profileId: string, scriptId: string, config: Partial<BatchExecuteConfig>): RPATask {
    if (!this.configStore.validateScriptExists(scriptId)) {
      throw new Error(`Script not found: ${scriptId}`);
    }

    const now = new Date().toISOString();
    const task: RPATask = {
      id: randomUUID(),
      profileId,
      scriptId,
      status: 'pending',
      executionOrder: config.executionOrder ?? 'ordered',
      taskType: config.taskType ?? 'common',
      priority: config.priority ?? false,
      queuePosition: 0, // Will be set by enqueue/enqueuePriority
      actionsCompleted: 0,
      totalActions: 0,
      createdAt: now,
      updatedAt: now,
    };

    if (config.priority) {
      this.queueManager.enqueuePriority(task);
    } else {
      this.queueManager.enqueue(task);
    }

    return task;
  }

  /**
   * Create batch tasks for multiple profiles.
   * Validates script exists, creates one task per profile.
   * If executionOrder is 'random', shuffles the profileIds before creating tasks.
   * All tasks share the same batchId.
   */
  createBatchTasks(config: BatchExecuteConfig): RPATask[] {
    if (!this.configStore.validateScriptExists(config.scriptId)) {
      throw new Error(`Script not found: ${config.scriptId}`);
    }

    const batchId = randomUUID();
    const now = new Date().toISOString();

    // Shuffle profileIds for random execution order
    let profileIds = [...config.profileIds];
    if (config.executionOrder === 'random') {
      profileIds = shuffleArray(profileIds);
    }

    const tasks: RPATask[] = [];

    for (const profileId of profileIds) {
      const task: RPATask = {
        id: randomUUID(),
        profileId,
        scriptId: config.scriptId,
        batchId,
        status: 'pending',
        executionOrder: config.executionOrder,
        taskType: config.taskType,
        priority: config.priority,
        queuePosition: 0, // Will be set by enqueue/enqueuePriority
        actionsCompleted: 0,
        totalActions: 0,
        createdAt: now,
        updatedAt: now,
      };

      if (config.priority) {
        this.queueManager.enqueuePriority(task);
      } else {
        this.queueManager.enqueue(task);
      }

      tasks.push(task);
    }

    return tasks;
  }

  /**
   * Cancel a single task by ID.
   * Delegates to QueueManager.remove() which marks it as cancelled.
   */
  cancelTask(taskId: string): void {
    this.queueManager.remove(taskId);
  }

  /**
   * Cancel all tasks (pending and running) for a specific profile.
   * Updates each task's status to 'cancelled'.
   */
  cancelAllForProfile(profileId: string): void {
    const rows = this.db
      .prepare(
        `SELECT id FROM rpa_tasks
         WHERE profile_id = ? AND status IN ('pending', 'running')`
      )
      .all(profileId) as Array<{ id: string }>;

    for (const row of rows) {
      this.queueManager.updateStatus(row.id, 'cancelled');
    }
  }

  // ─── Queue Operations ──────────────────────────────────────────────────────

  /**
   * Get all pending tasks in the queue for a specific profile.
   */
  getQueueForProfile(profileId: string): RPATask[] {
    return this.queueManager.getQueue(profileId);
  }

  /**
   * Get all currently running tasks across all profiles.
   */
  getRunningTasks(): RPATask[] {
    const rows = this.db
      .prepare(`SELECT * FROM rpa_tasks WHERE status = 'running'`)
      .all() as Record<string, unknown>[];

    return rows.map(rowToTask);
  }

  /**
   * Get all pending tasks across all profiles.
   */
  getPendingTasks(): RPATask[] {
    return this.queueManager.getAllPending();
  }

  // ─── Execution ──────────────────────────────────────────────────────────────

  /**
   * Execute a batch of tasks.
   * Creates all tasks, starts processing, and returns a Promise<BatchReport>
   * that resolves when all tasks in the batch are complete.
   */
  async executeBatch(config: BatchExecuteConfig): Promise<BatchReport> {
    const tasks = this.createBatchTasks(config);
    const batchId = tasks[0]?.batchId;

    if (!batchId || tasks.length === 0) {
      // Edge case: empty batch
      const now = new Date().toISOString();
      const report: BatchReport = {
        batchId: batchId ?? randomUUID(),
        totalProfiles: 0,
        successCount: 0,
        failureCount: 0,
        errors: [],
        startedAt: now,
        completedAt: now,
      };
      this.emit('batch:complete', report);
      return report;
    }

    const startedAt = new Date().toISOString();

    return new Promise<BatchReport>((resolve) => {
      const tracker: BatchTracker = {
        batchId,
        totalProfiles: tasks.length,
        successCount: 0,
        failureCount: 0,
        errors: [],
        startedAt,
        taskIds: new Set(tasks.map((t) => t.id)),
        resolve,
      };

      this.batchTrackers.set(batchId, tracker);

      // Ensure queue processing is running
      if (!this.isProcessing) {
        this.startQueueProcessing();
      }
    });
  }

  /**
   * Start processing the task queue.
   * Sets a flag indicating processing is active and starts a polling loop
   * that checks for available tasks and executes them respecting concurrency limits.
   */
  startQueueProcessing(): void {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    this.processingIntervalId = setInterval(() => {
      this.processNextTask();
    }, PROCESSING_INTERVAL_MS);
  }

  /**
   * Stop processing the task queue.
   * Clears the processing interval and sets the processing flag to false.
   */
  stopQueueProcessing(): void {
    if (this.processingIntervalId !== null) {
      clearInterval(this.processingIntervalId);
      this.processingIntervalId = null;
    }
    this.isProcessing = false;
  }

  // ─── Private Execution Methods ─────────────────────────────────────────────

  /**
   * Process the next available task from the queue.
   * Called on each tick of the processing loop.
   */
  private processNextTask(): void {
    // Check if concurrency limit is reached
    if (this.concurrencyController.isFull()) {
      return;
    }

    // Dequeue next pending task
    const task = this.queueManager.dequeueNext();
    if (!task) {
      return;
    }

    // Acquire concurrency slot
    if (!this.concurrencyController.acquire()) {
      // Slot not available — put task back to pending
      // Note: dequeueNext already set it to 'running', revert it
      this.queueManager.updateStatus(task.id, 'pending');
      return;
    }

    // Execute the task asynchronously (fire and forget)
    this.executeTask(task).catch(() => {
      // Error handling is done inside executeTask
    });
  }

  /**
   * Execute a single task: open profile, run script, update status, emit events.
   */
  private async executeTask(task: RPATask): Promise<void> {
    try {
      // Open the profile
      await this.profileManager.openProfile(task.profileId);

      // Execute the script
      const result = await this.rpaEngine.executeScript(task.profileId, task.scriptId);

      if (result.success) {
        // Update task as completed
        this.updateTaskCompletion(task, 'completed', {
          actionsCompleted: result.actionsCompleted,
          totalActions: result.totalActions,
        });
      } else {
        // Update task as failed
        this.updateTaskCompletion(task, 'failed', {
          actionsCompleted: result.actionsCompleted,
          totalActions: result.totalActions,
          errorMessage: result.error,
        });
      }
    } catch (error: unknown) {
      // Handle unexpected errors (profile open failure, etc.)
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.updateTaskCompletion(task, 'failed', {
        actionsCompleted: 0,
        totalActions: 0,
        errorMessage,
      });
    } finally {
      // Release concurrency slot
      this.concurrencyController.release();

      // Handle afterTaskAction='quitBrowser'
      await this.handleAfterTaskAction(task);
    }
  }

  /**
   * Update task status after completion/failure, emit progress event,
   * and check if batch is complete.
   */
  private updateTaskCompletion(
    task: RPATask,
    status: 'completed' | 'failed',
    details: {
      actionsCompleted: number;
      totalActions: number;
      errorMessage?: string;
    }
  ): void {
    // Update status in DB
    this.queueManager.updateStatus(task.id, status);

    // Update additional fields
    const now = new Date().toISOString();
    if (details.errorMessage) {
      this.db
        .prepare(
          `UPDATE rpa_tasks SET actions_completed = ?, total_actions = ?, error_message = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(details.actionsCompleted, details.totalActions, details.errorMessage, now, task.id);
    } else {
      this.db
        .prepare(
          `UPDATE rpa_tasks SET actions_completed = ?, total_actions = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(details.actionsCompleted, details.totalActions, now, task.id);
    }

    // Emit task:progress event
    const progressEvent: TaskProgressEvent = {
      taskId: task.id,
      profileId: task.profileId,
      status,
      actionsCompleted: details.actionsCompleted,
      totalActions: details.totalActions,
      currentAction: undefined,
    };
    this.emit('task:progress', progressEvent);

    // Update batch tracker if this task belongs to a batch
    if (task.batchId) {
      this.updateBatchTracker(task.batchId, task.profileId, status, details.errorMessage);
    }
  }

  /**
   * Update the batch tracker and resolve the batch promise if all tasks are done.
   */
  private updateBatchTracker(
    batchId: string,
    profileId: string,
    status: 'completed' | 'failed',
    errorMessage?: string
  ): void {
    const tracker = this.batchTrackers.get(batchId);
    if (!tracker) {
      return;
    }

    if (status === 'completed') {
      tracker.successCount++;
    } else {
      tracker.failureCount++;
      tracker.errors.push({
        profileId,
        error: errorMessage ?? 'Unknown error',
      });
    }

    // Check if all tasks in the batch are done
    const totalDone = tracker.successCount + tracker.failureCount;
    if (totalDone >= tracker.totalProfiles) {
      const report: BatchReport = {
        batchId: tracker.batchId,
        totalProfiles: tracker.totalProfiles,
        successCount: tracker.successCount,
        failureCount: tracker.failureCount,
        errors: tracker.errors,
        startedAt: tracker.startedAt,
        completedAt: new Date().toISOString(),
      };

      // Emit batch:complete event
      this.emit('batch:complete', report);

      // Resolve the promise
      tracker.resolve(report);

      // Clean up tracker
      this.batchTrackers.delete(batchId);
    }
  }

  /**
   * Handle afterTaskAction for a completed task.
   * If the script has afterTaskAction='quitBrowser', close the profile.
   */
  private async handleAfterTaskAction(task: RPATask): Promise<void> {
    try {
      // Check if the script has an afterTaskAction configuration
      const scriptRow = this.db
        .prepare(`SELECT error_handling FROM rpa_scripts WHERE id = ?`)
        .get(task.scriptId) as { error_handling: string } | undefined;

      // For afterTaskAction, we check a convention: if the script's error_handling
      // or a separate config indicates quitBrowser. Since the schema doesn't have
      // an explicit afterTaskAction column, we look for it in the actions JSON metadata.
      // For simplicity, check if there's an 'afterTaskAction' field in the script's actions.
      const scriptData = this.db
        .prepare(`SELECT actions FROM rpa_scripts WHERE id = ?`)
        .get(task.scriptId) as { actions: string } | undefined;

      if (scriptData) {
        try {
          const actions = JSON.parse(scriptData.actions);
          // Check if the script metadata includes afterTaskAction
          if (actions.afterTaskAction === 'quitBrowser' ||
              (actions.metadata && actions.metadata.afterTaskAction === 'quitBrowser')) {
            await this.profileManager.closeProfile(task.profileId);
          }
        } catch {
          // JSON parse error — ignore, no afterTaskAction
        }
      }
    } catch {
      // Silently handle errors in afterTaskAction — don't fail the task
    }
  }

  // ─── Scheduling ────────────────────────────────────────────────────────────

  /**
   * Create a new schedule for a profile.
   * Validates script exists, creates an RPASchedule, and registers it with the Scheduler.
   */
  createSchedule(profileId: string, scriptId: string, scheduleConfig: ScheduleConfig): RPASchedule {
    if (!this.configStore.validateScriptExists(scriptId)) {
      throw new Error(`Script not found: ${scriptId}`);
    }

    const now = new Date().toISOString();
    const nextTriggerAt = this.scheduler.getNextExecutionTime(scheduleConfig.cronExpression).toISOString();

    const schedule: RPASchedule = {
      id: randomUUID(),
      profileId,
      scriptId,
      cronExpression: scheduleConfig.cronExpression,
      executionOrder: 'ordered',
      status: 'active',
      startTime: scheduleConfig.startTime,
      endTime: scheduleConfig.endTime,
      nextTriggerAt,
      createdAt: now,
      updatedAt: now,
    };

    this.scheduler.register(schedule);

    return schedule;
  }

  /**
   * Cancel a schedule by ID.
   */
  cancelSchedule(scheduleId: string): void {
    this.scheduler.cancel(scheduleId);
  }

  /**
   * Get all active schedules.
   */
  getActiveSchedules(): RPASchedule[] {
    return this.scheduler.getActive();
  }

  /**
   * Restore all active schedules from DB (e.g., after app restart).
   */
  restoreSchedules(): void {
    this.scheduler.restore();
  }

  // ─── Configuration ─────────────────────────────────────────────────────────

  /**
   * Save the RPA configuration for a profile.
   */
  saveProfileConfig(profileId: string, config: ProfileRPAConfig): void {
    this.configStore.save(profileId, config);
  }

  /**
   * Load the saved RPA configuration for a profile.
   * Returns null if no config exists.
   * Includes a scriptDeleted flag if the referenced script no longer exists.
   */
  getProfileConfig(profileId: string): LoadConfigResult | null {
    return this.configStore.load(profileId);
  }

  /**
   * Dynamically update the maximum concurrency limit.
   */
  setMaxConcurrency(max: number): void {
    this.concurrencyController.setMaxConcurrency(max);
  }

  // ─── History ───────────────────────────────────────────────────────────────

  /**
   * Get task execution history for a profile (completed and failed tasks).
   * Results are ordered by completion time descending.
   */
  getTaskHistory(profileId: string, limit: number = 50): RPATask[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM rpa_tasks
         WHERE profile_id = ? AND status IN ('completed', 'failed')
         ORDER BY completed_at DESC
         LIMIT ?`
      )
      .all(profileId, limit) as Record<string, unknown>[];

    return rows.map(rowToTask);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Fisher-Yates shuffle algorithm for randomizing array order.
 */
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

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
