import type { GuildCharacter } from "./storage/character-repository";

export type ShopEligibility = "all" | "artificer";
export type ShopRepeatRule = "repeatable" | "once_per_character";

export interface ShopCatalogItem {
  guildId: string;
  itemId: string;
  name: string;
  source: string | null;
  category: string;
  description: string;
  rarity: string | null;
  requiresAttunement: boolean;
  damage: string | null;
  properties: string | null;
  mastery: string | null;
  tags: string[];
  priceGold: number;
  eligibility: ShopEligibility;
  repeatRule: ShopRepeatRule;
  maxQuantity: number | null;
  active: boolean;
  minimumLevel: number | null;
  maximumLevel: number | null;
  contractConsumable: boolean;
  itemRevision: number;
  catalogRevision: number;
  updatedAt: number;
}

export interface ShopReceipt {
  receiptId: string;
  guildId: string;
  previewId: string;
  userId: string;
  characterId: string;
  seasonId: string;
  itemId: string;
  quantity: number;
  itemName: string;
  unitPriceGold: number;
  totalGold: number;
  catalogRevision: number;
  itemRevision: number;
  ledgerEntryId: string | null;
  status: "completed" | "reversed";
  purchasedAt: number;
}

export interface ShopPreview {
  previewId: string;
  guildId: string;
  userId: string;
  characterId: string;
  characterName: string;
  itemId: string;
  itemName: string;
  quantity: number;
  unitPriceGold: number;
  totalGold: number;
  balanceGold: number;
  expiresAt: number;
}

type ItemRow = {
  guild_id: string;
  item_id: string;
  name: string;
  source: string | null;
  category: string;
  description: string;
  rarity: string | null;
  requires_attunement: number;
  damage: string | null;
  properties: string | null;
  mastery: string | null;
  tags_json: string;
  price_gold: number;
  eligibility: ShopEligibility;
  repeat_rule: ShopRepeatRule;
  max_quantity: number | null;
  active: number;
  minimum_level: number | null;
  maximum_level: number | null;
  contract_consumable: number;
  item_revision: number;
  catalog_revision: number;
  updated_at: number;
};

type ReceiptRow = {
  receipt_id: string;
  guild_id: string;
  preview_id: string;
  user_id: string;
  character_id: string;
  season_id: string;
  item_id: string;
  quantity: number;
  item_name: string;
  unit_price_gold: number;
  total_gold: number;
  catalog_revision: number;
  item_revision: number;
  ledger_entry_id: string | null;
  status: "completed" | "reversed";
  purchased_at: number;
};

function itemFromRow(row: ItemRow): ShopCatalogItem {
  return {
    guildId: row.guild_id,
    itemId: row.item_id,
    name: row.name,
    source: row.source,
    category: row.category,
    description: row.description,
    rarity: row.rarity,
    requiresAttunement: row.requires_attunement === 1,
    damage: row.damage,
    properties: row.properties,
    mastery: row.mastery,
    tags: JSON.parse(row.tags_json) as string[],
    priceGold: row.price_gold,
    eligibility: row.eligibility,
    repeatRule: row.repeat_rule,
    maxQuantity: row.max_quantity,
    active: row.active === 1,
    minimumLevel: row.minimum_level,
    maximumLevel: row.maximum_level,
    contractConsumable: row.contract_consumable === 1,
    itemRevision: row.item_revision,
    catalogRevision: row.catalog_revision,
    updatedAt: row.updated_at,
  };
}

function receiptFromRow(row: ReceiptRow): ShopReceipt {
  return {
    receiptId: row.receipt_id,
    guildId: row.guild_id,
    previewId: row.preview_id,
    userId: row.user_id,
    characterId: row.character_id,
    seasonId: row.season_id,
    itemId: row.item_id,
    quantity: row.quantity,
    itemName: row.item_name,
    unitPriceGold: row.unit_price_gold,
    totalGold: row.total_gold,
    catalogRevision: row.catalog_revision,
    itemRevision: row.item_revision,
    ledgerEntryId: row.ledger_entry_id,
    status: row.status,
    purchasedAt: row.purchased_at,
  };
}

export class ShopRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopRuleError";
  }
}

export class ShopService {
  constructor(private readonly db: D1Database) {}

  async ensureConfig(guildId: string, actorUserId: string, now = Date.now()): Promise<void> {
    await this.db.prepare(
      `INSERT OR IGNORE INTO shop_catalog_config
       (guild_id, updated_by_user_id, updated_at) VALUES (?, ?, ?)`,
    ).bind(guildId, actorUserId, now).run();
  }

  async getConfig(guildId: string): Promise<{
    catalogRevision: number;
    shopkeeperName: string;
    welcomeMessage: string;
    maintenanceMode: boolean;
    updatedAt: number;
  } | null> {
    const row = await this.db.prepare(
      `SELECT catalog_revision, shopkeeper_name, welcome_message, maintenance_mode, updated_at
       FROM shop_catalog_config WHERE guild_id = ?`,
    ).bind(guildId).first<{
      catalog_revision: number;
      shopkeeper_name: string;
      welcome_message: string;
      maintenance_mode: number;
      updated_at: number;
    }>();
    return row ? {
      catalogRevision: row.catalog_revision,
      shopkeeperName: row.shopkeeper_name,
      welcomeMessage: row.welcome_message,
      maintenanceMode: row.maintenance_mode === 1,
      updatedAt: row.updated_at,
    } : null;
  }

  async configure(input: {
    guildId: string;
    actorUserId: string;
    shopkeeperName?: string;
    welcomeMessage?: string;
    maintenanceMode?: boolean;
    now?: number;
  }): Promise<void> {
    const now = input.now ?? Date.now();
    await this.ensureConfig(input.guildId, input.actorUserId, now);
    await this.db.prepare(
      `UPDATE shop_catalog_config SET
         shopkeeper_name = COALESCE(?, shopkeeper_name),
         welcome_message = COALESCE(?, welcome_message),
         maintenance_mode = COALESCE(?, maintenance_mode),
         updated_by_user_id = ?, updated_at = ?
       WHERE guild_id = ?`,
    ).bind(
      input.shopkeeperName?.trim() || null,
      input.welcomeMessage?.trim() || null,
      input.maintenanceMode === undefined ? null : input.maintenanceMode ? 1 : 0,
      input.actorUserId,
      now,
      input.guildId,
    ).run();
  }

  async listCatalog(input: {
    guildId: string;
    query?: string;
    category?: string;
    tag?: string;
    eligibility?: ShopEligibility;
    free?: boolean;
    includeInactive?: boolean;
    afterItemId?: string;
    limit?: number;
  }): Promise<ShopCatalogItem[]> {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 101);
    const query = input.query?.trim().toLowerCase();
    const result = await this.db.prepare(
      `SELECT * FROM shop_catalog_items
       WHERE guild_id = ?
         AND (? = 1 OR active = 1)
         AND (? IS NULL OR lower(name) LIKE ? OR lower(description) LIKE ?)
         AND (? IS NULL OR lower(category) = lower(?))
         AND (? IS NULL OR EXISTS (
           SELECT 1 FROM json_each(tags_json) WHERE lower(value) = lower(?)
         ))
         AND (? IS NULL OR eligibility = ?)
         AND (? IS NULL OR (price_gold = 0) = ?)
         AND item_id > ?
       ORDER BY item_id LIMIT ?`,
    ).bind(
      input.guildId,
      input.includeInactive ? 1 : 0,
      query ?? null,
      query ? `%${query}%` : null,
      query ? `%${query}%` : null,
      input.category?.trim() || null,
      input.category?.trim() || null,
      input.tag?.trim() || null,
      input.tag?.trim() || null,
      input.eligibility ?? null,
      input.eligibility ?? null,
      input.free === undefined ? null : 1,
      input.free ? 1 : 0,
      input.afterItemId ?? "",
      limit,
    ).all<ItemRow>();
    return result.results.map(itemFromRow);
  }
  async catalogCounts(guildId: string): Promise<{ total: number; active: number }> {
    const row = await this.db.prepare(
      `SELECT count(*) AS total,
         COALESCE(sum(CASE WHEN active=1 THEN 1 ELSE 0 END), 0) AS active
       FROM shop_catalog_items WHERE guild_id=?`,
    ).bind(guildId).first<{ total: number; active: number }>();
    return {
      total: row?.total ?? 0,
      active: row?.active ?? 0,
    };
  }


  async getItem(guildId: string, itemId: string): Promise<ShopCatalogItem | null> {
    const row = await this.db.prepare(
      "SELECT * FROM shop_catalog_items WHERE guild_id = ? AND item_id = ?",
    ).bind(guildId, itemId).first<ItemRow>();
    return row ? itemFromRow(row) : null;
  }

  async upsertItem(input: {
    guildId: string;
    itemId: string;
    name: string;
    category: string;
    description: string;
    priceGold: number;
    eligibility?: ShopEligibility;
    repeatRule?: ShopRepeatRule;
    maxQuantity?: number | null;
    tags?: string[];
    minimumLevel?: number | null;
    maximumLevel?: number | null;
    contractConsumable?: boolean;
    source?: string | null;
    rarity?: string | null;
    requiresAttunement?: boolean;
    damage?: string | null;
    properties?: string | null;
    mastery?: string | null;
    active?: boolean;
    actorUserId: string;
    reason: string;
    importBatchId?: string | null;
    now?: number;
  }): Promise<ShopCatalogItem> {
    const now = input.now ?? Date.now();
    if (!/^[a-z0-9][a-z0-9._-]{1,79}$/.test(input.itemId)) {
      throw new ShopRuleError("Item ID must be 2–80 lowercase letters, numbers, dots, dashes, or underscores.");
    }
    if (!Number.isSafeInteger(input.priceGold) || input.priceGold < 0) {
      throw new ShopRuleError("Gold price must be a non-negative whole number.");
    }
    if (input.reason.trim().length < 3) throw new ShopRuleError("A reason is required.");
    for (const [label, value] of [["Minimum level", input.minimumLevel], ["Maximum level", input.maximumLevel]] as const) {
      if (value !== undefined && value !== null && (!Number.isSafeInteger(value) || value < 3 || value > 10)) {
        throw new ShopRuleError(`${label} must be a whole level from 3 through 10.`);
      }
    }
    if (input.minimumLevel !== undefined && input.minimumLevel !== null &&
        input.maximumLevel !== undefined && input.maximumLevel !== null &&
        input.minimumLevel > input.maximumLevel) {
      throw new ShopRuleError("Minimum level cannot exceed maximum level.");
    }
    await this.ensureConfig(input.guildId, input.actorUserId, now);
    const current = await this.getItem(input.guildId, input.itemId);
    const itemRevision = (current?.itemRevision ?? 0) + 1;
    const catalogRevision = (await this.getConfig(input.guildId))!.catalogRevision + 1;
    const tags = [...new Set((input.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
    const snapshot = {
      itemId: input.itemId, name: input.name.trim(), category: input.category.trim(),
      description: input.description.trim(), priceGold: input.priceGold,
      eligibility: input.eligibility ?? "all", repeatRule: input.repeatRule ?? "repeatable",
      maxQuantity: input.maxQuantity ?? null, minimumLevel: input.minimumLevel ?? null,
      maximumLevel: input.maximumLevel ?? null,
      contractConsumable: input.contractConsumable ?? false, tags, active: input.active ?? true,
    };
    await this.db.batch([
      this.db.prepare(
        `UPDATE shop_catalog_config SET catalog_revision = ?, updated_by_user_id = ?, updated_at = ?
         WHERE guild_id = ? AND catalog_revision = ?`,
      ).bind(catalogRevision, input.actorUserId, now, input.guildId, catalogRevision - 1),
      this.db.prepare(
        `INSERT INTO shop_catalog_items (
           guild_id, item_id, name, source, category, description, rarity,
           requires_attunement, damage, properties, mastery, tags_json, price_gold,
           eligibility, repeat_rule, max_quantity, minimum_level, maximum_level, contract_consumable, active, item_revision,
           catalog_revision, import_batch_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(guild_id, item_id) DO UPDATE SET
           name=excluded.name, source=excluded.source, category=excluded.category,
           description=excluded.description, rarity=excluded.rarity,
           requires_attunement=excluded.requires_attunement, damage=excluded.damage,
           properties=excluded.properties, mastery=excluded.mastery, tags_json=excluded.tags_json,
           price_gold=excluded.price_gold, eligibility=excluded.eligibility,
           repeat_rule=excluded.repeat_rule, max_quantity=excluded.max_quantity,
           minimum_level=excluded.minimum_level, maximum_level=excluded.maximum_level,
           contract_consumable=excluded.contract_consumable,
           active=excluded.active, item_revision=excluded.item_revision,
           catalog_revision=excluded.catalog_revision, import_batch_id=excluded.import_batch_id,
           updated_at=excluded.updated_at`,
      ).bind(
        input.guildId, input.itemId, input.name.trim(), input.source ?? null,
        input.category.trim(), input.description.trim(), input.rarity ?? null,
        input.requiresAttunement ? 1 : 0, input.damage ?? null, input.properties ?? null,
        input.mastery ?? null, JSON.stringify(tags), input.priceGold,
        input.eligibility ?? "all", input.repeatRule ?? "repeatable",
        input.maxQuantity ?? null, input.minimumLevel ?? null, input.maximumLevel ?? null,
        input.contractConsumable ? 1 : 0, input.active === false ? 0 : 1, itemRevision,
        catalogRevision, input.importBatchId ?? null, current?.updatedAt ?? now, now,
      ),
      this.db.prepare(
        `INSERT INTO shop_catalog_item_revisions (
           revision_id, guild_id, item_id, item_revision, catalog_revision,
           snapshot_json, action, actor_user_id, reason, occurred_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        `shop-item-revision:${input.guildId}:${input.itemId}:${itemRevision}`,
        input.guildId, input.itemId, itemRevision, catalogRevision,
        JSON.stringify(snapshot), current ? "updated" : "created",
        input.actorUserId, input.reason.trim(), now,
      ),
    ]);
    return (await this.getItem(input.guildId, input.itemId))!;
  }

  async setItemActive(input: {
    guildId: string;
    itemId: string;
    active: boolean;
    actorUserId: string;
    reason: string;
    now?: number;
  }): Promise<ShopCatalogItem> {
    const current = await this.getItem(input.guildId, input.itemId);
    if (!current) throw new ShopRuleError("That catalog item does not exist.");
    return this.upsertItem({
      ...current,
      active: input.active,
      actorUserId: input.actorUserId,
      reason: input.reason,
      now: input.now,
    });
  }

  async grantEligibility(input: {
    guildId: string;
    characterId: string;
    actorUserId: string;
    reason: string;
    now?: number;
  }): Promise<void> {
    await this.db.prepare(
      `INSERT INTO shop_character_eligibilities
       (guild_id, character_id, eligibility, granted_by_user_id, reason, granted_at)
       VALUES (?, ?, 'artificer', ?, ?, ?)
       ON CONFLICT(guild_id, character_id, eligibility) DO UPDATE SET
         granted_by_user_id=excluded.granted_by_user_id,
         reason=excluded.reason, granted_at=excluded.granted_at`,
    ).bind(
      input.guildId, input.characterId, input.actorUserId,
      input.reason.trim(), input.now ?? Date.now(),
    ).run();
  }

  async createPreview(input: {
    guildId: string;
    userId: string;
    characterId: string;
    itemId: string;
    quantity: number;
    now?: number;
  }): Promise<ShopPreview> {
    const now = input.now ?? Date.now();
    if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 99) {
      throw new ShopRuleError("Quantity must be a whole number from 1 to 99.");
    }
    const config = await this.getConfig(input.guildId);
    if (!config || config.catalogRevision === 0) throw new ShopRuleError("The shop has no catalog yet.");
    if (config.maintenanceMode) throw new ShopRuleError("The shopkeeper has stepped away for maintenance.");
    const row = await this.db.prepare(
      `SELECT item.*, character.name AS character_name, balance.gold AS balance_gold,
         balance.season_id AS balance_season_id,
         (SELECT count(*) FROM progression_ledger_entries ledger
          WHERE ledger.guild_id = character.guild_id
            AND ledger.character_id = character.character_id
            AND ledger.season_id = balance.season_id) AS balance_entry_count
       FROM shop_catalog_items item
       JOIN characters character ON character.guild_id = item.guild_id
         AND character.character_id = ? AND character.owner_user_id = ?
         AND character.status = 'approved' AND character.progression_state = 'active'
       JOIN character_progression_balances balance ON balance.guild_id = character.guild_id
         AND balance.character_id = character.character_id
       WHERE item.guild_id = ? AND item.item_id = ? AND item.active = 1
         AND (item.minimum_level IS NULL OR (CASE
           WHEN balance.xp >= 42 THEN 10 WHEN balance.xp >= 33 THEN 9
           WHEN balance.xp >= 25 THEN 8 WHEN balance.xp >= 18 THEN 7
           WHEN balance.xp >= 12 THEN 6 WHEN balance.xp >= 7 THEN 5
           WHEN balance.xp >= 3 THEN 4 ELSE 3 END) >= item.minimum_level)
         AND (item.maximum_level IS NULL OR (CASE
           WHEN balance.xp >= 42 THEN 10 WHEN balance.xp >= 33 THEN 9
           WHEN balance.xp >= 25 THEN 8 WHEN balance.xp >= 18 THEN 7
           WHEN balance.xp >= 12 THEN 6 WHEN balance.xp >= 7 THEN 5
           WHEN balance.xp >= 3 THEN 4 ELSE 3 END) <= item.maximum_level)
         AND (item.max_quantity IS NULL OR ? <= item.max_quantity)
         AND (item.eligibility = 'all' OR EXISTS (
           SELECT 1 FROM shop_character_eligibilities eligible
           WHERE eligible.guild_id = item.guild_id
             AND eligible.character_id = character.character_id
             AND eligible.eligibility = item.eligibility
         ))
         AND (item.repeat_rule = 'repeatable' OR NOT EXISTS (
           SELECT 1 FROM shop_purchase_receipts prior
           WHERE prior.guild_id = item.guild_id
             AND prior.character_id = character.character_id
             AND prior.item_id = item.item_id AND prior.status = 'completed'
         ))`,
    ).bind(
      input.characterId, input.userId, input.guildId, input.itemId, input.quantity,
    ).first<ItemRow & {
      character_name: string;
      balance_gold: number;
      balance_season_id: string;
      balance_entry_count: number;
    }>();
    if (!row) throw new ShopRuleError("That item cannot be purchased by that active, approved character.");
    const totalGold = row.price_gold * input.quantity;
    if (!Number.isSafeInteger(totalGold) || totalGold > row.balance_gold) {
      throw new ShopRuleError(`That character needs ${totalGold} gold but has ${row.balance_gold}.`);
    }
    const previewId = crypto.randomUUID();
    const expiresAt = now + 10 * 60_000;
    await this.db.batch([this.db.prepare(
      `INSERT INTO shop_purchase_previews (
         preview_id, guild_id, user_id, character_id, item_id, quantity,
         item_name, unit_price_gold, total_gold, catalog_revision, item_revision,
         balance_season_id, balance_gold, balance_entry_count, created_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      previewId, input.guildId, input.userId, input.characterId, input.itemId,
      input.quantity, row.name, row.price_gold, totalGold, row.catalog_revision,
      row.item_revision, row.balance_season_id, row.balance_gold,
      row.balance_entry_count, now, expiresAt,
    ), this.db.prepare(
      `INSERT INTO shop_purchase_preview_items (
         preview_id, line_number, guild_id, item_id, quantity, item_name,
         unit_price_gold, line_total_gold, catalog_revision, item_revision,
         eligibility, repeat_rule, max_quantity, minimum_level, maximum_level, contract_consumable
       ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      previewId, input.guildId, input.itemId, input.quantity, row.name,
      row.price_gold, totalGold, row.catalog_revision, row.item_revision,
      row.eligibility, row.repeat_rule, row.max_quantity,
      row.minimum_level, row.maximum_level, row.contract_consumable,
    )]);
    return {
      previewId, guildId: input.guildId, userId: input.userId,
      characterId: input.characterId, characterName: row.character_name,
      itemId: input.itemId, itemName: row.name, quantity: input.quantity,
      unitPriceGold: row.price_gold, totalGold, balanceGold: row.balance_gold, expiresAt,
    };
  }

  async createCartPreview(input: {
    guildId: string;
    userId: string;
    characterId: string;
    items: Array<{ itemId: string; quantity: number }>;
    now?: number;
  }): Promise<ShopPreview> {
    if (input.items.length < 1 || input.items.length > 5) {
      throw new ShopRuleError("A cart must contain between one and five distinct items.");
    }
    if (new Set(input.items.map((item) => item.itemId)).size !== input.items.length) {
      throw new ShopRuleError("Combine duplicate items into one cart quantity.");
    }
    if (input.items.length === 1) {
      return this.createPreview({ ...input, ...input.items[0]!, now: input.now });
    }
    const created: ShopPreview[] = [];
    try {
      for (const requested of input.items) {
        created.push(await this.createPreview({
          guildId: input.guildId,
          userId: input.userId,
          characterId: input.characterId,
          itemId: requested.itemId,
          quantity: requested.quantity,
          now: input.now,
        }));
      }
      const rows = await Promise.all(created.map((preview) => this.db.prepare(
        "SELECT balance_season_id, balance_gold, balance_entry_count FROM shop_purchase_previews WHERE preview_id=?",
      ).bind(preview.previewId).first<{
        balance_season_id: string;
        balance_gold: number;
        balance_entry_count: number;
      }>()));
      if (rows.some((row) => !row) || new Set(rows.map((row) => row!.balance_entry_count)).size !== 1) {
        throw new ShopRuleError("The character balance changed while building the cart. Please try again.");
      }
      if (new Set(rows.map((row) => row!.balance_season_id)).size !== 1) {
        throw new ShopRuleError("The progression season changed while building the cart. Please try again.");
      }
      const totalGold = created.reduce((sum, preview) => sum + preview.totalGold, 0);
      const balanceGold = rows[0]!.balance_gold;
      if (!Number.isSafeInteger(totalGold) || totalGold > balanceGold) {
        throw new ShopRuleError(`That character needs ${totalGold} gold but has ${balanceGold}.`);
      }
      const primary = created[0]!;
      const statements: D1PreparedStatement[] = [this.db.prepare(
        `UPDATE shop_purchase_previews SET quantity=?, item_name=?, unit_price_gold=0,
           total_gold=? WHERE preview_id=?`,
      ).bind(
        input.items.reduce((sum, item) => sum + item.quantity, 0),
        `${input.items.length}-item cart`, totalGold, primary.previewId,
      )];
      for (let index = 1; index < created.length; index += 1) {
        statements.push(this.db.prepare(
          `INSERT INTO shop_purchase_preview_items (
             preview_id,line_number,guild_id,item_id,quantity,item_name,
             unit_price_gold,line_total_gold,catalog_revision,item_revision,
             eligibility,repeat_rule,max_quantity,minimum_level,maximum_level,contract_consumable)
           SELECT ?, ?, guild_id,item_id,quantity,item_name,unit_price_gold,
             line_total_gold,catalog_revision,item_revision,eligibility,repeat_rule,max_quantity,minimum_level,maximum_level,contract_consumable
           FROM shop_purchase_preview_items WHERE preview_id=? AND line_number=1`,
        ).bind(primary.previewId, index + 1, created[index]!.previewId));
        statements.push(this.db.prepare(
          "DELETE FROM shop_purchase_previews WHERE preview_id=?",
        ).bind(created[index]!.previewId));
      }
      await this.db.batch(statements);
      return {
        ...primary,
        itemName: `${input.items.length}-item cart`,
        quantity: input.items.reduce((sum, item) => sum + item.quantity, 0),
        unitPriceGold: 0,
        totalGold,
      };
    } catch (error) {
      await Promise.all(created.map((preview) => this.db.prepare(
        "DELETE FROM shop_purchase_previews WHERE preview_id=? AND NOT EXISTS (SELECT 1 FROM shop_purchase_receipts WHERE preview_id=?)",
      ).bind(preview.previewId, preview.previewId).run()));
      throw error;
    }
  }

  async confirmPurchase(input: {
    guildId: string;
    userId: string;
    previewId: string;
    now?: number;
  }): Promise<ShopReceipt> {
    const now = input.now ?? Date.now();
    const receiptId = `shop-receipt:${input.previewId}`;
    const ledgerEntryId = `shop-ledger:${input.previewId}`;
    const eventId = `shop-event:purchased:${input.previewId}`;
    const condition = `preview.guild_id = ? AND preview.user_id = ? AND preview.expires_at >= ?
      AND character.status = 'approved' AND character.progression_state = 'active'
      AND balance.gold >= preview.total_gold
      AND balance.season_id = preview.balance_season_id
      AND (SELECT count(*) FROM progression_ledger_entries current_entry
           WHERE current_entry.guild_id = preview.guild_id
             AND current_entry.character_id = preview.character_id
             AND current_entry.season_id = balance.season_id) = preview.balance_entry_count
      AND preview.total_gold = (SELECT COALESCE(SUM(line_total_gold), 0)
        FROM shop_purchase_preview_items WHERE preview_id=preview.preview_id)
      AND NOT EXISTS (
        SELECT 1 FROM shop_purchase_preview_items line
        LEFT JOIN shop_catalog_items item ON item.guild_id=line.guild_id AND item.item_id=line.item_id
        WHERE line.preview_id=preview.preview_id AND (
          item.item_id IS NULL OR item.active<>1 OR item.item_revision<>line.item_revision
          OR item.catalog_revision<>line.catalog_revision
          OR (item.max_quantity IS NOT NULL AND line.quantity>item.max_quantity)
          OR (item.minimum_level IS NOT NULL AND (CASE
            WHEN balance.xp >= 42 THEN 10 WHEN balance.xp >= 33 THEN 9
            WHEN balance.xp >= 25 THEN 8 WHEN balance.xp >= 18 THEN 7
            WHEN balance.xp >= 12 THEN 6 WHEN balance.xp >= 7 THEN 5
            WHEN balance.xp >= 3 THEN 4 ELSE 3 END) < item.minimum_level)
          OR (item.maximum_level IS NOT NULL AND (CASE
            WHEN balance.xp >= 42 THEN 10 WHEN balance.xp >= 33 THEN 9
            WHEN balance.xp >= 25 THEN 8 WHEN balance.xp >= 18 THEN 7
            WHEN balance.xp >= 12 THEN 6 WHEN balance.xp >= 7 THEN 5
            WHEN balance.xp >= 3 THEN 4 ELSE 3 END) > item.maximum_level)
          OR (item.eligibility<>'all' AND NOT EXISTS (
            SELECT 1 FROM shop_character_eligibilities eligible
            WHERE eligible.guild_id=preview.guild_id AND eligible.character_id=preview.character_id
              AND eligible.eligibility=item.eligibility))
          OR (item.repeat_rule='once_per_character' AND EXISTS (
            SELECT 1 FROM shop_purchase_receipt_items prior_line
            JOIN shop_purchase_receipts prior ON prior.receipt_id=prior_line.receipt_id
            WHERE prior.guild_id=preview.guild_id AND prior.character_id=preview.character_id
              AND prior.status='completed' AND prior_line.item_id=line.item_id))
        ))`;
    await this.db.batch([
      this.db.prepare(
        `INSERT OR IGNORE INTO progression_ledger_entries (
           entry_id, guild_id, character_id, season_id, entry_kind, xp_delta, gold_delta,
           source_session_id, source_completion_revision_id, source_user_id,
           participant_role, policy_version, pre_award_xp, pre_award_gold,
           pre_award_level, reverses_entry_id, actor_user_id, reason,
           idempotency_key, occurred_at
         )
         SELECT ?, preview.guild_id, preview.character_id, balance.season_id,
           'admin_adjustment', 0, -preview.total_gold,
           NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, preview.user_id,
           ?, ?, ?
         FROM shop_purchase_previews preview
         JOIN characters character ON character.guild_id=preview.guild_id AND character.character_id=preview.character_id
           AND character.owner_user_id=preview.user_id
         JOIN character_progression_balances balance ON balance.guild_id=preview.guild_id
           AND balance.character_id=preview.character_id
         WHERE preview.preview_id = ? AND preview.total_gold > 0 AND ${condition}`,
      ).bind(
        ledgerEntryId, `Guild shop purchase ${receiptId}`, `shop:purchase:${input.previewId}`,
        now, input.previewId, input.guildId, input.userId, now,
      ),
      this.db.prepare(
        `INSERT OR IGNORE INTO shop_purchase_receipts (
           receipt_id, guild_id, preview_id, user_id, character_id, season_id,
           item_id, quantity, item_name, unit_price_gold, total_gold,
           catalog_revision, item_revision, ledger_entry_id, purchased_at
         )
         SELECT ?, preview.guild_id, preview.preview_id, preview.user_id,
           preview.character_id, balance.season_id, preview.item_id, preview.quantity,
           preview.item_name, preview.unit_price_gold, preview.total_gold,
           preview.catalog_revision, preview.item_revision,
           CASE WHEN preview.total_gold = 0 THEN NULL ELSE ? END, ?
         FROM shop_purchase_previews preview
         JOIN characters character ON character.guild_id=preview.guild_id AND character.character_id=preview.character_id
           AND character.owner_user_id=preview.user_id
         JOIN character_progression_balances balance ON balance.guild_id=preview.guild_id
           AND balance.character_id=preview.character_id
         WHERE preview.preview_id = ? AND (
           (preview.total_gold > 0 AND EXISTS (
             SELECT 1 FROM progression_ledger_entries charge
             WHERE charge.guild_id=preview.guild_id AND charge.entry_id=?))
           OR (preview.total_gold = 0 AND ${condition})
         )`,
      ).bind(
        receiptId, ledgerEntryId, now, input.previewId,
        ledgerEntryId, input.guildId, input.userId, now,
      ),
      this.db.prepare(
        `INSERT OR IGNORE INTO shop_purchase_receipt_items (
           receipt_id,line_number,item_id,quantity,item_name,unit_price_gold,
           line_total_gold,catalog_revision,item_revision,eligibility,repeat_rule,max_quantity,minimum_level,maximum_level,contract_consumable)
         SELECT ?, line.line_number,line.item_id,line.quantity,line.item_name,
           line.unit_price_gold,line.line_total_gold,line.catalog_revision,line.item_revision,
           line.eligibility,line.repeat_rule,line.max_quantity,line.minimum_level,line.maximum_level,line.contract_consumable
         FROM shop_purchase_preview_items line
         WHERE line.preview_id=? AND EXISTS (
           SELECT 1 FROM shop_purchase_receipts receipt
           WHERE receipt.receipt_id=? AND receipt.guild_id=?)`,
      ).bind(receiptId, input.previewId, receiptId, input.guildId),
      this.db.prepare(
        `INSERT OR IGNORE INTO shop_purchase_events
         (event_id, guild_id, receipt_id, action, actor_user_id, reason, occurred_at)
         SELECT ?, guild_id, receipt_id, 'purchased', user_id, 'Confirmed by the purchaser', ?
         FROM shop_purchase_receipts WHERE receipt_id = ? AND guild_id = ?`,
      ).bind(eventId, now, receiptId, input.guildId),
    ]);
    const receipt = await this.getReceipt(input.guildId, receiptId);
    if (!receipt || receipt.userId !== input.userId) {
      throw new ShopRuleError("That purchase preview is stale, expired, ineligible, or no longer affordable. Please preview it again.");
    }
    return receipt;
  }

  async getReceipt(guildId: string, receiptId: string): Promise<ShopReceipt | null> {
    const row = await this.db.prepare(
      "SELECT * FROM shop_purchase_receipts WHERE guild_id = ? AND receipt_id = ?",
    ).bind(guildId, receiptId).first<ReceiptRow>();
    return row ? receiptFromRow(row) : null;
  }

  async listReceipts(guildId: string, userId: string, characterId?: string): Promise<ShopReceipt[]> {
    const result = await this.db.prepare(
      `SELECT * FROM shop_purchase_receipts
       WHERE guild_id = ? AND user_id = ? AND (? IS NULL OR character_id = ?)
       ORDER BY purchased_at DESC, receipt_id DESC LIMIT 20`,
    ).bind(guildId, userId, characterId ?? null, characterId ?? null).all<ReceiptRow>();
    return result.results.map(receiptFromRow);
  }

  async purgeExpired(now = Date.now()): Promise<void> {
    await this.db.batch([
      this.db.prepare(
        `DELETE FROM shop_purchase_previews WHERE expires_at < ?
         AND NOT EXISTS (
           SELECT 1 FROM shop_purchase_receipts receipt
           WHERE receipt.preview_id=shop_purchase_previews.preview_id)`,
      ).bind(now),
      this.db.prepare(
        "DELETE FROM shop_catalog_rate_limits WHERE window_started_at < ?",
      ).bind(now - 2 * 60_000),
    ]);
  }

  async reversePurchase(input: {
    guildId: string;
    receiptId: string;
    actorUserId: string;
    reason: string;
    now?: number;
  }): Promise<ShopReceipt> {
    const now = input.now ?? Date.now();
    const receipt = await this.getReceipt(input.guildId, input.receiptId);
    if (!receipt) throw new ShopRuleError("That receipt does not exist.");
    if (receipt.status === "reversed") return receipt;
    const reversalEntryId = receipt.totalGold > 0 ? `shop-reversal:${receipt.receiptId}` : null;
    const statements: D1PreparedStatement[] = [];
    if (receipt.totalGold > 0) {
      statements.push(this.db.prepare(
        `INSERT OR IGNORE INTO progression_ledger_entries (
           entry_id, guild_id, character_id, season_id, entry_kind, xp_delta, gold_delta,
           source_session_id, source_completion_revision_id, source_user_id,
           participant_role, policy_version, pre_award_xp, pre_award_gold,
           pre_award_level, reverses_entry_id, actor_user_id, reason,
           idempotency_key, occurred_at
         ) VALUES (?, ?, ?, ?, 'reversal', 0, ?, NULL, NULL, NULL, NULL, NULL,
           NULL, NULL, NULL, ?, ?, ?, ?, ?)`,
      ).bind(
        reversalEntryId, input.guildId, receipt.characterId, receipt.seasonId,
        receipt.totalGold, receipt.ledgerEntryId, input.actorUserId,
        input.reason.trim(), `shop:reverse:${receipt.receiptId}`, now,
      ));
    }
    statements.push(
      this.db.prepare(
        `UPDATE shop_purchase_receipts SET status='reversed', reversed_at=?,
           reversed_by_user_id=?, reversal_ledger_entry_id=?, reversal_reason=?
         WHERE guild_id=? AND receipt_id=? AND status='completed'`,
      ).bind(
        now, input.actorUserId, reversalEntryId, input.reason.trim(),
        input.guildId, receipt.receiptId,
      ),
      this.db.prepare(
        `INSERT OR IGNORE INTO shop_purchase_events
         (event_id, guild_id, receipt_id, action, actor_user_id, reason, occurred_at)
         VALUES (?, ?, ?, 'reversed', ?, ?, ?)`,
      ).bind(
        `shop-event:reversed:${receipt.receiptId}`, input.guildId, receipt.receiptId,
        input.actorUserId, input.reason.trim(), now,
      ),
    );
    await this.db.batch(statements);
    return (await this.getReceipt(input.guildId, receipt.receiptId))!;
  }

  async approvedCharacters(guildId: string, userId: string): Promise<GuildCharacter[]> {
    const result = await this.db.prepare(
      `SELECT * FROM characters WHERE guild_id=? AND owner_user_id=?
       AND status='approved' AND progression_state='active'
       ORDER BY is_main DESC, name`,
    ).bind(guildId, userId).all<Record<string, unknown>>();
    return result.results.map((row) => ({
      characterId: row.character_id as string,
      guildId: row.guild_id as string,
      ownerUserId: row.owner_user_id as string,
      name: row.name as string,
      sheetUrl: row.sheet_url as string | null,
      season: row.season as string | null,
      status: row.status as GuildCharacter["status"],
      progressionState: row.progression_state as GuildCharacter["progressionState"],
      isMain: row.is_main === 1,
      openingXp: row.opening_xp as number,
      openingGold: row.opening_gold as number,
      version: row.version as number,
      createdAt: row.created_at as number,
      createdByUserId: row.created_by_user_id as string,
      updatedAt: row.updated_at as number,
      approvedAt: row.approved_at as number | null,
      approvedByUserId: row.approved_by_user_id as string | null,
      revokedAt: row.revoked_at as number | null,
      revokedByUserId: row.revoked_by_user_id as string | null,
      archivedAt: row.archived_at as number | null,
      archivedByUserId: row.archived_by_user_id as string | null,
    }));
  }
}
