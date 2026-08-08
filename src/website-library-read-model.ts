import { observeProviderRead } from "./provider-read-telemetry";
import {
  WEBSITE_LIBRARY_CONTRACTS,
  WebsiteLibraryRepository,
  type WebsiteLibraryCursor,
  type WebsiteLibraryResource,
} from "./storage/website-library-repository";
import {
  apiJson,
  authorizeWebsiteRead,
  decodeOpaqueCursor,
  encodeOpaqueCursor,
  privateJsonWithEtag,
  viewer,
  type WebsiteReadOptions,
} from "./website-read-security";

export type WebsiteLibraryReadOptions = WebsiteReadOptions;

function decodeCursor(value: string | null, kind: "number" | "string"): WebsiteLibraryCursor | null {
  const parsed = decodeOpaqueCursor(value);
  if (parsed === null) return null;
  if (!parsed || typeof parsed !== "object") throw new TypeError("cursor is invalid");
  const sortValue = Reflect.get(parsed, "sortValue");
  const id = Reflect.get(parsed, "id");
  if (
    typeof id !== "string" || !id
    || (kind === "number" && !Number.isSafeInteger(sortValue))
    || (kind === "string" && (typeof sortValue !== "string" || !sortValue))
  ) {
    throw new TypeError("cursor is invalid");
  }
  return kind === "number"
    ? { sortValue: Number(sortValue), id }
    : { sortValue: String(sortValue), id };
}

function boundedFilter(value: string | null, maximum: number, error: string): string | null {
  const normalized = value?.trim() ?? "";
  if (normalized.length > maximum) throw new TypeError(error);
  return normalized || null;
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
  const guildId = match[1]!;
  const resource = match[2]! as WebsiteLibraryResource;
  return observeProviderRead(request, resource, async () => {
  if (request.method !== "GET") {
    return apiJson({ error: "method_not_allowed" }, 405, { Allow: "GET" });
  }
  const contract = WEBSITE_LIBRARY_CONTRACTS[resource];
  if (request.headers.get("x-guild-contract-version") !== contract) {
    return apiJson({ error: "unsupported_contract_version", supported: [contract] }, 406);
  }
  const authorization = await authorizeWebsiteRead({ request, env, guildId, resource, options });
  if (authorization.response) return authorization.response;
  const member = authorization.member;
  const repository = new WebsiteLibraryRepository(env.DB);

  try {
    const limitText = url.searchParams.get("limit");
    const limit = limitText === null ? 20 : Number(limitText);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      return apiJson({ error: "limit_must_be_between_1_and_50" }, 400);
    }
    const visibility = url.searchParams.get("visibility") ?? "visible";
    if (visibility !== "visible" && visibility !== "all") {
      return apiJson({ error: "visibility_must_be_visible_or_all" }, 400);
    }
    if (visibility === "all" && !member.isAdmin) {
      return apiJson({ error: "administrator_role_required" }, 403);
    }
    const adminDiagnostics = member.isAdmin
      ? await repository.getAdminDiagnostics(guildId)
      : undefined;

    let payload: Record<string, unknown>;
    if (resource === "player-journals") {
      const page = await repository.listPlayerJournals({
        guildId,
        limit,
        cursor: decodeCursor(url.searchParams.get("cursor"), "number"),
        characterId: boundedFilter(
          url.searchParams.get("character_id"), 200, "character_filter_too_long",
        ),
        eventId: boundedFilter(url.searchParams.get("event_id"), 200, "event_filter_too_long"),
        includeHidden: visibility === "all",
      });
      payload = {
        schemaVersion: contract,
        guildId,
        viewer: viewer(member),
        generatedAt: page.items.reduce(
          (latest, item) => Math.max(latest, item.lastSubmittedAt, item.moderation?.hiddenAt ?? 0),
          0,
        ),
        items: page.items,
        nextCursor: encodeOpaqueCursor(page.nextCursor),
        ...(adminDiagnostics ? { adminDiagnostics } : {}),
      };
    } else if (resource === "historical-summaries") {
      const page = await repository.listHistoricalSummaries({
        guildId,
        limit,
        cursor: decodeCursor(url.searchParams.get("cursor"), "string"),
        season: boundedFilter(url.searchParams.get("season"), 80, "season_filter_too_long"),
      });
      payload = {
        schemaVersion: contract,
        guildId,
        viewer: viewer(member),
        generatedAt: 0,
        items: page.items,
        nextCursor: encodeOpaqueCursor(page.nextCursor),
        ...(adminDiagnostics ? { adminDiagnostics } : {}),
      };
    } else {
      const requestedSeason = url.searchParams.get("season")?.trim() || "current";
      if (requestedSeason.length > 80) {
        return apiJson({ error: "season_filter_too_long" }, 400);
      }
      const requestedCharacterId = boundedFilter(
        url.searchParams.get("character_id"), 200, "character_filter_too_long",
      );
      const seasons = await repository.listProgressionSeasons(guildId);
      const seasonId = requestedSeason === "all" ? null
        : requestedSeason === "current"
          ? seasons.find((season) => season.status === "current")?.seasonId ?? "__missing__"
          : requestedSeason;
      if (seasonId !== null && !seasons.some((season) => season.seasonId === seasonId)) {
        return apiJson({ error: "season_not_found" }, 404);
      }
      const characters = await repository.listMemberCharacters(guildId, member.userId);
      if (
        requestedCharacterId !== null
        && !characters.some((character) => character.characterId === requestedCharacterId)
      ) {
        return apiJson({ error: "character_not_found" }, 404);
      }
      const history = await repository.listProgressionHistory({
        guildId,
        ownerUserId: member.userId,
        limit,
        cursor: decodeCursor(url.searchParams.get("cursor"), "number"),
        seasonId,
        characterId: requestedCharacterId,
      });
      const balances = await repository.listProgressionBalances({
        guildId,
        ownerUserId: member.userId,
        seasonId,
        characterId: requestedCharacterId,
      });
      payload = {
        schemaVersion: contract,
        guildId,
        viewer: viewer(member),
        generatedAt: Math.max(
          ...characters.map((character) => character.updatedAt),
          ...history.items.map((entry) => entry.occurredAt),
          0,
        ),
        selectedSeason: requestedSeason,
        selectedCharacterId: requestedCharacterId,
        seasons,
        characters,
        balances,
        history: history.items,
        nextCursor: encodeOpaqueCursor(history.nextCursor),
        ...(adminDiagnostics ? { adminDiagnostics } : {}),
      };
    }
    return privateJsonWithEtag(request, payload);
  } catch (error) {
    if (error instanceof TypeError) return apiJson({ error: error.message }, 400);
    throw error;
  }
  }, { now: options.now });
}
