import { describe, expect, it, vi } from "vitest";
import { UserFacingError } from "../src/interaction-utils";
import {
  PriorityWorkflowService,
  type PriorityWorkflowOptions,
} from "../src/priority-workflow-service";
import type {
  Plan,
  PlanBundle,
  PlanTable,
  Signup,
  WeeklyEvent,
  GuildRepository,
} from "../src/storage/repository";
import {
  PrioritySeatingIdempotencyConflictError,
  PrioritySeatingUnavailableError,
  type PrioritySeatingAssignment,
  type PrioritySeatingEvent,
  type PrioritySeatingMutationResult,
  type PrioritySeatingRepository,
} from "../src/storage/priority-seating-repository";
import type { WeekService } from "../src/week-service";

const NOW = 10_000;

function weeklyEvent(): WeeklyEvent {
  return {
    eventId: "event-1",
    guildId: "guild-1",
    title: "Friday Adventures",
    startsAt: 30_000,
    endsAt: 40_000,
    signupOpensAt: 1_000,
    signupLocksAt: 8_000,
    tableSelectionClosesAt: 20_000,
    status: "published",
    source: "native",
    sourceExternalId: null,
    signupChannelId: "signup-channel",
    signupMessageId: "signup-message",
    tableChannelId: "table-channel",
    tableMessageId: "table-message",
    finalManifestChannelId: null,
    finalManifestMessageId: null,
    tableStateVersion: 3,
    finalizedPlanId: null,
    finalizedTableStateVersion: null,
    tablesFinalizedAt: null,
    createdByUserId: "organizer",
    createdAt: 100,
    updatedAt: 200,
    publishedAt: 300,
    archivedAt: null,
  };
}

function publishedPlan(): Plan {
  return {
    planId: "plan-1",
    eventId: "event-1",
    generation: 1,
    status: "published",
    algorithmVersion: "test-v1",
    minTableSize: 1,
    preferredTableSize: 4,
    maxTableSize: 6,
    playerCount: 3,
    gmSignupCount: 1,
    selectedGmCount: 1,
    waitlistCount: 0,
    createdByUserId: "organizer",
    createdAt: 100,
    publishedAt: 300,
  };
}

function planTable(): PlanTable {
  return {
    tableId: "table-1",
    planId: "plan-1",
    tableNumber: 1,
    title: "The Sunless Citadel",
    capacity: 2,
    gmUserId: "gm-1",
    gmDisplayName: "Game Master",
    channelId: null,
    messageId: null,
    createdAt: 100,
  };
}

function seatingAssignment(
  overrides: Partial<PrioritySeatingAssignment> = {},
): PrioritySeatingAssignment {
  return {
    assignmentId: "assignment-user-1",
    planId: "plan-1",
    tableId: null,
    desiredTableId: null,
    userId: "user-1",
    displayName: "Player One",
    status: "unassigned",
    waitlistPosition: null,
    assignedAt: null,
    updatedAt: 500,
    tableRequestedAt: null,
    priorityRequestedAt: null,
    priorityCreditId: null,
    seatRequestVersion: 7,
    ...overrides,
  };
}

function activePlayerSignup(): Signup {
  return {
    eventId: "event-1",
    userId: "user-1",
    displayName: "Player One",
    signupKind: "player",
    status: "active",
    source: "native",
    sourceExternalId: null,
    signedUpAt: 1_000,
    withdrawnAt: null,
    updatedAt: 1_000,
  };
}

function seatingEvent(
  action: "displaced" | "promoted",
  userId = "user-2",
): PrioritySeatingEvent {
  return {
    seatingEventId: `seat-event-${action}`,
    guildId: "guild-1",
    operationKey: "operation-1",
    eventId: "event-1",
    planId: "plan-1",
    tableId: "table-1",
    assignmentId: `assignment-${userId}`,
    userId,
    priorityCreditId: null,
    action,
    reasonCode: action === "displaced" ? "dm_priority_displacement" : "seat_opened",
    fromStatus: action === "displaced" ? "assigned" : "waitlisted",
    toStatus: action === "displaced" ? "waitlisted" : "assigned",
    fromWaitlistPosition: action === "displaced" ? null : 1,
    toWaitlistPosition: action === "displaced" ? 1 : null,
    actorUserId: "user-1",
    occurredAt: NOW,
  };
}

function mutation(
  assignment: PrioritySeatingAssignment | null,
  overrides: Partial<PrioritySeatingMutationResult> = {},
): PrioritySeatingMutationResult {
  return {
    applied: true,
    replayed: false,
    assignment,
    events: [],
    displaced: [],
    promoted: [],
    affectedTableIds: ["table-1"],
    priorityCreditId: assignment?.priorityCreditId ?? null,
    ...overrides,
  };
}

function harness() {
  const event = weeklyEvent();
  const plan = publishedPlan();
  const table = planTable();
  const assignment = seatingAssignment();
  const bundle: PlanBundle = {
    plan,
    tables: [table],
    assignments: [
      {
        assignmentId: assignment.assignmentId,
        planId: assignment.planId,
        tableId: assignment.tableId,
        desiredTableId: assignment.desiredTableId,
        userId: assignment.userId,
        displayName: assignment.displayName,
        status: assignment.status,
        waitlistPosition: assignment.waitlistPosition,
        assignedAt: assignment.assignedAt,
        updatedAt: assignment.updatedAt,
      },
    ],
  };
  const repository = {
    getPlan: vi.fn(async () => plan),
    getWeeklyEvent: vi.fn(async () => event),
    getSignup: vi.fn(async () => activePlayerSignup()),
    getPlanBundle: vi.fn(async () => bundle),
  };
  const seating = {
    getAssignment: vi.fn(async () => assignment),
    hasValidPriorityReservation: vi.fn(async () => false),
    selectTableWithPriority: vi.fn(),
    selectStandardTable: vi.fn(),
    releasePriority: vi.fn(),
    leaveTable: vi.fn(),
  };
  const week = {
    refreshPublishedTables: vi.fn(async () => undefined),
  };
  const notifications = {
    enqueueSeatingDecision: vi.fn(async () => undefined),
  };
  const service = new PriorityWorkflowService(
    repository as unknown as GuildRepository,
    seating as unknown as PrioritySeatingRepository,
    week as unknown as WeekService,
    {
      now: () => NOW,
      notifications: notifications as unknown as PriorityWorkflowOptions["notifications"],
    },
  );
  const input = {
    guildId: "guild-1",
    planId: "plan-1",
    tableId: "table-1",
    userId: "user-1",
  };
  return {
    service,
    repository,
    seating,
    week,
    notifications,
    event,
    plan,
    table,
    assignment,
    bundle,
    input,
  };
}

describe("PriorityWorkflowService", () => {
  it("previews without mutation and rejects a non-player signup", async () => {
    const test = harness();

    await expect(test.service.previewPriority(test.input)).resolves.toMatchObject({
      event: test.event,
      table: test.table,
      assignment: test.assignment,
      tableIsFull: false,
    });
    test.repository.getSignup.mockResolvedValueOnce({
      ...activePlayerSignup(),
      signupKind: "gm",
    });
    await expect(test.service.previewPriority(test.input)).rejects.toEqual(
      expect.objectContaining({
        message: "Sign up as a player for this game before choosing or protecting a table.",
      }),
    );
    expect(test.seating.selectTableWithPriority).not.toHaveBeenCalled();
    expect(test.seating.selectStandardTable).not.toHaveBeenCalled();
    expect(test.seating.releasePriority).not.toHaveBeenCalled();
    expect(test.seating.leaveTable).not.toHaveBeenCalled();
    expect(test.week.refreshPublishedTables).not.toHaveBeenCalled();
  });

  it("uses a stable priority operation key, refreshes cards, and enqueues displacement", async () => {
    const test = harness();
    const protectedSeat = seatingAssignment({
      tableId: "table-1",
      desiredTableId: "table-1",
      status: "assigned",
      assignedAt: NOW,
      tableRequestedAt: NOW,
      priorityRequestedAt: NOW,
      priorityCreditId: "credit-1",
      seatRequestVersion: 8,
    });
    const displaced = seatingEvent("displaced");
    test.seating.selectTableWithPriority.mockResolvedValue(
      mutation(protectedSeat, { events: [displaced], priorityCreditId: "credit-1" }),
    );

    const first = await test.service.select({ ...test.input, usePriority: true });
    const second = await test.service.select({ ...test.input, usePriority: true });

    const expectedOperation = {
      ...test.input,
      eventId: "event-1",
      actorUserId: "user-1",
      operationKey: "priority-seating:priority:plan-1:table-1:user-1:v7",
    };
    expect(test.seating.selectTableWithPriority).toHaveBeenNthCalledWith(1, expectedOperation);
    expect(test.seating.selectTableWithPriority).toHaveBeenNthCalledWith(2, expectedOperation);
    expect(test.seating.selectStandardTable).not.toHaveBeenCalled();
    expect(test.week.refreshPublishedTables).toHaveBeenCalledTimes(2);
    expect(test.week.refreshPublishedTables).toHaveBeenCalledWith(test.event, test.bundle);
    expect(test.notifications.enqueueSeatingDecision).toHaveBeenCalledWith({
      guildId: "guild-1",
      recipientUserId: "user-2",
      eventId: "event-1",
      assignmentId: "assignment-user-2",
      seatingEventId: "seat-event-displaced",
      action: "displaced",
      tableTitle: "The Sunless Citadel",
      gameTitle: "Friday Adventures",
      occurredAt: NOW,
    });
    expect(first.message).toContain("token is reserved");
    expect(second.mutation.priorityCreditId).toBe("credit-1");
  });

  it("refreshes published cards when an already-applied selection replays", async () => {
    const test = harness();
    const protectedSeat = seatingAssignment({
      tableId: "table-1",
      desiredTableId: "table-1",
      status: "assigned",
      assignedAt: NOW,
      tableRequestedAt: NOW,
      priorityRequestedAt: NOW,
      priorityCreditId: "credit-1",
      seatRequestVersion: 8,
    });
    test.seating.getAssignment.mockResolvedValue(protectedSeat);
    test.seating.hasValidPriorityReservation.mockResolvedValue(true);

    const result = await test.service.select({ ...test.input, usePriority: true });

    expect(result.mutation).toMatchObject({
      applied: false,
      replayed: true,
      priorityCreditId: "credit-1",
    });
    expect(result.message).toContain("already reserved");
    expect(test.seating.selectTableWithPriority).not.toHaveBeenCalled();
    expect(test.notifications.enqueueSeatingDecision).not.toHaveBeenCalled();
    expect(test.week.refreshPublishedTables).toHaveBeenCalledOnce();
    expect(test.week.refreshPublishedTables).toHaveBeenCalledWith(test.event, test.bundle);
  });

  it("uses each seating event's table title for cross-table notifications", async () => {
    const test = harness();
    const originTable: PlanTable = {
      ...test.table,
      tableId: "table-2",
      tableNumber: 2,
      title: "Lost Mine of Phandelver",
      gmUserId: "gm-2",
      gmDisplayName: "Origin Game Master",
    };
    test.bundle.tables.push(originTable);
    const protectedSeat = seatingAssignment({
      tableId: "table-1",
      desiredTableId: "table-1",
      status: "assigned",
      assignedAt: NOW,
      tableRequestedAt: NOW,
      priorityRequestedAt: NOW,
      priorityCreditId: "credit-1",
      seatRequestVersion: 8,
    });
    const destinationDisplacement = seatingEvent("displaced", "user-2");
    const originPromotion = {
      ...seatingEvent("promoted", "user-3"),
      tableId: originTable.tableId,
    };
    test.seating.selectTableWithPriority.mockResolvedValue(
      mutation(protectedSeat, {
        events: [destinationDisplacement, originPromotion],
        priorityCreditId: "credit-1",
      }),
    );

    await test.service.select({ ...test.input, usePriority: true });

    expect(test.notifications.enqueueSeatingDecision).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        seatingEventId: "seat-event-displaced",
        action: "displaced",
        tableTitle: "The Sunless Citadel",
      }),
    );
    expect(test.notifications.enqueueSeatingDecision).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        seatingEventId: "seat-event-promoted",
        action: "promoted",
        tableTitle: "Lost Mine of Phandelver",
      }),
    );
  });

  it("performs an ordinary selection without touching priority selection", async () => {
    const test = harness();
    const waitlisted = seatingAssignment({
      desiredTableId: "table-1",
      status: "waitlisted",
      waitlistPosition: 2,
      tableRequestedAt: NOW,
      seatRequestVersion: 8,
    });
    test.seating.selectStandardTable.mockResolvedValue(mutation(waitlisted));

    const result = await test.service.select({ ...test.input, usePriority: false });

    expect(test.seating.selectStandardTable).toHaveBeenCalledWith({
      ...test.input,
      eventId: "event-1",
      actorUserId: "user-1",
      operationKey: "priority-seating:standard:plan-1:table-1:user-1:v7",
    });
    expect(test.seating.selectTableWithPriority).not.toHaveBeenCalled();
    expect(result.message).toBe("This table is full; you are waitlisted at position 2.");
    expect(test.week.refreshPublishedTables).toHaveBeenCalledWith(test.event, test.bundle);
  });

  it("explicitly releases priority while retaining the ordinary request", async () => {
    const test = harness();
    const ordinaryRequest = seatingAssignment({
      desiredTableId: "table-1",
      status: "waitlisted",
      waitlistPosition: 1,
      tableRequestedAt: 5_000,
      seatRequestVersion: 8,
    });
    test.seating.releasePriority.mockResolvedValue(
      mutation(ordinaryRequest, { events: [seatingEvent("promoted")] }),
    );

    const result = await test.service.releasePriority({
      ...test.input,
      reason: "Player chose ordinary seating",
    });

    expect(test.seating.releasePriority).toHaveBeenCalledWith({
      guildId: "guild-1",
      eventId: "event-1",
      planId: "plan-1",
      userId: "user-1",
      actorUserId: "user-1",
      reason: "Player chose ordinary seating",
      operationKey: "priority-seating:release:plan-1:table-1:user-1:v7",
    });
    expect(result.assignment.tableRequestedAt).toBe(5_000);
    expect(result.message).toContain("keeps its original table-request time");
    expect(test.week.refreshPublishedTables).toHaveBeenCalledOnce();
    expect(test.notifications.enqueueSeatingDecision).toHaveBeenCalledWith({
      guildId: "guild-1",
      recipientUserId: "user-2",
      eventId: "event-1",
      assignmentId: "assignment-user-2",
      seatingEventId: "seat-event-promoted",
      action: "promoted",
      tableTitle: "The Sunless Citadel",
      gameTitle: "Friday Adventures",
      occurredAt: NOW,
    });
  });

  it("leaves the table with explicit token-refund messaging", async () => {
    const test = harness();
    const left = seatingAssignment({ seatRequestVersion: 8 });
    test.seating.leaveTable.mockResolvedValue(
      mutation(left, { events: [seatingEvent("promoted")] }),
    );

    const result = await test.service.leave(test.input);

    expect(test.seating.leaveTable).toHaveBeenCalledWith({
      guildId: "guild-1",
      eventId: "event-1",
      planId: "plan-1",
      userId: "user-1",
      actorUserId: "user-1",
      reason: "member left the selected table",
      operationKey: "priority-seating:leave:plan-1:table-1:user-1:v7",
    });
    expect(result.message).toBe("You left the table. Any reserved priority token was released.");
    expect(test.week.refreshPublishedTables).toHaveBeenCalledWith(test.event, test.bundle);
    expect(test.notifications.enqueueSeatingDecision).toHaveBeenCalledWith({
      guildId: "guild-1",
      recipientUserId: "user-2",
      eventId: "event-1",
      assignmentId: "assignment-user-2",
      seatingEventId: "seat-event-promoted",
      action: "promoted",
      tableTitle: "The Sunless Citadel",
      gameTitle: "Friday Adventures",
      occurredAt: NOW,
    });
  });

  it("queues seating DMs before a Discord table-card refresh can fail", async () => {
    for (const action of ["select", "leave", "release"] as const) {
      const test = harness();
      const changed = seatingAssignment({
        tableId: "table-1",
        desiredTableId: "table-1",
        status: "assigned",
        tableRequestedAt: NOW,
        priorityRequestedAt: action === "select" ? NOW : null,
        priorityCreditId: action === "select" ? "credit-1" : null,
        seatRequestVersion: 8,
      });
      const changedMutation = mutation(changed, {
        events: [seatingEvent("promoted")],
      });
      test.week.refreshPublishedTables.mockRejectedValue(
        new Error("Discord table refresh failed"),
      );

      let result: Promise<unknown>;
      if (action === "select") {
        test.seating.selectTableWithPriority.mockResolvedValue(changedMutation);
        result = test.service.select({ ...test.input, usePriority: true });
      } else if (action === "leave") {
        test.seating.leaveTable.mockResolvedValue(changedMutation);
        result = test.service.leave(test.input);
      } else {
        test.seating.releasePriority.mockResolvedValue(changedMutation);
        result = test.service.releasePriority(test.input);
      }

      await expect(result).rejects.toThrow("Discord table refresh failed");
      expect(test.notifications.enqueueSeatingDecision).toHaveBeenCalledOnce();
      expect(test.notifications.enqueueSeatingDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          seatingEventId: "seat-event-promoted",
          action: "promoted",
        }),
      );
      expect(
        test.notifications.enqueueSeatingDecision.mock.invocationCallOrder[0],
      ).toBeLessThan(test.week.refreshPublishedTables.mock.invocationCallOrder[0]!);
    }
  });

  it("rechecks exact preview state instead of bypassing a bound confirmation as a replay", async () => {
    const test = harness();
    const alreadyProtected = seatingAssignment({
      tableId: "table-1",
      desiredTableId: "table-1",
      status: "assigned",
      assignedAt: NOW,
      tableRequestedAt: NOW,
      priorityRequestedAt: NOW,
      priorityCreditId: "credit-current",
      seatRequestVersion: 9,
    });
    test.seating.getAssignment.mockResolvedValue(alreadyProtected);
    test.seating.hasValidPriorityReservation.mockResolvedValue(true);
    test.seating.selectTableWithPriority.mockRejectedValue(
      new PrioritySeatingUnavailableError(),
    );
    const confirmation = {
      previewId: "preview-1",
      expectedAssignmentId: "assignment-user-1",
      expectedSeatRequestVersion: 7,
      expectedTableStateVersion: 3,
      expectedCreditId: "credit-previewed",
    };

    const result = test.service.select({
      ...test.input,
      usePriority: true,
      confirmation,
    });

    await expect(result).rejects.toEqual(expect.objectContaining({
      message: "This confirmation preview is stale. Preview priority again before changing a seat.",
    }));
    expect(test.seating.selectTableWithPriority).toHaveBeenCalledWith({
      ...test.input,
      eventId: "event-1",
      actorUserId: "user-1",
      operationKey: "priority-seating:confirm:preview-1",
      expectedAssignmentId: "assignment-user-1",
      expectedSeatRequestVersion: 7,
      expectedTableStateVersion: 3,
      expectedCreditId: "credit-previewed",
    });
    expect(test.week.refreshPublishedTables).not.toHaveBeenCalled();
    expect(test.notifications.enqueueSeatingDecision).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "stale priority availability",
      usePriority: true,
      error: new PrioritySeatingUnavailableError(),
      message: "Your signup, token, table, or deadline changed. View priority status and retry.",
    },
    {
      label: "ordinary idempotency conflict",
      usePriority: false,
      error: new PrioritySeatingIdempotencyConflictError(),
      message: "Your table choice changed concurrently. Refresh the table card and retry.",
    },
  ])("maps $label to a user-facing retry", async ({ usePriority, error, message }) => {
    const test = harness();
    const selection = usePriority
      ? test.seating.selectTableWithPriority
      : test.seating.selectStandardTable;
    selection.mockRejectedValue(error);

    const result = test.service.select({ ...test.input, usePriority });

    await expect(result).rejects.toBeInstanceOf(UserFacingError);
    await expect(result).rejects.toEqual(expect.objectContaining({ message }));
    expect(test.week.refreshPublishedTables).not.toHaveBeenCalled();
    expect(test.notifications.enqueueSeatingDecision).not.toHaveBeenCalled();
  });
});
