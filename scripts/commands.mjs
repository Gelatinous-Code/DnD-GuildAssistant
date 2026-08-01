// MVP destinations are normal text and announcement channels. Threads and
// forum/media parents require additional lifecycle and permission semantics.
const channelTypes = [0, 5];

export const commands = [
  {
    name: "ping",
    description: "Check whether the New Dawn Guild Assistant is awake.",
    type: 1,
  },
  {
    name: "guild",
    description: "Configure and diagnose the guild assistant.",
    type: 1,
    default_member_permissions: "32",
    dm_permission: false,
    options: [
      {
        type: 1,
        name: "setup",
        description: "Create or update this server's weekly-game configuration.",
        options: [
          {
            type: 7,
            name: "channel",
            description: "Channel for signup, table, and reminder posts.",
            channel_types: channelTypes,
            required: true,
          },
          {
            type: 8,
            name: "gm_role",
            description: "Temporary role owned by the assistant for selected weekly GMs.",
            required: true,
          },
          {
            type: 8,
            name: "reminder_role",
            description: "Optional role that scheduled signup reminders may mention.",
          },
          {
            type: 8,
            name: "admin_role",
            description: "Optional organizer role notified when table capacity is at risk.",
          },
          {
            type: 3,
            name: "timezone",
            description: "IANA time zone, for example America/Denver.",
          },
          {
            type: 4,
            name: "weekday",
            description: "Game day: 1 Monday through 7 Sunday.",
            min_value: 1,
            max_value: 7,
          },
          {
            type: 3,
            name: "time",
            description: "Local game time in 24-hour HH:mm format.",
          },
          {
            type: 4,
            name: "minimum",
            description: "Minimum players per viable table.",
            min_value: 1,
            max_value: 20,
          },
          {
            type: 4,
            name: "preferred",
            description: "Preferred players per table.",
            min_value: 1,
            max_value: 20,
          },
          {
            type: 4,
            name: "maximum",
            description: "Maximum players per table.",
            min_value: 1,
            max_value: 20,
          },
          {
            type: 4,
            name: "signup_lead_days",
            description: "Days before game time to open signups.",
            min_value: 1,
            max_value: 7,
          },
          {
            type: 4,
            name: "lock_lead_hours",
            description: "Hours before game time to lock signups.",
            min_value: 1,
            max_value: 168,
          },
          {
            type: 5,
            name: "scheduling_enabled",
            description: "Enable cron automation after /guild doctor passes.",
          },
          {
            type: 5,
            name: "role_sync_enabled",
            description: "Enable automatic weekly GM-role reconciliation.",
          },
        ],
      },
      {
        type: 1,
        name: "status",
        description: "Show sanitized configuration and the current weekly state.",
      },
      {
        type: 1,
        name: "doctor",
        description: "Check channels, permissions, roles, and role hierarchy.",
      },
    ],
  },
  {
    name: "week",
    description: "Run the weekly signup and table lifecycle.",
    type: 1,
    default_member_permissions: "32",
    dm_permission: false,
    options: [
      {
        type: 1,
        name: "open",
        description: "Open signups, using the next scheduled game unless overridden.",
        options: [
          {
            type: 3,
            name: "starts_at",
            description: "Optional ISO-8601 game instant, for example 2026-08-09T00:30:00Z.",
          },
          {
            type: 3,
            name: "title",
            description: "Optional label for this week's game.",
            max_length: 80,
          },
        ],
      },
      {
        type: 1,
        name: "status",
        description: "Show the current phase, counts, plan, and recent failures.",
      },
      {
        type: 1,
        name: "lock",
        description: "Lock GM and player signups.",
      },
      {
        type: 1,
        name: "signup",
        description: "Record an audited admin correction or late signup.",
        options: [
          {
            type: 6,
            name: "member",
            description: "Member whose weekly signup should change.",
            required: true,
          },
          {
            type: 3,
            name: "kind",
            description: "Corrected weekly intent.",
            required: true,
            choices: [
              { name: "GM", value: "gm" },
              { name: "Player", value: "player" },
              { name: "Withdraw", value: "withdraw" },
            ],
          },
        ],
      },
      {
        type: 1,
        name: "plan",
        description: "Generate or regenerate a deterministic reviewable table draft.",
      },
      {
        type: 1,
        name: "override",
        description: "Override one draft table before publication.",
        options: [
          {
            type: 4,
            name: "table_number",
            description: "Draft table number to change.",
            required: true,
            min_value: 1,
            max_value: 25,
          },
          {
            type: 3,
            name: "reason",
            description: "Required audit reason for this override.",
            required: true,
            min_length: 3,
            max_length: 500,
          },
          {
            type: 3,
            name: "name",
            description: "Optional custom table name.",
            max_length: 80,
          },
          {
            type: 4,
            name: "capacity",
            description: "Optional player capacity for this table.",
            min_value: 1,
            max_value: 20,
          },
          {
            type: 6,
            name: "gm",
            description: "Optional replacement from this week's active GM signups.",
          },
        ],
      },
      {
        type: 1,
        name: "publish",
        description: "Publish the current draft and reconcile weekly GM roles.",
      },
      {
        type: 1,
        name: "archive",
        description: "Archive the current week and remove assistant-owned GM roles.",
      },
      {
        type: 1,
        name: "cancel",
        description: "Cancel an unfinished or published week with an audited reason.",
        options: [
          {
            type: 3,
            name: "reason",
            description: "Why this week is being cancelled.",
            required: true,
            min_length: 3,
            max_length: 500,
          },
        ],
      },
      {
        type: 1,
        name: "retry",
        description: "Safely retry one idempotent scheduled step.",
        options: [
          {
            type: 3,
            name: "step",
            description: "Scheduled operation to retry.",
            required: true,
            choices: [
              { name: "Publish tables", value: "publish" },
              { name: "Open signups", value: "open" },
              { name: "Lock signups", value: "lock" },
              { name: "Send reminder", value: "remind" },
              { name: "Reconcile GM roles", value: "roles" },
            ],
          },
        ],
      },
      {
        type: 1,
        name: "skip",
        description: "Confirm an audited skip of one scheduled occurrence.",
        options: [
          {
            type: 3,
            name: "step",
            description: "Scheduled occurrence to skip.",
            required: true,
            choices: [
              { name: "Open signups", value: "open" },
              { name: "Lock signups and plan", value: "lock" },
              { name: "Send reminder", value: "remind" },
              { name: "Archive week", value: "archive" },
            ],
          },
          {
            type: 3,
            name: "reason",
            description: "Why this occurrence is being skipped.",
            required: true,
            min_length: 3,
            max_length: 500,
          },
          {
            type: 5,
            name: "confirm",
            description: "Must be True to record the skip.",
            required: true,
          },
        ],
      },
    ],
  },
  {
    name: "roles",
    description: "Repair assistant-owned weekly roles.",
    type: 1,
    default_member_permissions: "32",
    dm_permission: false,
    options: [
      {
        type: 1,
        name: "sync",
        description: "Preview or apply selected-GM role reconciliation.",
        options: [
          {
            type: 5,
            name: "dry_run",
            description: "Preview changes without modifying Discord roles.",
          },
        ],
      },
    ],
  },
  {
    name: "reminder",
    description: "Configure or send safe role-mention reminders.",
    type: 1,
    default_member_permissions: "32",
    dm_permission: false,
    options: [
      {
        type: 1,
        name: "configure",
        description: "Configure the pre-lock signup reminder.",
        options: [
          {
            type: 5,
            name: "enabled",
            description: "Whether the scheduled reminder is enabled.",
            required: true,
          },
          {
            type: 4,
            name: "hours_before",
            description: "Hours before signup lock to send.",
            min_value: 1,
            max_value: 168,
          },
          {
            type: 3,
            name: "message",
            description: "Reminder text; @everyone and @here are rejected.",
            max_length: 1000,
          },
          {
            type: 8,
            name: "role",
            description: "The only role this reminder is permitted to ping.",
          },
          {
            type: 7,
            name: "channel",
            description: "Optional destination; defaults to the configured channel.",
            channel_types: channelTypes,
          },
        ],
      },
      {
        type: 1,
        name: "send",
        description: "Send the configured reminder now with idempotent tracking.",
        options: [
          {
            type: 5,
            name: "resend",
            description: "Intentionally create another notification after a prior success.",
          },
          {
            type: 5,
            name: "confirm",
            description: "Must be True when resend is True.",
          },
        ],
      },
    ],
  },
];
