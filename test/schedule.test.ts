import { describe, expect, it } from "vitest";
import {
  eventKey,
  NEW_DAWN_CADENCE,
  cadenceWindows,
  validateWeeklyCadence,
  nextWeeklyOccurrence,
  occurrenceWindows,
  validateWeeklySchedule,
} from "../src/schedule";

describe("weekly scheduling", () => {
  it("returns the next occurrence in the guild time zone", () => {
    expect(
      nextWeeklyOccurrence(
        { weekday: 6, time: "18:30", timeZone: "America/Denver" },
        "2026-08-01T20:00:00Z",
      ),
    ).toBe("2026-08-02T00:30:00Z");
  });

  it("moves to the following week when this week's time is already due", () => {
    expect(
      nextWeeklyOccurrence(
        { weekday: 6, time: "18:30", timeZone: "America/Denver" },
        "2026-08-02T00:30:00Z",
      ),
    ).toBe("2026-08-09T00:30:00Z");
  });

  it("handles the spring daylight-saving boundary", () => {
    expect(
      nextWeeklyOccurrence(
        { weekday: 7, time: "02:30", timeZone: "America/Denver" },
        "2026-03-07T12:00:00Z",
      ),
    ).toBe("2026-03-08T09:30:00Z");
  });

  it("handles the fall daylight-saving boundary deterministically", () => {
    expect(
      nextWeeklyOccurrence(
        { weekday: 7, time: "01:30", timeZone: "America/Denver" },
        "2026-10-31T12:00:00Z",
      ),
    ).toBe("2026-11-01T07:30:00Z");
  });

  it("derives lifecycle windows from the event instant", () => {
    expect(
      occurrenceWindows(
        { weekday: 6, time: "18:30", timeZone: "America/Denver" },
        "2026-08-01T20:00:00Z",
        7,
        24,
        48,
      ),
    ).toEqual({
      startsAt: "2026-08-02T00:30:00Z",
      signupOpensAt: "2026-07-26T00:30:00Z",
      locksAt: "2026-08-01T00:30:00Z",
      reminderAt: "2026-07-31T00:30:00Z",
    });
  });

  it("validates time, weekday, and timezone independently", () => {
    expect(
      validateWeeklySchedule({ weekday: 0, time: "25:00", timeZone: "Mars/Olympus" }),
    ).toEqual([
      "weekday must be an integer from 1 (Monday) through 7 (Sunday)",
      "time must use 24-hour HH:mm format",
      "time zone 'Mars/Olympus' is not a valid IANA time zone",
    ]);
  });
  it("resolves the New Dawn weekly stages in America/Denver", () => {
    expect(
      cadenceWindows(NEW_DAWN_CADENCE, "2026-08-05T00:00:00Z"),
    ).toEqual({
      gmSignupOpensAt: "2026-08-05T23:00:00Z",
      playerSignupOpensAt: "2026-08-06T23:00:00Z",
      tablesPublishAt: "2026-08-08T23:00:00Z",
      openSeatingAt: "2026-08-10T23:00:00Z",
      startsAt: "2026-08-12T00:00:00Z",
    });
  });

  it("keeps local stage times stable across daylight-saving changes", () => {
    const winter = cadenceWindows(
      NEW_DAWN_CADENCE,
      "2026-01-27T00:00:00Z",
    );
    expect(winter).toEqual({
      gmSignupOpensAt: "2026-01-22T00:00:00Z",
      playerSignupOpensAt: "2026-01-23T00:00:00Z",
      tablesPublishAt: "2026-01-25T00:00:00Z",
      openSeatingAt: "2026-01-27T00:00:00Z",
      startsAt: "2026-01-28T01:00:00Z",
    });
  });

  it("rejects a cadence whose stages are out of order", () => {
    expect(
      validateWeeklyCadence({
        ...NEW_DAWN_CADENCE,
        playerSignup: { weekday: 2, time: "17:00" },
      }),
    ).toContain(
      "weekly cadence must run in this order: GM signup, player signup, table publication, open seating, game",
    );
  });


  it("creates a stable idempotency key", () => {
    expect(eventKey("guild", "2026-08-02T00:30:00Z")).toBe("guild:1785630600000");
  });
});
