import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WEBSITE_LIBRARY_CONTRACTS } from "../src/storage/website-library-repository";
import { WEBSITE_SUMMARY_CONTRACT_VERSION } from "../src/storage/website-read-repository";

type ContractManifest = {
  contractSetVersion: string;
  authentication: { gmRoleAloneGrantsAccess: boolean };
  resources: Record<string, {
    path: string;
    version: string;
    balanceFields?: string[];
    levelProgressFields?: string[];
  }>;
  excludedFields: string[];
};

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));

describe("machine-readable website contract", () => {
  it("stays aligned with the Worker contract constants", () => {
    const manifest = JSON.parse(readFileSync(
      resolve(TEST_DIRECTORY, "../contracts/website-read-models.v1.json"),
      "utf8",
    )) as ContractManifest;
    expect(manifest.contractSetVersion).toBe("website-read-models.v1");
    expect(manifest.authentication.gmRoleAloneGrantsAccess).toBe(false);
    expect(manifest.resources.sessionSummaries.version)
      .toBe(WEBSITE_SUMMARY_CONTRACT_VERSION);
    expect(manifest.resources.playerJournals.version)
      .toBe(WEBSITE_LIBRARY_CONTRACTS["player-journals"]);
    expect(manifest.resources.historicalSummaries.version)
      .toBe(WEBSITE_LIBRARY_CONTRACTS["historical-summaries"]);
    expect(manifest.resources.memberProgression.version)
      .toBe(WEBSITE_LIBRARY_CONTRACTS["progression-seasons"]);
    expect(manifest.resources.memberProgression.balanceFields).toContain("levelProgress");
    expect(manifest.resources.memberProgression.levelProgressFields).toEqual([
      "currentLevelMinimumXp",
      "nextLevel",
      "nextLevelMinimumXp",
      "xpIntoLevel",
      "xpRequiredForNextLevel",
      "xpRemaining",
      "isLevelCap",
    ]);
    expect(manifest.excludedFields).toEqual(expect.arrayContaining([
      "discord_access_token",
      "admin_actor_user_id",
      "idempotency_key",
    ]));
  });

  it("ships a deterministic member progression fixture", () => {
    const fixture = JSON.parse(readFileSync(
      resolve(TEST_DIRECTORY, "fixtures/website-member-progression.v1.json"),
      "utf8",
    )) as Record<string, unknown>;
    expect(fixture).toMatchObject({
      schemaVersion: WEBSITE_LIBRARY_CONTRACTS["progression-seasons"],
      guildId: "100000000000000001",
      nextCursor: null,
    });
    expect(JSON.stringify(fixture)).not.toContain("token");
    expect(fixture).toMatchObject({
      balances: [{
        level: 4,
        levelProgress: {
          currentLevelMinimumXp: 3,
          nextLevel: 5,
          nextLevelMinimumXp: 7,
          xpIntoLevel: 1,
          xpRequiredForNextLevel: 4,
          xpRemaining: 3,
          isLevelCap: false,
        },
      }],
    });
  });
});
