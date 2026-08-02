import type { PriorityRewardCoordinator } from "./priority-reward-coordinator";
import {
  PrioritySeatingUnavailableError,
  type PrioritySeatingRepository,
} from "./storage/priority-seating-repository";
import type { GuildRepository } from "./storage/repository";
import type { WeekService } from "./week-service";

export interface PriorityPublishReconciliationServices {
  repository: Pick<
    GuildRepository,
    | "getCurrentPlan"
    | "getPlanBundle"
    | "getWeeklyEvent"
  >;
  seating: Pick<
    PrioritySeatingRepository,
    | "carryForwardPriorityRequest"
    | "getAssignment"
    | "hasValidPriorityReservation"
    | "listSupersededPriorityPlans"
    | "releasePriority"
  >;
  priorityRewards: Pick<
    PriorityRewardCoordinator,
    "repairInvalidSeatingForPlan"
  >;
  week: Pick<WeekService, "refreshPublishedTables">;
}

async function isAuthoritativePublishedPlan(
  services: PriorityPublishReconciliationServices,
  eventId: string,
  planId: string,
): Promise<boolean> {
  const current = await services.repository.getCurrentPlan(eventId);
  return current?.planId === planId && current.status === "published";
}

/**
 * Reconciles priority requests only after the replacement plan is the
 * authoritative published revision. Every mutation is independently
 * idempotent so replay can recover after a Worker or Discord failure.
 */
export async function reconcilePublishedPlanPriority(
  services: PriorityPublishReconciliationServices,
  eventId: string,
  nextPlanId: string,
): Promise<void> {
  const [event, nextBundle] = await Promise.all([
    services.repository.getWeeklyEvent(eventId),
    services.repository.getPlanBundle(nextPlanId),
  ]);
  if (
    !event ||
    event.status !== "published" ||
    !nextBundle ||
    nextBundle.plan.eventId !== eventId ||
    nextBundle.plan.planId !== nextPlanId ||
    nextBundle.plan.status !== "published" ||
    !(await isAuthoritativePublishedPlan(services, eventId, nextPlanId))
  ) {
    return;
  }

  const previousPlans = await services.seating.listSupersededPriorityPlans(
    event.guildId,
    eventId,
  );
  if (!previousPlans.length) return;
  const nextByUser = new Map(
    nextBundle.assignments.map((assignment) => [assignment.userId, assignment]),
  );
  const resolvedReservations = new Set<string>();
  let carriedAny = false;

  for (const previousPlan of previousPlans) {
    if (previousPlan.generation >= nextBundle.plan.generation) continue;
    const previousBundle = await services.repository.getPlanBundle(previousPlan.planId);
    if (
      !previousBundle ||
      previousBundle.plan.eventId !== eventId ||
      previousBundle.plan.status !== "superseded"
    ) {
      continue;
    }
    for (const previous of previousBundle.assignments) {
      const previousSeat = await services.seating.getAssignment(
        event.guildId,
        previousPlan.planId,
        previous.userId,
      );
      if (!previousSeat?.priorityCreditId) continue;
      const reservationKey = previous.userId + ":" + previousSeat.priorityCreditId;
      if (resolvedReservations.has(reservationKey)) continue;

      const sourceIsValid = await services.seating.hasValidPriorityReservation(
        event.guildId,
        eventId,
        previousPlan.planId,
        previous.userId,
        previousSeat.priorityCreditId,
      );
      if (!sourceIsValid) {
        await services.priorityRewards.repairInvalidSeatingForPlan({
          guildId: event.guildId,
          eventId,
          planId: previousPlan.planId,
          reason: "invalid priority was removed during plan regeneration",
        });
        continue;
      }

      const next = nextByUser.get(previous.userId);
      let currentHasDifferentValidReservation = false;
      if (next) {
        const currentSeat = await services.seating.getAssignment(
          event.guildId,
          nextPlanId,
          previous.userId,
        );
        if (currentSeat?.priorityCreditId) {
          const currentIsValid = await services.seating.hasValidPriorityReservation(
            event.guildId,
            eventId,
            nextPlanId,
            previous.userId,
            currentSeat.priorityCreditId,
          );
          if (
            currentIsValid &&
            currentSeat.priorityCreditId === previousSeat.priorityCreditId
          ) {
            resolvedReservations.add(reservationKey);
            carriedAny = true;
            continue;
          }
          if (currentIsValid) {
            currentHasDifferentValidReservation = true;
          } else {
            await services.priorityRewards.repairInvalidSeatingForPlan({
              guildId: event.guildId,
              eventId,
              planId: nextPlanId,
              reason: "invalid priority was removed during plan regeneration",
            });
          }
        }
      }
      let carried = false;
      if (next && !currentHasDifferentValidReservation) {
        try {
          const result = await services.seating.carryForwardPriorityRequest({
            guildId: event.guildId,
            eventId,
            previousPlanId: previousPlan.planId,
            nextPlanId,
            previousAssignmentId: previous.assignmentId,
            nextAssignmentId: next.assignmentId,
            operationKey:
              "priority-seating:carry:" + previousPlan.planId + ":" + nextPlanId + ":" +
              previous.userId,
          });
          carried =
            result.assignment?.priorityCreditId === previousSeat.priorityCreditId &&
            await services.seating.hasValidPriorityReservation(
              event.guildId,
              eventId,
              nextPlanId,
              previous.userId,
              previousSeat.priorityCreditId,
            );
        } catch (error) {
          if (!(error instanceof PrioritySeatingUnavailableError)) throw error;
        }
      }
      if (carried) {
        resolvedReservations.add(reservationKey);
        carriedAny = true;
        continue;
      }

      // A newer publication won the race. Leave the valid reservation alone so
      // that revision's reconciliation can carry it from the correct source.
      if (!(await isAuthoritativePublishedPlan(services, eventId, nextPlanId))) return;

      await services.priorityRewards.repairInvalidSeatingForPlan({
        guildId: event.guildId,
        eventId,
        planId: previousPlan.planId,
        reason: "invalid priority was removed during plan regeneration",
      });
      const latestPreviousSeat = await services.seating.getAssignment(
        event.guildId,
        previousPlan.planId,
        previous.userId,
      );
      if (!latestPreviousSeat?.priorityCreditId) continue;
      if (!(await services.seating.hasValidPriorityReservation(
        event.guildId,
        eventId,
        previousPlan.planId,
        previous.userId,
        latestPreviousSeat.priorityCreditId,
      ))) {
        await services.priorityRewards.repairInvalidSeatingForPlan({
          guildId: event.guildId,
          eventId,
          planId: previousPlan.planId,
          reason: "invalid priority was removed during plan regeneration",
        });
        continue;
      }
      await services.seating.releasePriority({
        guildId: event.guildId,
        eventId,
        planId: previousPlan.planId,
        userId: previous.userId,
        actorUserId: "system",
        reason: "published table was removed or changed during plan regeneration",
        operationKey:
          "priority-seating:republish-release:" + previousPlan.planId + ":" + nextPlanId +
          ":" + previous.userId,
        allowAfterClose: true,
      });
    }
  }

  if (!carriedAny) return;
  const [latestEvent, latestBundle, latestCurrent] = await Promise.all([
    services.repository.getWeeklyEvent(eventId),
    services.repository.getPlanBundle(nextPlanId),
    services.repository.getCurrentPlan(eventId),
  ]);
  if (
    latestEvent?.status === "published" &&
    latestBundle?.plan.status === "published" &&
    latestBundle.plan.eventId === eventId &&
    latestCurrent?.status === "published" &&
    latestCurrent.planId === nextPlanId
  ) {
    await services.week.refreshPublishedTables(latestEvent, latestBundle);
  }
}
