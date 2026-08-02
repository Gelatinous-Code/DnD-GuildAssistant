-- Hands-off weekly orchestration and a durable final Discord roster projection.
-- Existing guilds remain in review mode until an administrator explicitly
-- activates autopilot.

ALTER TABLE guild_config
  ADD COLUMN auto_publish_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (auto_publish_enabled IN (0, 1));

ALTER TABLE weekly_events ADD COLUMN table_selection_closes_at INTEGER;
ALTER TABLE weekly_events ADD COLUMN final_manifest_channel_id TEXT;
ALTER TABLE weekly_events ADD COLUMN final_manifest_message_id TEXT;

UPDATE weekly_events
SET table_selection_closes_at = starts_at
WHERE table_selection_closes_at IS NULL;

CREATE INDEX weekly_events_scheduler_deadlines_idx
  ON weekly_events(status, table_selection_closes_at, ends_at);
