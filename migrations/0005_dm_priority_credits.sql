-- Durable DM priority-token grants, individual token state, and immutable
-- lifecycle history. Timestamps are Unix epoch milliseconds. `expires_at` is
-- an exclusive boundary calculated in the guild time zone captured by the
-- grant.

-- These otherwise-redundant keys let composite foreign keys prove that reward
-- source and target records belong to the same event, plan, and guild.
CREATE UNIQUE INDEX weekly_events_event_guild_uq
  ON weekly_events(event_id, guild_id);
CREATE UNIQUE INDEX plans_plan_event_uq
  ON plans(plan_id, event_id);
CREATE UNIQUE INDEX plan_tables_table_plan_uq
  ON plan_tables(table_id, plan_id);

CREATE TABLE dm_priority_grants (
  grant_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  completion_revision_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  source_plan_id TEXT NOT NULL,
  source_table_id TEXT NOT NULL,
  dm_user_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  earned_timezone TEXT NOT NULL,
  earned_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  granted_by_user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'corrected')),
  corrected_at INTEGER,
  corrected_by_user_id TEXT,
  correction_reason TEXT,
  correction_key TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE (guild_id, completion_revision_id),
  UNIQUE (guild_id, idempotency_key),
  UNIQUE (guild_id, correction_key),
  UNIQUE (grant_id, guild_id, dm_user_id),
  FOREIGN KEY (source_event_id, guild_id)
    REFERENCES weekly_events(event_id, guild_id) ON DELETE RESTRICT,
  FOREIGN KEY (source_plan_id, source_event_id)
    REFERENCES plans(plan_id, event_id) ON DELETE RESTRICT,
  FOREIGN KEY (source_table_id, source_plan_id)
    REFERENCES plan_tables(table_id, plan_id) ON DELETE RESTRICT,
  CHECK (length(policy_version) > 0),
  CHECK (length(earned_timezone) > 0),
  CHECK (expires_at > earned_at),
  CHECK (
    (status = 'active'
      AND corrected_at IS NULL
      AND corrected_by_user_id IS NULL
      AND correction_reason IS NULL
      AND correction_key IS NULL)
    OR
    (status = 'corrected'
      AND corrected_at IS NOT NULL
      AND corrected_by_user_id IS NOT NULL
      AND length(correction_reason) > 0
      AND correction_key IS NOT NULL)
  )
);

CREATE INDEX dm_priority_grants_member_idx
  ON dm_priority_grants(guild_id, dm_user_id, earned_at DESC);

CREATE TABLE dm_priority_credits (
  credit_id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal IN (1, 2)),
  earned_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'reserved', 'redeemed', 'expired', 'corrected')),
  target_event_id TEXT,
  target_assignment_id TEXT REFERENCES assignments(assignment_id) ON DELETE RESTRICT,
  reserved_at INTEGER,
  redeemed_at INTEGER,
  last_operation_key TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE (grant_id, ordinal),
  UNIQUE (credit_id, guild_id),
  UNIQUE (guild_id, last_operation_key),
  FOREIGN KEY (grant_id, guild_id, user_id)
    REFERENCES dm_priority_grants(grant_id, guild_id, dm_user_id) ON DELETE CASCADE,
  FOREIGN KEY (target_event_id, guild_id)
    REFERENCES weekly_events(event_id, guild_id) ON DELETE RESTRICT,
  CHECK (expires_at > earned_at),
  CHECK (
    (status = 'available'
      AND target_event_id IS NULL
      AND target_assignment_id IS NULL
      AND reserved_at IS NULL
      AND redeemed_at IS NULL)
    OR
    (status = 'reserved'
      AND target_event_id IS NOT NULL
      AND reserved_at IS NOT NULL
      AND redeemed_at IS NULL)
    OR
    (status = 'redeemed'
      AND target_event_id IS NOT NULL
      AND target_assignment_id IS NOT NULL
      AND reserved_at IS NOT NULL
      AND redeemed_at IS NOT NULL)
    OR
    (status IN ('expired', 'corrected')
      AND target_event_id IS NULL
      AND target_assignment_id IS NULL
      AND reserved_at IS NULL
      AND redeemed_at IS NULL)
  )
);

CREATE UNIQUE INDEX dm_priority_credits_one_use_per_event_uq
  ON dm_priority_credits(guild_id, user_id, target_event_id)
  WHERE status IN ('reserved', 'redeemed');
CREATE INDEX dm_priority_credits_available_idx
  ON dm_priority_credits(
    guild_id, user_id, status, expires_at, earned_at, credit_id
  );
CREATE INDEX dm_priority_credits_due_idx
  ON dm_priority_credits(status, expires_at, credit_id);
CREATE INDEX dm_priority_credits_target_idx
  ON dm_priority_credits(guild_id, target_event_id, status, user_id);

CREATE TABLE dm_priority_credit_events (
  credit_event_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  credit_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  action TEXT NOT NULL
    CHECK (action IN ('granted', 'reserved', 'redeemed', 'refunded', 'expired', 'corrected')),
  from_status TEXT
    CHECK (from_status IS NULL OR from_status IN (
      'available', 'reserved', 'redeemed', 'expired', 'corrected'
    )),
  to_status TEXT NOT NULL
    CHECK (to_status IN ('available', 'reserved', 'redeemed', 'expired', 'corrected')),
  credit_version INTEGER NOT NULL CHECK (credit_version > 0),
  target_event_id TEXT,
  target_assignment_id TEXT REFERENCES assignments(assignment_id) ON DELETE SET NULL,
  actor_user_id TEXT,
  reason TEXT,
  details_json TEXT,
  occurred_at INTEGER NOT NULL,
  UNIQUE (guild_id, idempotency_key),
  UNIQUE (credit_id, credit_version),
  FOREIGN KEY (credit_id, guild_id)
    REFERENCES dm_priority_credits(credit_id, guild_id) ON DELETE CASCADE,
  FOREIGN KEY (target_event_id, guild_id)
    REFERENCES weekly_events(event_id, guild_id) ON DELETE RESTRICT,
  CHECK (
    (action = 'granted' AND from_status IS NULL AND to_status = 'available')
    OR
    (action = 'reserved' AND from_status = 'available' AND to_status = 'reserved')
    OR
    (action = 'redeemed' AND from_status = 'reserved' AND to_status = 'redeemed')
    OR
    (action = 'refunded'
      AND from_status IN ('reserved', 'redeemed')
      AND to_status IN ('available', 'expired'))
    OR
    (action = 'expired'
      AND from_status IN ('available', 'reserved')
      AND to_status = 'expired')
    OR
    (action = 'corrected'
      AND from_status IN ('available', 'reserved', 'redeemed')
      AND to_status = 'corrected')
  )
);

CREATE INDEX dm_priority_credit_events_credit_idx
  ON dm_priority_credit_events(
    guild_id, credit_id, occurred_at DESC, credit_event_id DESC
  );
