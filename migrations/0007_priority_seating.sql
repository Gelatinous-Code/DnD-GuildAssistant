-- Deterministic, auditable table-seat requests backed by DM priority tokens.
-- Timestamps are authoritative Worker epoch milliseconds. A request keeps its
-- first table timestamp while it targets the same table; a priority timestamp
-- is present only while the linked token protects that request.

ALTER TABLE assignments ADD COLUMN table_requested_at INTEGER;
ALTER TABLE assignments ADD COLUMN priority_requested_at INTEGER;
ALTER TABLE assignments ADD COLUMN priority_credit_id TEXT
  REFERENCES dm_priority_credits(credit_id) ON DELETE RESTRICT;
ALTER TABLE assignments ADD COLUMN seat_request_version INTEGER NOT NULL DEFAULT 0
  CHECK (seat_request_version >= 0);

-- Existing published choices predate the explicit request timestamp. Their
-- persisted assignment time is the closest authoritative value and preserves
-- their relative ordinary waitlist order during the migration.
UPDATE assignments
SET table_requested_at = COALESCE(assigned_at, updated_at),
    seat_request_version = 1
WHERE status IN ('assigned', 'waitlisted');

CREATE INDEX assignments_priority_seating_rank_idx
  ON assignments(
    plan_id,
    desired_table_id,
    priority_requested_at,
    table_requested_at,
    user_id
  );
CREATE UNIQUE INDEX assignments_plan_priority_credit_uq
  ON assignments(plan_id, priority_credit_id)
  WHERE priority_credit_id IS NOT NULL;

-- One durable row owns each interaction/recovery attempt. The first accepted
-- payload captures the request timestamp and before-state; an identical retry
-- reads the persisted result while a different payload is an idempotency
-- conflict. Bulk settlement/cancellation operations leave member fields NULL.
CREATE TABLE priority_seating_operations (
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  operation_key TEXT NOT NULL,
  operation_kind TEXT NOT NULL CHECK (operation_kind IN (
    'select_standard', 'select_priority', 'release_priority', 'leave',
    'withdraw', 'settle', 'cancel', 'carry_forward', 'expire'
  )),
  event_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  target_table_id TEXT,
  assignment_id TEXT,
  user_id TEXT,
  actor_user_id TEXT,
  reason TEXT,
  selected_credit_id TEXT,
  previous_table_id TEXT,
  previous_desired_table_id TEXT,
  previous_status TEXT CHECK (previous_status IS NULL OR previous_status IN (
    'unassigned', 'assigned', 'waitlisted', 'withdrawn'
  )),
  previous_waitlist_position INTEGER,
  previous_table_requested_at INTEGER,
  previous_priority_requested_at INTEGER,
  previous_priority_credit_id TEXT,
  previous_seat_request_version INTEGER,
  occurred_at INTEGER NOT NULL,
  completed_at INTEGER,
  PRIMARY KEY (guild_id, operation_key),
  FOREIGN KEY (event_id, guild_id)
    REFERENCES weekly_events(event_id, guild_id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id, event_id)
    REFERENCES plans(plan_id, event_id) ON DELETE CASCADE,
  FOREIGN KEY (target_table_id, plan_id)
    REFERENCES plan_tables(table_id, plan_id) ON DELETE RESTRICT,
  FOREIGN KEY (assignment_id)
    REFERENCES assignments(assignment_id) ON DELETE SET NULL,
  FOREIGN KEY (selected_credit_id, guild_id)
    REFERENCES dm_priority_credits(credit_id, guild_id) ON DELETE RESTRICT,
  CHECK ((completed_at IS NULL) OR completed_at >= occurred_at)
);

CREATE INDEX priority_seating_operations_event_idx
  ON priority_seating_operations(guild_id, event_id, occurred_at DESC);

-- Before-images let a transaction derive displaced/promoted members from
-- persisted results rather than a racy pre-transaction candidate read.
CREATE TABLE priority_seating_operation_members (
  guild_id TEXT NOT NULL,
  operation_key TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  table_id TEXT,
  desired_table_id TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'unassigned', 'assigned', 'waitlisted', 'withdrawn'
  )),
  waitlist_position INTEGER,
  table_requested_at INTEGER,
  priority_requested_at INTEGER,
  priority_credit_id TEXT,
  seat_request_version INTEGER NOT NULL,
  PRIMARY KEY (guild_id, operation_key, assignment_id),
  FOREIGN KEY (guild_id, operation_key)
    REFERENCES priority_seating_operations(guild_id, operation_key)
    ON DELETE CASCADE
);

-- Immutable, member-scoped decision history. Notification delivery can use
-- these rows as a source without coupling Discord delivery to the seat write.
CREATE TABLE priority_seating_events (
  seating_event_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  operation_key TEXT NOT NULL,
  event_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  table_id TEXT,
  assignment_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  priority_credit_id TEXT,
  action TEXT NOT NULL CHECK (action IN (
    'requested', 'priority_requested', 'displaced', 'promoted', 'reranked',
    'priority_released', 'priority_redeemed', 'left', 'withdrawn',
    'cancelled', 'carried_forward', 'expired'
  )),
  reason_code TEXT NOT NULL,
  from_status TEXT CHECK (from_status IS NULL OR from_status IN (
    'unassigned', 'assigned', 'waitlisted', 'withdrawn'
  )),
  to_status TEXT CHECK (to_status IS NULL OR to_status IN (
    'unassigned', 'assigned', 'waitlisted', 'withdrawn'
  )),
  from_waitlist_position INTEGER,
  to_waitlist_position INTEGER,
  actor_user_id TEXT,
  occurred_at INTEGER NOT NULL,
  UNIQUE (guild_id, operation_key, assignment_id, action),
  FOREIGN KEY (guild_id, operation_key)
    REFERENCES priority_seating_operations(guild_id, operation_key)
    ON DELETE CASCADE,
  FOREIGN KEY (event_id, guild_id)
    REFERENCES weekly_events(event_id, guild_id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id, event_id)
    REFERENCES plans(plan_id, event_id) ON DELETE CASCADE,
  FOREIGN KEY (priority_credit_id, guild_id)
    REFERENCES dm_priority_credits(credit_id, guild_id) ON DELETE RESTRICT
);

CREATE INDEX priority_seating_events_member_idx
  ON priority_seating_events(guild_id, user_id, occurred_at DESC);
CREATE INDEX priority_seating_events_event_idx
  ON priority_seating_events(guild_id, event_id, occurred_at DESC);

-- A short-lived, private preview binds the confirmation click to the exact
-- assignment, table state, and token the member reviewed. The seating write
-- rechecks these values atomically before it may displace another member.
CREATE TABLE priority_confirmation_previews (
  preview_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  table_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  assignment_version INTEGER NOT NULL CHECK (assignment_version >= 0),
  table_state_version INTEGER NOT NULL CHECK (table_state_version >= 0),
  credit_id TEXT NOT NULL,
  table_was_full INTEGER NOT NULL CHECK (table_was_full IN (0, 1)),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  used_at INTEGER,
  UNIQUE (preview_id, guild_id),
  FOREIGN KEY (event_id, guild_id)
    REFERENCES weekly_events(event_id, guild_id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id, event_id)
    REFERENCES plans(plan_id, event_id) ON DELETE CASCADE,
  FOREIGN KEY (table_id, plan_id)
    REFERENCES plan_tables(table_id, plan_id) ON DELETE CASCADE,
  FOREIGN KEY (assignment_id)
    REFERENCES assignments(assignment_id) ON DELETE CASCADE,
  FOREIGN KEY (credit_id, guild_id)
    REFERENCES dm_priority_credits(credit_id, guild_id) ON DELETE RESTRICT
);

CREATE INDEX priority_confirmation_previews_member_idx
  ON priority_confirmation_previews(
    guild_id, user_id, expires_at DESC, created_at DESC
  );
CREATE INDEX priority_confirmation_previews_expiry_idx
  ON priority_confirmation_previews(expires_at, used_at);
