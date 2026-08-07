import { GuildRepository, type GuildConfig } from "./storage/repository";
import { WebsiteReadRepository } from "./storage/website-read-repository";

const DISCORD_API = "https://discord.com/api/v10";
const MAX_AUTHORIZATION_LENGTH = 4_096;

export interface WebsiteReadOptions {
  fetch?: typeof fetch;
  now?: () => number;
}

export interface AuthorizedWebsiteMember {
  guildId: string;
  userId: string;
  isPlayer: boolean;
  isGm: boolean;
  isAdmin: boolean;
  now: number;
}

export type WebsiteAuthorizationResult =
  | { member: AuthorizedWebsiteMember; response?: never }
  | { member?: never; response: Response };

export function apiJson(body: unknown, status: number, headers: HeadersInit = {}): Response {
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

async function currentMember(guildId: string, token: string, fetcher: typeof fetch) {
  const response = await fetcher(`${DISCORD_API}/users/@me/guilds/${guildId}/member`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if ([401, 403, 404].includes(response.status)) return null;
  if (!response.ok) {
    throw new Error(`Discord membership verification failed with HTTP ${response.status}`);
  }
  const value: unknown = await response.json();
  if (!value || typeof value !== "object") throw new Error("Discord returned an invalid member");
  const user = Reflect.get(value, "user");
  const userId = user && typeof user === "object" ? Reflect.get(user, "id") : null;
  if (typeof userId !== "string" || !userId) {
    throw new Error("Discord returned a member without a user id");
  }
  return {
    userId,
    roles: stringArray(Reflect.get(value, "roles")),
    pending: Reflect.get(value, "pending") === true,
  };
}

function configuredAccess(config: GuildConfig, roles: readonly string[]) {
  return {
    isPlayer: config.reminderRoleId !== null && roles.includes(config.reminderRoleId),
    isGm: config.gmNotificationRoleId !== null
      && roles.includes(config.gmNotificationRoleId),
    isAdmin: config.adminRoleId !== null && roles.includes(config.adminRoleId),
  };
}

export async function authorizeWebsiteRead(input: {
  request: Request;
  env: Env;
  guildId: string;
  resource: string;
  options?: WebsiteReadOptions;
}): Promise<WebsiteAuthorizationResult> {
  const token = bearerToken(input.request);
  if (!token) return { response: apiJson({ error: "discord_oauth_required" }, 401) };
  const config = await new GuildRepository(input.env.DB).getGuildConfig(input.guildId);
  if (!config) return { response: apiJson({ error: "guild_not_found" }, 404) };
  const configuredRoles = [config.reminderRoleId, config.adminRoleId]
    .filter((role): role is string => Boolean(role));
  if (!configuredRoles.length) {
    return { response: apiJson({ error: "website_role_not_configured" }, 503) };
  }

  let discordMember: Awaited<ReturnType<typeof currentMember>>;
  try {
    discordMember = await currentMember(
      input.guildId,
      token,
      input.options?.fetch ?? fetch,
    );
  } catch (error) {
    console.error(JSON.stringify({
      kind: "guild-assistant.website-membership-error",
      guildId: input.guildId,
      resource: input.resource,
      errorKind: error instanceof Error ? error.name : typeof error,
    }));
    return { response: apiJson({ error: "membership_verification_unavailable" }, 503) };
  }
  if (!discordMember) {
    return { response: apiJson({ error: "not_a_current_guild_member" }, 401) };
  }
  const access = configuredAccess(config, discordMember.roles);
  if (discordMember.pending || (!access.isPlayer && !access.isAdmin)) {
    return { response: apiJson({ error: "guild_player_role_required" }, 403) };
  }

  const now = input.options?.now?.() ?? Date.now();
  const rate = await new WebsiteReadRepository(input.env.DB).consumeRateLimit({
    guildId: input.guildId,
    userId: discordMember.userId,
    now,
  });
  if (!rate.allowed) {
    return { response: apiJson({ error: "rate_limited" }, 429, {
      "Retry-After": String(rate.retryAfterSeconds),
    }) };
  }
  return {
    member: {
      guildId: input.guildId,
      userId: discordMember.userId,
      ...access,
      now,
    },
  };
}

export function viewer(member: AuthorizedWebsiteMember) {
  return {
    userId: member.userId,
    roles: [
      ...(member.isPlayer ? ["guild_player"] : []),
      ...(member.isGm ? ["gm"] : []),
      ...(member.isAdmin ? ["administrator"] : []),
    ],
    capabilities: {
      readVisibleLibrary: true,
      readOwnProgression: true,
      readModerationDiagnostics: member.isAdmin,
    },
  };
}

export async function entityTag(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  const encoded = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `"${encoded}"`;
}

export async function privateJsonWithEtag(
  request: Request,
  payload: unknown,
): Promise<Response> {
  const serialized = JSON.stringify(payload);
  const validator = await entityTag(serialized);
  if (request.headers.get("if-none-match") === validator) {
    return new Response(null, { status: 304, headers: {
      "Cache-Control": "private, no-store",
      ETag: validator,
      Vary: "Authorization",
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

export function encodeOpaqueCursor(value: unknown | null): string | null {
  if (value === null) return null;
  return btoa(JSON.stringify(value))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeOpaqueCursor(value: string | null): unknown | null {
  if (!value) return null;
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/")
      + "===".slice((value.length + 3) % 4);
    return JSON.parse(atob(padded)) as unknown;
  } catch {
    throw new TypeError("cursor is invalid");
  }
}
