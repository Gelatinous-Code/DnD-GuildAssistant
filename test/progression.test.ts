import { describe, expect, it } from "vitest";
import {
  goldForXp,
  LEVEL_BANDS,
  levelForXp,
  sessionXpForRole,
} from "../src/domain/progression";

describe("New Dawn progression policy", () => {
  it("maps every XP boundary to the approved level and gold award", () => {
    for (const band of LEVEL_BANDS) {
      expect(levelForXp(band.minimumXp)).toBe(band.level);
      expect(goldForXp(band.minimumXp)).toBe(band.goldPerGame);
      if (band.maximumXp !== null) {
        expect(levelForXp(band.maximumXp)).toBe(band.level);
        expect(goldForXp(band.maximumXp)).toBe(band.goldPerGame);
      }
    }
    expect(levelForXp(10_000)).toBe(10);
    expect(goldForXp(10_000)).toBe(1_000);
  });

  it("awards one XP to players and double XP to every actual DM", () => {
    expect(sessionXpForRole("player")).toBe(1);
    expect(sessionXpForRole("dm")).toBe(2);
  });
});
