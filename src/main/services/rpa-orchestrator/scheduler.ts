/**
 * Scheduler
 *
 * Manages cron-based scheduling for RPA tasks.
 * Uses node-cron for timer management and SQLite for persistence.
 * On each cron tick, creates a new task via QueueManager.
 * Supports restore after restart and auto-expiration via endTime.
 */

import type Database from 'better-sqlite3';
import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { randomUUID } from 'crypto';
import type { RPASchedule, ScheduleStatus } from '../../../shared/types/rpa-orchestrator';
import type { QueueManager } from './queue-manager';

/**
 * Maps a database row (snake_case) to an RPASchedule interface (camelCase).
 */
function rowToSchedule(row: Record<string, unknown>): RPASchedule {
  return {
    id: row.id as string,
    profileId: row.profile_id as string,
    scriptId: row.script_id as string,
    cronExpression: row.cron_expression as string,
    executionOrder: row.execution_order as RPASchedule['executionOrder'],
    status: row.status as ScheduleStatus,
    startTime: row.start_time as string | undefined,
    endTime: row.end_time as string | undefined,
    lastTriggeredAt: row.last_triggered_at as string | undefined,
    nextTriggerAt: row.next_trigger_at as string | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export class Scheduler {
  private db: Database.Database;
  private queueManager: QueueManager;
  private activeJobs: Map<string, ScheduledTask> = new Map();

  constructor(db: Database.Database, queueManager: QueueManager) {
    this.db = db;
    this.queueManager = queueManager;
  }

  /**
   * Register a new schedule: save to DB and set up a cron job.
   * On each cron tick:
   *   1. Check if endTime has passed → if so, cancel the schedule (status='expired')
   *   2. Otherwise, create a new RPATask via QueueManager.enqueue()
   *   3. Update last_triggered_at and next_trigger_at in DB
   */
  register(schedule: RPASchedule): void {
    // Insert schedule into DB
    this.db
      .prepare(
        `INSERT INTO rpa_schedules (
          id, profile_id, script_id, cron_expression, execution_order,
          status, start_time, end_time, last_triggered_at, next_trigger_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        schedule.id,
        schedule.profileId,
        schedule.scriptId,
        schedule.cronExpression,
        schedule.executionOrder,
        schedule.status,
        schedule.startTime ?? null,
        schedule.endTime ?? null,
        schedule.lastTriggeredAt ?? null,
        schedule.nextTriggerAt ?? null,
        schedule.createdAt,
        schedule.updatedAt
      );

    // Set up the cron job
    this.setupCronJob(schedule);
  }

  /**
   * Cancel a schedule: stop the cron job and update status to 'cancelled' in DB.
   */
  cancel(scheduleId: string): void {
    // Stop the cron job if active
    const job = this.activeJobs.get(scheduleId);
    if (job) {
      job.stop();
      this.activeJobs.delete(scheduleId);
    }

    // Update status in DB
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE rpa_schedules SET status = 'cancelled', updated_at = ?
         WHERE id = ?`
      )
      .run(now, scheduleId);
  }

  /**
   * Restore all active schedules from DB after restart.
   * Re-registers cron jobs for all schedules with status='active'.
   */
  restore(): void {
    const rows = this.db
      .prepare(`SELECT * FROM rpa_schedules WHERE status = 'active'`)
      .all() as Record<string, unknown>[];

    for (const row of rows) {
      const schedule = rowToSchedule(row);

      // Check if already expired before restoring
      if (schedule.endTime && new Date(schedule.endTime) <= new Date()) {
        this.expireSchedule(schedule.id);
        continue;
      }

      this.setupCronJob(schedule);
    }
  }

  /**
   * Get all schedules with status='active' from DB.
   */
  getActive(): RPASchedule[] {
    const rows = this.db
      .prepare(`SELECT * FROM rpa_schedules WHERE status = 'active'`)
      .all() as Record<string, unknown>[];

    return rows.map(rowToSchedule);
  }

  /**
   * Calculate the next execution time for a cron expression.
   * Uses a simple forward-scan approach to find the next matching time.
   */
  getNextExecutionTime(cronExpression: string): Date {
    // Parse the cron expression fields
    const parts = cronExpression.trim().split(/\s+/);
    if (parts.length < 5) {
      throw new Error(`Invalid cron expression: ${cronExpression}`);
    }

    const [minuteExpr, hourExpr, dayOfMonthExpr, monthExpr, dayOfWeekExpr] = parts;

    const now = new Date();
    // Start scanning from the next minute
    const candidate = new Date(now);
    candidate.setSeconds(0);
    candidate.setMilliseconds(0);
    candidate.setMinutes(candidate.getMinutes() + 1);

    // Scan up to 366 days ahead (covers all possible cron patterns)
    const maxIterations = 366 * 24 * 60;
    for (let i = 0; i < maxIterations; i++) {
      if (
        matchesCronField(candidate.getMonth() + 1, monthExpr) &&
        matchesCronField(candidate.getDate(), dayOfMonthExpr) &&
        matchesCronField(candidate.getDay(), dayOfWeekExpr) &&
        matchesCronField(candidate.getHours(), hourExpr) &&
        matchesCronField(candidate.getMinutes(), minuteExpr)
      ) {
        return candidate;
      }
      candidate.setMinutes(candidate.getMinutes() + 1);
    }

    // Fallback: return next minute if no match found (shouldn't happen for valid cron)
    const fallback = new Date(now);
    fallback.setSeconds(0);
    fallback.setMilliseconds(0);
    fallback.setMinutes(fallback.getMinutes() + 1);
    return fallback;
  }

  /**
   * Stop all active cron jobs and clean up.
   */
  destroy(): void {
    for (const [, job] of this.activeJobs) {
      job.stop();
    }
    this.activeJobs.clear();
  }

  /**
   * Set up a cron job for a schedule.
   */
  private setupCronJob(schedule: RPASchedule): void {
    const job = cron.schedule(schedule.cronExpression, () => {
      this.onCronTick(schedule);
    });

    this.activeJobs.set(schedule.id, job);
  }

  /**
   * Handler for each cron tick.
   * Checks expiration, creates task, and updates DB timestamps.
   */
  private onCronTick(schedule: RPASchedule): void {
    const now = new Date();

    // Check if endTime has passed → expire the schedule
    if (schedule.endTime && new Date(schedule.endTime) <= now) {
      this.expireSchedule(schedule.id);
      return;
    }

    // Create a new task via QueueManager
    const taskId = randomUUID();
    const nowISO = now.toISOString();

    this.queueManager.enqueue({
      id: taskId,
      profileId: schedule.profileId,
      scriptId: schedule.scriptId,
      status: 'pending',
      executionOrder: schedule.executionOrder,
      taskType: 'scheduled',
      priority: false,
      queuePosition: 0, // Will be set by enqueue
      actionsCompleted: 0,
      totalActions: 0,
      createdAt: nowISO,
      updatedAt: nowISO,
    });

    // Calculate next trigger time
    const nextTriggerAt = this.getNextExecutionTime(schedule.cronExpression).toISOString();

    // Update last_triggered_at and next_trigger_at in DB
    this.db
      .prepare(
        `UPDATE rpa_schedules
         SET last_triggered_at = ?, next_trigger_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(nowISO, nextTriggerAt, nowISO, schedule.id);
  }

  /**
   * Mark a schedule as expired and stop its cron job.
   */
  private expireSchedule(scheduleId: string): void {
    // Stop the cron job
    const job = this.activeJobs.get(scheduleId);
    if (job) {
      job.stop();
      this.activeJobs.delete(scheduleId);
    }

    // Update status in DB
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE rpa_schedules SET status = 'expired', updated_at = ?
         WHERE id = ?`
      )
      .run(now, scheduleId);
  }
}

/**
 * Check if a value matches a cron field expression.
 * Supports: *, specific numbers, ranges (1-5), steps (asterisk/5), lists (1,3,5)
 */
function matchesCronField(value: number, expression: string): boolean {
  if (expression === '*') {
    return true;
  }

  // Handle lists (e.g., "1,3,5")
  const parts = expression.split(',');
  for (const part of parts) {
    if (matchesCronPart(value, part.trim())) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a value matches a single cron part (number, range, or step).
 */
function matchesCronPart(value: number, part: string): boolean {
  // Handle step values (e.g., "*/5" or "1-10/2")
  if (part.includes('/')) {
    const [rangeStr, stepStr] = part.split('/');
    const step = parseInt(stepStr, 10);

    if (rangeStr === '*') {
      return value % step === 0;
    }

    if (rangeStr.includes('-')) {
      const [startStr, endStr] = rangeStr.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      return value >= start && value <= end && (value - start) % step === 0;
    }

    const start = parseInt(rangeStr, 10);
    return value >= start && (value - start) % step === 0;
  }

  // Handle ranges (e.g., "1-5")
  if (part.includes('-')) {
    const [startStr, endStr] = part.split('-');
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    return value >= start && value <= end;
  }

  // Handle specific number
  return value === parseInt(part, 10);
}
