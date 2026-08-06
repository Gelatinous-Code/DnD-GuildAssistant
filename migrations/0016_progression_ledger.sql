-- Append-only per-character XP and gold ledger plus per-table character
-- selections. Opening balances remain immutable on the character record.

CREATE TABLE progression_ledger_entries (
  entry_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  character_id TEXT NOT NULL,
  entry_kind TEXT NOT NULL
    CHECK (entry_kind IN ('session_award', 'admin_adjustment', 'reversal')),
  xp_delta INTEGER NOT NULL,
  gold_delta INTEGER NOT NULL,
  source_session_id TEXT,
  source_completion_revision_id TEXT,
  source_user_id TEXT,
  participant_role TEXT CHECK (participant_role IS NULL OR participant_role IN ('dm', 'player')),
  policy_version TEXT,
  pre_award_xp INTEGER CHECK (pre_award_xp IS NULL OR pre_award_xp >= 0),
  pre_award_gold INTEGER,
  pre_award_level INTEGER CHECK (pre_award_level IS NULL OR pre_award_level BETWEEN 3 AND 10),
  reverses_entry_id TEXT,
  actor_user_id TEXT NOT NULL,
  reason TEXT,
  idempotency_key TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE (entry_id, guild_id),
  UNIQUE (guild_id, idempotency_key),
  FOREIGN KEY (character_id, guild_id)
    REFERENCES characters(character_id, guild_id) ON DELETE RESTRICT,
  FOREIGN KEY (source_session_id, guild_id)
    REFERENCES session_completions(session_id, guild_id) ON DELETE RESTRICT,
  FOREIGN KEY (source_completion_revision_id, source_session_id, guild_id)
    REFERENCES session_completion_revisions(
      completion_revision_id, session_id, guild_id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (reverses_entry_id, guild_id)
    REFERENCES progression_ledger_entries(entry_id, guild_id) ON DELETE RESTRICT,
  CHECK (xp_delta <> 0 OR gold_delta <> 0),
  CHECK (reason IS NULL OR length(trim(reason)) BETWEEN 3 AND 500),
  CHECK (
    (entry_kind = 'session_award'
      AND source_session_id IS NOT NULL
      AND source_completion_revision_id IS NOT NULL
      AND source_user_id IS NOT NULL
      AND participant_role IS NOT NULL
      AND policy_version IS NOT NULL
      AND pre_award_xp IS NOT NULL
      AND pre_award_gold IS NOT NULL
      AND pre_award_level IS NOT NULL
      AND reverses_entry_id IS NULL)
    OR
    (entry_kind = 'admin_adjustment'
      AND source_session_id IS NULL
      AND source_completion_revision_id IS NULL
      AND source_user_id IS NULL
      AND participant_role IS NULL
      AND policy_version IS NULL
      AND pre_award_xp IS NULL
      AND pre_award_gold IS NULL
      AND pre_award_level IS NULL
      AND reverses_entry_id IS NULL
      AND reason IS NOT NULL)
    OR
    (entry_kind = 'reversal'
      AND source_session_id IS NULL
      AND source_completion_revision_id IS NULL
      AND source_user_id IS NULL
      AND participant_role IS NULL
      AND policy_version IS NULL
      AND pre_award_xp IS NULL
      AND pre_award_gold IS NULL
      AND pre_award_level IS NULL
      AND reverses_entry_id IS NOT NULL
      AND reason IS NOT NULL)
  )
);

CREATE UNIQUE INDEX progression_one_session_award_uq
  ON progression_ledger_entries(
    guild_id, source_completion_revision_id, source_user_id, participant_role
  ) WHERE entry_kind = 'session_award';
CREATE UNIQUE INDEX progression_one_reversal_uq
  ON progression_ledger_entries(guild_id, reverses_entry_id)
  WHERE entry_kind = 'reversal';
CREATE INDEX progression_character_history_idx
  ON progression_ledger_entries(guild_id, character_id, occurred_at DESC, entry_id DESC);
CREATE INDEX progression_session_idx
  ON progression_ledger_entries(guild_id, source_session_id, occurred_at, entry_id);

CREATE VIEW character_progression_balances AS
SELECT
  c.guild_id,
  c.character_id,
  c.owner_user_id,
  c.opening_xp + COALESCE(SUM(p.xp_delta), 0) AS xp,
  c.opening_gold + COALESCE(SUM(p.gold_delta), 0) AS gold
FROM characters c
LEFT JOIN progression_ledger_entries p
  ON p.guild_id = c.guild_id AND p.character_id = c.character_id
GROUP BY c.guild_id, c.character_id, c.owner_user_id, c.opening_xp, c.opening_gold;

CREATE TABLE session_reward_targets (
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  source_event_id TEXT NOT NULL,
  source_table_id TEXT NOT NULL REFERENCES plan_tables(table_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  selected_by_user_id TEXT NOT NULL,
  selected_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, source_event_id, source_table_id, user_id),
  FOREIGN KEY (source_event_id, guild_id)
    REFERENCES weekly_events(event_id, guild_id) ON DELETE CASCADE,
  FOREIGN KEY (character_id, guild_id)
    REFERENCES characters(character_id, guild_id) ON DELETE RESTRICT
);

CREATE INDEX session_reward_targets_user_idx
  ON session_reward_targets(guild_id, user_id, source_event_id, source_table_id);

CREATE TABLE session_reward_target_events (
  target_event_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  source_event_id TEXT NOT NULL,
  source_table_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  target_version INTEGER NOT NULL CHECK (target_version > 0),
  actor_user_id TEXT NOT NULL,
  reason TEXT,
  idempotency_key TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  UNIQUE (guild_id, idempotency_key),
  UNIQUE (guild_id, source_event_id, source_table_id, user_id, target_version),
  FOREIGN KEY (guild_id, source_event_id, source_table_id, user_id)
    REFERENCES session_reward_targets(
      guild_id, source_event_id, source_table_id, user_id
    ) ON DELETE CASCADE,
  FOREIGN KEY (character_id, guild_id)
    REFERENCES characters(character_id, guild_id) ON DELETE RESTRICT
);
