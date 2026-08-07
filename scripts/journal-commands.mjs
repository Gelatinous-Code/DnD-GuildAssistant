const characterId = {
  type: 3,
  name: "character_id",
  description: "Full approved character ID shown by /character list.",
  required: true,
  min_length: 8,
  max_length: 100,
};

export const journalCommands = [
  {
    name: "journal",
    description: "Write and manage your player character journals.",
    type: 1,
    options: [
      {
        type: 1,
        name: "write",
        description: "Open a journal form for a completed session you attended.",
        options: [
          characterId,
          {
            type: 3,
            name: "session_id",
            description: "Completed session ID; omit to use your latest eligible session.",
            min_length: 8,
            max_length: 100,
          },
        ],
      },
      {
        type: 1,
        name: "list",
        description: "List your recent journal drafts and submissions.",
      },
    ],
  },
  {
    name: "journal-admin",
    description: "Configure, moderate, and repair player journals.",
    type: 1,
    default_member_permissions: "32",
    options: [
      {
        type: 1,
        name: "configure",
        description: "Choose the Player Character Journals thread.",
        options: [{
          type: 7,
          name: "thread",
          description: "The thread named Player Character Journals.",
          required: true,
          channel_types: [10, 11, 12],
        }],
      },
      {
        type: 1,
        name: "status",
        description: "Show the current journal publication configuration.",
      },
      {
        type: 1,
        name: "manage",
        description: "Hide, unhide, or retry publication for a journal.",
        options: [
          {
            type: 3,
            name: "journal_id",
            description: "Full journal ID from /journal list or audit output.",
            required: true,
            min_length: 8,
            max_length: 100,
          },
          {
            type: 3,
            name: "action",
            description: "Audited journal control.",
            required: true,
            choices: [
              { name: "Hide", value: "hide" },
              { name: "Unhide", value: "unhide" },
              { name: "Retry publication", value: "retry" },
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
            type: 5,
            name: "confirm",
            description: "Required: apply this journal control.",
            required: true,
          },
        ],
      },
    ],
  },
];
