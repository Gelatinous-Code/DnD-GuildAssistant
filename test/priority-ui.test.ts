import { describe, expect, it } from "vitest";
import {
  priorityUsableThroughDate,
  renderPriorityConfirmation,
  renderPriorityStatus,
  renderPriorityUseOutcome,
} from "../src/priority-ui";
import type { DmPriorityCredit } from "../src/storage/priority-repository";

function credit(
  creditId: string,
  expiresAt: number,
  earnedAt = Date.parse("2026-07-18T16:00:00Z"),
): DmPriorityCredit {
  return {
    creditId,
    grantId: `grant-${creditId}`,
    guildId: "guild",
    userId: "member",
    ordinal: 1,
    earnedAt,
    expiresAt,
    status: "available",
    targetEventId: null,
    targetAssignmentId: null,
    reservedAt: null,
    redeemedAt: null,
    lastOperationKey: null,
    version: 1,
    createdAt: earnedAt,
    updatedAt: earnedAt,
  };
}

describe("priority member UX", () => {
  it("shows the final eligible guild-local date rather than exclusive midnight", () => {
    expect(
      priorityUsableThroughDate(
        Date.parse("2026-08-19T06:00:00Z"),
        "America/Denver",
      ),
    ).toBe("August 18, 2026");
  });

  it("sorts status earliest-expiry, earned-time, then id without exposing ids", () => {
    const later = credit("z", Date.parse("2026-09-19T06:00:00Z"));
    const second = credit("b", Date.parse("2026-08-19T06:00:00Z"), 20);
    const first = credit("a", Date.parse("2026-08-19T06:00:00Z"), 10);
    const output = renderPriorityStatus([later, second, first], "America/Denver");

    expect(output).toContain("**3 tokens available**");
    expect(output.indexOf("August 18")).toBeLessThan(output.indexOf("September 18"));
    expect(output).not.toContain("grant-");
    expect(output).not.toContain("credit");
  });

  it("makes an empty status explicitly non-mutating", () => {
    expect(renderPriorityStatus([], "UTC")).toContain(
      "Viewing status never reserves or consumes a token.",
    );
  });

  it("warns privately before a full-table confirmation", () => {
    const output = renderPriorityConfirmation({
      eventTitle: "Saturday Games",
      tableTitle: "Table 1",
      balance: 2,
      creditExpiresAt: Date.parse("2026-08-19T06:00:00Z"),
      timeZone: "America/Denver",
      tableIsFull: true,
    });
    expect(output).toContain("Nothing is reserved until you press Confirm");
    expect(output).toContain("move the lowest-ranked standard request");
  });

  it("explains protected and first-tier waitlisted outcomes", () => {
    const available = [credit("remaining", Date.parse("2026-09-19T06:00:00Z"))];
    expect(
      renderPriorityUseOutcome({
        tableTitle: "Table 1",
        assigned: true,
        displaced: true,
        remainingCredits: available,
        timeZone: "America/Denver",
      }),
    ).toContain("seat at **Table 1** is protected");
    expect(
      renderPriorityUseOutcome({
        tableTitle: "Table 2",
        assigned: false,
        waitlistPosition: 1,
        displaced: false,
        remainingCredits: available,
        timeZone: "America/Denver",
      }),
    ).toContain("first-tier waitlisted at position 1");
  });
});
