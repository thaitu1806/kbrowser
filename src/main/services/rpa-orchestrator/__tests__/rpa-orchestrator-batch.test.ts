import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { initializeDatabase } from '../../../database/index';
import { RPAOrchestrator } from '../rpa-orchestrator';

/** Creates a temp database and returns cleanup helpers. */
function createTestDb() {
  const dbPath = path.join(
    os.tmpdir(),
    `test-rpa-orch-batch-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  const db = initializeDatabase(dbPath);

  // Insert a 'system' user for foreign key constraints
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
     VALUES ('system', 'system', 'hash', 'admin', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`,
  ).run();

  // Insert a test profile
  db.prepare(
    `INSERT INTO profiles (id, name, owner_id, browser_type, created_at, updated_at)
     VALUES ('profile-1', 'Test Profile 1', 'system', 'chromium', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`,
  ).run();

  db.prepare(
    `INSERT INTO profiles (id, name, owner_id, browser_type, created_at, updated_at)
     VALUES ('profile-2', 'Test Profile 2', 'system', 'chromium', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`,
  ).run();

  db.prepare(
    `INSERT INTO profiles (id, name, owner_id, browser_type, created_at, updated_at)
     VALUES ('profile-3', 'Test Profile 3', 'system', 'chromium', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`,
  ).run();

  // Insert a test script
  db.prepare(
    `INSERT INTO rpa_scripts (id, name, owner_id, actions, error_handling, created_at, updated_at)
     VALUES ('script-1', 'Test Script', 'system', '{"steps":[]}', 'stop', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`,
  ).run();

  // Insert a script with afterTaskAction='quitBrowser'
  db.prepare(
    `INSERT INTO rpa_scripts (id, name, owner_id, actions, error_handling, created_at, updated_at)
     VALUES ('script-quit', 'Quit Script', 'system', '{"afterTaskAction":"quitBrowser","steps":[]}', 'stop', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`,
  ).run();

  const cleanup = () => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
  };

  return { db, dbPath, cleanup };
}

/** Creates mock ProfileManager and RPAEngine */
function createMocks(options?: {
  failProfiles?: Set<string>;
  executeDelay?: number;
}) {
  const openedProfiles: string[] = [];
  const closedProfiles: string[] = [];
  const executedScripts: Array<{ profileId: string; scriptId: string }> = [];

  const profileManager = {
    openProfile: vi.fn(async (profileId: string) => {
      openedProfiles.push(profileId);
      return { browser: 'mock' };
    }),
    closeProfile: vi.fn(async (profileId: string) => {
      closedProfiles.push(profileId);
    }),
  };

  const rpaEngine = {
    executeScript: vi.fn(async (profileId: string, scriptId: string) => {
      if (options?.executeDelay) {
        await new Promise((r) => setTimeout(r, options.executeDelay));
      }
      executedScripts.push({ profileId, scriptId });

      if (options?.failProfiles?.has(profileId)) {
        return {
          success: false,
          actionsCompleted: 1,
          totalActions: 5,
          error: `Execution failed for ${profileId}`,
        };
      }

      return {
        success: true,
        actionsCompleted: 5,
        totalActions: 5,
      };
    }),
  };

  return { profileManager, rpaEngine, openedProfiles, closedProfiles, executedScripts };
}

describe('RPAOrchestrator - Batch Execution', () => {
  let db: ReturnType<typeof createTestDb>['db'];
  let cleanup: () => void;

  beforeEach(() => {
    const testDb = createTestDb();
    db = testDb.db;
    cleanup = testDb.cleanup;
  });

  afterEach(() => {
    if (cleanup) cleanup();
  });

  describe('startQueueProcessing / stopQueueProcessing', () => {
    it('should set processing flag and start interval', () => {
      const { profileManager, rpaEngine } = createMocks();
      const orchestrator = new RPAOrchestrator(db, profileManager, rpaEngine);

      orchestrator.startQueueProcessing();
      // Calling again should be a no-op (idempotent)
      orchestrator.startQueueProcessing();

      orchestrator.stopQueueProcessing();
    });

    it('should stop processing when stopQueueProcessing is called', () => {
      const { profileManager, rpaEngine } = createMocks();
      const orchestrator = new RPAOrchestrator(db, profileManager, rpaEngine);

      orchestrator.startQueueProcessing();
      orchestrator.stopQueueProcessing();

      // Should be safe to call stop again
      orchestrator.stopQueueProcessing();
    });
  });

  describe('executeBatch', () => {
    it('should execute all tasks in a batch and return a BatchReport', async () => {
      const { profileManager, rpaEngine } = createMocks();
      const orchestrator = new RPAOrchestrator(db, profileManager, rpaEngine, { maxConcurrency: 5 });

      const reportPromise = orchestrator.executeBatch({
        scriptId: 'script-1',
        profileIds: ['profile-1', 'profile-2', 'profile-3'],
        executionOrder: 'ordered',
        taskType: 'common',
        priority: false,
      });

      const report = await reportPromise;

      expect(report.totalProfiles).toBe(3);
      expect(report.successCount).toBe(3);
      expect(report.failureCount).toBe(0);
      expect(report.errors).toHaveLength(0);
      expect(report.batchId).toBeDefined();
      expect(report.startedAt).toBeDefined();
      expect(report.completedAt).toBeDefined();

      orchestrator.stopQueueProcessing();
    });

    it('should handle partial failures in a batch (fault isolation)', async () => {
      const { profileManager, rpaEngine } = createMocks({
        failProfiles: new Set(['profile-2']),
      });
      const orchestrator = new RPAOrchestrator(db, profileManager, rpaEngine, { maxConcurrency: 5 });

      const report = await orchestrator.executeBatch({
        scriptId: 'script-1',
        profileIds: ['profile-1', 'profile-2', 'profile-3'],
        executionOrder: 'ordered',
        taskType: 'common',
        priority: false,
      });

      expect(report.totalProfiles).toBe(3);
      expect(report.successCount).toBe(2);
      expect(report.failureCount).toBe(1);
      expect(report.errors).toHaveLength(1);
      expect(report.errors[0].profileId).toBe('profile-2');
      expect(report.errors[0].error).toContain('profile-2');

      orchestrator.stopQueueProcessing();
    });

    it('should emit batch:complete event when batch finishes', async () => {
      const { profileManager, rpaEngine } = createMocks();
      const orchestrator = new RPAOrchestrator(db, profileManager, rpaEngine, { maxConcurrency: 5 });

      const batchCompleteEvents: any[] = [];
      orchestrator.on('batch:complete', (report) => {
        batchCompleteEvents.push(report);
      });

      await orchestrator.executeBatch({
        scriptId: 'script-1',
        profileIds: ['profile-1'],
        executionOrder: 'ordered',
        taskType: 'common',
        priority: false,
      });

      expect(batchCompleteEvents).toHaveLength(1);
      expect(batchCompleteEvents[0].totalProfiles).toBe(1);
      expect(batchCompleteEvents[0].successCount).toBe(1);

      orchestrator.stopQueueProcessing();
    });

    it('should emit task:progress events for each task', async () => {
      const { profileManager, rpaEngine } = createMocks();
      const orchestrator = new RPAOrchestrator(db, profileManager, rpaEngine, { maxConcurrency: 5 });

      const progressEvents: any[] = [];
      orchestrator.on('task:progress', (event) => {
        progressEvents.push(event);
      });

      await orchestrator.executeBatch({
        scriptId: 'script-1',
        profileIds: ['profile-1', 'profile-2'],
        executionOrder: 'ordered',
        taskType: 'common',
        priority: false,
      });

      expect(progressEvents).toHaveLength(2);
      progressEvents.forEach((event) => {
        expect(event.taskId).toBeDefined();
        expect(event.profileId).toBeDefined();
        expect(event.status).toBe('completed');
        expect(event.actionsCompleted).toBe(5);
        expect(event.totalActions).toBe(5);
      });

      orchestrator.stopQueueProcessing();
    });

    it('should respect concurrency limits', async () => {
      let concurrentCount = 0;
      let maxConcurrent = 0;

      const profileManager = {
        openProfile: vi.fn(async () => ({ browser: 'mock' })),
        closeProfile: vi.fn(async () => {}),
      };

      const rpaEngine = {
        executeScript: vi.fn(async () => {
          concurrentCount++;
          maxConcurrent = Math.max(maxConcurrent, concurrentCount);
          await new Promise((r) => setTimeout(r, 50));
          concurrentCount--;
          return { success: true, actionsCompleted: 3, totalActions: 3 };
        }),
      };

      const orchestrator = new RPAOrchestrator(db, profileManager, rpaEngine, { maxConcurrency: 2 });

      await orchestrator.executeBatch({
        scriptId: 'script-1',
        profileIds: ['profile-1', 'profile-2', 'profile-3'],
        executionOrder: 'ordered',
        taskType: 'common',
        priority: false,
      });

      expect(maxConcurrent).toBeLessThanOrEqual(2);

      orchestrator.stopQueueProcessing();
    });

    it('should handle profile open failure gracefully', async () => {
      const profileManager = {
        openProfile: vi.fn(async (profileId: string) => {
          if (profileId === 'profile-2') {
            throw new Error('Profile open failed');
          }
          return { browser: 'mock' };
        }),
        closeProfile: vi.fn(async () => {}),
      };

      const rpaEngine = {
        executeScript: vi.fn(async () => ({
          success: true,
          actionsCompleted: 5,
          totalActions: 5,
        })),
      };

      const orchestrator = new RPAOrchestrator(db, profileManager, rpaEngine, { maxConcurrency: 5 });

      const report = await orchestrator.executeBatch({
        scriptId: 'script-1',
        profileIds: ['profile-1', 'profile-2', 'profile-3'],
        executionOrder: 'ordered',
        taskType: 'common',
        priority: false,
      });

      expect(report.successCount).toBe(2);
      expect(report.failureCount).toBe(1);
      expect(report.errors[0].profileId).toBe('profile-2');
      expect(report.errors[0].error).toContain('Profile open failed');

      orchestrator.stopQueueProcessing();
    });
  });

  describe('afterTaskAction - quitBrowser', () => {
    it('should close profile when script has afterTaskAction=quitBrowser', async () => {
      const { profileManager, rpaEngine, closedProfiles } = createMocks();
      const orchestrator = new RPAOrchestrator(db, profileManager, rpaEngine, { maxConcurrency: 5 });

      await orchestrator.executeBatch({
        scriptId: 'script-quit',
        profileIds: ['profile-1'],
        executionOrder: 'ordered',
        taskType: 'common',
        priority: false,
      });

      expect(closedProfiles).toContain('profile-1');

      orchestrator.stopQueueProcessing();
    });

    it('should NOT close profile when script does not have afterTaskAction', async () => {
      const { profileManager, rpaEngine, closedProfiles } = createMocks();
      const orchestrator = new RPAOrchestrator(db, profileManager, rpaEngine, { maxConcurrency: 5 });

      await orchestrator.executeBatch({
        scriptId: 'script-1',
        profileIds: ['profile-1'],
        executionOrder: 'ordered',
        taskType: 'common',
        priority: false,
      });

      expect(closedProfiles).not.toContain('profile-1');

      orchestrator.stopQueueProcessing();
    });
  });

  describe('auto-progression', () => {
    it('should automatically process next pending task after current completes', async () => {
      const { profileManager, rpaEngine, executedScripts } = createMocks();
      const orchestrator = new RPAOrchestrator(db, profileManager, rpaEngine, { maxConcurrency: 1 });

      const report = await orchestrator.executeBatch({
        scriptId: 'script-1',
        profileIds: ['profile-1', 'profile-2', 'profile-3'],
        executionOrder: 'ordered',
        taskType: 'common',
        priority: false,
      });

      // All 3 should have been executed even with concurrency=1
      expect(report.totalProfiles).toBe(3);
      expect(report.successCount).toBe(3);
      expect(executedScripts).toHaveLength(3);

      orchestrator.stopQueueProcessing();
    });
  });

  describe('batch report accuracy', () => {
    it('should satisfy successCount + failureCount = totalProfiles', async () => {
      const { profileManager, rpaEngine } = createMocks({
        failProfiles: new Set(['profile-1', 'profile-3']),
      });
      const orchestrator = new RPAOrchestrator(db, profileManager, rpaEngine, { maxConcurrency: 5 });

      const report = await orchestrator.executeBatch({
        scriptId: 'script-1',
        profileIds: ['profile-1', 'profile-2', 'profile-3'],
        executionOrder: 'ordered',
        taskType: 'common',
        priority: false,
      });

      expect(report.successCount + report.failureCount).toBe(report.totalProfiles);
      expect(report.errors.length).toBe(report.failureCount);

      orchestrator.stopQueueProcessing();
    });
  });
});
