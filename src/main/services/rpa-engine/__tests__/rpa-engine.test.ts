import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { initializeDatabase } from '../../../database/index';
import { RPAEngine } from '../rpa-engine';
import type { ActionExecutorFn } from '../rpa-engine';
import type { RPAScript, RPAAction } from '../../../../shared/types';

/** Creates a temp database and returns cleanup helpers. */
function createTestDb() {
  const dbPath = path.join(
    os.tmpdir(),
    `test-rpa-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  const db = initializeDatabase(dbPath);

  // Insert a 'system' user for foreign key constraints on owner_id
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
     VALUES ('system', 'system', 'hash', 'admin', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`,
  ).run();

  const cleanup = () => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
  };

  return { db, dbPath, cleanup };
}

/** A mock executor that records calls and can be configured to fail. */
function createMockExecutor() {
  const calls: Array<{ profileId: string; action: RPAAction }> = [];
  const failAtIndices = new Set<number>();
  let callCount = 0;
  // Track per-action attempt counts for retry testing
  const attemptCounts = new Map<number, number>();

  const executor: ActionExecutorFn = async (profileId, action) => {
    const currentIndex = callCount;
    calls.push({ profileId, action });

    // Determine the action index based on the action object
    const actionIndex = calls.filter((c) => c.action === action).length - 1;

    // Track attempts per original action index
    if (!attemptCounts.has(currentIndex)) {
      attemptCounts.set(currentIndex, 0);
    }

    callCount++;

    if (failAtIndices.has(currentIndex)) {
      throw new Error(`Action failed at call ${currentIndex}`);
    }
  };

  return {
    executor,
    calls,
    failAtIndices,
    attemptCounts,
    get callCount() { return callCount; },
    reset() {
      calls.length = 0;
      failAtIndices.clear();
      callCount = 0;
      attemptCounts.clear();
    },
  };
}

// ─── executeScript tests (Task 7.1) ───

describe('RPAEngine.executeScript', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let engine: RPAEngine;
  let mock: ReturnType<typeof createMockExecutor>;

  beforeEach(() => {
    const ctx = createTestDb();
    db = ctx.db;
    cleanup = ctx.cleanup;
    mock = createMockExecutor();
    engine = new RPAEngine(db, mock.executor);
  });

  afterEach(() => cleanup());

  it('should execute all actions sequentially and return success', async () => {
    const script: RPAScript = {
      name: 'Test Script',
      actions: [
        { type: 'navigate', value: 'https://example.com' },
        { type: 'click', selector: '#btn' },
        { type: 'type', selector: '#input', value: 'hello' },
        { type: 'wait', timeout: 1000 },
        { type: 'scroll', value: '500' },
        { type: 'screenshot', value: 'test.png' },
      ],
      errorHandling: 'stop',
    };

    const result = await engine.executeScript('profile-1', script);

    expect(result.success).toBe(true);
    expect(result.actionsCompleted).toBe(6);
    expect(result.totalActions).toBe(6);
    expect(result.errors).toHaveLength(0);
  });

  it('should pass the correct profileId and action to the executor', async () => {
    const script: RPAScript = {
      name: 'Profile Test',
      actions: [
        { type: 'navigate', value: 'https://example.com' },
        { type: 'click', selector: '.btn' },
      ],
      errorHandling: 'stop',
    };

    await engine.executeScript('my-profile', script);

    expect(mock.calls).toHaveLength(2);
    expect(mock.calls[0].profileId).toBe('my-profile');
    expect(mock.calls[0].action).toEqual({ type: 'navigate', value: 'https://example.com' });
    expect(mock.calls[1].profileId).toBe('my-profile');
    expect(mock.calls[1].action).toEqual({ type: 'click', selector: '.btn' });
  });

  it('should execute actions in order', async () => {
    const script: RPAScript = {
      name: 'Order Test',
      actions: [
        { type: 'navigate', value: 'https://first.com' },
        { type: 'navigate', value: 'https://second.com' },
        { type: 'navigate', value: 'https://third.com' },
      ],
      errorHandling: 'stop',
    };

    await engine.executeScript('p1', script);

    expect(mock.calls[0].action.value).toBe('https://first.com');
    expect(mock.calls[1].action.value).toBe('https://second.com');
    expect(mock.calls[2].action.value).toBe('https://third.com');
  });

  it('should handle an empty actions list', async () => {
    const script: RPAScript = {
      name: 'Empty Script',
      actions: [],
      errorHandling: 'stop',
    };

    const result = await engine.executeScript('p1', script);

    expect(result.success).toBe(true);
    expect(result.actionsCompleted).toBe(0);
    expect(result.totalActions).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('should report totalActions correctly regardless of errors', async () => {
    mock.failAtIndices.add(1);

    const script: RPAScript = {
      name: 'Total Test',
      actions: [
        { type: 'navigate', value: 'https://example.com' },
        { type: 'click', selector: '#fail' },
        { type: 'screenshot', value: 'test.png' },
      ],
      errorHandling: 'stop',
    };

    const result = await engine.executeScript('p1', script);

    expect(result.totalActions).toBe(3);
  });
});

// ─── Error handling tests (Task 7.2) ───

describe('RPAEngine error handling', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let engine: RPAEngine;
  let mock: ReturnType<typeof createMockExecutor>;

  beforeEach(() => {
    const ctx = createTestDb();
    db = ctx.db;
    cleanup = ctx.cleanup;
    mock = createMockExecutor();
    engine = new RPAEngine(db, mock.executor);
  });

  afterEach(() => cleanup());

  describe('stop mode', () => {
    it('should stop immediately on first failure', async () => {
      mock.failAtIndices.add(1);

      const script: RPAScript = {
        name: 'Stop Test',
        actions: [
          { type: 'navigate', value: 'https://example.com' },
          { type: 'click', selector: '#fail' },
          { type: 'screenshot', value: 'never-reached.png' },
        ],
        errorHandling: 'stop',
      };

      const result = await engine.executeScript('p1', script);

      expect(result.success).toBe(false);
      expect(result.actionsCompleted).toBe(1);
      expect(result.totalActions).toBe(3);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].actionIndex).toBe(1);
      expect(result.errors[0].message).toContain('Action failed');
      // The third action should never have been called
      expect(mock.calls).toHaveLength(2);
    });

    it('should include action details in the error', async () => {
      mock.failAtIndices.add(0);

      const failAction: RPAAction = { type: 'click', selector: '#missing' };
      const script: RPAScript = {
        name: 'Error Detail Test',
        actions: [failAction],
        errorHandling: 'stop',
      };

      const result = await engine.executeScript('p1', script);

      expect(result.errors[0].action).toEqual(failAction);
      expect(result.errors[0].timestamp).toBeTruthy();
    });
  });

  describe('skip mode', () => {
    it('should skip failed action and continue to next', async () => {
      mock.failAtIndices.add(1);

      const script: RPAScript = {
        name: 'Skip Test',
        actions: [
          { type: 'navigate', value: 'https://example.com' },
          { type: 'click', selector: '#fail' },
          { type: 'screenshot', value: 'still-reached.png' },
        ],
        errorHandling: 'skip',
      };

      const result = await engine.executeScript('p1', script);

      expect(result.success).toBe(false);
      expect(result.actionsCompleted).toBe(2); // action 0 and action 2 succeeded
      expect(result.totalActions).toBe(3);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].actionIndex).toBe(1);
      // All 3 actions should have been attempted
      expect(mock.calls).toHaveLength(3);
    });

    it('should continue even with multiple failures', async () => {
      mock.failAtIndices.add(0);
      mock.failAtIndices.add(2);

      const script: RPAScript = {
        name: 'Multi Skip Test',
        actions: [
          { type: 'click', selector: '#fail1' },
          { type: 'navigate', value: 'https://ok.com' },
          { type: 'click', selector: '#fail2' },
          { type: 'screenshot', value: 'ok.png' },
        ],
        errorHandling: 'skip',
      };

      const result = await engine.executeScript('p1', script);

      expect(result.success).toBe(false);
      expect(result.actionsCompleted).toBe(2);
      expect(result.errors).toHaveLength(2);
      expect(mock.calls).toHaveLength(4);
    });
  });

  describe('retry mode', () => {
    it('should retry failed action up to maxRetries times then stop', async () => {
      // Fail on every call (calls 0, 1, 2 = 3 attempts for action 0 with maxRetries=2)
      mock.failAtIndices.add(0);
      mock.failAtIndices.add(1);
      mock.failAtIndices.add(2);

      const script: RPAScript = {
        name: 'Retry Test',
        actions: [
          { type: 'click', selector: '#always-fail' },
          { type: 'screenshot', value: 'never-reached.png' },
        ],
        errorHandling: 'retry',
        maxRetries: 2,
      };

      const result = await engine.executeScript('p1', script);

      expect(result.success).toBe(false);
      expect(result.actionsCompleted).toBe(0);
      expect(result.errors).toHaveLength(1);
      // Should have attempted 3 times (1 initial + 2 retries)
      expect(mock.calls).toHaveLength(3);
    });

    it('should succeed if retry eventually works', async () => {
      // Fail on first attempt (call 0), succeed on retry (call 1)
      mock.failAtIndices.add(0);

      const script: RPAScript = {
        name: 'Retry Success Test',
        actions: [
          { type: 'click', selector: '#flaky' },
          { type: 'screenshot', value: 'reached.png' },
        ],
        errorHandling: 'retry',
        maxRetries: 2,
      };

      const result = await engine.executeScript('p1', script);

      expect(result.success).toBe(true);
      expect(result.actionsCompleted).toBe(2);
      expect(result.errors).toHaveLength(0);
    });

    it('should default maxRetries to 0 when not specified', async () => {
      mock.failAtIndices.add(0);

      const script: RPAScript = {
        name: 'No Retry Test',
        actions: [
          { type: 'click', selector: '#fail' },
        ],
        errorHandling: 'retry',
        // maxRetries not set — defaults to 0
      };

      const result = await engine.executeScript('p1', script);

      expect(result.success).toBe(false);
      // Only 1 attempt (0 retries)
      expect(mock.calls).toHaveLength(1);
    });
  });
});

// ─── saveScript and loadScript tests (Task 7.3) ───

describe('RPAEngine.saveScript and loadScript', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let engine: RPAEngine;

  beforeEach(() => {
    const ctx = createTestDb();
    db = ctx.db;
    cleanup = ctx.cleanup;
    engine = new RPAEngine(db);
  });

  afterEach(() => cleanup());

  it('should save a script and return an ID', () => {
    const script: RPAScript = {
      name: 'My Script',
      actions: [{ type: 'navigate', value: 'https://example.com' }],
      errorHandling: 'stop',
    };

    const id = engine.saveScript(script);

    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
  });

  it('should generate a UUID when script has no id', () => {
    const script: RPAScript = {
      name: 'No ID Script',
      actions: [],
      errorHandling: 'stop',
    };

    const id = engine.saveScript(script);

    // UUID v4 format
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('should use the provided script id when present', () => {
    const script: RPAScript = {
      id: 'custom-id-123',
      name: 'Custom ID Script',
      actions: [],
      errorHandling: 'stop',
    };

    // Need to insert a row first or use a valid UUID — but our schema allows any TEXT id
    // Actually, we need to handle the FK constraint. Let's use a UUID.
    const customId = '550e8400-e29b-41d4-a716-446655440000';
    script.id = customId;

    const id = engine.saveScript(script);

    expect(id).toBe(customId);
  });

  it('should load a saved script with all fields intact (round-trip)', () => {
    const script: RPAScript = {
      name: 'Round Trip Script',
      actions: [
        { type: 'navigate', value: 'https://example.com' },
        { type: 'click', selector: '#btn' },
        { type: 'type', selector: '#input', value: 'hello world' },
        { type: 'wait', timeout: 2000 },
        { type: 'scroll', value: '500' },
        { type: 'screenshot', value: 'test.png' },
      ],
      errorHandling: 'retry',
      maxRetries: 3,
    };

    const id = engine.saveScript(script);
    const loaded = engine.loadScript(id);

    expect(loaded.id).toBe(id);
    expect(loaded.name).toBe(script.name);
    expect(loaded.actions).toEqual(script.actions);
    expect(loaded.errorHandling).toBe(script.errorHandling);
    expect(loaded.maxRetries).toBe(script.maxRetries);
  });

  it('should update an existing script when saving with the same id', () => {
    const script: RPAScript = {
      name: 'Original Name',
      actions: [{ type: 'navigate', value: 'https://original.com' }],
      errorHandling: 'stop',
    };

    const id = engine.saveScript(script);

    // Update the script
    const updated: RPAScript = {
      id,
      name: 'Updated Name',
      actions: [
        { type: 'navigate', value: 'https://updated.com' },
        { type: 'click', selector: '#new' },
      ],
      errorHandling: 'skip',
    };

    const updatedId = engine.saveScript(updated);
    expect(updatedId).toBe(id);

    const loaded = engine.loadScript(id);
    expect(loaded.name).toBe('Updated Name');
    expect(loaded.actions).toEqual(updated.actions);
    expect(loaded.errorHandling).toBe('skip');
  });

  it('should throw when loading a non-existent script', () => {
    expect(() => engine.loadScript('non-existent-id')).toThrow('RPA script not found');
  });

  it('should accept an ownerId parameter', () => {
    // Insert another user for the FK
    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
       VALUES ('user-2', 'user2', 'hash', 'user', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`,
    ).run();

    const script: RPAScript = {
      name: 'Owned Script',
      actions: [],
      errorHandling: 'stop',
    };

    const id = engine.saveScript(script, 'user-2');

    const row = db
      .prepare('SELECT owner_id FROM rpa_scripts WHERE id = ?')
      .get(id) as { owner_id: string };

    expect(row.owner_id).toBe('user-2');
  });

  it('should default ownerId to system', () => {
    const script: RPAScript = {
      name: 'Default Owner Script',
      actions: [],
      errorHandling: 'stop',
    };

    const id = engine.saveScript(script);

    const row = db
      .prepare('SELECT owner_id FROM rpa_scripts WHERE id = ?')
      .get(id) as { owner_id: string };

    expect(row.owner_id).toBe('system');
  });

  it('should preserve maxRetries default of 0', () => {
    const script: RPAScript = {
      name: 'No Retries',
      actions: [],
      errorHandling: 'stop',
    };

    const id = engine.saveScript(script);
    const loaded = engine.loadScript(id);

    expect(loaded.maxRetries).toBe(0);
  });
});

// ─── Template tests (Task 7.4) ───

describe('RPAEngine templates', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let engine: RPAEngine;

  beforeEach(() => {
    const ctx = createTestDb();
    db = ctx.db;
    cleanup = ctx.cleanup;
    engine = new RPAEngine(db);
  });

  afterEach(() => cleanup());

  it('should seed built-in templates for Facebook, Amazon, and TikTok', () => {
    const templates = engine.listTemplates();

    expect(templates.length).toBe(3);

    const platforms = templates.map((t) => t.platform).sort();
    expect(platforms).toEqual(['amazon', 'facebook', 'tiktok']);
  });

  it('should return templates with id, name, platform, and description', () => {
    const templates = engine.listTemplates();

    for (const template of templates) {
      expect(template.id).toBeTruthy();
      expect(template.name).toBeTruthy();
      expect(['facebook', 'amazon', 'tiktok']).toContain(template.platform);
      expect(template.description).toBeTruthy();
    }
  });

  it('should filter templates by platform', () => {
    const fbTemplates = engine.listTemplates('facebook');
    expect(fbTemplates).toHaveLength(1);
    expect(fbTemplates[0].platform).toBe('facebook');

    const amzTemplates = engine.listTemplates('amazon');
    expect(amzTemplates).toHaveLength(1);
    expect(amzTemplates[0].platform).toBe('amazon');

    const ttTemplates = engine.listTemplates('tiktok');
    expect(ttTemplates).toHaveLength(1);
    expect(ttTemplates[0].platform).toBe('tiktok');
  });

  it('should return empty array for unknown platform', () => {
    const templates = engine.listTemplates('instagram');
    expect(templates).toHaveLength(0);
  });

  it('should not duplicate templates on multiple listTemplates calls', () => {
    engine.listTemplates();
    engine.listTemplates();
    engine.listTemplates();

    const templates = engine.listTemplates();
    expect(templates).toHaveLength(3);
  });

  it('should store templates with is_template=1 in the database', () => {
    engine.listTemplates(); // triggers seeding

    const rows = db
      .prepare('SELECT is_template, platform FROM rpa_scripts WHERE is_template = 1')
      .all() as Array<{ is_template: number; platform: string }>;

    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.is_template).toBe(1);
      expect(['facebook', 'amazon', 'tiktok']).toContain(row.platform);
    }
  });
});

// ─── loadTemplate tests (Task 7.5) ───

describe('RPAEngine.loadTemplate', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let engine: RPAEngine;

  beforeEach(() => {
    const ctx = createTestDb();
    db = ctx.db;
    cleanup = ctx.cleanup;
    engine = new RPAEngine(db);
  });

  afterEach(() => cleanup());

  it('should load a template as RPAScript without id', () => {
    const templates = engine.listTemplates();
    const fbTemplate = templates.find((t) => t.platform === 'facebook')!;

    const script = engine.loadTemplate(fbTemplate.id);

    expect(script.id).toBeUndefined();
    expect(script.name).toBeTruthy();
    expect(script.actions.length).toBeGreaterThan(0);
    expect(['stop', 'skip', 'retry']).toContain(script.errorHandling);
  });

  it('should return a valid RPAScript with all required fields', () => {
    const templates = engine.listTemplates();

    for (const template of templates) {
      const script = engine.loadTemplate(template.id);

      expect(script.name).toBeTruthy();
      expect(Array.isArray(script.actions)).toBe(true);
      expect(script.actions.length).toBeGreaterThan(0);
      expect(['stop', 'skip', 'retry']).toContain(script.errorHandling);

      // Each action should have a valid type
      for (const action of script.actions) {
        expect(['navigate', 'click', 'type', 'wait', 'scroll', 'screenshot']).toContain(action.type);
      }
    }
  });

  it('should not modify the original template when saving the loaded script', () => {
    const templates = engine.listTemplates();
    const amzTemplate = templates.find((t) => t.platform === 'amazon')!;

    // Load the template
    const script = engine.loadTemplate(amzTemplate.id);

    // Modify and save as a new script
    script.name = 'My Custom Amazon Script';
    script.actions.push({ type: 'wait', timeout: 5000 });
    const newId = engine.saveScript(script);

    // Verify the original template is unchanged
    const originalScript = engine.loadTemplate(amzTemplate.id);
    expect(originalScript.name).not.toBe('My Custom Amazon Script');
    expect(originalScript.actions).not.toContainEqual({ type: 'wait', timeout: 5000 });

    // Verify the new script is separate
    const savedScript = engine.loadScript(newId);
    expect(savedScript.name).toBe('My Custom Amazon Script');
    expect(savedScript.id).toBe(newId);
    expect(savedScript.id).not.toBe(amzTemplate.id);
  });

  it('should throw when loading a non-existent template', () => {
    engine.listTemplates(); // seed templates
    expect(() => engine.loadTemplate('non-existent-id')).toThrow('RPA template not found');
  });

  it('should throw when loading a regular script as a template', () => {
    // Save a regular script
    const script: RPAScript = {
      name: 'Regular Script',
      actions: [{ type: 'navigate', value: 'https://example.com' }],
      errorHandling: 'stop',
    };
    const id = engine.saveScript(script);

    // Try to load it as a template — should fail
    expect(() => engine.loadTemplate(id)).toThrow('RPA template not found');
  });
});
