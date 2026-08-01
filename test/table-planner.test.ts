import { describe, expect, it } from "vitest";
import {
  compareGmPriority,
  planTables,
  rankGmCandidates,
  type GmCandidate,
  type PlayerCandidate,
} from "../src/domain/table-planner";

function players(count: number, start = 1): PlayerCandidate[] {
  return Array.from({ length: count }, (_, index) => ({
    userId: `player-${String(start + index).padStart(2, "0")}`,
    signedUpAt: start + index,
  }));
}

function gm(
  userId: string,
  overrides: Partial<GmCandidate> = {},
): GmCandidate {
  return {
    userId,
    signedUpAt: 100,
    selectionCount: 0,
    lastSelectedAt: null,
    ...overrides,
  };
}

describe("GM priority", () => {
  it("prioritizes fewer historical selections before every other factor", () => {
    const fewerSelections = gm("fewer", {
      selectionCount: 1,
      lastSelectedAt: 1_000,
      signedUpAt: 1_000,
    });
    const moreSelections = gm("more", {
      selectionCount: 2,
      lastSelectedAt: null,
      signedUpAt: 1,
    });

    expect(compareGmPriority(fewerSelections, moreSelections)).toBeLessThan(0);
  });

  it("prioritizes never selected, then the oldest last selection", () => {
    const ranked = rankGmCandidates([
      gm("recent", { selectionCount: 2, lastSelectedAt: 300 }),
      gm("never", { selectionCount: 2, lastSelectedAt: null }),
      gm("old", { selectionCount: 2, lastSelectedAt: 100 }),
    ]);

    expect(ranked.map(({ userId }) => userId)).toEqual(["never", "old", "recent"]);
  });

  it("uses signup time and then user id as stable tie-breakers", () => {
    const ranked = rankGmCandidates([
      gm("gm-c", { signedUpAt: 20 }),
      gm("gm-b", { signedUpAt: 10 }),
      gm("gm-a", { signedUpAt: 10 }),
    ]);

    expect(ranked.map(({ userId }) => userId)).toEqual(["gm-a", "gm-b", "gm-c"]);
  });
});

describe("table planning", () => {
  it("creates no tables when there are no players", () => {
    const plan = planTables({ players: [], gms: [gm("gm-1")] });

    expect(plan.tables).toEqual([]);
    expect(plan.selectedGms).toEqual([]);
    expect(plan.unselectedGms.map(({ userId }) => userId)).toEqual(["gm-1"]);
    expect(plan.waitlist).toEqual([]);
  });

  it("waitlists all players when there are no GMs", () => {
    const plan = planTables({ players: players(5), gms: [] });

    expect(plan.tables).toEqual([]);
    expect(plan.waitlist.map(({ userId }) => userId)).toEqual([
      "player-01",
      "player-02",
      "player-03",
      "player-04",
      "player-05",
    ]);
  });

  it("keeps one useful draft and flags it when fewer than four players sign up", () => {
    const plan = planTables({
      players: players(3),
      gms: [gm("lower-priority", { selectionCount: 1 }), gm("selected")],
    });

    expect(plan.tables).toHaveLength(1);
    expect(plan.tables[0]).toMatchObject({
      capacity: 3,
      isUnderfilled: true,
      isBelowPreferred: true,
    });
    expect(plan.tables[0].gm.userId).toBe("selected");
    expect(plan.unselectedGms.map(({ userId }) => userId)).toEqual(["lower-priority"]);
    expect(plan.waitlist).toEqual([]);
  });

  it.each([4, 5, 6])("creates one %i-player table", (playerCount) => {
    const plan = planTables({ players: players(playerCount), gms: [gm("gm-1")] });

    expect(plan.tables).toHaveLength(1);
    expect(plan.tables[0].capacity).toBe(playerCount);
    expect(plan.tables[0].players).toHaveLength(playerCount);
    expect(plan.tables[0].isUnderfilled).toBe(false);
    expect(plan.tables[0].isBelowPreferred).toBe(playerCount < 6);
  });

  it("uses every viable GM and balances multiple tables", () => {
    const plan = planTables({
      players: players(13),
      gms: [gm("gm-3"), gm("gm-1"), gm("gm-2")],
    });

    expect(plan.tables.map(({ capacity }) => capacity)).toEqual([5, 4, 4]);
    expect(plan.tables.map(({ gm }) => gm.userId)).toEqual(["gm-1", "gm-2", "gm-3"]);
    expect(plan.tables.map(({ players: assigned }) => assigned.map(({ userId }) => userId))).toEqual([
      ["player-01", "player-04", "player-07", "player-10", "player-13"],
      ["player-02", "player-05", "player-08", "player-11"],
      ["player-03", "player-06", "player-09", "player-12"],
    ]);
    expect(plan.waitlist).toEqual([]);
    expect(plan.rationale).toBe(
      "Selected 3 of 3 available GMs for 13 players. Planned capacities are 5, 4, 4; every player fits within available capacity.",
    );
  });

  it("does not select excess GMs when they would make a table underfilled", () => {
    const plan = planTables({
      players: players(8),
      gms: [gm("gm-4"), gm("gm-3"), gm("gm-2"), gm("gm-1")],
    });

    expect(plan.tables.map(({ capacity }) => capacity)).toEqual([4, 4]);
    expect(plan.selectedGms.map(({ userId }) => userId)).toEqual(["gm-1", "gm-2"]);
    expect(plan.unselectedGms.map(({ userId }) => userId)).toEqual(["gm-3", "gm-4"]);
  });

  it("fills available tables to six and waitlists overflow in signup order", () => {
    const unsortedPlayers = players(15).reverse();
    const plan = planTables({
      players: unsortedPlayers,
      gms: [gm("gm-1"), gm("gm-2")],
    });

    expect(plan.tables.map(({ capacity }) => capacity)).toEqual([6, 6]);
    expect(plan.waitlist.map(({ userId }) => userId)).toEqual([
      "player-13",
      "player-14",
      "player-15",
    ]);
  });

  it("is deterministic and does not mutate caller-owned signup arrays", () => {
    const originalPlayers = players(9).reverse();
    const originalGms = [gm("gm-b"), gm("gm-a")];
    const playerOrder = originalPlayers.map(({ userId }) => userId);
    const gmOrder = originalGms.map(({ userId }) => userId);

    const first = planTables({ players: originalPlayers, gms: originalGms });
    const second = planTables({ players: originalPlayers, gms: originalGms });

    expect(first).toEqual(second);
    expect(originalPlayers.map(({ userId }) => userId)).toEqual(playerOrder);
    expect(originalGms.map(({ userId }) => userId)).toEqual(gmOrder);
  });

  it("supports explicit table-size constraints", () => {
    const plan = planTables({
      players: players(6),
      gms: [gm("gm-1"), gm("gm-2")],
      constraints: {
        minPlayersPerTable: 3,
        preferredPlayersPerTable: 3,
        maxPlayersPerTable: 4,
      },
    });

    expect(plan.tables.map(({ capacity }) => capacity)).toEqual([3, 3]);
    expect(plan.tables.every(({ isUnderfilled, isBelowPreferred }) =>
      !isUnderfilled && !isBelowPreferred)).toBe(true);
  });

  it("rejects impossible constraints and duplicate signups", () => {
    expect(() => planTables({
      players: players(4),
      gms: [gm("gm-1")],
      constraints: { minPlayersPerTable: 7 },
    })).toThrow("minPlayersPerTable cannot exceed preferredPlayersPerTable");

    const duplicate = { userId: "duplicate", signedUpAt: 1 };
    expect(() => planTables({
      players: [duplicate, duplicate],
      gms: [gm("gm-1")],
    })).toThrow("Duplicate player userId: duplicate");
  });
});
