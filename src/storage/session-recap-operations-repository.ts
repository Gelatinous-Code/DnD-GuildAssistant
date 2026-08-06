export interface RecapControlContext {
  summaryId: string;
  guildId: string;
  sessionId: string;
  completionRevisionId: string;
  dmUserId: string;
  status: "pending" | "submitted";
  publicationStatus: "visible" | "hidden";
  authorEditStatus: "open" | "locked";
  firstSubmittedAt: number | null;
  editExpiresAt: number | null;
  dueAt: number;
  rewardPolicyVersion: string | null;
  sourceEventId: string;
  sourceTableId: string;
  eventTitle: string;
  startsAt: number;
  endsAt: number;
  tableNumber: number;
  tableTitle: string;
  gameTier: number | null;
  currentResult: "completed" | "cancelled" | null;
  currentCompletionRevisionId: string | null;
  currentConfirmedByUserId: string | null;
  currentReason: string | null;
}

export interface RecapQualification {
  qualificationId: string;
  qualification: "timely" | "late";
  timingPolicyVersion: string;
  rewardPolicyVersion: string;
  rewardStatus: "not_qualified" | "qualified_ungranted" | "granted" | "reversed" | "failed";
  firstSubmittedAt: number;
  dueAt: number;
}

export interface RecapDeliveryStatus {
  deliveryId: string;
  deliveryKind: "prompt" | "reminder";
  status: "pending" | "sent" | "failed" | "not_needed";
  attemptCount: number;
  repairCount: number;
  nextAttemptAt: number | null;
  lastErrorKind: string | null;
}

export interface RecapAdminEvent {
  eventKind: string;
  actorUserId: string;
  reason: string;
  publicCorrection: string | null;
  createdAt: number;
}

type ContextRow = {
  summary_id: string;
  guild_id: string;
  session_id: string;
  completion_revision_id: string;
  dm_user_id: string;
  status: RecapControlContext["status"];
  publication_status: RecapControlContext["publicationStatus"];
  author_edit_status: RecapControlContext["authorEditStatus"];
  first_submitted_at: number | null;
  edit_expires_at: number | null;
  due_at: number;
  reward_policy_version: string | null;
  source_event_id: string;
  source_table_id: string;
  event_title: string;
  starts_at: number;
  ends_at: number;
  table_number: number;
  table_title: string;
  game_tier: number | null;
  current_result: RecapControlContext["currentResult"];
  current_completion_revision_id: string | null;
  current_confirmed_by_user_id: string | null;
  current_reason: string | null;
};

type QualificationRow = {
  qualification_id: string;
  qualification: RecapQualification["qualification"];
  timing_policy_version: string;
  reward_policy_version: string;
  reward_status: RecapQualification["rewardStatus"];
  first_submitted_at: number;
  due_at: number;
};

type DeliveryRow = {
  delivery_id: string;
  delivery_kind: RecapDeliveryStatus["deliveryKind"];
  status: RecapDeliveryStatus["status"];
  attempt_count: number;
  repair_count: number;
  next_attempt_at: number | null;
  last_error_kind: string | null;
};

type EventRow = {
  event_kind: string;
  actor_user_id: string;
  reason: string;
  public_correction: string | null;
  created_at: number;
};

const CONTEXT_SELECT = `SELECT
  summary.summary_id, summary.guild_id, summary.session_id,
  summary.completion_revision_id, summary.dm_user_id, summary.status,
  summary.publication_status, summary.author_edit_status,
  summary.first_submitted_at, summary.edit_expires_at, summary.due_at,
  summary.reward_policy_version,
  session.source_event_id, session.source_table_id,
  event.title AS event_title, event.starts_at, event.ends_at,
  table_row.table_number, table_row.title AS table_title, table_row.game_tier,
  current_revision.result AS current_result,
  current_revision.completion_revision_id AS current_completion_revision_id,
  current_revision.confirmed_by_user_id AS current_confirmed_by_user_id,
  current_revision.reason AS current_reason
 FROM session_summaries summary
 JOIN session_completions session
   ON session.session_id = summary.session_id AND session.guild_id = summary.guild_id
 JOIN weekly_events event
   ON event.event_id = session.source_event_id AND event.guild_id = session.guild_id
 JOIN plan_tables table_row ON table_row.table_id = session.source_table_id
 LEFT JOIN session_completion_revisions current_revision
   ON current_revision.session_id = session.session_id
  AND current_revision.guild_id = session.guild_id
  AND current_revision.is_current = 1`;

function contextFromRow(row: ContextRow): RecapControlContext {
  return {
    summaryId: row.summary_id,
    guildId: row.guild_id,
    sessionId: row.session_id,
    completionRevisionId: row.completion_revision_id,
    dmUserId: row.dm_user_id,
    status: row.status,
    publicationStatus: row.publication_status,
    authorEditStatus: row.author_edit_status,
    firstSubmittedAt: row.first_submitted_at,
    editExpiresAt: row.edit_expires_at,
    dueAt: row.due_at,
    rewardPolicyVersion: row.reward_policy_version,
    sourceEventId: row.source_event_id,
    sourceTableId: row.source_table_id,
    eventTitle: row.event_title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    tableNumber: row.table_number,
    tableTitle: row.table_title,
    gameTier: row.game_tier,
    currentResult: row.current_result,
    currentCompletionRevisionId: row.current_completion_revision_id,
    currentConfirmedByUserId: row.current_confirmed_by_user_id,
    currentReason: row.current_reason,
  };
}

export class SessionRecapOperationsRepository {
  constructor(private readonly db: D1Database) {}

  async getBySummaryId(summaryId: string): Promise<RecapControlContext | null> {
    const row = await this.db.prepare(`${CONTEXT_SELECT} WHERE summary.summary_id = ?`)
      .bind(summaryId).first<ContextRow>();
    return row ? contextFromRow(row) : null;
  }

  async getCurrentByTable(input: {
    guildId: string;
    eventId: string;
    tableNumber: number;
  }): Promise<RecapControlContext | null> {
    const row = await this.db.prepare(
      `${CONTEXT_SELECT}
       WHERE summary.guild_id = ? AND session.source_event_id = ?
         AND table_row.table_number = ?
         AND current_revision.completion_revision_id = summary.completion_revision_id
       ORDER BY summary.created_at DESC LIMIT 1`,
    ).bind(input.guildId, input.eventId, input.tableNumber).first<ContextRow>();
    return row ? contextFromRow(row) : null;
  }

  async listPendingForDm(guildId: string, dmUserId: string, limit = 5) {
    const result = await this.db.prepare(
      `${CONTEXT_SELECT}
       WHERE summary.guild_id = ? AND summary.dm_user_id = ?
         AND summary.status = 'pending'
         AND current_revision.completion_revision_id = summary.completion_revision_id
         AND current_revision.result = 'completed'
       ORDER BY summary.due_at, summary.summary_id LIMIT ?`,
    ).bind(guildId, dmUserId, limit).all<ContextRow>();
    return result.results.map(contextFromRow);
  }

  async getQualification(summaryId: string): Promise<RecapQualification | null> {
    const row = await this.db.prepare(
      `SELECT * FROM session_summary_qualifications WHERE summary_id = ?`,
    ).bind(summaryId).first<QualificationRow>();
    return row ? {
      qualificationId: row.qualification_id,
      qualification: row.qualification,
      timingPolicyVersion: row.timing_policy_version,
      rewardPolicyVersion: row.reward_policy_version,
      rewardStatus: row.reward_status,
      firstSubmittedAt: row.first_submitted_at,
      dueAt: row.due_at,
    } : null;
  }

  async listDeliveries(summaryId: string): Promise<RecapDeliveryStatus[]> {
    const result = await this.db.prepare(
      `SELECT delivery_id, delivery_kind, status, attempt_count, repair_count,
              next_attempt_at, last_error_kind
       FROM session_summary_deliveries WHERE summary_id = ?
       ORDER BY delivery_kind`,
    ).bind(summaryId).all<DeliveryRow>();
    return result.results.map((row) => ({
      deliveryId: row.delivery_id,
      deliveryKind: row.delivery_kind,
      status: row.status,
      attemptCount: row.attempt_count,
      repairCount: row.repair_count,
      nextAttemptAt: row.next_attempt_at,
      lastErrorKind: row.last_error_kind,
    }));
  }

  async listEvents(summaryId: string, limit = 10): Promise<RecapAdminEvent[]> {
    const result = await this.db.prepare(
      `SELECT event_kind, actor_user_id, reason, public_correction, created_at
       FROM session_summary_admin_events WHERE summary_id = ?
       ORDER BY created_at DESC, summary_event_id DESC LIMIT ?`,
    ).bind(summaryId, limit).all<EventRow>();
    return result.results.map((row) => ({
      eventKind: row.event_kind,
      actorUserId: row.actor_user_id,
      reason: row.reason,
      publicCorrection: row.public_correction,
      createdAt: row.created_at,
    }));
  }

  async hasOperation(guildId: string, idempotencyKey: string): Promise<boolean> {
    return (await this.db.prepare(
      `SELECT 1 AS found FROM session_summary_admin_events
       WHERE guild_id = ? AND idempotency_key = ?`,
    ).bind(guildId, idempotencyKey).first<number>("found")) === 1;
  }

  async recordDidNotRun(input: {
    eventId: string;
    summaryId: string;
    guildId: string;
    actorUserId: string;
    reason: string;
    idempotencyKey: string;
    now: number;
  }): Promise<void> {
    await this.db.batch([
      this.db.prepare(
        `UPDATE session_summary_deliveries SET status = 'not_needed',
           next_attempt_at = NULL, discord_channel_id = NULL,
           discord_message_id = NULL, last_error_kind = NULL, updated_at = ?
         WHERE summary_id = ? AND guild_id = ? AND status IN ('pending', 'failed')`,
      ).bind(input.now, input.summaryId, input.guildId),
      this.eventStatement({ ...input, eventKind: "dm_reported_not_run" }),
    ]);
  }

  async retryPrompt(input: RecapOperationInput): Promise<void> {
    await this.db.batch([
      this.db.prepare(
        `UPDATE session_summary_deliveries SET status = 'pending', scheduled_for = ?,
           next_attempt_at = NULL, discord_channel_id = NULL, discord_message_id = NULL,
           last_error_kind = NULL, repair_count = repair_count + 1,
           idempotency_key = 'session-summary:prompt:' || summary_id || ':repair:' || (repair_count + 1),
           updated_at = ?
         WHERE summary_id = ? AND guild_id = ? AND delivery_kind = 'prompt'
           AND NOT EXISTS (
             SELECT 1 FROM session_summary_admin_events
             WHERE guild_id = ? AND idempotency_key = ?
           )`,
      ).bind(
        input.now, input.now, input.summaryId, input.guildId,
        input.guildId, input.idempotencyKey,
      ),
      this.eventStatement({ ...input, eventKind: "delivery_retried" }),
    ]);
  }

  async lockEdits(input: RecapOperationInput): Promise<void> {
    await this.db.batch([
      this.db.prepare(
        `UPDATE session_summaries SET author_edit_status = 'locked',
           edit_locked_at = ?, edit_locked_by_user_id = ?, edit_lock_reason = ?,
           updated_at = ? WHERE summary_id = ? AND guild_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM session_summary_admin_events
             WHERE guild_id = ? AND idempotency_key = ?
           )`,
      ).bind(
        input.now, input.actorUserId, input.reason, input.now,
        input.summaryId, input.guildId, input.guildId, input.idempotencyKey,
      ),
      this.eventStatement({ ...input, eventKind: "edit_locked" }),
    ]);
  }

  async reopenEdits(input: RecapOperationInput & { editUntil: number }): Promise<void> {
    await this.db.batch([
      this.db.prepare(
        `UPDATE session_summaries SET author_edit_status = 'open',
           edit_expires_at = CASE
             WHEN first_submitted_at IS NULL THEN edit_expires_at
             WHEN edit_expires_at IS NULL OR edit_expires_at < ? THEN ?
             ELSE edit_expires_at END,
           edit_locked_at = NULL, edit_locked_by_user_id = NULL,
           edit_lock_reason = NULL, updated_at = ?
         WHERE summary_id = ? AND guild_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM session_summary_admin_events
             WHERE guild_id = ? AND idempotency_key = ?
           )`,
      ).bind(
        input.editUntil, input.editUntil, input.now, input.summaryId,
        input.guildId, input.guildId, input.idempotencyKey,
      ),
      this.eventStatement({
        ...input,
        eventKind: "edit_reopened",
        details: { editUntil: input.editUntil },
      }),
    ]);
  }

  async setVisibility(input: RecapOperationInput & { visible: boolean }): Promise<void> {
    await this.db.batch([
      this.db.prepare(
        `UPDATE session_summaries SET publication_status = ?, hidden_at = ?,
           hidden_by_user_id = ?, hidden_reason = ?, updated_at = ?
         WHERE summary_id = ? AND guild_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM session_summary_admin_events
             WHERE guild_id = ? AND idempotency_key = ?
           )`,
      ).bind(
        input.visible ? "visible" : "hidden",
        input.visible ? null : input.now,
        input.visible ? null : input.actorUserId,
        input.visible ? null : input.reason,
        input.now,
        input.summaryId,
        input.guildId,
        input.guildId,
        input.idempotencyKey,
      ),
      this.eventStatement({ ...input, eventKind: input.visible ? "unhidden" : "hidden" }),
    ]);
  }
  async appendCorrection(input: RecapOperationInput & { publicCorrection: string }) {
    await this.db.batch([
      this.eventStatement({
        ...input,
        eventKind: "correction_appended",
        publicCorrection: input.publicCorrection,
      }),
    ]);
  }

  private eventStatement(input: RecapOperationInput & {
    eventId: string;
    eventKind: string;
    publicCorrection?: string | null;
    details?: unknown;
  }) {
    return this.db.prepare(
      `INSERT OR IGNORE INTO session_summary_admin_events (
         summary_event_id, summary_id, guild_id, event_kind, actor_user_id,
         reason, public_correction, details_json, idempotency_key, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      input.eventId,
      input.summaryId,
      input.guildId,
      input.eventKind,
      input.actorUserId,
      input.reason,
      input.publicCorrection ?? null,
      input.details === undefined ? null : JSON.stringify(input.details),
      input.idempotencyKey,
      input.now,
    );
  }
}

interface RecapOperationInput {
  eventId: string;
  summaryId: string;
  guildId: string;
  actorUserId: string;
  reason: string;
  idempotencyKey: string;
  now: number;
}
