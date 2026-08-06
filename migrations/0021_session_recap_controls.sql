-- Complete recap qualification, author controls, delivery repair, and admin audit.

ALTER TABLE session_summaries ADD COLUMN reward_policy_version TEXT
  CHECK (reward_policy_version IS NULL OR length(trim(reward_policy_version)) BETWEEN 1 AND 100);
ALTER TABLE session_summaries ADD COLUMN author_edit_status TEXT NOT NULL DEFAULT 'open'
  CHECK (author_edit_status IN ('open', 'locked'));
ALTER TABLE session_summaries ADD COLUMN edit_locked_at INTEGER;
ALTER TABLE session_summaries ADD COLUMN edit_locked_by_user_id TEXT;
ALTER TABLE session_summaries ADD COLUMN edit_lock_reason TEXT
  CHECK (
    (author_edit_status = 'open'
      AND edit_locked_at IS NULL AND edit_locked_by_user_id IS NULL
      AND edit_lock_reason IS NULL)
    OR
    (author_edit_status = 'locked'
      AND edit_locked_at IS NOT NULL AND edit_locked_by_user_id IS NOT NULL
      AND length(trim(edit_lock_reason)) BETWEEN 3 AND 500)
  );

ALTER TABLE session_summary_deliveries
  ADD COLUMN repair_count INTEGER NOT NULL DEFAULT 0 CHECK (repair_count >= 0);

CREATE TABLE session_summary_qualifications (
  qualification_id TEXT PRIMARY KEY,
  summary_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  completion_revision_id TEXT NOT NULL,
  first_submitted_at INTEGER NOT NULL,
  due_at INTEGER NOT NULL,
  qualification TEXT NOT NULL CHECK (qualification IN ('timely', 'late')),
  timing_policy_version TEXT NOT NULL,
  reward_policy_version TEXT NOT NULL
    CHECK (length(trim(reward_policy_version)) BETWEEN 1 AND 100),
  reward_status TEXT NOT NULL
    CHECK (reward_status IN (
      'not_qualified', 'qualified_ungranted', 'granted', 'reversed', 'failed'
    )),
  created_at INTEGER NOT NULL,
  UNIQUE (summary_id),
  UNIQUE (guild_id, completion_revision_id),
  FOREIGN KEY (summary_id, guild_id)
    REFERENCES session_summaries(summary_id, guild_id) ON DELETE CASCADE
);

CREATE INDEX session_summary_qualifications_status_idx
  ON session_summary_qualifications(guild_id, reward_status, created_at);

CREATE TABLE session_summary_admin_events (
  summary_event_id TEXT PRIMARY KEY,
  summary_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  event_kind TEXT NOT NULL CHECK (event_kind IN (
    'dm_reported_not_run', 'delivery_retried', 'edit_locked', 'edit_reopened',
    'hidden', 'unhidden', 'correction_appended'
  )),
  actor_user_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  public_correction TEXT,
  details_json TEXT,
  idempotency_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (guild_id, idempotency_key),
  FOREIGN KEY (summary_id, guild_id)
    REFERENCES session_summaries(summary_id, guild_id) ON DELETE CASCADE,
  CHECK (
    (event_kind = 'correction_appended'
      AND public_correction IS NOT NULL
      AND length(trim(public_correction)) BETWEEN 3 AND 1000)
    OR
    (event_kind <> 'correction_appended' AND public_correction IS NULL)
  )
);

CREATE INDEX session_summary_admin_events_summary_idx
  ON session_summary_admin_events(guild_id, summary_id, created_at DESC);

CREATE TRIGGER session_summary_submission_requires_reward_policy
BEFORE UPDATE OF status ON session_summaries
FOR EACH ROW
WHEN OLD.status = 'pending' AND NEW.status = 'submitted'
  AND (NEW.reward_policy_version IS NULL OR length(trim(NEW.reward_policy_version)) = 0)
BEGIN
  SELECT RAISE(ABORT, 'recap reward policy is not configured');
END;

CREATE TRIGGER session_summary_qualification_on_first_submit
AFTER UPDATE OF status ON session_summaries
FOR EACH ROW
WHEN OLD.status = 'pending' AND NEW.status = 'submitted'
BEGIN
  INSERT INTO session_summary_qualifications (
    qualification_id, summary_id, guild_id, completion_revision_id,
    first_submitted_at, due_at, qualification, timing_policy_version,
    reward_policy_version, reward_status, created_at
  ) VALUES (
    'recap-qualification:' || NEW.summary_id,
    NEW.summary_id,
    NEW.guild_id,
    NEW.completion_revision_id,
    NEW.first_submitted_at,
    NEW.due_at,
    CASE WHEN NEW.first_submitted_at <= NEW.due_at THEN 'timely' ELSE 'late' END,
    'recap-timing-v1',
    NEW.reward_policy_version,
    CASE
      WHEN NEW.first_submitted_at <= NEW.due_at THEN 'qualified_ungranted'
      ELSE 'not_qualified'
    END,
    NEW.first_submitted_at
  );
END;
