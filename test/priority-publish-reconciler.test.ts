import { describe, expect, it, vi } from "vitest";
import {
  reconcilePublishedPlanPriority,
  type PriorityPublishReconciliationServices,
} from "../src/priority-publish-reconciler";
import {
  PrioritySeatingUnavailableError,
  type PrioritySeatingAssignment,
  type PrioritySeatingMutationResult,
} from "../src/storage/priority-seating-repository";
import type {
  Assignment,
  Plan,
  PlanBundle,
  WeeklyEvent,
} from "../src/storage/repository";

const NOW = 1_800_000_000_000;

function plan(
  planId: string,
  status: Plan["status"],
  generation: number,
): Plan {
  return {
    planId,
    eventId: "event-1",
    generation,
    status,
    algorithmVersion: "test",
    minTableSize: 4,
    preferredTableSize: 6,
    maxTableSize: 6,
    playerCount: 1,
    gmSignupCount: 1,
    selectedGmCount: 1,
    waitlistCount: 0,
    createdByUserId: null,
    createdAt: NOW - 10_000,
    publishedAt: status === "draft" ? null : NOW - 5_000,
  };
}

function assignment(assignmentId: string, planId: string): Assignment {
  return {
    assignmentId,
    planId,
    tableId: "table-1",
    desiredTableId: "table-1",
    userId: "user-1",
    displayName: "Player",
    status: "assigned",
    waitlistPosition: null,
    assignedAt: NOW - 4_000,
    updatedAt: NOW - 4_000,
  };
}

function seatingAssignment(
  assignmentId: string,
  planId: string,
): PrioritySeatingAssignment {
  return {
    ...assignment(assignmentId, planId),
    tableRequestedAt: NOW - 4_000,
    priorityRequestedAt: NOW - 3_000,
    priorityCreditId: "credit-1",
    seatRequestVersion: 2,
  };
}

function mutation(
  target: PrioritySeatingAssignment,
  replayed = false,
): PrioritySeatingMutationResult {
  return {
    applied: !replayed,
    replayed,
    assignment: target,
    events: [],
    displaced: [],
    promoted: [],
    affectedTableIds: ["table-1"],
    priorityCreditId: target.priorityCreditId,
  };
}

function weeklyEvent(status: WeeklyEvent["status"] = "published"): WeeklyEvent {
  return {
    eventId: "event-1",
    guildId: "guild-1",
    title: "Game Night",
    startsAt: NOW + 60_000,
    endsAt: NOW + 3_600_000,
    signupOpensAt: NOW - 100_000,
    signupLocksAt: NOW - 50_000,
    tableSelectionClosesAt: NOW + 60_000,
    status,
    source: "native",
    sourceExternalId: null,
    signupChannelId: null,
    signupMessageId: null,
    tableChannelId: "channel-1",
    tableMessageId: "message-1",
    finalManifestChannelId: null,
    finalManifestMessageId: null,
    tableStateVersion: 3,
    finalizedPlanId: null,
    finalizedTableStateVersion: null,
    tablesFinalizedAt: null,
    createdByUserId: null,
    createdAt: NOW - 200_000,
    updatedAt: NOW - 5_000,
    publishedAt: NOW - 5_000,
    archivedAt: null,
  };
}

function fixture(nextStatus: Plan["status"] = "published") {
  const event = weeklyEvent();
  const previousPlan = plan("plan-1", "superseded", 1);
  const nextPlan = plan("plan-2", nextStatus, 2);
  const previousAssignment = assignment("assignment-1", previousPlan.planId);
  const nextAssignment = assignment("assignment-2", nextPlan.planId);
  const previousBundle: PlanBundle = {
    plan: previousPlan,
    tables: [],
    assignments: [previousAssignment],
  };
  const nextBundle: PlanBundle = {
    plan: nextPlan,
    tables: [],
    assignments: [nextAssignment],
  };
  const refreshedBundle: PlanBundle = {
    ...nextBundle,
    assignments: [{ ...nextAssignment, updatedAt: NOW }],
  };
  const previousSeat = seatingAssignment(
    previousAssignment.assignmentId,
    previousPlan.planId,
  );
  const nextSeat = seatingAssignment(nextAssignment.assignmentId, nextPlan.planId);
  let nextBundleReads = 0;
  let currentPlan: Plan = nextStatus === "published" ? nextPlan : previousPlan;

  const repository = {
    getCurrentPlan: vi.fn(async () => currentPlan),
    getPlanBundle: vi.fn(async (planId: string) => {
      if (planId === previousPlan.planId) return previousBundle;
      nextBundleReads += 1;
      return nextBundleReads % 2 === 1 ? nextBundle : refreshedBundle;
    }),
    getWeeklyEvent: vi.fn(async () => event),
  };
  const seating = {
    carryForwardPriorityRequest: vi
      .fn()
      .mockResolvedValueOnce(mutation(nextSeat))
      .mockResolvedValue(mutation(nextSeat, true)),
    getAssignment: vi.fn(async (
      _guildId: string,
      planId: string,
    ) => planId === previousPlan.planId ? previousSeat : null),
    hasValidPriorityReservation: vi.fn(async () => true),
    listSupersededPriorityPlans: vi.fn(async () => [{
      planId: previousPlan.planId,
      generation: previousPlan.generation,
    }]),
    releasePriority: vi.fn(async () => mutation(previousSeat)),
  };
  const priorityRewards = {
    repairInvalidSeatingForPlan: vi.fn(async () => null),
  };
  const week = {
    refreshPublishedTables: vi.fn(async () => undefined),
  };
  const services = {
    repository,
    seating,
    priorityRewards,
    week,
  } satisfies PriorityPublishReconciliationServices;

  return {
    services,
    repository,
    seating,
    priorityRewards,
    week,
    event,
    previousPlan,
    nextPlan,
    nextBundle,
    refreshedBundle,
    previousSeat,
    setCurrentPlan(planValue: Plan) {
      currentPlan = planValue;
    },
  };
}

describe("post-publish priority reconciliation", () => {
  it("does not mutate a draft replacement plan", async () => {
    const value = fixture("draft");

    await reconcilePublishedPlanPriority(value.services, "event-1", "plan-2");

    expect(value.seating.listSupersededPriorityPlans).not.toHaveBeenCalled();
    expect(value.seating.getAssignment).not.toHaveBeenCalled();
    expect(value.seating.carryForwardPriorityRequest).not.toHaveBeenCalled();
    expect(value.priorityRewards.repairInvalidSeatingForPlan).not.toHaveBeenCalled();
    expect(value.week.refreshPublishedTables).not.toHaveBeenCalled();
  });

  it("replays a valid carry and refreshes fresh published card state", async () => {
    const value = fixture();

    await reconcilePublishedPlanPriority(value.services, "event-1", "plan-2");
    await reconcilePublishedPlanPriority(value.services, "event-1", "plan-2");

    expect(value.seating.carryForwardPriorityRequest).toHaveBeenCalledTimes(2);
    const firstInput = value.seating.carryForwardPriorityRequest.mock.calls[0]?.[0];
    const replayInput = value.seating.carryForwardPriorityRequest.mock.calls[1]?.[0];
    expect(firstInput.operationKey).toBe(
      "priority-seating:carry:plan-1:plan-2:user-1",
    );
    expect(replayInput.operationKey).toBe(firstInput.operationKey);
    expect(value.week.refreshPublishedTables).toHaveBeenNthCalledWith(
      1,
      value.event,
      value.refreshedBundle,
    );
    expect(value.week.refreshPublishedTables).toHaveBeenNthCalledWith(
      2,
      value.event,
      value.refreshedBundle,
    );
  });

  it("repairs an invalid source token without attempting to carry or release it", async () => {
    const value = fixture();
    value.seating.hasValidPriorityReservation.mockResolvedValue(false);

    await reconcilePublishedPlanPriority(value.services, "event-1", "plan-2");

    expect(value.priorityRewards.repairInvalidSeatingForPlan).toHaveBeenCalledWith({
      guildId: "guild-1",
      eventId: "event-1",
      planId: "plan-1",
      reason: "invalid priority was removed during plan regeneration",
    });
    expect(value.seating.carryForwardPriorityRequest).not.toHaveBeenCalled();
    expect(value.seating.releasePriority).not.toHaveBeenCalled();
  });

  it("system-releases a valid incompatible token even when republishing after close", async () => {
    const value = fixture();
    value.nextBundle.assignments = [];
    value.event.tableSelectionClosesAt = NOW - 1;

    await reconcilePublishedPlanPriority(value.services, "event-1", "plan-2");

    expect(value.seating.carryForwardPriorityRequest).not.toHaveBeenCalled();
    expect(value.seating.releasePriority).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: "plan-1",
        actorUserId: "system",
        allowAfterClose: true,
        operationKey: "priority-seating:republish-release:plan-1:plan-2:user-1",
      }),
    );
  });

  it("does not release a reservation when a newer publication wins the race", async () => {
    const value = fixture();
    value.seating.carryForwardPriorityRequest.mockReset();
    value.seating.carryForwardPriorityRequest.mockRejectedValue(
      new PrioritySeatingUnavailableError(),
    );
    value.repository.getCurrentPlan
      .mockResolvedValueOnce(value.nextPlan)
      .mockResolvedValue(plan("plan-3", "published", 3));

    await reconcilePublishedPlanPriority(value.services, "event-1", "plan-2");

    expect(value.priorityRewards.repairInvalidSeatingForPlan).not.toHaveBeenCalled();
    expect(value.seating.releasePriority).not.toHaveBeenCalled();
  });
});
