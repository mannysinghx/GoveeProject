-- Marks on what was imported from the Shared space (docs/sharing-plan.md). The name it came
-- from is shown on the item; the share id tells "already imported". Older versions ignore
-- these columns.
ALTER TABLE presets ADD COLUMN imported_from TEXT;
ALTER TABLE presets ADD COLUMN imported_share TEXT;
ALTER TABLE groups ADD COLUMN imported_from TEXT;
ALTER TABLE groups ADD COLUMN imported_share TEXT;
ALTER TABLE schedules ADD COLUMN imported_from TEXT;
ALTER TABLE schedules ADD COLUMN imported_share TEXT;
