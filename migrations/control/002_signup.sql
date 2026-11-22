-- Email sign-up, password reset by email, and the mail outbox. See docs/public-signup-plan.md, Phase 4.

-- Links sent by email. Only a SHA-256 hash of each token is stored. A token is used up only
-- when the person submits the form it leads to, never by opening the link, because mail
-- scanners open links to check them.
CREATE TABLE email_tokens (
  token_hash  TEXT PRIMARY KEY,
  purpose     TEXT NOT NULL CHECK (purpose IN ('signup', 'reset', 'email_change')),
  -- For sign-up, the address being registered. For a reset, the account's address. For a
  -- change, the new address.
  email       TEXT NOT NULL COLLATE NOCASE,
  -- Sign-up links have no user yet. The others always belong to one.
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  CHECK ((purpose = 'signup') = (user_id IS NULL))
);
CREATE INDEX idx_email_tokens_email ON email_tokens(purpose, email);
CREATE INDEX idx_email_tokens_expires ON email_tokens(expires_at);

-- Mail waits here until it is sent, so a restart loses nothing and no request waits on the
-- mail server. The message text can hold a link, so it is cleared once the mail is sent or
-- given up. Rows are kept for 30 days, which is also how the per-address limits are counted.
CREATE TABLE mail_outbox (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  to_address       TEXT NOT NULL COLLATE NOCASE,
  kind             TEXT NOT NULL,
  subject          TEXT NOT NULL,
  text_body        TEXT,
  html_body        TEXT,
  status           TEXT NOT NULL CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'expired')),
  attempts         INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  TEXT NOT NULL,
  expires_at       TEXT NOT NULL,
  last_error       TEXT,
  created_at       TEXT NOT NULL,
  sent_at          TEXT
);
CREATE INDEX idx_mail_outbox_due ON mail_outbox(status, next_attempt_at);
CREATE INDEX idx_mail_outbox_address ON mail_outbox(to_address, created_at);
CREATE INDEX idx_mail_outbox_sent ON mail_outbox(sent_at);

-- Counters for limits on public forms, such as sign-ups from one address an hour.
CREATE TABLE request_limits (
  limit_key       TEXT PRIMARY KEY,
  window_started  TEXT NOT NULL,
  count           INTEGER NOT NULL
);

-- Server-wide settings the owner changes in the app, such as whether sign-up is open.
CREATE TABLE platform_settings (
  key         TEXT PRIMARY KEY,
  value_json  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
