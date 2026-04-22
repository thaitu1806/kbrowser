/**
 * Property-based tests for RPA Engine (P16–P20).
 *
 * P16: RPA thực thi tuần tự đúng thứ tự
 * P17: RPA xử lý lỗi theo cấu hình
 * P18: Lưu kịch bản RPA là round-trip
 * P19: Tải mẫu tạo RPAScript hợp lệ
 * P20: Tùy chỉnh mẫu không ghi đè mẫu gốc
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { initializeDatabase } from '../../../database/index';
import { RPAEngine } from '../rpa-engine';
import type { ActionExecutorFn } from '../rpa-engine';
import type { RPAScript, RPAAction } from '../../../../shared/types';
import { assertProperty, propertyTag } from '../../../../test-helpers/fast-check-helpers';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Creates a temp database and returns cleanup helpers. */
function createTestDb() {
  const dbPath = path.join(
    os.tmpdir(),
    `prop-rpa-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
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

// ---------------------------------------------------------------------------
// Arbitraries (generators)
// ---------------------------------------------------------------------------

/** Valid RPA action types. */
const ACTION_TYPES: RPAAction['type'][] = [
  'navigate', 'click', 'type', 'wait', 'scroll', 'screenshot',
];

/** Arbitrary for a single valid RPAAction. */
const arbRPAAction: fc.Arbitrary<RPAAction> = fc
  .constantFrom(...ACTION_TYPES)
  .chain((type) => {
    switch (type) {
      case 'navigate':
        return fc
          .webUrl({ withFragments: false, withQueryParameters: false })
          .map((url) => ({ type: 'navigate' as const, value: url }));
      case 'click':
        return fc
          .stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz-_'.split('')), {
            minLength: 1,
            maxLength: 20,
          })
          .map((sel) => ({ type: 'click' as const, selector: `#${sel}` }));
      case 'type':
        return fc
          .tuple(
            fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz-_'.split('')), {
              minLength: 1,
              maxLength: 20,
            }),
            fc.string({ minLength: 1, maxLength: 50 }),
          )
          .map(([sel, val]) => ({
            type: 'type' as const,
            selector: `#${sel}`,
            value: val,
          }));
      case 'wait':
        return fc
          .integer({ min: 100, max: 10000 })
          .map((t) => ({ type: 'wait' as const, timeout: t }));
      case 'scroll':
        return fc
          .integer({ min: 1, max: 5000 })
          .map((v) => ({ type: 'scroll' as const, value: String(v) }));
      case 'screenshot':
        return fc
          .stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')), {
            minLength: 1,
            maxLength: 20,
          })
          .map((name) => ({ type: 'screenshot' as const, value: `${name}.png` }));
      default:
        return fc.constant({ type } as RPAAction);
    }
  });

/** Arbitrary for a non-empty array of RPAActions (1–10 actions). */
const arbRPAActions: fc.Arbitrary<RPAAction[]> = fc.array(arbRPAAction, {
  minLength: 1,
  maxLength: 10,
});

/** Arbitrary for error handling mode. */
const arbErrorHandling: fc.Arbitrary<'stop' | 'skip' | 'retry'> = fc.constantFrom(
  'stop' as const,
  'skip' as const,
  'retry' as const,
);

/** Arbitrary for a valid script name. */
const arbScriptName: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(
    ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_'.split(''),
  ),
  { minLength: 1, maxLength: 50 },
);

/** Arbitrary for a valid RPAScript (without id, for saving). */
const arbRPAScript: fc.Arbitrary<RPAScript> = fc
  .tuple(arbScriptName, arbRPAActions, arbErrorHandling, fc.integer({ min: 0, max: 5 }))
  .map(([name, actions, errorHandling, maxRetries]) => ({
    name,
    actions,
    errorHandling,
    maxRetries,
  }));

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

let db: Database.Database;
let cleanup: () => void;

function setup() {
  const ctx = createTestDb();
  db = ctx.db;
  cleanup = ctx.cleanup;
}

function teardown() {
  cleanup();
}

// ---------------------------------------------------------------------------
// P16: RPA thực thi tuần tự đúng thứ tự
// ---------------------------------------------------------------------------

describe('RPA Engine property tests', () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  /**
   * **Validates: Requirements 8.3**
   *
   * Property 16: RPA thực thi tuần tự đúng thứ tự
   *
   * For any RPA script with a list of actions, actions must be executed
   * in the exact order defined in the script.
   */
  it(
    propertyTag(16, 'RPA thực thi tuần tự đúng thứ tự'),
    async () => {
      await assertProperty(
        fc.asyncProperty(arbRPAActions, async (actions) => {
          // Mock executor that records execution order
          const executionOrder: RPAAction[] = [];
          const executor: ActionExecutorFn = async (_profileId, action) => {
            executionOrder.push(action);
          };

          const engine = new RPAEngine(db, executor);
          const script: RPAScript = {
            name: 'Order Test',
            actions,
            errorHandling: 'stop',
          };

          await engine.executeScript('profile-1', script);

          // Verify actions were executed in the exact order defined
          expect(executionOrder).toHaveLength(actions.length);
          for (let i = 0; i < actions.length; i++) {
            expect(executionOrder[i]).toEqual(actions[i]);
          }
        }),
      );
    },
  );

  // ---------------------------------------------------------------------------
  // P17: RPA xử lý lỗi theo cấu hình
  // ---------------------------------------------------------------------------

  /**
   * **Validates: Requirements 8.4**
   *
   * Property 17: RPA xử lý lỗi theo cấu hình
   *
   * For any RPA script with a failing action, the system must handle errors
   * according to config:
   * - stop: halt immediately
   * - skip: continue to next action
   * - retry: retry up to maxRetries times
   */
  it(
    propertyTag(17, 'RPA xử lý lỗi theo cấu hình'),
    async () => {
      await assertProperty(
        fc.asyncProperty(
          // Generate actions (at least 2 so we can fail one in the middle)
          fc.array(arbRPAAction, { minLength: 2, maxLength: 8 }),
          arbErrorHandling,
          fc.integer({ min: 1, max: 3 }),
          async (actions, errorHandling, maxRetries) => {
            // Pick a fail index in the first half so there are actions after it
            const failIndex = Math.floor(actions.length / 2);

            let callIndex = 0;
            const executedActions: number[] = [];

            const executor: ActionExecutorFn = async (_profileId, _action) => {
              const currentCall = callIndex++;

              if (errorHandling === 'retry') {
                // For retry mode, we need to track which action index we're on.
                // The engine retries the same action, so calls beyond the original
                // action count are retries. We fail all attempts for the target action.
                // We track by checking if this is the failing action's attempts.
                // The engine calls actions sequentially, retrying the failing one.
                // Actions before failIndex succeed (callIndex 0..failIndex-1).
                // Then failIndex action is attempted (1 + maxRetries) times.
                if (currentCall >= failIndex && currentCall <= failIndex + maxRetries) {
                  throw new Error(`Fail at call ${currentCall}`);
                }
                // Track successful action indices
                if (currentCall < failIndex) {
                  executedActions.push(currentCall);
                } else {
                  executedActions.push(currentCall);
                }
              } else {
                // For stop/skip: each call corresponds to one action
                executedActions.push(currentCall);
                if (currentCall === failIndex) {
                  throw new Error(`Fail at action ${failIndex}`);
                }
              }
            };

            const engine = new RPAEngine(db, executor);
            const script: RPAScript = {
              name: 'Error Handling Test',
              actions,
              errorHandling,
              maxRetries,
            };

            const result = await engine.executeScript('profile-1', script);

            // Verify error handling behavior
            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThanOrEqual(1);
            expect(result.errors[0].actionIndex).toBe(failIndex);

            if (errorHandling === 'stop') {
              // Stop mode: should halt at the failing action, no actions after it
              expect(result.actionsCompleted).toBe(failIndex);
            } else if (errorHandling === 'skip') {
              // Skip mode: should continue past the failure
              // All actions attempted, only the failing one didn't complete
              expect(result.actionsCompleted).toBe(actions.length - 1);
            } else if (errorHandling === 'retry') {
              // Retry mode: should have attempted (1 + maxRetries) times for the failing action
              // then stopped (retry falls back to stop after exhausting retries)
              expect(result.actionsCompleted).toBe(failIndex);
            }
          },
        ),
      );
    },
  );

  // ---------------------------------------------------------------------------
  // P18: Lưu kịch bản RPA là round-trip
  // ---------------------------------------------------------------------------

  /**
   * **Validates: Requirements 8.5**
   *
   * Property 18: Lưu kịch bản RPA là round-trip
   *
   * For any valid RPAScript, after saving and loading, the script must be
   * equivalent including name, actions, and error handling config.
   */
  it(
    propertyTag(18, 'Lưu kịch bản RPA là round-trip'),
    async () => {
      await assertProperty(
        fc.asyncProperty(arbRPAScript, async (script) => {
          const engine = new RPAEngine(db);

          // Save the script
          const id = engine.saveScript(script);

          // Load it back
          const loaded = engine.loadScript(id);

          // Verify round-trip equivalence
          expect(loaded.id).toBe(id);
          expect(loaded.name).toBe(script.name);
          expect(loaded.actions).toEqual(script.actions);
          expect(loaded.errorHandling).toBe(script.errorHandling);
          expect(loaded.maxRetries).toBe(script.maxRetries ?? 0);
        }),
      );
    },
  );

  // ---------------------------------------------------------------------------
  // P19: Tải mẫu tạo RPAScript hợp lệ
  // ---------------------------------------------------------------------------

  /**
   * **Validates: Requirements 9.2**
   *
   * Property 19: Tải mẫu tạo RPAScript hợp lệ
   *
   * For any template in the library, loading it must produce a valid RPAScript
   * with all required fields.
   */
  it(
    propertyTag(19, 'Tải mẫu tạo RPAScript hợp lệ'),
    async () => {
      const engine = new RPAEngine(db);
      const templates = engine.listTemplates();

      // Use constantFrom to pick a random template each iteration
      await assertProperty(
        fc.asyncProperty(
          fc.constantFrom(...templates.map((t) => t.id)),
          async (templateId) => {
            const script = engine.loadTemplate(templateId);

            // Must have a non-empty name
            expect(typeof script.name).toBe('string');
            expect(script.name.length).toBeGreaterThan(0);

            // Must have a non-empty actions array
            expect(Array.isArray(script.actions)).toBe(true);
            expect(script.actions.length).toBeGreaterThan(0);

            // Each action must have a valid type
            const validTypes = ['navigate', 'click', 'type', 'wait', 'scroll', 'screenshot'];
            for (const action of script.actions) {
              expect(validTypes).toContain(action.type);
            }

            // Must have a valid errorHandling mode
            expect(['stop', 'skip', 'retry']).toContain(script.errorHandling);

            // Must NOT have an id (so saving creates a new copy)
            expect(script.id).toBeUndefined();
          },
        ),
      );
    },
  );

  // ---------------------------------------------------------------------------
  // P20: Tùy chỉnh mẫu không ghi đè mẫu gốc
  // ---------------------------------------------------------------------------

  /**
   * **Validates: Requirements 9.3**
   *
   * Property 20: Tùy chỉnh mẫu không ghi đè mẫu gốc
   *
   * For any template, when customized and saved, the original template
   * must remain unchanged.
   */
  it(
    propertyTag(20, 'Tùy chỉnh mẫu không ghi đè mẫu gốc'),
    async () => {
      const engine = new RPAEngine(db);
      const templates = engine.listTemplates();

      await assertProperty(
        fc.asyncProperty(
          fc.constantFrom(...templates.map((t) => t.id)),
          arbScriptName,
          arbRPAAction,
          async (templateId, customName, extraAction) => {
            // Snapshot the original template
            const original = engine.loadTemplate(templateId);
            const originalName = original.name;
            const originalActions = JSON.parse(JSON.stringify(original.actions));
            const originalErrorHandling = original.errorHandling;

            // Customize the loaded script
            original.name = customName;
            original.actions.push(extraAction);

            // Save the customized version as a new script
            const newId = engine.saveScript(original);

            // Reload the original template — it must be unchanged
            const reloaded = engine.loadTemplate(templateId);

            expect(reloaded.name).toBe(originalName);
            expect(reloaded.actions).toEqual(originalActions);
            expect(reloaded.errorHandling).toBe(originalErrorHandling);

            // The saved copy must be separate
            const saved = engine.loadScript(newId);
            expect(saved.id).toBe(newId);
            expect(saved.name).toBe(customName);
          },
        ),
      );
    },
  );
});
