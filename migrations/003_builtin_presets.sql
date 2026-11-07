-- Festival presets that come with the app, and what has been set up once.

ALTER TABLE presets ADD COLUMN builtin_key TEXT;
CREATE UNIQUE INDEX idx_presets_builtin ON presets(builtin_key) WHERE builtin_key IS NOT NULL;

-- Things the app sets up only once, so something the owner removes does not come back.
CREATE TABLE builtin_installs (
  install_key  TEXT PRIMARY KEY,
  value        TEXT,
  installed_at TEXT NOT NULL
);
