import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { handleShopPublicApi } from "../../src/shop-public-api";
import { ShopRuleError, ShopService } from "../../src/shop-service";

const NOW = Date.parse("2026-09-01T18:00:00Z");

async function fixture(openingGold = 500) {
  const prefix = crypto.randomUUID();
  const guildId = `${prefix}:guild`;
  const userId = `${prefix}:user`;
  const adminId = `${prefix}:admin`;
  const characterId = `${prefix}:character`;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO guild_config (guild_id) VALUES (?)").bind(guildId),
    env.DB.prepare(
      `INSERT INTO characters (
         character_id, guild_id, owner_user_id, name, status, progression_state,
         is_main, opening_xp, opening_gold, version, created_at,
         created_by_user_id, updated_at, approved_at, approved_by_user_id
       ) VALUES (?, ?, ?, 'Mara', 'approved', 'active', 1, 0, ?, 1, ?, ?, ?, ?, ?)`,
    ).bind(characterId, guildId, userId, openingGold, NOW, userId, NOW, NOW, adminId),
    env.DB.prepare(
      `INSERT INTO progression_seasons (
         guild_id, season_id, name, status, starts_at,
         created_by_user_id, created_at, updated_at
       ) VALUES (?, 'season-1', 'Season One', 'current', ?, ?, ?, ?)`,
    ).bind(guildId, NOW - 1_000, adminId, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO character_season_openings (
         opening_id, guild_id, season_id, character_id, opening_xp, opening_gold,
         policy_version, source_kind, actor_user_id, reason, idempotency_key, created_at
       ) VALUES (?, ?, 'season-1', ?, 0, ?, 'shop-test-v1', 'approval', ?,
         'Guild shop test fixture', ?, ?)`,
    ).bind(`${prefix}:opening`, guildId, characterId, openingGold, adminId, `${prefix}:opening`, NOW),
  ]);
  const shop = new ShopService(env.DB);
  return { prefix, guildId, userId, adminId, characterId, shop };
}

async function addItem(input: {
  shop: ShopService;
  guildId: string;
  adminId: string;
  itemId: string;
  priceGold: number;
  eligibility?: "all" | "artificer";
  repeatRule?: "repeatable" | "once_per_character";
  minimumLevel?: number;
  maximumLevel?: number;
  contractConsumable?: boolean;
}) {
  return input.shop.upsertItem({
    guildId: input.guildId,
    itemId: input.itemId,
    name: input.itemId.replaceAll("-", " "),
    category: "Wonders",
    description: `A fine ${input.itemId}`,
    priceGold: input.priceGold,
    eligibility: input.eligibility,
    repeatRule: input.repeatRule,
    minimumLevel: input.minimumLevel,
    maximumLevel: input.maximumLevel,
    contractConsumable: input.contractConsumable,
    tags: ["magic", "fixture"],
    actorUserId: input.adminId,
    reason: "Guild shop integration fixture",
    now: NOW,
  });
}

describe("D1 guild shop", () => {
  it("charges paid purchases exactly once and reverses with a compensating entry", async () => {
    const f = await fixture();
    await addItem({ ...f, itemId: "moon-blade", priceGold: 125 });
    const preview = await f.shop.createPreview({
      guildId: f.guildId,
      userId: f.userId,
      characterId: f.characterId,
      itemId: "moon-blade",
      quantity: 2,
      now: NOW + 1,
    });
    const first = await f.shop.confirmPurchase({
      guildId: f.guildId, userId: f.userId, previewId: preview.previewId, now: NOW + 2,
    });
    const replay = await f.shop.confirmPurchase({
      guildId: f.guildId, userId: f.userId, previewId: preview.previewId, now: NOW + 3,
    });
    expect(replay.receiptId).toBe(first.receiptId);
    expect(first.totalGold).toBe(250);
    await expect(env.DB.prepare(
      "SELECT gold FROM character_progression_balances WHERE guild_id=? AND character_id=?",
    ).bind(f.guildId, f.characterId).first<number>("gold")).resolves.toBe(250);
    const count = await env.DB.prepare(
      "SELECT count(*) AS count FROM progression_ledger_entries WHERE guild_id=? AND idempotency_key=?",
    ).bind(f.guildId, `shop:purchase:${preview.previewId}`).first<number>("count");
    expect(count).toBe(1);

    const reversed = await f.shop.reversePurchase({
      guildId: f.guildId,
      receiptId: first.receiptId,
      actorUserId: f.adminId,
      reason: "Player selected the wrong item",
      now: NOW + 4,
    });
    expect(reversed.status).toBe("reversed");
    await expect(env.DB.prepare(
      "SELECT gold FROM character_progression_balances WHERE guild_id=? AND character_id=?",
    ).bind(f.guildId, f.characterId).first<number>("gold")).resolves.toBe(500);
  });

  it("creates zero-cost receipts and enforces once-per-character", async () => {
    const f = await fixture();
    await addItem({ ...f, itemId: "guild-map", priceGold: 0, repeatRule: "once_per_character" });
    const preview = await f.shop.createPreview({
      guildId: f.guildId, userId: f.userId, characterId: f.characterId,
      itemId: "guild-map", quantity: 1, now: NOW + 1,
    });
    const receipt = await f.shop.confirmPurchase({
      guildId: f.guildId, userId: f.userId, previewId: preview.previewId, now: NOW + 2,
    });
    expect(receipt.ledgerEntryId).toBeNull();
    await expect(f.shop.createPreview({
      guildId: f.guildId, userId: f.userId, characterId: f.characterId,
      itemId: "guild-map", quantity: 1, now: NOW + 3,
    })).rejects.toBeInstanceOf(ShopRuleError);
  });

  it("rejects stale previews after concurrent ledger activity", async () => {
    const f = await fixture();
    await addItem({ ...f, itemId: "healing-draught", priceGold: 50 });
    const preview = await f.shop.createPreview({
      guildId: f.guildId, userId: f.userId, characterId: f.characterId,
      itemId: "healing-draught", quantity: 1, now: NOW + 1,
    });
    await env.DB.prepare(
      `INSERT INTO progression_ledger_entries (
         entry_id, guild_id, character_id, season_id, entry_kind, xp_delta, gold_delta,
         actor_user_id, reason, idempotency_key, occurred_at
       ) VALUES (?, ?, ?, 'season-1', 'admin_adjustment', 0, -475, ?,
         'Concurrent admin correction', ?, ?)`,
    ).bind(`${f.prefix}:adjust`, f.guildId, f.characterId, f.adminId, `${f.prefix}:adjust`, NOW + 2).run();
    await expect(f.shop.confirmPurchase({
      guildId: f.guildId, userId: f.userId, previewId: preview.previewId, now: NOW + 3,
    })).rejects.toThrow("stale");
  });

  it("rejects a preview across a season rollover even when ledger counts match", async () => {
    const f = await fixture();
    await addItem({ ...f, itemId: "seasonal-charm", priceGold: 25 });
    const preview = await f.shop.createPreview({
      guildId: f.guildId, userId: f.userId, characterId: f.characterId,
      itemId: "seasonal-charm", quantity: 1, now: NOW + 1,
    });
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE progression_seasons SET status='closed', ended_at=?, version=version+1,
           updated_at=? WHERE guild_id=? AND season_id='season-1'`,
      ).bind(NOW + 2, NOW + 2, f.guildId),
      env.DB.prepare(
        `INSERT INTO progression_seasons (
           guild_id,season_id,name,status,starts_at,created_by_user_id,created_at,updated_at)
         VALUES (?, 'season-2', 'Season Two', 'current', ?, ?, ?, ?)`,
      ).bind(f.guildId, NOW + 2, f.adminId, NOW + 2, NOW + 2),
      env.DB.prepare(
        `INSERT INTO character_season_openings (
           opening_id,guild_id,season_id,character_id,opening_xp,opening_gold,
           policy_version,source_kind,actor_user_id,reason,idempotency_key,created_at)
         VALUES (?, ?, 'season-2', ?, 0, 500, 'shop-test-v1', 'rollover', ?,
           'Season rollover fixture', ?, ?)`,
      ).bind(
        `${f.prefix}:opening:season-2`, f.guildId, f.characterId, f.adminId,
        `${f.prefix}:opening:season-2`, NOW + 2,
      ),
    ]);
    await expect(f.shop.confirmPurchase({
      guildId: f.guildId, userId: f.userId, previewId: preview.previewId, now: NOW + 3,
    })).rejects.toThrow("stale");
  });

  it("charges a mixed free and paid cart once with immutable line snapshots", async () => {
    const f = await fixture();
    await addItem({ ...f, itemId: "guild-map", priceGold: 0 });
    await addItem({ ...f, itemId: "healing-draught", priceGold: 50 });
    const preview = await f.shop.createCartPreview({
      guildId: f.guildId,
      userId: f.userId,
      characterId: f.characterId,
      items: [
        { itemId: "guild-map", quantity: 1 },
        { itemId: "healing-draught", quantity: 2 },
      ],
      now: NOW + 1,
    });
    expect(preview).toMatchObject({ itemName: "2-item cart", totalGold: 100 });
    const receipt = await f.shop.confirmPurchase({
      guildId: f.guildId,
      userId: f.userId,
      previewId: preview.previewId,
      now: NOW + 2,
    });
    expect(receipt.totalGold).toBe(100);
    const lines = await env.DB.prepare(
      `SELECT item_id, quantity, unit_price_gold FROM shop_purchase_receipt_items
       WHERE receipt_id=? ORDER BY line_number`,
    ).bind(receipt.receiptId).all();
    expect(lines.results).toEqual([
      { item_id: "guild-map", quantity: 1, unit_price_gold: 0 },
      { item_id: "healing-draught", quantity: 2, unit_price_gold: 50 },
    ]);
  });

  it("enforces level rules and snapshots contract consumables", async () => {
    const f = await fixture();
    await addItem({
      ...f, itemId: "veteran-contract", priceGold: 40,
      minimumLevel: 4, maximumLevel: 6, contractConsumable: true,
    });
    await expect(f.shop.createPreview({
      guildId: f.guildId, userId: f.userId, characterId: f.characterId,
      itemId: "veteran-contract", quantity: 1, now: NOW + 1,
    })).rejects.toBeInstanceOf(ShopRuleError);
    await env.DB.prepare(
      `INSERT INTO progression_ledger_entries (
         entry_id,guild_id,character_id,season_id,entry_kind,xp_delta,gold_delta,
         actor_user_id,reason,idempotency_key,occurred_at)
       VALUES (?, ?, ?, 'season-1', 'admin_adjustment', 3, 0, ?,
         'Advance fixture to level four', ?, ?)`,
    ).bind(`${f.prefix}:level`, f.guildId, f.characterId, f.adminId, `${f.prefix}:level`, NOW + 2).run();
    const preview = await f.shop.createPreview({
      guildId: f.guildId, userId: f.userId, characterId: f.characterId,
      itemId: "veteran-contract", quantity: 1, now: NOW + 3,
    });
    const receipt = await f.shop.confirmPurchase({
      guildId: f.guildId, userId: f.userId, previewId: preview.previewId, now: NOW + 4,
    });
    const line = await env.DB.prepare(
      `SELECT minimum_level,maximum_level,contract_consumable
       FROM shop_purchase_receipt_items WHERE receipt_id=?`,
    ).bind(receipt.receiptId).first();
    expect(line).toEqual({
      minimum_level: 4,
      maximum_level: 6,
      contract_consumable: 1,
    });
  });

  it("enforces Artificer eligibility and publishes a bounded anonymous contract", async () => {

    const f = await fixture();
    await addItem({ ...f, itemId: "infusion-kit", priceGold: 75, eligibility: "artificer" });
    await expect(f.shop.createPreview({
      guildId: f.guildId, userId: f.userId, characterId: f.characterId,
      itemId: "infusion-kit", quantity: 1, now: NOW + 1,
    })).rejects.toBeInstanceOf(ShopRuleError);
    await f.shop.grantEligibility({
      guildId: f.guildId, characterId: f.characterId, actorUserId: f.adminId,
      reason: "Approved Artificer character", now: NOW + 2,
    });
    await expect(f.shop.createPreview({
      guildId: f.guildId, userId: f.userId, characterId: f.characterId,
      itemId: "infusion-kit", quantity: 1, now: NOW + 3,
    })).resolves.toMatchObject({ totalGold: 75 });

    const request = new Request(
      `https://example.test/api/v1/guilds/${encodeURIComponent(f.guildId)}/shop-catalog?limit=1`,
      { headers: { "cf-connecting-ip": "203.0.113.20" } },
    );
    const response = await handleShopPublicApi(request, env, NOW + 4);
    expect(response?.status).toBe(200);
    expect(response?.headers.get("cache-control")).toContain("public");
    const body = await response!.json() as Record<string, unknown>;
    expect(body.contract).toBe("shop-catalog.v1");
    expect(JSON.stringify(body)).not.toContain(f.userId);
    expect(JSON.stringify(body)).not.toContain("balance");
    expect(JSON.stringify(body)).not.toContain("receipt");
  });
});
