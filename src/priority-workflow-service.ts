import { UserFacingError } from "./interaction-utils";
import type { PriorityNotificationService } from "./priority-notification-service";
import type {
  PlanBundle,
  PlanTable,
  WeeklyEvent,
  GuildRepository,
} from "./storage/repository";
import {
  PrioritySeatingIdempotencyConflictError,
  PrioritySeatingUnavailableError,
  type PrioritySeatingAssignment,
  type PrioritySeatingMutationResult,
  type PrioritySeatingRepository,
} from "./storage/priority-seating-repository";
import type { WeekService } from "./week-service";
import { gameTierLabel } from "./domain/game-tier";

export interface PriorityTableContext {
  event: WeeklyEvent;
  bundle: PlanBundle;
  table: PlanTable;
  assignment: PrioritySeatingAssignment;
  tableIsFull: boolean;
}

export interface PriorityTableSelectionResult extends PriorityTableContext {
  mutation: PrioritySeatingMutationResult;
  message: string;
}

export interface PriorityWorkflowOptions {
  notifications?: Pick<PriorityNotificationService, "enqueueSeatingDecision">;
}

function selectionClosed(event: WeeklyEvent, now: number): UserFacingError {
  return new UserFacingError(
    "Table selection closed <t:" +
      Math.floor(Math.min(now, event.tableSelectionClosesAt) / 1000) +
      ":F>.",
  );
}

/**
 * Coordinates member-facing table actions around the single atomic D1 seating
 * transaction. Discord rendering happens only after D1 is authoritative.
 */
export class PriorityWorkflowService {
  private readonly now: () => number;
  private readonly notifications?: PriorityWorkflowOptions["notifications"];

  constructor(
    private readonly repository: GuildRepository,
    private readonly seating: PrioritySeatingRepository,
    private readonly week: WeekService,
    options: PriorityWorkflowOptions & { now?: () => number } = {},
  ) {
    this.now = options.now ?? Date.now;
    this.notifications = options.notifications;
  }

  private async context(input: {
    guildId: string;
    planId: string;
    tableId: string;
    userId: string;
  }): Promise<PriorityTableContext> {
    const plan = await this.repository.getPlan(input.planId);
    if (!plan || plan.status !== "published") {
      throw new UserFacingError("That table plan is not currently published.");
    }
    const event = await this.repository.getWeeklyEvent(plan.eventId);
    if (!event || event.guildId !== input.guildId) {
      throw new UserFacingError("That table plan does not belong to this server.");
    }
    if (event.status !== "published" || this.now() >= event.tableSelectionClosesAt) {
      throw selectionClosed(event, this.now());
    }
    const [signup, bundle, assignment] = await Promise.all([
      this.repository.getSignup(event.eventId, input.userId),
      this.repository.getPlanBundle(plan.planId),
      this.seating.getAssignment(input.guildId, plan.planId, input.userId),
    ]);
    if (!signup || signup.status !== "active" || signup.signupKind !== "player") {
      throw new UserFacingError(
        "Sign up as a player for this game before choosing or protecting a table.",
      );
    }
    if (!bundle) throw new UserFacingError("The published table plan is unavailable.");
    const table = bundle.tables.find((candidate) => candidate.tableId === input.tableId);
    if (!table) throw new UserFacingError("That table is no longer in the published plan.");
    if (!assignment || assignment.status === "withdrawn") {
      throw new UserFacingError(
        "Your player signup is not present in this table plan. Ask an organizer to refresh it.",
      );
    }
    const tierAssignment = bundle.assignments.find(
      (candidate) => candidate.userId === input.userId,
    );
    if (!tierAssignment) {
      throw new UserFacingError(
        "Your tier reservation is not present in this table plan. Ask an organizer to refresh it.",
      );
    }
    if (tierAssignment.gameTier !== table.gameTier) {
      throw new UserFacingError(
        `Your weekly signup is ${gameTierLabel(tierAssignment.gameTier)}. Priority tokens can only protect a table in that tier.`,
      );
    }
    const occupied = bundle.assignments.filter(
      (candidate) => candidate.status === "assigned" && candidate.tableId === table.tableId,
    ).length;
    return {
      event,
      bundle,
      table,
      assignment,
      tableIsFull: occupied >= table.capacity,
    };
  }

  async findCurrentTable(
    guildId: string,
    userId: string,
    tableNumber: number,
  ): Promise<PriorityTableContext> {
    if (!Number.isInteger(tableNumber) || tableNumber < 1) {
      throw new UserFacingError("table_number must be a positive integer.");
    }
    const event = await this.repository.getCurrentPublishedEvent(guildId);
    if (!event) throw new UserFacingError("There is no published week accepting table choices.");
    const plan = await this.repository.getCurrentPlan(event.eventId);
    if (!plan || plan.status !== "published") {
      throw new UserFacingError("The current week has no published table plan.");
    }
    const tables = await this.repository.listPlanTables(plan.planId);
    const table = tables.find((candidate) => candidate.tableNumber === tableNumber);
    if (!table) throw new UserFacingError("That table number is not in the current plan.");
    return this.context({ guildId, userId, planId: plan.planId, tableId: table.tableId });
  }

  async previewPriority(input: {
    guildId: string;
    planId: string;
    tableId: string;
    userId: string;
  }): Promise<PriorityTableContext> {
    return this.context(input);
  }

  private operationKey(
    action: string,
    context: PriorityTableContext,
    userId: string,
  ): string {
    return [
      "priority-seating",
      action,
      context.bundle.plan.planId,
      context.table.tableId,
      userId,
      "v" + context.assignment.seatRequestVersion,
    ].join(":");
  }

  private async enqueueSeatingNotifications(
    context: PriorityTableContext,
    mutation: PrioritySeatingMutationResult,
  ): Promise<void> {
    if (!this.notifications) return;
    const tableTitles = new Map(
      context.bundle.tables.map((table) => [table.tableId, table.title]),
    );
    for (const event of mutation.events) {
      if (event.action !== "displaced" && event.action !== "promoted") continue;
      await this.notifications.enqueueSeatingDecision({
        guildId: event.guildId,
        recipientUserId: event.userId,
        eventId: event.eventId,
        assignmentId: event.assignmentId,
        seatingEventId: event.seatingEventId,
        action: event.action,
        tableTitle: tableTitles.get(event.tableId ?? "") ?? context.table.title,
        gameTitle: context.event.title,
        occurredAt: event.occurredAt,
      });
    }
  }

  async select(input: {
    guildId: string;
    planId: string;
    tableId: string;
    userId: string;
    usePriority: boolean;
    confirmation?: {
      previewId: string;
      expectedAssignmentId: string;
      expectedSeatRequestVersion: number;
      expectedTableStateVersion: number;
      expectedCreditId: string;
    };
  }): Promise<PriorityTableSelectionResult> {
    const before = await this.context(input);
    const sameTable =
      before.assignment.desiredTableId === input.tableId &&
      before.assignment.tableRequestedAt !== null;
    const existingPriorityCreditId = before.assignment.priorityCreditId;
    const validExistingPriority = existingPriorityCreditId !== null
      ? await this.seating.hasValidPriorityReservation(
          input.guildId,
          before.event.eventId,
          input.planId,
          input.userId,
          existingPriorityCreditId,
        )
      : false;
    if (!input.usePriority && validExistingPriority) {
      throw new UserFacingError(
        "Release your current priority reservation before making an ordinary table choice.",
      );
    }
    const replayed =
      !input.confirmation &&
      sameTable &&
      (input.usePriority
        ? validExistingPriority
        : before.assignment.priorityCreditId === null);
    if (replayed) {
      const mutation: PrioritySeatingMutationResult = {
        applied: false,
        replayed: true,
        assignment: before.assignment,
        events: [],
        displaced: [],
        promoted: [],
        affectedTableIds: [input.tableId],
        priorityCreditId: before.assignment.priorityCreditId,
      };
      await this.week.refreshPublishedTables(before.event, before.bundle);
      return {
        ...before,
        mutation,
        message:
          before.assignment.status === "assigned"
            ? input.usePriority
              ? "Your token is already reserved and this seat is protected."
              : "You already joined this table."
            : input.usePriority
              ? "Your priority request is already on this table's waitlist."
              : "You are already on this table's waitlist.",
      };
    }
    const operationKey = input.confirmation
      ? "priority-seating:confirm:" + input.confirmation.previewId
      : this.operationKey(
          input.usePriority ? "priority" : "standard",
          before,
          input.userId,
        );
    let mutation: PrioritySeatingMutationResult;
    try {
      mutation = input.usePriority
        ? await this.seating.selectTableWithPriority({
            guildId: input.guildId,
            eventId: before.event.eventId,
            planId: input.planId,
            tableId: input.tableId,
            userId: input.userId,
            actorUserId: input.userId,
            operationKey,
            expectedAssignmentId: input.confirmation?.expectedAssignmentId,
            expectedSeatRequestVersion: input.confirmation?.expectedSeatRequestVersion,
            expectedTableStateVersion: input.confirmation?.expectedTableStateVersion,
            expectedCreditId: input.confirmation?.expectedCreditId,
          })
        : await this.seating.selectStandardTable({
            guildId: input.guildId,
            eventId: before.event.eventId,
            planId: input.planId,
            tableId: input.tableId,
            userId: input.userId,
            actorUserId: input.userId,
            operationKey,
          });
    } catch (error) {
      if (
        error instanceof PrioritySeatingUnavailableError ||
        error instanceof PrioritySeatingIdempotencyConflictError
      ) {
        throw new UserFacingError(
          input.confirmation
            ? "This confirmation preview is stale. Preview priority again before changing a seat."
            : input.usePriority
            ? "Your signup, token, table, or deadline changed. View priority status and retry."
            : "Your table choice changed concurrently. Refresh the table card and retry.",
        );
      }
      throw error;
    }
    if (!mutation.assignment) {
      throw new UserFacingError(
        input.usePriority
          ? "No unexpired available token could be reserved for this game."
          : "That table choice is no longer available.",
      );
    }
    await this.enqueueSeatingNotifications(before, mutation);
    const latest = await this.repository.getPlanBundle(input.planId);
    if (!latest) throw new UserFacingError("The published table plan could not be refreshed.");
    await this.week.refreshPublishedTables(before.event, latest);
    const assignment = mutation.assignment;
    const message = assignment.status === "assigned"
      ? input.usePriority
        ? "Your token is reserved and this seat is protected until the roster is finalized."
        : "You joined this table."
      : input.usePriority
        ? "Your priority request is waitlisted at position " +
          (assignment.waitlistPosition ?? "pending") +
          ". Its token will be released if no seat opens before finalization."
        : "This table is full; you are waitlisted at position " +
          (assignment.waitlistPosition ?? "pending") +
          ".";
    return {
      ...before,
      bundle: latest,
      assignment,
      tableIsFull:
        latest.assignments.filter(
          (candidate) => candidate.status === "assigned" && candidate.tableId === input.tableId,
        ).length >= before.table.capacity,
      mutation,
      message,
    };
  }

  async leave(input: {
    guildId: string;
    planId: string;
    tableId: string;
    userId: string;
  }): Promise<PriorityTableSelectionResult> {
    const before = await this.context(input);
    const mutation = await this.seating.leaveTable({
      guildId: input.guildId,
      eventId: before.event.eventId,
      planId: input.planId,
      userId: input.userId,
      actorUserId: input.userId,
      reason: "member left the selected table",
      operationKey: this.operationKey("leave", before, input.userId),
    });
    await this.enqueueSeatingNotifications(before, mutation);
    const latest = await this.repository.getPlanBundle(input.planId);
    if (!latest) throw new UserFacingError("The published table plan could not be refreshed.");
    await this.week.refreshPublishedTables(before.event, latest);
    return {
      ...before,
      bundle: latest,
      assignment: mutation.assignment ?? before.assignment,
      mutation,
      message: mutation.applied
        ? "You left the table. Any reserved priority token was released."
        : "You did not have an active table choice to leave.",
    };
  }

  async releasePriority(input: {
    guildId: string;
    planId: string;
    tableId: string;
    userId: string;
    reason?: string;
  }): Promise<PriorityTableSelectionResult> {
    const before = await this.context(input);
    const mutation = await this.seating.releasePriority({
      guildId: input.guildId,
      eventId: before.event.eventId,
      planId: input.planId,
      userId: input.userId,
      actorUserId: input.userId,
      reason: input.reason ?? "member explicitly released priority",
      operationKey: this.operationKey("release", before, input.userId),
    });
    await this.enqueueSeatingNotifications(before, mutation);
    const latest = await this.repository.getPlanBundle(input.planId);
    if (!latest) throw new UserFacingError("The published table plan could not be refreshed.");
    await this.week.refreshPublishedTables(before.event, latest);
    return {
      ...before,
      bundle: latest,
      assignment: mutation.assignment ?? before.assignment,
      mutation,
      message: mutation.applied
        ? "Priority was released. Your ordinary request keeps its original table-request time."
        : "You do not currently have priority reserved for this game.",
    };
  }

  async settle(event: WeeklyEvent, planId: string): Promise<PrioritySeatingMutationResult> {
    return this.seating.settleEvent({
      guildId: event.guildId,
      eventId: event.eventId,
      planId,
      operationKey: "priority-seating:settle:" + event.eventId + ":" + planId,
    });
  }

  async cancel(
    event: WeeklyEvent,
    planId: string,
    actorUserId: string,
    reason: string,
  ): Promise<PrioritySeatingMutationResult> {
    return this.seating.cancelEvent({
      guildId: event.guildId,
      eventId: event.eventId,
      planId,
      actorUserId,
      reason,
      operationKey: "priority-seating:cancel:" + event.eventId + ":" + planId,
    });
  }
}
