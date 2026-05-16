/**
 * Config Store
 *
 * Persists and retrieves the most recent RPA configuration for each profile.
 * Uses the `profile_rpa_config` table for storage.
 * On load, validates that the referenced script still exists and returns
 * a warning flag if the script has been deleted.
 */

import crypto from 'crypto';
import type Database from 'better-sqlite3';
import type { ProfileRPAConfig } from '../../../shared/types/rpa-orchestrator';

/** Result of loading a profile's RPA config */
export interface LoadConfigResult {
  config: ProfileRPAConfig;
  scriptDeleted: boolean;
}

/**
 * Maps a database row (snake_case) to a ProfileRPAConfig interface (camelCase).
 */
function rowToConfig(row: Record<string, unknown>): ProfileRPAConfig {
  return {
    profileId: row.profile_id as string,
    scriptId: (row.script_id as string) || undefined,
    executionOrder: row.execution_order as ProfileRPAConfig['executionOrder'],
    taskType: row.task_type as ProfileRPAConfig['taskType'],
    priority: (row.priority as number) === 1,
    scheduleConfig: row.schedule_config
      ? JSON.parse(row.schedule_config as string)
      : undefined,
    updatedAt: row.updated_at as string,
  };
}

export class ConfigStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Save (upsert) the RPA configuration for a profile.
   * If a config already exists for the profile, it is replaced.
   */
  save(profileId: string, config: ProfileRPAConfig): void {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT OR REPLACE INTO profile_rpa_config (
          id, profile_id, script_id, original_script_id, execution_order, task_type,
          priority, schedule_config, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        profileId,
        config.scriptId ?? null,
        config.scriptId ?? null,
        config.executionOrder,
        config.taskType,
        config.priority ? 1 : 0,
        config.scheduleConfig ? JSON.stringify(config.scheduleConfig) : null,
        now
      );
  }

  /**
   * Load the saved RPA configuration for a profile.
   * Returns null if no config exists.
   * If the referenced script has been deleted, returns scriptDeleted: true.
   * Detection: if original_script_id is set but script_id is NULL (due to ON DELETE SET NULL),
   * or if script_id is set but the script no longer exists in rpa_scripts.
   */
  load(profileId: string): LoadConfigResult | null {
    const row = this.db
      .prepare(
        `SELECT * FROM profile_rpa_config WHERE profile_id = ?`
      )
      .get(profileId) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    const config = rowToConfig(row);

    let scriptDeleted = false;

    // Case 1: script_id was set to NULL by FK cascade (ON DELETE SET NULL)
    // but original_script_id still holds the original value
    const originalScriptId = row.original_script_id as string | null;
    if (!row.script_id && originalScriptId) {
      scriptDeleted = true;
    }

    // Case 2: script_id is still set but the script doesn't exist
    // (e.g., FK constraints disabled or manual deletion without cascade)
    if (config.scriptId) {
      scriptDeleted = !this.validateScriptExists(config.scriptId);
    }

    return { config, scriptDeleted };
  }

  /**
   * Delete the saved RPA configuration for a profile.
   */
  delete(profileId: string): void {
    this.db
      .prepare(`DELETE FROM profile_rpa_config WHERE profile_id = ?`)
      .run(profileId);
  }

  /**
   * Check if a script exists in the rpa_scripts table.
   * Returns true if the script exists, false otherwise.
   */
  validateScriptExists(scriptId: string): boolean {
    const result = this.db
      .prepare(`SELECT COUNT(*) as count FROM rpa_scripts WHERE id = ?`)
      .get(scriptId) as { count: number };

    return result.count > 0;
  }
}
