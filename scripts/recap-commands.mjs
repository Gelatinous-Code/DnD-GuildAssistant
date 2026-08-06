const tableNumber = {
  type: 4,
  name: "table_number",
  description: "Final table number for the ended session.",
  required: true,
  min_value: 1,
  max_value: 25,
};

const eventId = {
  type: 3,
  name: "event_id",
  description: "Archived event ID; defaults to the latest ended week.",
  max_length: 100,
};

export const recapCommands = [
  {
    name: "recap",
    description: "Find and submit your pending session recaps.",
    type: 1,
    options: [{
      type: 1,
      name: "pending",
      description: "Show private fallback links for session recaps still awaiting you.",
    }],
  },
  {
    name: "recap-admin",
    description: "Inspect, repair, and moderate session recaps.",
    type: 1,
    default_member_permissions: "32",
    options: [
      {
        type: 1,
        name: "status",
        description: "Show recap delivery, qualification, visibility, and audit status.",
        options: [tableNumber, eventId],
      },
      {
        type: 1,
        name: "manage",
        description: "Apply a confirmed, audited recap control.",
        options: [
          tableNumber,
          {
            type: 3,
            name: "action",
            description: "Control to apply.",
            required: true,
            choices: [
              { name: "Retry DM delivery", value: "retry_delivery" },
              { name: "Lock DM edits", value: "lock" },
              { name: "Reopen DM edits", value: "reopen" },
              { name: "Hide from website", value: "hide" },
              { name: "Unhide on website", value: "unhide" },
              { name: "Append public correction", value: "correction" },
            ],
          },
          {
            type: 3,
            name: "reason",
            description: "Required private audit reason.",
            required: true,
            min_length: 3,
            max_length: 500,
          },
          {
            type: 5,
            name: "confirm",
            description: "Required: confirm this audited control.",
            required: true,
          },
          eventId,
          {
            type: 4,
            name: "hours",
            description: "For reopen: new edit window in hours (default 24).",
            min_value: 1,
            max_value: 168,
          },
          {
            type: 3,
            name: "correction",
            description: "For correction: player-facing note appended to the recap.",
            min_length: 3,
            max_length: 1_000,
          },
        ],
      },
    ],
  },
];
