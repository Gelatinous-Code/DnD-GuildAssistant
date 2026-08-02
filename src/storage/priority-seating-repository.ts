export type PrioritySeatingAssignmentStatus =
  | "unassigned"
  | "assigned"
  | "waitlisted"
  | "withdrawn";

export type PrioritySeatingAction =
  | "requested"
  | "priority_requested"
  | "displaced"
  | "promoted"
  | "reranked"
  | "priority_released"
  | "priority_redeemed"
  | "left"
  | "withdrawn"
  | "cancelled"
  | "carried_forward"
  | "expired";

export interface PrioritySeatingAssignment {
  assignmentId: string;
  planId: string;
  tableId: string | null;
  desiredTableId: string | null;
  userId: string;
  displayName: string;
  status: PrioritySeatingAssignmentStatus;
  waitlistPosition: number | null;
  assignedAt: number | null;
  updatedAt: number;
  tableRequestedAt: number | null;
  priorityRequestedAt: number | null;
  priorityCreditId: string | null;
  seatRequestVersion: number;
}

export interface PrioritySeatingEvent {
  seatingEventId: string;
  guildId: string;
  operationKey: string;
  eventId: string;
  planId: string;
  tableId: string | null;
  assignmentId: string;
  userId: string;
  priorityCreditId: string | null;
  action: PrioritySeatingAction;
  reasonCode: string;
  fromStatus: PrioritySeatingAssignmentStatus | null;
  toStatus: PrioritySeatingAssignmentStatus | null;
  fromWaitlistPosition: number | null;
  toWaitlistPosition: number | null;
  actorUserId: string | null;
  occurredAt: number;
}

export interface SelectPrioritySeatInput {
  guildId: string;
  eventId: string;
  planId: string;
  tableId: string;
  userId: string;
  actorUserId: string;
  operationKey: string;
  expectedAssignmentId?: string;
  expectedSeatRequestVersion?: number;
  expectedTableStateVersion?: number;
  expectedCreditId?: string;
}

export interface ReleasePrioritySeatInput {
  guildId: string;
  eventId: string;
  planId: string;
  userId: string;
  actorUserId: string;
  reason: string;
  operationKey: string;
  /** System-only recovery when a published revision supersedes one after close. */
  allowAfterClose?: boolean;
}

export interface LeavePrioritySeatInput extends ReleasePrioritySeatInput {
  withdraw?: boolean;
}

export interface SettlePrioritySeatingInput {
  guildId: string;
  eventId: string;
  planId: string;
  operationKey: string;
}

export interface CancelPrioritySeatingInput extends SettlePrioritySeatingInput {
  actorUserId: string;
  reason: string;
}

export interface CarryForwardPrioritySeatInput {
  guildId: string;
  eventId: string;
  previousPlanId: string;
  nextPlanId: string;
  previousAssignmentId: string;
  nextAssignmentId: string;
  operationKey: string;
}

export interface RepairInvalidPrioritySeatingInput {
  guildId: string;
  eventId: string;
  planId: string;
  actorUserId: string;
  reason: string;
  operationKey: string;
}

export interface PrioritySeatingMutationResult {
  applied: boolean;
  replayed: boolean;
  assignment: PrioritySeatingAssignment | null;
  events: PrioritySeatingEvent[];
  displaced: PrioritySeatingAssignment[];
  promoted: PrioritySeatingAssignment[];
  affectedTableIds: string[];
  priorityCreditId: string | null;
}

export interface SupersededPriorityPlanReference {
  planId: string;
  generation: number;
}

export interface PublishedPriorityReconciliationTarget {
  guildId: string;
  eventId: string;
  planId: string;
}

export class PrioritySeatingUnavailableError extends Error {
  constructor(message = "The priority seating request is no longer available.") {
    super(message);
    this.name = "PrioritySeatingUnavailableError";
  }
}

export class PrioritySeatingIdempotencyConflictError extends Error {
  constructor() {
    super("The idempotency key is already associated with different seating data.");
    this.name = "PrioritySeatingIdempotencyConflictError";
  }
}

type AssignmentRow = {
  assignment_id: string;
  plan_id: string;
  table_id: string | null;
  desired_table_id: string | null;
  user_id: string;
  display_name: string;
  status: PrioritySeatingAssignmentStatus;
  waitlist_position: number | null;
  assigned_at: number | null;
  updated_at: number;
  table_requested_at: number | null;
  priority_requested_at: number | null;
  priority_credit_id: string | null;
  seat_request_version: number;
};

type SeatingEventRow = {
  seating_event_id: string;
  guild_id: string;
  operation_key: string;
  event_id: string;
  plan_id: string;
  table_id: string | null;
  assignment_id: string;
  user_id: string;
  priority_credit_id: string | null;
  action: PrioritySeatingAction;
  reason_code: string;
  from_status: PrioritySeatingAssignmentStatus | null;
  to_status: PrioritySeatingAssignmentStatus | null;
  from_waitlist_position: number | null;
  to_waitlist_position: number | null;
  actor_user_id: string | null;
  occurred_at: number;
};

type OperationRow = {
  guild_id: string;
  operation_key: string;
  operation_kind: string;
  event_id: string;
  plan_id: string;
  target_table_id: string | null;
  assignment_id: string | null;
  user_id: string | null;
  actor_user_id: string | null;
  reason: string | null;
  selected_credit_id: string | null;
  previous_table_id: string | null;
  previous_desired_table_id: string | null;
  occurred_at: number;
  completed_at: number | null;
};

function assignmentFromRow(row: AssignmentRow): PrioritySeatingAssignment {
  return {
    assignmentId: row.assignment_id,
    planId: row.plan_id,
    tableId: row.table_id,
    desiredTableId: row.desired_table_id,
    userId: row.user_id,
    displayName: row.display_name,
    status: row.status,
    waitlistPosition: row.waitlist_position,
    assignedAt: row.assigned_at,
    updatedAt: row.updated_at,
    tableRequestedAt: row.table_requested_at,
    priorityRequestedAt: row.priority_requested_at,
    priorityCreditId: row.priority_credit_id,
    seatRequestVersion: row.seat_request_version,
  };
}

function eventFromRow(row: SeatingEventRow): PrioritySeatingEvent {
  return {
    seatingEventId: row.seating_event_id,
    guildId: row.guild_id,
    operationKey: row.operation_key,
    eventId: row.event_id,
    planId: row.plan_id,
    tableId: row.table_id,
    assignmentId: row.assignment_id,
    userId: row.user_id,
    priorityCreditId: row.priority_credit_id,
    action: row.action,
    reasonCode: row.reason_code,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    fromWaitlistPosition: row.from_waitlist_position,
    toWaitlistPosition: row.to_waitlist_position,
    actorUserId: row.actor_user_id,
    occurredAt: row.occurred_at,
  };
}

function requireIdentifier(value: string, name: string): void {
  if (!value.trim()) throw new TypeError(`${name} cannot be empty`);
}

function requireExpectedVersion(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

function requireReason(value: string): string {
  const reason = value.replace(/[\r\n]+/g, " ").trim();
  if (reason.length < 3 || reason.length > 1_000) {
    throw new RangeError("reason must contain 3 through 1000 characters");
  }
  return reason;
}

function requireQueryLimit(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 500) {
    throw new RangeError("limit must be an integer from 1 through 500");
  }
}

const WAITLIST_SHIFT = 1_000_000;

/**
 * Owns the transaction boundary between assignments and the priority-credit
 * ledger. Callers must not reserve a credit and select a table separately.
 */
export class PrioritySeatingRepository {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => number = Date.now,
  ) {}

  async getAssignment(
    guildId: string,
    planId: string,
    userId: string,
  ): Promise<PrioritySeatingAssignment | null> {
    const row = await this.db
      .prepare(
        `SELECT assignment.*
         FROM assignments assignment
         JOIN plans plan ON plan.plan_id = assignment.plan_id
         JOIN weekly_events event ON event.event_id = plan.event_id
         WHERE event.guild_id = ? AND assignment.plan_id = ?
           AND assignment.user_id = ?`,
      )
      .bind(guildId, planId, userId)
      .first<AssignmentRow>();
    return row ? assignmentFromRow(row) : null;
  }

  async listSupersededPriorityPlans(
    guildId: string,
    eventId: string,
    limit = 50,
  ): Promise<SupersededPriorityPlanReference[]> {
    requireQueryLimit(limit);
    requireIdentifier(guildId, "guildId");
    requireIdentifier(eventId, "eventId");
    const result = await this.db
      .prepare(
        `SELECT DISTINCT plan.plan_id, plan.generation
         FROM plans plan
         JOIN weekly_events event ON event.event_id = plan.event_id
         JOIN assignments assignment ON assignment.plan_id = plan.plan_id
         WHERE event.guild_id = ? AND event.event_id = ?
           AND plan.status = 'superseded'
           AND assignment.priority_credit_id IS NOT NULL
         ORDER BY CASE WHEN EXISTS (
           SELECT 1
           FROM assignments unresolved_assignment
           WHERE unresolved_assignment.plan_id = plan.plan_id
             AND unresolved_assignment.priority_credit_id IS NOT NULL
             AND NOT EXISTS (
               SELECT 1
               FROM plans current_plan
               JOIN assignments current_assignment
                 ON current_assignment.plan_id = current_plan.plan_id
                AND current_assignment.user_id = unresolved_assignment.user_id
                AND current_assignment.priority_credit_id =
                    unresolved_assignment.priority_credit_id
                AND current_assignment.priority_requested_at IS NOT NULL
               JOIN dm_priority_credits credit
                 ON credit.credit_id = current_assignment.priority_credit_id
                AND credit.guild_id = event.guild_id
                AND credit.user_id = current_assignment.user_id
                AND credit.status = 'reserved'
                AND credit.target_event_id = event.event_id
                AND credit.expires_at > ?
               WHERE current_plan.event_id = event.event_id
                 AND current_plan.status = 'published'
             )
         ) THEN 0 ELSE 1 END ASC,
         plan.generation DESC, plan.plan_id ASC
         LIMIT ?`,
      )
      .bind(guildId, eventId, this.now(), limit)
      .all<{ plan_id: string; generation: number }>();
    return result.results.map((row) => ({
      planId: row.plan_id,
      generation: row.generation,
    }));
  }

  async listPublishedPlansNeedingPriorityReconciliation(
    limit = 50,
  ): Promise<PublishedPriorityReconciliationTarget[]> {
    requireQueryLimit(limit);
    const result = await this.db
      .prepare(
        `SELECT DISTINCT event.guild_id, event.event_id,
                         current_plan.plan_id
         FROM weekly_events event
         JOIN plans current_plan
           ON current_plan.event_id = event.event_id
          AND current_plan.status = 'published'
         WHERE event.status = 'published'
           AND EXISTS (
             SELECT 1
             FROM plans source_plan
             JOIN assignments source_assignment
               ON source_assignment.plan_id = source_plan.plan_id
             WHERE source_plan.event_id = event.event_id
               AND source_plan.status = 'superseded'
               AND source_assignment.priority_credit_id IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1
                 FROM assignments current_assignment
                 JOIN dm_priority_credits credit
                   ON credit.credit_id = current_assignment.priority_credit_id
                  AND credit.guild_id = event.guild_id
                  AND credit.user_id = current_assignment.user_id
                  AND credit.status = 'reserved'
                  AND credit.target_event_id = event.event_id
                  AND credit.expires_at > ?
                 WHERE current_assignment.plan_id = current_plan.plan_id
                   AND current_assignment.user_id = source_assignment.user_id
                   AND current_assignment.priority_credit_id =
                       source_assignment.priority_credit_id
                   AND current_assignment.priority_requested_at IS NOT NULL
               )
           )
         ORDER BY event.guild_id ASC, event.event_id ASC,
                  current_plan.generation DESC
         LIMIT ?`,
      )
      .bind(this.now(), limit)
      .all<{
        guild_id: string;
        event_id: string;
        plan_id: string;
      }>();
    return result.results.map((row) => ({
      guildId: row.guild_id,
      eventId: row.event_id,
      planId: row.plan_id,
    }));
  }

  async hasValidPriorityReservation(
    guildId: string,
    eventId: string,
    planId: string,
    userId: string,
    creditId: string,
  ): Promise<boolean> {
    const row = await this.db
      .prepare(
        `SELECT 1 AS valid
         FROM assignments assignment
         JOIN plans plan ON plan.plan_id = assignment.plan_id
         JOIN weekly_events event ON event.event_id = plan.event_id
         JOIN dm_priority_credits credit
           ON credit.credit_id = assignment.priority_credit_id
         WHERE event.guild_id = ? AND event.event_id = ? AND plan.plan_id = ?
           AND assignment.user_id = ? AND assignment.priority_credit_id = ?
           AND assignment.priority_requested_at IS NOT NULL
           AND credit.guild_id = event.guild_id
           AND credit.user_id = assignment.user_id
           AND credit.status = 'reserved'
           AND credit.target_event_id = event.event_id
           AND credit.expires_at > ?`,
      )
      .bind(guildId, eventId, planId, userId, creditId, this.now())
      .first<{ valid: number }>();
    return row?.valid === 1;
  }

  async listOperationEvents(
    guildId: string,
    operationKey: string,
  ): Promise<PrioritySeatingEvent[]> {
    const result = await this.db
      .prepare(
        `SELECT * FROM priority_seating_events
         WHERE guild_id = ? AND operation_key = ?
         ORDER BY seating_event_id ASC`,
      )
      .bind(guildId, operationKey)
      .all<SeatingEventRow>();
    return result.results.map(eventFromRow);
  }

  private async getOperation(
    guildId: string,
    operationKey: string,
  ): Promise<OperationRow | null> {
    return this.db
      .prepare(
        `SELECT * FROM priority_seating_operations
         WHERE guild_id = ? AND operation_key = ?`,
      )
      .bind(guildId, operationKey)
      .first<OperationRow>();
  }

  private snapshotAffectedStatement(
    guildId: string,
    operationKey: string,
  ): D1PreparedStatement {
    return this.db
      .prepare(
        `INSERT OR IGNORE INTO priority_seating_operation_members (
           guild_id, operation_key, assignment_id, user_id, table_id,
           desired_table_id, status, waitlist_position, table_requested_at,
           priority_requested_at, priority_credit_id, seat_request_version
         )
         SELECT operation.guild_id, operation.operation_key,
                assignment.assignment_id, assignment.user_id,
                assignment.table_id, assignment.desired_table_id,
                assignment.status, assignment.waitlist_position,
                assignment.table_requested_at,
                assignment.priority_requested_at,
                assignment.priority_credit_id,
                assignment.seat_request_version
         FROM priority_seating_operations operation
         JOIN assignments assignment ON assignment.plan_id = operation.plan_id
         WHERE operation.guild_id = ? AND operation.operation_key = ?
           AND operation.completed_at IS NULL
           AND (
             assignment.assignment_id = operation.assignment_id
             OR assignment.desired_table_id = operation.target_table_id
             OR assignment.desired_table_id = COALESCE(
               operation.previous_desired_table_id,
               operation.previous_table_id
             )
           )`,
      )
      .bind(guildId, operationKey);
  }

  private shiftWaitlistsStatement(
    guildId: string,
    operationKey: string,
  ): D1PreparedStatement {
    return this.db
      .prepare(
        `UPDATE assignments
         SET waitlist_position = waitlist_position + ?
         WHERE status = 'waitlisted'
           AND plan_id = (
             SELECT plan_id FROM priority_seating_operations
             WHERE guild_id = ? AND operation_key = ? AND completed_at IS NULL
           )
           AND desired_table_id IN (
             SELECT target_table_id FROM priority_seating_operations
             WHERE guild_id = ? AND operation_key = ?
             UNION
             SELECT COALESCE(previous_desired_table_id, previous_table_id)
             FROM priority_seating_operations
             WHERE guild_id = ? AND operation_key = ?
           )`,
      )
      .bind(
        WAITLIST_SHIFT,
        guildId,
        operationKey,
        guildId,
        operationKey,
        guildId,
        operationKey,
      );
  }

  private rerankAffectedStatement(
    guildId: string,
    operationKey: string,
  ): D1PreparedStatement {
    return this.db
      .prepare(
        `WITH affected AS (
           SELECT target_table_id AS table_id
           FROM priority_seating_operations
           WHERE guild_id = ? AND operation_key = ? AND completed_at IS NULL
           UNION
           SELECT COALESCE(previous_desired_table_id, previous_table_id)
           FROM priority_seating_operations
           WHERE guild_id = ? AND operation_key = ? AND completed_at IS NULL
         ), candidates AS (
           SELECT assignment.assignment_id,
                  assignment.desired_table_id,
                  table_slot.capacity,
                  CASE
                    WHEN assignment.priority_requested_at IS NOT NULL
                     AND credit.status = 'reserved'
                     AND credit.guild_id = operation.guild_id
                     AND credit.user_id = assignment.user_id
                     AND credit.target_event_id = operation.event_id
                     AND credit.expires_at > operation.occurred_at
                      THEN 1 ELSE 0
                  END AS has_valid_priority,
                  assignment.priority_requested_at,
                  assignment.table_requested_at,
                  assignment.user_id
           FROM assignments assignment
           JOIN plan_tables table_slot
             ON table_slot.table_id = assignment.desired_table_id
            AND table_slot.plan_id = assignment.plan_id
           JOIN priority_seating_operations operation
             ON operation.plan_id = assignment.plan_id
            AND operation.guild_id = ? AND operation.operation_key = ?
            AND operation.completed_at IS NULL
           LEFT JOIN dm_priority_credits credit
             ON credit.credit_id = assignment.priority_credit_id
           WHERE assignment.desired_table_id IN (
               SELECT table_id FROM affected WHERE table_id IS NOT NULL
             )
             AND assignment.status <> 'withdrawn'
             AND assignment.table_requested_at IS NOT NULL
         ), ranked AS (
           SELECT assignment_id, desired_table_id, capacity,
                  ROW_NUMBER() OVER (
                    PARTITION BY desired_table_id
                    ORDER BY
                      CASE WHEN has_valid_priority = 1 THEN 0 ELSE 1 END,
                      CASE WHEN has_valid_priority = 1 THEN priority_requested_at END,
                      CASE WHEN has_valid_priority = 0 THEN table_requested_at END,
                      user_id
                  ) AS seat_rank
           FROM candidates
         )
         UPDATE assignments
         SET table_id = CASE
               WHEN (SELECT seat_rank FROM ranked
                     WHERE ranked.assignment_id = assignments.assignment_id)
                    <= (SELECT capacity FROM ranked
                        WHERE ranked.assignment_id = assignments.assignment_id)
                 THEN desired_table_id ELSE NULL END,
             status = CASE
               WHEN (SELECT seat_rank FROM ranked
                     WHERE ranked.assignment_id = assignments.assignment_id)
                    <= (SELECT capacity FROM ranked
                        WHERE ranked.assignment_id = assignments.assignment_id)
                 THEN 'assigned' ELSE 'waitlisted' END,
             waitlist_position = CASE
               WHEN (SELECT seat_rank FROM ranked
                     WHERE ranked.assignment_id = assignments.assignment_id)
                    <= (SELECT capacity FROM ranked
                        WHERE ranked.assignment_id = assignments.assignment_id)
                 THEN NULL
               ELSE (SELECT seat_rank - capacity FROM ranked
                     WHERE ranked.assignment_id = assignments.assignment_id)
             END,
             assigned_at = CASE
               WHEN (SELECT seat_rank FROM ranked
                     WHERE ranked.assignment_id = assignments.assignment_id)
                    <= (SELECT capacity FROM ranked
                        WHERE ranked.assignment_id = assignments.assignment_id)
                 THEN CASE
                   WHEN status = 'assigned' AND table_id = desired_table_id
                     THEN assigned_at
                   ELSE (SELECT occurred_at FROM priority_seating_operations
                         WHERE guild_id = ? AND operation_key = ?)
                 END
               ELSE NULL END,
             updated_at = (SELECT occurred_at FROM priority_seating_operations
                           WHERE guild_id = ? AND operation_key = ?)
         WHERE assignment_id IN (SELECT assignment_id FROM ranked)`,
      )
      .bind(
        guildId,
        operationKey,
        guildId,
        operationKey,
        guildId,
        operationKey,
        guildId,
        operationKey,
        guildId,
        operationKey,
      );
  }

  private decisionEventsStatement(
    guildId: string,
    operationKey: string,
  ): D1PreparedStatement {
    return this.db
      .prepare(
        `INSERT OR IGNORE INTO priority_seating_events (
           seating_event_id, guild_id, operation_key, event_id, plan_id,
           table_id, assignment_id, user_id, priority_credit_id, action,
           reason_code, from_status, to_status, from_waitlist_position,
           to_waitlist_position, actor_user_id, occurred_at
         )
         SELECT operation.operation_key || ':' || before_state.assignment_id || ':' ||
                  CASE
                    WHEN before_state.assignment_id = operation.assignment_id
                      AND operation.operation_kind = 'select_priority'
                      THEN 'priority_requested'
                    WHEN before_state.assignment_id = operation.assignment_id
                      AND operation.operation_kind = 'select_standard'
                      THEN 'requested'
                    WHEN before_state.assignment_id = operation.assignment_id
                      AND operation.operation_kind = 'release_priority'
                      THEN 'priority_released'
                    WHEN before_state.assignment_id = operation.assignment_id
                      AND operation.operation_kind = 'withdraw'
                      THEN 'withdrawn'
                    WHEN before_state.assignment_id = operation.assignment_id
                      AND operation.operation_kind = 'leave'
                      THEN 'left'
                    WHEN before_state.status = 'assigned'
                      AND assignment.status = 'waitlisted' THEN 'displaced'
                    WHEN before_state.status = 'waitlisted'
                      AND assignment.status = 'assigned' THEN 'promoted'
                    ELSE 'reranked'
                  END,
                operation.guild_id, operation.operation_key, operation.event_id,
                operation.plan_id,
                COALESCE(assignment.desired_table_id, before_state.desired_table_id),
                assignment.assignment_id, assignment.user_id,
                COALESCE(assignment.priority_credit_id,
                         before_state.priority_credit_id),
                CASE
                  WHEN before_state.assignment_id = operation.assignment_id
                    AND operation.operation_kind = 'select_priority'
                    THEN 'priority_requested'
                  WHEN before_state.assignment_id = operation.assignment_id
                    AND operation.operation_kind = 'select_standard'
                    THEN 'requested'
                  WHEN before_state.assignment_id = operation.assignment_id
                    AND operation.operation_kind = 'release_priority'
                    THEN 'priority_released'
                  WHEN before_state.assignment_id = operation.assignment_id
                    AND operation.operation_kind = 'withdraw' THEN 'withdrawn'
                  WHEN before_state.assignment_id = operation.assignment_id
                    AND operation.operation_kind = 'leave' THEN 'left'
                  WHEN before_state.status = 'assigned'
                    AND assignment.status = 'waitlisted' THEN 'displaced'
                  WHEN before_state.status = 'waitlisted'
                    AND assignment.status = 'assigned' THEN 'promoted'
                  ELSE 'reranked'
                END,
                CASE
                  WHEN before_state.assignment_id = operation.assignment_id
                    AND operation.operation_kind = 'select_priority'
                    THEN 'member_priority_request'
                  WHEN before_state.assignment_id = operation.assignment_id
                    AND operation.operation_kind = 'release_priority'
                    THEN 'explicit_priority_release'
                  WHEN before_state.status = 'assigned'
                    AND assignment.status = 'waitlisted'
                    AND operation.operation_kind = 'select_priority'
                    THEN 'dm_priority_displacement'
                  WHEN before_state.status = 'waitlisted'
                    AND assignment.status = 'assigned' THEN 'seat_opened'
                  ELSE operation.operation_kind
                END,
                before_state.status, assignment.status,
                before_state.waitlist_position, assignment.waitlist_position,
                operation.actor_user_id, operation.occurred_at
         FROM priority_seating_operations operation
         JOIN priority_seating_operation_members before_state
           ON before_state.guild_id = operation.guild_id
          AND before_state.operation_key = operation.operation_key
         JOIN assignments assignment
           ON assignment.assignment_id = before_state.assignment_id
         WHERE operation.guild_id = ? AND operation.operation_key = ?
           AND operation.completed_at IS NULL
           AND (
             before_state.assignment_id = operation.assignment_id
             OR before_state.status <> assignment.status
             OR COALESCE(before_state.desired_table_id, '') <>
                COALESCE(assignment.desired_table_id, '')
             OR COALESCE(before_state.waitlist_position, -1) <>
                COALESCE(assignment.waitlist_position, -1)
           )`,
      )
      .bind(guildId, operationKey);
  }

  private versionAndCompleteStatements(
    guildId: string,
    operationKey: string,
  ): D1PreparedStatement[] {
    return [
      this.db
        .prepare(
          `UPDATE weekly_events
           SET table_state_version = table_state_version + 1,
               updated_at = (
                 SELECT occurred_at FROM priority_seating_operations
                 WHERE guild_id = ? AND operation_key = ?
               )
           WHERE event_id = (
             SELECT event_id FROM priority_seating_operations
             WHERE guild_id = ? AND operation_key = ? AND completed_at IS NULL
           ) AND guild_id = ?`,
        )
        .bind(guildId, operationKey, guildId, operationKey, guildId),
      this.db
        .prepare(
          `UPDATE priority_seating_operations
           SET completed_at = occurred_at
           WHERE guild_id = ? AND operation_key = ? AND completed_at IS NULL`,
        )
        .bind(guildId, operationKey),
    ];
  }

  private async resultForOperation(
    input: {
      guildId: string;
      operationKey: string;
      operationKind: string;
      eventId: string;
      planId: string;
      userId?: string;
      tableId?: string;
      actorUserId?: string;
      reason?: string;
    },
    applied: boolean,
  ): Promise<PrioritySeatingMutationResult> {
    const operation = await this.getOperation(input.guildId, input.operationKey);
    if (!operation) throw new PrioritySeatingUnavailableError();
    if (
      operation.operation_kind !== input.operationKind ||
      operation.event_id !== input.eventId ||
      operation.plan_id !== input.planId ||
      operation.user_id !== (input.userId ?? null) ||
      (input.tableId !== undefined && operation.target_table_id !== input.tableId) ||
      operation.actor_user_id !== (input.actorUserId ?? null) ||
      operation.reason !== (input.reason ?? null)
    ) {
      throw new PrioritySeatingIdempotencyConflictError();
    }
    if (operation.completed_at === null) {
      throw new Error("The priority seating transaction did not complete");
    }
    const events = await this.listOperationEvents(input.guildId, input.operationKey);
    const assignment = input.userId
      ? await this.getAssignment(input.guildId, input.planId, input.userId)
      : null;
    const affectedTableIds = Array.from(
      new Set(
        [
          operation.target_table_id,
          operation.previous_desired_table_id,
          operation.previous_table_id,
          ...events.map((event) => event.tableId),
        ].filter((value): value is string => value !== null),
      ),
    ).sort();
    const eventAssignments = await Promise.all(
      events
        .filter((event) => event.action === "displaced" || event.action === "promoted")
        .map((event) => this.getAssignment(input.guildId, input.planId, event.userId)),
    );
    return {
      applied,
      replayed: !applied,
      assignment,
      events,
      displaced: eventAssignments.filter(
        (candidate): candidate is PrioritySeatingAssignment =>
          candidate !== null &&
          events.some(
            (event) => event.userId === candidate.userId && event.action === "displaced",
          ),
      ),
      promoted: eventAssignments.filter(
        (candidate): candidate is PrioritySeatingAssignment =>
          candidate !== null &&
          events.some(
            (event) => event.userId === candidate.userId && event.action === "promoted",
          ),
      ),
      affectedTableIds,
      priorityCreditId: operation.selected_credit_id,
    };
  }

  private selectionOperationStatement(
    input: SelectPrioritySeatInput,
    kind: "select_standard" | "select_priority",
    occurredAt: number,
  ): D1PreparedStatement {
    const chosenCredit =
      kind === "select_priority"
        ? `CASE
             WHEN expected.credit_id IS NOT NULL THEN (
               SELECT exact.credit_id
               FROM dm_priority_credits exact
               WHERE exact.credit_id = expected.credit_id
                 AND exact.guild_id = event.guild_id
                 AND exact.user_id = assignment.user_id
                 AND (
                   exact.status = 'available'
                   OR (
                     exact.status = 'reserved'
                     AND exact.target_event_id = event.event_id
                   )
                 )
                 AND exact.earned_at <= ${occurredAt}
                 AND exact.expires_at > ${occurredAt}
                 AND event.starts_at >= ${occurredAt}
                 AND event.starts_at < exact.expires_at
               LIMIT 1
             )
             ELSE COALESCE(
               (SELECT active.credit_id
                FROM dm_priority_credits active
                WHERE active.guild_id = event.guild_id
                  AND active.user_id = assignment.user_id
                  AND active.target_event_id = event.event_id
                  AND active.status = 'reserved'
                  AND active.earned_at <= ${occurredAt}
                  AND active.expires_at > ${occurredAt}
                  AND event.starts_at >= ${occurredAt}
                  AND event.starts_at < active.expires_at
                ORDER BY active.expires_at, active.earned_at, active.credit_id
                LIMIT 1),
               (SELECT available.credit_id
                FROM dm_priority_credits available
                WHERE available.guild_id = event.guild_id
                  AND available.user_id = assignment.user_id
                  AND available.status = 'available'
                  AND available.earned_at <= ${occurredAt}
                  AND available.expires_at > ${occurredAt}
                  AND event.starts_at >= ${occurredAt}
                  AND event.starts_at < available.expires_at
                ORDER BY available.expires_at, available.earned_at,
                         available.credit_id
                LIMIT 1)
             )
           END`
        : "NULL";
    const extraGuard =
      kind === "select_priority"
        ? "chosen_credit_id IS NOT NULL"
        : `NOT EXISTS (
             SELECT 1 FROM dm_priority_credits active
             WHERE active.guild_id = candidate.guild_id
               AND active.user_id = candidate.user_id
               AND active.target_event_id = candidate.event_id
               AND active.status = 'reserved'
               AND active.earned_at <= ${occurredAt}
               AND active.expires_at > ${occurredAt}
           )`;
    const expectedAssignmentId = kind === "select_priority"
      ? input.expectedAssignmentId ?? null
      : null;
    const expectedSeatRequestVersion = kind === "select_priority"
      ? input.expectedSeatRequestVersion ?? null
      : null;
    const expectedTableStateVersion = kind === "select_priority"
      ? input.expectedTableStateVersion ?? null
      : null;
    const expectedCreditId = kind === "select_priority"
      ? input.expectedCreditId ?? null
      : null;
    return this.db
      .prepare(
        `WITH expected(
           assignment_id, seat_request_version, table_state_version, credit_id
         ) AS (VALUES (?, ?, ?, ?)),
         candidate AS (
           SELECT event.guild_id, event.event_id, plan.plan_id,
                  target.table_id, assignment.assignment_id,
                  assignment.user_id, assignment.table_id AS previous_table_id,
                  assignment.desired_table_id AS previous_desired_table_id,
                  assignment.status AS previous_status,
                  assignment.waitlist_position AS previous_waitlist_position,
                  assignment.table_requested_at AS previous_table_requested_at,
                  assignment.priority_requested_at AS previous_priority_requested_at,
                  assignment.priority_credit_id AS previous_priority_credit_id,
                  assignment.seat_request_version AS previous_seat_request_version,
                  ${chosenCredit} AS chosen_credit_id
           FROM assignments assignment
           JOIN plans plan ON plan.plan_id = assignment.plan_id
           JOIN weekly_events event ON event.event_id = plan.event_id
           JOIN plan_tables target
             ON target.plan_id = plan.plan_id AND target.table_id = ?
           JOIN signups signup
             ON signup.event_id = event.event_id
            AND signup.user_id = assignment.user_id
           CROSS JOIN expected
           WHERE event.guild_id = ? AND event.event_id = ?
             AND plan.plan_id = ? AND plan.status = 'published'
             AND event.status = 'published'
             AND event.table_selection_closes_at > ?
              AND assignment.user_id = ? AND assignment.status <> 'withdrawn'
              AND signup.signup_kind = 'player' AND signup.status = 'active'
              AND COALESCE(signup.game_tier, 0) =
                  COALESCE(assignment.game_tier, 0)
              AND COALESCE(assignment.game_tier, 0) =
                  COALESCE(target.game_tier, 0)
             AND (
               expected.assignment_id IS NULL
               OR assignment.assignment_id = expected.assignment_id
             )
             AND (
               expected.seat_request_version IS NULL
               OR assignment.seat_request_version = expected.seat_request_version
             )
             AND (
               expected.table_state_version IS NULL
               OR event.table_state_version = expected.table_state_version
             )
         )
         INSERT INTO priority_seating_operations (
           guild_id, operation_key, operation_kind, event_id, plan_id,
           target_table_id, assignment_id, user_id, actor_user_id,
           selected_credit_id, previous_table_id, previous_desired_table_id,
           previous_status, previous_waitlist_position,
           previous_table_requested_at, previous_priority_requested_at,
           previous_priority_credit_id, previous_seat_request_version,
           occurred_at
         )
         SELECT guild_id, ?, '${kind}', event_id, plan_id, table_id,
                assignment_id, user_id, ?, chosen_credit_id,
                previous_table_id, previous_desired_table_id, previous_status,
                previous_waitlist_position, previous_table_requested_at,
                previous_priority_requested_at, previous_priority_credit_id,
                previous_seat_request_version, ?
         FROM candidate
         WHERE ${extraGuard}
         ON CONFLICT(guild_id, operation_key) DO NOTHING`,
      )
      .bind(
        expectedAssignmentId,
        expectedSeatRequestVersion,
        expectedTableStateVersion,
        expectedCreditId,
        input.tableId,
        input.guildId,
        input.eventId,
        input.planId,
        occurredAt,
        input.userId,
        input.operationKey,
        input.actorUserId,
        occurredAt,
      );
  }

  async selectStandardTable(
    input: SelectPrioritySeatInput,
  ): Promise<PrioritySeatingMutationResult> {
    return this.selectTable(input, "select_standard");
  }

  async selectTableWithPriority(
    input: SelectPrioritySeatInput,
  ): Promise<PrioritySeatingMutationResult> {
    return this.selectTable(input, "select_priority");
  }

  private async selectTable(
    input: SelectPrioritySeatInput,
    kind: "select_standard" | "select_priority",
  ): Promise<PrioritySeatingMutationResult> {
    for (const name of [
      "guildId",
      "eventId",
      "planId",
      "tableId",
      "userId",
      "actorUserId",
      "operationKey",
    ] as const) {
      requireIdentifier(input[name], name);
    }
    if (input.expectedAssignmentId !== undefined) {
      requireIdentifier(input.expectedAssignmentId, "expectedAssignmentId");
    }
    if (input.expectedCreditId !== undefined) {
      requireIdentifier(input.expectedCreditId, "expectedCreditId");
    }
    if (input.expectedSeatRequestVersion !== undefined) {
      requireExpectedVersion(
        input.expectedSeatRequestVersion,
        "expectedSeatRequestVersion",
      );
    }
    if (input.expectedTableStateVersion !== undefined) {
      requireExpectedVersion(
        input.expectedTableStateVersion,
        "expectedTableStateVersion",
      );
    }
    const occurredAt = this.now();
    const statements: D1PreparedStatement[] = [
      this.selectionOperationStatement(input, kind, occurredAt),
      this.snapshotAffectedStatement(input.guildId, input.operationKey),
    ];
    if (kind === "select_priority") {
      statements.push(
        this.db
          .prepare(
            `UPDATE dm_priority_credits
             SET status = 'reserved', target_event_id = ?,
                 target_assignment_id = NULL, reserved_at = ?, redeemed_at = NULL,
                 last_operation_key = ?, version = version + 1, updated_at = ?
             WHERE guild_id = ? AND credit_id = (
               SELECT selected_credit_id FROM priority_seating_operations
               WHERE guild_id = ? AND operation_key = ? AND completed_at IS NULL
             ) AND status = 'available'`,
          )
          .bind(
            input.eventId,
            occurredAt,
            `${input.operationKey}:reserve`,
            occurredAt,
            input.guildId,
            input.guildId,
            input.operationKey,
          ),
        this.db
          .prepare(
            `INSERT OR IGNORE INTO dm_priority_credit_events (
               credit_event_id, guild_id, credit_id, idempotency_key, action,
               from_status, to_status, credit_version, target_event_id,
               actor_user_id, occurred_at
             )
             SELECT ? || ':reserve', credit.guild_id, credit.credit_id,
                    ? || ':reserve', 'reserved', 'available', 'reserved',
                    credit.version, ?, ?, ?
             FROM dm_priority_credits credit
             WHERE credit.guild_id = ? AND credit.last_operation_key = ?`,
          )
          .bind(
            input.operationKey,
            input.operationKey,
            input.eventId,
            input.actorUserId,
            occurredAt,
            input.guildId,
            `${input.operationKey}:reserve`,
          ),
      );
    }
    statements.push(
      this.db
        .prepare(
          `UPDATE assignments
           SET table_id = NULL,
               desired_table_id = ?,
               status = 'waitlisted',
               waitlist_position = ${WAITLIST_SHIFT} + 1 + COALESCE((
                 SELECT MAX(candidate.waitlist_position)
                 FROM assignments candidate
                 JOIN priority_seating_operations operation
                   ON operation.plan_id = candidate.plan_id
                  AND operation.target_table_id = candidate.desired_table_id
                 WHERE operation.guild_id = ? AND operation.operation_key = ?
                   AND operation.completed_at IS NULL
                   AND candidate.assignment_id <> assignments.assignment_id
               ), 0),
               assigned_at = NULL,
               table_requested_at = CASE
                 WHEN desired_table_id = ? AND table_requested_at IS NOT NULL
                   THEN table_requested_at ELSE ? END,
               priority_requested_at = ${kind === "select_priority"
                 ? `CASE
                      WHEN desired_table_id = ?
                       AND priority_credit_id = (
                         SELECT selected_credit_id
                         FROM priority_seating_operations
                         WHERE guild_id = ? AND operation_key = ?
                       )
                       AND priority_requested_at IS NOT NULL
                        THEN priority_requested_at ELSE ? END`
                 : "NULL"},
               priority_credit_id = ${kind === "select_priority"
                 ? `(SELECT selected_credit_id FROM priority_seating_operations
                     WHERE guild_id = ? AND operation_key = ?)`
                 : "NULL"},
               seat_request_version = seat_request_version + 1,
               updated_at = ?
           WHERE assignment_id = (
             SELECT assignment_id FROM priority_seating_operations
             WHERE guild_id = ? AND operation_key = ? AND completed_at IS NULL
           )`,
        )
        .bind(
          ...(kind === "select_priority"
            ? [
                input.tableId,
                input.guildId,
                input.operationKey,
                input.tableId,
                occurredAt,
                input.tableId,
                input.guildId,
                input.operationKey,
                occurredAt,
                input.guildId,
                input.operationKey,
                occurredAt,
                input.guildId,
                input.operationKey,
              ]
            : [
                input.tableId,
                input.guildId,
                input.operationKey,
                input.tableId,
                occurredAt,
                occurredAt,
                input.guildId,
                input.operationKey,
              ]),
        ),
      this.shiftWaitlistsStatement(input.guildId, input.operationKey),
      this.rerankAffectedStatement(input.guildId, input.operationKey),
      this.decisionEventsStatement(input.guildId, input.operationKey),
      ...this.versionAndCompleteStatements(input.guildId, input.operationKey),
    );
    const results = await this.db.batch(statements);
    return this.resultForOperation(
      {
        ...input,
        operationKind: kind,
      },
      results[0]?.meta.changes === 1,
    );
  }

  private releaseOperationStatement(
    input: ReleasePrioritySeatInput,
    kind: "release_priority" | "leave" | "withdraw",
    occurredAt: number,
    reason: string,
  ): D1PreparedStatement {
    return this.db
      .prepare(
        `INSERT INTO priority_seating_operations (
           guild_id, operation_key, operation_kind, event_id, plan_id,
           target_table_id, assignment_id, user_id, actor_user_id, reason,
           selected_credit_id, previous_table_id, previous_desired_table_id,
           previous_status, previous_waitlist_position,
           previous_table_requested_at, previous_priority_requested_at,
           previous_priority_credit_id, previous_seat_request_version,
           occurred_at
         )
         SELECT event.guild_id, ?, '${kind}', event.event_id, plan.plan_id,
                assignment.desired_table_id, assignment.assignment_id,
                assignment.user_id, ?, ?, assignment.priority_credit_id,
                assignment.table_id, assignment.desired_table_id,
                assignment.status, assignment.waitlist_position,
                assignment.table_requested_at, assignment.priority_requested_at,
                assignment.priority_credit_id, assignment.seat_request_version, ?
         FROM assignments assignment
         JOIN plans plan ON plan.plan_id = assignment.plan_id
         JOIN weekly_events event ON event.event_id = plan.event_id
         WHERE event.guild_id = ? AND event.event_id = ? AND plan.plan_id = ?
           AND assignment.user_id = ? AND assignment.status IN ('assigned', 'waitlisted')
           AND plan.status ${kind === "release_priority"
             ? "IN ('published', 'superseded')"
             : "= 'published'"} AND event.status = 'published'
           AND (
             event.table_selection_closes_at > ?
             OR (? = 1 AND plan.status = 'superseded' AND ? = 'system')
           )
           AND (${kind === "release_priority"
             ? "assignment.priority_credit_id IS NOT NULL"
             : "1 = 1"})
         ON CONFLICT(guild_id, operation_key) DO NOTHING`,
      )
      .bind(
        input.operationKey,
        input.actorUserId,
        reason,
        occurredAt,
        input.guildId,
        input.eventId,
        input.planId,
        input.userId,
        occurredAt,
        kind === "release_priority" && input.allowAfterClose === true ? 1 : 0,
        input.actorUserId,
      );
  }

  async releasePriority(
    input: ReleasePrioritySeatInput,
  ): Promise<PrioritySeatingMutationResult> {
    return this.releaseOrLeave(input, "release_priority", false);
  }

  async leaveTable(
    input: LeavePrioritySeatInput,
  ): Promise<PrioritySeatingMutationResult> {
    return this.releaseOrLeave(
      input,
      input.withdraw ? "withdraw" : "leave",
      true,
    );
  }

  private async releaseOrLeave(
    input: ReleasePrioritySeatInput,
    kind: "release_priority" | "leave" | "withdraw",
    clearTable: boolean,
  ): Promise<PrioritySeatingMutationResult> {
    for (const key of [
      "guildId", "eventId", "planId", "userId", "actorUserId", "operationKey",
    ] as const) requireIdentifier(input[key], key);
    const reason = requireReason(input.reason);
    const occurredAt = this.now();
    const statements: D1PreparedStatement[] = [
      this.releaseOperationStatement(input, kind, occurredAt, reason),
      this.snapshotAffectedStatement(input.guildId, input.operationKey),
      this.db
        .prepare(
          `INSERT OR IGNORE INTO dm_priority_credit_events (
             credit_event_id, guild_id, credit_id, idempotency_key, action,
             from_status, to_status, credit_version, target_event_id,
             actor_user_id, reason, occurred_at
           )
           SELECT ? || ':refund', credit.guild_id, credit.credit_id,
                  ? || ':refund', 'refunded', 'reserved',
                  CASE WHEN ? < credit.expires_at THEN 'available' ELSE 'expired' END,
                  credit.version + 1, credit.target_event_id, ?, ?, ?
           FROM priority_seating_operations operation
           JOIN dm_priority_credits credit
             ON credit.credit_id = operation.selected_credit_id
            AND credit.guild_id = operation.guild_id
           WHERE operation.guild_id = ? AND operation.operation_key = ?
             AND operation.completed_at IS NULL AND credit.status = 'reserved'
             AND credit.target_event_id = operation.event_id`,
        )
        .bind(
          input.operationKey,
          input.operationKey,
          occurredAt,
          input.actorUserId,
          reason,
          occurredAt,
          input.guildId,
          input.operationKey,
        ),
      this.db
        .prepare(
          `UPDATE dm_priority_credits
           SET status = CASE WHEN ? < expires_at THEN 'available' ELSE 'expired' END,
               target_event_id = NULL, target_assignment_id = NULL,
               reserved_at = NULL, redeemed_at = NULL,
               last_operation_key = ? || ':refund',
               version = version + 1, updated_at = ?
           WHERE guild_id = ? AND credit_id = (
             SELECT selected_credit_id FROM priority_seating_operations
             WHERE guild_id = ? AND operation_key = ? AND completed_at IS NULL
           ) AND status = 'reserved'`,
        )
        .bind(
          occurredAt,
          input.operationKey,
          occurredAt,
          input.guildId,
          input.guildId,
          input.operationKey,
        ),
      this.db
        .prepare(
          `UPDATE assignments
           SET table_id = ${clearTable ? "NULL" : "table_id"},
               desired_table_id = ${clearTable ? "NULL" : "desired_table_id"},
               status = ${clearTable
                 ? kind === "withdraw" ? "'withdrawn'" : "'unassigned'"
                 : "status"},
               waitlist_position = ${clearTable ? "NULL" : "waitlist_position"},
               assigned_at = ${clearTable ? "NULL" : "assigned_at"},
               table_requested_at = ${clearTable ? "NULL" : "table_requested_at"},
               priority_requested_at = NULL, priority_credit_id = NULL,
               seat_request_version = seat_request_version + 1,
               updated_at = ?
           WHERE assignment_id = (
             SELECT assignment_id FROM priority_seating_operations
             WHERE guild_id = ? AND operation_key = ? AND completed_at IS NULL
           )`,
        )
        .bind(occurredAt, input.guildId, input.operationKey),
      this.shiftWaitlistsStatement(input.guildId, input.operationKey),
      this.rerankAffectedStatement(input.guildId, input.operationKey),
      this.decisionEventsStatement(input.guildId, input.operationKey),
      ...this.versionAndCompleteStatements(input.guildId, input.operationKey),
    ];
    const results = await this.db.batch(statements);
    return this.resultForOperation(
      {
        ...input,
        reason,
        operationKind: kind,
        tableId: undefined,
      },
      results[0]?.meta.changes === 1,
    );
  }

  async repairInvalidPriorityAssignments(
    input: RepairInvalidPrioritySeatingInput,
  ): Promise<PrioritySeatingMutationResult | null> {
    for (const key of [
      "guildId", "eventId", "planId", "actorUserId", "operationKey",
    ] as const) requireIdentifier(input[key], key);
    const reason = requireReason(input.reason);
    const occurredAt = this.now();
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO priority_seating_operations (
             guild_id, operation_key, operation_kind, event_id, plan_id,
             actor_user_id, reason, occurred_at
           )
           SELECT event.guild_id, ?, 'expire', event.event_id, plan.plan_id,
                  ?, ?, ?
           FROM plans plan
           JOIN weekly_events event ON event.event_id = plan.event_id
           WHERE event.guild_id = ? AND event.event_id = ? AND plan.plan_id = ?
             AND plan.status IN ('draft', 'published', 'superseded')
             AND event.status IN ('published', 'archived')
             AND EXISTS (
               SELECT 1
               FROM assignments assignment
               WHERE assignment.plan_id = plan.plan_id
                 AND assignment.priority_credit_id IS NOT NULL
                 AND NOT EXISTS (
                   SELECT 1 FROM dm_priority_credits credit
                   WHERE credit.credit_id = assignment.priority_credit_id
                     AND credit.guild_id = event.guild_id
                     AND credit.user_id = assignment.user_id
                     AND credit.status = 'reserved'
                     AND credit.target_event_id = event.event_id
                     AND credit.expires_at > ?
                 )
             )
           ON CONFLICT(guild_id, operation_key) DO NOTHING`,
        )
        .bind(
          input.operationKey,
          input.actorUserId,
          reason,
          occurredAt,
          input.guildId,
          input.eventId,
          input.planId,
          occurredAt,
        ),
      this.db
        .prepare(
          `INSERT OR IGNORE INTO priority_seating_operation_members (
             guild_id, operation_key, assignment_id, user_id, table_id,
             desired_table_id, status, waitlist_position, table_requested_at,
             priority_requested_at, priority_credit_id, seat_request_version
           )
           SELECT operation.guild_id, operation.operation_key,
                  assignment.assignment_id, assignment.user_id,
                  assignment.table_id, assignment.desired_table_id,
                  assignment.status, assignment.waitlist_position,
                  assignment.table_requested_at, assignment.priority_requested_at,
                  assignment.priority_credit_id, assignment.seat_request_version
           FROM priority_seating_operations operation
           JOIN assignments assignment ON assignment.plan_id = operation.plan_id
           WHERE operation.guild_id = ? AND operation.operation_key = ?
             AND operation.completed_at IS NULL
             AND assignment.status <> 'withdrawn'
             AND assignment.table_requested_at IS NOT NULL`,
        )
        .bind(input.guildId, input.operationKey),
      this.db
        .prepare(
          `UPDATE assignments
           SET priority_requested_at = NULL, priority_credit_id = NULL,
               seat_request_version = seat_request_version + 1, updated_at = ?
           WHERE plan_id = ? AND priority_credit_id IS NOT NULL
             AND EXISTS (
               SELECT 1 FROM priority_seating_operations operation
               WHERE operation.guild_id = ? AND operation.operation_key = ?
                 AND operation.completed_at IS NULL
             )
             AND NOT EXISTS (
               SELECT 1
               FROM dm_priority_credits credit
               JOIN priority_seating_operations operation
                 ON operation.guild_id = credit.guild_id
                AND operation.event_id = credit.target_event_id
               WHERE operation.guild_id = ? AND operation.operation_key = ?
                 AND operation.completed_at IS NULL
                 AND credit.credit_id = assignments.priority_credit_id
                 AND credit.user_id = assignments.user_id
                 AND credit.status = 'reserved'
                 AND credit.expires_at > operation.occurred_at
             )`,
        )
        .bind(
          occurredAt,
          input.planId,
          input.guildId,
          input.operationKey,
          input.guildId,
          input.operationKey,
        ),
      this.db
        .prepare(
          `UPDATE assignments SET waitlist_position = waitlist_position + ?
           WHERE plan_id = ? AND status = 'waitlisted'
             AND EXISTS (
               SELECT 1 FROM priority_seating_operations
               WHERE guild_id = ? AND operation_key = ? AND completed_at IS NULL
             )`,
        )
        .bind(WAITLIST_SHIFT, input.planId, input.guildId, input.operationKey),
      this.rerankWholePlanStatement(input.guildId, input.operationKey),
      this.db
        .prepare(
          `INSERT OR IGNORE INTO priority_seating_events (
             seating_event_id, guild_id, operation_key, event_id, plan_id,
             table_id, assignment_id, user_id, priority_credit_id, action,
             reason_code, from_status, to_status, from_waitlist_position,
             to_waitlist_position, actor_user_id, occurred_at
           )
           SELECT operation.operation_key || ':' || before_state.assignment_id || ':' ||
                    CASE
                      WHEN before_state.priority_credit_id IS NOT NULL
                       AND assignment.priority_credit_id IS NULL
                       AND (credit.status = 'expired'
                         OR credit.expires_at <= operation.occurred_at)
                        THEN 'expired'
                      WHEN before_state.priority_credit_id IS NOT NULL
                       AND assignment.priority_credit_id IS NULL
                        THEN 'priority_released'
                      WHEN before_state.status = 'assigned'
                       AND assignment.status = 'waitlisted' THEN 'displaced'
                      WHEN before_state.status = 'waitlisted'
                       AND assignment.status = 'assigned' THEN 'promoted'
                      ELSE 'reranked'
                    END,
                  operation.guild_id, operation.operation_key, operation.event_id,
                  operation.plan_id,
                  COALESCE(assignment.desired_table_id, before_state.desired_table_id),
                  assignment.assignment_id, assignment.user_id,
                  before_state.priority_credit_id,
                  CASE
                    WHEN before_state.priority_credit_id IS NOT NULL
                     AND assignment.priority_credit_id IS NULL
                     AND (credit.status = 'expired'
                       OR credit.expires_at <= operation.occurred_at)
                      THEN 'expired'
                    WHEN before_state.priority_credit_id IS NOT NULL
                     AND assignment.priority_credit_id IS NULL
                      THEN 'priority_released'
                    WHEN before_state.status = 'assigned'
                     AND assignment.status = 'waitlisted' THEN 'displaced'
                    WHEN before_state.status = 'waitlisted'
                     AND assignment.status = 'assigned' THEN 'promoted'
                    ELSE 'reranked'
                  END,
                  CASE
                    WHEN before_state.priority_credit_id IS NOT NULL
                     AND assignment.priority_credit_id IS NULL
                     AND (credit.status = 'expired'
                       OR credit.expires_at <= operation.occurred_at)
                      THEN 'credit_expired'
                    WHEN before_state.priority_credit_id IS NOT NULL
                     AND assignment.priority_credit_id IS NULL
                      THEN 'invalid_priority_credit'
                    WHEN before_state.status = 'assigned'
                     AND assignment.status = 'waitlisted'
                      THEN 'invalid_priority_displacement'
                    WHEN before_state.status = 'waitlisted'
                     AND assignment.status = 'assigned' THEN 'seat_opened'
                    ELSE 'invalid_priority_rerank'
                  END,
                  before_state.status, assignment.status,
                  before_state.waitlist_position, assignment.waitlist_position,
                  operation.actor_user_id, operation.occurred_at
           FROM priority_seating_operations operation
           JOIN priority_seating_operation_members before_state
             ON before_state.guild_id = operation.guild_id
            AND before_state.operation_key = operation.operation_key
           JOIN assignments assignment
             ON assignment.assignment_id = before_state.assignment_id
           LEFT JOIN dm_priority_credits credit
             ON credit.credit_id = before_state.priority_credit_id
           WHERE operation.guild_id = ? AND operation.operation_key = ?
             AND operation.completed_at IS NULL
             AND (
               (before_state.priority_credit_id IS NOT NULL
                 AND assignment.priority_credit_id IS NULL)
               OR before_state.status <> assignment.status
               OR COALESCE(before_state.waitlist_position, -1) <>
                  COALESCE(assignment.waitlist_position, -1)
             )`,
        )
        .bind(input.guildId, input.operationKey),
      ...this.versionAndCompleteStatements(input.guildId, input.operationKey),
    ];
    const results = await this.db.batch(statements);
    const operation = await this.getOperation(input.guildId, input.operationKey);
    if (!operation) return null;
    return this.resultForOperation(
      {
        guildId: input.guildId,
        eventId: input.eventId,
        planId: input.planId,
        actorUserId: input.actorUserId,
        reason,
        operationKey: input.operationKey,
        operationKind: "expire",
      },
      results[0]?.meta.changes === 1,
    );
  }

  async settleEvent(
    input: SettlePrioritySeatingInput,
  ): Promise<PrioritySeatingMutationResult> {
    for (const [name, value] of Object.entries(input)) requireIdentifier(value, name);
    const occurredAt = this.now();
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO priority_seating_operations (
             guild_id, operation_key, operation_kind, event_id, plan_id,
             occurred_at
           )
           SELECT event.guild_id, ?, 'settle', event.event_id, plan.plan_id, ?
           FROM plans plan JOIN weekly_events event ON event.event_id = plan.event_id
           WHERE event.guild_id = ? AND event.event_id = ? AND plan.plan_id = ?
             AND plan.status = 'published' AND event.status IN ('published', 'archived')
             AND event.table_selection_closes_at <= ?
           ON CONFLICT(guild_id, operation_key) DO NOTHING`,
        )
        .bind(
          input.operationKey,
          occurredAt,
          input.guildId,
          input.eventId,
          input.planId,
          occurredAt,
        ),
      this.db
        .prepare(
          `INSERT OR IGNORE INTO priority_seating_operation_members (
             guild_id, operation_key, assignment_id, user_id, table_id,
             desired_table_id, status, waitlist_position, table_requested_at,
             priority_requested_at, priority_credit_id, seat_request_version
           )
           SELECT operation.guild_id, operation.operation_key,
                  assignment.assignment_id, assignment.user_id,
                  assignment.table_id, assignment.desired_table_id,
                  assignment.status, assignment.waitlist_position,
                  assignment.table_requested_at, assignment.priority_requested_at,
                  assignment.priority_credit_id, assignment.seat_request_version
           FROM priority_seating_operations operation
           JOIN assignments assignment ON assignment.plan_id = operation.plan_id
           WHERE operation.guild_id = ? AND operation.operation_key = ?
             AND operation.completed_at IS NULL
             AND assignment.status <> 'withdrawn'
             AND assignment.table_requested_at IS NOT NULL`,
        )
        .bind(input.guildId, input.operationKey),
      this.db
        .prepare(
          `INSERT OR IGNORE INTO dm_priority_credit_events (
             credit_event_id, guild_id, credit_id, idempotency_key, action,
             from_status, to_status, credit_version, target_event_id,
             reason, occurred_at
           )
           SELECT ? || ':expire:' || credit.credit_id, credit.guild_id,
                  credit.credit_id, ? || ':expire:' || credit.credit_id,
                  'expired', 'reserved', 'expired', credit.version + 1,
                  credit.target_event_id, 'exclusive expiry boundary reached', ?
           FROM priority_seating_operations operation
           JOIN assignments assignment ON assignment.plan_id = operation.plan_id
           JOIN dm_priority_credits credit
             ON credit.credit_id = assignment.priority_credit_id
            AND credit.guild_id = operation.guild_id
           WHERE operation.guild_id = ? AND operation.operation_key = ?
             AND operation.completed_at IS NULL AND credit.status = 'reserved'
             AND credit.target_event_id = operation.event_id
             AND credit.expires_at <= ?`,
        )
        .bind(
          input.operationKey,
          input.operationKey,
          occurredAt,
          input.guildId,
          input.operationKey,
          occurredAt,
        ),
      this.db
        .prepare(
          `UPDATE dm_priority_credits
           SET status = 'expired', target_event_id = NULL,
               target_assignment_id = NULL, reserved_at = NULL,
               redeemed_at = NULL,
               last_operation_key = ? || ':expire:' || credit_id,
               version = version + 1, updated_at = ?
           WHERE guild_id = ? AND status = 'reserved' AND expires_at <= ?
             AND target_event_id = ?
             AND EXISTS (
               SELECT 1 FROM dm_priority_credit_events transition
               WHERE transition.guild_id = dm_priority_credits.guild_id
                 AND transition.credit_id = dm_priority_credits.credit_id
                 AND transition.idempotency_key = ? || ':expire:' || credit_id
                 AND transition.credit_version = dm_priority_credits.version + 1
             )`,
        )
        .bind(
          input.operationKey,
          occurredAt,
          input.guildId,
          occurredAt,
          input.eventId,
          input.operationKey,
        ),
      this.db
        .prepare(
          `UPDATE assignments
           SET priority_requested_at = NULL, priority_credit_id = NULL,
               seat_request_version = seat_request_version + 1, updated_at = ?
           WHERE plan_id = ? AND priority_credit_id IS NOT NULL
             AND EXISTS (
               SELECT 1 FROM priority_seating_operations operation
               WHERE operation.guild_id = ? AND operation.operation_key = ?
                 AND operation.completed_at IS NULL
             )
             AND NOT EXISTS (
               SELECT 1
               FROM dm_priority_credits credit
               JOIN priority_seating_operations operation
                 ON operation.guild_id = credit.guild_id
                AND operation.event_id = credit.target_event_id
               WHERE operation.guild_id = ? AND operation.operation_key = ?
                 AND operation.completed_at IS NULL
                 AND credit.credit_id = assignments.priority_credit_id
                 AND credit.user_id = assignments.user_id
                 AND credit.status = 'reserved'
                 AND credit.expires_at > operation.occurred_at
             )`,
        )
        .bind(
          occurredAt,
          input.planId,
          input.guildId,
          input.operationKey,
          input.guildId,
          input.operationKey,
        ),
      this.db
        .prepare(
          `UPDATE assignments SET waitlist_position = waitlist_position + ?
           WHERE plan_id = ? AND status = 'waitlisted'
             AND EXISTS (
               SELECT 1 FROM priority_seating_operations
               WHERE guild_id = ? AND operation_key = ? AND completed_at IS NULL
             )`,
        )
        .bind(WAITLIST_SHIFT, input.planId, input.guildId, input.operationKey),
      this.rerankWholePlanStatement(input.guildId, input.operationKey),
      this.db
        .prepare(
          `INSERT OR IGNORE INTO dm_priority_credit_events (
             credit_event_id, guild_id, credit_id, idempotency_key, action,
             from_status, to_status, credit_version, target_event_id,
             target_assignment_id, occurred_at
           )
           SELECT ? || ':redeem:' || credit.credit_id, credit.guild_id,
                  credit.credit_id, ? || ':redeem:' || credit.credit_id,
                  'redeemed', 'reserved', 'redeemed', credit.version + 1,
                  credit.target_event_id, assignment.assignment_id, ?
           FROM priority_seating_operations operation
           JOIN assignments assignment ON assignment.plan_id = operation.plan_id
           JOIN dm_priority_credits credit
             ON credit.credit_id = assignment.priority_credit_id
            AND credit.guild_id = operation.guild_id
           WHERE operation.guild_id = ? AND operation.operation_key = ?
             AND operation.completed_at IS NULL
             AND assignment.status = 'assigned' AND credit.status = 'reserved'
             AND credit.target_event_id = operation.event_id
             AND credit.expires_at > ?`,
        )
        .bind(
          input.operationKey,
          input.operationKey,
          occurredAt,
          input.guildId,
          input.operationKey,
          occurredAt,
        ),
      this.db
        .prepare(
          `UPDATE dm_priority_credits
           SET status = 'redeemed',
               target_assignment_id = (
                 SELECT assignment_id FROM assignments
                 WHERE assignments.priority_credit_id = dm_priority_credits.credit_id
                   AND assignments.plan_id = ? AND assignments.status = 'assigned'
               ),
               redeemed_at = ?,
               last_operation_key = ? || ':redeem:' || credit_id,
               version = version + 1, updated_at = ?
           WHERE guild_id = ? AND target_event_id = ? AND status = 'reserved'
             AND EXISTS (
               SELECT 1 FROM dm_priority_credit_events transition
               WHERE transition.guild_id = dm_priority_credits.guild_id
                 AND transition.credit_id = dm_priority_credits.credit_id
                 AND transition.idempotency_key = ? || ':redeem:' || credit_id
                 AND transition.credit_version = dm_priority_credits.version + 1
             )`,
        )
        .bind(
          input.planId,
          occurredAt,
          input.operationKey,
          occurredAt,
          input.guildId,
          input.eventId,
          input.operationKey,
        ),
      this.db
        .prepare(
          `INSERT OR IGNORE INTO dm_priority_credit_events (
             credit_event_id, guild_id, credit_id, idempotency_key, action,
             from_status, to_status, credit_version, target_event_id,
             reason, occurred_at
           )
           SELECT ? || ':release:' || credit.credit_id, credit.guild_id,
                  credit.credit_id, ? || ':release:' || credit.credit_id,
                  'refunded', 'reserved',
                  CASE WHEN ? < credit.expires_at THEN 'available' ELSE 'expired' END,
                  credit.version + 1, credit.target_event_id,
                  'priority request was unseated at table-selection closure', ?
           FROM priority_seating_operations operation
           JOIN assignments assignment ON assignment.plan_id = operation.plan_id
           JOIN dm_priority_credits credit
             ON credit.credit_id = assignment.priority_credit_id
            AND credit.guild_id = operation.guild_id
           WHERE operation.guild_id = ? AND operation.operation_key = ?
             AND operation.completed_at IS NULL
             AND assignment.status = 'waitlisted' AND credit.status = 'reserved'
             AND credit.target_event_id = operation.event_id`,
        )
        .bind(
          input.operationKey,
          input.operationKey,
          occurredAt,
          occurredAt,
          input.guildId,
          input.operationKey,
        ),
      this.db
        .prepare(
          `UPDATE dm_priority_credits
           SET status = CASE WHEN ? < expires_at THEN 'available' ELSE 'expired' END,
               target_event_id = NULL, target_assignment_id = NULL,
               reserved_at = NULL, redeemed_at = NULL,
               last_operation_key = ? || ':release:' || credit_id,
               version = version + 1, updated_at = ?
           WHERE guild_id = ? AND target_event_id = ? AND status = 'reserved'
             AND EXISTS (
               SELECT 1 FROM dm_priority_credit_events transition
               WHERE transition.guild_id = dm_priority_credits.guild_id
                 AND transition.credit_id = dm_priority_credits.credit_id
                 AND transition.idempotency_key = ? || ':release:' || credit_id
                 AND transition.credit_version = dm_priority_credits.version + 1
             )`,
        )
        .bind(
          occurredAt,
          input.operationKey,
          occurredAt,
          input.guildId,
          input.eventId,
          input.operationKey,
        ),
      this.db
        .prepare(
          `UPDATE assignments
           SET priority_requested_at = NULL, priority_credit_id = NULL,
               seat_request_version = seat_request_version + 1, updated_at = ?
           WHERE plan_id = ? AND status = 'waitlisted'
             AND priority_credit_id IN (
               SELECT transition.credit_id FROM dm_priority_credit_events transition
               WHERE transition.guild_id = ? AND transition.idempotency_key =
                 ? || ':release:' || transition.credit_id
             )`,
        )
        .bind(occurredAt, input.planId, input.guildId, input.operationKey),
      this.db
        .prepare(
          `UPDATE assignments SET waitlist_position = waitlist_position + ?
           WHERE plan_id = ? AND status = 'waitlisted'
             AND EXISTS (
               SELECT 1 FROM priority_seating_operations
               WHERE guild_id = ? AND operation_key = ? AND completed_at IS NULL
             )`,
        )
        .bind(WAITLIST_SHIFT, input.planId, input.guildId, input.operationKey),
      this.rerankWholePlanStatement(input.guildId, input.operationKey),
      this.settlementEventsStatement(input.guildId, input.operationKey),
      ...this.versionAndCompleteStatements(input.guildId, input.operationKey),
    ];
    const results = await this.db.batch(statements);
    return this.resultForOperation(
      { ...input, operationKind: "settle" },
      results[0]?.meta.changes === 1,
    );
  }

  private rerankWholePlanStatement(
    guildId: string,
    operationKey: string,
  ): D1PreparedStatement {
    return this.db
      .prepare(
        `WITH candidates AS (
           SELECT assignment.assignment_id, table_slot.capacity,
                  assignment.desired_table_id,
                  assignment.priority_requested_at,
                  assignment.table_requested_at,
                  assignment.user_id,
                  CASE
                    WHEN assignment.priority_requested_at IS NOT NULL
                     AND credit.status = 'reserved'
                     AND credit.guild_id = operation.guild_id
                     AND credit.user_id = assignment.user_id
                     AND credit.target_event_id = operation.event_id
                     AND credit.expires_at > operation.occurred_at
                      THEN 1 ELSE 0
                  END AS has_valid_priority
           FROM assignments assignment
           JOIN plan_tables table_slot
             ON table_slot.table_id = assignment.desired_table_id
            AND table_slot.plan_id = assignment.plan_id
           JOIN priority_seating_operations operation
             ON operation.plan_id = assignment.plan_id
            AND operation.guild_id = ? AND operation.operation_key = ?
            AND operation.completed_at IS NULL
           LEFT JOIN dm_priority_credits credit
             ON credit.credit_id = assignment.priority_credit_id
           WHERE assignment.status <> 'withdrawn'
             AND assignment.desired_table_id IS NOT NULL
             AND assignment.table_requested_at IS NOT NULL
         ), ranked AS (
           SELECT assignment_id, capacity,
                  ROW_NUMBER() OVER (
                    PARTITION BY desired_table_id
                    ORDER BY
                      CASE WHEN has_valid_priority = 1 THEN 0 ELSE 1 END,
                      CASE WHEN has_valid_priority = 1 THEN priority_requested_at END,
                      CASE WHEN has_valid_priority = 0 THEN table_requested_at END,
                      user_id
                  ) AS seat_rank
           FROM candidates
         )
         UPDATE assignments
         SET table_id = CASE
               WHEN (SELECT seat_rank FROM ranked WHERE assignment_id = assignments.assignment_id)
                    <= (SELECT capacity FROM ranked WHERE assignment_id = assignments.assignment_id)
                 THEN desired_table_id ELSE NULL END,
             status = CASE
               WHEN (SELECT seat_rank FROM ranked WHERE assignment_id = assignments.assignment_id)
                    <= (SELECT capacity FROM ranked WHERE assignment_id = assignments.assignment_id)
                 THEN 'assigned' ELSE 'waitlisted' END,
             waitlist_position = CASE
               WHEN (SELECT seat_rank FROM ranked WHERE assignment_id = assignments.assignment_id)
                    <= (SELECT capacity FROM ranked WHERE assignment_id = assignments.assignment_id)
                 THEN NULL
               ELSE (SELECT seat_rank - capacity FROM ranked
                     WHERE assignment_id = assignments.assignment_id) END,
             assigned_at = CASE
               WHEN (SELECT seat_rank FROM ranked WHERE assignment_id = assignments.assignment_id)
                    <= (SELECT capacity FROM ranked WHERE assignment_id = assignments.assignment_id)
                 THEN COALESCE(assigned_at, (
                   SELECT occurred_at FROM priority_seating_operations
                   WHERE guild_id = ? AND operation_key = ?
                 )) ELSE NULL END,
             updated_at = (SELECT occurred_at FROM priority_seating_operations
                           WHERE guild_id = ? AND operation_key = ?)
         WHERE assignment_id IN (SELECT assignment_id FROM ranked)`,
      )
      .bind(guildId, operationKey, guildId, operationKey, guildId, operationKey);
  }

  private settlementEventsStatement(
    guildId: string,
    operationKey: string,
  ): D1PreparedStatement {
    return this.db
      .prepare(
        `INSERT OR IGNORE INTO priority_seating_events (
           seating_event_id, guild_id, operation_key, event_id, plan_id,
           table_id, assignment_id, user_id, priority_credit_id, action,
           reason_code, from_status, to_status, from_waitlist_position,
           to_waitlist_position, occurred_at
         )
         SELECT operation.operation_key || ':' || before_state.assignment_id || ':' ||
                  CASE
                    WHEN before_state.priority_credit_id IS NOT NULL
                     AND credit_event.action = 'redeemed' THEN 'priority_redeemed'
                    WHEN before_state.priority_credit_id IS NOT NULL
                     AND (credit_event.action = 'expired'
                       OR credit.status = 'expired'
                       OR credit.expires_at <= operation.occurred_at) THEN 'expired'
                    WHEN before_state.priority_credit_id IS NOT NULL
                     AND assignment.priority_credit_id IS NULL THEN 'priority_released'
                    WHEN before_state.status = 'assigned'
                     AND assignment.status = 'waitlisted' THEN 'displaced'
                    WHEN before_state.status = 'waitlisted'
                     AND assignment.status = 'assigned' THEN 'promoted'
                    ELSE 'reranked'
                  END,
                operation.guild_id, operation.operation_key, operation.event_id,
                operation.plan_id,
                COALESCE(assignment.desired_table_id, before_state.desired_table_id),
                assignment.assignment_id, assignment.user_id,
                before_state.priority_credit_id,
                CASE
                  WHEN before_state.priority_credit_id IS NOT NULL
                   AND credit_event.action = 'redeemed' THEN 'priority_redeemed'
                  WHEN before_state.priority_credit_id IS NOT NULL
                   AND (credit_event.action = 'expired'
                     OR credit.status = 'expired'
                     OR credit.expires_at <= operation.occurred_at) THEN 'expired'
                  WHEN before_state.priority_credit_id IS NOT NULL
                   AND assignment.priority_credit_id IS NULL THEN 'priority_released'
                  WHEN before_state.status = 'assigned'
                   AND assignment.status = 'waitlisted' THEN 'displaced'
                  WHEN before_state.status = 'waitlisted'
                   AND assignment.status = 'assigned' THEN 'promoted'
                  ELSE 'reranked'
                END,
                CASE
                  WHEN credit_event.action = 'redeemed' THEN 'selection_closed_assigned'
                  WHEN before_state.priority_credit_id IS NOT NULL
                   AND (credit_event.action = 'expired'
                     OR credit.status = 'expired'
                     OR credit.expires_at <= operation.occurred_at)
                    THEN 'credit_expired_before_settlement'
                  WHEN before_state.priority_credit_id IS NOT NULL
                   AND assignment.priority_credit_id IS NULL
                    THEN 'invalid_priority_before_settlement'
                  WHEN before_state.status = 'assigned'
                   AND assignment.status = 'waitlisted'
                    THEN 'settlement_rerank_displacement'
                  WHEN before_state.status = 'waitlisted'
                   AND assignment.status = 'assigned' THEN 'seat_opened'
                  ELSE 'settlement_rerank'
                END,
                before_state.status, assignment.status,
                before_state.waitlist_position, assignment.waitlist_position,
                operation.occurred_at
         FROM priority_seating_operations operation
         JOIN priority_seating_operation_members before_state
           ON before_state.guild_id = operation.guild_id
          AND before_state.operation_key = operation.operation_key
         JOIN assignments assignment
           ON assignment.assignment_id = before_state.assignment_id
         LEFT JOIN dm_priority_credit_events credit_event
           ON credit_event.guild_id = operation.guild_id
          AND credit_event.credit_id = before_state.priority_credit_id
          AND credit_event.idempotency_key IN (
            operation.operation_key || ':redeem:' || before_state.priority_credit_id,
            operation.operation_key || ':expire:' || before_state.priority_credit_id,
            operation.operation_key || ':release:' || before_state.priority_credit_id
          )
         LEFT JOIN dm_priority_credits credit
           ON credit.credit_id = before_state.priority_credit_id
         WHERE operation.guild_id = ? AND operation.operation_key = ?
           AND operation.completed_at IS NULL
           AND (
             before_state.priority_credit_id IS NOT NULL
             OR before_state.status <> assignment.status
             OR COALESCE(before_state.waitlist_position, -1) <>
                COALESCE(assignment.waitlist_position, -1)
           )`,
      )
      .bind(guildId, operationKey);
  }

  async cancelEvent(
    input: CancelPrioritySeatingInput,
  ): Promise<PrioritySeatingMutationResult> {
    for (const key of [
      "guildId", "eventId", "planId", "actorUserId", "operationKey",
    ] as const) requireIdentifier(input[key], key);
    const reason = requireReason(input.reason);
    const occurredAt = this.now();
    const statements = [
      this.db
        .prepare(
          `INSERT INTO priority_seating_operations (
             guild_id, operation_key, operation_kind, event_id, plan_id,
             actor_user_id, reason, occurred_at
           )
           SELECT event.guild_id, ?, 'cancel', event.event_id, plan.plan_id,
                  ?, ?, ?
           FROM plans plan JOIN weekly_events event ON event.event_id = plan.event_id
           WHERE event.guild_id = ? AND event.event_id = ? AND plan.plan_id = ?
           ON CONFLICT(guild_id, operation_key) DO NOTHING`,
        )
        .bind(
          input.operationKey,
          input.actorUserId,
          reason,
          occurredAt,
          input.guildId,
          input.eventId,
          input.planId,
        ),
      this.db
        .prepare(
          `INSERT OR IGNORE INTO priority_seating_operation_members (
             guild_id, operation_key, assignment_id, user_id, table_id,
             desired_table_id, status, waitlist_position, table_requested_at,
             priority_requested_at, priority_credit_id, seat_request_version
           )
           SELECT operation.guild_id, operation.operation_key,
                  assignment.assignment_id, assignment.user_id,
                  assignment.table_id, assignment.desired_table_id,
                  assignment.status, assignment.waitlist_position,
                  assignment.table_requested_at, assignment.priority_requested_at,
                  assignment.priority_credit_id, assignment.seat_request_version
           FROM priority_seating_operations operation
           JOIN assignments assignment ON assignment.plan_id = operation.plan_id
           WHERE operation.guild_id = ? AND operation.operation_key = ?
             AND operation.completed_at IS NULL
             AND assignment.priority_credit_id IS NOT NULL`,
        )
        .bind(input.guildId, input.operationKey),
      this.db
        .prepare(
          `INSERT OR IGNORE INTO dm_priority_credit_events (
             credit_event_id, guild_id, credit_id, idempotency_key, action,
             from_status, to_status, credit_version, target_event_id,
             target_assignment_id, actor_user_id, reason, occurred_at
           )
           SELECT ? || ':cancel:' || credit.credit_id, credit.guild_id,
                  credit.credit_id, ? || ':cancel:' || credit.credit_id,
                  'refunded', credit.status,
                  CASE WHEN ? < credit.expires_at THEN 'available' ELSE 'expired' END,
                  credit.version + 1, credit.target_event_id,
                  credit.target_assignment_id, ?, ?, ?
           FROM dm_priority_credits credit
           JOIN priority_seating_operations operation
             ON operation.guild_id = credit.guild_id
            AND operation.event_id = credit.target_event_id
           WHERE operation.guild_id = ? AND operation.operation_key = ?
             AND operation.completed_at IS NULL
             AND credit.status IN ('reserved', 'redeemed')`,
        )
        .bind(
          input.operationKey,
          input.operationKey,
          occurredAt,
          input.actorUserId,
          reason,
          occurredAt,
          input.guildId,
          input.operationKey,
        ),
      this.db
        .prepare(
          `UPDATE dm_priority_credits
           SET status = CASE WHEN ? < expires_at THEN 'available' ELSE 'expired' END,
               target_event_id = NULL, target_assignment_id = NULL,
               reserved_at = NULL, redeemed_at = NULL,
               last_operation_key = ? || ':cancel:' || credit_id,
               version = version + 1, updated_at = ?
           WHERE guild_id = ? AND target_event_id = ?
             AND status IN ('reserved', 'redeemed')
             AND EXISTS (
               SELECT 1 FROM dm_priority_credit_events transition
               WHERE transition.guild_id = dm_priority_credits.guild_id
                 AND transition.credit_id = dm_priority_credits.credit_id
                 AND transition.idempotency_key = ? || ':cancel:' || credit_id
                 AND transition.credit_version = dm_priority_credits.version + 1
             )`,
        )
        .bind(
          occurredAt,
          input.operationKey,
          occurredAt,
          input.guildId,
          input.eventId,
          input.operationKey,
        ),
      this.db
        .prepare(
          `UPDATE assignments
           SET priority_requested_at = NULL, priority_credit_id = NULL,
               seat_request_version = seat_request_version + 1, updated_at = ?
           WHERE plan_id = ? AND priority_credit_id IS NOT NULL
             AND EXISTS (
               SELECT 1 FROM priority_seating_operations
               WHERE guild_id = ? AND operation_key = ? AND completed_at IS NULL
             )`,
        )
        .bind(occurredAt, input.planId, input.guildId, input.operationKey),
      this.db
        .prepare(
          `INSERT OR IGNORE INTO priority_seating_events (
             seating_event_id, guild_id, operation_key, event_id, plan_id,
             table_id, assignment_id, user_id, priority_credit_id, action,
             reason_code, from_status, to_status, from_waitlist_position,
             to_waitlist_position, actor_user_id, occurred_at
           )
           SELECT operation.operation_key || ':' || before_state.assignment_id || ':cancelled',
                  operation.guild_id, operation.operation_key, operation.event_id,
                  operation.plan_id, before_state.desired_table_id,
                  before_state.assignment_id, before_state.user_id,
                  before_state.priority_credit_id, 'cancelled', 'event_cancelled',
                  before_state.status, assignment.status,
                  before_state.waitlist_position, assignment.waitlist_position,
                  operation.actor_user_id, operation.occurred_at
           FROM priority_seating_operations operation
           JOIN priority_seating_operation_members before_state
             ON before_state.guild_id = operation.guild_id
            AND before_state.operation_key = operation.operation_key
           JOIN assignments assignment
             ON assignment.assignment_id = before_state.assignment_id
           WHERE operation.guild_id = ? AND operation.operation_key = ?
             AND operation.completed_at IS NULL`,
        )
        .bind(input.guildId, input.operationKey),
      ...this.versionAndCompleteStatements(input.guildId, input.operationKey),
    ];
    const results = await this.db.batch(statements);
    return this.resultForOperation(
      {
        ...input,
        reason,
        operationKind: "cancel",
      },
      results[0]?.meta.changes === 1,
    );
  }

  async carryForwardPriorityRequest(
    input: CarryForwardPrioritySeatInput,
  ): Promise<PrioritySeatingMutationResult> {
    for (const [name, value] of Object.entries(input)) requireIdentifier(value, name);
    const occurredAt = this.now();
    const results = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO priority_seating_operations (
             guild_id, operation_key, operation_kind, event_id, plan_id,
             target_table_id, assignment_id, user_id, selected_credit_id,
             occurred_at
           )
           SELECT event.guild_id, ?, 'carry_forward', event.event_id,
                  next_plan.plan_id, next_table.table_id,
                  next_assignment.assignment_id, next_assignment.user_id,
                  previous_assignment.priority_credit_id, ?
           FROM assignments previous_assignment
           JOIN plans previous_plan
             ON previous_plan.plan_id = previous_assignment.plan_id
           JOIN plan_tables previous_table
             ON previous_table.table_id = previous_assignment.desired_table_id
           JOIN plans next_plan ON next_plan.event_id = previous_plan.event_id
            JOIN assignments next_assignment
              ON next_assignment.plan_id = next_plan.plan_id
             AND next_assignment.user_id = previous_assignment.user_id
             AND COALESCE(next_assignment.game_tier, 0) =
                 COALESCE(previous_assignment.game_tier, 0)
           JOIN plan_tables next_table
             ON next_table.plan_id = next_plan.plan_id
             AND next_table.gm_user_id = previous_table.gm_user_id
             AND next_table.table_id = next_assignment.desired_table_id
             AND COALESCE(next_table.game_tier, 0) =
                 COALESCE(previous_table.game_tier, 0)
             AND COALESCE(next_table.game_tier, 0) =
                 COALESCE(next_assignment.game_tier, 0)
           JOIN weekly_events event ON event.event_id = next_plan.event_id
           JOIN dm_priority_credits credit
             ON credit.credit_id = previous_assignment.priority_credit_id
            AND credit.guild_id = event.guild_id
            AND credit.user_id = previous_assignment.user_id
            AND credit.target_event_id = event.event_id
            AND credit.status = 'reserved'
            AND credit.expires_at > ?
           WHERE event.guild_id = ? AND event.event_id = ?
             AND previous_plan.plan_id = ? AND next_plan.plan_id = ?
             AND previous_assignment.assignment_id = ?
             AND next_assignment.assignment_id = ?
             AND previous_assignment.priority_requested_at IS NOT NULL
             AND previous_plan.status = 'superseded'
             AND next_plan.status = 'published'
             AND next_plan.generation > previous_plan.generation
             AND event.status = 'published'
           ON CONFLICT(guild_id, operation_key) DO NOTHING`,
        )
        .bind(
          input.operationKey,
          occurredAt,
          occurredAt,
          input.guildId,
          input.eventId,
          input.previousPlanId,
          input.nextPlanId,
          input.previousAssignmentId,
          input.nextAssignmentId,
        ),
      this.db
        .prepare(
          `UPDATE assignments
           SET table_requested_at = (
                 SELECT table_requested_at FROM assignments WHERE assignment_id = ?
               ),
               priority_requested_at = (
                 SELECT priority_requested_at FROM assignments WHERE assignment_id = ?
               ),
               priority_credit_id = (
                 SELECT priority_credit_id FROM assignments WHERE assignment_id = ?
               ),
               seat_request_version = seat_request_version + 1,
               updated_at = ?
           WHERE assignment_id = ? AND EXISTS (
             SELECT 1 FROM priority_seating_operations
             WHERE guild_id = ? AND operation_key = ? AND completed_at IS NULL
           )`,
        )
        .bind(
          input.previousAssignmentId,
          input.previousAssignmentId,
          input.previousAssignmentId,
          occurredAt,
          input.nextAssignmentId,
          input.guildId,
          input.operationKey,
        ),
      this.db
        .prepare(
          `INSERT OR IGNORE INTO priority_seating_events (
             seating_event_id, guild_id, operation_key, event_id, plan_id,
             table_id, assignment_id, user_id, priority_credit_id, action,
             reason_code, to_status, to_waitlist_position, occurred_at
           )
           SELECT operation.operation_key || ':' || assignment.assignment_id ||
                    ':carried_forward',
                  operation.guild_id, operation.operation_key, operation.event_id,
                  operation.plan_id, assignment.desired_table_id,
                  assignment.assignment_id, assignment.user_id,
                  assignment.priority_credit_id, 'carried_forward',
                  'same_active_gm', assignment.status,
                  assignment.waitlist_position, operation.occurred_at
           FROM priority_seating_operations operation
           JOIN assignments assignment
             ON assignment.assignment_id = operation.assignment_id
           WHERE operation.guild_id = ? AND operation.operation_key = ?
             AND operation.completed_at IS NULL`,
        )
        .bind(input.guildId, input.operationKey),
      ...this.versionAndCompleteStatements(input.guildId, input.operationKey),
    ]);
    return this.resultForOperation(
      {
        guildId: input.guildId,
        operationKey: input.operationKey,
        operationKind: "carry_forward",
        eventId: input.eventId,
        planId: input.nextPlanId,
        userId: (await this.getOperation(input.guildId, input.operationKey))?.user_id ?? undefined,
        tableId: (await this.getOperation(input.guildId, input.operationKey))?.target_table_id ?? undefined,
      },
      results[0]?.meta.changes === 1,
    );
  }
}
