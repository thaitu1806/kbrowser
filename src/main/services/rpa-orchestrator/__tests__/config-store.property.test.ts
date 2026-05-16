// Feature: profile-rpa, Property 18: Profile RPA config round-trip
/**
 * Property-Based Test: Config round-trip
 *
 * For any valid config, save then load for the same profileId returns identical config.
 *
 * **Validates: Requirements 8.1, 8.2**
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import Database from 'better-sqlite3';
import { initializeDatabase } from '../../../database/index';
import { ConfigStore } from '../config-store';
import type { ProfileRPAConfig } from '../../../../shared/types/rpa-orchestrator';
import path from 'path';
import fs from 'fs';
import os from 'os';

describe('ConfigStore Property Tests', () => {
  let db: Database.Database;
  let dbPath: string;
  let configStore: ConfigStore;

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `test-config-prop-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
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

    configStore = new ConfigStore(db);
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
   * Helper: insert a script into the database so that scriptId references are valid.
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

  // Arbitraries for generating valid config values
  const executionOrderArb = fc.constantFrom<'ordered' | 'random'>('ordered', 'random');
  const taskTypeArb = fc.constantFrom<'common' | 'scheduled'>('common', 'scheduled');
  const priorityArb = fc.boolean();
  const scriptIdArb = fc.uuid();

  const scheduleConfigArb = fc.option(
    fc.record({
      cronExpression: fc.constantFrom(
        '* * * * *',
        '0 * * * *',
        '0 0 * * *',
        '0 0 * * 0',
        '*/5 * * * *'
      ),
      startTime: fc.option(fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }).map((d) => d.toISOString()), { nil: undefined }),
      endTime: fc.option(fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }).map((d) => d.toISOString()), { nil: undefined }),
    }),
    { nil: undefined }
  );

  const profileRPAConfigArb = fc.record({
    scriptId: fc.option(scriptIdArb, { nil: undefined }),
    executionOrder: executionOrderArb,
    taskType: taskTypeArb,
    priority: priorityArb,
    scheduleConfig: scheduleConfigArb,
  });

  // Feature: profile-rpa, Property 18: Profile RPA config round-trip
  it('Property 18: save then load for the same profileId returns identical config', () => {
    fc.assert(
      fc.property(
        profileRPAConfigArb,
        (configFields) => {
          // Clear the profile_rpa_config table for a fresh run
          db.prepare('DELETE FROM profile_rpa_config').run();

          const profileId = 'p1';

          // Ensure the script exists in the DB if scriptId is provided
          if (configFields.scriptId) {
            ensureScriptExists(configFields.scriptId);
          }

          // Build the full ProfileRPAConfig
          const config: ProfileRPAConfig = {
            profileId,
            scriptId: configFields.scriptId,
            executionOrder: configFields.executionOrder,
            taskType: configFields.taskType,
            priority: configFields.priority,
            scheduleConfig: configFields.scheduleConfig,
            updatedAt: new Date().toISOString(),
          };

          // Save the config
          configStore.save(profileId, config);

          // Load the config
          const result = configStore.load(profileId);

          // Must not be null
          expect(result).not.toBeNull();

          const loaded = result!.config;

          // Verify all fields match (except updatedAt which is set by save())
          expect(loaded.profileId).toBe(config.profileId);
          expect(loaded.scriptId).toBe(config.scriptId);
          expect(loaded.executionOrder).toBe(config.executionOrder);
          expect(loaded.taskType).toBe(config.taskType);
          expect(loaded.priority).toBe(config.priority);
          expect(loaded.scheduleConfig).toEqual(config.scheduleConfig);

          // scriptDeleted should be false since we ensured the script exists
          if (config.scriptId) {
            expect(result!.scriptDeleted).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: profile-rpa, Property 19: Deleted script detection trong saved config
  /**
   * Property 19: Deleted script detection
   *
   * For any profile with saved config pointing to a scriptId, if that script is
   * deleted from the database, load() must return scriptDeleted=true.
   *
   * **Validates: Requirements 8.4**
   */
  it('Property 19: deleted script in saved config triggers scriptDeleted warning', () => {
    fc.assert(
      fc.property(
        scriptIdArb,
        executionOrderArb,
        taskTypeArb,
        priorityArb,
        (scriptId, executionOrder, taskType, priority) => {
          // Clear the profile_rpa_config table for a fresh run
          db.prepare('DELETE FROM profile_rpa_config').run();

          const profileId = 'p1';

          // Ensure the script exists in the DB
          ensureScriptExists(scriptId);

          // Build a config that references the script
          const config: ProfileRPAConfig = {
            profileId,
            scriptId,
            executionOrder,
            taskType,
            priority,
            updatedAt: new Date().toISOString(),
          };

          // Save the config
          configStore.save(profileId, config);

          // Delete the script from rpa_scripts table
          // Due to ON DELETE SET NULL FK, script_id in profile_rpa_config becomes NULL
          db.prepare('DELETE FROM rpa_scripts WHERE id = ?').run(scriptId);

          // Load the config — must return scriptDeleted=true
          const result = configStore.load(profileId);

          expect(result).not.toBeNull();
          expect(result!.scriptDeleted).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
