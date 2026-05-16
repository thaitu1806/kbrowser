/**
 * RPA Orchestrator types.
 * Types for the RPA Orchestrator module that bridges RPA Engine and Profile Manager.
 * Handles task queuing, scheduling, batch execution, and configuration persistence.
 */

/** Status of an individual RPA task in the queue */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Execution order for batch tasks */
export type ExecutionOrder = 'ordered' | 'random';

/** Type of task: common (one-shot) or scheduled (recurring) */
export type TaskType = 'common' | 'scheduled';

/** Status of a scheduled RPA execution */
export type ScheduleStatus = 'active' | 'paused' | 'cancelled' | 'expired';

/** A single RPA task representing one script execution on one profile */
export interface RPATask {
  id: string;
  profileId: string;
  scriptId: string;
  batchId?: string;
  status: TaskStatus;
  executionOrder: ExecutionOrder;
  taskType: TaskType;
  priority: boolean;
  queuePosition: number;
  actionsCompleted: number;
  totalActions: number;
  currentAction?: string;
  errorMessage?: string;
  errorDetails?: {
    actionIndex: number;
    action: string;
    screenshot?: string;
  };
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** A scheduled RPA execution configuration */
export interface RPASchedule {
  id: string;
  profileId: string;
  scriptId: string;
  cronExpression: string;
  executionOrder: ExecutionOrder;
  status: ScheduleStatus;
  startTime?: string;
  endTime?: string;
  lastTriggeredAt?: string;
  nextTriggerAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** Saved RPA configuration for a profile (last-used settings) */
export interface ProfileRPAConfig {
  profileId: string;
  scriptId?: string;
  executionOrder: ExecutionOrder;
  taskType: TaskType;
  priority: boolean;
  scheduleConfig?: {
    cronExpression: string;
    startTime?: string;
    endTime?: string;
  };
  updatedAt: string;
}

/** Summary report for a completed batch execution */
export interface BatchReport {
  batchId: string;
  totalProfiles: number;
  successCount: number;
  failureCount: number;
  errors: Array<{ profileId: string; error: string }>;
  startedAt: string;
  completedAt: string;
}

/** Real-time progress event emitted during task execution */
export interface TaskProgressEvent {
  taskId: string;
  profileId: string;
  status: TaskStatus;
  actionsCompleted: number;
  totalActions: number;
  currentAction?: string;
}

/** Configuration for batch task execution */
export interface BatchExecuteConfig {
  scriptId: string;
  profileIds: string[];
  executionOrder: ExecutionOrder;
  taskType: TaskType;
  priority: boolean;
  scheduleConfig?: ScheduleConfig;
}

/** Schedule timing configuration */
export interface ScheduleConfig {
  cronExpression: string;
  startTime?: string;
  endTime?: string;
}
