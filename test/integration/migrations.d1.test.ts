import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("D1 migrations", () => {
  it("applies the DM priority ledger schema with foreign keys intact", async () => {
    const tables = await env.DB.prepare(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table' AND name LIKE 'dm_priority_%'
       ORDER BY name ASC`,
    ).all<{ name: string }>();

    expect(tables.results.map((row) => row.name)).toEqual([
      "dm_priority_credit_events",
      "dm_priority_credits",
      "dm_priority_grants",
    ]);

    const foreignKeyViolations = await env.DB.prepare("PRAGMA foreign_key_check").all();
    expect(foreignKeyViolations.results).toEqual([]);
  });
});
