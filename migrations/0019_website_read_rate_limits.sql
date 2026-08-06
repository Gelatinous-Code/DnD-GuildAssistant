-- Fixed-window member-safe website API throttling. OAuth tokens are never stored.

CREATE TABLE website_read_rate_limits (
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  bucket_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id, bucket_started_at)
);

CREATE INDEX website_read_rate_limits_cleanup_idx
  ON website_read_rate_limits(updated_at);
