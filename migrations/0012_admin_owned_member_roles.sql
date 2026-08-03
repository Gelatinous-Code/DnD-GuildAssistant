-- Member role ownership is deliberately outside the Guild Assistant boundary.
-- Clear legacy configuration only; this migration never changes Discord roles.
UPDATE guild_config
SET gm_role_id = NULL,
    role_sync_enabled = 0
WHERE gm_role_id IS NOT NULL
   OR role_sync_enabled <> 0;
