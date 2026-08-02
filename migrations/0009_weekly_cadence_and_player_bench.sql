-- Separate New Dawn's GM interest, player interest, table publication, and
-- open-seating deadlines. Nullable guild fields preserve the behavior of an
-- existing installation until an administrator explicitly saves the cadence.

ALTER TABLE guild_config ADD COLUMN gm_signup_day INTEGER
  CHECK (gm_signup_day IS NULL OR gm_signup_day BETWEEN 1 AND 7);
ALTER TABLE guild_config ADD COLUMN gm_signup_time TEXT;
ALTER TABLE guild_config ADD COLUMN player_signup_day INTEGER
  CHECK (player_signup_day IS NULL OR player_signup_day BETWEEN 1 AND 7);
ALTER TABLE guild_config ADD COLUMN player_signup_time TEXT;
ALTER TABLE guild_config ADD COLUMN table_publish_day INTEGER
  CHECK (table_publish_day IS NULL OR table_publish_day BETWEEN 1 AND 7);
ALTER TABLE guild_config ADD COLUMN table_publish_time TEXT;
ALTER TABLE guild_config ADD COLUMN open_seating_day INTEGER
  CHECK (open_seating_day IS NULL OR open_seating_day BETWEEN 1 AND 7);
ALTER TABLE guild_config ADD COLUMN open_seating_time TEXT;

-- Event rows snapshot the resolved UTC instants so later configuration changes
-- never move an already-created week's deadlines.
ALTER TABLE weekly_events ADD COLUMN player_signup_opens_at INTEGER;
ALTER TABLE weekly_events ADD COLUMN open_seating_at INTEGER;

-- A published plan reserves the first N player signups, where N is the total
-- table capacity. Remaining active players form one deterministic global bench.
-- NULL roster fields identify legacy plans and retain their former open access.
ALTER TABLE assignments ADD COLUMN roster_status TEXT
  CHECK (roster_status IS NULL OR roster_status IN ('reserved', 'bench'));
ALTER TABLE assignments ADD COLUMN roster_rank INTEGER
  CHECK (roster_rank IS NULL OR roster_rank > 0);
ALTER TABLE assignments ADD COLUMN roster_promoted_at INTEGER;
ALTER TABLE assignments ADD COLUMN roster_notification_status TEXT
  CHECK (
    roster_notification_status IS NULL OR roster_notification_status IN (
      'pending', 'sending', 'retry', 'sent', 'blocked', 'failed'
    )
  );
ALTER TABLE assignments ADD COLUMN roster_notification_attempt_count INTEGER
  NOT NULL DEFAULT 0 CHECK (roster_notification_attempt_count >= 0);
ALTER TABLE assignments ADD COLUMN roster_notification_next_attempt_at INTEGER;
ALTER TABLE assignments ADD COLUMN roster_notification_claimed_at INTEGER;
ALTER TABLE assignments ADD COLUMN roster_notification_last_error TEXT;
ALTER TABLE assignments ADD COLUMN roster_notification_channel_id TEXT;
ALTER TABLE assignments ADD COLUMN roster_notification_message_id TEXT;
ALTER TABLE assignments ADD COLUMN roster_notification_sent_at INTEGER;
-- A unique marker makes a withdrawal and both of its promotion side effects
-- idempotent even if Discord delivers the same interaction concurrently.
ALTER TABLE assignments ADD COLUMN withdrawal_token TEXT;

CREATE INDEX weekly_events_cadence_idx
  ON weekly_events(status, player_signup_opens_at, signup_locks_at,
    open_seating_at, table_selection_closes_at);

CREATE UNIQUE INDEX assignments_plan_roster_rank_uq
  ON assignments(plan_id, roster_rank) WHERE roster_rank IS NOT NULL;

CREATE INDEX assignments_global_bench_idx
  ON assignments(plan_id, roster_status, roster_rank, user_id);

CREATE INDEX assignments_roster_notification_due_idx
  ON assignments(
    roster_notification_status,
    roster_notification_next_attempt_at,
    roster_promoted_at,
    assignment_id
  );
