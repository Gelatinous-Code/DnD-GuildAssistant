import { GuildRepository } from "./storage/repository";
import {
  WEBSITE_SUMMARY_CONTRACT_VERSION,
  WebsiteReadRepository,
  type WebsiteSummaryCursor,
} from "./storage/website-read-repository";

const DISCORD_API = "https://discord.com/api/v10";
const MAX_AUTHORIZATION_LENGTH = 4_096;

interface CurrentGuildMember {
  user?: { id?: string };
  roles?: string[];
  pending?: boolean;
}

export interface WebsiteReadOptions {
  fetch?: typeof fetch;
  now?: () => number;
}

function apiJson(body: unknown, status: number, headers: HeadersInit = {}): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      Vary: "Authorization",
      ...headers,
    },
  });
}

function decodeCursor(value: string | null): WebsiteSummaryCursor | null {
  if (!value) return null;
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
    const parsed = JSON.parse(atob(padded)) as unknown;
    if (!parsed || typeof parsed !== "object") throw new TypeError();
    const sessionEndsAt = Reflect.get(parsed, "sessionEndsAt");
    const summaryId = Reflect.get(parsed, "summaryId");
    if (!Number.isSafeInteger(sessionEndsAt) || typeof summaryId !== "string" || !summaryId) {
      throw new TypeError();
    }
    return { sessionEndsAt: sessionEndsAt as number, summaryId };
  } catch {
    throw new TypeError("cursor is invalid");
  }
}

function encodeCursor(cursor: WebsiteSummaryCursor | null): string | null {
  if (!cursor) return null;
  return btoa(JSON.stringify(cursor)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function etag(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  const encoded = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `"${encoded}"`;
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization || authorization.length > MAX_AUTHORIZATION_LENGTH) return null;
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  return match?.[1] ?? null;
}

async function currentMember(
  guildId: string,
  token: string,
  fetcher: typeof fetch,
): Promise<CurrentGuildMember | null> {
  const response = await fetcher(`${DISCORD_API}/users/@me/guilds/${guildId}/member`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 401 || response.status === 403 || response.status === 404) return null;
  if (!response.ok) throw new Error(`Discord membership verification failed with HTTP ${response.status}`);
  const value = await response.json() as unknown;
  if (!value || typeof value !== "object") throw new Error("Discord returned an invalid member");
  return {
    user: typeof Reflect.get(value, "user") === "object"
      ? { id: String(Reflect.get(Reflect.get(value, "user")!, "id") ?? "") }
      : undefined,
    roles: Array.isArray(Reflect.get(value, "roles"))
      ? Reflect.get(value, "roles")!.filter((role: unknown): role is string => typeof role === "string")
      : [],
    pending: Reflect.get(value, "pending") === true,
  };
}

export async function handleWebsiteReadRequest(
  request: Request,
  env: Env,
  options: WebsiteReadOptions = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  const match = /^\/api\/v1\/guilds\/(\d{1,20})\/session-summaries$/.exec(url.pathname);
  if (!match) return null;
  if (request.method !== "GET") return apiJson({ error: "method_not_allowed" }, 405, { Allow: "GET" });
  if (request.headers.get("x-guild-contract-version") !== WEBSITE_SUMMARY_CONTRACT_VERSION) {
    return apiJson({
      error: "unsupported_contract_version",
      supported: [WEBSITE_SUMMARY_CONTRACT_VERSION],
    }, 406);
  }

  const guildId = match[1]!;
  const token = bearerToken(request);
  if (!token) return apiJson({ error: "discord_oauth_required" }, 401);
  const config = await new GuildRepository(env.DB).getGuildConfig(guildId);
  if (!config) return apiJson({ error: "guild_not_found" }, 404);
  const allowedRoles = [config.reminderRoleId, config.adminRoleId].filter(
    (role): role is string => Boolean(role),
  );
  if (!allowedRoles.length) return apiJson({ error: "website_role_not_configured" }, 503);

  let member: CurrentGuildMember | null;
  try {
    member = await currentMember(guildId, token, options.fetch ?? fetch);
  } catch (error) {
    console.error(JSON.stringify({
      kind: "guild-assistant.website-membership-error",
      guildId,
      errorKind: error instanceof Error ? error.name : typeof error,
    }));
    return apiJson({ error: "membership_verification_unavailable" }, 503);
  }
  const userId = member?.user?.id;
  if (!member || !userId) return apiJson({ error: "not_a_current_guild_member" }, 401);
  if (member.pending || !member.roles?.some((role) => allowedRoles.includes(role))) {
    return apiJson({ error: "guild_player_role_required" }, 403);
  }

  const now = options.now?.() ?? Date.now();
  const repository = new WebsiteReadRepository(env.DB);
  const rate = await repository.consumeRateLimit({ guildId, userId, now });
  if (!rate.allowed) {
    return apiJson({ error: "rate_limited" }, 429, {
      "Retry-After": String(rate.retryAfterSeconds),
    });
  }

  try {
    const limitText = url.searchParams.get("limit");
    const limit = limitText === null ? 20 : Number(limitText);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      return apiJson({ error: "limit_must_be_between_1_and_50" }, 400);
    }
    const tierText = url.searchParams.get("tier");
    const gameTier = tierText === null ? null : Number(tierText);
    if (gameTier !== null && ![1, 2, 3].includes(gameTier)) {
      return apiJson({ error: "tier_must_be_1_2_or_3" }, 400);
    }
    const rawArea = url.searchParams.get("area")?.trim() ?? "";
    if (rawArea.length > 100) return apiJson({ error: "area_filter_too_long" }, 400);
    const page = await repository.listSessionSummaries({
      guildId,
      limit,
      cursor: decodeCursor(url.searchParams.get("cursor")),
      gameTier,
      area: rawArea || null,
    });
    const payload = {
      schemaVersion: WEBSITE_SUMMARY_CONTRACT_VERSION,
      guildId,
      generatedAt: page.items.reduce((latest, item) => Math.max(latest, item.lastSubmittedAt), 0),
      items: page.items,
      nextCursor: encodeCursor(page.nextCursor),
    };
    const serialized = JSON.stringify(payload);
    const validator = await etag(serialized);
    if (request.headers.get("if-none-match") === validator) {
      return new Response(null, {
        status: 304,
        headers: {
          "Cache-Control": "private, no-store",
          ETag: validator,
          Vary: "Authorization",
        },
      });
    }
    return new Response(serialized, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "application/json; charset=utf-8",
        ETag: validator,
        "X-Content-Type-Options": "nosniff",
        Vary: "Authorization",
      },
    });
  } catch (error) {
    if (error instanceof TypeError) return apiJson({ error: error.message }, 400);
    throw error;
  }
}
