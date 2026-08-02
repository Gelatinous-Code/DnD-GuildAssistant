export type DmPriorityGrantStatus = "active" | "corrected";
export type DmPriorityCreditStatus =
  | "available"
  | "reserved"
  | "redeemed"
  | "expired"
  | "corrected";
export type DmPriorityCreditAction =
  | "granted"
  | "reserved"
  | "redeemed"
  | "refunded"
  | "expired"
  | "corrected";

export interface DmPriorityGrant {
  grantId: string;
  guildId: string;
  completionRevisionId: string;
  sourceEventId: string;
  sourcePlanId: string;
  sourceTableId: string;
  dmUserId: string;
  policyVersion: string;
  earnedTimeZone: string;
  earnedAt: number;
  expiresAt: number;
  grantedByUserId: string;
  idempotencyKey: string;
  status: DmPriorityGrantStatus;
  correctedAt: number | null;
  correctedByUserId: string | null;
  correctionReason: string | null;
  correctionKey: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface DmPriorityCredit {
  creditId: string;
  grantId: string;
  guildId: string;
  userId: string;
  ordinal: 1 | 2;
  earnedAt: number;
  expiresAt: number;
  status: DmPriorityCreditStatus;
  targetEventId: string | null;
  targetAssignmentId: string | null;
  reservedAt: number | null;
  redeemedAt: number | null;
  lastOperationKey: string | null;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface DmPriorityCreditEvent {
  creditEventId: string;
  guildId: string;
  creditId: string;
  idempotencyKey: string;
  action: DmPriorityCreditAction;
  fromStatus: DmPriorityCreditStatus | null;
  toStatus: DmPriorityCreditStatus;
  creditVersion: number;
  targetEventId: string | null;
  targetAssignmentId: string | null;
  actorUserId: string | null;
  reason: string | null;
  details: unknown | null;
  occurredAt: number;
}

export interface GrantCompletedSessionRewardInput {
  grantId: string;
  creditIds: readonly [string, string];
  guildId: string;
  completionRevisionId: string;
  sourceEventId: string;
  sourcePlanId: string;
  sourceTableId: string;
  dmUserId: string;
  policyVersion: string;
  earnedTimeZone: string;
  earnedAt: number;
  expiresAt: number;
  grantedByUserId: string;
  idempotencyKey: string;
}

export interface GrantCompletedSessionRewardResult {
  created: boolean;
  grant: DmPriorityGrant;
  credits: readonly [DmPriorityCredit, DmPriorityCredit];
}

export interface PriorityCreditTransitionResult {
  applied: boolean;
  replayed: boolean;
  credit: DmPriorityCredit;
  event: DmPriorityCreditEvent;
}

export interface ReserveNextPriorityCreditInput {
  creditEventId: string;
  guildId: string;
  userId: string;
  targetEventId: string;
  reservedAt: number;
  actorUserId: string;
  idempotencyKey: string;
}

export interface RedeemReservedPriorityCreditInput {
  creditEventId: string;
  guildId: string;
  userId: string;
  creditId: string;
  targetEventId: string;
  targetAssignmentId: string;
  redeemedAt: number;
  actorUserId: string;
  idempotencyKey: string;
}

export interface RefundPriorityCreditInput {
  creditEventId: string;
  guildId: string;
  userId: string;
  creditId: string;
  targetEventId: string;
  targetAssignmentId?: string | null;
  refundedAt: number;
  actorUserId: string;
  reason: string;
  idempotencyKey: string;
}

export interface ExpirePriorityCreditInput {
  creditEventId: string;
  guildId: string;
  userId: string;
  creditId: string;
  targetEventId?: string | null;
  targetAssignmentId?: string | null;
  expiredAt: number;
  idempotencyKey: string;
}

export interface CorrectPriorityGrantInput {
  guildId: string;
  grantId: string;
  correctedAt: number;
  correctedByUserId: string;
  reason: string;
  idempotencyKey: string;
}

export interface CorrectPriorityGrantResult {
  applied: boolean;
  replayed: boolean;
  grant: DmPriorityGrant;
  credits: DmPriorityCredit[];
}

export class PriorityIdempotencyConflictError extends Error {
  constructor(message = "The idempotency key is already associated with different priority data.") {
    super(message);
    this.name = "PriorityIdempotencyConflictError";
  }
}

type GrantRow = {
  grant_id: string;
  guild_id: string;
  completion_revision_id: string;
  source_event_id: string;
  source_plan_id: string;
  source_table_id: string;
  dm_user_id: string;
  policy_version: string;
  earned_timezone: string;
  earned_at: number;
  expires_at: number;
  granted_by_user_id: string;
  idempotency_key: string;
  status: DmPriorityGrantStatus;
  corrected_at: number | null;
  corrected_by_user_id: string | null;
  correction_reason: string | null;
  correction_key: string | null;
  created_at: number;
  updated_at: number;
};

type CreditRow = {
  credit_id: string;
  grant_id: string;
  guild_id: string;
  user_id: string;
  ordinal: 1 | 2;
  earned_at: number;
  expires_at: number;
  status: DmPriorityCreditStatus;
  target_event_id: string | null;
  target_assignment_id: string | null;
  reserved_at: number | null;
  redeemed_at: number | null;
  last_operation_key: string | null;
  version: number;
  created_at: number;
  updated_at: number;
};

type CreditEventRow = {
  credit_event_id: string;
  guild_id: string;
  credit_id: string;
  idempotency_key: string;
  action: DmPriorityCreditAction;
  from_status: DmPriorityCreditStatus | null;
  to_status: DmPriorityCreditStatus;
  credit_version: number;
  target_event_id: string | null;
  target_assignment_id: string | null;
  actor_user_id: string | null;
  reason: string | null;
  details_json: string | null;
  occurred_at: number;
};

function parseJson(value: string | null): unknown | null {
  if (value === null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function grantFromRow(row: GrantRow): DmPriorityGrant {
  return {
    grantId: row.grant_id,
    guildId: row.guild_id,
    completionRevisionId: row.completion_revision_id,
    sourceEventId: row.source_event_id,
    sourcePlanId: row.source_plan_id,
    sourceTableId: row.source_table_id,
    dmUserId: row.dm_user_id,
    policyVersion: row.policy_version,
    earnedTimeZone: row.earned_timezone,
    earnedAt: row.earned_at,
    expiresAt: row.expires_at,
    grantedByUserId: row.granted_by_user_id,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    correctedAt: row.corrected_at,
    correctedByUserId: row.corrected_by_user_id,
    correctionReason: row.correction_reason,
    correctionKey: row.correction_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function creditFromRow(row: CreditRow): DmPriorityCredit {
  return {
    creditId: row.credit_id,
    grantId: row.grant_id,
    guildId: row.guild_id,
    userId: row.user_id,
    ordinal: row.ordinal,
    earnedAt: row.earned_at,
    expiresAt: row.expires_at,
    status: row.status,
    targetEventId: row.target_event_id,
    targetAssignmentId: row.target_assignment_id,
    reservedAt: row.reserved_at,
    redeemedAt: row.redeemed_at,
    lastOperationKey: row.last_operation_key,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function creditEventFromRow(row: CreditEventRow): DmPriorityCreditEvent {
  return {
    creditEventId: row.credit_event_id,
    guildId: row.guild_id,
    creditId: row.credit_id,
    idempotencyKey: row.idempotency_key,
    action: row.action,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    creditVersion: row.credit_version,
    targetEventId: row.target_event_id,
    targetAssignmentId: row.target_assignment_id,
    actorUserId: row.actor_user_id,
    reason: row.reason,
    details: parseJson(row.details_json),
    occurredAt: row.occurred_at,
  };
}

function assertPositiveLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new RangeError("limit must be an integer from 1 through 500");
  }
}

function sameGrantRequest(grant: DmPriorityGrant, input: GrantCompletedSessionRewardInput): boolean {
  return (
    grant.guildId === input.guildId &&
    grant.completionRevisionId === input.completionRevisionId &&
    grant.sourceEventId === input.sourceEventId &&
    grant.sourcePlanId === input.sourcePlanId &&
    grant.sourceTableId === input.sourceTableId &&
    grant.dmUserId === input.dmUserId &&
    grant.policyVersion === input.policyVersion &&
    grant.earnedTimeZone === input.earnedTimeZone &&
    grant.earnedAt === input.earnedAt &&
    grant.expiresAt === input.expiresAt &&
    grant.grantedByUserId === input.grantedByUserId &&
    grant.idempotencyKey === input.idempotencyKey
  );
}

export class PriorityRepository {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => number = Date.now,
  ) {}

  async getGrant(guildId: string, grantId: string): Promise<DmPriorityGrant | null> {
    const row = await this.db
      .prepare("SELECT * FROM dm_priority_grants WHERE guild_id = ? AND grant_id = ?")
      .bind(guildId, grantId)
      .first<GrantRow>();
    return row ? grantFromRow(row) : null;
  }

  async getGrantByCompletionRevision(
    guildId: string,
    completionRevisionId: string,
  ): Promise<DmPriorityGrant | null> {
    const row = await this.db
      .prepare(
        "SELECT * FROM dm_priority_grants WHERE guild_id = ? AND completion_revision_id = ?",
      )
      .bind(guildId, completionRevisionId)
      .first<GrantRow>();
    return row ? grantFromRow(row) : null;
  }

  async getActiveGrantForSourceTable(
    guildId: string,
    sourceEventId: string,
    sourceTableId: string,
  ): Promise<DmPriorityGrant | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM dm_priority_grants
         WHERE guild_id = ? AND source_event_id = ? AND source_table_id = ?
           AND status = 'active'`,
      )
      .bind(guildId, sourceEventId, sourceTableId)
      .first<GrantRow>();
    return row ? grantFromRow(row) : null;
  }

  async getCredit(guildId: string, creditId: string): Promise<DmPriorityCredit | null> {
    const row = await this.db
      .prepare("SELECT * FROM dm_priority_credits WHERE guild_id = ? AND credit_id = ?")
      .bind(guildId, creditId)
      .first<CreditRow>();
    return row ? creditFromRow(row) : null;
  }

  async listCreditsForGrant(guildId: string, grantId: string): Promise<DmPriorityCredit[]> {
    const result = await this.db
      .prepare(
        `SELECT * FROM dm_priority_credits
         WHERE guild_id = ? AND grant_id = ? ORDER BY ordinal ASC`,
      )
      .bind(guildId, grantId)
      .all<CreditRow>();
    return result.results.map(creditFromRow);
  }

  async listAvailableCredits(
    guildId: string,
    userId: string,
    eligibleAt: number,
  ): Promise<DmPriorityCredit[]> {
    const result = await this.db
      .prepare(
        `SELECT * FROM dm_priority_credits
         WHERE guild_id = ? AND user_id = ? AND status = 'available'
           AND earned_at <= ? AND expires_at > ?
         ORDER BY expires_at ASC, earned_at ASC, credit_id ASC`,
      )
      .bind(guildId, userId, eligibleAt, eligibleAt)
      .all<CreditRow>();
    return result.results.map(creditFromRow);
  }

  async listDueCredits(
    guildId: string,
    now: number,
    limit = 100,
  ): Promise<DmPriorityCredit[]> {
    assertPositiveLimit(limit);
    const result = await this.db
      .prepare(
        `SELECT * FROM dm_priority_credits
         WHERE guild_id = ? AND status IN ('available', 'reserved') AND expires_at <= ?
         ORDER BY expires_at ASC, credit_id ASC LIMIT ?`,
      )
      .bind(guildId, now, limit)
      .all<CreditRow>();
    return result.results.map(creditFromRow);
  }

  async listCreditEvents(
    guildId: string,
    creditId: string,
    limit = 50,
  ): Promise<DmPriorityCreditEvent[]> {
    assertPositiveLimit(limit);
    const result = await this.db
      .prepare(
        `SELECT * FROM dm_priority_credit_events
         WHERE guild_id = ? AND credit_id = ?
         ORDER BY occurred_at DESC, credit_event_id DESC LIMIT ?`,
      )
      .bind(guildId, creditId, limit)
      .all<CreditEventRow>();
    return result.results.map(creditEventFromRow);
  }

  private async getEventByIdempotency(
    guildId: string,
    idempotencyKey: string,
  ): Promise<DmPriorityCreditEvent | null> {
    const row = await this.db
      .prepare(
        "SELECT * FROM dm_priority_credit_events WHERE guild_id = ? AND idempotency_key = ?",
      )
      .bind(guildId, idempotencyKey)
      .first<CreditEventRow>();
    return row ? creditEventFromRow(row) : null;
  }

  async grantCompletedSessionReward(
    input: GrantCompletedSessionRewardInput,
  ): Promise<GrantCompletedSessionRewardResult> {
    const createdAt = this.now();
    const results = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO dm_priority_grants (
             grant_id, guild_id, completion_revision_id, source_event_id,
             source_plan_id, source_table_id, dm_user_id, policy_version,
             earned_timezone, earned_at, expires_at, granted_by_user_id,
             idempotency_key, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(guild_id, completion_revision_id) DO NOTHING`,
        )
        .bind(
          input.grantId,
          input.guildId,
          input.completionRevisionId,
          input.sourceEventId,
          input.sourcePlanId,
          input.sourceTableId,
          input.dmUserId,
          input.policyVersion,
          input.earnedTimeZone,
          input.earnedAt,
          input.expiresAt,
          input.grantedByUserId,
          input.idempotencyKey,
          createdAt,
          createdAt,
        ),
      ...([1, 2] as const).map((ordinal) =>
        this.db
          .prepare(
            `INSERT INTO dm_priority_credits (
               credit_id, grant_id, guild_id, user_id, ordinal, earned_at,
               expires_at, status, version, created_at, updated_at
             )
             SELECT ?, grant_id, guild_id, dm_user_id, ?, earned_at,
                    expires_at, 'available', 1, ?, ?
             FROM dm_priority_grants
             WHERE guild_id = ? AND completion_revision_id = ?
             ON CONFLICT(grant_id, ordinal) DO NOTHING`,
          )
          .bind(
            input.creditIds[ordinal - 1],
            ordinal,
            createdAt,
            createdAt,
            input.guildId,
            input.completionRevisionId,
          ),
      ),
      ...([1, 2] as const).map((ordinal) =>
        this.db
          .prepare(
            `INSERT INTO dm_priority_credit_events (
               credit_event_id, guild_id, credit_id, idempotency_key, action,
               from_status, to_status, credit_version, actor_user_id, occurred_at
             )
             SELECT credit_id || ':granted', guild_id, credit_id, ?, 'granted',
                    NULL, 'available', 1, ?, ?
             FROM dm_priority_credits
             WHERE guild_id = ?
               AND grant_id = (
                 SELECT grant_id FROM dm_priority_grants
                 WHERE guild_id = ? AND completion_revision_id = ?
               )
               AND ordinal = ?
             ON CONFLICT(credit_id, credit_version) DO NOTHING`,
          )
          .bind(
            `${input.idempotencyKey}:credit:${ordinal}`,
            input.grantedByUserId,
            input.earnedAt,
            input.guildId,
            input.guildId,
            input.completionRevisionId,
            ordinal,
          ),
      ),
    ]);

    const grant = await this.getGrantByCompletionRevision(
      input.guildId,
      input.completionRevisionId,
    );
    if (!grant) throw new Error("The DM priority grant was not persisted");
    if (!sameGrantRequest(grant, input)) {
      throw new PriorityIdempotencyConflictError(
        "The completed-session revision is already associated with a different grant payload.",
      );
    }
    const credits = await this.listCreditsForGrant(input.guildId, grant.grantId);
    if (
      credits.length !== 2 ||
      credits[0]?.ordinal !== 1 ||
      credits[1]?.ordinal !== 2
    ) {
      throw new Error("A completed DM session must persist exactly two priority credits");
    }
    return {
      created: results[0]?.meta.changes === 1,
      grant,
      credits: [credits[0], credits[1]],
    };
  }

  private async transitionResult(
    guildId: string,
    idempotencyKey: string,
    applied: boolean,
  ): Promise<PriorityCreditTransitionResult | null> {
    const event = await this.getEventByIdempotency(guildId, idempotencyKey);
    if (!event) return null;
    const credit = await this.getCredit(guildId, event.creditId);
    if (!credit) throw new Error("Priority lifecycle event refers to a missing credit");
    return { applied, replayed: !applied, credit, event };
  }

  async reserveNextCredit(
    input: ReserveNextPriorityCreditInput,
  ): Promise<PriorityCreditTransitionResult | null> {
    const results = await this.db.batch([
      this.db
        .prepare(
          `UPDATE dm_priority_credits
           SET status = 'reserved', target_event_id = ?, target_assignment_id = NULL,
               reserved_at = ?, redeemed_at = NULL, last_operation_key = ?,
               version = version + 1, updated_at = ?
           WHERE credit_id = (
             SELECT candidate.credit_id
             FROM dm_priority_credits candidate
             JOIN weekly_events target
               ON target.event_id = ? AND target.guild_id = ?
             JOIN signups signup
               ON signup.event_id = target.event_id
              AND signup.user_id = candidate.user_id
             WHERE candidate.guild_id = ? AND candidate.user_id = ?
               AND candidate.status = 'available'
               AND candidate.earned_at <= ? AND candidate.expires_at > ?
               AND target.starts_at >= ? AND target.starts_at < candidate.expires_at
               AND target.status NOT IN ('archived', 'cancelled')
               AND signup.signup_kind = 'player' AND signup.status = 'active'
               AND NOT EXISTS (
                 SELECT 1 FROM dm_priority_credits active
                 WHERE active.guild_id = candidate.guild_id
                   AND active.user_id = candidate.user_id
                   AND active.target_event_id = target.event_id
                   AND active.status IN ('reserved', 'redeemed')
               )
               AND NOT EXISTS (
                 SELECT 1 FROM dm_priority_credit_events replay
                 WHERE replay.guild_id = candidate.guild_id
                   AND replay.idempotency_key = ?
               )
             ORDER BY candidate.expires_at ASC, candidate.earned_at ASC,
                      candidate.credit_id ASC
             LIMIT 1
           ) AND guild_id = ? AND user_id = ? AND status = 'available'`,
        )
        .bind(
          input.targetEventId,
          input.reservedAt,
          input.idempotencyKey,
          input.reservedAt,
          input.targetEventId,
          input.guildId,
          input.guildId,
          input.userId,
          input.reservedAt,
          input.reservedAt,
          input.reservedAt,
          input.idempotencyKey,
          input.guildId,
          input.userId,
        ),
      this.db
        .prepare(
          `INSERT INTO dm_priority_credit_events (
             credit_event_id, guild_id, credit_id, idempotency_key, action,
             from_status, to_status, credit_version, target_event_id,
             actor_user_id, occurred_at
           )
           SELECT ?, guild_id, credit_id, ?, 'reserved', 'available', 'reserved',
                  version, ?, ?, ?
           FROM dm_priority_credits
           WHERE guild_id = ? AND user_id = ? AND last_operation_key = ?
             AND changes() = 1
           ON CONFLICT(guild_id, idempotency_key) DO NOTHING`,
        )
        .bind(
          input.creditEventId,
          input.idempotencyKey,
          input.targetEventId,
          input.actorUserId,
          input.reservedAt,
          input.guildId,
          input.userId,
          input.idempotencyKey,
        ),
    ]);
    const result = await this.transitionResult(
      input.guildId,
      input.idempotencyKey,
      results[0]?.meta.changes === 1,
    );
    if (
      result &&
      (result.event.action !== "reserved" ||
        result.credit.userId !== input.userId ||
        result.event.targetEventId !== input.targetEventId)
    ) {
      throw new PriorityIdempotencyConflictError();
    }
    return result;
  }

  async redeemReservedCredit(
    input: RedeemReservedPriorityCreditInput,
  ): Promise<PriorityCreditTransitionResult | null> {
    const results = await this.db.batch([
      this.db
        .prepare(
          `UPDATE dm_priority_credits
           SET status = 'redeemed', target_assignment_id = ?, redeemed_at = ?,
               last_operation_key = ?, version = version + 1, updated_at = ?
           WHERE guild_id = ? AND user_id = ? AND credit_id = ?
             AND target_event_id = ? AND status = 'reserved'
             AND earned_at <= ? AND expires_at > ?
             AND EXISTS (
               SELECT 1
               FROM assignments assignment
               JOIN plans assignment_plan ON assignment_plan.plan_id = assignment.plan_id
               JOIN weekly_events assignment_event
                 ON assignment_event.event_id = assignment_plan.event_id
               WHERE assignment.assignment_id = ?
                 AND assignment.user_id = dm_priority_credits.user_id
                 AND assignment.status = 'assigned'
                 AND assignment_plan.status = 'published'
                 AND assignment_event.event_id = dm_priority_credits.target_event_id
                 AND assignment_event.guild_id = dm_priority_credits.guild_id
             )
             AND NOT EXISTS (
               SELECT 1 FROM dm_priority_credit_events replay
               WHERE replay.guild_id = ? AND replay.idempotency_key = ?
             )`,
        )
        .bind(
          input.targetAssignmentId,
          input.redeemedAt,
          input.idempotencyKey,
          input.redeemedAt,
          input.guildId,
          input.userId,
          input.creditId,
          input.targetEventId,
          input.redeemedAt,
          input.redeemedAt,
          input.targetAssignmentId,
          input.guildId,
          input.idempotencyKey,
        ),
      this.db
        .prepare(
          `INSERT INTO dm_priority_credit_events (
             credit_event_id, guild_id, credit_id, idempotency_key, action,
             from_status, to_status, credit_version, target_event_id,
             target_assignment_id, actor_user_id, occurred_at
           )
           SELECT ?, guild_id, credit_id, ?, 'redeemed', 'reserved', 'redeemed',
                  version, ?, ?, ?, ?
           FROM dm_priority_credits
           WHERE guild_id = ? AND credit_id = ? AND last_operation_key = ?
             AND changes() = 1
           ON CONFLICT(guild_id, idempotency_key) DO NOTHING`,
        )
        .bind(
          input.creditEventId,
          input.idempotencyKey,
          input.targetEventId,
          input.targetAssignmentId,
          input.actorUserId,
          input.redeemedAt,
          input.guildId,
          input.creditId,
          input.idempotencyKey,
        ),
    ]);
    const result = await this.transitionResult(
      input.guildId,
      input.idempotencyKey,
      results[0]?.meta.changes === 1,
    );
    if (
      result &&
      (result.event.action !== "redeemed" ||
        result.credit.userId !== input.userId ||
        result.event.targetEventId !== input.targetEventId ||
        result.event.targetAssignmentId !== input.targetAssignmentId)
    ) {
      throw new PriorityIdempotencyConflictError();
    }
    return result;
  }

  async refundCredit(
    input: RefundPriorityCreditInput,
  ): Promise<PriorityCreditTransitionResult | null> {
    if (!input.reason.trim()) throw new TypeError("A refund reason is required");
    const statements: D1PreparedStatement[] = [];
    for (const fromStatus of ["reserved", "redeemed"] as const) {
      const assignmentPredicate = fromStatus === "redeemed"
        ? "AND target_assignment_id = ?"
        : "AND target_assignment_id IS NULL";
      const assignmentSelect = fromStatus === "redeemed" ? "?" : "NULL";
      statements.push(
        this.db
          .prepare(
            `UPDATE dm_priority_credits
             SET status = CASE WHEN ? < expires_at THEN 'available' ELSE 'expired' END,
                 target_event_id = NULL, target_assignment_id = NULL,
                 reserved_at = NULL, redeemed_at = NULL, last_operation_key = ?,
                 version = version + 1, updated_at = ?
             WHERE guild_id = ? AND user_id = ? AND credit_id = ?
               AND target_event_id = ? AND status = '${fromStatus}'
               ${assignmentPredicate}
               AND NOT EXISTS (
                 SELECT 1 FROM dm_priority_credit_events replay
                 WHERE replay.guild_id = ? AND replay.idempotency_key = ?
               )`,
          )
          .bind(
            input.refundedAt,
            input.idempotencyKey,
            input.refundedAt,
            input.guildId,
            input.userId,
            input.creditId,
            input.targetEventId,
            ...(fromStatus === "redeemed" ? [input.targetAssignmentId ?? null] : []),
            input.guildId,
            input.idempotencyKey,
          ),
        this.db
          .prepare(
            `INSERT INTO dm_priority_credit_events (
               credit_event_id, guild_id, credit_id, idempotency_key, action,
               from_status, to_status, credit_version, target_event_id,
               target_assignment_id, actor_user_id, reason, occurred_at
             )
             SELECT ?, guild_id, credit_id, ?, 'refunded', '${fromStatus}', status,
                    version, ?, ${assignmentSelect}, ?, ?, ?
             FROM dm_priority_credits
             WHERE guild_id = ? AND credit_id = ? AND last_operation_key = ?
               AND changes() = 1
             ON CONFLICT(guild_id, idempotency_key) DO NOTHING`,
          )
          .bind(
            input.creditEventId,
            input.idempotencyKey,
            input.targetEventId,
            ...(fromStatus === "redeemed" ? [input.targetAssignmentId ?? null] : []),
            input.actorUserId,
            input.reason.slice(0, 1000),
            input.refundedAt,
            input.guildId,
            input.creditId,
            input.idempotencyKey,
          ),
      );
    }
    const results = await this.db.batch(statements);
    const applied = results[0]?.meta.changes === 1 || results[2]?.meta.changes === 1;
    const result = await this.transitionResult(input.guildId, input.idempotencyKey, applied);
    if (
      result &&
      (result.event.action !== "refunded" ||
        result.credit.userId !== input.userId ||
        result.event.targetEventId !== input.targetEventId ||
        (result.event.fromStatus === "redeemed" &&
          result.event.targetAssignmentId !== (input.targetAssignmentId ?? null)) ||
        (result.event.fromStatus === "reserved" &&
          result.event.targetAssignmentId !== null))
    ) {
      throw new PriorityIdempotencyConflictError();
    }
    return result;
  }

  async expireCredit(
    input: ExpirePriorityCreditInput,
  ): Promise<PriorityCreditTransitionResult | null> {
    const statements: D1PreparedStatement[] = [];
    for (const fromStatus of ["available", "reserved"] as const) {
      statements.push(
        this.db
          .prepare(
            `UPDATE dm_priority_credits
             SET status = 'expired', target_event_id = NULL,
                 target_assignment_id = NULL, reserved_at = NULL, redeemed_at = NULL,
                 last_operation_key = ?, version = version + 1, updated_at = ?
             WHERE guild_id = ? AND user_id = ? AND credit_id = ?
               AND status = '${fromStatus}' AND expires_at <= ?
               AND NOT EXISTS (
                 SELECT 1 FROM dm_priority_credit_events replay
                 WHERE replay.guild_id = ? AND replay.idempotency_key = ?
               )`,
          )
          .bind(
            input.idempotencyKey,
            input.expiredAt,
            input.guildId,
            input.userId,
            input.creditId,
            input.expiredAt,
            input.guildId,
            input.idempotencyKey,
          ),
        this.db
          .prepare(
            `INSERT INTO dm_priority_credit_events (
               credit_event_id, guild_id, credit_id, idempotency_key, action,
               from_status, to_status, credit_version, target_event_id,
               target_assignment_id, reason, occurred_at
             )
             SELECT ?, guild_id, credit_id, ?, 'expired', '${fromStatus}', 'expired',
                    version, ?, ?, 'exclusive expiry boundary reached', ?
             FROM dm_priority_credits
             WHERE guild_id = ? AND credit_id = ? AND last_operation_key = ?
               AND changes() = 1
             ON CONFLICT(guild_id, idempotency_key) DO NOTHING`,
          )
          .bind(
            input.creditEventId,
            input.idempotencyKey,
            input.targetEventId ?? null,
            input.targetAssignmentId ?? null,
            input.expiredAt,
            input.guildId,
            input.creditId,
            input.idempotencyKey,
          ),
      );
    }
    const results = await this.db.batch(statements);
    const applied = results[0]?.meta.changes === 1 || results[2]?.meta.changes === 1;
    const result = await this.transitionResult(input.guildId, input.idempotencyKey, applied);
    if (
      result &&
      (result.event.action !== "expired" ||
        result.event.creditId !== input.creditId ||
        result.credit.userId !== input.userId ||
        result.event.targetEventId !== (input.targetEventId ?? null) ||
        result.event.targetAssignmentId !== (input.targetAssignmentId ?? null))
    ) {
      throw new PriorityIdempotencyConflictError();
    }
    return result;
  }

  async correctGrant(input: CorrectPriorityGrantInput): Promise<CorrectPriorityGrantResult | null> {
    if (!input.reason.trim()) throw new TypeError("A correction reason is required");
    const results = await this.db.batch([
      this.db
        .prepare(
          `UPDATE dm_priority_grants
           SET status = 'corrected', corrected_at = ?, corrected_by_user_id = ?,
               correction_reason = ?, correction_key = ?, updated_at = ?
           WHERE guild_id = ? AND grant_id = ? AND status = 'active'`,
        )
        .bind(
          input.correctedAt,
          input.correctedByUserId,
          input.reason.slice(0, 1000),
          input.idempotencyKey,
          input.correctedAt,
          input.guildId,
          input.grantId,
        ),
      this.db
        .prepare(
          `INSERT INTO dm_priority_credit_events (
             credit_event_id, guild_id, credit_id, idempotency_key, action,
             from_status, to_status, credit_version, target_event_id,
             target_assignment_id, actor_user_id, reason, occurred_at
           )
           SELECT ? || ':' || credit.credit_id, credit.guild_id, credit.credit_id,
                  ? || ':' || credit.credit_id, 'corrected', credit.status,
                  'corrected', credit.version + 1, credit.target_event_id,
                  credit.target_assignment_id, ?, ?, ?
           FROM dm_priority_credits credit
           JOIN dm_priority_grants grant ON grant.grant_id = credit.grant_id
           WHERE credit.guild_id = ? AND credit.grant_id = ?
             AND credit.status IN ('available', 'reserved', 'redeemed')
             AND grant.status = 'corrected' AND grant.correction_key = ?
          `,
        )
        .bind(
          input.idempotencyKey,
          input.idempotencyKey,
          input.correctedByUserId,
          input.reason.slice(0, 1000),
          input.correctedAt,
          input.guildId,
          input.grantId,
          input.idempotencyKey,
        ),
      this.db
        .prepare(
          `UPDATE dm_priority_credits
           SET status = 'corrected', target_event_id = NULL,
               target_assignment_id = NULL, reserved_at = NULL, redeemed_at = NULL,
               last_operation_key = ? || ':' || credit_id,
               version = version + 1, updated_at = ?
           WHERE guild_id = ? AND grant_id = ?
             AND status IN ('available', 'reserved', 'redeemed')
             AND EXISTS (
               SELECT 1 FROM dm_priority_credit_events transition
               WHERE transition.guild_id = dm_priority_credits.guild_id
                 AND transition.credit_id = dm_priority_credits.credit_id
                 AND transition.idempotency_key = ? || ':' || dm_priority_credits.credit_id
                 AND transition.from_status = dm_priority_credits.status
                 AND transition.credit_version = dm_priority_credits.version + 1
             )`,
        )
        .bind(
          input.idempotencyKey,
          input.correctedAt,
          input.guildId,
          input.grantId,
          input.idempotencyKey,
        ),
    ]);

    const grant = await this.getGrant(input.guildId, input.grantId);
    if (!grant) return null;
    if (
      grant.status !== "corrected" ||
      grant.correctionKey !== input.idempotencyKey ||
      grant.correctedByUserId !== input.correctedByUserId ||
      grant.correctionReason !== input.reason.slice(0, 1000)
    ) {
      throw new PriorityIdempotencyConflictError(
        "The grant was already corrected with different correction data.",
      );
    }
    const credits = await this.listCreditsForGrant(input.guildId, input.grantId);
    if (
      credits.some(
        (credit) =>
          credit.status === "available" ||
          credit.status === "reserved" ||
          credit.status === "redeemed",
      )
    ) {
      throw new Error("A corrected DM priority grant cannot retain live credits");
    }
    return {
      applied: results[0]?.meta.changes === 1,
      replayed: results[0]?.meta.changes !== 1,
      grant,
      credits,
    };
  }
}
