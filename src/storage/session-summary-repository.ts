import type { SessionSummaryFields } from "../domain/session-summary";

export interface AutoCompletionTarget {
  guildId: string;
  eventId: string;
  tableNumber: number;
}

export interface SummaryCreationTarget {
  guildId: string;
  sessionId: string;
  completionRevisionId: string;
  dmUserId: string;
  sessionEndsAt: number;
}

export interface SessionSummary extends SessionSummaryFields {
  summaryId: string;
  guildId: string;
  sessionId: string;
  completionRevisionId: string;
  dmUserId: string;
  sessionEndsAt: number;
  dueAt: number;
  status: "pending" | "submitted";
  firstSubmittedAt: number | null;
  editExpiresAt: number | null;
  lastSubmittedAt: number | null;
  publicationStatus: "visible" | "hidden";
  hiddenAt: number | null;
  hiddenByUserId: string | null;
  hiddenReason: string | null;
  rewardPolicyVersion: string | null;
  authorEditStatus: "open" | "locked";
  editLockedAt: number | null;
  editLockedByUserId: string | null;
  editLockReason: string | null;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface SessionSummaryDelivery {
  deliveryId: string;
  summaryId: string;
  guildId: string;
  deliveryKind: "prompt" | "reminder";
  recipientUserId: string;
  scheduledFor: number;
  status: "pending" | "sent" | "failed" | "not_needed";
  attemptCount: number;
  nextAttemptAt: number | null;
  discordChannelId: string | null;
  discordMessageId: string | null;
  lastErrorKind: string | null;
  idempotencyKey: string;
  createdAt: number;
  updatedAt: number;
}

type AutoCompletionRow = {
  guild_id: string;
  event_id: string;
  table_number: number;
};

type CreationRow = {
  guild_id: string;
  session_id: string;
  completion_revision_id: string;
  actual_dm_user_id: string;
  ends_at: number;
};

type SummaryRow = {
  summary_id: string;
  guild_id: string;
  session_id: string;
  completion_revision_id: string;
  dm_user_id: string;
  session_ends_at: number;
  due_at: number;
  status: "pending" | "submitted";
  summary_text: string | null;
  area: string | null;
  important_events: string | null;
  bonus_rewards: string | null;
  other_notes: string | null;
  first_submitted_at: number | null;
  edit_expires_at: number | null;
  last_submitted_at: number | null;
  publication_status: "visible" | "hidden";
  hidden_at: number | null;
  hidden_by_user_id: string | null;
  hidden_reason: string | null;
  reward_policy_version: string | null;
  author_edit_status: "open" | "locked";
  edit_locked_at: number | null;
  edit_locked_by_user_id: string | null;
  edit_lock_reason: string | null;
  version: number;
  created_at: number;
  updated_at: number;
};

type DeliveryRow = {
  delivery_id: string;
  summary_id: string;
  guild_id: string;
  delivery_kind: "prompt" | "reminder";
  recipient_user_id: string;
  scheduled_for: number;
  status: "pending" | "sent" | "failed" | "not_needed";
  attempt_count: number;
  next_attempt_at: number | null;
  discord_channel_id: string | null;
  discord_message_id: string | null;
  last_error_kind: string | null;
  idempotency_key: string;
  created_at: number;
  updated_at: number;
};

function summaryFromRow(row: SummaryRow): SessionSummary {
  return {
    summaryId: row.summary_id,
    guildId: row.guild_id,
    sessionId: row.session_id,
    completionRevisionId: row.completion_revision_id,
    dmUserId: row.dm_user_id,
    sessionEndsAt: row.session_ends_at,
    dueAt: row.due_at,
    status: row.status,
    summaryText: row.summary_text ?? "",
    area: row.area ?? "",
    importantEvents: row.important_events,
    bonusRewards: row.bonus_rewards,
    otherNotes: row.other_notes,
    firstSubmittedAt: row.first_submitted_at,
    editExpiresAt: row.edit_expires_at,
    lastSubmittedAt: row.last_submitted_at,
    publicationStatus: row.publication_status,
    hiddenAt: row.hidden_at,
    hiddenByUserId: row.hidden_by_user_id,
    hiddenReason: row.hidden_reason,
    rewardPolicyVersion: row.reward_policy_version,
    authorEditStatus: row.author_edit_status,
    editLockedAt: row.edit_locked_at,
    editLockedByUserId: row.edit_locked_by_user_id,
    editLockReason: row.edit_lock_reason,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function deliveryFromRow(row: DeliveryRow): SessionSummaryDelivery {
  return {
    deliveryId: row.delivery_id,
    summaryId: row.summary_id,
    guildId: row.guild_id,
    deliveryKind: row.delivery_kind,
    recipientUserId: row.recipient_user_id,
    scheduledFor: row.scheduled_for,
    status: row.status,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    discordChannelId: row.discord_channel_id,
    discordMessageId: row.discord_message_id,
    lastErrorKind: row.last_error_kind,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SessionSummaryRepository {
  constructor(private readonly db: D1Database) {}

  async listAutoCompletionDue(now: number, limit = 50): Promise<AutoCompletionTarget[]> {
    const result = await this.db
      .prepare(
        `SELECT event.guild_id, event.event_id, table_row.table_number
         FROM weekly_events event
         JOIN plan_tables table_row ON table_row.plan_id = event.finalized_plan_id
         LEFT JOIN session_completions session
           ON session.guild_id = event.guild_id
          AND session.source_event_id = event.event_id
          AND session.source_table_id = table_row.table_id
         WHERE event.status = 'archived' AND event.ends_at IS NOT NULL
           AND event.ends_at <= ?
           AND NOT EXISTS (
             SELECT 1 FROM table_thread_workflows workflow
             WHERE workflow.guild_id = event.guild_id
               AND workflow.event_id = event.event_id
               AND workflow.table_id = table_row.table_id
               AND workflow.status = 'cancelled'
           )
           AND (session.session_id IS NULL OR session.draft_open = 1)
           AND NOT EXISTS (
             SELECT 1 FROM session_completion_revisions revision
             WHERE revision.session_id = session.session_id AND revision.is_current = 1
           )
         ORDER BY event.ends_at, event.event_id, table_row.table_number
         LIMIT ?`,
      )
      .bind(now, limit)
      .all<AutoCompletionRow>();
    return result.results.map((row) => ({
      guildId: row.guild_id,
      eventId: row.event_id,
      tableNumber: row.table_number,
    }));
  }

  async listSummaryCreationDue(limit = 50): Promise<SummaryCreationTarget[]> {
    const result = await this.db
      .prepare(
        `SELECT session.guild_id, session.session_id,
                revision.completion_revision_id, revision.actual_dm_user_id,
                event.ends_at
         FROM session_completions session
         JOIN session_completion_revisions revision
           ON revision.session_id = session.session_id
          AND revision.guild_id = session.guild_id AND revision.is_current = 1
         JOIN weekly_events event
           ON event.event_id = session.source_event_id
          AND event.guild_id = session.guild_id
         LEFT JOIN session_summaries summary
           ON summary.guild_id = session.guild_id
           AND summary.completion_revision_id = revision.completion_revision_id
         WHERE revision.result = 'completed' AND revision.actual_dm_user_id IS NOT NULL
           AND event.ends_at IS NOT NULL AND summary.summary_id IS NULL
         ORDER BY event.ends_at, session.session_id LIMIT ?`,
      )
      .bind(limit)
      .all<CreationRow>();
    return result.results.map((row) => ({
      guildId: row.guild_id,
      sessionId: row.session_id,
      completionRevisionId: row.completion_revision_id,
      dmUserId: row.actual_dm_user_id,
      sessionEndsAt: row.ends_at,
    }));
  }

  async get(guildId: string, summaryId: string): Promise<SessionSummary | null> {
    const row = await this.db
      .prepare("SELECT * FROM session_summaries WHERE guild_id = ? AND summary_id = ?")
      .bind(guildId, summaryId)
      .first<SummaryRow>();
    return row ? summaryFromRow(row) : null;
  }

  async getById(summaryId: string): Promise<SessionSummary | null> {
    const row = await this.db
      .prepare(`SELECT summary.* FROM session_summaries summary
          JOIN session_completion_revisions revision
            ON revision.completion_revision_id = summary.completion_revision_id
           AND revision.session_id = summary.session_id
           AND revision.guild_id = summary.guild_id
           AND revision.is_current = 1 AND revision.result = 'completed'
          WHERE summary.summary_id = ?`)
      .bind(summaryId)
      .first<SummaryRow>();
    return row ? summaryFromRow(row) : null;
  }

  async ensure(input: {
    summaryId: string;
    promptDeliveryId: string;
    reminderDeliveryId: string;
    guildId: string;
    sessionId: string;
    completionRevisionId: string;
    dmUserId: string;
    sessionEndsAt: number;
    dueAt: number;
    reminderAt: number;
    rewardPolicyVersion: string;
    createdAt: number;
  }): Promise<SessionSummary> {
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO session_summaries (
           summary_id, guild_id, session_id, completion_revision_id, dm_user_id,
           session_ends_at, due_at, reward_policy_version, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.summaryId,
        input.guildId,
        input.sessionId,
        input.completionRevisionId,
        input.dmUserId,
        input.sessionEndsAt,
        input.dueAt,
        input.rewardPolicyVersion,
        input.createdAt,
        input.createdAt,
      )
      .run();
    const summaryRow = await this.db
      .prepare("SELECT * FROM session_summaries WHERE guild_id = ? AND completion_revision_id = ?")
      .bind(input.guildId, input.completionRevisionId)
      .first<SummaryRow>();
    if (!summaryRow) throw new Error("Session summary was not persisted");
    const summary = summaryFromRow(summaryRow);
    await this.db.batch([
      this.deliveryInsert(
        input.promptDeliveryId,
        summary,
        "prompt",
        input.createdAt,
        input.createdAt,
      ),
      this.deliveryInsert(
        input.reminderDeliveryId,
        summary,
        "reminder",
        input.reminderAt,
        input.createdAt,
      ),
    ]);
    return summary;
  }

  async listDueDeliveries(now: number, limit = 50): Promise<SessionSummaryDelivery[]> {
    const result = await this.db
      .prepare(
        `SELECT delivery.* FROM session_summary_deliveries delivery
         JOIN session_summaries summary
           ON summary.summary_id = delivery.summary_id AND summary.guild_id = delivery.guild_id
         JOIN session_completion_revisions revision
           ON revision.completion_revision_id = summary.completion_revision_id
          AND revision.session_id = summary.session_id
          AND revision.guild_id = summary.guild_id
          AND revision.is_current = 1 AND revision.result = 'completed'
         WHERE (
           (delivery.status = 'pending' AND delivery.scheduled_for <= ?)
           OR (delivery.status = 'failed' AND delivery.next_attempt_at <= ?)
         )
           AND summary.status = 'pending'
         ORDER BY COALESCE(delivery.next_attempt_at, delivery.scheduled_for), delivery.delivery_id
         LIMIT ?`,
      )
      .bind(now, now, limit)
      .all<DeliveryRow>();
    return result.results.map(deliveryFromRow);
  }

  async markDeliverySent(input: {
    guildId: string;
    deliveryId: string;
    channelId: string;
    messageId: string;
    sentAt: number;
  }): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE session_summary_deliveries
         SET status = 'sent', attempt_count = attempt_count + 1,
             next_attempt_at = NULL, discord_channel_id = ?, discord_message_id = ?,
             last_error_kind = NULL, updated_at = ?
         WHERE guild_id = ? AND delivery_id = ? AND status IN ('pending', 'failed')`,
      )
      .bind(input.channelId, input.messageId, input.sentAt, input.guildId, input.deliveryId)
      .run();
    return result.meta.changes === 1;
  }

  async markDeliveryFailed(input: {
    guildId: string;
    deliveryId: string;
    errorKind: string;
    nextAttemptAt: number;
    failedAt: number;
  }): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE session_summary_deliveries
         SET status = 'failed', attempt_count = attempt_count + 1,
             next_attempt_at = ?, last_error_kind = ?, updated_at = ?
         WHERE guild_id = ? AND delivery_id = ? AND status IN ('pending', 'failed')`,
      )
      .bind(
        input.nextAttemptAt,
        input.errorKind.slice(0, 200),
        input.failedAt,
        input.guildId,
        input.deliveryId,
      )
      .run();
    return result.meta.changes === 1;
  }

  async submit(input: {
    summaryRevisionId: string;
    guildId: string;
    summaryId: string;
    expectedVersion: number;
    fields: SessionSummaryFields;
    submittedByUserId: string;
    submittedAt: number;
    firstSubmittedAt: number;
    editExpiresAt: number;
  }): Promise<SessionSummary | null> {
    const version = input.expectedVersion + 1;
    const results = await this.db.batch([
      this.db
        .prepare(
          `UPDATE session_summaries SET
             status = 'submitted', summary_text = ?, area = ?, important_events = ?,
             bonus_rewards = ?, other_notes = ?, first_submitted_at = ?,
             edit_expires_at = ?, last_submitted_at = ?, version = ?, updated_at = ?
           WHERE guild_id = ? AND summary_id = ? AND version = ?`,
        )
        .bind(
          input.fields.summaryText,
          input.fields.area,
          input.fields.importantEvents,
          input.fields.bonusRewards,
          input.fields.otherNotes,
          input.firstSubmittedAt,
          input.editExpiresAt,
          input.submittedAt,
          version,
          input.submittedAt,
          input.guildId,
          input.summaryId,
          input.expectedVersion,
        ),
      this.db
        .prepare(
          `UPDATE session_summary_revisions SET is_current = 0
           WHERE summary_id = ? AND guild_id = ? AND is_current = 1`,
        )
        .bind(input.summaryId, input.guildId),
      this.db
        .prepare(
          `INSERT INTO session_summary_revisions (
             summary_revision_id, summary_id, guild_id, revision_number,
             summary_text, area, important_events, bonus_rewards, other_notes,
             submitted_by_user_id, submitted_at, is_current, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        )
        .bind(
          input.summaryRevisionId,
          input.summaryId,
          input.guildId,
          input.expectedVersion,
          input.fields.summaryText,
          input.fields.area,
          input.fields.importantEvents,
          input.fields.bonusRewards,
          input.fields.otherNotes,
          input.submittedByUserId,
          input.submittedAt,
          input.submittedAt,
        ),
      this.db
        .prepare(
          `UPDATE session_summary_deliveries
           SET status = 'not_needed', updated_at = ?
           WHERE summary_id = ? AND guild_id = ? AND delivery_kind = 'reminder'
             AND status IN ('pending', 'failed')`,
        )
        .bind(input.submittedAt, input.summaryId, input.guildId),
    ]);
    if (!results[0] || results[0].meta.changes < 1) return null;
    return this.get(input.guildId, input.summaryId);
  }

  private deliveryInsert(
    deliveryId: string,
    summary: SessionSummary,
    kind: "prompt" | "reminder",
    scheduledFor: number,
    createdAt: number,
  ): D1PreparedStatement {
    return this.db
      .prepare(
        `INSERT OR IGNORE INTO session_summary_deliveries (
           delivery_id, summary_id, guild_id, delivery_kind, recipient_user_id,
           scheduled_for, idempotency_key, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        deliveryId,
        summary.summaryId,
        summary.guildId,
        kind,
        summary.dmUserId,
        scheduledFor,
        `session-summary:${kind}:${summary.summaryId}`,
        createdAt,
        createdAt,
      );
  }
}
