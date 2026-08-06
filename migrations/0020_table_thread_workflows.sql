-- Pre-session table threads, GM notification revisions, retries, and admin audit.

CREATE TABLE table_thread_workflows (
  workflow_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  table_number INTEGER NOT NULL CHECK (table_number > 0),
  plan_id TEXT NOT NULL,
  table_id TEXT NOT NULL,
  parent_channel_id TEXT NOT NULL,
  source_message_id TEXT,
  thread_id TEXT,
  thread_name TEXT NOT NULL,
  thread_generation INTEGER NOT NULL DEFAULT 1 CHECK (thread_generation > 0),
  gm_user_id TEXT NOT NULL,
  gm_display_name TEXT NOT NULL,
  gm_revision INTEGER NOT NULL DEFAULT 1 CHECK (gm_revision > 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'creating', 'current', 'failed', 'cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at INTEGER,
  last_error_kind TEXT,
  cancelled_at INTEGER,
  cancelled_by_user_id TEXT,
  cancellation_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (guild_id, event_id, table_number),
  UNIQUE (workflow_id, guild_id),
  FOREIGN KEY (event_id, guild_id)
    REFERENCES weekly_events(event_id, guild_id) ON DELETE CASCADE,
  CHECK (
    (status = 'cancelled'
      AND cancelled_at IS NOT NULL AND cancelled_by_user_id IS NOT NULL
      AND cancellation_reason IS NOT NULL)
    OR
    (status <> 'cancelled'
      AND cancelled_at IS NULL AND cancelled_by_user_id IS NULL
      AND cancellation_reason IS NULL)
  ),
  CHECK (
    (status = 'current' AND thread_id IS NOT NULL AND next_attempt_at IS NULL
      AND last_error_kind IS NULL)
    OR
    (status = 'failed' AND next_attempt_at IS NOT NULL AND last_error_kind IS NOT NULL)
    OR
    (status IN ('pending', 'creating', 'cancelled')
      AND next_attempt_at IS NULL AND last_error_kind IS NULL)
  )
);

CREATE INDEX table_thread_workflows_due_idx
  ON table_thread_workflows(status, next_attempt_at, updated_at);
CREATE INDEX table_thread_workflows_event_idx
  ON table_thread_workflows(guild_id, event_id, table_number);

CREATE TABLE table_thread_deliveries (
  delivery_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  gm_user_id TEXT NOT NULL,
  gm_revision INTEGER NOT NULL CHECK (gm_revision > 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'not_needed')),
  scheduled_for INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at INTEGER,
  last_error_kind TEXT,
  discord_channel_id TEXT,
  discord_message_id TEXT,
  idempotency_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (workflow_id, gm_revision),
  UNIQUE (guild_id, idempotency_key),
  FOREIGN KEY (workflow_id, guild_id)
    REFERENCES table_thread_workflows(workflow_id, guild_id) ON DELETE CASCADE,
  CHECK (
    (status = 'sent' AND discord_channel_id IS NOT NULL AND discord_message_id IS NOT NULL
      AND next_attempt_at IS NULL AND last_error_kind IS NULL)
    OR
    (status = 'failed' AND next_attempt_at IS NOT NULL AND last_error_kind IS NOT NULL)
    OR
    (status IN ('pending', 'not_needed') AND discord_channel_id IS NULL
      AND discord_message_id IS NULL AND next_attempt_at IS NULL AND last_error_kind IS NULL)
  )
);

CREATE INDEX table_thread_deliveries_due_idx
  ON table_thread_deliveries(status, scheduled_for, next_attempt_at);

CREATE TABLE table_thread_events (
  thread_event_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  event_kind TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  reason TEXT,
  details_json TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (workflow_id, event_kind, created_at, actor_user_id),
  FOREIGN KEY (workflow_id, guild_id)
    REFERENCES table_thread_workflows(workflow_id, guild_id) ON DELETE CASCADE
);

CREATE INDEX table_thread_events_workflow_idx
  ON table_thread_events(workflow_id, created_at DESC);
