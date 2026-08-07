import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("public shop catalog contract fixture", () => {
  it("is deterministic, anonymous, and includes a Discord-only handoff", () => {
    const fixture = JSON.parse(readFileSync(
      resolve("test/fixtures/public-shop-catalog.v1.json"),
      "utf8",
    )) as {
      contract: string;
      catalogRevision: number;
      lastUpdatedAt: number;
      items: Array<Record<string, unknown>>;
    };
    expect(fixture.contract).toBe("shop-catalog.v1");
    expect(fixture.catalogRevision).toBeGreaterThan(0);
    expect(fixture.lastUpdatedAt).toBeTypeOf("number");
    expect(fixture.items[0]).toMatchObject({
      itemId: "guild-map",
      priceGold: 0,
      minimumLevel: 3,
      maximumLevel: 4,
      contractConsumable: false,
      free: true,
      discordHandoff: "/shop buy item_id:guild-map character_id:<your-character-id>",
    });
    const serialized = JSON.stringify(fixture);
    expect(serialized).not.toMatch(/userId|owner|balance|receipt|token|secret/i);
  });
});
