const option = {
  subcommand: 1,
  string: 3,
  integer: 4,
  boolean: 5,
};

export const shopCommands = [
  {
    name: "shop",
    description: "Browse the guild shop, purchase items, and view receipts",
    dm_permission: false,
    options: [
      {
        type: option.subcommand,
        name: "browse",
        description: "Browse the shopkeeper's wares",
        options: [
          { type: option.string, name: "query", description: "Search item names first, then descriptions" },
          { type: option.string, name: "category", description: "Exact category" },
          { type: option.string, name: "tag", description: "Exact tag" },
          { type: option.boolean, name: "free", description: "Show only free or only paid items" },
        ],
      },
      {
        type: option.subcommand,
        name: "buy",
        description: "Preview a purchase before gold is charged",
        options: [
          { type: option.string, name: "item_id", description: "Start typing an item name", required: true, autocomplete: true },
          { type: option.string, name: "character_id", description: "Start typing your character name", required: true, autocomplete: true },
          { type: option.integer, name: "quantity", description: "Quantity (default 1)", min_value: 1, max_value: 99 },
          { type: option.string, name: "item_id_2", description: "Optional second item name", autocomplete: true },
          { type: option.integer, name: "quantity_2", description: "Second item quantity (default 1)", min_value: 1, max_value: 99 },
        ],
      },
      {
        type: option.subcommand,
        name: "history",
        description: "View your immutable shop receipts",
        options: [
          { type: option.string, name: "character_id", description: "Optionally filter by character name", autocomplete: true },
        ],
      },
      {
        type: option.subcommand,
        name: "characters",
        description: "Show your characters available for purchases",
      },
    ],
  },
  {
    name: "shop-admin",
    description: "Manage the guild shop and correct purchases",
    dm_permission: false,
    default_member_permissions: "32",
    options: [
      {
        type: option.subcommand,
        name: "item",
        description: "Create or replace a catalog item",
        options: [
          { type: option.string, name: "item_id", description: "Stable ID; existing items are suggested", required: true, autocomplete: true },
          { type: option.string, name: "name", description: "Display name", required: true },
          { type: option.string, name: "category", description: "Category", required: true },
          { type: option.string, name: "description", description: "Player-facing description", required: true, max_length: 2000 },
          { type: option.integer, name: "price_gold", description: "Gold price; 0 is free", required: true, min_value: 0 },
          { type: option.string, name: "reason", description: "Audit reason", required: true },
          { type: option.string, name: "eligibility", description: "Who may buy it", choices: [
            { name: "Everyone", value: "all" }, { name: "Artificers", value: "artificer" },
          ] },
          { type: option.string, name: "repeat_rule", description: "Repeat purchase rule", choices: [
            { name: "Repeatable", value: "repeatable" },
            { name: "Once per character", value: "once_per_character" },
          ] },
          { type: option.integer, name: "max_quantity", description: "Maximum quantity per purchase", min_value: 1 },
          { type: option.integer, name: "minimum_level", description: "Minimum character level", min_value: 3, max_value: 10 },
          { type: option.integer, name: "maximum_level", description: "Maximum character level", min_value: 3, max_value: 10 },
          { type: option.boolean, name: "contract_consumable", description: "Consumed by a guild contract" },
          { type: option.string, name: "tags", description: "Comma-separated tags" },
          { type: option.string, name: "source", description: "Source book or sheet" },
          { type: option.string, name: "rarity", description: "Rarity" },
          { type: option.boolean, name: "attunement", description: "Requires attunement" },
        ],
      },
      {
        type: option.subcommand,
        name: "active",
        description: "Deactivate or restore an item without deleting history",
        options: [
          { type: option.string, name: "item_id", description: "Start typing an item name", required: true, autocomplete: true },
          { type: option.boolean, name: "active", description: "Whether players can buy it", required: true },
          { type: option.string, name: "reason", description: "Audit reason", required: true },
        ],
      },
      {
        type: option.subcommand,
        name: "eligibility",
        description: "Mark an approved character as an Artificer",
        options: [
          { type: option.string, name: "character_id", description: "Start typing a character name", required: true, autocomplete: true },
          { type: option.string, name: "reason", description: "Audit reason", required: true },
        ],
      },
      {
        type: option.subcommand,
        name: "reverse",
        description: "Reverse a receipt with a compensating ledger entry",
        options: [
          { type: option.string, name: "receipt_id", description: "Immutable receipt ID", required: true },
          { type: option.string, name: "reason", description: "Required correction reason", required: true },
        ],
      },
      {
        type: option.subcommand,
        name: "configure",
        description: "Configure the shopkeeper and maintenance mode",
        options: [
          { type: option.string, name: "shopkeeper", description: "Shopkeeper display name" },
          { type: option.string, name: "welcome", description: "Welcome message", max_length: 500 },
          { type: option.boolean, name: "maintenance", description: "Pause browse and purchases" },
        ],
      },
      { type: option.subcommand, name: "status", description: "Show catalog revision and item counts" },
    ],
  },
];
