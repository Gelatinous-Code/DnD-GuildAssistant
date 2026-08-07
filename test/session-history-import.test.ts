import { describe, expect, it } from "vitest";

import {
  buildHistoricalImport,
  historicalImportLifecycleSql,
  historicalImportSql,
  parseCsv,
} from "../scripts/session-history-import-lib.mjs";

const HEADER = "Put Together,Month,Day,Year,Game Date,GM Name,Game Location," +
  "Game Influence,Game Summary and Shoutouts,Players,Player Summaries Exist?," +
  "Game Date,Player Summary URL";

const CSV = HEADER + "\n" +
  'Alex 2/10,02,10,2026,2/10/2026,Alex,Novasol,No,"First line\nSecond line",' +
  '"Ada, Ben",Player Summaries Exist,2/10/2026,https://example.test/journal\n' +
  'Casey 2/17,02,17,2026,2/17/2026,  CASEY  ,Bloom,,"The party\'s return",' +
  'Ada,No Player Summaries Exist,2/17/2026,\n';

function plan(expectations = { rows: 2, dates: 2, journalLinks: 1 }) {
  return buildHistoricalImport({
    csvText: CSV,
    identityMapping: { version: "mapping-v1", mappings: { Alex: "111" } },
    guildId: "guild-1",
    seasonLabel: "Season 4",
    sourceUrl: "https://example.test/source",
    worksheetGid: "0",
    retrievedAt: Date.parse("2026-08-06T18:00:00Z"),
    actorUserId: "admin-1",
    createdAt: Date.parse("2026-08-06T18:05:00Z"),
    expectations,
  });
}

describe("historical session import", () => {
  it("parses multiline CSV with duplicate headers and preserves unmatched identities", () => {
    expect(parseCsv(CSV)).toHaveLength(3);
    const result = plan();
    expect(result.report).toMatchObject({
      valid: true,
      sourceRows: 2,
      distinctDates: 2,
      journalLinkCount: 1,
      unmatchedIdentityCount: 1,
      normalizedGmCount: 2,
    });
    expect(result.records[0]).toMatchObject({
      gameDate: "2026-02-10",
      gmUserId: "111",
      identityStatus: "matched",
      officialSummary: "First line\nSecond line",
    });
    expect(result.records[1]).toMatchObject({
      gameDate: "2026-02-17",
      gmOriginal: "CASEY",
      gmNormalized: "casey",
      gmUserId: null,
      identityStatus: "unmatched",
    });
  });

  it("fails reconciliation instead of silently dropping source rows", () => {
    const result = plan({ rows: 103, dates: 25, journalLinks: 37 });
    expect(result.report.valid).toBe(false);
    expect(result.report.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "reconciliation" }),
    ]));
    expect(() => historicalImportSql(result)).toThrow(/invalid import plan/i);
  });

  it("generates idempotent staged SQL and audited lifecycle SQL", () => {
    const result = plan();
    const sql = historicalImportSql(result);
    expect(sql).not.toContain("BEGIN TRANSACTION;");
    expect(sql).toContain("INSERT OR IGNORE INTO historical_summary_import_batches");
    expect(sql.match(/INSERT OR IGNORE INTO historical_session_records/g)).toHaveLength(2);
    expect(sql).toContain("The party''s return");
    expect(sql).toContain(result.batch.contentChecksum);
    expect(sql).not.toContain("COMMIT;");

    const rollback = historicalImportLifecycleSql({
      action: "rollback",
      guildId: "guild-1",
      batchId: result.batch.batchId,
      actorUserId: "admin-1",
      reason: "Source reconciliation needs correction",
      occurredAt: Date.parse("2026-08-06T19:00:00Z"),
    });
    expect(rollback).toContain("status = 'rolled_back'");
    expect(rollback).toContain("INSERT OR IGNORE INTO historical_import_events");
    expect(rollback).toContain("WHERE EXISTS");
    expect(rollback).toContain("action, actor_user_id");
    expect(rollback).toContain("'rolled_back'");
  });
});
