import { describe, expect, it } from "vitest";
import {
  normalizeCharacterName,
  validateCharacterSheetUrl,
  validateOpeningBalance,
} from "../src/domain/character";

describe("character input rules", () => {
  it("normalizes names and accepts secure sheet links", () => {
    expect(normalizeCharacterName("  Lady   Ember  ")).toBe("Lady Ember");
    expect(validateCharacterSheetUrl(" https://example.com/sheets/ember ")).toBe(
      "https://example.com/sheets/ember",
    );
  });

  it("rejects insecure links and invalid opening balances", () => {
    expect(() => validateCharacterSheetUrl("http://example.com/sheet")).toThrow(
      "valid https:// URL",
    );
    expect(() => validateOpeningBalance(-1, "Opening XP")).toThrow(
      "non-negative whole number",
    );
    expect(() => validateOpeningBalance(1.5, "Opening gold")).toThrow(
      "non-negative whole number",
    );
  });
});
