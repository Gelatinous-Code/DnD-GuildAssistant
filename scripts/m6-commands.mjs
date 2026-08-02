export const m6Commands = [
  {
    name: "session",
    description: "Record actual table attendance and confirm completed sessions.",
    type: 1,
    default_member_permissions: "32",
    options: [
      {
        type: 1,
        name: "attendance",
        description: "Record one attendance deviation before confirming a table session.",
        options: [
          {
            type: 4,
            name: "table_number",
            description: "Published table number.",
            required: true,
            min_value: 1,
            max_value: 25,
          },
          {
            type: 6,
            name: "member",
            description: "Member whose actual participation should be recorded.",
            required: true,
          },
          {
            type: 3,
            name: "role",
            description: "The member's actual session role.",
            required: true,
            choices: [
              { name: "DM", value: "dm" },
              { name: "Player", value: "player" },
            ],
          },
          {
            type: 3,
            name: "outcome",
            description: "How this member actually participated.",
            required: true,
            choices: [
              { name: "Attended", value: "attended" },
              { name: "No-show", value: "no_show" },
              { name: "Substitute", value: "substitute" },
              { name: "Walk-in", value: "walk_in" },
            ],
          },
          {
            type: 3,
            name: "event_id",
            description: "Archived event ID; defaults to the latest archived week.",
            max_length: 100,
          },
          {
            type: 6,
            name: "replaces",
            description: "For a substitute, the planned member who did not attend.",
          },
          {
            type: 3,
            name: "reason",
            description: "Concise private audit reason.",
            min_length: 3,
            max_length: 500,
          },
        ],
      },
      {
        type: 1,
        name: "confirm",
        description: "Freeze actual attendance and reconcile the DM reward exactly once.",
        options: [
          {
            type: 4,
            name: "table_number",
            description: "Published table number.",
            required: true,
            min_value: 1,
            max_value: 25,
          },
          {
            type: 3,
            name: "result",
            description: "Whether this table actually ran.",
            required: true,
            choices: [
              { name: "Completed", value: "completed" },
              { name: "Cancelled", value: "cancelled" },
            ],
          },
          {
            type: 5,
            name: "confirm",
            description: "Must be True to freeze attendance and reconcile rewards.",
            required: true,
          },
          {
            type: 3,
            name: "event_id",
            description: "Archived event ID; defaults to the latest archived week.",
            max_length: 100,
          },
          {
            type: 6,
            name: "dm",
            description: "Actual DM; defaults to the published table DM.",
          },
          {
            type: 3,
            name: "reason",
            description: "Required for a cancellation or correction.",
            min_length: 3,
            max_length: 500,
          },
        ],
      },
      {
        type: 1,
        name: "status",
        description: "Show the private draft, current revision, and reward sync state.",
        options: [
          {
            type: 4,
            name: "table_number",
            description: "Published table number.",
            required: true,
            min_value: 1,
            max_value: 25,
          },
          {
            type: 3,
            name: "event_id",
            description: "Archived event ID; defaults to the latest archived week.",
            max_length: 100,
          },
        ],
      },
    ],
  },
  {
    name: "priority",
    description: "View and explicitly use your private DM priority tokens.",
    type: 1,
    options: [
      {
        type: 1,
        name: "status",
        description: "Privately show available tokens and their usable-through dates.",
      },
      {
        type: 1,
        name: "use",
        description: "Privately preview priority, then confirm with the bound button.",
        options: [
          {
            type: 4,
            name: "table_number",
            description: "Published table number to protect with one token.",
            required: true,
            min_value: 1,
            max_value: 25,
          },
        ],
      },
      {
        type: 1,
        name: "release",
        description: "Stop using priority while keeping your ordinary table request.",
        options: [
          {
            type: 5,
            name: "confirm",
            description: "Must be True to release the reserved token.",
            required: true,
          },
        ],
      },
    ],
  },
  {
    name: "priority-admin",
    description: "Diagnose and correct DM priority outcomes privately.",
    type: 1,
    default_member_permissions: "32",
    options: [
      {
        type: 1,
        name: "diagnose",
        description: "Explain a member's token, seating, and delivery history.",
        options: [
          {
            type: 6,
            name: "member",
            description: "Optional member; omit for aggregate guild health.",
          },
          {
            type: 3,
            name: "event_id",
            description: "Optional event boundary for the private trace.",
            max_length: 100,
          },
        ],
      },
      {
        type: 1,
        name: "correct",
        description: "Append a reasoned correction to an erroneous reward grant.",
        options: [
          {
            type: 3,
            name: "grant_id",
            description: "Grant identifier from private diagnostics.",
            required: true,
            max_length: 100,
          },
          {
            type: 3,
            name: "reason",
            description: "Why this grant is being corrected.",
            required: true,
            min_length: 3,
            max_length: 500,
          },
          {
            type: 5,
            name: "confirm",
            description: "Must be True to append the correction.",
            required: true,
          },
        ],
      },
      {
        type: 1,
        name: "refund",
        description: "Explicitly refund one reserved or redeemed token.",
        options: [
          {
            type: 3,
            name: "credit_id",
            description: "Token identifier from private diagnostics.",
            required: true,
            max_length: 100,
          },
          {
            type: 3,
            name: "reason",
            description: "Why this token is being refunded.",
            required: true,
            min_length: 3,
            max_length: 500,
          },
          {
            type: 5,
            name: "confirm",
            description: "Must be True to refund the token.",
            required: true,
          },
        ],
      },
      {
        type: 1,
        name: "configure",
        description: "Configure the private pre-expiration reminder lead time.",
        options: [
          {
            type: 4,
            name: "reminder_hours",
            description: "Hours before expiry; 0 disables reminders.",
            required: true,
            min_value: 0,
            max_value: 720,
          },
          {
            type: 5,
            name: "confirm",
            description: "Must be True to save this setting.",
            required: true,
          },
        ],
      },
    ],
  },
];
