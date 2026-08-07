-- Player-authored character journals with immutable revisions, moderated
-- visibility, and retryable publication into a configured Discord thread.

CREATE TABLE player_journal_config (
  guild_id TEXT PRIMARY KEY REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL,
  configured_by_user_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (length(trim(thread_id)) BETWEEN 1 AND 100)
);

CREATE TABLE player_journals (
  journal_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  completion_revision_id TEXT NOT NULL,
  summary_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  author_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  title TEXT,
  journal_text TEXT,
  first_submitted_at INTEGER,
  edit_expires_at INTEGER,
  last_submitted_at INTEGER,
  publication_status TEXT NOT NULL DEFAULT 'visible'
    CHECK (publication_status IN ('visible', 'hidden')),
  hidden_at INTEGER,
  hidden_by_user_id TEXT,
  hidden_reason TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending', 'sent', 'failed', 'not_configured', 'hidden')),
  delivery_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (delivery_attempt_count >= 0),
  next_delivery_attempt_at INTEGER,
  last_delivery_error_kind TEXT,
  discord_thread_id TEXT,
  discord_message_id TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (journal_id, guild_id),
  UNIQUE (guild_id, session_id, author_user_id, character_id),
  FOREIGN KEY (session_id, guild_id)
    REFERENCES session_completions(session_id, guild_id) ON DELETE CASCADE,
  FOREIGN KEY (completion_revision_id, session_id, guild_id)
    REFERENCES session_completion_revisions(
      completion_revision_id, session_id, guild_id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (summary_id, guild_id)
    REFERENCES session_summaries(summary_id, guild_id) ON DELETE RESTRICT,
  FOREIGN KEY (character_id, guild_id)
    REFERENCES characters(character_id, guild_id) ON DELETE RESTRICT,
  CHECK (
    (status = 'draft' AND title IS NULL AND journal_text IS NULL
      AND first_submitted_at IS NULL AND edit_expires_at IS NULL
      AND last_submitted_at IS NULL)
    OR
    (status = 'submitted' AND length(trim(title)) BETWEEN 1 AND 100
      AND length(trim(journal_text)) BETWEEN 1 AND 3000
      AND first_submitted_at IS NOT NULL AND edit_expires_at IS NOT NULL
      AND last_submitted_at IS NOT NULL AND edit_expires_at > first_submitted_at)
  ),
  CHECK (
    (publication_status = 'visible' AND hidden_at IS NULL
      AND hidden_by_user_id IS NULL AND hidden_reason IS NULL)
    OR
    (publication_status = 'hidden' AND hidden_at IS NOT NULL
      AND hidden_by_user_id IS NOT NULL
      AND length(trim(hidden_reason)) BETWEEN 3 AND 500)
  ),
  CHECK (
    (delivery_status = 'sent' AND discord_thread_id IS NOT NULL
      AND discord_message_id IS NOT NULL AND next_delivery_attempt_at IS NULL
      AND last_delivery_error_kind IS NULL)
    OR
    (delivery_status = 'failed' AND next_delivery_attempt_at IS NOT NULL
      AND last_delivery_error_kind IS NOT NULL)
    OR
    (delivery_status = 'not_configured' AND next_delivery_attempt_at IS NULL
      AND last_delivery_error_kind = 'journal_thread_not_configured')
    OR
    (delivery_status IN ('pending', 'hidden') AND next_delivery_attempt_at IS NULL
      AND last_delivery_error_kind IS NULL)
  )
);

CREATE INDEX player_journals_author_idx
  ON player_journals(guild_id, author_user_id, last_submitted_at DESC, journal_id);
CREATE INDEX player_journals_public_idx
  ON player_journals(guild_id, publication_status, status, last_submitted_at DESC);
CREATE INDEX player_journals_delivery_idx
  ON player_journals(delivery_status, next_delivery_attempt_at, updated_at, journal_id);

CREATE TABLE player_journal_revisions (
  journal_revision_id TEXT PRIMARY KEY,
  journal_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 100),
  journal_text TEXT NOT NULL CHECK (length(trim(journal_text)) BETWEEN 1 AND 3000),
  submitted_by_user_id TEXT NOT NULL,
  submitted_at INTEGER NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  created_at INTEGER NOT NULL,
  UNIQUE (journal_id, revision_number),
  FOREIGN KEY (journal_id, guild_id)
    REFERENCES player_journals(journal_id, guild_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX player_journal_revisions_one_current_uq
  ON player_journal_revisions(journal_id) WHERE is_current = 1;

CREATE TABLE player_journal_events (
  journal_event_id TEXT PRIMARY KEY,
  journal_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  event_kind TEXT NOT NULL CHECK (event_kind IN (
    'draft_created', 'submitted', 'edited', 'published', 'publication_failed',
    'publication_retried', 'hidden', 'unhidden', 'configuration_changed'
  )),
  actor_user_id TEXT NOT NULL,
  reason TEXT,
  journal_version INTEGER NOT NULL CHECK (journal_version > 0),
  idempotency_key TEXT NOT NULL,
  details_json TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (guild_id, idempotency_key),
  FOREIGN KEY (journal_id, guild_id)
    REFERENCES player_journals(journal_id, guild_id) ON DELETE CASCADE,
  CHECK (reason IS NULL OR length(trim(reason)) BETWEEN 3 AND 500)
);

CREATE INDEX player_journal_events_journal_idx
  ON player_journal_events(guild_id, journal_id, created_at DESC, journal_event_id);

CREATE TRIGGER player_journal_revisions_version_guard
BEFORE INSERT ON player_journal_revisions
FOR EACH ROW
WHEN NEW.revision_number <> (
  SELECT version - 1 FROM player_journals
  WHERE journal_id = NEW.journal_id AND guild_id = NEW.guild_id
)
BEGIN
  SELECT RAISE(ABORT, 'journal revision does not match journal version');
END;
