-- DnD Guild Assistant persistence model (M1-M3).
-- Timestamps are Unix epoch milliseconds so scheduling comparisons remain numeric.

CREATE TABLE guild_config (
  guild_id TEXT PRIMARY KEY,
  event_channel_id TEXT,
  table_channel_id TEXT,
  reminder_channel_id TEXT,
  admin_role_id TEXT,
  gm_role_id TEXT,
  reminder_role_id TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  weekly_day INTEGER NOT NULL DEFAULT 7 CHECK (weekly_day BETWEEN 1 AND 7),
  weekly_time TEXT NOT NULL DEFAULT '18:00',
  event_duration_minutes INTEGER NOT NULL DEFAULT 240 CHECK (event_duration_minutes > 0),
  signup_open_lead_days INTEGER NOT NULL DEFAULT 7 CHECK (signup_open_lead_days >= 0),
  signup_lock_lead_hours INTEGER NOT NULL DEFAULT 24 CHECK (signup_lock_lead_hours >= 0),
  table_min_size INTEGER NOT NULL DEFAULT 4 CHECK (table_min_size > 0),
  table_preferred_size INTEGER NOT NULL DEFAULT 6 CHECK (table_preferred_size > 0),
  table_max_size INTEGER NOT NULL DEFAULT 6 CHECK (table_max_size > 0),
  scheduling_enabled INTEGER NOT NULL DEFAULT 0 CHECK (scheduling_enabled IN (0, 1)),
  role_sync_enabled INTEGER NOT NULL DEFAULT 0 CHECK (role_sync_enabled IN (0, 1)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  CHECK (table_min_size <= table_preferred_size),
  CHECK (table_preferred_size <= table_max_size)
);

CREATE TABLE weekly_events (
  event_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER,
  signup_opens_at INTEGER NOT NULL,
  signup_locks_at INTEGER NOT NULL,
  reminder_at INTEGER,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'open', 'locked', 'planned', 'published', 'archived', 'cancelled')),
  source TEXT NOT NULL DEFAULT 'native'
    CHECK (source IN ('native', 'raid_helper', 'import', 'admin')),
  source_external_id TEXT,
  signup_channel_id TEXT,
  signup_message_id TEXT,
  table_channel_id TEXT,
  table_message_id TEXT,
  created_by_user_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  published_at INTEGER,
  archived_at INTEGER,
  CHECK (signup_opens_at <= signup_locks_at),
  CHECK (signup_locks_at <= starts_at),
  CHECK (ends_at IS NULL OR starts_at < ends_at),
  UNIQUE (guild_id, starts_at)
);

CREATE UNIQUE INDEX weekly_events_source_external_id_uq
  ON weekly_events(guild_id, source, source_external_id)
  WHERE source_external_id IS NOT NULL;
CREATE INDEX weekly_events_guild_status_start_idx
  ON weekly_events(guild_id, status, starts_at);
CREATE INDEX weekly_events_scheduler_idx
  ON weekly_events(status, signup_opens_at, signup_locks_at, starts_at);

CREATE TABLE signups (
  event_id TEXT NOT NULL REFERENCES weekly_events(event_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  signup_kind TEXT NOT NULL CHECK (signup_kind IN ('gm', 'player')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn')),
  source TEXT NOT NULL DEFAULT 'native'
    CHECK (source IN ('native', 'raid_helper', 'import', 'admin')),
  source_external_id TEXT,
  signed_up_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  withdrawn_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (event_id, user_id),
  CHECK (
    (status = 'active' AND withdrawn_at IS NULL)
    OR (status = 'withdrawn' AND withdrawn_at IS NOT NULL)
  )
);

CREATE INDEX signups_event_kind_status_idx
  ON signups(event_id, signup_kind, status, signed_up_at);
CREATE INDEX signups_user_idx ON signups(user_id, event_id);

CREATE TABLE plans (
  plan_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES weekly_events(event_id) ON DELETE CASCADE,
  generation INTEGER NOT NULL CHECK (generation > 0),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'superseded')),
  algorithm_version TEXT NOT NULL,
  min_table_size INTEGER NOT NULL CHECK (min_table_size > 0),
  preferred_table_size INTEGER NOT NULL CHECK (preferred_table_size > 0),
  max_table_size INTEGER NOT NULL CHECK (max_table_size > 0),
  player_count INTEGER NOT NULL CHECK (player_count >= 0),
  gm_signup_count INTEGER NOT NULL CHECK (gm_signup_count >= 0),
  selected_gm_count INTEGER NOT NULL CHECK (selected_gm_count >= 0),
  waitlist_count INTEGER NOT NULL DEFAULT 0 CHECK (waitlist_count >= 0),
  created_by_user_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  published_at INTEGER,
  CHECK (min_table_size <= preferred_table_size),
  CHECK (preferred_table_size <= max_table_size),
  UNIQUE (event_id, generation)
);

CREATE UNIQUE INDEX plans_one_draft_per_event_uq
  ON plans(event_id) WHERE status = 'draft';
CREATE UNIQUE INDEX plans_one_published_per_event_uq
  ON plans(event_id) WHERE status = 'published';
CREATE INDEX plans_event_status_idx ON plans(event_id, status, generation DESC);

CREATE TABLE plan_tables (
  table_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(plan_id) ON DELETE CASCADE,
  table_number INTEGER NOT NULL CHECK (table_number > 0),
  title TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  gm_user_id TEXT NOT NULL,
  gm_display_name TEXT NOT NULL,
  channel_id TEXT,
  message_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE (plan_id, table_number),
  UNIQUE (plan_id, gm_user_id)
);

CREATE INDEX plan_tables_plan_idx ON plan_tables(plan_id, table_number);

CREATE TABLE assignments (
  assignment_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(plan_id) ON DELETE CASCADE,
  table_id TEXT REFERENCES plan_tables(table_id) ON DELETE SET NULL,
  desired_table_id TEXT REFERENCES plan_tables(table_id) ON DELETE SET NULL,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unassigned'
    CHECK (status IN ('unassigned', 'assigned', 'waitlisted', 'withdrawn')),
  waitlist_position INTEGER CHECK (waitlist_position > 0),
  assigned_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE (plan_id, user_id),
  CHECK (
    (status = 'assigned' AND table_id IS NOT NULL AND desired_table_id = table_id AND waitlist_position IS NULL)
    OR (status = 'waitlisted' AND table_id IS NULL AND desired_table_id IS NOT NULL AND waitlist_position IS NOT NULL)
    OR (status = 'unassigned' AND table_id IS NULL AND desired_table_id IS NULL AND waitlist_position IS NULL)
    OR (status = 'withdrawn' AND table_id IS NULL AND waitlist_position IS NULL)
  )
);

CREATE INDEX assignments_plan_status_idx
  ON assignments(plan_id, status, waitlist_position, display_name);
CREATE INDEX assignments_table_idx ON assignments(table_id, status);
CREATE UNIQUE INDEX assignments_waitlist_position_uq
  ON assignments(plan_id, desired_table_id, waitlist_position) WHERE status = 'waitlisted';

-- One row per GM selected for a published weekly event. Counting rows yields
-- historical selection frequency without counting regenerated drafts.
CREATE TABLE gm_selections (
  event_id TEXT NOT NULL REFERENCES weekly_events(event_id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(plan_id) ON DELETE CASCADE,
  table_id TEXT NOT NULL REFERENCES plan_tables(table_id) ON DELETE CASCADE,
  gm_user_id TEXT NOT NULL,
  selected_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (event_id, gm_user_id),
  UNIQUE (plan_id, gm_user_id)
);

CREATE INDEX gm_selections_priority_idx
  ON gm_selections(guild_id, gm_user_id, selected_at);

-- Only roles granted by this application are leased here. Reconciliation can
-- safely remove an active lease without touching roles an admin added manually.
CREATE TABLE role_leases (
  lease_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  event_id TEXT REFERENCES weekly_events(event_id) ON DELETE SET NULL,
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  granted_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  last_verified_at INTEGER,
  released_at INTEGER,
  release_reason TEXT
);

CREATE UNIQUE INDEX role_leases_one_active_uq
  ON role_leases(guild_id, user_id, role_id) WHERE released_at IS NULL;
CREATE INDEX role_leases_active_event_idx
  ON role_leases(guild_id, event_id, role_id, user_id) WHERE released_at IS NULL;

CREATE TABLE reminder_rules (
  rule_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger_kind TEXT NOT NULL
    CHECK (trigger_kind IN ('signup_open', 'signup_lock', 'event_start')),
  offset_minutes INTEGER NOT NULL DEFAULT 0,
  audience_kind TEXT NOT NULL
    CHECK (audience_kind IN (
      'configured_role', 'active_gms', 'active_players',
      'unassigned_players', 'admins', 'channel'
    )),
  role_id TEXT,
  channel_id TEXT,
  message_template TEXT NOT NULL,
  mention_role INTEGER NOT NULL DEFAULT 0 CHECK (mention_role IN (0, 1)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE (guild_id, name),
  CHECK (audience_kind <> 'configured_role' OR role_id IS NOT NULL)
);

CREATE INDEX reminder_rules_guild_enabled_idx
  ON reminder_rules(guild_id, enabled, trigger_kind);

CREATE TABLE reminder_deliveries (
  delivery_id TEXT PRIMARY KEY,
  rule_id TEXT REFERENCES reminder_rules(rule_id) ON DELETE SET NULL,
  event_id TEXT NOT NULL REFERENCES weekly_events(event_id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  recipient_kind TEXT NOT NULL CHECK (recipient_kind IN ('channel', 'role', 'user')),
  recipient_id TEXT,
  content TEXT NOT NULL,
  scheduled_for INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  idempotency_key TEXT NOT NULL UNIQUE,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at INTEGER,
  last_error TEXT,
  sent_message_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  sent_at INTEGER
);

CREATE INDEX reminder_deliveries_due_idx
  ON reminder_deliveries(status, scheduled_for, next_attempt_at);
CREATE INDEX reminder_deliveries_event_idx
  ON reminder_deliveries(event_id, status, scheduled_for);

CREATE TABLE operations (
  operation_key TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  event_id TEXT REFERENCES weekly_events(event_id) ON DELETE CASCADE,
  operation_kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'started'
    CHECK (status IN ('started', 'succeeded', 'failed')),
  request_json TEXT,
  result_json TEXT,
  last_error TEXT,
  started_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  completed_at INTEGER
);

CREATE INDEX operations_event_kind_idx
  ON operations(event_id, operation_kind, status, started_at);

CREATE TABLE audit_log (
  audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  event_id TEXT REFERENCES weekly_events(event_id) ON DELETE SET NULL,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX audit_log_guild_created_idx
  ON audit_log(guild_id, created_at DESC);
CREATE INDEX audit_log_event_created_idx
  ON audit_log(event_id, created_at DESC);
