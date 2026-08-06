const tableNumber = {
  type: 4,
  name: "table_number",
  description: "Published table number.",
  required: true,
  min_value: 1,
  max_value: 25,
};

const eventId = {
  type: 3,
  name: "event_id",
  description: "Optional event ID; defaults to the latest matching published event.",
  max_length: 100,
};

export const tableThreadCommands = [{
  name: "table-thread-admin",
  description: "Inspect or repair automatic pre-session table threads.",
  type: 1,
  default_member_permissions: "32",
  options: [
    {
      type: 1,
      name: "status",
      description: "Show the current workflow and DM delivery state for a table.",
      options: [tableNumber, eventId],
    },
    {
      type: 1,
      name: "manage",
      description: "Retry, recreate/redirect, or cancel a table-thread workflow.",
      options: [
        tableNumber,
        {
          type: 3,
          name: "action",
          description: "Repair action to perform.",
          required: true,
          choices: [
            { name: "Retry", value: "retry" },
            { name: "Recreate or redirect", value: "recreate" },
            { name: "Cancel", value: "cancel" },
          ],
        },
        {
          type: 3,
          name: "reason",
          description: "Required audit reason.",
          required: true,
          min_length: 3,
          max_length: 500,
        },
        {
          type: 7,
          name: "channel",
          description: "Optional replacement text, announcement, forum, or media channel.",
          channel_types: [0, 5, 15, 16],
        },
        eventId,
        {
          type: 5,
          name: "confirm",
          description: "Required: confirm this audited workflow change.",
          required: true,
        },
      ],
    },
  ],
}];
