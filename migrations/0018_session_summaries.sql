-- Structured, publicly publishable session summaries with immutable revisions
-- and retryable DM prompt/reminder deliveries. Timestamps are epoch milliseconds.

CREATE TABLE session_summaries (
  summary_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  completion_revision_id TEXT NOT NULL,
  dm_user_id TEXT NOT NULL,
  session_ends_at INTEGER NOT NULL,
  due_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'submitted')),
  summary_text TEXT,
  area TEXT,
  important_events TEXT,
  bonus_rewards TEXT,
  other_notes TEXT,
  first_submitted_at INTEGER,
  edit_expires_at INTEGER,
  last_submitted_at INTEGER,
  publication_status TEXT NOT NULL DEFAULT 'visible'
    CHECK (publication_status IN ('visible', 'hidden')),
  hidden_at INTEGER,
  hidden_by_user_id TEXT,
  hidden_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (guild_id, completion_revision_id),
  UNIQUE (summary_id, guild_id),
  FOREIGN KEY (session_id, guild_id)
    REFERENCES session_completions(session_id, guild_id) ON DELETE CASCADE,
  FOREIGN KEY (completion_revision_id, session_id, guild_id)
    REFERENCES session_completion_revisions(
      completion_revision_id, session_id, guild_id
    ) ON DELETE RESTRICT,
  CHECK (due_at > session_ends_at),
  CHECK (
    (status = 'pending'
      AND first_submitted_at IS NULL
      AND edit_expires_at IS NULL
      AND last_submitted_at IS NULL)
    OR
    (status = 'submitted'
      AND summary_text IS NOT NULL AND length(trim(summary_text)) > 0
      AND area IS NOT NULL AND length(trim(area)) > 0
      AND first_submitted_at IS NOT NULL
      AND edit_expires_at IS NOT NULL
      AND last_submitted_at IS NOT NULL
      AND edit_expires_at > first_submitted_at)
  ),
  CHECK (
    (publication_status = 'visible'
      AND hidden_at IS NULL AND hidden_by_user_id IS NULL AND hidden_reason IS NULL)
    OR
    (publication_status = 'hidden'
      AND hidden_at IS NOT NULL AND hidden_by_user_id IS NOT NULL
      AND hidden_reason IS NOT NULL AND length(trim(hidden_reason)) >= 3)
  )
);

CREATE INDEX session_summaries_public_idx
  ON session_summaries(guild_id, publication_status, status, session_ends_at DESC);
CREATE INDEX session_summaries_dm_idx
  ON session_summaries(guild_id, dm_user_id, session_ends_at DESC);

CREATE TABLE session_summary_revisions (
  summary_revision_id TEXT PRIMARY KEY,
  summary_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  summary_text TEXT NOT NULL,
  area TEXT NOT NULL,
  important_events TEXT,
  bonus_rewards TEXT,
  other_notes TEXT,
  submitted_by_user_id TEXT NOT NULL,
  submitted_at INTEGER NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  created_at INTEGER NOT NULL,
  UNIQUE (summary_id, revision_number),
  UNIQUE (summary_revision_id, guild_id),
  FOREIGN KEY (summary_id, guild_id)
    REFERENCES session_summaries(summary_id, guild_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX session_summary_revisions_one_current_uq
  ON session_summary_revisions(summary_id) WHERE is_current = 1;

CREATE TABLE session_summary_deliveries (
  delivery_id TEXT PRIMARY KEY,
  summary_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  delivery_kind TEXT NOT NULL CHECK (delivery_kind IN ('prompt', 'reminder')),
  recipient_user_id TEXT NOT NULL,
  scheduled_for INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'not_needed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at INTEGER,
  discord_channel_id TEXT,
  discord_message_id TEXT,
  last_error_kind TEXT,
  idempotency_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (summary_id, delivery_kind),
  UNIQUE (guild_id, idempotency_key),
  FOREIGN KEY (summary_id, guild_id)
    REFERENCES session_summaries(summary_id, guild_id) ON DELETE CASCADE,
  CHECK (
    (status = 'sent'
      AND discord_channel_id IS NOT NULL AND discord_message_id IS NOT NULL
      AND next_attempt_at IS NULL AND last_error_kind IS NULL)
    OR
    (status = 'failed'
      AND next_attempt_at IS NOT NULL AND last_error_kind IS NOT NULL)
    OR
    (status IN ('pending', 'not_needed')
      AND next_attempt_at IS NULL AND discord_channel_id IS NULL
      AND discord_message_id IS NULL AND last_error_kind IS NULL)
  )
);

CREATE INDEX session_summary_deliveries_due_idx
  ON session_summary_deliveries(status, scheduled_for, next_attempt_at, delivery_id);

CREATE TRIGGER session_summary_revisions_version_guard
BEFORE INSERT ON session_summary_revisions
FOR EACH ROW
WHEN NEW.revision_number <> (
  SELECT version - 1 FROM session_summaries
  WHERE summary_id = NEW.summary_id AND guild_id = NEW.guild_id
)
BEGIN
  SELECT RAISE(ABORT, 'summary revision does not match summary version');
END;
