import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  buildHistoricalImport,
  historicalImportLifecycleSql,
  historicalImportSql,
} from "../../scripts/session-history-import-lib.mjs";
import { handleWebsiteLibraryReadRequest } from "../../src/website-library-read-model";

const HEADER = "Put Together,Month,Day,Year,Game Date,GM Name,Game Location," +
  "Game Influence,Game Summary and Shoutouts,Players,Player Summaries Exist?," +
  "Game Date,Player Summary URL";

describe("D1 historical session imports", () => {
  it("stages, replays, publishes, rolls back, and preserves immutable source rows", async () => {
    const prefix = crypto.randomUUID();
    const guildId = prefix.replace(/\D/g, "").padEnd(18, "0").slice(0, 18);
    const actorUserId = `${prefix}:admin`;
    const createdAt = Date.parse("2026-08-06T18:00:00Z");
    await env.DB.prepare(
      "INSERT INTO guild_config (guild_id, reminder_role_id) VALUES (?, 'role-player')",
    ).bind(guildId).run();
    const csvText = HEADER + "\n" +
      "Alex 2/10,02,10,2026,2/10/2026,Alex,Novasol,No," +
      "A concise official summary,Ada,Player Summaries Exist,2/10/2026," +
      "https://example.test/journal\n";
    const plan = buildHistoricalImport({
      csvText,
      identityMapping: { version: "map-v1", mappings: { Alex: `${prefix}:alex` } },
      guildId,
      seasonLabel: "Season 4",
      sourceUrl: "https://example.test/source",
      worksheetGid: "0",
      retrievedAt: createdAt,
      actorUserId,
      createdAt,
      expectations: { rows: 1, dates: 1, journalLinks: 1 },
    });
    expect(plan.report.valid).toBe(true);

    const sql = historicalImportSql(plan);
    await env.DB.exec(sql);
    await env.DB.exec(sql);
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM historical_summary_import_batches WHERE guild_id = ?",
    ).bind(guildId).first<number>("count")).toBe(1);
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM historical_session_records WHERE guild_id = ?",
    ).bind(guildId).first<number>("count")).toBe(1);
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM historical_import_events WHERE guild_id = ?",
    ).bind(guildId).first<number>("count")).toBe(1);

    const publishSql = historicalImportLifecycleSql({
      action: "publish",
      guildId,
      batchId: plan.batch.batchId,
      actorUserId,
      reason: "Reconciliation reviewed and approved",
      occurredAt: createdAt + 1_000,
    });
    await env.DB.exec(publishSql);
    await env.DB.exec(publishSql);
    expect(await env.DB.prepare(
      "SELECT status FROM historical_summary_import_batches WHERE batch_id = ?",
    ).bind(plan.batch.batchId).first<string>("status")).toBe("published");

    const historyFeed = await handleWebsiteLibraryReadRequest(new Request(
      `https://guild.example/api/v1/guilds/${guildId}/historical-summaries?limit=1`,
      { headers: {
        Authorization: "Bearer test-token",
        "X-Guild-Contract-Version": "historical-summaries.v1",
      } },
    ), env, {
      now: () => createdAt + 1_000,
      fetch: async () => Response.json({
        user: { id: actorUserId }, roles: ["role-player"], pending: false,
      }),
    });
    expect(historyFeed?.status).toBe(200);
    const historyBody = await historyFeed!.json() as {
      items: Array<Record<string, unknown>>;
    };
    expect(historyBody.items).toEqual([expect.objectContaining({
      season: "Season 4",
      gmName: "Alex",
      summary: "A concise official summary",
      playerJournalUrl: "https://example.test/journal",
    })]);

    const rollbackSql = historicalImportLifecycleSql({
      action: "rollback",
      guildId,
      batchId: plan.batch.batchId,
      actorUserId,
      reason: "Publication sample revealed a mapping problem",
      occurredAt: createdAt + 2_000,
    });
    await env.DB.exec(rollbackSql);
    await env.DB.exec(rollbackSql);
    expect(await env.DB.prepare(
      "SELECT status FROM historical_summary_import_batches WHERE batch_id = ?",
    ).bind(plan.batch.batchId).first<string>("status")).toBe("rolled_back");
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM historical_session_records WHERE batch_id = ?",
    ).bind(plan.batch.batchId).first<number>("count")).toBe(1);
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM historical_import_events WHERE batch_id = ?",
    ).bind(plan.batch.batchId).first<number>("count")).toBe(3);

    await expect(env.DB.prepare(
      "UPDATE historical_session_records SET official_summary = 'rewritten' WHERE batch_id = ?",
    ).bind(plan.batch.batchId).run()).rejects.toThrow(/immutable/i);
  });
});
