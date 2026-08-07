import { GuildRepository } from "./storage/repository";
import { WebsiteReadRepository } from "./storage/website-read-repository";
import {
  WEBSITE_LIBRARY_CONTRACTS,
  WebsiteLibraryRepository,
  type WebsiteLibraryResource,
} from "./storage/website-library-repository";

const DISCORD_API = "https://discord.com/api/v10";
const MAX_AUTHORIZATION_LENGTH = 4_096;

export interface WebsiteLibraryReadOptions {
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

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization || authorization.length > MAX_AUTHORIZATION_LENGTH) return null;
  return /^Bearer ([^\s]+)$/.exec(authorization)?.[1] ?? null;
}

async function currentMember(guildId: string, token: string, fetcher: typeof fetch) {
  const response = await fetcher(`${DISCORD_API}/users/@me/guilds/${guildId}/member`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if ([401, 403, 404].includes(response.status)) return null;
  if (!response.ok) throw new Error(`Discord membership verification failed with HTTP ${response.status}`);
  const value = await response.json() as Record<string, unknown>;
  const user = value.user as Record<string, unknown> | undefined;
  return {
    userId: typeof user?.id === "string" ? user.id : null,
    roles: Array.isArray(value.roles)
      ? value.roles.filter((role): role is string => typeof role === "string")
      : [],
    pending: value.pending === true,
  };
}

async function etag(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  const encoded = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `"${encoded}"`;
}

export async function handleWebsiteLibraryReadRequest(
  request: Request,
  env: Env,
  options: WebsiteLibraryReadOptions = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  const match = /^\/api\/v1\/guilds\/(\d{1,20})\/(player-journals|historical-summaries|progression-seasons)$/.exec(
    url.pathname,
  );
  if (!match) return null;
  if (request.method !== "GET") return apiJson({ error: "method_not_allowed" }, 405, { Allow: "GET" });

  const guildId = match[1]!;
  const resource = match[2]! as WebsiteLibraryResource;
  const contract = WEBSITE_LIBRARY_CONTRACTS[resource];
  if (request.headers.get("x-guild-contract-version") !== contract) {
    return apiJson({ error: "unsupported_contract_version", supported: [contract] }, 406);
  }
  const token = bearerToken(request);
  if (!token) return apiJson({ error: "discord_oauth_required" }, 401);
  const config = await new GuildRepository(env.DB).getGuildConfig(guildId);
  if (!config) return apiJson({ error: "guild_not_found" }, 404);
  const allowedRoles = [config.reminderRoleId, config.adminRoleId].filter(
    (role): role is string => Boolean(role),
  );
  if (!allowedRoles.length) return apiJson({ error: "website_role_not_configured" }, 503);

  let member: Awaited<ReturnType<typeof currentMember>>;
  try {
    member = await currentMember(guildId, token, options.fetch ?? fetch);
  } catch (error) {
    console.error(JSON.stringify({
      kind: "guild-assistant.website-library-membership-error",
      guildId,
      resource,
      errorKind: error instanceof Error ? error.name : typeof error,
    }));
    return apiJson({ error: "membership_verification_unavailable" }, 503);
  }
  if (!member?.userId) return apiJson({ error: "not_a_current_guild_member" }, 401);
  if (member.pending || !member.roles.some((role) => allowedRoles.includes(role))) {
    return apiJson({ error: "guild_player_role_required" }, 403);
  }

  const now = options.now?.() ?? Date.now();
  const rate = await new WebsiteReadRepository(env.DB).consumeRateLimit({
    guildId,
    userId: member.userId,
    now,
  });
  if (!rate.allowed) {
    return apiJson({ error: "rate_limited" }, 429, { "Retry-After": String(rate.retryAfterSeconds) });
  }

  const limitText = url.searchParams.get("limit");
  const limit = limitText === null ? 20 : Number(limitText);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return apiJson({ error: "limit_must_be_between_1_and_50" }, 400);
  }
  const repository = new WebsiteLibraryRepository(env.DB);
  let payload: Record<string, unknown>;
  if (resource === "player-journals") {
    payload = { schemaVersion: contract, guildId, generatedAt: now,
      items: await repository.listPlayerJournals(guildId, limit) };
  } else if (resource === "historical-summaries") {
    payload = { schemaVersion: contract, guildId, generatedAt: now,
      items: await repository.listHistoricalSummaries(guildId, limit) };
  } else {
    const requestedSeason = url.searchParams.get("season")?.trim() || "current";
    if (requestedSeason.length > 80) return apiJson({ error: "season_filter_too_long" }, 400);
    const seasons = await repository.listProgressionSeasons(guildId);
    const seasonId = requestedSeason === "all" ? null
      : requestedSeason === "current"
        ? seasons.find((season) => season.status === "current")?.seasonId ?? "__missing__"
        : requestedSeason;
    if (seasonId !== null && !seasons.some((season) => season.seasonId === seasonId)) {
      return apiJson({ error: "season_not_found" }, 404);
    }
    payload = { schemaVersion: contract, guildId, generatedAt: now,
      selectedSeason: requestedSeason, seasons,
      balances: await repository.listProgressionBalances(guildId, seasonId) };
  }

  const serialized = JSON.stringify(payload);
  const validator = await etag(serialized);
  if (request.headers.get("if-none-match") === validator) {
    return new Response(null, { status: 304, headers: {
      "Cache-Control": "private, no-store", ETag: validator, Vary: "Authorization",
    } });
  }
  return new Response(serialized, { headers: {
    "Cache-Control": "private, no-store",
    "Content-Type": "application/json; charset=utf-8",
    ETag: validator,
    "X-Content-Type-Options": "nosniff",
    Vary: "Authorization",
  } });
}
