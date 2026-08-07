const characterIdOption = {
  type: 3,
  name: "character_id",
  description: "Full character ID shown by /character list.",
  required: true,
  min_length: 8,
  max_length: 100,
};

export const characterCommands = [
  {
    name: "character",
    description: "Register and manage your guild characters.",
    type: 1,
    options: [
      {
        type: 1,
        name: "create",
        description: "Register a character for admin approval.",
        options: [
          { type: 3, name: "name", description: "Character name.", required: true, min_length: 1, max_length: 80 },
          { type: 3, name: "sheet_url", description: "Optional HTTPS link to the character sheet.", max_length: 500 },
          { type: 3, name: "season", description: "Optional campaign or season label.", max_length: 80 },
        ],
      },
      { type: 1, name: "list", description: "List your characters and reward state." },
      { type: 1, name: "main", description: "Choose an approved active character as your main.", options: [characterIdOption] },
      { type: 1, name: "freeze", description: "Freeze an approved secondary character's progression.", options: [characterIdOption] },
      { type: 1, name: "unfreeze", description: "Resume progression for a frozen secondary character.", options: [characterIdOption] },
      {
        type: 1,
        name: "archive",
        description: "Archive one of your characters while retaining its history.",
        options: [
          characterIdOption,
          { type: 5, name: "confirm", description: "Required: confirm this character should be archived.", required: true },
        ],
      },
    ],
  },
  {
    name: "character-admin",
    description: "Review and manage guild character approvals.",
    type: 1,
    default_member_permissions: "32",
    options: [
      { type: 1, name: "pending", description: "List characters awaiting approval." },
      {
        type: 1,
        name: "approve",
        description: "Approve a character and import its starting balances.",
        options: [
          characterIdOption,
          { type: 3, name: "reason", description: "Approval/import audit reason.", required: true, min_length: 3, max_length: 500 },
          { type: 5, name: "confirm", description: "Required: confirm approval and opening balances.", required: true },
          { type: 4, name: "opening_xp", description: "Existing XP before automated tracking begins; defaults to 0.", min_value: 0 },
          { type: 4, name: "opening_gold", description: "Existing gold before automated tracking begins; defaults to 0.", min_value: 0 },
        ],
      },
      {
        type: 1,
        name: "revoke",
        description: "Revoke a pending or approved character with an audit reason.",
        options: [
          characterIdOption,
          { type: 3, name: "reason", description: "Why this character is being revoked.", required: true, min_length: 3, max_length: 500 },
          { type: 5, name: "confirm", description: "Required: confirm revocation.", required: true },
        ],
      },
    ],
  },
];
