import { describe, expect, it } from "vitest";
import {
  ALLOWED_EVENT_TRANSITIONS,
  InvalidEventTransitionError,
  assertTransition,
  canTransition,
  getAllowedTransitions,
  nextScheduledAction,
  type EventStatus,
  type SchedulableEvent,
} from "../src/domain/event-lifecycle";

function event(
  status: EventStatus,
  overrides: Partial<SchedulableEvent> = {},
): SchedulableEvent {
  return {
    status,
    signupOpensAt: 100,
    signupLocksAt: 200,
    startsAt: 300,
    endsAt: 400,
    ...overrides,
  };
}

describe("weekly event transitions", () => {
  it("supports the complete reviewed happy path", () => {
    const path: EventStatus[] = [
      "draft",
      "open",
      "locked",
      "planned",
      "published",
      "archived",
    ];

    for (let index = 0; index < path.length - 1; index += 1) {
      expect(assertTransition(path[index], path[index + 1])).toEqual({
        from: path[index],
        to: path[index + 1],
        alreadyApplied: false,
      });
    }
  });

  it("exports the explicit allowed state changes", () => {
    expect(ALLOWED_EVENT_TRANSITIONS).toEqual({
      draft: ["open", "cancelled"],
      open: ["locked", "cancelled"],
      locked: ["planned", "cancelled"],
      planned: ["published", "archived", "cancelled"],
      published: ["archived", "cancelled"],
      archived: [],
      cancelled: [],
    });
    expect(getAllowedTransitions("planned")).toEqual([
      "published",
      "archived",
      "cancelled",
    ]);
  });

  it.each([
    "draft",
    "open",
    "locked",
    "planned",
    "published",
    "archived",
    "cancelled",
  ] as const)("treats a repeated %s transition as already applied", (status) => {
    expect(canTransition(status, status)).toBe(true);
    expect(assertTransition(status, status)).toEqual({
      from: status,
      to: status,
      alreadyApplied: true,
    });
  });

  it.each(["draft", "open", "locked", "planned", "published"] as const)(
    "allows cancellation from %s",
    (status) => {
      expect(canTransition(status, "cancelled")).toBe(true);
      expect(assertTransition(status, "cancelled").alreadyApplied).toBe(false);
    },
  );

  it("keeps archived and cancelled events terminal", () => {
    expect(canTransition("archived", "open")).toBe(false);
    expect(canTransition("cancelled", "draft")).toBe(false);
    expect(() => assertTransition("archived", "open")).toThrow(
      '"archived" is terminal; no further state changes are allowed',
    );
  });

  it("rejects skipped and backward transitions with actionable guidance", () => {
    expect(canTransition("open", "published")).toBe(false);

    try {
      assertTransition("open", "published");
      throw new Error("Expected transition to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidEventTransitionError);
      expect(error).toMatchObject({
        from: "open",
        to: "published",
        allowedNextStates: ["locked", "cancelled"],
      });
      expect((error as Error).message).toContain(
        'Retrying "open" is idempotent and is treated as already applied',
      );
    }

    expect(canTransition("planned", "locked")).toBe(false);
  });

  it("rejects unknown runtime status values clearly", () => {
    expect(canTransition("unknown" as EventStatus, "open")).toBe(false);
    expect(() => assertTransition("unknown" as EventStatus, "open")).toThrow(
      'Unknown current weekly event status: "unknown"',
    );
  });
});

describe("scheduled lifecycle actions", () => {
  it("opens a draft at the exact signup boundary", () => {
    expect(nextScheduledAction(event("draft"), 99)).toBeNull();
    expect(nextScheduledAction(event("draft"), 100)).toEqual({
      action: "open",
      from: "draft",
      to: "open",
      scheduledFor: 100,
    });
  });

  it("opens an overdue draft before attempting its overdue lock", () => {
    expect(nextScheduledAction(event("draft"), 250)).toEqual({
      action: "open",
      from: "draft",
      to: "open",
      scheduledFor: 100,
    });
  });

  it("locks an open event at the exact lock boundary", () => {
    expect(nextScheduledAction(event("open"), 199)).toBeNull();
    expect(nextScheduledAction(event("open"), 200)).toEqual({
      action: "lock",
      from: "open",
      to: "locked",
      scheduledFor: 200,
    });
  });

  it("never auto-plans or auto-publishes a locked or planned event", () => {
    expect(nextScheduledAction(event("locked"), 1_000)).toBeNull();
    expect(nextScheduledAction(event("planned"), 399)).toBeNull();
  });

  it.each(["planned", "published"] as const)(
    "archives %s cleanup at the represented end boundary",
    (status) => {
      expect(nextScheduledAction(event(status), 399)).toBeNull();
      expect(nextScheduledAction(event(status), 400)).toEqual({
        action: "archive",
        from: status,
        to: "archived",
        scheduledFor: 400,
      });
    },
  );

  it("uses start plus explicit grace when no end time is represented", () => {
    const planned = event("published", {
      endsAt: null,
      archiveGraceMs: 60,
    });

    expect(nextScheduledAction(planned, 359)).toBeNull();
    expect(nextScheduledAction(planned, 360)).toEqual({
      action: "archive",
      from: "published",
      to: "archived",
      scheduledFor: 360,
    });
  });

  it("does not invent an archive deadline", () => {
    expect(nextScheduledAction(event("published", {
      endsAt: null,
      archiveGraceMs: null,
    }), 10_000)).toBeNull();
  });

  it.each(["archived", "cancelled"] as const)(
    "does nothing for terminal %s events",
    (status) => {
      expect(nextScheduledAction(event(status), 10_000)).toBeNull();
    },
  );

  it("rejects invalid schedule ordering with a repairable error", () => {
    expect(() => nextScheduledAction(event("draft", {
      signupOpensAt: 250,
      signupLocksAt: 200,
    }), 300)).toThrow("signupOpensAt cannot be after signupLocksAt");

    expect(() => nextScheduledAction(event("open", {
      signupLocksAt: 350,
      startsAt: 300,
    }), 300)).toThrow("signupLocksAt cannot be after startsAt");

    expect(() => nextScheduledAction(event("published", {
      endsAt: 300,
    }), 300)).toThrow("endsAt must be after startsAt");
  });

  it("rejects invalid clock and cleanup values", () => {
    expect(() => nextScheduledAction(event("draft"), Number.NaN)).toThrow(
      "now must be a non-negative finite Unix timestamp",
    );
    expect(() => nextScheduledAction(event("published", {
      endsAt: null,
      archiveGraceMs: -1,
    }), 300)).toThrow("archiveGraceMs must be a non-negative finite duration");
  });
});
