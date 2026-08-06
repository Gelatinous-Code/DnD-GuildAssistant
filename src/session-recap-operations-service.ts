import type { SummarySessionService } from "./session-summary-service";
import type {
  RecapAdminEvent,
  RecapControlContext,
  RecapDeliveryStatus,
  RecapQualification,
  SessionRecapOperationsRepository,
} from "./storage/session-recap-operations-repository";

const DID_NOT_RUN_REASON = "The assigned DM reported that this session did not run.";
const MAX_REOPEN_HOURS = 24 * 7;

export type RecapAdminAction =
  | "retry_delivery"
  | "lock"
  | "reopen"
  | "hide"
  | "unhide"
  | "correction";

export interface RecapAdminStatus {
  context: RecapControlContext;
  qualification: RecapQualification | null;
  deliveries: RecapDeliveryStatus[];
  events: RecapAdminEvent[];
}

export class RecapControlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecapControlError";
  }
}

function defaultId(): string {
  return crypto.randomUUID();
}

function cleanReason(reason: string): string {
  const cleaned = reason.replace(/[\r\n]+/g, " ").trim();
  if (cleaned.length < 3) throw new RecapControlError("Provide an audit reason of at least 3 characters.");
  if (cleaned.length > 500) throw new RecapControlError("The audit reason cannot exceed 500 characters.");
  return cleaned;
}

function cleanCorrection(correction: string | undefined): string {
  const cleaned = correction?.trim() ?? "";
  if (cleaned.length < 3) {
    throw new RecapControlError("A public correction of at least 3 characters is required.");
  }
  if (cleaned.length > 1_000) {
    throw new RecapControlError("The public correction cannot exceed 1,000 characters.");
  }
  return cleaned;
}

export class SessionRecapOperationsService {
  private readonly now: () => number;
  private readonly id: () => string;

  constructor(
    private readonly repository: SessionRecapOperationsRepository,
    private readonly sessions: SummarySessionService,
    options: { now?: () => number; id?: () => string } = {},
  ) {
    this.now = options.now ?? Date.now;
    this.id = options.id ?? defaultId;
  }

  async pending(guildId: string, dmUserId: string): Promise<RecapControlContext[]> {
    return this.repository.listPendingForDm(guildId, dmUserId, 10);
  }

  async getForDm(summaryId: string, dmUserId: string): Promise<RecapControlContext> {
    const context = await this.repository.getBySummaryId(summaryId);
    if (!context) throw new RecapControlError("That session recap no longer exists.");
    if (context.dmUserId !== dmUserId) {
      throw new RecapControlError("Only the DM recorded for this session may update its recap.");
    }
    return context;
  }

  async reportDidNotRun(summaryId: string, dmUserId: string): Promise<RecapControlContext> {
    const context = await this.getForDm(summaryId, dmUserId);
    if (context.status !== "pending") {
      throw new RecapControlError("A submitted recap must be corrected by an admin.");
    }
    const idempotencyKey = `recap:not-run:${context.summaryId}`;
    if (await this.repository.hasOperation(context.guildId, idempotencyKey)) return context;
    const recoveredAfterConfirmation =
      context.currentResult === "cancelled" &&
      context.currentConfirmedByUserId === dmUserId &&
      context.currentReason === DID_NOT_RUN_REASON;
    if (!recoveredAfterConfirmation) {
      if (
        context.currentResult !== "completed" ||
        context.currentCompletionRevisionId !== context.completionRevisionId
      ) {
        throw new RecapControlError(
          "This recap is stale because an admin already changed the session result.",
        );
      }
      await this.sessions.confirmSession({
        guildId: context.guildId,
        eventId: context.sourceEventId,
        tableNumber: context.tableNumber,
        result: "cancelled",
        confirmedByUserId: dmUserId,
        reason: DID_NOT_RUN_REASON,
        idempotencyKey,
      });
    }
    await this.repository.recordDidNotRun({
      eventId: this.id(),
      summaryId: context.summaryId,
      guildId: context.guildId,
      actorUserId: dmUserId,
      reason: DID_NOT_RUN_REASON,
      idempotencyKey,
      now: this.now(),
    });
    return context;
  }

  async status(guildId: string, eventId: string, tableNumber: number): Promise<RecapAdminStatus> {
    const context = await this.repository.getCurrentByTable({ guildId, eventId, tableNumber });
    if (!context) throw new RecapControlError("No current recap exists for that table.");
    const [qualification, deliveries, events] = await Promise.all([
      this.repository.getQualification(context.summaryId),
      this.repository.listDeliveries(context.summaryId),
      this.repository.listEvents(context.summaryId),
    ]);
    return { context, qualification, deliveries, events };
  }

  async manage(input: {
    guildId: string;
    eventId: string;
    tableNumber: number;
    action: RecapAdminAction;
    actorUserId: string;
    reason: string;
    idempotencyKey: string;
    reopenHours?: number;
    publicCorrection?: string;
  }): Promise<RecapAdminStatus> {
    const context = await this.repository.getCurrentByTable(input);
    if (!context) throw new RecapControlError("No current recap exists for that table.");
    const reason = cleanReason(input.reason);
    const operationKey = `recap-admin:${input.action}:${input.idempotencyKey}`;
    if (!(await this.repository.hasOperation(input.guildId, operationKey))) {
      const common = {
        eventId: this.id(),
        summaryId: context.summaryId,
        guildId: input.guildId,
        actorUserId: input.actorUserId,
        reason,
        idempotencyKey: operationKey,
        now: this.now(),
      };
      switch (input.action) {
        case "retry_delivery":
          if (context.status !== "pending") {
            throw new RecapControlError("Delivery can only be retried while the recap is pending.");
          }
          await this.repository.retryPrompt(common);
          break;
        case "lock":
          await this.repository.lockEdits(common);
          break;
        case "reopen": {
          const hours = input.reopenHours ?? 24;
          if (!Number.isInteger(hours) || hours < 1 || hours > MAX_REOPEN_HOURS) {
            throw new RecapControlError("Reopen hours must be a whole number from 1 to 168.");
          }
          await this.repository.reopenEdits({
            ...common,
            editUntil: this.now() + hours * 60 * 60_000,
          });
          break;
        }
        case "hide":
          await this.repository.setVisibility({ ...common, visible: false });
          break;
        case "unhide":
          await this.repository.setVisibility({ ...common, visible: true });
          break;
        case "correction":
          if (context.status !== "submitted") {
            throw new RecapControlError("A public correction requires a submitted recap.");
          }
          await this.repository.appendCorrection({
            ...common,
            publicCorrection: cleanCorrection(input.publicCorrection),
          });
          break;
      }
    }
    return this.status(input.guildId, input.eventId, input.tableNumber);
  }
}
