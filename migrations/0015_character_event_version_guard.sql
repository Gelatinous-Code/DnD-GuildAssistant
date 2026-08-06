-- An audit event and its character mutation are written in the same D1 batch.
-- Abort the batch if an optimistic update did not advance the character to the
-- version claimed by the event, preventing orphaned or misleading history.

CREATE TRIGGER character_events_version_guard
BEFORE INSERT ON character_events
FOR EACH ROW
WHEN NEW.character_version <> (
  SELECT version
  FROM characters
  WHERE character_id = NEW.character_id AND guild_id = NEW.guild_id
)
BEGIN
  SELECT RAISE(ABORT, 'character event version does not match character');
END;
