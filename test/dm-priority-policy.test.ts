import { describe, expect, it } from "vitest";
import {
  DM_PRIORITY_POLICY_VERSION,
  DM_PRIORITY_TOKENS_PER_COMPLETED_SESSION,
  allocateDmPrioritySeats,
  calculateDmPriorityExpiration,
  compareDmPriorityCredits,
  compareDmPrioritySeatRequests,
  isDmPriorityCreditEligibleForGame,
  rankDmPrioritySeatRequests,
  selectEarliestExpiringDmPriorityCredit,
  type DmPriorityCreditCandidate,
  type DmPrioritySeatRequest,
} from "../src/domain/dm-priority-policy";

const instant = (iso: string): number => Date.parse(iso);

function credit(
  creditId: string,
  earnedAt: number,
  expiresAt: number,
): DmPriorityCreditCandidate {
  return { creditId, earnedAt, expiresAt };
}

function request(
  userId: string,
  tableRequestedAt: number,
  priorityRequestedAt: number | null = null,
): DmPrioritySeatRequest {
  return { userId, tableRequestedAt, priorityRequestedAt };
}

describe("DM priority policy constants", () => {
  it("pins the policy version and exactly two earned tokens", () => {
    expect(DM_PRIORITY_POLICY_VERSION).toBe("dm-priority-v1");
    expect(DM_PRIORITY_TOKENS_PER_COMPLETED_SESSION).toBe(2);
  });
});

describe("DM priority expiration", () => {
  it("is exclusive midnight after the same-numbered local date next month", () => {
    const expiration = calculateDmPriorityExpiration(
      instant("2026-08-18T16:00:00Z"),
      "America/Denver",
    );

    expect(expiration).toEqual({
      expiresAt: instant("2026-09-19T06:00:00Z"),
      lastEligibleLocalDate: "2026-09-18",
      timeZone: "America/Denver",
    });
  });

  it("constrains a January month-end in common and leap years", () => {
    expect(
      calculateDmPriorityExpiration(
        instant("2025-01-31T19:00:00Z"),
        "America/Denver",
      ),
    ).toMatchObject({
      expiresAt: instant("2025-03-01T07:00:00Z"),
      lastEligibleLocalDate: "2025-02-28",
    });
    expect(
      calculateDmPriorityExpiration(
        instant("2024-01-31T19:00:00Z"),
        "America/Denver",
      ),
    ).toMatchObject({
      expiresAt: instant("2024-03-01T07:00:00Z"),
      lastEligibleLocalDate: "2024-02-29",
    });
  });

  it("constrains a 31st when the following month has 30 days", () => {
    expect(
      calculateDmPriorityExpiration(
        instant("2026-08-31T18:00:00Z"),
        "America/Denver",
      ),
    ).toMatchObject({
      expiresAt: instant("2026-10-01T06:00:00Z"),
      lastEligibleLocalDate: "2026-09-30",
    });
  });

  it("uses the post-transition offset across spring daylight saving", () => {
    expect(
      calculateDmPriorityExpiration(
        instant("2026-02-08T19:00:00Z"),
        "America/Denver",
      ),
    ).toMatchObject({
      expiresAt: instant("2026-03-09T06:00:00Z"),
      lastEligibleLocalDate: "2026-03-08",
    });
  });

  it("uses the post-transition offset across fall daylight saving", () => {
    expect(
      calculateDmPriorityExpiration(
        instant("2026-10-01T18:00:00Z"),
        "America/Denver",
      ),
    ).toMatchObject({
      expiresAt: instant("2026-11-02T07:00:00Z"),
      lastEligibleLocalDate: "2026-11-01",
    });
  });

  it("uses the captured time zone to choose the authoritative local date", () => {
    const earnedAt = instant("2026-08-19T05:30:00Z");
    expect(calculateDmPriorityExpiration(earnedAt, "America/Denver")).toMatchObject({
      expiresAt: instant("2026-09-19T06:00:00Z"),
      lastEligibleLocalDate: "2026-09-18",
    });
    expect(calculateDmPriorityExpiration(earnedAt, "UTC")).toMatchObject({
      expiresAt: instant("2026-09-20T00:00:00Z"),
      lastEligibleLocalDate: "2026-09-19",
    });
  });

  it.each(["", " America/Denver", "+05:00", "Mars/Olympus"])(
    "rejects non-IANA time zone %j",
    (timeZone) => {
      expect(() => calculateDmPriorityExpiration(0, timeZone)).toThrow(
        "is not a valid IANA time zone",
      );
    },
  );

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid earned timestamp %s",
    (earnedAt) => {
      expect(() => calculateDmPriorityExpiration(earnedAt, "UTC")).toThrow(
        "earnedAt must be a non-negative safe-integer timestamp",
      );
    },
  );

  it("rejects safe integers outside Temporal's supported range", () => {
    expect(() =>
      calculateDmPriorityExpiration(Number.MAX_SAFE_INTEGER, "UTC"),
    ).toThrow("earnedAt is outside the supported Temporal range");
  });
});

describe("DM priority credit eligibility and selection", () => {
  const candidate = credit("token-1", 100, 500);

  it("uses earned_at and the exclusive expiry boundary", () => {
    expect(isDmPriorityCreditEligibleForGame(candidate, 100, 499)).toBe(true);
    expect(isDmPriorityCreditEligibleForGame(candidate, 99, 499)).toBe(false);
    expect(isDmPriorityCreditEligibleForGame(candidate, 500, 500)).toBe(false);
    expect(isDmPriorityCreditEligibleForGame(candidate, 100, 500)).toBe(false);
  });

  it("requires the target game not to have started", () => {
    expect(isDmPriorityCreditEligibleForGame(candidate, 200, 199)).toBe(false);
    expect(isDmPriorityCreditEligibleForGame(candidate, 200, 200)).toBe(true);
  });

  it("orders credits by expiry, earned time, and stable credit ID", () => {
    const values = [
      credit("z", 100, 900),
      credit("a", 100, 900),
      credit("older", 50, 900),
      credit("soon", 200, 800),
    ];
    expect([...values].sort(compareDmPriorityCredits).map((value) => value.creditId)).toEqual([
      "soon",
      "older",
      "a",
      "z",
    ]);
  });

  it("selects earliest expiry without mutating the supplied credits", () => {
    const credits = [credit("later", 100, 1_000), credit("sooner", 100, 900)];
    const snapshot = [...credits];
    expect(selectEarliestExpiringDmPriorityCredit(credits, 200, 800)?.creditId).toBe(
      "sooner",
    );
    expect(credits).toEqual(snapshot);
  });

  it("skips a token that cannot cover the target game's start", () => {
    const credits = [credit("too-soon", 100, 800), credit("eligible", 100, 1_000)];
    expect(selectEarliestExpiringDmPriorityCredit(credits, 200, 900)?.creditId).toBe(
      "eligible",
    );
  });

  it("returns null when every token is expired or game-ineligible", () => {
    expect(
      selectEarliestExpiringDmPriorityCredit(
        [credit("expired", 100, 200), credit("too-soon", 150, 300)],
        250,
        350,
      ),
    ).toBeNull();
  });

  it("rejects malformed and duplicate credit records", () => {
    expect(() => compareDmPriorityCredits(credit("x", 10, 10), candidate)).toThrow(
      "expiresAt must be after earnedAt",
    );
    expect(() =>
      selectEarliestExpiringDmPriorityCredit(
        [credit("same", 1, 10), credit("same", 2, 11)],
        2,
        9,
      ),
    ).toThrow("Duplicate creditId: same");
    expect(() =>
      selectEarliestExpiringDmPriorityCredit([credit("", 1, 10)], 2, 9),
    ).toThrow("creditId cannot be empty");
  });
});

describe("DM priority seating order", () => {
  it("places every priority request before standards, then uses request time", () => {
    const requests = [
      request("standard-late", 20),
      request("priority-late", 5, 40),
      request("standard-early", 10),
      request("priority-early", 30, 35),
    ];

    expect(rankDmPrioritySeatRequests(requests).map((value) => value.userId)).toEqual([
      "priority-early",
      "priority-late",
      "standard-early",
      "standard-late",
    ]);
  });

  it("uses Discord user ID to resolve exact ties in both tiers", () => {
    const priorityA = request("100", 20, 30);
    const priorityB = request("200", 10, 30);
    const standardA = request("300", 40);
    const standardB = request("400", 40);

    expect(compareDmPrioritySeatRequests(priorityA, priorityB)).toBeLessThan(0);
    expect(compareDmPrioritySeatRequests(standardA, standardB)).toBeLessThan(0);
  });

  it("displaces exactly the lowest-ranked standard request at capacity", () => {
    const standards = Array.from({ length: 6 }, (_, index) =>
      request(`standard-${index + 1}`, index + 1),
    );
    const priority = request("priority", 10, 10);
    const allocation = allocateDmPrioritySeats([...standards, priority], 6);

    expect(allocation.assigned.map((value) => value.userId)).toEqual([
      "priority",
      "standard-1",
      "standard-2",
      "standard-3",
      "standard-4",
      "standard-5",
    ]);
    expect(allocation.waitlisted.map((value) => value.userId)).toEqual(["standard-6"]);
  });

  it("waitlists excess priority ahead of every standard request", () => {
    const allocation = allocateDmPrioritySeats(
      [
        request("standard", 1),
        request("priority-3", 2, 30),
        request("priority-1", 2, 10),
        request("priority-2", 2, 20),
      ],
      2,
    );
    expect(allocation.assigned.map((value) => value.userId)).toEqual([
      "priority-1",
      "priority-2",
    ]);
    expect(allocation.waitlisted.map((value) => value.userId)).toEqual([
      "priority-3",
      "standard",
    ]);
  });

  it("does not mutate the supplied seat requests", () => {
    const requests = [request("later", 2), request("earlier", 1)];
    const snapshot = [...requests];
    rankDmPrioritySeatRequests(requests);
    allocateDmPrioritySeats(requests, 1);
    expect(requests).toEqual(snapshot);
  });

  it("supports an empty table allocation", () => {
    expect(allocateDmPrioritySeats([request("member", 1)], 0)).toEqual({
      assigned: [],
      waitlisted: [request("member", 1)],
    });
  });

  it("rejects invalid capacity and request inputs", () => {
    expect(() => allocateDmPrioritySeats([], -1)).toThrow(
      "capacity must be a non-negative safe integer",
    );
    expect(() => allocateDmPrioritySeats([], 1.5)).toThrow(
      "capacity must be a non-negative safe integer",
    );
    expect(() => rankDmPrioritySeatRequests([request("", 1)])).toThrow(
      "userId cannot be empty",
    );
    expect(() => rankDmPrioritySeatRequests([request("member", -1)])).toThrow(
      "tableRequestedAt must be a non-negative safe-integer timestamp",
    );
    expect(() => rankDmPrioritySeatRequests([request("member", 1, 1.5)])).toThrow(
      "priorityRequestedAt must be a non-negative safe-integer timestamp",
    );
    expect(() =>
      rankDmPrioritySeatRequests([request("same", 1), request("same", 2)]),
    ).toThrow("Duplicate seat request userId: same");
  });
});
