-- Keep every reward-target audit event aligned with the version written in the
-- same atomic D1 batch. A stale concurrent update aborts instead of recording
-- misleading selection history.

CREATE TRIGGER session_reward_target_events_version_guard
BEFORE INSERT ON session_reward_target_events
FOR EACH ROW
WHEN NEW.target_version <> (
  SELECT version
  FROM session_reward_targets
  WHERE guild_id = NEW.guild_id
    AND source_event_id = NEW.source_event_id
    AND source_table_id = NEW.source_table_id
    AND user_id = NEW.user_id
)
BEGIN
  SELECT RAISE(ABORT, 'reward target event version does not match target');
END;
