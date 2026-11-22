-- Sharing designs between accounts. See docs/sharing-plan.md.

-- The public name on what a person shares. Email addresses are never shown.
ALTER TABLE users ADD COLUMN display_name TEXT;
CREATE UNIQUE INDEX idx_users_display_name ON users(display_name COLLATE NOCASE) WHERE display_name IS NOT NULL;
-- Set by the owner to stop one person sharing. Their sign-in is not affected.
ALTER TABLE users ADD COLUMN sharing_blocked INTEGER NOT NULL DEFAULT 0;

-- One shared item: a snapshot of a preset, group or schedule, as a bundle that holds no ids
-- from the sharer's account. It goes with the sharer's row when their account is deleted.
CREATE TABLE shared_items (
  id           TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('preset', 'group', 'schedule')),
  -- The original's id in the sharer's own account, so "update share" can take a new
  -- snapshot. Never sent to anyone else.
  source_id    TEXT NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  bundle_json  TEXT NOT NULL,
  hidden_at    TEXT,
  imports      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (user_id, kind, source_id)
);
CREATE INDEX idx_shared_items_updated ON shared_items(updated_at DESC);
