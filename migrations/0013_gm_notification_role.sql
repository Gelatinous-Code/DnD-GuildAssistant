-- This role is an announcement audience only. Guild Assistant never changes
-- which members have the role.
ALTER TABLE guild_config ADD COLUMN gm_notification_role_id TEXT;
