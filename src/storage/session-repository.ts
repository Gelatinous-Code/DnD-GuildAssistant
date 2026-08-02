import type {
  SessionAttendanceOutcome,
  SessionCompletionResult,
  SessionParticipant,
  SessionParticipantRole,
} from "../domain/session-completion";

export type SessionRewardSyncStatus = "none" | "pending" | "synced" | "failed";

export interface FinalizedSessionSource {
  sessionGuildId: string;
  eventId: string;
  planId: string;
  tableId: string;
  tableNumber: number;
  plannedDmUserId: string;
  timezone: string;
  endsAt: number;
}

export interface SessionCompletion {
  sessionId: string;
  guildId: string;
  sourceEventId: string;
  sourcePlanId: string;
  sourceTableId: string;
  draftOpen: boolean;
  draftVersion: number;
  draftBaseRevisionId: string | null;
  draftOperationKey: string;
  rewardSyncRevisionId: string | null;
  rewardSyncStatus: SessionRewardSyncStatus;
  rewardSyncErrorKind: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface SessionCompletionRevision {
  completionRevisionId: string;
  sessionId: string;
  guildId: string;
  revisionNumber: number;
  result: SessionCompletionResult;
  actualDmUserId: string | null;
  earnedTimezone: string;
  confirmedByUserId: string;
  confirmedAt: number;
  reason: string | null;
  supersedesRevisionId: string | null;
  isCurrent: boolean;
  createdAt: number;
}

export interface EnsureSessionDraftInput {
  sessionId: string;
  sessionEventId: string;
  source: FinalizedSessionSource;
  actorUserId: string;
  idempotencyKey: string;
  occurredAt: number;
}

export interface SaveSessionDraftInput {
  sessionEventId: string;
  guildId: string;
  sessionId: string;
  expectedDraftVersion: number;
  participants: readonly SessionParticipant[];
  actorUserId: string;
  subjectUserId: string;
  reason: string | null;
  idempotencyKey: string;
  occurredAt: number;
}

export interface ConfirmSessionDraftInput {
  completionRevisionId: string;
  sessionEventId: string;
  guildId: string;
  sessionId: string;
  expectedDraftVersion: number;
  result: SessionCompletionResult;
  actualDmUserId: string | null;
  earnedTimezone: string;
  confirmedByUserId: string;
  confirmedAt: number;
  reason: string | null;
  idempotencyKey: string;
  participants: readonly SessionParticipant[];
}

export interface ConfirmSessionDraftResult {
  created: boolean;
  replayed: boolean;
  session: SessionCompletion;
  revision: SessionCompletionRevision;
  participants: SessionParticipant[];
}

type SessionRow = {
  session_id: string;
  guild_id: string;
  source_event_id: string;
  source_plan_id: string;
  source_table_id: string;
  draft_open: number;
  draft_version: number;
  draft_base_revision_id: string | null;
  draft_operation_key: string;
  reward_sync_revision_id: string | null;
  reward_sync_status: SessionRewardSyncStatus;
  reward_sync_error_kind: string | null;
  created_at: number;
  updated_at: number;
};

type SourceRow = {
  guild_id: string;
  event_id: string;
  plan_id: string;
  table_id: string;
  table_number: number;
  gm_user_id: string;
  timezone: string;
  ends_at: number;
};

type RevisionRow = {
  completion_revision_id: string;
  session_id: string;
  guild_id: string;
  revision_number: number;
  result: SessionCompletionResult;
  actual_dm_user_id: string | null;
  earned_timezone: string;
  confirmed_by_user_id: string;
  confirmed_at: number;
  reason: string | null;
  supersedes_revision_id: string | null;
  is_current: number;
  created_at: number;
};

type ParticipantRow = {
  user_id: string;
  participant_role: SessionParticipantRole;
  attendance_outcome: SessionAttendanceOutcome;
  replaces_user_id: string | null;
  was_planned: number;
  recorded_by_user_id: string;
  reason: string | null;
};

type SessionEventRow = {
  completion_revision_id: string | null;
  action: string;
};

function sessionFromRow(row: SessionRow): SessionCompletion {
  return {
    sessionId: row.session_id,
    guildId: row.guild_id,
    sourceEventId: row.source_event_id,
    sourcePlanId: row.source_plan_id,
    sourceTableId: row.source_table_id,
    draftOpen: row.draft_open === 1,
    draftVersion: row.draft_version,
    draftBaseRevisionId: row.draft_base_revision_id,
    draftOperationKey: row.draft_operation_key,
    rewardSyncRevisionId: row.reward_sync_revision_id,
    rewardSyncStatus: row.reward_sync_status,
    rewardSyncErrorKind: row.reward_sync_error_kind,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function revisionFromRow(row: RevisionRow): SessionCompletionRevision {
  return {
    completionRevisionId: row.completion_revision_id,
    sessionId: row.session_id,
    guildId: row.guild_id,
    revisionNumber: row.revision_number,
    result: row.result,
    actualDmUserId: row.actual_dm_user_id,
    earnedTimezone: row.earned_timezone,
    confirmedByUserId: row.confirmed_by_user_id,
    confirmedAt: row.confirmed_at,
    reason: row.reason,
    supersedesRevisionId: row.supersedes_revision_id,
    isCurrent: row.is_current === 1,
    createdAt: row.created_at,
  };
}

function participantFromRow(row: ParticipantRow): SessionParticipant {
  return {
    userId: row.user_id,
    role: row.participant_role,
    outcome: row.attendance_outcome,
    replacesUserId: row.replaces_user_id,
    wasPlanned: row.was_planned === 1,
    recordedByUserId: row.recorded_by_user_id,
    reason: row.reason,
  };
}
function canonicalParticipants(
  participants: readonly SessionParticipant[],
): Array<Record<string, string | boolean | null>> {
  return [...participants]
    .sort((left, right) =>
      left.role.localeCompare(right.role) || left.userId.localeCompare(right.userId)
    )
    .map((participant) => ({
      userId: participant.userId,
      role: participant.role,
      outcome: participant.outcome,
      replacesUserId: participant.replacesUserId,
      wasPlanned: participant.wasPlanned,
      recordedByUserId: participant.recordedByUserId,
      reason: participant.reason,
    }));
}

function attendanceReplayPayload(input: SaveSessionDraftInput): string {
  return JSON.stringify({
    actorUserId: input.actorUserId,
    subjectUserId: input.subjectUserId,
    reason: input.reason,
    participants: canonicalParticipants(input.participants),
  });
}

function confirmationReplayPayload(input: ConfirmSessionDraftInput): string {
  return JSON.stringify({
    result: input.result,
    actualDmUserId: input.actualDmUserId,
    earnedTimezone: input.earnedTimezone,
    confirmedByUserId: input.confirmedByUserId,
    confirmedAt: input.confirmedAt,
    reason: input.reason,
    participants: canonicalParticipants(input.participants),
  });
}


export class SessionCompletionConflictError extends Error {
  constructor(message = "The session completion changed; reload it and retry") {
    super(message);
    this.name = "SessionCompletionConflictError";
  }
}

export class SessionRepository {
  constructor(private readonly db: D1Database) {}

  async resolveFinalizedSource(
    guildId: string,
    eventId: string,
    tableNumber: number,
    at: number,
  ): Promise<FinalizedSessionSource | null> {
    const row = await this.db
      .prepare(
        `SELECT event.guild_id, event.event_id, plan.plan_id, table_row.table_id,
                table_row.table_number, table_row.gm_user_id, config.timezone,
                event.ends_at
         FROM weekly_events event
         JOIN guild_config config ON config.guild_id = event.guild_id
         JOIN plans plan
           ON plan.plan_id = event.finalized_plan_id
          AND plan.event_id = event.event_id
          AND plan.status = 'published'
         JOIN plan_tables table_row
           ON table_row.plan_id = plan.plan_id AND table_row.table_number = ?
         WHERE event.guild_id = ? AND event.event_id = ?
           AND event.status = 'archived' AND event.ends_at IS NOT NULL
           AND event.ends_at <= ? AND event.tables_finalized_at IS NOT NULL
           AND event.finalized_table_state_version = event.table_state_version`,
      )
      .bind(tableNumber, guildId, eventId, at)
      .first<SourceRow>();
    return row
      ? {
          sessionGuildId: row.guild_id,
          eventId: row.event_id,
          planId: row.plan_id,
          tableId: row.table_id,
          tableNumber: row.table_number,
          plannedDmUserId: row.gm_user_id,
          timezone: row.timezone,
          endsAt: row.ends_at,
        }
      : null;
  }

  async getSession(guildId: string, sessionId: string): Promise<SessionCompletion | null> {
    const row = await this.db
      .prepare("SELECT * FROM session_completions WHERE guild_id = ? AND session_id = ?")
      .bind(guildId, sessionId)
      .first<SessionRow>();
    return row ? sessionFromRow(row) : null;
  }

  async getSessionBySource(
    guildId: string,
    eventId: string,
    tableId: string,
  ): Promise<SessionCompletion | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM session_completions
         WHERE guild_id = ? AND source_event_id = ? AND source_table_id = ?`,
      )
      .bind(guildId, eventId, tableId)
      .first<SessionRow>();
    return row ? sessionFromRow(row) : null;
  }

  async getCurrentRevision(
    guildId: string,
    sessionId: string,
  ): Promise<SessionCompletionRevision | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM session_completion_revisions
         WHERE guild_id = ? AND session_id = ? AND is_current = 1`,
      )
      .bind(guildId, sessionId)
      .first<RevisionRow>();
    return row ? revisionFromRow(row) : null;
  }

  async getRevision(
    guildId: string,
    revisionId: string,
  ): Promise<SessionCompletionRevision | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM session_completion_revisions
         WHERE guild_id = ? AND completion_revision_id = ?`,
      )
      .bind(guildId, revisionId)
      .first<RevisionRow>();
    return row ? revisionFromRow(row) : null;
  }

  async listDraftParticipants(
    guildId: string,
    sessionId: string,
  ): Promise<SessionParticipant[]> {
    const result = await this.db
      .prepare(
        `SELECT user_id, participant_role, attendance_outcome, replaces_user_id,
                was_planned, recorded_by_user_id, reason
         FROM session_completion_draft_participants
         WHERE guild_id = ? AND session_id = ?
         ORDER BY participant_role ASC, user_id ASC`,
      )
      .bind(guildId, sessionId)
      .all<ParticipantRow>();
    return result.results.map(participantFromRow);
  }

  async listRevisionParticipants(
    guildId: string,
    revisionId: string,
  ): Promise<SessionParticipant[]> {
    const result = await this.db
      .prepare(
        `SELECT user_id, participant_role, attendance_outcome, replaces_user_id,
                was_planned, recorded_by_user_id, reason
         FROM session_completion_participants
         WHERE guild_id = ? AND completion_revision_id = ?
         ORDER BY participant_role ASC, user_id ASC`,
      )
      .bind(guildId, revisionId)
      .all<ParticipantRow>();
    return result.results.map(participantFromRow);
  }

  async ensureDraft(input: EnsureSessionDraftInput): Promise<SessionCompletion> {
    let session = await this.getSessionBySource(
      input.source.sessionGuildId,
      input.source.eventId,
      input.source.tableId,
    );
    if (!session) {
      await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO session_completions (
               session_id, guild_id, source_event_id, source_plan_id,
               source_table_id, draft_operation_key, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(guild_id, source_event_id, source_table_id) DO NOTHING`,
          )
          .bind(
            input.sessionId,
            input.source.sessionGuildId,
            input.source.eventId,
            input.source.planId,
            input.source.tableId,
            input.idempotencyKey,
            input.occurredAt,
            input.occurredAt,
          ),
        this.db
          .prepare(
            `INSERT INTO session_completion_draft_participants (
               session_id, guild_id, user_id, participant_role,
               attendance_outcome, was_planned, recorded_by_user_id, updated_at
             )
             SELECT session.session_id, session.guild_id, table_row.gm_user_id,
                    'dm', 'attended', 1, ?, ?
             FROM session_completions session
             JOIN plan_tables table_row ON table_row.table_id = session.source_table_id
             WHERE session.session_id = ? AND session.guild_id = ?
               AND session.draft_operation_key = ?
             ON CONFLICT(session_id, participant_role, user_id) DO NOTHING`,
          )
          .bind(
            input.actorUserId,
            input.occurredAt,
            input.sessionId,
            input.source.sessionGuildId,
            input.idempotencyKey,
          ),
        this.db
          .prepare(
            `INSERT INTO session_completion_draft_participants (
               session_id, guild_id, user_id, participant_role,
               attendance_outcome, was_planned, recorded_by_user_id, updated_at
             )
             SELECT session.session_id, session.guild_id, assignment.user_id,
                    'player', 'attended', 1, ?, ?
             FROM session_completions session
             JOIN assignments assignment
               ON assignment.plan_id = session.source_plan_id
              AND assignment.table_id = session.source_table_id
              AND assignment.status = 'assigned'
             WHERE session.session_id = ? AND session.guild_id = ?
               AND session.draft_operation_key = ?
             ON CONFLICT(session_id, participant_role, user_id) DO NOTHING`,
          )
          .bind(
            input.actorUserId,
            input.occurredAt,
            input.sessionId,
            input.source.sessionGuildId,
            input.idempotencyKey,
          ),
        this.db
          .prepare(
            `INSERT INTO session_completion_events (
               session_event_id, session_id, guild_id, idempotency_key,
               action, actor_user_id, details_json, occurred_at
             )
             SELECT ?, session_id, guild_id, ?, 'draft_created', ?, ?, ?
             FROM session_completions
             WHERE session_id = ? AND guild_id = ? AND draft_operation_key = ?
             ON CONFLICT(guild_id, idempotency_key) DO NOTHING`,
          )
          .bind(
            input.sessionEventId,
            input.idempotencyKey,
            input.actorUserId,
            JSON.stringify({
              eventId: input.source.eventId,
              planId: input.source.planId,
              tableId: input.source.tableId,
            }),
            input.occurredAt,
            input.sessionId,
            input.source.sessionGuildId,
            input.idempotencyKey,
          ),
      ]);
      session = await this.getSessionBySource(
        input.source.sessionGuildId,
        input.source.eventId,
        input.source.tableId,
      );
      if (!session) throw new Error("The session completion draft was not created");
    }

    if (session.draftOpen) return session;
    const base = await this.getCurrentRevision(session.guildId, session.sessionId);
    if (!base) throw new Error("A confirmed session is missing its current revision");
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE session_completions
           SET draft_open = 1, draft_version = draft_version + 1,
               draft_base_revision_id = ?, draft_operation_key = ?, updated_at = ?
           WHERE guild_id = ? AND session_id = ? AND draft_open = 0
             AND EXISTS (
               SELECT 1 FROM session_completion_revisions revision
               WHERE revision.completion_revision_id = ?
                 AND revision.session_id = session_completions.session_id
                 AND revision.is_current = 1
             )`,
        )
        .bind(
          base.completionRevisionId,
          input.idempotencyKey,
          input.occurredAt,
          session.guildId,
          session.sessionId,
          base.completionRevisionId,
        ),
      this.db
        .prepare(
          `DELETE FROM session_completion_draft_participants
           WHERE guild_id = ? AND session_id = ?
             AND EXISTS (
               SELECT 1 FROM session_completions session
               WHERE session.session_id = ? AND session.guild_id = ?
                 AND session.draft_operation_key = ? AND session.draft_open = 1
             )`,
        )
        .bind(
          session.guildId,
          session.sessionId,
          session.sessionId,
          session.guildId,
          input.idempotencyKey,
        ),
      this.db
        .prepare(
          `INSERT INTO session_completion_draft_participants (
             session_id, guild_id, user_id, participant_role,
             attendance_outcome, replaces_user_id, was_planned,
             recorded_by_user_id, reason, updated_at
           )
           SELECT participant.session_id, participant.guild_id,
                  participant.user_id, participant.participant_role,
                  CASE WHEN participant.attendance_outcome = 'cancelled'
                    THEN 'no_show' ELSE participant.attendance_outcome END,
                  participant.replaces_user_id, participant.was_planned,
                  participant.recorded_by_user_id, participant.reason, ?
           FROM session_completion_participants participant
           JOIN session_completions session
             ON session.session_id = participant.session_id
            AND session.guild_id = participant.guild_id
           WHERE participant.completion_revision_id = ?
             AND session.draft_operation_key = ? AND session.draft_open = 1`,
        )
        .bind(input.occurredAt, base.completionRevisionId, input.idempotencyKey),
      this.db
        .prepare(
          `INSERT INTO session_completion_events (
             session_event_id, session_id, guild_id, completion_revision_id,
             idempotency_key, action, actor_user_id, occurred_at
           )
           SELECT ?, session_id, guild_id, ?, ?, 'correction_draft_created', ?, ?
           FROM session_completions
           WHERE session_id = ? AND guild_id = ? AND draft_operation_key = ?
           ON CONFLICT(guild_id, idempotency_key) DO NOTHING`,
        )
        .bind(
          input.sessionEventId,
          base.completionRevisionId,
          input.idempotencyKey,
          input.actorUserId,
          input.occurredAt,
          session.sessionId,
          session.guildId,
          input.idempotencyKey,
        ),
    ]);
    const opened = await this.getSession(session.guildId, session.sessionId);
    if (!opened?.draftOpen) {
      throw new SessionCompletionConflictError("Another correction draft changed this session");
    }
    return opened;
  }

  async saveDraftParticipants(input: SaveSessionDraftInput): Promise<SessionCompletion> {
    const replayPayload = attendanceReplayPayload(input);
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `UPDATE session_completions
           SET draft_version = draft_version + 1, draft_operation_key = ?, updated_at = ?
           WHERE guild_id = ? AND session_id = ? AND draft_open = 1
             AND draft_version = ?
             AND NOT EXISTS (
               SELECT 1 FROM session_completion_events replay
               WHERE replay.guild_id = ? AND replay.idempotency_key = ?
             )`,
        )
        .bind(
          input.idempotencyKey,
          input.occurredAt,
          input.guildId,
          input.sessionId,
          input.expectedDraftVersion,
          input.guildId,
          input.idempotencyKey,
        ),
      this.db
        .prepare(
          `DELETE FROM session_completion_draft_participants
           WHERE guild_id = ? AND session_id = ?
             AND EXISTS (
               SELECT 1 FROM session_completions session
               WHERE session.session_id = ? AND session.guild_id = ?
                 AND session.draft_operation_key = ? AND session.draft_open = 1
             ) AND NOT EXISTS (
               SELECT 1 FROM session_completion_events replay
               WHERE replay.guild_id = ? AND replay.idempotency_key = ?
             )`,
        )
        .bind(
          input.guildId,
          input.sessionId,
          input.sessionId,
          input.guildId,
          input.idempotencyKey,
          input.guildId,
          input.idempotencyKey,
        ),
    ];
    for (const participant of input.participants) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO session_completion_draft_participants (
               session_id, guild_id, user_id, participant_role,
               attendance_outcome, replaces_user_id, was_planned,
               recorded_by_user_id, reason, updated_at
             )
             SELECT session_id, guild_id, ?, ?, ?, ?, ?, ?, ?, ?
             FROM session_completions
             WHERE session_id = ? AND guild_id = ? AND draft_open = 1
               AND draft_operation_key = ?
               AND NOT EXISTS (
                 SELECT 1 FROM session_completion_events replay
                 WHERE replay.guild_id = ? AND replay.idempotency_key = ?
               )`,
          )
          .bind(
            participant.userId,
            participant.role,
            participant.outcome,
            participant.replacesUserId,
            Number(participant.wasPlanned),
            participant.recordedByUserId,
            participant.reason,
            input.occurredAt,
            input.sessionId,
            input.guildId,
            input.idempotencyKey,
            input.guildId,
            input.idempotencyKey,
          ),
      );
    }
    statements.push(
      this.db
        .prepare(
          `INSERT INTO session_completion_events (
             session_event_id, session_id, guild_id, idempotency_key,
             action, actor_user_id, subject_user_id, details_json, occurred_at
           )
           SELECT ?, session_id, guild_id, ?, 'attendance_recorded', ?, ?, ?, ?
           FROM session_completions
           WHERE session_id = ? AND guild_id = ? AND draft_operation_key = ?
           ON CONFLICT(guild_id, idempotency_key) DO NOTHING`,
        )
        .bind(
          input.sessionEventId,
          input.idempotencyKey,
          input.actorUserId,
          input.subjectUserId,
          replayPayload,
          input.occurredAt,
          input.sessionId,
          input.guildId,
          input.idempotencyKey,
        ),
    );
    await this.db.batch(statements);
    const event = await this.db
      .prepare(
        `SELECT completion_revision_id, action, details_json FROM session_completion_events
         WHERE guild_id = ? AND idempotency_key = ?`,
      )
      .bind(input.guildId, input.idempotencyKey)
      .first<SessionEventRow & { details_json: string | null }>();
    if (!event || event.action !== "attendance_recorded" || event.details_json !== replayPayload) {
      throw new SessionCompletionConflictError();
    }
    const session = await this.getSession(input.guildId, input.sessionId);
    if (!session) throw new Error("The session completion draft disappeared");
    return session;
  }

  async confirmDraft(input: ConfirmSessionDraftInput): Promise<ConfirmSessionDraftResult> {
    const replayPayload = confirmationReplayPayload(input);
    const results = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO session_completion_revisions (
             completion_revision_id, session_id, guild_id, revision_number,
             result, actual_dm_user_id, earned_timezone, confirmed_by_user_id,
             confirmed_at, reason, supersedes_revision_id, is_current, created_at
           )
           SELECT ?, session.session_id, session.guild_id,
                  COALESCE((
                    SELECT MAX(revision_number) + 1
                    FROM session_completion_revisions existing
                    WHERE existing.session_id = session.session_id
                  ), 1),
                  ?, ?, ?, ?, ?, ?,
                  (SELECT completion_revision_id
                   FROM session_completion_revisions current
                   WHERE current.session_id = session.session_id AND current.is_current = 1),
                  0, ?
           FROM session_completions session
           WHERE session.guild_id = ? AND session.session_id = ?
             AND session.draft_open = 1 AND session.draft_version = ?
             AND NOT EXISTS (
               SELECT 1 FROM session_completion_events replay
               WHERE replay.guild_id = ? AND replay.idempotency_key = ?
             )`,
        )
        .bind(
          input.completionRevisionId,
          input.result,
          input.actualDmUserId,
          input.earnedTimezone,
          input.confirmedByUserId,
          input.confirmedAt,
          input.reason,
          input.confirmedAt,
          input.guildId,
          input.sessionId,
          input.expectedDraftVersion,
          input.guildId,
          input.idempotencyKey,
        ),
      this.db
        .prepare(
          `INSERT INTO session_completion_participants (
             completion_revision_id, session_id, guild_id, user_id,
             participant_role, attendance_outcome, replaces_user_id,
             was_planned, recorded_by_user_id, reason, recorded_at
           )
           SELECT revision.completion_revision_id, draft.session_id,
                  draft.guild_id, draft.user_id, draft.participant_role,
                  draft.attendance_outcome, draft.replaces_user_id,
                  draft.was_planned, draft.recorded_by_user_id,
                  draft.reason, ?
           FROM session_completion_draft_participants draft
           JOIN session_completion_revisions revision
             ON revision.completion_revision_id = ?
            AND revision.session_id = draft.session_id
            AND revision.guild_id = draft.guild_id`,
        )
        .bind(input.confirmedAt, input.completionRevisionId),
      this.db
        .prepare(
          `UPDATE session_completion_revisions SET is_current = 0
           WHERE guild_id = ? AND session_id = ? AND is_current = 1
             AND completion_revision_id <> ?
             AND EXISTS (
               SELECT 1 FROM session_completion_revisions next
               WHERE next.completion_revision_id = ?
             )`,
        )
        .bind(
          input.guildId,
          input.sessionId,
          input.completionRevisionId,
          input.completionRevisionId,
        ),
      this.db
        .prepare(
          `UPDATE session_completion_revisions SET is_current = 1
           WHERE guild_id = ? AND session_id = ? AND completion_revision_id = ?`,
        )
        .bind(input.guildId, input.sessionId, input.completionRevisionId),
      this.db
        .prepare(
          `UPDATE session_completions
           SET draft_open = 0, reward_sync_revision_id = ?,
               reward_sync_status = 'pending', reward_sync_error_kind = NULL,
               updated_at = ?
           WHERE guild_id = ? AND session_id = ?
             AND EXISTS (
               SELECT 1 FROM session_completion_revisions revision
               WHERE revision.completion_revision_id = ? AND revision.is_current = 1
             )`,
        )
        .bind(
          input.completionRevisionId,
          input.confirmedAt,
          input.guildId,
          input.sessionId,
          input.completionRevisionId,
        ),
      this.db
        .prepare(
          `INSERT INTO session_completion_events (
             session_event_id, session_id, guild_id, completion_revision_id,
             idempotency_key, action, actor_user_id, details_json, occurred_at
           )
           SELECT ?, revision.session_id, revision.guild_id,
                  revision.completion_revision_id, ?,
                  CASE WHEN revision.supersedes_revision_id IS NULL
                    THEN 'confirmed' ELSE 'corrected' END,
                  ?, ?, ?
           FROM session_completion_revisions revision
           WHERE revision.completion_revision_id = ?
           ON CONFLICT(guild_id, idempotency_key) DO NOTHING`,
        )
        .bind(
          input.sessionEventId,
          input.idempotencyKey,
          input.confirmedByUserId,
          replayPayload,
          input.confirmedAt,
          input.completionRevisionId,
        ),
    ]);
    const replayEvent = await this.db
      .prepare(
        `SELECT completion_revision_id, action, details_json
         FROM session_completion_events WHERE guild_id = ? AND idempotency_key = ?`,
      )
      .bind(input.guildId, input.idempotencyKey)
      .first<SessionEventRow & { details_json: string | null }>();

    let revision = await this.getRevision(input.guildId, input.completionRevisionId);
    if (!revision) {
      const event = await this.db
        .prepare(
          `SELECT completion_revision_id, action FROM session_completion_events
           WHERE guild_id = ? AND idempotency_key = ?`,
        )
        .bind(input.guildId, input.idempotencyKey)
        .first<SessionEventRow>();
      if (!event?.completion_revision_id) throw new SessionCompletionConflictError();
      revision = await this.getRevision(input.guildId, event.completion_revision_id);
    }
    if (
      !revision ||
      revision.sessionId !== input.sessionId ||
      revision.result !== input.result ||
      revision.actualDmUserId !== input.actualDmUserId ||
      revision.earnedTimezone !== input.earnedTimezone ||
      revision.confirmedByUserId !== input.confirmedByUserId ||
      revision.confirmedAt !== input.confirmedAt ||
      revision.reason !== input.reason ||
      !replayEvent || replayEvent.details_json !== replayPayload
    ) {
      throw new SessionCompletionConflictError(
        "The idempotency key is already associated with different completion data",
      );
    }
    const session = await this.getSession(input.guildId, input.sessionId);
    if (!session) throw new Error("The confirmed session disappeared");
    const participants = await this.listRevisionParticipants(
      input.guildId,
      revision.completionRevisionId,
    );
    if (
      JSON.stringify(canonicalParticipants(participants)) !==
        JSON.stringify(canonicalParticipants(input.participants))
    ) {
      throw new SessionCompletionConflictError(
        "The idempotency key is already associated with a different attendance snapshot",
      );
    }
    return {
      created: results[0]?.meta.changes === 1,
      replayed: results[0]?.meta.changes !== 1,
      session,
      revision,
      participants,
    };
  }

  async listRewardSyncDue(limit = 50): Promise<SessionCompletion[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new RangeError("limit must be an integer from 1 through 500");
    }
    const result = await this.db
      .prepare(
        `SELECT * FROM session_completions
         WHERE reward_sync_status IN ('pending', 'failed')
         ORDER BY updated_at ASC, session_id ASC LIMIT ?`,
      )
      .bind(limit)
      .all<SessionRow>();
    return result.results.map(sessionFromRow);
  }

  async markRewardSynced(input: {
    guildId: string;
    sessionId: string;
    revisionId: string;
    actorUserId: string;
    sessionEventId: string;
    idempotencyKey: string;
    occurredAt: number;
  }): Promise<boolean> {
    const results = await this.db.batch([
      this.db
        .prepare(
          `UPDATE session_completions
           SET reward_sync_status = 'synced', reward_sync_error_kind = NULL,
               reward_sync_revision_id = ?, updated_at = ?
           WHERE guild_id = ? AND session_id = ?
             AND reward_sync_revision_id = ?
             AND reward_sync_status IN ('pending', 'failed')
             AND EXISTS (
               SELECT 1 FROM session_completion_revisions revision
               WHERE revision.completion_revision_id = ?
                 AND revision.session_id = session_completions.session_id
                 AND revision.is_current = 1
             )`,
        )
        .bind(
          input.revisionId,
          input.occurredAt,
          input.guildId,
          input.sessionId,
          input.revisionId,
          input.revisionId,
        ),
      this.db
        .prepare(
          `INSERT INTO session_completion_events (
             session_event_id, session_id, guild_id, completion_revision_id,
             idempotency_key, action, actor_user_id, occurred_at
           )
           SELECT ?, session_id, guild_id, ?, ?, 'reward_synced', ?, ?
           FROM session_completions
           WHERE guild_id = ? AND session_id = ?
             AND reward_sync_status = 'synced' AND reward_sync_revision_id = ?
           ON CONFLICT(guild_id, idempotency_key) DO NOTHING`,
        )
        .bind(
          input.sessionEventId,
          input.revisionId,
          input.idempotencyKey,
          input.actorUserId,
          input.occurredAt,
          input.guildId,
          input.sessionId,
          input.revisionId,
        ),
    ]);
    return results[0]?.meta.changes === 1;
  }

  async markRewardFailed(input: {
    guildId: string;
    sessionId: string;
    revisionId: string;
    actorUserId: string;
    errorKind: string;
    sessionEventId: string;
    idempotencyKey: string;
    occurredAt: number;
  }): Promise<boolean> {
    const errorKind = input.errorKind.trim().slice(0, 200) || "unknown";
    const results = await this.db.batch([
      this.db
        .prepare(
          `UPDATE session_completions
           SET reward_sync_status = 'failed', reward_sync_error_kind = ?, updated_at = ?
           WHERE guild_id = ? AND session_id = ?
             AND reward_sync_revision_id = ?
             AND EXISTS (
               SELECT 1 FROM session_completion_revisions revision
               WHERE revision.completion_revision_id = ?
                 AND revision.session_id = session_completions.session_id
                 AND revision.is_current = 1
             )`,
        )
        .bind(
          errorKind,
          input.occurredAt,
          input.guildId,
          input.sessionId,
          input.revisionId,
          input.revisionId,
        ),
      this.db
        .prepare(
          `INSERT INTO session_completion_events (
             session_event_id, session_id, guild_id, completion_revision_id,
             idempotency_key, action, actor_user_id, details_json, occurred_at
           )
           SELECT ?, session_id, guild_id, ?, ?, 'reward_failed', ?, ?, ?
           FROM session_completions
           WHERE guild_id = ? AND session_id = ?
             AND reward_sync_status = 'failed' AND reward_sync_revision_id = ?
           ON CONFLICT(guild_id, idempotency_key) DO NOTHING`,
        )
        .bind(
          input.sessionEventId,
          input.revisionId,
          input.idempotencyKey,
          input.actorUserId,
          JSON.stringify({ errorKind }),
          input.occurredAt,
          input.guildId,
          input.sessionId,
          input.revisionId,
        ),
    ]);
    return results[0]?.meta.changes === 1;
  }
}
