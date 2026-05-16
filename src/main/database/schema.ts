/**
 * SQL schema definitions for the Digital Identity Management system.
 * All tables use TEXT for IDs (UUIDs) and TEXT for timestamps (ISO 8601).
 */

export const SCHEMA_SQL = `
-- Users table: stores user accounts and roles
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'user')),
  api_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Proxies table: stores proxy configurations
-- Created before profiles because profiles reference proxies
CREATE TABLE IF NOT EXISTS proxies (
  id TEXT PRIMARY KEY,
  protocol TEXT NOT NULL CHECK (protocol IN ('http', 'https', 'socks5')),
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  username TEXT,
  password TEXT,
  status TEXT,
  response_time_ms INTEGER,
  last_checked_at TEXT
);

-- Profiles table: stores browser profile configurations
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  browser_type TEXT NOT NULL CHECK (browser_type IN ('chromium', 'firefox')),
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'closed' CHECK (status IN ('open', 'closed')),
  fingerprint_config TEXT,
  proxy_id TEXT,
  sync_enabled INTEGER NOT NULL DEFAULT 0 CHECK (sync_enabled IN (0, 1)),
  sync_status TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id),
  FOREIGN KEY (proxy_id) REFERENCES proxies(id) ON DELETE SET NULL
);

-- Profile data table: stores isolated storage data (cookies, localStorage, etc.)
CREATE TABLE IF NOT EXISTS profile_data (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  data_type TEXT NOT NULL CHECK (data_type IN ('cookie', 'localstorage', 'indexeddb', 'cache')),
  data BLOB,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- Rotation configs table: IP rotation settings per profile
CREATE TABLE IF NOT EXISTS rotation_configs (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  interval_seconds INTEGER NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('luminati', 'oxylabs')),
  api_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- Extensions table: stores browser extensions
CREATE TABLE IF NOT EXISTS extensions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('upload', 'store')),
  file_data BLOB,
  uploaded_at TEXT NOT NULL
);

-- Profile extensions junction table: maps extensions to profiles
CREATE TABLE IF NOT EXISTS profile_extensions (
  profile_id TEXT NOT NULL,
  extension_id TEXT NOT NULL,
  PRIMARY KEY (profile_id, extension_id),
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (extension_id) REFERENCES extensions(id) ON DELETE CASCADE
);

-- Profile access table: shared profile permissions
CREATE TABLE IF NOT EXISTS profile_access (
  user_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  permissions TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  PRIMARY KEY (user_id, profile_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- RPA scripts table: automation scripts
CREATE TABLE IF NOT EXISTS rpa_scripts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  actions TEXT NOT NULL,
  error_handling TEXT NOT NULL DEFAULT 'stop' CHECK (error_handling IN ('stop', 'skip', 'retry')),
  max_retries INTEGER NOT NULL DEFAULT 0,
  is_template INTEGER NOT NULL DEFAULT 0 CHECK (is_template IN (0, 1)),
  platform TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

-- Action logs table: audit trail for user actions
CREATE TABLE IF NOT EXISTS action_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  action TEXT NOT NULL,
  profile_id TEXT,
  details TEXT,
  timestamp TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_profiles_owner_id ON profiles(owner_id);
CREATE INDEX IF NOT EXISTS idx_profiles_status ON profiles(status);
CREATE INDEX IF NOT EXISTS idx_profile_data_profile_id ON profile_data(profile_id);
CREATE INDEX IF NOT EXISTS idx_rotation_configs_profile_id ON rotation_configs(profile_id);
CREATE INDEX IF NOT EXISTS idx_profile_access_user_id ON profile_access(user_id);
CREATE INDEX IF NOT EXISTS idx_rpa_scripts_owner_id ON rpa_scripts(owner_id);
CREATE INDEX IF NOT EXISTS idx_rpa_scripts_is_template ON rpa_scripts(is_template);
CREATE INDEX IF NOT EXISTS idx_action_logs_user_id ON action_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_action_logs_timestamp ON action_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_action_logs_profile_id ON action_logs(profile_id);

-- Groups table: profile groups for organization
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  remark TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Add group_id to profiles if not exists (migration-safe)
-- SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we use a pragma check

-- RPA Tasks table: stores each RPA execution unit
CREATE TABLE IF NOT EXISTS rpa_tasks (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  script_id TEXT NOT NULL,
  batch_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  execution_order TEXT NOT NULL DEFAULT 'ordered'
    CHECK (execution_order IN ('ordered', 'random')),
  task_type TEXT NOT NULL DEFAULT 'common'
    CHECK (task_type IN ('common', 'scheduled')),
  priority INTEGER NOT NULL DEFAULT 0
    CHECK (priority IN (0, 1)),
  queue_position INTEGER NOT NULL DEFAULT 0,
  actions_completed INTEGER NOT NULL DEFAULT 0,
  total_actions INTEGER NOT NULL DEFAULT 0,
  current_action TEXT,
  error_message TEXT,
  error_details TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (script_id) REFERENCES rpa_scripts(id) ON DELETE SET NULL
);

-- RPA Schedules table: automatic execution configuration
CREATE TABLE IF NOT EXISTS rpa_schedules (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  script_id TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  execution_order TEXT NOT NULL DEFAULT 'ordered'
    CHECK (execution_order IN ('ordered', 'random')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'cancelled', 'expired')),
  start_time TEXT,
  end_time TEXT,
  last_triggered_at TEXT,
  next_trigger_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (script_id) REFERENCES rpa_scripts(id) ON DELETE SET NULL
);

-- Profile RPA Config table: stores most recent RPA config per profile
CREATE TABLE IF NOT EXISTS profile_rpa_config (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL UNIQUE,
  script_id TEXT,
  original_script_id TEXT,
  execution_order TEXT NOT NULL DEFAULT 'ordered'
    CHECK (execution_order IN ('ordered', 'random')),
  task_type TEXT NOT NULL DEFAULT 'common'
    CHECK (task_type IN ('common', 'scheduled')),
  priority INTEGER NOT NULL DEFAULT 0
    CHECK (priority IN (0, 1)),
  schedule_config TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (script_id) REFERENCES rpa_scripts(id) ON DELETE SET NULL
);

-- RPA Tasks indexes
CREATE INDEX IF NOT EXISTS idx_rpa_tasks_profile_id ON rpa_tasks(profile_id);
CREATE INDEX IF NOT EXISTS idx_rpa_tasks_status ON rpa_tasks(status);
CREATE INDEX IF NOT EXISTS idx_rpa_tasks_batch_id ON rpa_tasks(batch_id);
CREATE INDEX IF NOT EXISTS idx_rpa_tasks_queue_position ON rpa_tasks(profile_id, status, queue_position);

-- RPA Schedules indexes
CREATE INDEX IF NOT EXISTS idx_rpa_schedules_profile_id ON rpa_schedules(profile_id);
CREATE INDEX IF NOT EXISTS idx_rpa_schedules_status ON rpa_schedules(status);
CREATE INDEX IF NOT EXISTS idx_rpa_schedules_next_trigger ON rpa_schedules(next_trigger_at);

-- Profile RPA Config index
CREATE INDEX IF NOT EXISTS idx_profile_rpa_config_profile_id ON profile_rpa_config(profile_id);
`;
