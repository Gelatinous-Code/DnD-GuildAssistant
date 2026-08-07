import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const catalogDirectory = resolve("catalogs/2026-s4");

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("2026 S4 guild shop provenance", () => {
  it("preserves the reviewed workbook and reconciles every extracted source row", () => {
    const provenance = JSON.parse(readFileSync(
      resolve(catalogDirectory, "provenance.json"),
      "utf8",
    ));
    const sourcePath = resolve(catalogDirectory, provenance.source.file);
    const extractedPath = resolve(catalogDirectory, provenance.extractedImport.file);
    const rows = JSON.parse(readFileSync(extractedPath, "utf8"));

    expect(sha256(sourcePath)).toBe(provenance.source.sha256);
    expect(sha256(extractedPath)).toBe(provenance.extractedImport.sha256);
    expect(rows).toHaveLength(471);
    expect(new Set(rows.map((row: { Name: string }) => row.Name)).size).toBe(471);

    const classes = rows.reduce((counts: Record<string, number>, row: { Cost: string }) => {
      const priceClass = /artificer/i.test(row.Cost)
        ? "artificerOnly"
        : /free/i.test(row.Cost)
          ? "free"
          : "numericGold";
      counts[priceClass] = (counts[priceClass] ?? 0) + 1;
      return counts;
    }, {});
    expect(classes).toEqual({
      free: 168,
      numericGold: 296,
      artificerOnly: 7,
    });
  });
});
