export interface TableThreadTarget {
  guildId: string;
  eventId: string;
  eventTitle: string;
  startsAt: number;
  tableSelectionClosesAt: number;
  timezone: string;
  planId: string;
  tableId: string;
  tableNumber: number;
  gameTier: number;
  tableTitle: string;
  gmUserId: string;
  gmDisplayName: string;
  parentChannelId: string;
  sourceMessageId: string | null;
}

export interface TableThreadWorkflow {
  workflowId: string;
  guildId: string;
  eventId: string;
  tableNumber: number;
  planId: string;
  tableId: string;
  parentChannelId: string;
  sourceMessageId: string | null;
  threadId: string | null;
  threadName: string;
  threadGeneration: number;
  gmUserId: string;
  gmDisplayName: string;
  gmRevision: number;
  status: "pending" | "creating" | "current" | "failed" | "cancelled";
  attemptCount: number;
  nextAttemptAt: number | null;
  lastErrorKind: string | null;
  cancelledAt: number | null;
  cancelledByUserId: string | null;
  cancellationReason: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface TableThreadDelivery {
  deliveryId: string;
  workflowId: string;
  guildId: string;
  gmUserId: string;
  gmRevision: number;
  status: "pending" | "sent" | "failed" | "not_needed";
  scheduledFor: number;
  attemptCount: number;
  nextAttemptAt: number | null;
  lastErrorKind: string | null;
  idempotencyKey: string;
}

type TargetRow = {
  guild_id: string;
  event_id: string;
  event_title: string;
  starts_at: number;
  table_selection_closes_at: number;
  timezone: string;
  plan_id: string;
  table_id: string;
  table_number: number;
  game_tier: number;
  table_title: string;
  gm_user_id: string;
  gm_display_name: string;
  parent_channel_id: string;
  source_message_id: string | null;
};

type WorkflowRow = {
  workflow_id: string;
  guild_id: string;
  event_id: string;
  table_number: number;
  plan_id: string;
  table_id: string;
  parent_channel_id: string;
  source_message_id: string | null;
  thread_id: string | null;
  thread_name: string;
  thread_generation: number;
  gm_user_id: string;
  gm_display_name: string;
  gm_revision: number;
  status: TableThreadWorkflow["status"];
  attempt_count: number;
  next_attempt_at: number | null;
  last_error_kind: string | null;
  cancelled_at: number | null;
  cancelled_by_user_id: string | null;
  cancellation_reason: string | null;
  created_at: number;
  updated_at: number;
};

type DeliveryRow = {
  delivery_id: string;
  workflow_id: string;
  guild_id: string;
  gm_user_id: string;
  gm_revision: number;
  status: TableThreadDelivery["status"];
  scheduled_for: number;
  attempt_count: number;
  next_attempt_at: number | null;
  last_error_kind: string | null;
  idempotency_key: string;
};

function targetFromRow(row: TargetRow): TableThreadTarget {
  return {
    guildId: row.guild_id,
    eventId: row.event_id,
    eventTitle: row.event_title,
    startsAt: row.starts_at,
    tableSelectionClosesAt: row.table_selection_closes_at,
    timezone: row.timezone,
    planId: row.plan_id,
    tableId: row.table_id,
    tableNumber: row.table_number,
    gameTier: row.game_tier,
    tableTitle: row.table_title,
    gmUserId: row.gm_user_id,
    gmDisplayName: row.gm_display_name,
    parentChannelId: row.parent_channel_id,
    sourceMessageId: row.source_message_id,
  };
}

function workflowFromRow(row: WorkflowRow): TableThreadWorkflow {
  return {
    workflowId: row.workflow_id,
    guildId: row.guild_id,
    eventId: row.event_id,
    tableNumber: row.table_number,
    planId: row.plan_id,
    tableId: row.table_id,
    parentChannelId: row.parent_channel_id,
    sourceMessageId: row.source_message_id,
    threadId: row.thread_id,
    threadName: row.thread_name,
    threadGeneration: row.thread_generation,
    gmUserId: row.gm_user_id,
    gmDisplayName: row.gm_display_name,
    gmRevision: row.gm_revision,
    status: row.status,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    lastErrorKind: row.last_error_kind,
    cancelledAt: row.cancelled_at,
    cancelledByUserId: row.cancelled_by_user_id,
    cancellationReason: row.cancellation_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function deliveryFromRow(row: DeliveryRow): TableThreadDelivery {
  return {
    deliveryId: row.delivery_id,
    workflowId: row.workflow_id,
    guildId: row.guild_id,
    gmUserId: row.gm_user_id,
    gmRevision: row.gm_revision,
    status: row.status,
    scheduledFor: row.scheduled_for,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    lastErrorKind: row.last_error_kind,
    idempotencyKey: row.idempotency_key,
  };
}

const TARGET_SELECT = `SELECT event.guild_id, event.event_id, event.title AS event_title,
  event.starts_at, event.table_selection_closes_at, config.timezone,
  plan.plan_id, table_row.table_id, table_row.table_number, table_row.game_tier,
  table_row.title AS table_title, table_row.gm_user_id, table_row.gm_display_name,
  COALESCE(table_row.channel_id, event.table_channel_id, config.table_channel_id)
    AS parent_channel_id,
  table_row.message_id AS source_message_id
 FROM weekly_events event
 JOIN guild_config config ON config.guild_id = event.guild_id
 JOIN plans plan ON plan.event_id = event.event_id AND plan.status = 'published'
 JOIN plan_tables table_row ON table_row.plan_id = plan.plan_id`;

export class TableThreadRepository {
  constructor(private readonly db: D1Database) {}

  async listPublishedTargets(now: number, limit = 50): Promise<TableThreadTarget[]> {
    const result = await this.db
      .prepare(
        `${TARGET_SELECT}
         WHERE event.status = 'published' AND config.scheduling_enabled = 1
           AND event.starts_at > ?
           AND COALESCE(table_row.channel_id, event.table_channel_id, config.table_channel_id)
             IS NOT NULL
         ORDER BY event.starts_at, event.event_id, table_row.table_number LIMIT ?`,
      )
      .bind(now, limit)
      .all<TargetRow>();
    return result.results.map(targetFromRow);
  }

  async getPublishedTarget(input: {
    guildId: string;
    eventId?: string;
    tableNumber: number;
  }): Promise<TableThreadTarget | null> {
    const row = await this.db
      .prepare(
        `${TARGET_SELECT}
         WHERE event.guild_id = ? AND event.status = 'published'
           AND (? IS NULL OR event.event_id = ?)
           AND table_row.table_number = ?
           AND COALESCE(table_row.channel_id, event.table_channel_id, config.table_channel_id)
             IS NOT NULL
         ORDER BY event.starts_at DESC LIMIT 1`,
      )
      .bind(input.guildId, input.eventId ?? null, input.eventId ?? null, input.tableNumber)
      .first<TargetRow>();
    return row ? targetFromRow(row) : null;
  }

  async ensureTarget(input: {
    workflowId: string;
    target: TableThreadTarget;
    threadName: string;
    now: number;
  }): Promise<TableThreadWorkflow> {
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO table_thread_workflows (
           workflow_id, guild_id, event_id, table_number, plan_id, table_id,
           parent_channel_id, source_message_id, thread_name,
           gm_user_id, gm_display_name, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.workflowId,
        input.target.guildId,
        input.target.eventId,
        input.target.tableNumber,
        input.target.planId,
        input.target.tableId,
        input.target.parentChannelId,
        input.target.sourceMessageId,
        input.threadName,
        input.target.gmUserId,
        input.target.gmDisplayName,
        input.now,
        input.now,
      )
      .run();
    await this.db
      .prepare(
        `UPDATE table_thread_workflows SET
           plan_id = ?, table_id = ?,
           parent_channel_id = CASE WHEN thread_id IS NULL AND thread_generation = 1 THEN ? ELSE parent_channel_id END,
           source_message_id = CASE WHEN thread_id IS NULL AND thread_generation = 1 THEN ? ELSE source_message_id END,
           thread_name = CASE WHEN thread_id IS NULL AND thread_generation = 1 THEN ? ELSE thread_name END,
           gm_revision = gm_revision + CASE WHEN gm_user_id <> ? THEN 1 ELSE 0 END,
           gm_user_id = ?, gm_display_name = ?, updated_at = ?
         WHERE guild_id = ? AND event_id = ? AND table_number = ? AND status <> 'cancelled'`,
      )
      .bind(
        input.target.planId,
        input.target.tableId,
        input.target.parentChannelId,
        input.target.sourceMessageId,
        input.threadName,
        input.target.gmUserId,
        input.target.gmUserId,
        input.target.gmDisplayName,
        input.now,
        input.target.guildId,
        input.target.eventId,
        input.target.tableNumber,
      )
      .run();
    const workflow = await this.getByTable(
      input.target.guildId,
      input.target.eventId,
      input.target.tableNumber,
    );
    if (!workflow) throw new Error("Table thread workflow was not persisted");
    return workflow;
  }

  async get(workflowId: string): Promise<TableThreadWorkflow | null> {
    const row = await this.db
      .prepare("SELECT * FROM table_thread_workflows WHERE workflow_id = ?")
      .bind(workflowId)
      .first<WorkflowRow>();
    return row ? workflowFromRow(row) : null;
  }

  async getByTable(
    guildId: string,
    eventId: string,
    tableNumber: number,
  ): Promise<TableThreadWorkflow | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM table_thread_workflows
         WHERE guild_id = ? AND event_id = ? AND table_number = ?`,
      )
      .bind(guildId, eventId, tableNumber)
      .first<WorkflowRow>();
    return row ? workflowFromRow(row) : null;
  }

  async listCreationDue(now: number, limit = 50): Promise<TableThreadWorkflow[]> {
    const result = await this.db
      .prepare(
        `SELECT * FROM table_thread_workflows
         WHERE status = 'pending' OR (status = 'failed' AND next_attempt_at <= ?)
         ORDER BY COALESCE(next_attempt_at, updated_at), workflow_id LIMIT ?`,
      )
      .bind(now, limit)
      .all<WorkflowRow>();
    return result.results.map(workflowFromRow);
  }

  async markCreating(workflowId: string, deterministicThreadId: string | null, now: number) {
    const result = await this.db
      .prepare(
        `UPDATE table_thread_workflows SET status = 'creating', thread_id = ?,
           attempt_count = attempt_count + 1, next_attempt_at = NULL,
           last_error_kind = NULL, updated_at = ?
         WHERE workflow_id = ? AND status IN ('pending', 'failed')`,
      )
      .bind(deterministicThreadId, now, workflowId)
      .run();
    return result.meta.changes === 1;
  }

  async markCurrent(workflowId: string, threadId: string, now: number) {
    const result = await this.db
      .prepare(
        `UPDATE table_thread_workflows SET status = 'current', thread_id = ?,
           next_attempt_at = NULL, last_error_kind = NULL, updated_at = ?
         WHERE workflow_id = ? AND status IN ('creating', 'pending', 'failed')`,
      )
      .bind(threadId, now, workflowId)
      .run();
    return result.meta.changes === 1;
  }

  async markFailed(workflowId: string, errorKind: string, retryAt: number, now: number) {
    const result = await this.db
      .prepare(
        `UPDATE table_thread_workflows SET status = 'failed', next_attempt_at = ?,
           last_error_kind = ?, updated_at = ?
         WHERE workflow_id = ? AND status <> 'cancelled'`,
      )
      .bind(retryAt, errorKind.slice(0, 200), now, workflowId)
      .run();
    return result.meta.changes === 1;
  }

  async ensureDelivery(input: {
    deliveryId: string;
    workflow: TableThreadWorkflow;
    now: number;
  }) {
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO table_thread_deliveries (
           delivery_id, workflow_id, guild_id, gm_user_id, gm_revision,
           scheduled_for, idempotency_key, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.deliveryId,
        input.workflow.workflowId,
        input.workflow.guildId,
        input.workflow.gmUserId,
        input.workflow.gmRevision,
        input.now,
        `table-thread:gm:${input.workflow.workflowId}:${input.workflow.gmRevision}`,
        input.now,
        input.now,
      )
      .run();
  }

  async listDeliveriesDue(now: number, limit = 50): Promise<TableThreadDelivery[]> {
    const result = await this.db
      .prepare(
        `SELECT delivery.* FROM table_thread_deliveries delivery
         JOIN table_thread_workflows workflow
           ON workflow.workflow_id = delivery.workflow_id AND workflow.guild_id = delivery.guild_id
         WHERE workflow.status = 'current'
           AND workflow.gm_revision = delivery.gm_revision
           AND workflow.gm_user_id = delivery.gm_user_id
           AND (
             (delivery.status = 'pending' AND delivery.scheduled_for <= ?)
             OR (delivery.status = 'failed' AND delivery.next_attempt_at <= ?)
           )
         ORDER BY COALESCE(delivery.next_attempt_at, delivery.scheduled_for), delivery.delivery_id
         LIMIT ?`,
      )
      .bind(now, now, limit)
      .all<DeliveryRow>();
    return result.results.map(deliveryFromRow);
  }

  async markDeliverySent(input: {
    deliveryId: string;
    channelId: string;
    messageId: string;
    now: number;
  }) {
    const result = await this.db
      .prepare(
        `UPDATE table_thread_deliveries SET status = 'sent',
           attempt_count = attempt_count + 1, next_attempt_at = NULL,
           last_error_kind = NULL, discord_channel_id = ?, discord_message_id = ?,
           updated_at = ?
         WHERE delivery_id = ? AND status IN ('pending', 'failed')`,
      )
      .bind(input.channelId, input.messageId, input.now, input.deliveryId)
      .run();
    return result.meta.changes === 1;
  }

  async markDeliveryFailed(input: {
    deliveryId: string;
    errorKind: string;
    retryAt: number;
    now: number;
  }) {
    const result = await this.db
      .prepare(
        `UPDATE table_thread_deliveries SET status = 'failed',
           attempt_count = attempt_count + 1, next_attempt_at = ?, last_error_kind = ?,
           updated_at = ?
         WHERE delivery_id = ? AND status IN ('pending', 'failed')`,
      )
      .bind(input.retryAt, input.errorKind.slice(0, 200), input.now, input.deliveryId)
      .run();
    return result.meta.changes === 1;
  }

  async cancel(input: {
    workflowId: string;
    actorUserId: string;
    reason: string;
    now: number;
    auditId: string;
  }) {
    await this.db.batch([
      this.db.prepare(
        `UPDATE table_thread_workflows SET status = 'cancelled', next_attempt_at = NULL,
           last_error_kind = NULL, cancelled_at = ?, cancelled_by_user_id = ?,
           cancellation_reason = ?, updated_at = ? WHERE workflow_id = ?`,
      ).bind(input.now, input.actorUserId, input.reason, input.now, input.workflowId),
      this.db.prepare(
        `UPDATE table_thread_deliveries SET status = 'not_needed', next_attempt_at = NULL,
           last_error_kind = NULL, updated_at = ?
         WHERE workflow_id = ? AND status IN ('pending', 'failed')`,
      ).bind(input.now, input.workflowId),
      this.eventStatement(input.auditId, input.workflowId, input.actorUserId, "cancelled", input.reason, null, input.now),
    ]);
  }

  async retry(input: {
    workflowId: string;
    actorUserId: string;
    reason: string;
    auditId: string;
    now: number;
  }) {
    await this.db.batch([
      this.db.prepare(
        `UPDATE table_thread_workflows SET status = CASE WHEN status = 'current' THEN 'current' ELSE 'pending' END,
           next_attempt_at = NULL, last_error_kind = NULL, updated_at = ?
         WHERE workflow_id = ? AND status <> 'cancelled'`,
      ).bind(input.now, input.workflowId),
      this.db.prepare(
        `UPDATE table_thread_deliveries SET status = 'pending', next_attempt_at = NULL,
           last_error_kind = NULL, discord_channel_id = NULL, discord_message_id = NULL,
           updated_at = ?
         WHERE workflow_id = ? AND status = 'failed'`,
      ).bind(input.now, input.workflowId),
      this.eventStatement(input.auditId, input.workflowId, input.actorUserId, "retried", input.reason, null, input.now),
    ]);
  }

  async recreate(input: {
    workflowId: string;
    actorUserId: string;
    reason: string;
    parentChannelId: string;
    sourceMessageId: string | null;
    threadName: string;
    auditId: string;
    now: number;
  }) {
    await this.db.batch([
      this.db.prepare(
        `UPDATE table_thread_workflows SET status = 'pending', parent_channel_id = ?,
           source_message_id = ?, thread_id = NULL, thread_name = ?,
           thread_generation = thread_generation + 1, gm_revision = gm_revision + 1,
           next_attempt_at = NULL, last_error_kind = NULL,
           cancelled_at = NULL, cancelled_by_user_id = NULL, cancellation_reason = NULL,
           updated_at = ? WHERE workflow_id = ?`,
      ).bind(
        input.parentChannelId,
        input.sourceMessageId,
        input.threadName,
        input.now,
        input.workflowId,
      ),
      this.db.prepare(
        `UPDATE table_thread_deliveries SET status = 'not_needed', next_attempt_at = NULL,
           last_error_kind = NULL, updated_at = ?
         WHERE workflow_id = ? AND status IN ('pending', 'failed')`,
      ).bind(input.now, input.workflowId),
      this.eventStatement(
        input.auditId,
        input.workflowId,
        input.actorUserId,
        "recreated",
        input.reason,
        { parentChannelId: input.parentChannelId },
        input.now,
      ),
    ]);
  }

  private eventStatement(
    eventId: string,
    workflowId: string,
    actorUserId: string,
    eventKind: string,
    reason: string | null,
    details: unknown,
    now: number,
  ) {
    return this.db.prepare(
      `INSERT INTO table_thread_events (
         thread_event_id, workflow_id, guild_id, event_kind, actor_user_id,
         reason, details_json, created_at
       ) SELECT ?, workflow_id, guild_id, ?, ?, ?, ?, ?
       FROM table_thread_workflows WHERE workflow_id = ?`,
    ).bind(
      eventId,
      eventKind,
      actorUserId,
      reason,
      details === null ? null : JSON.stringify(details),
      now,
      workflowId,
    );
  }
}
