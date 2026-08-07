-- Versioned guild shop catalog, server-side purchase previews, immutable receipts,
-- and public catalog rate limits. Gold charges are posted to the shared
-- progression ledger as reasoned admin_adjustment entries and linked here.

CREATE TABLE shop_catalog_config (
  guild_id TEXT PRIMARY KEY REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  catalog_revision INTEGER NOT NULL DEFAULT 0 CHECK (catalog_revision >= 0),
  shopkeeper_name TEXT NOT NULL DEFAULT 'The Quartermaster'
    CHECK (length(trim(shopkeeper_name)) BETWEEN 1 AND 80),
  welcome_message TEXT NOT NULL DEFAULT 'Mind the mimics, adventurer.'
    CHECK (length(trim(welcome_message)) BETWEEN 1 AND 500),
  maintenance_mode INTEGER NOT NULL DEFAULT 0 CHECK (maintenance_mode IN (0, 1)),
  updated_by_user_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE shop_catalog_import_batches (
  import_batch_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  source_name TEXT NOT NULL,
  source_checksum TEXT NOT NULL,
  mapping_revision TEXT NOT NULL,
  catalog_revision INTEGER NOT NULL CHECK (catalog_revision > 0),
  imported_count INTEGER NOT NULL CHECK (imported_count >= 0),
  deactivated_count INTEGER NOT NULL CHECK (deactivated_count >= 0),
  actor_user_id TEXT NOT NULL,
  imported_at INTEGER NOT NULL,
  UNIQUE (guild_id, source_checksum, mapping_revision),
  UNIQUE (guild_id, catalog_revision)
);

CREATE TABLE shop_catalog_items (
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  source TEXT,
  category TEXT NOT NULL CHECK (length(trim(category)) BETWEEN 1 AND 80),
  description TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 2000),
  rarity TEXT,
  requires_attunement INTEGER NOT NULL DEFAULT 0 CHECK (requires_attunement IN (0, 1)),
  damage TEXT,
  properties TEXT,
  mastery TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
  price_gold INTEGER NOT NULL CHECK (price_gold >= 0),
  eligibility TEXT NOT NULL DEFAULT 'all'
    CHECK (eligibility IN ('all', 'artificer')),
  repeat_rule TEXT NOT NULL DEFAULT 'repeatable'
    CHECK (repeat_rule IN ('repeatable', 'once_per_character')),
  max_quantity INTEGER CHECK (max_quantity IS NULL OR max_quantity > 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  minimum_level INTEGER CHECK (minimum_level IS NULL OR minimum_level BETWEEN 3 AND 10),
  maximum_level INTEGER CHECK (maximum_level IS NULL OR maximum_level BETWEEN 3 AND 10),
  contract_consumable INTEGER NOT NULL DEFAULT 0 CHECK (contract_consumable IN (0, 1)),
  item_revision INTEGER NOT NULL DEFAULT 1 CHECK (item_revision > 0),
  catalog_revision INTEGER NOT NULL CHECK (catalog_revision > 0),
  import_batch_id TEXT REFERENCES shop_catalog_import_batches(import_batch_id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (minimum_level IS NULL OR maximum_level IS NULL OR minimum_level <= maximum_level),
  PRIMARY KEY (guild_id, item_id)
);

CREATE INDEX shop_catalog_browse_idx
  ON shop_catalog_items(guild_id, active, category, name, item_id);
CREATE INDEX shop_catalog_price_idx
  ON shop_catalog_items(guild_id, active, price_gold, item_id);

CREATE TABLE shop_character_eligibilities (
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  character_id TEXT NOT NULL,
  eligibility TEXT NOT NULL CHECK (eligibility = 'artificer'),
  granted_by_user_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, character_id, eligibility),
  FOREIGN KEY (character_id, guild_id)
    REFERENCES characters(character_id, guild_id) ON DELETE CASCADE
);

CREATE TABLE shop_catalog_item_revisions (
  revision_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_revision INTEGER NOT NULL CHECK (item_revision > 0),
  catalog_revision INTEGER NOT NULL CHECK (catalog_revision > 0),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'deactivated', 'restored', 'imported')),
  actor_user_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  occurred_at INTEGER NOT NULL,
  UNIQUE (guild_id, item_id, item_revision),
  FOREIGN KEY (guild_id, item_id)
    REFERENCES shop_catalog_items(guild_id, item_id) ON DELETE RESTRICT
);

CREATE TABLE shop_purchase_previews (
  preview_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  item_name TEXT NOT NULL,
  unit_price_gold INTEGER NOT NULL CHECK (unit_price_gold >= 0),
  total_gold INTEGER NOT NULL CHECK (total_gold >= 0),
  catalog_revision INTEGER NOT NULL CHECK (catalog_revision > 0),
  item_revision INTEGER NOT NULL CHECK (item_revision > 0),
  balance_gold INTEGER NOT NULL CHECK (balance_gold >= 0),
  balance_season_id TEXT NOT NULL,
  balance_entry_count INTEGER NOT NULL CHECK (balance_entry_count >= 0),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (character_id, guild_id)
    REFERENCES characters(character_id, guild_id) ON DELETE RESTRICT,
  FOREIGN KEY (guild_id, item_id)
    REFERENCES shop_catalog_items(guild_id, item_id) ON DELETE RESTRICT
);

CREATE INDEX shop_purchase_previews_expiry_idx
  ON shop_purchase_previews(expires_at);

CREATE TABLE shop_purchase_preview_items (
  preview_id TEXT NOT NULL REFERENCES shop_purchase_previews(preview_id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL CHECK (line_number > 0),
  guild_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  item_name TEXT NOT NULL,
  unit_price_gold INTEGER NOT NULL CHECK (unit_price_gold >= 0),
  line_total_gold INTEGER NOT NULL CHECK (line_total_gold >= 0),
  catalog_revision INTEGER NOT NULL CHECK (catalog_revision > 0),
  item_revision INTEGER NOT NULL CHECK (item_revision > 0),
  eligibility TEXT NOT NULL CHECK (eligibility IN ('all', 'artificer')),
  repeat_rule TEXT NOT NULL CHECK (repeat_rule IN ('repeatable', 'once_per_character')),
  max_quantity INTEGER CHECK (max_quantity IS NULL OR max_quantity > 0),
  minimum_level INTEGER CHECK (minimum_level IS NULL OR minimum_level BETWEEN 3 AND 10),
  maximum_level INTEGER CHECK (maximum_level IS NULL OR maximum_level BETWEEN 3 AND 10),
  contract_consumable INTEGER NOT NULL CHECK (contract_consumable IN (0, 1)),
  CHECK (minimum_level IS NULL OR maximum_level IS NULL OR minimum_level <= maximum_level),
  PRIMARY KEY (preview_id, line_number),
  UNIQUE (preview_id, item_id),
  FOREIGN KEY (guild_id, item_id)
    REFERENCES shop_catalog_items(guild_id, item_id) ON DELETE RESTRICT
);

CREATE TABLE shop_purchase_receipts (
  receipt_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  preview_id TEXT NOT NULL UNIQUE REFERENCES shop_purchase_previews(preview_id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  season_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  item_name TEXT NOT NULL,
  unit_price_gold INTEGER NOT NULL CHECK (unit_price_gold >= 0),
  total_gold INTEGER NOT NULL CHECK (total_gold >= 0),
  catalog_revision INTEGER NOT NULL,
  item_revision INTEGER NOT NULL,
  ledger_entry_id TEXT,
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed', 'reversed')),
  purchased_at INTEGER NOT NULL,
  reversed_at INTEGER,
  reversed_by_user_id TEXT,
  reversal_ledger_entry_id TEXT,
  reversal_reason TEXT,
  FOREIGN KEY (character_id, guild_id)
    REFERENCES characters(character_id, guild_id) ON DELETE RESTRICT,
  FOREIGN KEY (guild_id, item_id)
    REFERENCES shop_catalog_items(guild_id, item_id) ON DELETE RESTRICT,
  FOREIGN KEY (ledger_entry_id, guild_id)
    REFERENCES progression_ledger_entries(entry_id, guild_id) ON DELETE RESTRICT,
  FOREIGN KEY (reversal_ledger_entry_id, guild_id)
    REFERENCES progression_ledger_entries(entry_id, guild_id) ON DELETE RESTRICT,
  CHECK ((total_gold = 0 AND ledger_entry_id IS NULL) OR
         (total_gold > 0 AND ledger_entry_id IS NOT NULL)),
  CHECK ((status = 'completed' AND reversed_at IS NULL AND reversal_ledger_entry_id IS NULL) OR
         (status = 'reversed' AND reversed_at IS NOT NULL AND reversed_by_user_id IS NOT NULL
          AND reversal_reason IS NOT NULL))
);

CREATE INDEX shop_receipts_character_idx
  ON shop_purchase_receipts(guild_id, character_id, purchased_at DESC, receipt_id DESC);
CREATE INDEX shop_receipts_user_idx
  ON shop_purchase_receipts(guild_id, user_id, purchased_at DESC, receipt_id DESC);

CREATE TABLE shop_purchase_receipt_items (
  receipt_id TEXT NOT NULL REFERENCES shop_purchase_receipts(receipt_id) ON DELETE RESTRICT,
  line_number INTEGER NOT NULL CHECK (line_number > 0),
  item_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  item_name TEXT NOT NULL,
  unit_price_gold INTEGER NOT NULL CHECK (unit_price_gold >= 0),
  line_total_gold INTEGER NOT NULL CHECK (line_total_gold >= 0),
  catalog_revision INTEGER NOT NULL CHECK (catalog_revision > 0),
  item_revision INTEGER NOT NULL CHECK (item_revision > 0),
  eligibility TEXT NOT NULL CHECK (eligibility IN ('all', 'artificer')),
  repeat_rule TEXT NOT NULL CHECK (repeat_rule IN ('repeatable', 'once_per_character')),
  max_quantity INTEGER CHECK (max_quantity IS NULL OR max_quantity > 0),
  minimum_level INTEGER CHECK (minimum_level IS NULL OR minimum_level BETWEEN 3 AND 10),
  maximum_level INTEGER CHECK (maximum_level IS NULL OR maximum_level BETWEEN 3 AND 10),
  contract_consumable INTEGER NOT NULL CHECK (contract_consumable IN (0, 1)),
  CHECK (minimum_level IS NULL OR maximum_level IS NULL OR minimum_level <= maximum_level),
  PRIMARY KEY (receipt_id, line_number),
  UNIQUE (receipt_id, item_id)
);

CREATE TABLE shop_purchase_events (
  event_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  receipt_id TEXT NOT NULL REFERENCES shop_purchase_receipts(receipt_id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('purchased', 'reversed')),
  actor_user_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  occurred_at INTEGER NOT NULL,
  UNIQUE (guild_id, receipt_id, action)
);

CREATE TABLE shop_catalog_rate_limits (
  guild_id TEXT NOT NULL REFERENCES guild_config(guild_id) ON DELETE CASCADE,
  client_key TEXT NOT NULL,
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count >= 0),
  PRIMARY KEY (guild_id, client_key)
);
