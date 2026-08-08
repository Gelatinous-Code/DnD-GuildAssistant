import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleWebsiteReadRequest } from "../../src/website-read-model";

const NOW = Date.parse("2026-09-20T18:00:00Z");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("provider read telemetry integration", () => {
  it("correlates protected success and safe failure paths without identity data", async () => {
    const events: Array<Record<string, unknown>> = [];
    for (const level of ["log", "warn", "error"] as const) {
      vi.spyOn(console, level).mockImplementation((value: unknown) => {
        events.push(value as Record<string, unknown>);
      });
    }

    const prefix = crypto.randomUUID();
    const guildId = prefix.replace(/\D/g, "").padEnd(18, "0").slice(0, 18);
    const missingGuildId = guildId.slice(0, -1) + (guildId.endsWith("9") ? "8" : "9");
    await env.DB.prepare(
      "INSERT INTO guild_config (guild_id, reminder_role_id) VALUES (?, 'role-player')",
    ).bind(guildId).run();

    const read = (input: {
      label: string;
      targetGuildId?: string;
      authorization?: boolean;
      contract?: string;
      userId?: string;
      roles?: string[];
      fetchError?: Error;
    }) => handleWebsiteReadRequest(new Request(
      `https://guild.example/api/v1/guilds/${input.targetGuildId ?? guildId}/session-summaries`
        + "?area=private-filter",
      { headers: {
        ...(input.authorization === false ? {} : { Authorization: "Bearer private-token" }),
        "X-Guild-Contract-Version": input.contract ?? "session-summaries.v1",
        "X-SDG-Correlation-ID": `case-${input.label}`,
        Cookie: "private-cookie=value",
      } },
    ), env, {
      now: () => NOW,
      fetch: async () => {
        if (input.fetchError) throw input.fetchError;
        return Response.json({
          user: { id: input.userId ?? `${prefix}:member` },
          roles: input.roles ?? ["role-player"],
          pending: false,
        });
      },
    });

    const unauthorized = await read({ label: "401", authorization: false });
    const forbidden = await read({ label: "403", roles: [] });
    const notFound = await read({ label: "404", targetGuildId: missingGuildId });
    const incompatible = await read({ label: "406", contract: "session-summaries.v0" });

    const rateUserId = `${prefix}:rate-member`;
    const bucketStartedAt = NOW - (NOW % 60_000);
    await env.DB.prepare(
      `INSERT INTO website_read_rate_limits (
         guild_id, user_id, bucket_started_at, request_count, updated_at
       ) VALUES (?, ?, ?, 120, ?)`,
    ).bind(guildId, rateUserId, bucketStartedAt, NOW).run();
    const rateLimited = await read({ label: "429", userId: rateUserId });
    const unavailable = await read({
      label: "503",
      fetchError: new Error("private membership failure details"),
    });
    const success = await read({ label: "200", userId: `${prefix}:success-member` });

    const responses = [
      unauthorized,
      forbidden,
      notFound,
      incompatible,
      rateLimited,
      unavailable,
      success,
    ];
    expect(responses.map((response) => response?.status)).toEqual([
      401, 403, 404, 406, 429, 503, 200,
    ]);
    expect(responses.map((response) => response?.headers.get("X-SDG-Correlation-ID")))
      .toEqual([
        "case-401", "case-403", "case-404", "case-406", "case-429", "case-503", "case-200",
      ]);
    expect(events.map(({ correlationId, operation, outcome, status }) => ({
      correlationId, operation, outcome, status,
    }))).toEqual([
      { correlationId: "case-401", operation: "session-summaries", outcome: "authorization_failure", status: 401 },
      { correlationId: "case-403", operation: "session-summaries", outcome: "authorization_failure", status: 403 },
      { correlationId: "case-404", operation: "session-summaries", outcome: "not_found", status: 404 },
      { correlationId: "case-406", operation: "session-summaries", outcome: "contract_incompatible", status: 406 },
      { correlationId: "case-429", operation: "session-summaries", outcome: "rate_limited", status: 429 },
      { correlationId: "case-503", operation: "session-summaries", outcome: "upstream_failure", status: 503 },
      { correlationId: "case-200", operation: "session-summaries", outcome: "success", status: 200 },
    ]);

    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("private-token");
    expect(serialized).not.toContain("private-cookie");
    expect(serialized).not.toContain(guildId);
    expect(serialized).not.toContain(prefix);
    expect(serialized).not.toContain("private-filter");
    expect(serialized).not.toContain("private membership failure details");
  });
});
