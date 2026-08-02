import {
  DM_PRIORITY_POLICY_VERSION,
  DM_PRIORITY_TOKENS_PER_COMPLETED_SESSION,
  calculateDmPriorityExpiration,
} from "./domain/dm-priority-policy";
import type {
  CorrectPriorityGrantResult,
  DmPriorityCredit,
  GrantCompletedSessionRewardResult,
  PriorityCreditTransitionResult,
  PriorityRepository,
} from "./storage/priority-repository";

export type PriorityServiceRepository = Pick<
  PriorityRepository,
  | "grantCompletedSessionReward"
  | "listAvailableCredits"
  | "reserveNextCredit"
  | "redeemReservedCredit"
  | "refundCredit"
  | "listDueCredits"
  | "expireCredit"
  | "correctGrant"
>;

export interface PriorityServiceOptions {
  now?: () => number;
  id?: () => string;
}

export interface GrantDmSessionRewardInput {
  guildId: string;
  completionRevisionId: string;
  sourceEventId: string;
  sourcePlanId: string;
  sourceTableId: string;
  dmUserId: string;
  grantedByUserId: string;
  earnedTimeZone: string;
  idempotencyKey: string;
}

export interface ReserveDmPriorityCreditInput {
  guildId: string;
  userId: string;
  targetEventId: string;
  idempotencyKey: string;
}

export interface RedeemDmPriorityCreditInput {
  guildId: string;
  userId: string;
  creditId: string;
  targetEventId: string;
  targetAssignmentId: string;
  idempotencyKey: string;
}

export interface RefundDmPriorityCreditInput {
  guildId: string;
  userId: string;
  creditId: string;
  targetEventId: string;
  targetAssignmentId?: string | null;
  actorUserId: string;
  reason: string;
  idempotencyKey: string;
}

export interface CorrectDmPriorityGrantInput {
  guildId: string;
  grantId: string;
  actorUserId: string;
  reason: string;
  idempotencyKey: string;
}

function defaultId(): string {
  return crypto.randomUUID();
}

function requireIdentifier(value: string, fieldName: string): void {
  if (!value.trim()) throw new TypeError(`${fieldName} cannot be empty`);
}

export class PriorityService {
  private readonly now: () => number;
  private readonly id: () => string;

  constructor(
    private readonly repository: PriorityServiceRepository,
    options: PriorityServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.id = options.id ?? defaultId;
  }

  async grantCompletedSessionReward(
    input: GrantDmSessionRewardInput,
  ): Promise<GrantCompletedSessionRewardResult> {
    requireIdentifier(input.guildId, "guildId");
    requireIdentifier(input.completionRevisionId, "completionRevisionId");
    requireIdentifier(input.dmUserId, "dmUserId");
    requireIdentifier(input.idempotencyKey, "idempotencyKey");
    if (DM_PRIORITY_TOKENS_PER_COMPLETED_SESSION !== 2) {
      throw new Error("The persistence contract requires exactly two DM priority credits");
    }

    const earnedAt = this.now();
    const expiration = calculateDmPriorityExpiration(earnedAt, input.earnedTimeZone);
    return this.repository.grantCompletedSessionReward({
      grantId: this.id(),
      creditIds: [this.id(), this.id()],
      guildId: input.guildId,
      completionRevisionId: input.completionRevisionId,
      sourceEventId: input.sourceEventId,
      sourcePlanId: input.sourcePlanId,
      sourceTableId: input.sourceTableId,
      dmUserId: input.dmUserId,
      policyVersion: DM_PRIORITY_POLICY_VERSION,
      earnedTimeZone: expiration.timeZone,
      earnedAt,
      expiresAt: expiration.expiresAt,
      grantedByUserId: input.grantedByUserId,
      idempotencyKey: input.idempotencyKey,
    });
  }

  async listAvailableCredits(
    guildId: string,
    userId: string,
  ): Promise<DmPriorityCredit[]> {
    return this.repository.listAvailableCredits(guildId, userId, this.now());
  }

  async reserveNextCredit(
    input: ReserveDmPriorityCreditInput,
  ): Promise<PriorityCreditTransitionResult | null> {
    const reservedAt = this.now();
    return this.repository.reserveNextCredit({
      creditEventId: this.id(),
      guildId: input.guildId,
      userId: input.userId,
      targetEventId: input.targetEventId,
      reservedAt,
      actorUserId: input.userId,
      idempotencyKey: input.idempotencyKey,
    });
  }

  async redeemReservedCredit(
    input: RedeemDmPriorityCreditInput,
  ): Promise<PriorityCreditTransitionResult | null> {
    return this.repository.redeemReservedCredit({
      creditEventId: this.id(),
      guildId: input.guildId,
      userId: input.userId,
      creditId: input.creditId,
      targetEventId: input.targetEventId,
      targetAssignmentId: input.targetAssignmentId,
      redeemedAt: this.now(),
      actorUserId: input.userId,
      idempotencyKey: input.idempotencyKey,
    });
  }

  async refundCredit(
    input: RefundDmPriorityCreditInput,
  ): Promise<PriorityCreditTransitionResult | null> {
    return this.repository.refundCredit({
      creditEventId: this.id(),
      guildId: input.guildId,
      userId: input.userId,
      creditId: input.creditId,
      targetEventId: input.targetEventId,
      targetAssignmentId: input.targetAssignmentId,
      refundedAt: this.now(),
      actorUserId: input.actorUserId,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
    });
  }

  async expireDueCredits(
    guildId: string,
    limit = 100,
  ): Promise<PriorityCreditTransitionResult[]> {
    requireIdentifier(guildId, "guildId");
    const expiredAt = this.now();
    const due = await this.repository.listDueCredits(guildId, expiredAt, limit);
    const transitions: PriorityCreditTransitionResult[] = [];
    for (const credit of due) {
      const transition = await this.repository.expireCredit({
        creditEventId: this.id(),
        guildId: credit.guildId,
        userId: credit.userId,
        creditId: credit.creditId,
        targetEventId: credit.targetEventId,
        targetAssignmentId: credit.targetAssignmentId,
        expiredAt,
        idempotencyKey: `dm-priority:expire:${credit.creditId}:${credit.expiresAt}`,
      });
      if (transition) transitions.push(transition);
    }
    return transitions;
  }

  async correctGrant(
    input: CorrectDmPriorityGrantInput,
  ): Promise<CorrectPriorityGrantResult | null> {
    return this.repository.correctGrant({
      guildId: input.guildId,
      grantId: input.grantId,
      correctedAt: this.now(),
      correctedByUserId: input.actorUserId,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
    });
  }
}
