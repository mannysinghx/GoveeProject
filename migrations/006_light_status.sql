-- Light status that survives one wrong answer from Govee.
--
-- offline_streak: how many answers in a row said the light was offline. A light is only
-- shown and reported as offline once two in a row agree.
-- status_failures: how many status requests in a row failed, which sets how long the app
-- waits before asking again after Govee refuses one.
ALTER TABLE devices ADD COLUMN offline_streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE devices ADD COLUMN status_failures INTEGER NOT NULL DEFAULT 0;

-- A light already recorded as offline stays offline, instead of dropping back to "checking".
UPDATE devices SET offline_streak = 2 WHERE online = 0;
-- A refusal recorded under the old rule held status checks back for a day. Count it as one
-- failure, so checks resume straight away.
UPDATE devices SET status_failures = 1 WHERE last_status_error_json IS NOT NULL;
