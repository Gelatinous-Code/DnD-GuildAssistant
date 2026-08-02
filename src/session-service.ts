import {
  applySessionAttendanceDeviation,
  validateSessionCompletion,
  type SessionAttendanceDeviation,
  type SessionCompletionResult,
  type SessionParticipant,
} from "./domain/session-completion";
import type { PriorityService } from "./priority-service";
import type {
  DmPriorityGrant,
  PriorityRepository,
} from "./storage/priority-repository";
import {
  SessionCompletionConflictError,
  type FinalizedSessionSource,
  type SessionCompletion,
  type SessionCompletionRevision,
  type SessionRepository,
} from "./storage/session-repository";

export type SessionServiceRepository = Pick<
  SessionRepository,
  | "resolveFinalizedSource"
  | "getSessionBySource"
  | "getSession"
  | "getCurrentRevision"
  | "listDraftParticipants"
  | "listRevisionParticipants"
  | "ensureDraft"
  | "saveDraftParticipants"
  | "confirmDraft"
  | "listRewardSyncDue"
  | "markRewardSynced"
  | "markRewardFailed"
>;

export type SessionPriorityRepository = Pick<
  PriorityRepository,
  "getActiveGrantForSourceTable"
>;

export type SessionPriorityService = Pick<
  PriorityService,
  "grantCompletedSessionReward" | "correctGrant"
>;

export interface SessionServiceOptions {
  now?: () => number;
  id?: () => string;
}

export interface RecordSessionAttendanceInput extends SessionAttendanceDeviation {
  guildId: string;
  eventId: string;
  tableNumber: number;
  idempotencyKey: string;
}

export interface ConfirmSessionInput {
  guildId: string;
  eventId: string;
  tableNumber: number;
  result: SessionCompletionResult;
  confirmedByUserId: string;
  reason?: string | null;
  idempotencyKey: string;
}

export interface SessionStatus {
  source: FinalizedSessionSource;
  session: SessionCompletion | null;
  currentRevision: SessionCompletionRevision | null;
  participants: SessionParticipant[];
  view: "planned" | "draft" | "confirmed";
}

export interface RewardReconciliationResult {
  status: "synced" | "failed";
  revision: SessionCompletionRevision;
  activeGrant: DmPriorityGrant | null;
  errorKind?: string;
}

export interface ConfirmSessionResult {
  created: boolean;
  replayed: boolean;
  revision: SessionCompletionRevision;
  participants: SessionParticipant[];
  reward: RewardReconciliationResult;
}

export class SessionSourceUnavailableError extends Error {
  constructor() {
    super(
      "The table must belong to an ended, archived event with a current finalized roster",
    );
    this.name = "SessionSourceUnavailableError";
  }
}

function defaultId(): string {
  return crypto.randomUUID();
}

function requireIdentifier(value: string, fieldName: string): void {
  if (!value.trim()) throw new TypeError(`${fieldName} cannot be empty`);
}

function cleanReason(reason: string | null | undefined): string | null {
  const cleaned = reason?.replace(/[\r\n]+/g, " ").trim() ?? "";
  if (!cleaned) return null;
  if (cleaned.length > 500) throw new RangeError("reason cannot exceed 500 characters");
  return cleaned;
}

function errorKind(error: unknown): string {
  return error instanceof Error ? error.name.slice(0, 200) : typeof error;
}

export class SessionService {
  private readonly now: () => number;
  private readonly id: () => string;

  constructor(
    private readonly sessions: SessionServiceRepository,
    private readonly priorityRepository: SessionPriorityRepository,
    private readonly priority: SessionPriorityService,
    options: SessionServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.id = options.id ?? defaultId;
  }

  private async source(
    guildId: string,
    eventId: string,
    tableNumber: number,
  ): Promise<FinalizedSessionSource> {
    requireIdentifier(guildId, "guildId");
    requireIdentifier(eventId, "eventId");
    if (!Number.isInteger(tableNumber) || tableNumber < 1) {
      throw new RangeError("tableNumber must be a positive integer");
    }
    const source = await this.sessions.resolveFinalizedSource(
      guildId,
      eventId,
      tableNumber,
      this.now(),
    );
    if (!source) throw new SessionSourceUnavailableError();
    return source;
  }

  private async ensureDraft(
    source: FinalizedSessionSource,
    actorUserId: string,
    idempotencyKey: string,
  ): Promise<SessionCompletion> {
    const now = this.now();
    return this.sessions.ensureDraft({
      sessionId: this.id(),
      sessionEventId: this.id(),
      source,
      actorUserId,
      idempotencyKey: `session:draft:${idempotencyKey}`,
      occurredAt: now,
    });
  }

  async status(
    guildId: string,
    eventId: string,
    tableNumber: number,
  ): Promise<SessionStatus> {
    const source = await this.source(guildId, eventId, tableNumber);
    const session = await this.sessions.getSessionBySource(
      guildId,
      eventId,
      source.tableId,
    );
    if (!session) {
      return {
        source,
        session: null,
        currentRevision: null,
        participants: [],
        view: "planned",
      };
    }
    if (session.draftOpen) {
      return {
        source,
        session,
        currentRevision: await this.sessions.getCurrentRevision(guildId, session.sessionId),
        participants: await this.sessions.listDraftParticipants(guildId, session.sessionId),
        view: "draft",
      };
    }
    const currentRevision = await this.sessions.getCurrentRevision(guildId, session.sessionId);
    return {
      source,
      session,
      currentRevision,
      participants: currentRevision
        ? await this.sessions.listRevisionParticipants(
            guildId,
            currentRevision.completionRevisionId,
          )
        : [],
      view: "confirmed",
    };
  }

  async recordAttendance(
    input: RecordSessionAttendanceInput,
  ): Promise<SessionStatus> {
    requireIdentifier(input.recordedByUserId, "recordedByUserId");
    requireIdentifier(input.idempotencyKey, "idempotencyKey");
    const reason = cleanReason(input.reason);
    if (input.outcome !== "attended" && !reason) {
      throw new TypeError("A no-show, substitute, or walk-in requires an audit reason");
    }
    const source = await this.source(input.guildId, input.eventId, input.tableNumber);
    const session = await this.ensureDraft(
      source,
      input.recordedByUserId,
      input.idempotencyKey,
    );
    const participants = await this.sessions.listDraftParticipants(
      input.guildId,
      session.sessionId,
    );
    const next = applySessionAttendanceDeviation(participants, {
      userId: input.userId,
      role: input.role,
      outcome: input.outcome,
      replacesUserId: input.replacesUserId,
      recordedByUserId: input.recordedByUserId,
      reason,
    });
    const updated = await this.sessions.saveDraftParticipants({
      sessionEventId: this.id(),
      guildId: input.guildId,
      sessionId: session.sessionId,
      expectedDraftVersion: session.draftVersion,
      participants: next,
      actorUserId: input.recordedByUserId,
      subjectUserId: input.userId,
      reason,
      idempotencyKey: `session:attendance:${input.idempotencyKey}`,
      occurredAt: this.now(),
    });
    return {
      source,
      session: updated,
      currentRevision: await this.sessions.getCurrentRevision(
        input.guildId,
        updated.sessionId,
      ),
      participants: await this.sessions.listDraftParticipants(
        input.guildId,
        updated.sessionId,
      ),
      view: "draft",
    };
  }

  async confirmSession(input: ConfirmSessionInput): Promise<ConfirmSessionResult> {
    requireIdentifier(input.confirmedByUserId, "confirmedByUserId");
    requireIdentifier(input.idempotencyKey, "idempotencyKey");
    const reason = cleanReason(input.reason);
    const source = await this.source(input.guildId, input.eventId, input.tableNumber);
    let session = await this.sessions.getSessionBySource(
      input.guildId,
      input.eventId,
      source.tableId,
    );

    if (session && !session.draftOpen) {
      const current = await this.sessions.getCurrentRevision(input.guildId, session.sessionId);
      if (!current) throw new Error("The confirmed session has no current revision");
      if (current.result === input.result) {
        const participants = await this.sessions.listRevisionParticipants(
          input.guildId,
          current.completionRevisionId,
        );
        return {
          created: false,
          replayed: true,
          revision: current,
          participants,
          reward: await this.reconcileReward(input.guildId, session.sessionId),
        };
      }
      if (!reason) {
        throw new TypeError("Changing a confirmed result requires a correction reason");
      }
    }

    session = await this.ensureDraft(source, input.confirmedByUserId, input.idempotencyKey);
    if (session.draftBaseRevisionId && !reason) {
      throw new TypeError("Confirming a correction requires an audit reason");
    }
    if (input.result === "cancelled" && !reason) {
      throw new TypeError("Cancelling a session requires an audit reason");
    }
    const participants = await this.sessions.listDraftParticipants(
      input.guildId,
      session.sessionId,
    );
    const validated = validateSessionCompletion(input.result, participants);
    const confirmedAt = this.now();
    const saved = await this.sessions.confirmDraft({
      completionRevisionId: this.id(),
      sessionEventId: this.id(),
      guildId: input.guildId,
      sessionId: session.sessionId,
      expectedDraftVersion: session.draftVersion,
      result: input.result,
      actualDmUserId: validated.actualDmUserId,
      earnedTimezone: source.timezone,
      confirmedByUserId: input.confirmedByUserId,
      confirmedAt,
      participants,
      reason,
      idempotencyKey: `session:confirm:${session.sessionId}:${session.draftVersion}`,
    });
    return {
      created: saved.created,
      replayed: saved.replayed,
      revision: saved.revision,
      participants: saved.participants,
      reward: await this.reconcileReward(input.guildId, session.sessionId),
    };
  }

  async reconcileReward(
    guildId: string,
    sessionId: string,
  ): Promise<RewardReconciliationResult> {
    const session = await this.sessions.getSession(guildId, sessionId);
    if (!session) throw new Error("The session completion does not exist");
    const revision = await this.sessions.getCurrentRevision(guildId, sessionId);
    if (!revision) throw new Error("The session completion has no current revision");
    let activeGrant = await this.priorityRepository.getActiveGrantForSourceTable(
      guildId,
      session.sourceEventId,
      session.sourceTableId,
    );
    try {
      if (
        activeGrant &&
        (revision.result === "cancelled" || activeGrant.dmUserId !== revision.actualDmUserId)
      ) {
        await this.priority.correctGrant({
          guildId,
          grantId: activeGrant.grantId,
          actorUserId: revision.confirmedByUserId,
          reason:
            revision.reason ??
            (revision.result === "cancelled"
              ? "Organizer corrected the session to cancelled"
              : "Organizer corrected the actual DM"),
          idempotencyKey:
            `session:reward-correct:${activeGrant.grantId}:` +
            revision.completionRevisionId,
        });
        activeGrant = null;
      }

      if (revision.result === "completed" && !activeGrant) {
        if (!revision.actualDmUserId) {
          throw new Error("A completed session is missing its actual DM");
        }
        const granted = await this.priority.grantCompletedSessionReward({
          guildId,
          completionRevisionId: revision.completionRevisionId,
          sourceEventId: session.sourceEventId,
          sourcePlanId: session.sourcePlanId,
          sourceTableId: session.sourceTableId,
          dmUserId: revision.actualDmUserId,
          grantedByUserId: revision.confirmedByUserId,
          earnedTimeZone: revision.earnedTimezone,
          earnedAt: revision.confirmedAt,
          idempotencyKey: `dm-priority:grant:${revision.completionRevisionId}`,
        });
        activeGrant = granted.grant;
      }

      const syncedAt = this.now();
      await this.sessions.markRewardSynced({
        guildId,
        sessionId,
        revisionId: revision.completionRevisionId,
        actorUserId: revision.confirmedByUserId,
        sessionEventId: this.id(),
        idempotencyKey: `session:reward-synced:${revision.completionRevisionId}`,
        occurredAt: syncedAt,
      });
      return { status: "synced", revision, activeGrant };
    } catch (error) {
      const kind = errorKind(error);
      await this.sessions.markRewardFailed({
        guildId,
        sessionId,
        revisionId: revision.completionRevisionId,
        actorUserId: revision.confirmedByUserId,
        errorKind: kind,
        sessionEventId: this.id(),
        idempotencyKey: `session:reward-failed:${revision.completionRevisionId}`,
        occurredAt: this.now(),
      });
      return { status: "failed", revision, activeGrant, errorKind: kind };
    }
  }

  async reconcilePendingRewards(limit = 50): Promise<RewardReconciliationResult[]> {
    const due = await this.sessions.listRewardSyncDue(limit);
    const results: RewardReconciliationResult[] = [];
    for (const session of due) {
      results.push(await this.reconcileReward(session.guildId, session.sessionId));
    }
    return results;
  }
}

export { SessionCompletionConflictError };
