import { m6Commands } from "./m6-commands.mjs";
import { DISCORD_COMMAND_SCHEMA_VERSION } from "../src/command-schema-version.js";
export { DISCORD_COMMAND_SCHEMA_VERSION };
import { characterCommands } from "./character-commands.mjs";
import { progressionCommands } from "./progression-commands.mjs";
import { recapCommands } from "./recap-commands.mjs";
import { tableThreadCommands } from "./table-thread-commands.mjs";

// MVP destinations are normal text and announcement channels. Threads and
// forum/media parents require additional lifecycle and permission semantics.
const channelTypes = [0, 5];
const weekdayChoices = [
  { name: "Monday", value: 1 },
  { name: "Tuesday", value: 2 },
  { name: "Wednesday", value: 3 },
  { name: "Thursday", value: 4 },
  { name: "Friday", value: 5 },
  { name: "Saturday", value: 6 },
  { name: "Sunday", value: 7 },
];


export const commands = [
  {
    name: "ping",
    description: "Check whether the New Dawn Guild Assistant is awake.",
    type: 1,
  },
  {
    name: "help",
    description: "Show a private guide for players, GMs, priority, or organizers.",
    type: 1,
    options: [
      {
        type: 3,
        name: "topic",
        description: "Choose the part of the weekly flow you want explained.",
        choices: [
          { name: "Playing this week", value: "player" },
          { name: "Running a game", value: "gm" },
          { name: "DM priority tokens", value: "priority" },
          { name: "Organizing the server", value: "organizer" },
        ],
      },
    ],
  },
  {
    name: "guild",
    description: "Configure and diagnose the guild assistant.",
    type: 1,
    default_member_permissions: "32",
    options: [
      {
        type: 1,
        name: "setup",
        description: "Show the setup dashboard or change only the settings you provide.",
        options: [
          {
            type: 3,
            name: "preset",
            description: "Discover this guild's known channels and permanent audience roles.",
            choices: [{ name: "Second Dawn Guild", value: "second_dawn" }],
          },

          {
            type: 7,
            name: "channel",
            description: "Required once: channel for signup, tables, and built-in reminders.",
            channel_types: channelTypes,
          },
          {
            type: 8,
            name: "reminder_role",
            description: "Optional player role that scheduled signup reminders may mention.",
          },
          {
            type: 8,
            name: "gm_notification_role",
            description: "Optional GM role mentioned when GM signup opens.",
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
            description: "Local game day.",
            choices: [
              { name: "Monday", value: 1 },
              { name: "Tuesday", value: 2 },
              { name: "Wednesday", value: 3 },
              { name: "Thursday", value: 4 },
              { name: "Friday", value: 5 },
              { name: "Saturday", value: 6 },
              { name: "Sunday", value: 7 },
            ],
          },
          {
            type: 3,
            name: "time",
            description: "Local game time in 24-hour HH:mm format.",
          },
          {
            type: 4,
            name: "minimum",
            description: "Smallest viable table; recommended 4.",
            min_value: 1,
            max_value: 20,
          },
          {
            type: 4,
            name: "preferred",
            description: "Desired players per table and plan-health target; recommended 6.",
            min_value: 1,
            max_value: 20,
          },
          {
            type: 4,
            name: "maximum",
            description: "Hard seat cap before a table waitlist; recommended 6.",
            min_value: 1,
            max_value: 20,
          },
          {
            type: 4,
            name: "gm_day",
            description: "Local weekday when GM signup opens.",
            choices: weekdayChoices,
          },
          {
            type: 3,
            name: "gm_time",
            description: "Local GM signup time in 24-hour HH:mm format.",
          },
          {
            type: 4,
            name: "player_day",
            description: "Local weekday when player interest opens.",
            choices: weekdayChoices,
          },
          {
            type: 3,
            name: "player_time",
            description: "Local player signup time in 24-hour HH:mm format.",
          },
          {
            type: 4,
            name: "tables_day",
            description: "Local weekday when tables publish.",
            choices: weekdayChoices,
          },
          {
            type: 3,
            name: "tables_time",
            description: "Local table publication time in 24-hour HH:mm format.",
          },
          {
            type: 4,
            name: "open_seating_day",
            description: "Local weekday when remaining seats become first-come.",
            choices: weekdayChoices,
          },
          {
            type: 3,
            name: "open_seating_time",
            description: "Local open-seating time in 24-hour HH:mm format.",
          },
          {
            type: 4,
            name: "duration_minutes",
            description: "Game duration in minutes; New Dawn uses 180.",
            min_value: 60,
            max_value: 720,
          },
          {
            type: 5,
            name: "clear_reminder_role",
            description: "Clear the optional player reminder role.",
          },
          {
            type: 5,
            name: "clear_gm_notification_role",
            description: "Clear the optional GM signup notification role.",
          },
          {
            type: 5,
            name: "clear_admin_role",
            description: "Clear the optional organizer escalation role.",
          },
        ],
      },
      {
        type: 1,
        name: "automation",
        description: "Safely pause, review, or run the complete weekly lifecycle on autopilot.",
        options: [
          {
            type: 3,
            name: "mode",
            description: "Paused, scheduled with manual publish, or hands-off autopilot.",
            required: true,
            choices: [
              { name: "Paused", value: "paused" },
              { name: "Review before publish", value: "review" },
              { name: "Autopilot", value: "autopilot" },
            ],
          },
          {
            type: 5,
            name: "confirm",
            description: "Must be True to change automation mode.",
            required: true,
          },
          {
            type: 5,
            name: "reminders",
            description: "Enable/disable the safe default pre-lock reminder rule.",
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
        description: "Check channels, permissions, and notification roles.",
      },
    ],
  },
  {
    name: "week",
    description: "Run the weekly signup and table lifecycle.",
    type: 1,
    default_member_permissions: "32",
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
              { name: "Backup GM", value: "backup" },
              { name: "Player", value: "player" },
              { name: "Withdraw", value: "withdraw" },
            ],
          },
          {
            type: 4,
            name: "tier",
            description: "Required for a GM or player; omitted for backup or withdrawal.",
            choices: [
              { name: "Tier 1 — Levels 3–4", value: 1 },
              { name: "Tier 2 — Levels 5–7", value: 2 },
              { name: "Tier 3 — Levels 8+", value: 3 },
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
        description: "Publish the current table draft.",
      },
      {
        type: 1,
        name: "archive",
        description: "Archive the current week.",
      },
      {
        type: 1,
        name: "export",
        description: "Download a private, formula-safe CSV roster snapshot.",
        options: [
          {
            type: 3,
            name: "event_id",
            description: "Optional archived event ID; defaults to the active or latest week.",
            max_length: 100,
          },
        ],
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
          {
            type: 5,
            name: "confirm",
            description: "Required: confirm this will stop and cancel the active week.",
            required: true,
          },
        ],
      },
      {
        type: 1,
        name: "restart",
        description: "Clear a cancelled occurrence and reopen fresh signup posts.",
        options: [
          {
            type: 5,
            name: "confirm",
            description: "Required: clear unfinished signup and table data for this occurrence.",
            required: true,
          },
          {
            type: 3,
            name: "starts_at",
            description: "Optional cancelled game instant; defaults to the next scheduled game.",
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
              { name: "Finalize table manifest", value: "finalize" },
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
              { name: "Publish tables", value: "publish" },
              { name: "Finalize table manifest", value: "finalize" },
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
    name: "reminder",
    description: "Configure or send safe role-mention reminders.",
    type: 1,
    default_member_permissions: "32",
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
  ...m6Commands,
  ...characterCommands,
  ...progressionCommands,
  ...recapCommands,
  ...tableThreadCommands,
];
