import { observeProviderRead } from "./provider-read-telemetry";
import {
  WEBSITE_SUMMARY_CONTRACT_VERSION,
  WebsiteReadRepository,
  type WebsiteSummaryCursor,
} from "./storage/website-read-repository";
import {
  apiJson,
  authorizeWebsiteRead,
  decodeOpaqueCursor,
  encodeOpaqueCursor,
  privateJsonWithEtag,
  viewer,
  type WebsiteReadOptions,
} from "./website-read-security";

export type { WebsiteReadOptions } from "./website-read-security";

function decodeCursor(value: string | null): WebsiteSummaryCursor | null {
  const parsed = decodeOpaqueCursor(value);
  if (parsed === null) return null;
  if (!parsed || typeof parsed !== "object") throw new TypeError("cursor is invalid");
  const sessionEndsAt = Reflect.get(parsed, "sessionEndsAt");
  const summaryId = Reflect.get(parsed, "summaryId");
  if (!Number.isSafeInteger(sessionEndsAt) || typeof summaryId !== "string" || !summaryId) {
    throw new TypeError("cursor is invalid");
  }
  return { sessionEndsAt: Number(sessionEndsAt), summaryId };
}

export async function handleWebsiteReadRequest(
  request: Request,
  env: Env,
  options: WebsiteReadOptions = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  const match = /^\/api\/v1\/guilds\/(\d{1,20})\/session-summaries$/.exec(url.pathname);
  if (!match) return null;
  return observeProviderRead(request, "session-summaries", async () => {
  if (request.method !== "GET") {
    return apiJson({ error: "method_not_allowed" }, 405, { Allow: "GET" });
  }
  if (request.headers.get("x-guild-contract-version") !== WEBSITE_SUMMARY_CONTRACT_VERSION) {
    return apiJson({
      error: "unsupported_contract_version",
      supported: [WEBSITE_SUMMARY_CONTRACT_VERSION],
    }, 406);
  }

  const guildId = match[1]!;
  const authorization = await authorizeWebsiteRead({
    request, env, guildId, resource: "session-summaries", options,
  });
  if (authorization.response) return authorization.response;
  const member = authorization.member;
  const repository = new WebsiteReadRepository(env.DB);

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
    const visibility = url.searchParams.get("visibility") ?? "visible";
    if (visibility !== "visible" && visibility !== "all") {
      return apiJson({ error: "visibility_must_be_visible_or_all" }, 400);
    }
    if (visibility === "all" && !member.isAdmin) {
      return apiJson({ error: "administrator_role_required" }, 403);
    }
    const page = await repository.listSessionSummaries({
      guildId,
      limit,
      cursor: decodeCursor(url.searchParams.get("cursor")),
      gameTier,
      area: rawArea || null,
      includeHidden: visibility === "all",
      includeAdminProvenance: member.isAdmin,
    });
    const payload = {
      schemaVersion: WEBSITE_SUMMARY_CONTRACT_VERSION,
      guildId,
      viewer: viewer(member),
      generatedAt: page.items.reduce(
        (latest, item) => Math.max(
          latest,
          item.lastSubmittedAt,
          ...item.corrections.map((correction) => correction.correctedAt),
        ),
        0,
      ),
      items: page.items,
      nextCursor: encodeOpaqueCursor(page.nextCursor),
    };
    return privateJsonWithEtag(request, payload);
  } catch (error) {
    if (error instanceof TypeError) return apiJson({ error: error.message }, 400);
    throw error;
  }
  }, { now: options.now });
}
