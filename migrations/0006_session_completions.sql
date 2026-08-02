-- Organizer-confirmed table outcomes. Planned rosters remain immutable; actual
-- attendance and corrections are stored as append-only confirmed revisions.

CREATE UNIQUE INDEX dm_priority_grants_one_active_source_table_uq
  ON dm_priority_grants(guild_id, source_event_id, source_table_id)
  WHERE status = 'active';

CREATE TABLE session_completions (
  session_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  source_event_id TEXT NOT NULL,
  source_plan_id TEXT NOT NULL,
  source_table_id TEXT NOT NULL,
  draft_open INTEGER NOT NULL DEFAULT 1 CHECK (draft_open IN (0, 1)),
  draft_version INTEGER NOT NULL DEFAULT 1 CHECK (draft_version > 0),
  draft_base_revision_id TEXT,
  draft_operation_key TEXT NOT NULL,
  reward_sync_revision_id TEXT,
  reward_sync_status TEXT NOT NULL DEFAULT 'none'
    CHECK (reward_sync_status IN ('none', 'pending', 'synced', 'failed')),
  reward_sync_error_kind TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (guild_id, source_event_id, source_table_id),
  UNIQUE (session_id, guild_id),
  FOREIGN KEY (source_event_id, guild_id)
    REFERENCES weekly_events(event_id, guild_id) ON DELETE RESTRICT,
  FOREIGN KEY (source_plan_id, source_event_id)
    REFERENCES plans(plan_id, event_id) ON DELETE RESTRICT,
  FOREIGN KEY (source_table_id, source_plan_id)
    REFERENCES plan_tables(table_id, plan_id) ON DELETE RESTRICT,
  CHECK (
    (reward_sync_status = 'failed' AND reward_sync_error_kind IS NOT NULL)
    OR (reward_sync_status <> 'failed' AND reward_sync_error_kind IS NULL)
  )
);

CREATE INDEX session_completions_reward_due_idx
  ON session_completions(reward_sync_status, updated_at, session_id);

CREATE TABLE session_completion_revisions (
  completion_revision_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  result TEXT NOT NULL CHECK (result IN ('completed', 'cancelled')),
  actual_dm_user_id TEXT,
  earned_timezone TEXT NOT NULL,
  confirmed_by_user_id TEXT NOT NULL,
  confirmed_at INTEGER NOT NULL,
  reason TEXT,
  supersedes_revision_id TEXT,
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  created_at INTEGER NOT NULL,
  UNIQUE (session_id, revision_number),
  UNIQUE (completion_revision_id, guild_id),
  UNIQUE (completion_revision_id, session_id, guild_id),
  FOREIGN KEY (session_id, guild_id)
    REFERENCES session_completions(session_id, guild_id) ON DELETE CASCADE,
  FOREIGN KEY (supersedes_revision_id, session_id, guild_id)
    REFERENCES session_completion_revisions(
      completion_revision_id, session_id, guild_id
    ) ON DELETE RESTRICT,
  CHECK (length(earned_timezone) > 0),
  CHECK (
    (result = 'completed' AND actual_dm_user_id IS NOT NULL)
    OR (result = 'cancelled' AND actual_dm_user_id IS NULL)
  )
);

CREATE UNIQUE INDEX session_completion_revisions_one_current_uq
  ON session_completion_revisions(session_id)
  WHERE is_current = 1;
CREATE INDEX session_completion_revisions_guild_idx
  ON session_completion_revisions(
    guild_id, session_id, revision_number DESC
  );

CREATE TABLE session_completion_draft_participants (
  session_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  participant_role TEXT NOT NULL CHECK (participant_role IN ('dm', 'player')),
  attendance_outcome TEXT NOT NULL
    CHECK (attendance_outcome IN (
      'attended', 'no_show', 'substitute', 'walk_in'
    )),
  replaces_user_id TEXT,
  was_planned INTEGER NOT NULL CHECK (was_planned IN (0, 1)),
  recorded_by_user_id TEXT NOT NULL,
  reason TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, participant_role, user_id),
  FOREIGN KEY (session_id, guild_id)
    REFERENCES session_completions(session_id, guild_id) ON DELETE CASCADE,
  CHECK (
    (attendance_outcome = 'substitute' AND replaces_user_id IS NOT NULL
      AND replaces_user_id <> user_id)
    OR (attendance_outcome <> 'substitute' AND replaces_user_id IS NULL)
  )
);

CREATE UNIQUE INDEX session_completion_draft_replacement_uq
  ON session_completion_draft_participants(
    session_id, participant_role, replaces_user_id
  )
  WHERE replaces_user_id IS NOT NULL;

CREATE TABLE session_completion_participants (
  completion_revision_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  participant_role TEXT NOT NULL CHECK (participant_role IN ('dm', 'player')),
  attendance_outcome TEXT NOT NULL
    CHECK (attendance_outcome IN (
      'attended', 'no_show', 'substitute', 'walk_in', 'cancelled'
    )),
  replaces_user_id TEXT,
  was_planned INTEGER NOT NULL CHECK (was_planned IN (0, 1)),
  recorded_by_user_id TEXT NOT NULL,
  reason TEXT,
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (completion_revision_id, participant_role, user_id),
  FOREIGN KEY (completion_revision_id, session_id, guild_id)
    REFERENCES session_completion_revisions(
      completion_revision_id, session_id, guild_id
    ) ON DELETE CASCADE,
  CHECK (
    (attendance_outcome = 'substitute' AND replaces_user_id IS NOT NULL
      AND replaces_user_id <> user_id)
    OR (attendance_outcome <> 'substitute' AND replaces_user_id IS NULL)
  )
);

CREATE UNIQUE INDEX session_completion_participants_replacement_uq
  ON session_completion_participants(
    completion_revision_id, participant_role, replaces_user_id
  )
  WHERE replaces_user_id IS NOT NULL;
CREATE UNIQUE INDEX session_completion_participants_one_actual_dm_uq
  ON session_completion_participants(completion_revision_id)
  WHERE participant_role = 'dm'
    AND attendance_outcome IN ('attended', 'substitute', 'walk_in');

CREATE TABLE session_completion_events (
  session_event_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  completion_revision_id TEXT,
  idempotency_key TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN (
    'draft_created', 'correction_draft_created', 'attendance_recorded',
    'confirmed', 'corrected', 'reward_synced', 'reward_failed'
  )),
  actor_user_id TEXT,
  subject_user_id TEXT,
  details_json TEXT,
  occurred_at INTEGER NOT NULL,
  UNIQUE (guild_id, idempotency_key),
  FOREIGN KEY (session_id, guild_id)
    REFERENCES session_completions(session_id, guild_id) ON DELETE CASCADE,
  FOREIGN KEY (completion_revision_id, session_id, guild_id)
    REFERENCES session_completion_revisions(
      completion_revision_id, session_id, guild_id
    ) ON DELETE RESTRICT
);

CREATE INDEX session_completion_events_session_idx
  ON session_completion_events(
    guild_id, session_id, occurred_at DESC, session_event_id DESC
  );
