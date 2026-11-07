-- Connection monitoring: problems the app has seen, and what lights missed while offline.

CREATE TABLE connection_incidents (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL CHECK (kind IN
                 ('device_offline', 'device_missing', 'govee_unreachable', 'api_key_rejected', 'api_key_missing', 'rate_limited')),
  -- NULL for problems that affect everything, such as a rejected API key.
  device_id    TEXT REFERENCES devices(id) ON DELETE CASCADE,
  opened_at    TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  closed_at    TEXT
);
-- One open incident per problem, whatever a restart or an overlapping check does.
CREATE UNIQUE INDEX idx_incidents_one_open ON connection_incidents(kind, COALESCE(device_id, ''))
  WHERE closed_at IS NULL;
CREATE INDEX idx_incidents_device ON connection_incidents(device_id, opened_at DESC);
CREATE INDEX idx_incidents_opened ON connection_incidents(opened_at DESC);

-- The latest thing a light could not receive because it was offline. Only the newest is
-- kept per light: catching up reaches the intended state and never replays history.
CREATE TABLE missed_deliveries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id    TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  run_name     TEXT NOT NULL,
  actions_json TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN
                 ('waiting', 'delivering', 'delivered', 'failed', 'replaced', 'expired', 'dismissed')),
  detail       TEXT,
  created_at   TEXT NOT NULL,
  finished_at  TEXT
);
CREATE UNIQUE INDEX idx_missed_one_waiting ON missed_deliveries(device_id) WHERE status = 'waiting';
CREATE INDEX idx_missed_created ON missed_deliveries(created_at DESC);
