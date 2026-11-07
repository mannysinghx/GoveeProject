-- Initial schema. Timestamps are ISO-8601 UTC strings unless noted otherwise.

-- Exactly one owner. The CHECK makes a second row impossible, so a setup race
-- cannot create a second account.
CREATE TABLE users (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  username      TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- Only a SHA-256 hash of the session token is stored, so a stolen database file
-- does not hold usable session cookies.
CREATE TABLE sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE login_attempts (
  throttle_key    TEXT PRIMARY KEY,
  failures        INTEGER NOT NULL,
  window_started  TEXT NOT NULL,
  locked_until    TEXT
);

-- Discovery marks a vanished device as 'missing'. Rows are never deleted by
-- discovery, so history, presets and schedules survive.
CREATE TABLE devices (
  id                     TEXT PRIMARY KEY,
  govee_device_id        TEXT NOT NULL,
  sku                    TEXT NOT NULL,
  name                   TEXT NOT NULL,
  device_type            TEXT,
  capabilities_json      TEXT NOT NULL,
  discovery_status       TEXT NOT NULL CHECK (discovery_status IN ('present', 'missing')),
  first_discovered_at    TEXT NOT NULL,
  last_discovered_at     TEXT NOT NULL,
  missing_since          TEXT,
  online                 INTEGER CHECK (online IN (0, 1)),
  last_status_refresh_at TEXT,
  last_online_at         TEXT,
  last_request_at        TEXT,
  last_accepted_at       TEXT,
  last_status_error_json TEXT,
  scenes_fetched_at      TEXT,
  scene_errors_json      TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  UNIQUE (sku, govee_device_id)
);

-- Snapshots of what Govee reported.
CREATE TABLE device_states (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id           TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  reported_state_json TEXT NOT NULL,
  online              INTEGER,
  reported_at         TEXT NOT NULL,
  source              TEXT NOT NULL CHECK (source IN ('manual', 'poll', 'post_command'))
);
CREATE INDEX idx_device_states_device ON device_states(device_id, reported_at DESC);

-- Keeps requested, accepted and reported values apart for each setting.
CREATE TABLE capability_states (
  device_id            TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  instance             TEXT NOT NULL,
  requested_value_json TEXT,
  requested_at         TEXT,
  accepted_value_json  TEXT,
  accepted_at          TEXT,
  reported_value_json  TEXT,
  reported_at          TEXT,
  reported_historical  INTEGER NOT NULL DEFAULT 0,
  not_queryable        INTEGER NOT NULL DEFAULT 0,
  verification         TEXT,
  PRIMARY KEY (device_id, instance)
);

CREATE TABLE device_scenes (
  device_id       TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  scene_key       TEXT NOT NULL,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('static', 'dynamic', 'diy', 'snapshot')),
  capability_type TEXT NOT NULL,
  instance        TEXT NOT NULL,
  value_json      TEXT NOT NULL,
  source          TEXT NOT NULL CHECK (source IN ('device_list', 'scenes_endpoint', 'diy_endpoint')),
  fetched_at      TEXT NOT NULL,
  PRIMARY KEY (device_id, scene_key)
);

CREATE TABLE groups (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE group_devices (
  group_id  TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, device_id)
);
CREATE INDEX idx_group_devices_device ON group_devices(device_id);

CREATE TABLE presets (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- device_id NULL means the action applies to whichever device or group the
-- preset is applied to.
CREATE TABLE preset_actions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  preset_id           TEXT NOT NULL REFERENCES presets(id) ON DELETE CASCADE,
  device_id           TEXT REFERENCES devices(id) ON DELETE RESTRICT,
  action_type         TEXT NOT NULL,
  action_payload_json TEXT NOT NULL,
  execution_order     INTEGER NOT NULL,
  UNIQUE (preset_id, execution_order)
);
CREATE INDEX idx_preset_actions_device ON preset_actions(device_id);

-- One row per preset, group or schedule run, with per-action results.
CREATE TABLE execution_runs (
  id           TEXT PRIMARY KEY,
  source_type  TEXT NOT NULL CHECK (source_type IN ('manual', 'preset', 'group', 'schedule')),
  source_id    TEXT,
  source_name  TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('running', 'all_accepted', 'partial', 'failed', 'skipped')),
  outcomes_json TEXT NOT NULL DEFAULT '[]',
  started_at   TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_execution_runs_source ON execution_runs(source_type, source_id, started_at DESC);

CREATE TABLE schedules (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  enabled           INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  time_zone         TEXT NOT NULL,
  recurrence_json   TEXT NOT NULL,
  target_json       TEXT NOT NULL,
  action_json       TEXT NOT NULL,
  missed_run_policy TEXT NOT NULL CHECK (missed_run_policy IN ('skip', 'run_latest')),
  next_run_at       TEXT,
  last_evaluated_at TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX idx_schedules_due ON schedules(enabled, next_run_at);

-- UNIQUE (schedule_id, occurrence_key) is the durable guard against running the
-- same occurrence twice, including across restarts.
CREATE TABLE schedule_executions (
  id             TEXT PRIMARY KEY,
  schedule_id    TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  occurrence_key TEXT NOT NULL,
  scheduled_for  TEXT NOT NULL,
  started_at     TEXT,
  completed_at   TEXT,
  status         TEXT NOT NULL CHECK (status IN
                   ('running', 'all_accepted', 'partial', 'failed', 'skipped', 'missed', 'interrupted')),
  is_recovery    INTEGER NOT NULL DEFAULT 0,
  error_summary  TEXT,
  run_id         TEXT REFERENCES execution_runs(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL,
  UNIQUE (schedule_id, occurrence_key)
);
CREATE INDEX idx_schedule_exec_schedule ON schedule_executions(schedule_id, scheduled_for DESC);

CREATE TABLE command_history (
  id              TEXT PRIMARY KEY,
  device_id       TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  source_type     TEXT NOT NULL CHECK (source_type IN ('manual', 'preset', 'group', 'schedule')),
  source_id       TEXT,
  run_id          TEXT,
  correlation_id  TEXT,
  action_type     TEXT NOT NULL,
  instance        TEXT NOT NULL,
  request_id      TEXT NOT NULL UNIQUE,
  request_summary TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN
                    ('queued', 'sending', 'accepted', 'rejected', 'failed', 'superseded', 'interrupted')),
  verification    TEXT NOT NULL DEFAULT 'not_applicable',
  attempts        INTEGER NOT NULL DEFAULT 0,
  error_category  TEXT,
  error_message   TEXT,
  created_at      TEXT NOT NULL,
  accepted_at     TEXT,
  completed_at    TEXT
);
CREATE INDEX idx_command_history_device ON command_history(device_id, created_at DESC);
CREATE INDEX idx_command_history_status ON command_history(status);

CREATE TABLE activity_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at     TEXT NOT NULL,
  event_type     TEXT NOT NULL,
  outcome        TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'warning', 'info')),
  device_id      TEXT REFERENCES devices(id) ON DELETE SET NULL,
  correlation_id TEXT,
  message        TEXT NOT NULL,
  details_json   TEXT
);
CREATE INDEX idx_activity_created ON activity_events(created_at DESC);
CREATE INDEX idx_activity_type ON activity_events(event_type, created_at DESC);
CREATE INDEX idx_activity_device ON activity_events(device_id, created_at DESC);
CREATE INDEX idx_activity_outcome ON activity_events(outcome, created_at DESC);

-- User settings and internal system values. Never holds API keys.
CREATE TABLE application_settings (
  setting_key   TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
