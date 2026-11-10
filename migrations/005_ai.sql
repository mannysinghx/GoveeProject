-- AI features: what each request cost, and the questions asked. See docs/ai-features-plan.md.

-- One row per request to an AI provider, so the monthly spending cap can be enforced.
-- No prompts or replies are stored here.
CREATE TABLE ai_usage (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at    TEXT NOT NULL,
  feature       TEXT NOT NULL,
  provider      TEXT NOT NULL,
  model         TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  -- An estimate at the provider's listed paid price, so free use never hides real cost.
  cost_usd      REAL NOT NULL DEFAULT 0,
  outcome       TEXT NOT NULL CHECK (outcome IN ('ok', 'error')),
  error         TEXT
);
CREATE INDEX idx_ai_usage_created ON ai_usage(created_at);

-- The owner's questions and the answers given. The data sent to the provider is not kept.
CREATE TABLE ai_questions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at      TEXT NOT NULL,
  question        TEXT NOT NULL,
  answer          TEXT NOT NULL,
  references_json TEXT NOT NULL DEFAULT '[]',
  provider        TEXT NOT NULL,
  model           TEXT NOT NULL,
  cost_usd        REAL NOT NULL DEFAULT 0
);
CREATE INDEX idx_ai_questions_created ON ai_questions(created_at DESC);
