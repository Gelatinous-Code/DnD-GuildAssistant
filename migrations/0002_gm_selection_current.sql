-- Preserve superseded GM-selection rows for audit while counting only the
-- final published revision of each event in rotation priority.
ALTER TABLE gm_selections
  ADD COLUMN is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1));

CREATE INDEX gm_selections_current_priority_idx
  ON gm_selections(guild_id, is_current, gm_user_id, selected_at);
