-- Immutable, source-backed historical recap and player-journal link imports.
-- These records are archive material, not synthetic live session outcomes, so
-- they never participate in attendance or progression reconciliation.

CREATE TABLE historical_summary_import_batches (
  batch_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  season_label TEXT NOT NULL,
  source_url TEXT NOT NULL,
  worksheet_gid TEXT NOT NULL,
  retrieved_at INTEGER NOT NULL,
  content_checksum TEXT NOT NULL,
  mapping_version TEXT NOT NULL,
  mapping_checksum TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('staged', 'published', 'rolled_back')),
  source_row_count INTEGER NOT NULL CHECK (source_row_count >= 0),
  imported_summary_count INTEGER NOT NULL CHECK (imported_summary_count >= 0),
  journal_link_count INTEGER NOT NULL CHECK (journal_link_count >= 0),
  unmatched_identity_count INTEGER NOT NULL CHECK (unmatched_identity_count >= 0),
  validation_report_json TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  published_at INTEGER,
  rolled_back_at INTEGER,
  rolled_back_by_user_id TEXT,
  rollback_reason TEXT,
  UNIQUE (guild_id, season_label, content_checksum),
  CHECK (length(trim(season_label)) BETWEEN 1 AND 80),
  CHECK (length(content_checksum) = 64),
  CHECK (length(mapping_checksum) = 64),
  CHECK (
    (status = 'staged' AND published_at IS NULL AND rolled_back_at IS NULL
      AND rolled_back_by_user_id IS NULL AND rollback_reason IS NULL)
    OR
    (status = 'published' AND published_at IS NOT NULL AND rolled_back_at IS NULL
      AND rolled_back_by_user_id IS NULL AND rollback_reason IS NULL)
    OR
    (status = 'rolled_back' AND rolled_back_at IS NOT NULL
      AND rolled_back_by_user_id IS NOT NULL
      AND length(trim(rollback_reason)) BETWEEN 3 AND 500)
  )
);

CREATE INDEX historical_import_batches_status_idx
  ON historical_summary_import_batches(guild_id, status, season_label, created_at);

CREATE TABLE historical_session_records (
  historical_record_id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  source_row_number INTEGER NOT NULL CHECK (source_row_number > 1),
  source_row_key TEXT NOT NULL,
  row_checksum TEXT NOT NULL CHECK (length(row_checksum) = 64),
  season_label TEXT NOT NULL,
  game_date TEXT NOT NULL,
  gm_original TEXT NOT NULL,
  gm_normalized TEXT NOT NULL,
  gm_user_id TEXT,
  game_location TEXT NOT NULL,
  game_influence TEXT,
  official_summary TEXT NOT NULL,
  players_original TEXT,
  player_summary_status TEXT,
  player_summary_date TEXT,
  player_summary_url TEXT,
  identity_status TEXT NOT NULL CHECK (identity_status IN ('matched', 'unmatched')),
  source_values_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (batch_id, source_row_number),
  FOREIGN KEY (batch_id) REFERENCES historical_summary_import_batches(batch_id)
    ON DELETE RESTRICT
);

CREATE INDEX historical_session_records_date_idx
  ON historical_session_records(guild_id, game_date DESC, historical_record_id);
CREATE INDEX historical_session_records_gm_idx
  ON historical_session_records(guild_id, gm_user_id, gm_normalized, game_date DESC);
CREATE INDEX historical_session_records_journal_idx
  ON historical_session_records(guild_id, player_summary_url)
  WHERE player_summary_url IS NOT NULL;

CREATE TABLE historical_import_events (
  import_event_id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('staged', 'published', 'rolled_back', 'recovered')),
  actor_user_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  idempotency_key TEXT NOT NULL,
  details_json TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (guild_id, idempotency_key),
  FOREIGN KEY (batch_id) REFERENCES historical_summary_import_batches(batch_id)
    ON DELETE RESTRICT
);

CREATE INDEX historical_import_events_batch_idx
  ON historical_import_events(guild_id, batch_id, created_at, import_event_id);

CREATE TRIGGER historical_session_records_immutable_update
BEFORE UPDATE ON historical_session_records
BEGIN
  SELECT RAISE(ABORT, 'historical source records are immutable');
END;

CREATE TRIGGER historical_session_records_immutable_delete
BEFORE DELETE ON historical_session_records
BEGIN
  SELECT RAISE(ABORT, 'historical source records are immutable');
END;
