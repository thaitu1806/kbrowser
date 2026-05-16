import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeDatabase } from '../index';
import path from 'path';
import fs from 'fs';
import os from 'os';

describe('RPA Schema', () => {
  let db: Database.Database;
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `test-rpa-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
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

  describe('rpa_tasks table', () => {
    it('should exist with correct columns', () => {
      const columns = db.pragma('table_info(rpa_tasks)') as Array<{ name: string; type: string; notnull: number }>;
      const columnNames = columns.map((c) => c.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('profile_id');
      expect(columnNames).toContain('script_id');
      expect(columnNames).toContain('batch_id');
      expect(columnNames).toContain('status');
      expect(columnNames).toContain('execution_order');
      expect(columnNames).toContain('task_type');
      expect(columnNames).toContain('priority');
      expect(columnNames).toContain('queue_position');
      expect(columnNames).toContain('actions_completed');
      expect(columnNames).toContain('total_actions');
      expect(columnNames).toContain('current_action');
      expect(columnNames).toContain('error_message');
      expect(columnNames).toContain('error_details');
      expect(columnNames).toContain('started_at');
      expect(columnNames).toContain('completed_at');
      expect(columnNames).toContain('created_at');
      expect(columnNames).toContain('updated_at');
    });

    it('should accept valid task data', () => {
      db.prepare(`
        INSERT INTO rpa_tasks (id, profile_id, script_id, batch_id, status, execution_order, task_type, priority, queue_position, actions_completed, total_actions, created_at, updated_at)
        VALUES ('t1', 'p1', 's1', 'b1', 'pending', 'ordered', 'common', 0, 1, 0, 5, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
      `).run();

      const task = db.prepare('SELECT * FROM rpa_tasks WHERE id = ?').get('t1') as Record<string, unknown>;
      expect(task.profile_id).toBe('p1');
      expect(task.script_id).toBe('s1');
      expect(task.status).toBe('pending');
      expect(task.execution_order).toBe('ordered');
      expect(task.task_type).toBe('common');
      expect(task.priority).toBe(0);
    });

    it('should enforce CHECK constraint on status', () => {
      expect(() => {
        db.prepare(`
          INSERT INTO rpa_tasks (id, profile_id, script_id, status, execution_order, task_type, priority, queue_position, actions_completed, total_actions, created_at, updated_at)
          VALUES ('t1', 'p1', 's1', 'invalid_status', 'ordered', 'common', 0, 0, 0, 0, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
        `).run();
      }).toThrow();
    });

    it('should enforce CHECK constraint on execution_order', () => {
      expect(() => {
        db.prepare(`
          INSERT INTO rpa_tasks (id, profile_id, script_id, status, execution_order, task_type, priority, queue_position, actions_completed, total_actions, created_at, updated_at)
          VALUES ('t1', 'p1', 's1', 'pending', 'parallel', 'common', 0, 0, 0, 0, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
        `).run();
      }).toThrow();
    });

    it('should enforce CHECK constraint on task_type', () => {
      expect(() => {
        db.prepare(`
          INSERT INTO rpa_tasks (id, profile_id, script_id, status, execution_order, task_type, priority, queue_position, actions_completed, total_actions, created_at, updated_at)
          VALUES ('t1', 'p1', 's1', 'pending', 'ordered', 'recurring', 0, 0, 0, 0, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
        `).run();
      }).toThrow();
    });

    it('should enforce CHECK constraint on priority (only 0 or 1)', () => {
      expect(() => {
        db.prepare(`
          INSERT INTO rpa_tasks (id, profile_id, script_id, status, execution_order, task_type, priority, queue_position, actions_completed, total_actions, created_at, updated_at)
          VALUES ('t1', 'p1', 's1', 'pending', 'ordered', 'common', 2, 0, 0, 0, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
        `).run();
      }).toThrow();
    });

    it('should accept all valid status values', () => {
      const statuses = ['pending', 'running', 'completed', 'failed', 'cancelled'];
      statuses.forEach((status, i) => {
        db.prepare(`
          INSERT INTO rpa_tasks (id, profile_id, script_id, status, execution_order, task_type, priority, queue_position, actions_completed, total_actions, created_at, updated_at)
          VALUES (?, 'p1', 's1', ?, 'ordered', 'common', 0, ?, 0, 0, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
        `).run(`t${i}`, status, i);
      });

      const tasks = db.prepare('SELECT * FROM rpa_tasks').all();
      expect(tasks).toHaveLength(5);
    });

    it('should cascade delete tasks when profile is deleted', () => {
      db.prepare(`
        INSERT INTO rpa_tasks (id, profile_id, script_id, status, execution_order, task_type, priority, queue_position, actions_completed, total_actions, created_at, updated_at)
        VALUES ('t1', 'p1', 's1', 'pending', 'ordered', 'common', 0, 0, 0, 0, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
      `).run();

      db.prepare(`
        INSERT INTO rpa_tasks (id, profile_id, script_id, status, execution_order, task_type, priority, queue_position, actions_completed, total_actions, created_at, updated_at)
        VALUES ('t2', 'p1', 's1', 'running', 'ordered', 'common', 0, 1, 0, 0, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
      `).run();

      // Task for a different profile should not be affected
      db.prepare(`
        INSERT INTO rpa_tasks (id, profile_id, script_id, status, execution_order, task_type, priority, queue_position, actions_completed, total_actions, created_at, updated_at)
        VALUES ('t3', 'p2', 's1', 'pending', 'ordered', 'common', 0, 0, 0, 0, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
      `).run();

      db.prepare('DELETE FROM profiles WHERE id = ?').run('p1');

      const remainingTasks = db.prepare('SELECT * FROM rpa_tasks').all();
      expect(remainingTasks).toHaveLength(1);
      expect((remainingTasks[0] as Record<string, unknown>).id).toBe('t3');
    });

    it('should block script deletion when referenced by NOT NULL script_id (ON DELETE SET NULL conflicts with NOT NULL)', () => {
      db.prepare(`
        INSERT INTO rpa_tasks (id, profile_id, script_id, status, execution_order, task_type, priority, queue_position, actions_completed, total_actions, created_at, updated_at)
        VALUES ('t1', 'p1', 's1', 'completed', 'ordered', 'common', 0, 0, 5, 5, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
      `).run();

      // script_id is NOT NULL, so ON DELETE SET NULL triggers a NOT NULL constraint failure
      expect(() => {
        db.prepare('DELETE FROM rpa_scripts WHERE id = ?').run('s1');
      }).toThrow();
    });

    it('should enforce foreign key on profile_id', () => {
      expect(() => {
        db.prepare(`
          INSERT INTO rpa_tasks (id, profile_id, script_id, status, execution_order, task_type, priority, queue_position, actions_completed, total_actions, created_at, updated_at)
          VALUES ('t1', 'nonexistent', 's1', 'pending', 'ordered', 'common', 0, 0, 0, 0, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
        `).run();
      }).toThrow();
    });

    it('should use correct default values', () => {
      db.prepare(`
        INSERT INTO rpa_tasks (id, profile_id, script_id, created_at, updated_at)
        VALUES ('t1', 'p1', 's1', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
      `).run();

      const task = db.prepare('SELECT * FROM rpa_tasks WHERE id = ?').get('t1') as Record<string, unknown>;
      expect(task.status).toBe('pending');
      expect(task.execution_order).toBe('ordered');
      expect(task.task_type).toBe('common');
      expect(task.priority).toBe(0);
      expect(task.queue_position).toBe(0);
      expect(task.actions_completed).toBe(0);
      expect(task.total_actions).toBe(0);
    });
  });

  describe('rpa_schedules table', () => {
    it('should exist with correct columns', () => {
      const columns = db.pragma('table_info(rpa_schedules)') as Array<{ name: string }>;
      const columnNames = columns.map((c) => c.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('profile_id');
      expect(columnNames).toContain('script_id');
      expect(columnNames).toContain('cron_expression');
      expect(columnNames).toContain('execution_order');
      expect(columnNames).toContain('status');
      expect(columnNames).toContain('start_time');
      expect(columnNames).toContain('end_time');
      expect(columnNames).toContain('last_triggered_at');
      expect(columnNames).toContain('next_trigger_at');
      expect(columnNames).toContain('created_at');
      expect(columnNames).toContain('updated_at');
    });

    it('should accept valid schedule data', () => {
      db.prepare(`
        INSERT INTO rpa_schedules (id, profile_id, script_id, cron_expression, execution_order, status, start_time, end_time, created_at, updated_at)
        VALUES ('sch1', 'p1', 's1', '*/5 * * * *', 'ordered', 'active', '2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
      `).run();

      const schedule = db.prepare('SELECT * FROM rpa_schedules WHERE id = ?').get('sch1') as Record<string, unknown>;
      expect(schedule.profile_id).toBe('p1');
      expect(schedule.cron_expression).toBe('*/5 * * * *');
      expect(schedule.status).toBe('active');
    });

    it('should enforce CHECK constraint on status', () => {
      expect(() => {
        db.prepare(`
          INSERT INTO rpa_schedules (id, profile_id, script_id, cron_expression, execution_order, status, created_at, updated_at)
          VALUES ('sch1', 'p1', 's1', '* * * * *', 'ordered', 'running', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
        `).run();
      }).toThrow();
    });

    it('should accept all valid status values', () => {
      const statuses = ['active', 'paused', 'cancelled', 'expired'];
      statuses.forEach((status, i) => {
        db.prepare(`
          INSERT INTO rpa_schedules (id, profile_id, script_id, cron_expression, execution_order, status, created_at, updated_at)
          VALUES (?, 'p1', 's1', '* * * * *', 'ordered', ?, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
        `).run(`sch${i}`, status);
      });

      const schedules = db.prepare('SELECT * FROM rpa_schedules').all();
      expect(schedules).toHaveLength(4);
    });

    it('should enforce CHECK constraint on execution_order', () => {
      expect(() => {
        db.prepare(`
          INSERT INTO rpa_schedules (id, profile_id, script_id, cron_expression, execution_order, status, created_at, updated_at)
          VALUES ('sch1', 'p1', 's1', '* * * * *', 'sequential', 'active', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
        `).run();
      }).toThrow();
    });

    it('should cascade delete schedules when profile is deleted', () => {
      db.prepare(`
        INSERT INTO rpa_schedules (id, profile_id, script_id, cron_expression, execution_order, status, created_at, updated_at)
        VALUES ('sch1', 'p1', 's1', '0 * * * *', 'ordered', 'active', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
      `).run();

      db.prepare(`
        INSERT INTO rpa_schedules (id, profile_id, script_id, cron_expression, execution_order, status, created_at, updated_at)
        VALUES ('sch2', 'p2', 's1', '0 0 * * *', 'random', 'active', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
      `).run();

      db.prepare('DELETE FROM profiles WHERE id = ?').run('p1');

      const remaining = db.prepare('SELECT * FROM rpa_schedules').all();
      expect(remaining).toHaveLength(1);
      expect((remaining[0] as Record<string, unknown>).id).toBe('sch2');
    });

    it('should block script deletion when referenced by NOT NULL script_id (ON DELETE SET NULL conflicts with NOT NULL)', () => {
      db.prepare(`
        INSERT INTO rpa_schedules (id, profile_id, script_id, cron_expression, execution_order, status, created_at, updated_at)
        VALUES ('sch1', 'p1', 's1', '0 * * * *', 'ordered', 'active', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
      `).run();

      // script_id is NOT NULL, so ON DELETE SET NULL triggers a NOT NULL constraint failure
      expect(() => {
        db.prepare('DELETE FROM rpa_scripts WHERE id = ?').run('s1');
      }).toThrow();
    });

    it('should enforce foreign key on profile_id', () => {
      expect(() => {
        db.prepare(`
          INSERT INTO rpa_schedules (id, profile_id, script_id, cron_expression, execution_order, status, created_at, updated_at)
          VALUES ('sch1', 'nonexistent', 's1', '* * * * *', 'ordered', 'active', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
        `).run();
      }).toThrow();
    });

    it('should use correct default values', () => {
      db.prepare(`
        INSERT INTO rpa_schedules (id, profile_id, script_id, cron_expression, created_at, updated_at)
        VALUES ('sch1', 'p1', 's1', '* * * * *', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
      `).run();

      const schedule = db.prepare('SELECT * FROM rpa_schedules WHERE id = ?').get('sch1') as Record<string, unknown>;
      expect(schedule.execution_order).toBe('ordered');
      expect(schedule.status).toBe('active');
    });
  });

  describe('profile_rpa_config table', () => {
    it('should exist with correct columns', () => {
      const columns = db.pragma('table_info(profile_rpa_config)') as Array<{ name: string }>;
      const columnNames = columns.map((c) => c.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('profile_id');
      expect(columnNames).toContain('script_id');
      expect(columnNames).toContain('execution_order');
      expect(columnNames).toContain('task_type');
      expect(columnNames).toContain('priority');
      expect(columnNames).toContain('schedule_config');
      expect(columnNames).toContain('updated_at');
    });

    it('should accept valid config data', () => {
      const scheduleConfig = JSON.stringify({ cronExpression: '0 * * * *', startTime: '2024-01-01T00:00:00Z' });
      db.prepare(`
        INSERT INTO profile_rpa_config (id, profile_id, script_id, execution_order, task_type, priority, schedule_config, updated_at)
        VALUES ('cfg1', 'p1', 's1', 'random', 'scheduled', 1, ?, '2024-01-01T00:00:00Z')
      `).run(scheduleConfig);

      const config = db.prepare('SELECT * FROM profile_rpa_config WHERE id = ?').get('cfg1') as Record<string, unknown>;
      expect(config.profile_id).toBe('p1');
      expect(config.execution_order).toBe('random');
      expect(config.task_type).toBe('scheduled');
      expect(config.priority).toBe(1);
      expect(JSON.parse(config.schedule_config as string)).toEqual({ cronExpression: '0 * * * *', startTime: '2024-01-01T00:00:00Z' });
    });

    it('should enforce UNIQUE constraint on profile_id', () => {
      db.prepare(`
        INSERT INTO profile_rpa_config (id, profile_id, script_id, execution_order, task_type, priority, updated_at)
        VALUES ('cfg1', 'p1', 's1', 'ordered', 'common', 0, '2024-01-01T00:00:00Z')
      `).run();

      expect(() => {
        db.prepare(`
          INSERT INTO profile_rpa_config (id, profile_id, script_id, execution_order, task_type, priority, updated_at)
          VALUES ('cfg2', 'p1', 's1', 'random', 'scheduled', 1, '2024-01-01T00:00:00Z')
        `).run();
      }).toThrow();
    });

    it('should allow different profiles to each have a config', () => {
      db.prepare(`
        INSERT INTO profile_rpa_config (id, profile_id, script_id, execution_order, task_type, priority, updated_at)
        VALUES ('cfg1', 'p1', 's1', 'ordered', 'common', 0, '2024-01-01T00:00:00Z')
      `).run();

      db.prepare(`
        INSERT INTO profile_rpa_config (id, profile_id, script_id, execution_order, task_type, priority, updated_at)
        VALUES ('cfg2', 'p2', 's1', 'random', 'scheduled', 1, '2024-01-01T00:00:00Z')
      `).run();

      const configs = db.prepare('SELECT * FROM profile_rpa_config').all();
      expect(configs).toHaveLength(2);
    });

    it('should enforce CHECK constraint on execution_order', () => {
      expect(() => {
        db.prepare(`
          INSERT INTO profile_rpa_config (id, profile_id, script_id, execution_order, task_type, priority, updated_at)
          VALUES ('cfg1', 'p1', 's1', 'parallel', 'common', 0, '2024-01-01T00:00:00Z')
        `).run();
      }).toThrow();
    });

    it('should enforce CHECK constraint on task_type', () => {
      expect(() => {
        db.prepare(`
          INSERT INTO profile_rpa_config (id, profile_id, script_id, execution_order, task_type, priority, updated_at)
          VALUES ('cfg1', 'p1', 's1', 'ordered', 'recurring', 0, '2024-01-01T00:00:00Z')
        `).run();
      }).toThrow();
    });

    it('should enforce CHECK constraint on priority (only 0 or 1)', () => {
      expect(() => {
        db.prepare(`
          INSERT INTO profile_rpa_config (id, profile_id, script_id, execution_order, task_type, priority, updated_at)
          VALUES ('cfg1', 'p1', 's1', 'ordered', 'common', 5, '2024-01-01T00:00:00Z')
        `).run();
      }).toThrow();
    });

    it('should cascade delete config when profile is deleted', () => {
      db.prepare(`
        INSERT INTO profile_rpa_config (id, profile_id, script_id, execution_order, task_type, priority, updated_at)
        VALUES ('cfg1', 'p1', 's1', 'ordered', 'common', 0, '2024-01-01T00:00:00Z')
      `).run();

      db.prepare(`
        INSERT INTO profile_rpa_config (id, profile_id, script_id, execution_order, task_type, priority, updated_at)
        VALUES ('cfg2', 'p2', 's1', 'ordered', 'common', 0, '2024-01-01T00:00:00Z')
      `).run();

      db.prepare('DELETE FROM profiles WHERE id = ?').run('p1');

      const remaining = db.prepare('SELECT * FROM profile_rpa_config').all();
      expect(remaining).toHaveLength(1);
      expect((remaining[0] as Record<string, unknown>).id).toBe('cfg2');
    });

    it('should SET NULL on script_id when script is deleted', () => {
      db.prepare(`
        INSERT INTO profile_rpa_config (id, profile_id, script_id, execution_order, task_type, priority, updated_at)
        VALUES ('cfg1', 'p1', 's1', 'ordered', 'common', 0, '2024-01-01T00:00:00Z')
      `).run();

      db.prepare('DELETE FROM rpa_scripts WHERE id = ?').run('s1');

      const config = db.prepare('SELECT script_id FROM profile_rpa_config WHERE id = ?').get('cfg1') as Record<string, unknown>;
      expect(config.script_id).toBeNull();
    });

    it('should enforce foreign key on profile_id', () => {
      expect(() => {
        db.prepare(`
          INSERT INTO profile_rpa_config (id, profile_id, script_id, execution_order, task_type, priority, updated_at)
          VALUES ('cfg1', 'nonexistent', 's1', 'ordered', 'common', 0, '2024-01-01T00:00:00Z')
        `).run();
      }).toThrow();
    });

    it('should use correct default values', () => {
      db.prepare(`
        INSERT INTO profile_rpa_config (id, profile_id, updated_at)
        VALUES ('cfg1', 'p1', '2024-01-01T00:00:00Z')
      `).run();

      const config = db.prepare('SELECT * FROM profile_rpa_config WHERE id = ?').get('cfg1') as Record<string, unknown>;
      expect(config.execution_order).toBe('ordered');
      expect(config.task_type).toBe('common');
      expect(config.priority).toBe(0);
    });
  });

  describe('RPA indexes', () => {
    it('should create indexes for rpa_tasks', () => {
      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='rpa_tasks' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[];
      const indexNames = indexes.map((i) => i.name);

      expect(indexNames).toContain('idx_rpa_tasks_profile_id');
      expect(indexNames).toContain('idx_rpa_tasks_status');
      expect(indexNames).toContain('idx_rpa_tasks_batch_id');
      expect(indexNames).toContain('idx_rpa_tasks_queue_position');
    });

    it('should create indexes for rpa_schedules', () => {
      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='rpa_schedules' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[];
      const indexNames = indexes.map((i) => i.name);

      expect(indexNames).toContain('idx_rpa_schedules_profile_id');
      expect(indexNames).toContain('idx_rpa_schedules_status');
      expect(indexNames).toContain('idx_rpa_schedules_next_trigger');
    });

    it('should create index for profile_rpa_config', () => {
      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='profile_rpa_config' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[];
      const indexNames = indexes.map((i) => i.name);

      expect(indexNames).toContain('idx_profile_rpa_config_profile_id');
    });
  });
});
