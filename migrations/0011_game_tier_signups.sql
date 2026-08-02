-- A signup's tier is a weekly snapshot, not a persistent character profile.
ALTER TABLE signups ADD COLUMN game_tier INTEGER
  CHECK (game_tier IS NULL OR game_tier BETWEEN 1 AND 3);
ALTER TABLE signups ADD COLUMN gm_commitment TEXT
  CHECK (gm_commitment IS NULL OR gm_commitment IN ('primary', 'backup'));

ALTER TABLE plan_tables ADD COLUMN game_tier INTEGER
  CHECK (game_tier IS NULL OR game_tier BETWEEN 1 AND 3);

ALTER TABLE assignments ADD COLUMN game_tier INTEGER
  CHECK (game_tier IS NULL OR game_tier BETWEEN 1 AND 3);

DROP INDEX assignments_plan_roster_rank_uq;
DROP INDEX assignments_global_bench_idx;

CREATE UNIQUE INDEX assignments_plan_tier_roster_rank_uq
  ON assignments(plan_id, game_tier, roster_rank)
  WHERE roster_rank IS NOT NULL;

CREATE INDEX assignments_plan_tier_roster_status_idx
  ON assignments(plan_id, game_tier, roster_status, roster_rank, user_id);

CREATE INDEX signups_event_tier_idx
  ON signups(event_id, signup_kind, game_tier, status, signed_up_at);

CREATE INDEX plan_tables_plan_tier_idx
  ON plan_tables(plan_id, game_tier, table_number);
