import {
  type CorrectDmPriorityGrantInput,
  type GrantDmSessionRewardInput,
  type PriorityService,
  type RefundDmPriorityCreditInput,
} from "./priority-service";
import type {
  CorrectPriorityGrantResult,
  GrantCompletedSessionRewardResult,
  PriorityCreditTransitionResult,
} from "./storage/priority-repository";
import type {
  PrioritySeatingMutationResult,
  PrioritySeatingRepository,
} from "./storage/priority-seating-repository";

interface PrioritySeatingRepairTarget {
  guild_id: string;
  event_id: string;
  plan_id: string;
  table_state_version: number;
}

export interface PrioritySeatingRepairContext {
  guildId: string;
  eventId: string;
  planId: string;
  mutation: PrioritySeatingMutationResult;
}

export interface PriorityRewardCoordinatorOptions {
  now?: () => number;
  afterLedgerMutation?: () => Promise<void>;
  afterSeatingRepair?: (context: PrioritySeatingRepairContext) => Promise<void>;
}

type CoordinatedPriorityService = Pick<
  PriorityService,
  | "grantCompletedSessionReward"
  | "correctGrant"
  | "refundCredit"
  | "expireDueCredits"
>;

type CoordinatedSeatingRepository = Pick<
  PrioritySeatingRepository,
  "repairInvalidPriorityAssignments"
>;

function requireLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new RangeError("limit must be an integer from 1 through 500");
  }
}

/**
 * Owns reward-ledger mutations that can invalidate an active seat request.
 *
 * The ledger is committed first and remains authoritative. A bounded repair
 * operation then clears every stale assignment and reranks its plan in one D1
 * batch. If a Worker stops between those steps, reconcileInvalidSeating()
 * discovers the stale reference without relying on the original request.
 */
export class PriorityRewardCoordinator {
  private readonly now: () => number;
  private readonly afterLedgerMutation?: () => Promise<void>;
  private readonly afterSeatingRepair?: (
    context: PrioritySeatingRepairContext,
  ) => Promise<void>;

  constructor(
    private readonly db: D1Database,
    private readonly priority: CoordinatedPriorityService,
    private readonly seating: CoordinatedSeatingRepository,
    options: PriorityRewardCoordinatorOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.afterLedgerMutation = options.afterLedgerMutation;
    this.afterSeatingRepair = options.afterSeatingRepair;
  }

  private async runSideEffect(
    label: string,
    effect: (() => Promise<void>) | undefined,
  ): Promise<void> {
    if (!effect) return;
    try {
      await effect();
    } catch (error) {
      console.error("M6 priority side effect failed after durable state committed", {
        label,
        errorType: error instanceof Error ? error.name : "unknown",
      });
    }
  }

  async grantCompletedSessionReward(
    input: GrantDmSessionRewardInput,
  ): Promise<GrantCompletedSessionRewardResult> {
    const result = await this.priority.grantCompletedSessionReward(input);
    await this.runSideEffect("ledger-notification-repair", this.afterLedgerMutation);
    return result;
  }

  private async targetsForCredit(
    guildId: string,
    creditId: string,
  ): Promise<PrioritySeatingRepairTarget[]> {
    const result = await this.db
      .prepare(
        `SELECT DISTINCT event.guild_id, event.event_id, plan.plan_id,
                event.table_state_version
         FROM assignments assignment
         JOIN plans plan ON plan.plan_id = assignment.plan_id
         JOIN weekly_events event ON event.event_id = plan.event_id
         WHERE event.guild_id = ? AND assignment.priority_credit_id = ?
           AND plan.status IN ('draft', 'published', 'superseded')
           AND event.status IN ('published', 'archived')
         ORDER BY event.event_id, plan.plan_id`,
      )
      .bind(guildId, creditId)
      .all<PrioritySeatingRepairTarget>();
    return result.results;
  }

  private async invalidTargets(
    guildId: string | undefined,
    limit: number,
  ): Promise<PrioritySeatingRepairTarget[]> {
    const guildPredicate = guildId ? "AND event.guild_id = ?" : "";
    const bindings: Array<string | number> = [];
    if (guildId) bindings.push(guildId);
    bindings.push(this.now(), limit);
    const result = await this.db
      .prepare(
        `SELECT DISTINCT event.guild_id, event.event_id, plan.plan_id,
                event.table_state_version
         FROM assignments assignment
         JOIN plans plan ON plan.plan_id = assignment.plan_id
         JOIN weekly_events event ON event.event_id = plan.event_id
         WHERE assignment.priority_credit_id IS NOT NULL
           ${guildPredicate}
           AND plan.status IN ('draft', 'published')
           AND event.status IN ('published', 'archived')
           AND NOT EXISTS (
             SELECT 1 FROM dm_priority_credits credit
             WHERE credit.credit_id = assignment.priority_credit_id
               AND credit.guild_id = event.guild_id
               AND credit.user_id = assignment.user_id
               AND credit.status = 'reserved'
               AND credit.target_event_id = event.event_id
               AND credit.expires_at > ?
           )
         ORDER BY event.guild_id, event.event_id, plan.plan_id
         LIMIT ?`,
      )
      .bind(...bindings)
      .all<PrioritySeatingRepairTarget>();
    return result.results;
  }

  private async repairTarget(
    target: PrioritySeatingRepairTarget,
    actorUserId: string,
    reason: string,
  ): Promise<PrioritySeatingMutationResult | null> {
    const mutation = await this.seating.repairInvalidPriorityAssignments({
      guildId: target.guild_id,
      eventId: target.event_id,
      planId: target.plan_id,
      actorUserId,
      reason,
      operationKey:
        "priority-seating:repair-invalid:" + target.plan_id +
        ":v" + target.table_state_version,
    });
    if (mutation) {
      await this.runSideEffect(
        "seating-refresh",
        this.afterSeatingRepair
          ? () => this.afterSeatingRepair!({
              guildId: target.guild_id,
              eventId: target.event_id,
              planId: target.plan_id,
              mutation,
            })
          : undefined,
      );
    }
    return mutation;
  }

  private async repairCredits(
    guildId: string,
    creditIds: readonly string[],
    actorUserId: string,
    reason: string,
  ): Promise<number> {
    const targets = new Map<string, PrioritySeatingRepairTarget>();
    for (const creditId of creditIds) {
      for (const target of await this.targetsForCredit(guildId, creditId)) {
        targets.set(target.plan_id, target);
      }
    }
    let repaired = 0;
    for (const target of targets.values()) {
      const mutation = await this.repairTarget(target, actorUserId, reason);
      if (mutation?.applied) repaired += 1;
    }
    return repaired;
  }

  async refundCredit(
    input: RefundDmPriorityCreditInput,
  ): Promise<PriorityCreditTransitionResult | null> {
    const result = await this.priority.refundCredit(input);
    if (result) {
      await this.repairCredits(
        input.guildId,
        [result.credit.creditId],
        input.actorUserId,
        "priority token was administratively refunded",
      );
      await this.runSideEffect("ledger-notification-repair", this.afterLedgerMutation);
    }
    return result;
  }

  async expireDueCredits(
    guildId: string,
    limit = 100,
  ): Promise<PriorityCreditTransitionResult[]> {
    const results = await this.priority.expireDueCredits(guildId, limit);
    if (results.length) {
      await this.repairCredits(
        guildId,
        results.map((result) => result.credit.creditId),
        "system",
        "priority token reached its exclusive expiry boundary",
      );
      await this.runSideEffect("ledger-notification-repair", this.afterLedgerMutation);
    }
    return results;
  }

  async correctGrant(
    input: CorrectDmPriorityGrantInput,
  ): Promise<CorrectPriorityGrantResult | null> {
    const result = await this.priority.correctGrant(input);
    if (result) {
      await this.repairCredits(
        input.guildId,
        result.credits.map((credit) => credit.creditId),
        input.actorUserId,
        "reward grant was corrected",
      );
      await this.runSideEffect("ledger-notification-repair", this.afterLedgerMutation);
    }
    return result;
  }

  async repairInvalidSeatingForPlan(input: {
    guildId: string;
    eventId: string;
    planId: string;
    actorUserId?: string;
    reason?: string;
  }): Promise<PrioritySeatingMutationResult | null> {
    const target = await this.db
      .prepare(
        `SELECT event.guild_id, event.event_id, plan.plan_id,
                event.table_state_version
         FROM plans plan
         JOIN weekly_events event ON event.event_id = plan.event_id
         WHERE event.guild_id = ? AND event.event_id = ? AND plan.plan_id = ?`,
      )
      .bind(input.guildId, input.eventId, input.planId)
      .first<PrioritySeatingRepairTarget>();
    if (!target) return null;
    return this.repairTarget(
      target,
      input.actorUserId ?? "system",
      input.reason ?? "invalid priority seating reference was reconciled",
    );
  }

  async reconcileInvalidSeating(
    limit = 50,
    guildId?: string,
  ): Promise<number> {
    requireLimit(limit);
    const targets = await this.invalidTargets(guildId, limit);
    let repaired = 0;
    for (const target of targets) {
      const mutation = await this.repairTarget(
        target,
        "system",
        "invalid priority seating reference was reconciled",
      );
      if (mutation?.applied) repaired += 1;
    }
    return repaired;
  }

  /** Backward-compatible scheduler entry point from the earlier M6 slice. */
  reconcileCorrectedSeating(limit = 50): Promise<number> {
    return this.reconcileInvalidSeating(limit);
  }
}
