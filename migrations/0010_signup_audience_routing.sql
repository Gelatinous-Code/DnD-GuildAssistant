-- Optional audience-specific signup routing. Existing guilds continue using
-- event_channel_id and the combined signup card until these fields are set.

ALTER TABLE guild_config ADD COLUMN gm_signup_channel_id TEXT;

ALTER TABLE weekly_events ADD COLUMN gm_signup_channel_id TEXT;
ALTER TABLE weekly_events ADD COLUMN gm_signup_message_id TEXT;
