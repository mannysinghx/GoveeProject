-- Holiday shows and notifications.

-- A show is several schedules that belong together, such as a start and an end.
ALTER TABLE schedules ADD COLUMN builtin_show TEXT;
-- A quiet schedule only notifies when something goes wrong.
ALTER TABLE schedules ADD COLUMN quiet INTEGER NOT NULL DEFAULT 0 CHECK (quiet IN (0, 1));
CREATE INDEX idx_schedules_show ON schedules(builtin_show) WHERE builtin_show IS NOT NULL;

-- Skip this show on this one date. The schedules stay enabled for later years.
CREATE TABLE show_skips (
  show_key   TEXT NOT NULL,
  local_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (show_key, local_date)
);

CREATE TABLE notifications (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL CHECK (kind IN ('run', 'run_problem', 'heads_up', 'problem', 'recovered', 'test')),
  severity     TEXT NOT NULL CHECK (severity IN ('info', 'good', 'warn', 'bad')),
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  link         TEXT NOT NULL,
  actions_json TEXT NOT NULL DEFAULT '[]',
  -- Stops the same reminder being sent twice, including after a restart.
  dedupe_key   TEXT,
  run_id       TEXT,
  show_key     TEXT,
  show_date    TEXT,
  answer       TEXT,
  answered_at  TEXT,
  read_at      TEXT,
  created_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_notifications_dedupe ON notifications(dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX idx_notifications_created ON notifications(created_at DESC);
CREATE INDEX idx_notifications_unread ON notifications(read_at) WHERE read_at IS NULL;

-- Lets a button on a phone notification answer without a session. Only a hash is stored.
CREATE TABLE notification_tokens (
  token_hash      TEXT PRIMARY KEY,
  notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  action          TEXT NOT NULL,
  expires_at      TEXT NOT NULL
);
CREATE INDEX idx_notification_tokens_notification ON notification_tokens(notification_id);

CREATE TABLE push_subscriptions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint        TEXT NOT NULL UNIQUE,
  p256dh          TEXT NOT NULL,
  auth            TEXT NOT NULL,
  label           TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  last_success_at TEXT,
  last_error_at   TEXT,
  last_error      TEXT
);

-- The server's own signing keys for Web Push, made once. Replacing them would disconnect every device.
CREATE TABLE push_keys (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  public_key  TEXT NOT NULL,
  private_key TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
