/**
 * Unit Tests: Config Store
 *
 * Tests save/load/delete, overwrite existing config, validate non-existent script.
 *
 * **Validates: Requirements 8.1, 8.2, 8.3, 8.4**
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeDatabase } from '../../../database/index';
import { ConfigStore } from '../config-store';
import type { ProfileRPAConfig } from '../../../../shared/types/rpa-orchestrator';
import path from 'path';
import fs from 'fs';
import os from 'os';

describe('ConfigStore Unit Tests', () => {
  let db: Database.Database;
  let dbPath: string;
  let configStore: ConfigStore;

  const userId = 'user-1';
  const profileId = 'profile-1';
  const scriptId = 'script-1';
  const scriptId2 = 'script-2';

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `test-config-unit-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    );
    db = initializeDatabase(dbPath);

    // Insert prerequisite data: user
    db.prepare(`
      INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
      VALUES (?, 'testuser', 'hash', 'admin', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
    `).run(userId);

    // Insert prerequisite data: profile
    db.prepare(`
      INSERT INTO profiles (id, name, browser_type, owner_id, created_at, updated_at)
      VALUES (?, 'Test Profile', 'chromium', ?, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
    `).run(profileId, userId);

    // Insert prerequisite data: scripts
    db.prepare(`
      INSERT INTO rpa_scripts (id, name, owner_id, actions, error_handling, created_at, updated_at)
      VALUES (?, 'Script 1', ?, '[]', 'stop', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
    `).run(scriptId, userId);

    db.prepare(`
      INSERT INTO rpa_scripts (id, name, owner_id, actions, error_handling, created_at, updated_at)
      VALUES (?, 'Script 2', ?, '[]', 'stop', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
    `).run(scriptId2, userId);

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

  describe('save and load', () => {
    it('should save and load a config successfully', () => {
      const config: ProfileRPAConfig = {
        profileId,
        scriptId,
        executionOrder: 'ordered',
        taskType: 'common',
        priority: false,
        updatedAt: '2024-01-01T00:00:00Z',
      };

      configStore.save(profileId, config);
      const result = configStore.load(profileId);

      expect(result).not.toBeNull();
      expect(result!.config.profileId).toBe(profileId);
      expect(result!.config.scriptId).toBe(scriptId);
      expect(result!.config.executionOrder).toBe('ordered');
      expect(result!.config.taskType).toBe('common');
      expect(result!.config.priority).toBe(false);
      expect(result!.scriptDeleted).toBe(false);
    });

    it('should return null for non-existent profile config', () => {
      const result = configStore.load('non-existent-profile');
      expect(result).toBeNull();
    });
  });

  describe('overwrite existing config', () => {
    it('should overwrite existing config when saving twice for same profile', () => {
      const config1: ProfileRPAConfig = {
        profileId,
        scriptId,
        executionOrder: 'ordered',
        taskType: 'common',
        priority: false,
        updatedAt: '2024-01-01T00:00:00Z',
      };

      const config2: ProfileRPAConfig = {
        profileId,
        scriptId: scriptId2,
        executionOrder: 'random',
        taskType: 'scheduled',
        priority: true,
        scheduleConfig: {
          cronExpression: '0 * * * *',
          startTime: '2024-06-01T00:00:00Z',
        },
        updatedAt: '2024-02-01T00:00:00Z',
      };

      configStore.save(profileId, config1);
      configStore.save(profileId, config2);

      const result = configStore.load(profileId);

      expect(result).not.toBeNull();
      expect(result!.config.scriptId).toBe(scriptId2);
      expect(result!.config.executionOrder).toBe('random');
      expect(result!.config.taskType).toBe('scheduled');
      expect(result!.config.priority).toBe(true);
      expect(result!.config.scheduleConfig).toEqual({
        cronExpression: '0 * * * *',
        startTime: '2024-06-01T00:00:00Z',
      });
      expect(result!.scriptDeleted).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete the config for a profile', () => {
      const config: ProfileRPAConfig = {
        profileId,
        scriptId,
        executionOrder: 'ordered',
        taskType: 'common',
        priority: false,
        updatedAt: '2024-01-01T00:00:00Z',
      };

      configStore.save(profileId, config);
      configStore.delete(profileId);

      const result = configStore.load(profileId);
      expect(result).toBeNull();
    });

    it('should not throw when deleting non-existent profile config', () => {
      expect(() => configStore.delete('non-existent-profile')).not.toThrow();
    });
  });

  describe('validateScriptExists', () => {
    it('should return true for an existing script', () => {
      expect(configStore.validateScriptExists(scriptId)).toBe(true);
    });

    it('should return false for a non-existent script', () => {
      expect(configStore.validateScriptExists('non-existent-script')).toBe(false);
    });
  });

  describe('scriptDeleted detection', () => {
    it('should return scriptDeleted=true when referenced script is deleted', () => {
      const config: ProfileRPAConfig = {
        profileId,
        scriptId,
        executionOrder: 'ordered',
        taskType: 'common',
        priority: false,
        updatedAt: '2024-01-01T00:00:00Z',
      };

      configStore.save(profileId, config);

      // Delete the script — FK ON DELETE SET NULL sets script_id to NULL
      db.prepare('DELETE FROM rpa_scripts WHERE id = ?').run(scriptId);

      const result = configStore.load(profileId);

      expect(result).not.toBeNull();
      expect(result!.scriptDeleted).toBe(true);
    });
  });

  describe('scheduleConfig serialization', () => {
    it('should correctly serialize and deserialize scheduleConfig JSON', () => {
      const scheduleConfig = {
        cronExpression: '*/5 * * * *',
        startTime: '2024-03-01T08:00:00Z',
        endTime: '2024-12-31T23:59:59Z',
      };

      const config: ProfileRPAConfig = {
        profileId,
        scriptId,
        executionOrder: 'random',
        taskType: 'scheduled',
        priority: true,
        scheduleConfig,
        updatedAt: '2024-01-01T00:00:00Z',
      };

      configStore.save(profileId, config);
      const result = configStore.load(profileId);

      expect(result).not.toBeNull();
      expect(result!.config.scheduleConfig).toEqual(scheduleConfig);
    });

    it('should handle config without scheduleConfig (undefined)', () => {
      const config: ProfileRPAConfig = {
        profileId,
        scriptId,
        executionOrder: 'ordered',
        taskType: 'common',
        priority: false,
        updatedAt: '2024-01-01T00:00:00Z',
      };

      configStore.save(profileId, config);
      const result = configStore.load(profileId);

      expect(result).not.toBeNull();
      expect(result!.config.scheduleConfig).toBeUndefined();
    });
  });
});
