import { describe, expect, it } from "vitest";
import {
  goldForXp,
  LEVEL_BANDS,
  levelForXp,
  levelProgressForXp,
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

  it("projects authoritative next-level progress at every boundary", () => {
    for (const [index, band] of LEVEL_BANDS.entries()) {
      const nextBand = LEVEL_BANDS[index + 1] ?? null;
      expect(levelProgressForXp(band.minimumXp)).toEqual({
        currentLevelMinimumXp: band.minimumXp,
        nextLevel: nextBand?.level ?? null,
        nextLevelMinimumXp: nextBand?.minimumXp ?? null,
        xpIntoLevel: 0,
        xpRequiredForNextLevel: nextBand === null
          ? null
          : nextBand.minimumXp - band.minimumXp,
        xpRemaining: nextBand === null ? null : nextBand.minimumXp - band.minimumXp,
        isLevelCap: nextBand === null,
      });
      if (band.maximumXp !== null) {
        expect(levelProgressForXp(band.maximumXp)).toMatchObject({
          currentLevelMinimumXp: band.minimumXp,
          nextLevel: nextBand!.level,
          nextLevelMinimumXp: nextBand!.minimumXp,
          xpIntoLevel: band.maximumXp - band.minimumXp,
          xpRemaining: 1,
          isLevelCap: false,
        });
      }
    }
    expect(levelProgressForXp(10_000)).toMatchObject({
      currentLevelMinimumXp: 42,
      nextLevel: null,
      nextLevelMinimumXp: null,
      xpIntoLevel: 9_958,
      xpRequiredForNextLevel: null,
      xpRemaining: null,
      isLevelCap: true,
    });
  });

  it("awards one XP to players and double XP to every actual DM", () => {
    expect(sessionXpForRole("player")).toBe(1);
    expect(sessionXpForRole("dm")).toBe(2);
  });
});
