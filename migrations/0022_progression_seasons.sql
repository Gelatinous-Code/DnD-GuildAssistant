-- Versioned guild progression seasons and immutable per-character openings.
-- Existing balances are assigned to a legacy season without rewriting history.

CREATE TABLE progression_seasons (
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  season_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('current', 'closed')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  starts_at INTEGER NOT NULL,
  ended_at INTEGER,
  created_by_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, season_id),
  CHECK (length(trim(season_id)) BETWEEN 1 AND 80),
  CHECK (length(trim(name)) BETWEEN 1 AND 80),
  CHECK (
    (status = 'current' AND ended_at IS NULL)
    OR (status = 'closed' AND ended_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX progression_one_current_season_uq
  ON progression_seasons(guild_id) WHERE status = 'current';

INSERT INTO progression_seasons (
  guild_id, season_id, name, status, starts_at,
  created_by_user_id, created_at, updated_at
)
SELECT guild_id, 'legacy', 'Legacy / opening balances', 'current', 0,
       'system:migration:0022', 0, 0
FROM guild_config;

ALTER TABLE progression_ledger_entries
  ADD COLUMN season_id TEXT NOT NULL DEFAULT 'legacy';

CREATE INDEX progression_character_season_history_idx
  ON progression_ledger_entries(
    guild_id, character_id, season_id, occurred_at DESC, entry_id DESC
  );


CREATE TABLE character_season_openings (
  opening_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  season_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  opening_xp INTEGER NOT NULL CHECK (opening_xp >= 0),
  opening_gold INTEGER NOT NULL CHECK (opening_gold >= 0),
  policy_version TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('migration', 'approval', 'rollover')),
  actor_user_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  idempotency_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (guild_id, season_id, character_id),
  UNIQUE (guild_id, idempotency_key),
  FOREIGN KEY (guild_id, season_id)
    REFERENCES progression_seasons(guild_id, season_id) ON DELETE RESTRICT,
  FOREIGN KEY (character_id, guild_id)
    REFERENCES characters(character_id, guild_id) ON DELETE RESTRICT
);

INSERT INTO character_season_openings (
  opening_id, guild_id, season_id, character_id, opening_xp, opening_gold,
  policy_version, source_kind, actor_user_id, reason, idempotency_key, created_at
)
SELECT
  'season-opening:legacy:' || character_id,
  guild_id,
  'legacy',
  character_id,
  opening_xp,
  opening_gold,
  'progression-season-v1',
  'migration',
  'system:migration:0022',
  'Preserve the pre-season opening balance',
  'season-opening:legacy:' || character_id,
  0
FROM characters
WHERE status <> 'pending'
   OR EXISTS (
     SELECT 1 FROM progression_ledger_entries entry
     WHERE entry.guild_id = characters.guild_id
       AND entry.character_id = characters.character_id
   );

CREATE TABLE progression_season_events (
  season_event_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  from_season_id TEXT NOT NULL,
  to_season_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action = 'rollover'),
  policy_version TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  character_count INTEGER NOT NULL CHECK (character_count >= 0),
  idempotency_key TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  details_json TEXT,
  UNIQUE (guild_id, idempotency_key),
  UNIQUE (guild_id, to_season_id),
  FOREIGN KEY (guild_id, from_season_id)
    REFERENCES progression_seasons(guild_id, season_id) ON DELETE RESTRICT,
  FOREIGN KEY (guild_id, to_season_id)
    REFERENCES progression_seasons(guild_id, season_id) ON DELETE RESTRICT
);

DROP VIEW character_progression_balances;

CREATE VIEW character_progression_by_season AS
SELECT
  opening.guild_id,
  opening.season_id,
  season.name AS season_name,
  season.status AS season_status,
  opening.character_id,
  character.owner_user_id,
  opening.opening_xp + COALESCE(SUM(entry.xp_delta), 0) AS xp,
  opening.opening_gold + COALESCE(SUM(entry.gold_delta), 0) AS gold
FROM character_season_openings opening
JOIN progression_seasons season
  ON season.guild_id = opening.guild_id AND season.season_id = opening.season_id
JOIN characters character
  ON character.guild_id = opening.guild_id
 AND character.character_id = opening.character_id
LEFT JOIN progression_ledger_entries entry
  ON entry.guild_id = opening.guild_id
 AND entry.character_id = opening.character_id
 AND entry.season_id = opening.season_id
GROUP BY
  opening.guild_id, opening.season_id, season.name, season.status,
  opening.character_id, character.owner_user_id,
  opening.opening_xp, opening.opening_gold;

CREATE VIEW character_progression_balances AS
SELECT guild_id, season_id, season_name, character_id, owner_user_id, xp, gold
FROM character_progression_by_season
WHERE season_status = 'current';
