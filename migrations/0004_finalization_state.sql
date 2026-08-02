-- Tie the final Discord manifest to the exact published plan and assignment
-- state it represents. Any later publication or roster mutation makes the
-- stored finalization stale and therefore eligible for regeneration.

ALTER TABLE weekly_events
  ADD COLUMN table_state_version INTEGER NOT NULL DEFAULT 0;

ALTER TABLE weekly_events ADD COLUMN finalized_plan_id TEXT;
ALTER TABLE weekly_events ADD COLUMN finalized_table_state_version INTEGER;
ALTER TABLE weekly_events ADD COLUMN tables_finalized_at INTEGER;

CREATE INDEX weekly_events_finalization_state_idx
  ON weekly_events(status, table_selection_closes_at, finalized_plan_id,
    finalized_table_state_version, table_state_version);
