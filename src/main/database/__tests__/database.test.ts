import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeDatabase } from '../index';
import path from 'path';
import fs from 'fs';
import os from 'os';

describe('Database Schema', () => {
  let db: Database.Database;
  let dbPath: string;

  beforeEach(() => {
    // Use a temp file for each test
    dbPath = path.join(os.tmpdir(), `test-dim-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    db = initializeDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    // Clean up temp files
    try {
      fs.unlinkSync(dbPath);
      fs.unlinkSync(dbPath + '-wal');
      fs.unlinkSync(dbPath + '-shm');
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should enable WAL journal mode', () => {
    const result = db.pragma('journal_mode', { simple: true });
    expect(result).toBe('wal');
  });

  it('should enable foreign keys', () => {
    const result = db.pragma('foreign_keys', { simple: true });
    expect(result).toBe(1);
  });

  it('should create all 10 required tables', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name).sort();

    expect(tableNames).toEqual([
      'action_logs',
      'extensions',
      'profile_access',
      'profile_data',
      'profile_extensions',
      'profiles',
      'proxies',
      'rotation_configs',
      'rpa_scripts',
      'users',
    ]);
  });

  describe('users table', () => {
    it('should accept valid user data', () => {
      const stmt = db.prepare(`
        INSERT INTO users (id, username, password_hash, role, api_key, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run('u1', 'admin', 'hash123', 'admin', 'key-1', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z');

      const user = db.prepare('SELECT * FROM users WHERE id = ?').get('u1') as Record<string, unknown>;
      expect(user.username).toBe('admin');
      expect(user.role).toBe('admin');
    });

    it('should enforce unique username', () => {
      const stmt = db.prepare(`
        INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run('u1', 'admin', 'hash', 'admin', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z');

      expect(() => {
        stmt.run('u2', 'admin', 'hash2', 'user', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z');
      }).toThrow();
    });

    it('should enforce valid role values', () => {
      const stmt = db.prepare(`
        INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      expect(() => {
        stmt.run('u1', 'test', 'hash', 'superadmin', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z');
      }).toThrow();
    });
  });

  describe('profiles table', () => {
    beforeEach(() => {
      db.prepare(`
        INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
        VALUES ('u1', 'owner', 'hash', 'admin', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
      `).run();
    });

    it('should accept valid profile data', () => {
      db.prepare(`
        INSERT INTO profiles (id, name, browser_type, owner_id, status, created_at, updated_at)
        VALUES ('p1', 'Test Profile', 'chromium', 'u1', 'closed', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
      `).run();

      const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get('p1') as Record<string, unknown>;
      expect(profile.name).toBe('Test Profile');
      expect(profile.browser_type).toBe('chromium');
      expect(profile.sync_enabled).toBe(0);
    });

    it('should enforce valid browser_type values', () => {
      expect(() => {
        db.prepare(`
          INSERT INTO profiles (id, name, browser_type, owner_id, created_at, updated_at)
          VALUES ('p1', 'Test', 'safari', 'u1', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
        `).run();
      }).toThrow();
    });

    it('should enforce foreign key on owner_id', () => {
      expect(() => {
        db.prepare(`
          INSERT INTO profiles (id, name, browser_type, owner_id, created_at, updated_at)
          VALUES ('p1', 'Test', 'chromium', 'nonexistent', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
        `).run();
      }).toThrow();
    });

    it('should set proxy_id to NULL when proxy is deleted', () => {
      db.prepare(`
        INSERT INTO proxies (id, protocol, host, port, status)
        VALUES ('px1', 'http', '127.0.0.1', 8080, 'alive')
      `).run();

      db.prepare(`
        INSERT INTO profiles (id, name, browser_type, owner_id, proxy_id, created_at, updated_at)
        VALUES ('p1', 'Test', 'chromium', 'u1', 'px1', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
      `).run();

      db.prepare('DELETE FROM proxies WHERE id = ?').run('px1');

      const profile = db.prepare('SELECT proxy_id FROM profiles WHERE id = ?').get('p1') as Record<string, unknown>;
      expect(profile.proxy_id).toBeNull();
    });
  });

  describe('profile_data table', () => {
    beforeEach(() => {
      db.prepare(`INSERT INTO users (id, username, password_hash, role, created_at, updated_at) VALUES ('u1', 'owner', 'hash', 'admin', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`).run();
      db.prepare(`INSERT INTO profiles (id, name, browser_type, owner_id, created_at, updated_at) VALUES ('p1', 'Test', 'chromium', 'u1', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`).run();
    });

    it('should accept valid profile data types', () => {
      const types = ['cookie', 'localstorage', 'indexeddb', 'cache'];
      types.forEach((type, i) => {
        db.prepare(`
          INSERT INTO profile_data (id, profile_id, data_type, data, updated_at)
          VALUES (?, 'p1', ?, X'DEADBEEF', '2024-01-01T00:00:00Z')
        `).run(`pd${i}`, type);
      });

      const rows = db.prepare('SELECT * FROM profile_data WHERE profile_id = ?').all('p1');
      expect(rows).toHaveLength(4);
    });

    it('should cascade delete when profile is deleted', () => {
      db.prepare(`
        INSERT INTO profile_data (id, profile_id, data_type, data, updated_at)
        VALUES ('pd1', 'p1', 'cookie', X'DEADBEEF', '2024-01-01T00:00:00Z')
      `).run();

      db.prepare('DELETE FROM profiles WHERE id = ?').run('p1');

      const rows = db.prepare('SELECT * FROM profile_data WHERE profile_id = ?').all('p1');
      expect(rows).toHaveLength(0);
    });
  });

  describe('proxies table', () => {
    it('should accept valid proxy data', () => {
      db.prepare(`
        INSERT INTO proxies (id, protocol, host, port, username, password, status, response_time_ms, last_checked_at)
        VALUES ('px1', 'socks5', '10.0.0.1', 1080, 'user', 'pass', 'alive', 150, '2024-01-01T00:00:00Z')
      `).run();

      const proxy = db.prepare('SELECT * FROM proxies WHERE id = ?').get('px1') as Record<string, unknown>;
      expect(proxy.protocol).toBe('socks5');
      expect(proxy.port).toBe(1080);
    });

    it('should enforce valid protocol values', () => {
      expect(() => {
        db.prepare(`
          INSERT INTO proxies (id, protocol, host, port)
          VALUES ('px1', 'ftp', '10.0.0.1', 21)
        `).run();
      }).toThrow();
    });
  });

  describe('rotation_configs table', () => {
    beforeEach(() => {
      db.prepare(`INSERT INTO users (id, username, password_hash, role, created_at, updated_at) VALUES ('u1', 'owner', 'hash', 'admin', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`).run();
      db.prepare(`INSERT INTO profiles (id, name, browser_type, owner_id, created_at, updated_at) VALUES ('p1', 'Test', 'chromium', 'u1', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`).run();
    });

    it('should accept valid rotation config', () => {
      db.prepare(`
        INSERT INTO rotation_configs (id, profile_id, enabled, interval_seconds, provider, api_key, created_at)
        VALUES ('rc1', 'p1', 1, 300, 'luminati', 'api-key-123', '2024-01-01T00:00:00Z')
      `).run();

      const config = db.prepare('SELECT * FROM rotation_configs WHERE id = ?').get('rc1') as Record<string, unknown>;
      expect(config.provider).toBe('luminati');
      expect(config.interval_seconds).toBe(300);
    });

    it('should enforce valid provider values', () => {
      expect(() => {
        db.prepare(`
          INSERT INTO rotation_configs (id, profile_id, enabled, interval_seconds, provider, api_key, created_at)
          VALUES ('rc1', 'p1', 1, 300, 'nordvpn', 'key', '2024-01-01T00:00:00Z')
        `).run();
      }).toThrow();
    });
  });

  describe('extensions and profile_extensions tables', () => {
    beforeEach(() => {
      db.prepare(`INSERT INTO users (id, username, password_hash, role, created_at, updated_at) VALUES ('u1', 'owner', 'hash', 'admin', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`).run();
      db.prepare(`INSERT INTO profiles (id, name, browser_type, owner_id, created_at, updated_at) VALUES ('p1', 'Test', 'chromium', 'u1', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`).run();
    });

    it('should accept valid extension data', () => {
      db.prepare(`
        INSERT INTO extensions (id, name, version, source, file_data, uploaded_at)
        VALUES ('e1', 'uBlock Origin', '1.50.0', 'store', X'504B0304', '2024-01-01T00:00:00Z')
      `).run();

      const ext = db.prepare('SELECT * FROM extensions WHERE id = ?').get('e1') as Record<string, unknown>;
      expect(ext.name).toBe('uBlock Origin');
      expect(ext.source).toBe('store');
    });

    it('should link extensions to profiles via junction table', () => {
      db.prepare(`INSERT INTO extensions (id, name, version, source, uploaded_at) VALUES ('e1', 'Ext1', '1.0', 'upload', '2024-01-01T00:00:00Z')`).run();

      db.prepare(`INSERT INTO profile_extensions (profile_id, extension_id) VALUES ('p1', 'e1')`).run();

      const links = db.prepare('SELECT * FROM profile_extensions WHERE profile_id = ?').all('p1');
      expect(links).toHaveLength(1);
    });

    it('should cascade delete profile_extensions when extension is deleted', () => {
      db.prepare(`INSERT INTO extensions (id, name, version, source, uploaded_at) VALUES ('e1', 'Ext1', '1.0', 'upload', '2024-01-01T00:00:00Z')`).run();
      db.prepare(`INSERT INTO profile_extensions (profile_id, extension_id) VALUES ('p1', 'e1')`).run();

      db.prepare('DELETE FROM extensions WHERE id = ?').run('e1');

      const links = db.prepare('SELECT * FROM profile_extensions WHERE profile_id = ?').all('p1');
      expect(links).toHaveLength(0);
    });
  });

  describe('profile_access table', () => {
    beforeEach(() => {
      db.prepare(`INSERT INTO users (id, username, password_hash, role, created_at, updated_at) VALUES ('u1', 'owner', 'hash', 'admin', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`).run();
      db.prepare(`INSERT INTO users (id, username, password_hash, role, created_at, updated_at) VALUES ('u2', 'member', 'hash', 'user', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`).run();
      db.prepare(`INSERT INTO profiles (id, name, browser_type, owner_id, created_at, updated_at) VALUES ('p1', 'Test', 'chromium', 'u1', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`).run();
    });

    it('should store profile access permissions as JSON', () => {
      const permissions = JSON.stringify(['use', 'edit']);
      db.prepare(`
        INSERT INTO profile_access (user_id, profile_id, permissions, granted_at)
        VALUES ('u2', 'p1', ?, '2024-01-01T00:00:00Z')
      `).run(permissions);

      const access = db.prepare('SELECT * FROM profile_access WHERE user_id = ? AND profile_id = ?').get('u2', 'p1') as Record<string, unknown>;
      expect(JSON.parse(access.permissions as string)).toEqual(['use', 'edit']);
    });

    it('should enforce composite primary key (user_id, profile_id)', () => {
      db.prepare(`INSERT INTO profile_access (user_id, profile_id, permissions, granted_at) VALUES ('u2', 'p1', '["use"]', '2024-01-01T00:00:00Z')`).run();

      expect(() => {
        db.prepare(`INSERT INTO profile_access (user_id, profile_id, permissions, granted_at) VALUES ('u2', 'p1', '["edit"]', '2024-01-01T00:00:00Z')`).run();
      }).toThrow();
    });
  });

  describe('rpa_scripts table', () => {
    beforeEach(() => {
      db.prepare(`INSERT INTO users (id, username, password_hash, role, created_at, updated_at) VALUES ('u1', 'owner', 'hash', 'admin', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`).run();
    });

    it('should accept valid RPA script data', () => {
      const actions = JSON.stringify([{ type: 'navigate', value: 'https://example.com' }]);
      db.prepare(`
        INSERT INTO rpa_scripts (id, name, owner_id, actions, error_handling, max_retries, is_template, platform, created_at, updated_at)
        VALUES ('s1', 'My Script', 'u1', ?, 'retry', 3, 0, NULL, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
      `).run(actions);

      const script = db.prepare('SELECT * FROM rpa_scripts WHERE id = ?').get('s1') as Record<string, unknown>;
      expect(script.name).toBe('My Script');
      expect(script.error_handling).toBe('retry');
      expect(script.max_retries).toBe(3);
    });

    it('should enforce valid error_handling values', () => {
      expect(() => {
        db.prepare(`
          INSERT INTO rpa_scripts (id, name, owner_id, actions, error_handling, created_at, updated_at)
          VALUES ('s1', 'Test', 'u1', '[]', 'crash', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')
        `).run();
      }).toThrow();
    });
  });

  describe('action_logs table', () => {
    beforeEach(() => {
      db.prepare(`INSERT INTO users (id, username, password_hash, role, created_at, updated_at) VALUES ('u1', 'admin', 'hash', 'admin', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`).run();
    });

    it('should accept valid action log entries', () => {
      const details = JSON.stringify({ ip: '192.168.1.1' });
      db.prepare(`
        INSERT INTO action_logs (id, user_id, username, action, profile_id, details, timestamp)
        VALUES ('al1', 'u1', 'admin', 'open_profile', 'p1', ?, '2024-01-01T00:00:00Z')
      `).run(details);

      const log = db.prepare('SELECT * FROM action_logs WHERE id = ?').get('al1') as Record<string, unknown>;
      expect(log.action).toBe('open_profile');
      expect(log.username).toBe('admin');
    });

    it('should allow null profile_id for non-profile actions', () => {
      db.prepare(`
        INSERT INTO action_logs (id, user_id, username, action, profile_id, details, timestamp)
        VALUES ('al1', 'u1', 'admin', 'login', NULL, NULL, '2024-01-01T00:00:00Z')
      `).run();

      const log = db.prepare('SELECT * FROM action_logs WHERE id = ?').get('al1') as Record<string, unknown>;
      expect(log.profile_id).toBeNull();
    });
  });

  describe('initializeDatabase is idempotent', () => {
    it('should not fail when called on an already-initialized database', () => {
      // The db is already initialized in beforeEach. Calling again should be safe.
      const db2 = initializeDatabase(dbPath);
      const tables = db2
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[];
      expect(tables.length).toBe(10);
      db2.close();
    });
  });
});
