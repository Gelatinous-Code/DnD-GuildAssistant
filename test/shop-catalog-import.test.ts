import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("guild shop catalog importer", () => {
  it("normalizes the real Season 4 workbook vocabulary without losing restrictions", () => {
    const directory = mkdtempSync(join(tmpdir(), "shop-catalog-import-"));
    temporaryDirectories.push(directory);
    const sourcePath = join(directory, "catalog.json");
    const normalizedPath = join(directory, "normalized.json");
    const sqlPath = join(directory, "catalog.sql");
    writeFileSync(sourcePath, JSON.stringify([
      {
        Name: "Arcane Focus",
        Source: "PHB'24",
        Rarity: "none",
        Type: "Spellcasting Focus",
        Attunement: "requires attunement by a wizard",
        Text: "A focus description from the workbook.",
        Cost: "Free to Guild Adventurers with Item Proficiency",
        Tags: "Requires Attunement, Spellcasting Focus, 0",
      },
      {
        Name: "Rare Example",
        Rarity: "rare",
        Type: "Wondrous Item",
        Cost: "1,200",
        Tags: "No Attunement Required, Utility Gear, 3",
      },
      {
        Name: "Replicated Example",
        Type: "Wondrous Item",
        Cost: "Artificer Replicate Magic Item Only",
        Tags: "Artificer, 2",
      },
    ]), "utf8");

    const result = spawnSync(process.execPath, [
      resolve("scripts/import-shop-catalog.mjs"),
      sourcePath,
      "--guild", "guild-test",
      "--actor", "admin-test",
      "--mapping-revision", "shop-catalog-2026-s4-v2",
      "--normalized-out", normalizedPath,
      "--out", sqlPath,
    ], { cwd: resolve("."), encoding: "utf8" });

    expect(result.status, result.stderr).toBe(0);
    const sql = readFileSync(sqlPath, "utf8");
    expect(sql).toContain("INSERT OR IGNORE INTO shop_catalog_import_batches");
    expect(sql).not.toMatch(/\b(?:BEGIN TRANSACTION|COMMIT)\b/);
    const normalized = JSON.parse(readFileSync(normalizedPath, "utf8"));
    expect(normalized).toHaveLength(3);
    expect(normalized[0]).toMatchObject({
      itemId: "arcane-focus",
      description: "A focus description from the workbook.",
      rarity: null,
      requiresAttunement: true,
      priceGold: 0,
      eligibility: "all",
      sourcePriceClass: "free",
    });
    expect(normalized[0].tags).toEqual([
      "requires attunement",
      "spellcasting focus",
      "item proficiency required",
    ]);
    expect(normalized[1]).toMatchObject({
      priceGold: 1200,
      rarity: "rare",
      requiresAttunement: false,
      sourcePriceClass: "numeric_gold",
    });
    expect(normalized[1].tags).not.toContain("3");
    expect(normalized[2]).toMatchObject({
      priceGold: 0,
      eligibility: "artificer",
      sourcePriceClass: "artificer_only",
    });
  });
});
