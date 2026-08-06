const characterId = {
  type: 3,
  name: "character_id",
  description: "Full character ID shown by /character list.",
  required: true,
  min_length: 8,
  max_length: 100,
};

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

export const progressionCommands = [
  {
    name: "progression",
    description: "View balances and select the character you played.",
    type: 1,
    options: [
      { type: 1, name: "balance", description: "Privately show your character XP, level, and gold." },
      {
        type: 1,
        name: "select",
        description: "Select your character before an ended table's rewards synchronize.",
        options: [tableNumber, characterId, eventId],
      },
    ],
  },
  {
    name: "progression-admin",
    description: "Audit and correct character XP and gold.",
    type: 1,
    default_member_permissions: "32",
    options: [
      {
        type: 1,
        name: "adjust",
        description: "Append a reasoned XP and/or gold adjustment.",
        options: [
          characterId,
          { type: 4, name: "xp_delta", description: "Signed XP change; omit for zero.", min_value: -1000000, max_value: 1000000 },
          { type: 4, name: "gold_delta", description: "Signed gold change; omit for zero.", min_value: -100000000, max_value: 100000000 },
          { type: 3, name: "reason", description: "Required audit reason.", required: true, min_length: 3, max_length: 500 },
          { type: 5, name: "confirm", description: "Required: append this immutable adjustment.", required: true },
        ],
      },
      {
        type: 1,
        name: "history",
        description: "Show the latest progression ledger entries for a character.",
        options: [characterId],
      },
      {
        type: 1,
        name: "target",
        description: "Select a member's character before reward synchronization.",
        options: [
          { type: 6, name: "member", description: "Member receiving the session reward.", required: true },
          tableNumber,
          characterId,
          eventId,
          { type: 3, name: "reason", description: "Required override reason.", required: true, min_length: 3, max_length: 500 },
        ],
      },
    ],
  },
];
