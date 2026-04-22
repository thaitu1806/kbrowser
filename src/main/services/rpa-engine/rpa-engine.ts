/**
 * RPA Engine Service
 *
 * Executes no-code automation scripts sequentially, manages script
 * persistence (save/load), and provides built-in automation templates
 * for Facebook, Amazon, and TikTok.
 */

import crypto from 'crypto';
import type Database from 'better-sqlite3';
import type {
  RPAScript,
  RPAAction,
  RPAExecutionResult,
  RPAError,
  RPATemplate,
} from '../../../shared/types';

/**
 * Function signature for executing a single RPA action against a browser profile.
 * The default implementation would use Playwright; tests can inject a mock.
 */
export type ActionExecutorFn = (profileId: string, action: RPAAction) => Promise<void>;

/** Row shape returned from the rpa_scripts table. */
interface RPAScriptRow {
  id: string;
  name: string;
  owner_id: string;
  actions: string;
  error_handling: string;
  max_retries: number;
  is_template: number;
  platform: string | null;
  created_at: string;
  updated_at: string;
}

/** Built-in automation templates seeded on first use. */
const BUILT_IN_TEMPLATES: Array<{
  name: string;
  platform: 'facebook' | 'amazon' | 'tiktok';
  description: string;
  actions: RPAAction[];
  errorHandling: 'stop' | 'skip' | 'retry';
}> = [
  {
    name: 'Facebook Auto Login & Feed Scroll',
    platform: 'facebook',
    description: 'Automatically log in to Facebook and scroll through the news feed.',
    actions: [
      { type: 'navigate', value: 'https://www.facebook.com' },
      { type: 'click', selector: '#email' },
      { type: 'type', selector: '#email', value: '{{email}}' },
      { type: 'click', selector: '#pass' },
      { type: 'type', selector: '#pass', value: '{{password}}' },
      { type: 'click', selector: '[name="login"]' },
      { type: 'wait', timeout: 3000 },
      { type: 'scroll', value: '500' },
      { type: 'wait', timeout: 2000 },
      { type: 'scroll', value: '500' },
      { type: 'screenshot', value: 'facebook-feed.png' },
    ],
    errorHandling: 'skip',
  },
  {
    name: 'Amazon Product Search & Screenshot',
    platform: 'amazon',
    description: 'Search for a product on Amazon and capture a screenshot of the results.',
    actions: [
      { type: 'navigate', value: 'https://www.amazon.com' },
      { type: 'click', selector: '#twotabsearchtextbox' },
      { type: 'type', selector: '#twotabsearchtextbox', value: '{{search_term}}' },
      { type: 'click', selector: '#nav-search-submit-button' },
      { type: 'wait', timeout: 3000 },
      { type: 'scroll', value: '300' },
      { type: 'screenshot', value: 'amazon-results.png' },
    ],
    errorHandling: 'stop',
  },
  {
    name: 'TikTok Feed Browse',
    platform: 'tiktok',
    description: 'Open TikTok and browse the For You feed with scrolling.',
    actions: [
      { type: 'navigate', value: 'https://www.tiktok.com' },
      { type: 'wait', timeout: 3000 },
      { type: 'scroll', value: '800' },
      { type: 'wait', timeout: 2000 },
      { type: 'scroll', value: '800' },
      { type: 'wait', timeout: 2000 },
      { type: 'scroll', value: '800' },
      { type: 'screenshot', value: 'tiktok-feed.png' },
    ],
    errorHandling: 'skip',
  },
];

export class RPAEngine {
  private db: Database.Database;
  private actionExecutor: ActionExecutorFn;
  private templatesSeeded = false;

  /**
   * @param db - A better-sqlite3 database instance (already initialized with schema).
   * @param actionExecutor - Optional function to execute individual actions.
   *   Defaults to a no-op placeholder. In production, this would use Playwright.
   */
  constructor(db: Database.Database, actionExecutor?: ActionExecutorFn) {
    this.db = db;
    this.actionExecutor = actionExecutor ?? defaultActionExecutor;
  }

  /**
   * Executes an RPA script by running each action sequentially.
   *
   * Error handling modes:
   * - 'stop': On failure, stop immediately and return partial result with errors.
   * - 'skip': On failure, log the error and continue to the next action.
   * - 'retry': On failure, retry up to maxRetries times, then stop.
   *
   * @param profileId - The browser profile to execute against.
   * @param script - The RPA script to execute.
   * @returns Execution result with success status, completed count, and errors.
   */
  async executeScript(profileId: string, script: RPAScript): Promise<RPAExecutionResult> {
    const errors: RPAError[] = [];
    let actionsCompleted = 0;
    const totalActions = script.actions.length;
    const maxRetries = script.maxRetries ?? 0;

    for (let i = 0; i < totalActions; i++) {
      const action = script.actions[i];
      let succeeded = false;

      if (script.errorHandling === 'retry') {
        // Try the action up to (1 + maxRetries) times
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            await this.actionExecutor(profileId, action);
            succeeded = true;
            break;
          } catch (err: unknown) {
            if (attempt === maxRetries) {
              // All retries exhausted — record error and stop
              errors.push({
                actionIndex: i,
                action,
                message: err instanceof Error ? err.message : String(err),
                timestamp: new Date().toISOString(),
              });
            }
          }
        }

        if (!succeeded) {
          // Retry mode falls back to stop behavior after exhausting retries
          break;
        }
      } else {
        // 'stop' or 'skip' mode
        try {
          await this.actionExecutor(profileId, action);
          succeeded = true;
        } catch (err: unknown) {
          errors.push({
            actionIndex: i,
            action,
            message: err instanceof Error ? err.message : String(err),
            timestamp: new Date().toISOString(),
          });

          if (script.errorHandling === 'stop') {
            break;
          }
          // 'skip': continue to next action
        }
      }

      if (succeeded) {
        actionsCompleted++;
      }
    }

    return {
      success: errors.length === 0,
      actionsCompleted,
      totalActions,
      errors,
    };
  }

  /**
   * Saves an RPA script to the database.
   * If the script has no id, generates a new UUID.
   * Uses INSERT OR REPLACE to handle both create and update.
   *
   * @param script - The script to save.
   * @param ownerId - The owner user ID. Defaults to 'system'.
   * @returns The script ID.
   */
  saveScript(script: RPAScript, ownerId: string = 'system'): string {
    const id = script.id ?? crypto.randomUUID();
    const now = new Date().toISOString();

    const existing = this.db
      .prepare('SELECT id, created_at FROM rpa_scripts WHERE id = ?')
      .get(id) as { id: string; created_at: string } | undefined;

    if (existing) {
      this.db
        .prepare(
          `UPDATE rpa_scripts
           SET name = ?, actions = ?, error_handling = ?, max_retries = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          script.name,
          JSON.stringify(script.actions),
          script.errorHandling,
          script.maxRetries ?? 0,
          now,
          id,
        );
    } else {
      this.db
        .prepare(
          `INSERT INTO rpa_scripts (id, name, owner_id, actions, error_handling, max_retries, is_template, platform, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
        )
        .run(
          id,
          script.name,
          ownerId,
          JSON.stringify(script.actions),
          script.errorHandling,
          script.maxRetries ?? 0,
          now,
          now,
        );
    }

    return id;
  }

  /**
   * Loads an RPA script from the database by ID.
   *
   * @param scriptId - The script ID to load.
   * @returns The loaded RPAScript.
   * @throws Error if the script is not found.
   */
  loadScript(scriptId: string): RPAScript {
    const row = this.db
      .prepare('SELECT * FROM rpa_scripts WHERE id = ?')
      .get(scriptId) as RPAScriptRow | undefined;

    if (!row) {
      throw new Error(`RPA script not found: ${scriptId}`);
    }

    return rowToScript(row);
  }

  /**
   * Seeds built-in templates into the database if they haven't been seeded yet.
   * Templates are identified by is_template=1 and have a platform field.
   */
  seedTemplates(): void {
    if (this.templatesSeeded) return;

    // Check if templates already exist
    const count = this.db
      .prepare('SELECT COUNT(*) as cnt FROM rpa_scripts WHERE is_template = 1')
      .get() as { cnt: number };

    if (count.cnt >= BUILT_IN_TEMPLATES.length) {
      this.templatesSeeded = true;
      return;
    }

    const now = new Date().toISOString();
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO rpa_scripts (id, name, owner_id, actions, error_handling, max_retries, is_template, platform, created_at, updated_at)
       VALUES (?, ?, 'system', ?, ?, 0, 1, ?, ?, ?)`,
    );

    const transaction = this.db.transaction(() => {
      for (const template of BUILT_IN_TEMPLATES) {
        const id = crypto.randomUUID();
        insert.run(
          id,
          template.name,
          JSON.stringify(template.actions),
          template.errorHandling,
          template.platform,
          now,
          now,
        );
      }
    });

    transaction();
    this.templatesSeeded = true;
  }

  /**
   * Lists available automation templates, optionally filtered by platform.
   *
   * @param platform - Optional platform filter ('facebook', 'amazon', 'tiktok').
   * @returns Array of RPATemplate objects.
   */
  listTemplates(platform?: string): RPATemplate[] {
    this.seedTemplates();

    let rows: RPAScriptRow[];
    if (platform) {
      rows = this.db
        .prepare('SELECT * FROM rpa_scripts WHERE is_template = 1 AND platform = ?')
        .all(platform) as RPAScriptRow[];
    } else {
      rows = this.db
        .prepare('SELECT * FROM rpa_scripts WHERE is_template = 1')
        .all() as RPAScriptRow[];
    }

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      platform: row.platform as 'facebook' | 'amazon' | 'tiktok',
      description: getTemplateDescription(row.name),
    }));
  }

  /**
   * Loads a template as an RPAScript without the id field,
   * so that saving it creates a new copy rather than overwriting the template.
   *
   * @param templateId - The template ID to load.
   * @returns An RPAScript based on the template (without id).
   * @throws Error if the template is not found.
   */
  loadTemplate(templateId: string): RPAScript {
    this.seedTemplates();

    const row = this.db
      .prepare('SELECT * FROM rpa_scripts WHERE id = ? AND is_template = 1')
      .get(templateId) as RPAScriptRow | undefined;

    if (!row) {
      throw new Error(`RPA template not found: ${templateId}`);
    }

    // Return without id so saving creates a new script
    return {
      name: row.name,
      actions: JSON.parse(row.actions) as RPAAction[],
      errorHandling: row.error_handling as 'stop' | 'skip' | 'retry',
      maxRetries: row.max_retries,
    };
  }
}

/** Default action executor — placeholder that does nothing. */
async function defaultActionExecutor(_profileId: string, _action: RPAAction): Promise<void> {
  // In production, this would use Playwright to execute the action.
}

/** Converts a database row to an RPAScript object. */
function rowToScript(row: RPAScriptRow): RPAScript {
  return {
    id: row.id,
    name: row.name,
    actions: JSON.parse(row.actions) as RPAAction[],
    errorHandling: row.error_handling as 'stop' | 'skip' | 'retry',
    maxRetries: row.max_retries,
  };
}

/** Returns the description for a built-in template by name. */
function getTemplateDescription(name: string): string {
  const template = BUILT_IN_TEMPLATES.find((t) => t.name === name);
  return template?.description ?? '';
}
