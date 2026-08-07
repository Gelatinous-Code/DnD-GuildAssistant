import { ShopService, type ShopEligibility } from "./shop-service";

const CATALOG_PATH = /^\/api\/v1\/guilds\/([^/]+)\/shop-catalog\/?$/;
const WINDOW_MS = 60_000;
const REQUESTS_PER_WINDOW = 120;

function publicHeaders(etag?: string): Headers {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "cache-control": "public, max-age=60, stale-while-revalidate=300",
    "x-content-type-options": "nosniff",
  });
  if (etag) headers.set("etag", etag);
  return headers;
}

function response(body: unknown, status = 200, etag?: string): Response {
  return new Response(JSON.stringify(body), { status, headers: publicHeaders(etag) });
}

function encodeCursor(itemId: string): string {
  return btoa(JSON.stringify({ v: 1, itemId }))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decodeCursor(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4);
    const decoded = JSON.parse(atob(padded)) as { v?: number; itemId?: unknown };
    if (decoded.v !== 1 || typeof decoded.itemId !== "string") return undefined;
    return decoded.itemId;
  } catch {
    return undefined;
  }
}

async function clientKey(request: Request): Promise<string> {
  const address = request.headers.get("cf-connecting-ip") ?? "unknown";
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(address));
  return Array.from(new Uint8Array(bytes).slice(0, 12))
    .map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function allowed(request: Request, env: Env, guildId: string, now: number): Promise<boolean> {
  const key = await clientKey(request);
  const started = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  await env.DB.prepare(
    `INSERT INTO shop_catalog_rate_limits
     (guild_id, client_key, window_started_at, request_count)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(guild_id, client_key) DO UPDATE SET
       window_started_at = CASE
         WHEN shop_catalog_rate_limits.window_started_at = excluded.window_started_at
         THEN shop_catalog_rate_limits.window_started_at ELSE excluded.window_started_at END,
       request_count = CASE
         WHEN shop_catalog_rate_limits.window_started_at = excluded.window_started_at
         THEN shop_catalog_rate_limits.request_count + 1 ELSE 1 END`,
  ).bind(guildId, key, started).run();
  const count = await env.DB.prepare(
    `SELECT request_count FROM shop_catalog_rate_limits
     WHERE guild_id=? AND client_key=? AND window_started_at=?`,
  ).bind(guildId, key, started).first<number>("request_count");
  return (count ?? REQUESTS_PER_WINDOW + 1) <= REQUESTS_PER_WINDOW;
}

export async function handleShopPublicApi(
  request: Request,
  env: Env,
  now = Date.now(),
): Promise<Response | null> {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  const match = CATALOG_PATH.exec(url.pathname);
  if (!match) return null;
  let guildId: string;
  try {
    guildId = decodeURIComponent(match[1]!);
  } catch {
    return response({ error: "invalid_guild_id" }, 400);
  }
  if (!guildId || guildId.length > 100) return response({ error: "invalid_guild_id" }, 400);
  const shop = new ShopService(env.DB);
  const config = await shop.getConfig(guildId);
  if (!config) return response({ error: "catalog_not_found" }, 404);
  if (!(await allowed(request, env, guildId, now))) {
    const headers = publicHeaders();
    headers.set("retry-after", "60");
    return new Response(JSON.stringify({ error: "rate_limited" }), { status: 429, headers });
  }
  if (config.maintenanceMode) {
    const headers = publicHeaders();
    headers.set("retry-after", "300");
    return new Response(JSON.stringify({
      contract: "shop-catalog.v1",
      error: "maintenance",
      message: config.welcomeMessage,
    }), { status: 503, headers });
  }
  const rawLimit = Number(url.searchParams.get("limit") ?? "25");
  const limit = Number.isSafeInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 25;
  const eligibility = url.searchParams.get("eligibility");
  if (eligibility && eligibility !== "all" && eligibility !== "artificer") {
    return response({ error: "invalid_eligibility" }, 400);
  }
  const freeValue = url.searchParams.get("free");
  if (freeValue && freeValue !== "true" && freeValue !== "false") {
    return response({ error: "invalid_free_filter" }, 400);
  }
  const cursorValue = url.searchParams.get("cursor");
  const afterItemId = decodeCursor(cursorValue);
  if (cursorValue && afterItemId === undefined) return response({ error: "invalid_cursor" }, 400);
  const items = await shop.listCatalog({
    guildId,
    query: url.searchParams.get("query") ?? undefined,
    category: url.searchParams.get("category") ?? undefined,
    tag: url.searchParams.get("tag") ?? undefined,
    eligibility: eligibility as ShopEligibility | undefined,
    free: freeValue ? freeValue === "true" : undefined,
    afterItemId,
    limit: limit + 1,
  });
  const hasMore = items.length > limit;
  const page = items.slice(0, limit);
  const nextCursor = hasMore && page.length ? encodeCursor(page.at(-1)!.itemId) : null;
  const etag = `W/\"shop-${guildId}-${config.catalogRevision}-${await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(url.search),
  ).then((buffer) => Array.from(new Uint8Array(buffer).slice(0, 6))
    .map((value) => value.toString(16).padStart(2, "0")).join(""))}\"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: publicHeaders(etag) });
  }
  return response({
    contract: "shop-catalog.v1",
    guildId,
    catalogRevision: config.catalogRevision,
    lastUpdatedAt: config.updatedAt,
    shopkeeper: {
      name: config.shopkeeperName,
      welcomeMessage: config.welcomeMessage,
    },
    items: page.map((item) => ({
      itemId: item.itemId,
      name: item.name,
      source: item.source,
      category: item.category,
      description: item.description,
      rarity: item.rarity,
      requiresAttunement: item.requiresAttunement,
      damage: item.damage,
      properties: item.properties,
      mastery: item.mastery,
      tags: item.tags,
      priceGold: item.priceGold,
      free: item.priceGold === 0,
      eligibility: item.eligibility,
      repeatRule: item.repeatRule,
      maxQuantity: item.maxQuantity,
      minimumLevel: item.minimumLevel,
      maximumLevel: item.maximumLevel,
      contractConsumable: item.contractConsumable,
      itemRevision: item.itemRevision,
      discordHandoff: `/shop buy item_id:${item.itemId} character_id:<your-character-id>`,
    })),
    page: { limit, nextCursor },
  }, 200, etag);
}
