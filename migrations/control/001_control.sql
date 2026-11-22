-- The control database: who can sign in, and to which account. One per server, kept apart
-- from every account's own file. See docs/public-signup-plan.md. Timestamps are ISO-8601 UTC.

-- A user signs in with a username, an email, or either. User 1 is the owner, whose account
-- is the original database file.
CREATE TABLE users (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  username          TEXT UNIQUE COLLATE NOCASE,
  email             TEXT UNIQUE COLLATE NOCASE,
  email_verified_at TEXT,
  password_hash     TEXT NOT NULL,
  role              TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  -- The account's database file, relative to the control database's folder, or absolute.
  account_file      TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  CHECK (username IS NOT NULL OR email IS NOT NULL),
  CHECK (role != 'owner' OR id = 1)
);

-- Only a SHA-256 hash of each session token is stored.
CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- Sign-in throttling. Keys are "pair:<identifier hash>:<address>", "ip:<address>" and
-- "id:<identifier hash>". Typed names are hashed, so failed guesses are not kept as text.
CREATE TABLE login_attempts (
  throttle_key    TEXT PRIMARY KEY,
  failures        INTEGER NOT NULL,
  window_started  TEXT NOT NULL,
  locked_until    TEXT
);

-- Secrets a user connects, such as a Govee key, encrypted with AES-256-GCM under a master key
-- that is never stored in a database. The user id and kind are bound into the encryption, so a
-- row copied to another user does not decrypt. The fingerprint is a keyed hash, so one Govee
-- key cannot be connected to two accounts.
CREATE TABLE credentials (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  key_version  INTEGER NOT NULL,
  iv           TEXT NOT NULL,
  ciphertext   TEXT NOT NULL,
  auth_tag     TEXT NOT NULL,
  fingerprint  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'rejected', 'needs_reentry')),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (user_id, kind)
);
CREATE UNIQUE INDEX idx_credentials_fingerprint ON credentials(kind, fingerprint);

-- Sign-ins, password changes, resets, key changes and the cutover, across every account.
CREATE TABLE audit_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at   TEXT NOT NULL,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  event        TEXT NOT NULL,
  ip           TEXT,
  details_json TEXT
);
CREATE INDEX idx_audit_created ON audit_events(created_at DESC);
CREATE INDEX idx_audit_user ON audit_events(user_id, created_at DESC);
