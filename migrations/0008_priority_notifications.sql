-- Durable private DM delivery for DM Priority Token lifecycle events.
-- Timestamps are Unix epoch milliseconds. Each guild configuration row is
-- versioned so every outbox item records the policy/template inputs used to
-- create it. Three days = 72 hours = 259,200,000 milliseconds.

CREATE TABLE priority_notification_config (
  guild_id TEXT PRIMARY KEY REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  config_revision INTEGER NOT NULL CHECK (config_revision > 0),
  template_revision TEXT NOT NULL CHECK (length(template_revision) BETWEEN 1 AND 100),
  pre_expiry_lead_ms INTEGER NOT NULL DEFAULT 259200000
    CHECK (pre_expiry_lead_ms BETWEEN 0 AND 2592000000),
  max_delivery_attempts INTEGER NOT NULL DEFAULT 5
    CHECK (max_delivery_attempts BETWEEN 1 AND 20),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

INSERT INTO priority_notification_config (
  guild_id,
  config_revision,
  template_revision,
  pre_expiry_lead_ms,
  max_delivery_attempts
) SELECT
  guild_id,
  1,
  'dm-priority-notifications-v1',
  259200000,
  5
FROM guild_config;

CREATE TABLE priority_notification_config_events (
  config_event_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL
    REFERENCES priority_notification_config(guild_id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  from_revision INTEGER NOT NULL CHECK (from_revision > 0),
  to_revision INTEGER NOT NULL CHECK (to_revision = from_revision + 1),
  from_pre_expiry_lead_ms INTEGER NOT NULL
    CHECK (from_pre_expiry_lead_ms BETWEEN 0 AND 2592000000),
  to_pre_expiry_lead_ms INTEGER NOT NULL
    CHECK (to_pre_expiry_lead_ms BETWEEN 0 AND 2592000000),
  actor_user_id TEXT NOT NULL CHECK (length(actor_user_id) > 0),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  occurred_at INTEGER NOT NULL,
  applied_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  CHECK (applied_at IS NULL OR applied_at >= occurred_at),
  UNIQUE (guild_id, idempotency_key)
);

CREATE UNIQUE INDEX priority_notification_config_events_revision_uq
  ON priority_notification_config_events(guild_id, to_revision);

CREATE INDEX priority_notification_config_events_history_idx
  ON priority_notification_config_events(
    guild_id, occurred_at DESC, config_event_id DESC
  );

CREATE TABLE priority_notification_outbox (
  notification_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  recipient_user_id TEXT NOT NULL,
  notification_kind TEXT NOT NULL CHECK (notification_kind IN (
    'grant_awarded',
    'credit_reserved',
    'credit_redeemed',
    'credit_refunded',
    'credit_expired',
    'grant_corrected',
    'credit_expiring',
    'seat_displaced',
    'seat_promoted'
  )),
  source_kind TEXT NOT NULL CHECK (source_kind IN (
    'grant', 'credit_event', 'credit', 'seating_event'
  )),
  source_id TEXT NOT NULL,
  grant_id TEXT,
  credit_id TEXT,
  event_id TEXT,
  assignment_id TEXT,
  template_revision TEXT NOT NULL CHECK (length(template_revision) BETWEEN 1 AND 100),
  config_revision INTEGER NOT NULL CHECK (config_revision > 0),
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 2000),
  scheduled_for INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 500),
  discord_nonce TEXT NOT NULL CHECK (length(discord_nonce) BETWEEN 1 AND 25),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',
    'sending',
    'retry',
    'sent',
    'blocked',
    'failed',
    'uncertain',
    'cancelled'
  )),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at INTEGER,
  claim_token TEXT,
  claimed_at INTEGER,
  last_error_kind TEXT,
  last_error_code INTEGER,
  last_error_at INTEGER,
  dm_channel_id TEXT,
  sent_message_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  sent_at INTEGER,
  terminal_at INTEGER,
  UNIQUE (guild_id, idempotency_key),
  UNIQUE (
    guild_id,
    source_kind,
    source_id,
    notification_kind,
    template_revision,
    config_revision,
    recipient_user_id
  ),
  CHECK (length(recipient_user_id) > 0),
  CHECK (length(source_id) > 0),
  CHECK (
    status <> 'sending'
    OR (claim_token IS NOT NULL AND claimed_at IS NOT NULL)
  ),
  CHECK (
    status <> 'sent'
    OR (
      dm_channel_id IS NOT NULL
      AND sent_message_id IS NOT NULL
      AND sent_at IS NOT NULL
      AND terminal_at IS NOT NULL
    )
  ),
  CHECK (
    status NOT IN ('sent', 'blocked', 'failed', 'uncertain', 'cancelled')
    OR terminal_at IS NOT NULL
  )
);

CREATE INDEX priority_notification_outbox_due_idx
  ON priority_notification_outbox (
    status, scheduled_for, next_attempt_at, notification_id
  );

CREATE INDEX priority_notification_outbox_stale_claim_idx
  ON priority_notification_outbox (status, claimed_at, notification_id);

CREATE INDEX priority_notification_outbox_member_idx
  ON priority_notification_outbox (
    guild_id, recipient_user_id, created_at DESC, notification_id DESC
  );

CREATE INDEX priority_notification_outbox_source_idx
  ON priority_notification_outbox (
    guild_id, source_kind, source_id, notification_kind
  );
