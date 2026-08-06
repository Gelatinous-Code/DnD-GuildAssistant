-- Guild-scoped character registry. Progression awards are intentionally stored
-- in the progression ledger added separately; these opening values are the
-- immutable baseline used when importing an existing approved character.

CREATE TABLE characters (
  character_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sheet_url TEXT,
  season TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'revoked', 'archived')),
  progression_state TEXT NOT NULL DEFAULT 'active'
    CHECK (progression_state IN ('active', 'frozen')),
  is_main INTEGER NOT NULL DEFAULT 0 CHECK (is_main IN (0, 1)),
  opening_xp INTEGER NOT NULL DEFAULT 0 CHECK (opening_xp >= 0),
  opening_gold INTEGER NOT NULL DEFAULT 0 CHECK (opening_gold >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at INTEGER NOT NULL,
  created_by_user_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  approved_at INTEGER,
  approved_by_user_id TEXT,
  revoked_at INTEGER,
  revoked_by_user_id TEXT,
  archived_at INTEGER,
  archived_by_user_id TEXT,
  UNIQUE (character_id, guild_id),
  CHECK (length(trim(name)) BETWEEN 1 AND 80),
  CHECK (sheet_url IS NULL OR length(sheet_url) <= 500),
  CHECK (season IS NULL OR length(trim(season)) BETWEEN 1 AND 80),
  CHECK (status = 'approved' OR is_main = 0),
  CHECK (progression_state = 'active' OR (status = 'approved' AND is_main = 0)),
  CHECK (
    (status = 'approved' AND approved_at IS NOT NULL AND approved_by_user_id IS NOT NULL)
    OR (status <> 'approved' AND (status IN ('revoked', 'archived') OR approved_at IS NULL))
  ),
  CHECK (
    (status = 'revoked' AND revoked_at IS NOT NULL AND revoked_by_user_id IS NOT NULL)
    OR (status <> 'revoked' AND revoked_at IS NULL AND revoked_by_user_id IS NULL)
  ),
  CHECK (
    (status = 'archived' AND archived_at IS NOT NULL AND archived_by_user_id IS NOT NULL)
    OR (status <> 'archived' AND archived_at IS NULL AND archived_by_user_id IS NULL)
  )
);

CREATE UNIQUE INDEX characters_one_main_per_member_uq
  ON characters(guild_id, owner_user_id)
  WHERE status = 'approved' AND is_main = 1;
CREATE INDEX characters_owner_idx
  ON characters(guild_id, owner_user_id, status, created_at, character_id);
CREATE INDEX characters_pending_idx
  ON characters(guild_id, status, created_at, character_id);

CREATE TABLE character_events (
  character_event_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  character_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN (
    'created', 'approved', 'main_changed', 'frozen', 'unfrozen',
    'revoked', 'archived'
  )),
  character_version INTEGER NOT NULL CHECK (character_version > 0),
  actor_user_id TEXT NOT NULL,
  reason TEXT,
  details_json TEXT,
  occurred_at INTEGER NOT NULL,
  UNIQUE (guild_id, idempotency_key),
  UNIQUE (character_id, character_version),
  FOREIGN KEY (character_id, guild_id)
    REFERENCES characters(character_id, guild_id) ON DELETE CASCADE
);

CREATE INDEX character_events_character_idx
  ON character_events(guild_id, character_id, occurred_at DESC, character_event_id DESC);
