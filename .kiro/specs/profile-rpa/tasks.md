# Implementation Plan: Profile-RPA Orchestrator

## Overview

This plan implements the RPA Orchestrator module — a new service that bridges the existing RPA Engine and Profile Manager. Implementation proceeds bottom-up: shared types first, then database schema, then individual sub-components (queue, concurrency, scheduler, config store), then the orchestrator itself, IPC handlers, and finally frontend integration.

## Tasks

- [ ] 1. Define shared types and project structure
  - [x] 1.1 Create shared TypeScript interfaces for RPA Orchestrator
    - Create `src/shared/types/rpa-orchestrator.ts` with all type definitions: `TaskStatus`, `ExecutionOrder`, `TaskType`, `ScheduleStatus`, `RPATask`, `RPASchedule`, `ProfileRPAConfig`, `BatchReport`, `TaskProgressEvent`, `BatchExecuteConfig`, `ScheduleConfig`
    - _Requirements: 1.2, 2.1, 2.4, 3.1, 5.1_
  - [x] 1.2 Create module directory structure and index file
    - Create `src/main/services/rpa-orchestrator/index.ts` barrel export
    - Ensure `__tests__/` directory is set up
    - _Requirements: all_

- [ ] 2. Extend database schema with RPA tables
  - [x] 2.1 Add rpa_tasks, rpa_schedules, and profile_rpa_config tables
    - Add CREATE TABLE statements to `src/main/database/schema.ts` for `rpa_tasks`, `rpa_schedules`, `profile_rpa_config` with all columns, constraints, CHECK clauses, and foreign keys as specified in design
    - Add all indexes: `idx_rpa_tasks_profile_id`, `idx_rpa_tasks_status`, `idx_rpa_tasks_batch_id`, `idx_rpa_tasks_queue_position`, `idx_rpa_schedules_profile_id`, `idx_rpa_schedules_status`, `idx_rpa_schedules_next_trigger`, `idx_profile_rpa_config_profile_id`
    - _Requirements: 3.1, 5.5, 8.3_
  - [x] 2.2 Write unit tests for schema migration
    - Verify tables are created correctly, constraints work, foreign keys cascade on delete
    - _Requirements: 3.1, 8.3_

- [ ] 3. Implement Concurrency Controller
  - [x] 3.1 Implement `src/main/services/rpa-orchestrator/concurrency-controller.ts`
    - Implement semaphore pattern with `acquire()`, `release()`, `getRunningCount()`, `getMaxConcurrency()`, `setMaxConcurrency()`, `isFull()`
    - Default maxConcurrency from constructor parameter
    - _Requirements: 3.6_
  - [x] 3.2 Write unit tests for Concurrency Controller
    - Test acquire/release cycle, boundary at max, setMaxConcurrency dynamic update
    - _Requirements: 3.6_
  - [x] 3.3 Write property test for concurrency limit enforcement
    - **Property 10: Concurrency limit enforcement**
    - For any sequence of acquire/release operations, running count never exceeds maxConcurrency
    - **Validates: Requirements 3.6**

- [ ] 4. Implement Queue Manager
  - [x] 4.1 Implement `src/main/services/rpa-orchestrator/queue-manager.ts`
    - Implement `enqueue()`, `enqueuePriority()`, `dequeue()`, `dequeueNext()`, `peek()`, `remove()`, `getQueue()`, `getAllPending()`, `updateStatus()`, `getRunningCount()`
    - Use SQLite `rpa_tasks` table for persistence
    - Priority tasks get lowest queue_position among pending tasks for their profile
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 2.5_
  - [x] 4.2 Write property test for priority task ordering
    - **Property 3: Priority task luôn ở đầu hàng đợi**
    - For any queue with N pending tasks, a new priority task must have the smallest queue_position
    - **Validates: Requirements 2.5**
  - [x] 4.3 Write property test for queue isolation
    - **Property 6: Queue isolation — hàng đợi độc lập giữa các hồ sơ**
    - For any two profiles A and B, adding a task to A's queue does not change B's queue
    - **Validates: Requirements 3.1**
  - [x] 4.4 Write property test for enqueue appends pending
    - **Property 7: Enqueue appends với status pending**
    - For any profile with a running task, a new non-priority task must have status='pending' and queue_position greater than all existing tasks
    - **Validates: Requirements 3.2**
  - [x] 4.5 Write property test for cancellation
    - **Property 9: Cancellation of pending tasks**
    - For any pending task, after cancellation its status is 'cancelled' and it is not picked up by dequeue
    - **Validates: Requirements 3.4**
  - [x] 4.6 Write unit tests for Queue Manager
    - Test edge cases: empty queue dequeue, duplicate task IDs, queue ordering after multiple enqueue/dequeue cycles
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Implement Config Store
  - [x] 6.1 Implement `src/main/services/rpa-orchestrator/config-store.ts`
    - Implement `save()`, `load()`, `delete()`, `validateScriptExists()`
    - Use `profile_rpa_config` table for persistence
    - On load, check if referenced script still exists and return warning flag if deleted
    - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - [x] 6.2 Write property test for config round-trip
    - **Property 18: Profile RPA config round-trip**
    - For any valid config, save then load for the same profileId returns identical config
    - **Validates: Requirements 8.1, 8.2**
  - [x] 6.3 Write property test for deleted script detection
    - **Property 19: Deleted script detection trong saved config**
    - For any profile with saved config pointing to a deleted scriptId, load must return a warning flag
    - **Validates: Requirements 8.4**
  - [x] 6.4 Write unit tests for Config Store
    - Test save/load/delete, overwrite existing config, validate non-existent script
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [ ] 7. Implement Scheduler
  - [x] 7.1 Implement `src/main/services/rpa-orchestrator/scheduler.ts`
    - Implement `register()`, `cancel()`, `restore()`, `getActive()`, `getNextExecutionTime()`, `destroy()`
    - Use `node-cron` for cron timer management
    - On each cron tick, create a new task via QueueManager
    - `restore()` reads active schedules from DB and re-registers timers
    - Respect endTime — auto-cancel expired schedules
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_
  - [x] 7.2 Write property test for schedule persistence round-trip
    - **Property 13: Schedule persistence round-trip**
    - For any set of active schedules saved to DB, after restore() all schedules are recovered with same cronExpression, profileId, scriptId, status
    - **Validates: Requirements 5.5**
  - [x] 7.3 Write unit tests for Scheduler
    - Test register/cancel, restore from DB, expired schedule handling, destroy cleanup, getNextExecutionTime accuracy
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [ ] 8. Implement RPA Orchestrator (main entry point)
  - [x] 8.1 Implement `src/main/services/rpa-orchestrator/rpa-orchestrator.ts`
    - Extend EventEmitter
    - Wire together QueueManager, Scheduler, ConcurrencyController, ConfigStore
    - Implement task creation: `createTask()`, `createBatchTasks()` — validate script exists, create tasks in DB, assign queue positions, shuffle for random order
    - Implement cancellation: `cancelTask()`, `cancelAllForProfile()`
    - Implement query methods: `getQueueForProfile()`, `getRunningTasks()`, `getPendingTasks()`, `getTaskHistory()`
    - Implement config methods: `saveProfileConfig()`, `getProfileConfig()`, `setMaxConcurrency()`
    - Implement scheduling: `createSchedule()`, `cancelSchedule()`, `getActiveSchedules()`, `restoreSchedules()`
    - _Requirements: 1.2, 1.3, 1.4, 2.1, 2.5, 3.4, 3.5, 5.1, 5.4, 6.4, 7.2, 8.1, 8.2_
  - [x] 8.2 Implement batch execution logic with queue processing
    - Implement `executeBatch()`, `startQueueProcessing()`, `stopQueueProcessing()`
    - Queue processing loop: check concurrency, dequeue next task, open profile via ProfileManager, execute script via RPAEngine, update status, emit progress events
    - Auto-progression: when a task completes/fails, automatically start next pending task
    - Handle afterTaskAction='quitBrowser' — close profile after task completion
    - Generate BatchReport on batch completion
    - Emit events: `task:progress`, `batch:complete`
    - _Requirements: 2.2, 2.3, 2.6, 3.3, 4.1, 4.2, 4.3, 4.4, 4.5, 6.1, 7.4, 7.5_
  - [x] 8.3 Write property test for batch task creation count
    - **Property 1: Batch task creation tạo đúng số lượng task**
    - For any non-empty profile list and valid script ID, batch creates exactly N tasks with correct associations
    - **Validates: Requirements 1.2, 1.3, 4.1**
  - [x] 8.4 Write property test for invalid script rejection
    - **Property 2: Invalid script rejection**
    - For any non-existent script ID, task creation must fail and no tasks are persisted
    - **Validates: Requirements 1.4**
  - [ ] 8.5 Write property test for ordered execution sequence
    - **Property 4: Ordered execution bảo toàn thứ tự**
    - For any profile list with execution_order='ordered', execution order matches input order
    - **Validates: Requirements 2.2**
  - [~] 8.6 Write property test for random execution coverage
    - **Property 5: Random execution bao phủ tất cả hồ sơ**
    - For any profile list with execution_order='random', all profiles are executed exactly once
    - **Validates: Requirements 2.3, 4.3**
  - [~] 8.7 Write property test for batch fault isolation
    - **Property 11: Batch fault isolation**
    - For any batch where M of K profiles fail, K-M profiles still succeed
    - **Validates: Requirements 4.4**
  - [~] 8.8 Write property test for batch report accuracy
    - **Property 12: Batch report accuracy**
    - For any completed batch, successCount + failureCount = totalProfiles and errors.length = failureCount
    - **Validates: Requirements 4.5**
  - [~] 8.9 Write property test for auto-progression
    - **Property 8: Auto-progression — task tiếp theo tự động bắt đầu**
    - For any queue with a running task and pending tasks, when running task completes, next pending task starts
    - **Validates: Requirements 3.3**
  - [~] 8.10 Write property test for common task single execution
    - **Property 20: Common task chỉ thực thi một lần**
    - For any common task that completes, it never transitions back to running
    - **Validates: Requirements 2.6**
  - [~] 8.11 Write property test for stop-all cancellation
    - **Property 16: Stop-all cancels running and pending**
    - For any profile with N tasks, cancelAllForProfile sets all to cancelled
    - **Validates: Requirements 7.2**
  - [~] 8.12 Write property test for after-task-action quitBrowser
    - **Property 17: After-task-action quitBrowser đóng hồ sơ**
    - For any task with afterTaskAction='quitBrowser', after completion the profile is closed
    - **Validates: Requirements 7.5**
  - [~] 8.13 Write property test for execution history round-trip
    - **Property 15: Execution history round-trip**
    - For any completed/failed task, querying history returns it with full details
    - **Validates: Requirements 6.3, 6.4**

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Implement IPC Handlers
  - [x] 10.1 Add RPA Orchestrator IPC handlers to `src/main/ipc-handlers.ts`
    - Register all IPC handlers: `rpa-orchestrator:create-task`, `rpa-orchestrator:batch-execute`, `rpa-orchestrator:cancel-task`, `rpa-orchestrator:cancel-all`, `rpa-orchestrator:get-queue`, `rpa-orchestrator:get-history`, `rpa-orchestrator:create-schedule`, `rpa-orchestrator:cancel-schedule`, `rpa-orchestrator:get-schedules`, `rpa-orchestrator:save-config`, `rpa-orchestrator:get-config`, `rpa-orchestrator:set-max-concurrency`
    - Forward orchestrator events to renderer: `task:progress` → `rpa-orchestrator:task-progress`, `batch:complete` → `rpa-orchestrator:batch-complete`
    - _Requirements: 1.1, 6.1, 6.2, 7.1_
  - [x] 10.2 Expose IPC channels in preload script
    - Add RPA orchestrator IPC channel definitions to `src/main/preload.ts`
    - _Requirements: 7.1_
  - [~] 10.3 Write integration tests for IPC handlers
    - Test full flow: create task via IPC → verify task in DB → execute → verify completion event
    - _Requirements: 1.2, 4.1, 6.1_

- [ ] 11. Initialize RPA Orchestrator in main process
  - [x] 11.1 Wire RPA Orchestrator into application startup in `src/main/index.ts`
    - Instantiate RPAOrchestrator with database, ProfileManager, and RPAEngine references
    - Call `restoreSchedules()` on startup to recover active schedules
    - Call `startQueueProcessing()` to begin processing pending tasks
    - _Requirements: 5.5, 3.3_

- [x] 12. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 13. Implement frontend RPA Dialog component
  - [~] 13.1 Create RPA Dialog React component
    - Create dialog component for configuring RPA execution on a profile
    - Include: script selection dropdown, execution order toggle (ordered/random), task type toggle (common/scheduled), priority checkbox
    - Show schedule config (cron expression, start/end time) when task type is 'scheduled'
    - Auto-populate from saved profile config via `rpa-orchestrator:get-config` IPC
    - On submit: call `rpa-orchestrator:create-task` or `rpa-orchestrator:batch-execute` IPC
    - _Requirements: 1.1, 2.1, 2.4, 5.1, 7.1, 8.2_
  - [~] 13.2 Add RPA status indicators to profile list
    - Show RPA status icon on each profile row: idle, running, pending, completed, failed
    - Listen to `rpa-orchestrator:task-progress` IPC events for real-time updates
    - _Requirements: 6.2, 7.3_
  - [~] 13.3 Create RPA Status Panel component
    - Show real-time progress: current action, actions completed/total, elapsed time
    - Show queue status: number of pending tasks for the profile
    - Add stop button that calls `rpa-orchestrator:cancel-all` IPC
    - _Requirements: 6.1, 6.2, 7.2_
  - [~] 13.4 Create RPA History view for a profile
    - Display list of past task executions with status, duration, error details
    - Fetch via `rpa-orchestrator:get-history` IPC
    - _Requirements: 6.3, 6.4, 6.5_

- [x] 14. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (20 properties total)
- Unit tests validate specific examples and edge cases
- Frontend tasks (13.x) are marked optional since they depend on the specific React component structure in the renderer
- The `node-cron` package must be installed as a dependency before implementing the Scheduler (task 7.1)
