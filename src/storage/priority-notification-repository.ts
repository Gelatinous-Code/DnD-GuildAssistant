import type { DmPriorityCreditStatus } from "./priority-repository";

export const DEFAULT_PRIORITY_PRE_EXPIRY_LEAD_MS = 72 * 60 * 60 * 1000;
export const DEFAULT_PRIORITY_NOTIFICATION_TEMPLATE_REVISION =
  "dm-priority-notifications-v1";

export type PriorityNotificationKind =
  | "grant_awarded"
  | "credit_reserved"
  | "credit_redeemed"
  | "credit_refunded"
  | "credit_expired"
  | "grant_corrected"
  | "credit_expiring"
  | "seat_displaced"
  | "seat_promoted";

export type PriorityNotificationSourceKind =
  | "grant"
  | "credit_event"
  | "credit"
  | "seating_event";

export type PriorityNotificationStatus =
  | "pending"
  | "sending"
  | "retry"
  | "sent"
  | "blocked"
  | "failed"
  | "uncertain"
  | "cancelled";

export type PriorityNotificationTerminalStatus =
  | "blocked"
  | "failed"
  | "uncertain";

export interface PriorityNotificationConfig {
  configRevision: number;
  guildId: string;
  templateRevision: string;
  preExpiryLeadMs: number;
  maxDeliveryAttempts: number;
  createdAt: number;
  updatedAt: number;
}

export interface PriorityNotificationConfigEvent {
  configEventId: string;
  guildId: string;
  idempotencyKey: string;
  fromRevision: number;
  toRevision: number;
  fromPreExpiryLeadMs: number;
  toPreExpiryLeadMs: number;
  actorUserId: string;
  reason: string;
  occurredAt: number;
  appliedAt: number;
  createdAt: number;
}

export interface UpdatePriorityNotificationConfigInput {
  configEventId: string;
  guildId: string;
  idempotencyKey: string;
  preExpiryLeadMs: number;
  actorUserId: string;
  reason: string;
  updatedAt: number;
}

export interface UpdatePriorityNotificationConfigResult {
  applied: boolean;
  replayed: boolean;
  config: PriorityNotificationConfig;
  event: PriorityNotificationConfigEvent;
}

export interface PriorityNotification {
  notificationId: string;
  guildId: string;
  recipientUserId: string;
  notificationKind: PriorityNotificationKind;
  sourceKind: PriorityNotificationSourceKind;
  sourceId: string;
  grantId: string | null;
  creditId: string | null;
  eventId: string | null;
  assignmentId: string | null;
  templateRevision: string;
  configRevision: number;
  content: string;
  scheduledFor: number;
  idempotencyKey: string;
  discordNonce: string;
  status: PriorityNotificationStatus;
  attemptCount: number;
  nextAttemptAt: number | null;
  claimToken: string | null;
  claimedAt: number | null;
  lastErrorKind: string | null;
  lastErrorCode: number | null;
  lastErrorAt: number | null;
  dmChannelId: string | null;
  sentMessageId: string | null;
  createdAt: number;
  updatedAt: number;
  sentAt: number | null;
  terminalAt: number | null;
}

export interface EnqueuePriorityNotificationInput {
  notificationId: string;
  guildId: string;
  recipientUserId: string;
  notificationKind: PriorityNotificationKind;
  sourceKind: PriorityNotificationSourceKind;
  sourceId: string;
  grantId?: string | null;
  creditId?: string | null;
  eventId?: string | null;
  assignmentId?: string | null;
  templateRevision: string;
  configRevision: number;
  content: string;
  scheduledFor: number;
  idempotencyKey: string;
  discordNonce: string;
  createdAt: number;
}

export interface PriorityNotificationLifecycleCandidate {
  guildId: string;
  recipientUserId: string;
  notificationKind: Exclude<
    PriorityNotificationKind,
    "credit_expiring" | "seat_displaced" | "seat_promoted"
  >;
  sourceKind: "grant" | "credit_event";
  sourceId: string;
  grantId: string;
  creditId: string | null;
  eventId: string | null;
  assignmentId: string | null;
  occurredAt: number;
  expiresAt: number;
  eventTitle: string | null;
  tableTitle: string | null;
  reason: string | null;
  creditStatus: DmPriorityCreditStatus | null;
  availableBalance: number;
}

export interface PriorityNotificationExpiryCandidate {
  guildId: string;
  recipientUserId: string;
  sourceId: string;
  grantId: string;
  creditId: string;
  eventId: string | null;
  assignmentId: string | null;
  expiresAt: number;
  eventTitle: string | null;
}

export interface PriorityNotificationSeatingCandidate {
  guildId: string;
  recipientUserId: string;
  sourceId: string;
  action: "displaced" | "promoted";
  eventId: string;
  assignmentId: string;
  grantId: string | null;
  creditId: string | null;
  occurredAt: number;
  eventTitle: string | null;
  tableTitle: string | null;
}

export interface ClaimPriorityNotificationsInput {
  claimToken: string;
  claimedAt: number;
  limit: number;
}

export interface CompletePriorityNotificationInput {
  notificationId: string;
  claimToken: string;
  completedAt: number;
}

export interface MarkPriorityNotificationSentInput
  extends CompletePriorityNotificationInput {
  dmChannelId: string;
  sentMessageId: string;
}

export interface MarkPriorityNotificationRetryInput
  extends CompletePriorityNotificationInput {
  nextAttemptAt: number;
  errorKind: string;
  errorCode?: number | null;
  dmChannelId?: string | null;
}

export interface MarkPriorityNotificationTerminalInput
  extends CompletePriorityNotificationInput {
  status: PriorityNotificationTerminalStatus;
  errorKind: string;
  errorCode?: number | null;
  dmChannelId?: string | null;
}

type ConfigRow = {
  guild_id: string;
  config_revision: number;
  template_revision: string;
  pre_expiry_lead_ms: number;
  max_delivery_attempts: number;
  created_at: number;
  updated_at: number;
};

type ConfigEventRow = {
  config_event_id: string;
  guild_id: string;
  idempotency_key: string;
  from_revision: number;
  to_revision: number;
  from_pre_expiry_lead_ms: number;
  to_pre_expiry_lead_ms: number;
  actor_user_id: string;
  reason: string;
  occurred_at: number;
  applied_at: number | null;
  created_at: number;
};

type NotificationRow = {
  notification_id: string;
  guild_id: string;
  recipient_user_id: string;
  notification_kind: PriorityNotificationKind;
  source_kind: PriorityNotificationSourceKind;
  source_id: string;
  grant_id: string | null;
  credit_id: string | null;
  event_id: string | null;
  assignment_id: string | null;
  template_revision: string;
  config_revision: number;
  content: string;
  scheduled_for: number;
  idempotency_key: string;
  discord_nonce: string;
  status: PriorityNotificationStatus;
  attempt_count: number;
  next_attempt_at: number | null;
  claim_token: string | null;
  claimed_at: number | null;
  last_error_kind: string | null;
  last_error_code: number | null;
  last_error_at: number | null;
  dm_channel_id: string | null;
  sent_message_id: string | null;
  created_at: number;
  updated_at: number;
  sent_at: number | null;
  terminal_at: number | null;
};

type LifecycleCandidateRow = {
  guild_id: string;
  recipient_user_id: string;
  notification_kind: PriorityNotificationLifecycleCandidate["notificationKind"];
  source_kind: PriorityNotificationLifecycleCandidate["sourceKind"];
  source_id: string;
  grant_id: string;
  credit_id: string | null;
  event_id: string | null;
  assignment_id: string | null;
  occurred_at: number;
  expires_at: number;
  event_title: string | null;
  table_title: string | null;
  reason: string | null;
  credit_status: DmPriorityCreditStatus | null;
  available_balance: number;
};

type ExpiryCandidateRow = {
  guild_id: string;
  recipient_user_id: string;
  source_id: string;
  grant_id: string;
  credit_id: string;
  event_id: string | null;
  assignment_id: string | null;
  expires_at: number;
  event_title: string | null;
};

type SeatingCandidateRow = {
  guild_id: string;
  recipient_user_id: string;
  source_id: string;
  action: "displaced" | "promoted";
  event_id: string;
  assignment_id: string;
  grant_id: string | null;
  credit_id: string | null;
  occurred_at: number;
  event_title: string | null;
  table_title: string | null;
};

function requireIdentifier(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${fieldName} cannot be empty`);
  return normalized;
}

function requireFiniteTime(value: number, fieldName: string): number {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new TypeError(`${fieldName} must be an integer timestamp`);
  }
  return value;
}

function assertPositiveLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new RangeError("limit must be an integer from 1 through 500");
  }
}

function configEventFromRow(row: ConfigEventRow): PriorityNotificationConfigEvent {
  if (row.applied_at === null) {
    throw new Error("Notification configuration event was not applied");
  }
  return {
    guildId: row.guild_id,
    configEventId: row.config_event_id,
    idempotencyKey: row.idempotency_key,
    fromRevision: row.from_revision,
    toRevision: row.to_revision,
    fromPreExpiryLeadMs: row.from_pre_expiry_lead_ms,
    toPreExpiryLeadMs: row.to_pre_expiry_lead_ms,
    actorUserId: row.actor_user_id,
    reason: row.reason,
    occurredAt: row.occurred_at,
    appliedAt: row.applied_at,
    createdAt: row.created_at,
  };
}

function notificationFromRow(row: NotificationRow): PriorityNotification {
  return {
    notificationId: row.notification_id,
    guildId: row.guild_id,
    recipientUserId: row.recipient_user_id,
    notificationKind: row.notification_kind,
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    grantId: row.grant_id,
    creditId: row.credit_id,
    eventId: row.event_id,
    assignmentId: row.assignment_id,
    templateRevision: row.template_revision,
    configRevision: row.config_revision,
    content: row.content,
    scheduledFor: row.scheduled_for,
    idempotencyKey: row.idempotency_key,
    discordNonce: row.discord_nonce,
    status: row.status,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    claimToken: row.claim_token,
    claimedAt: row.claimed_at,
    lastErrorKind: row.last_error_kind,
    lastErrorCode: row.last_error_code,
    lastErrorAt: row.last_error_at,
    dmChannelId: row.dm_channel_id,
    sentMessageId: row.sent_message_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at,
    terminalAt: row.terminal_at,
  };
}

function lifecycleCandidateFromRow(
  row: LifecycleCandidateRow,
): PriorityNotificationLifecycleCandidate {
  return {
    guildId: row.guild_id,
    recipientUserId: row.recipient_user_id,
    notificationKind: row.notification_kind,
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    grantId: row.grant_id,
    creditId: row.credit_id,
    eventId: row.event_id,
    assignmentId: row.assignment_id,
    occurredAt: row.occurred_at,
    expiresAt: row.expires_at,
    eventTitle: row.event_title,
    tableTitle: row.table_title,
    reason: row.reason,
    creditStatus: row.credit_status,
    availableBalance: row.available_balance,
  };
}

function expiryCandidateFromRow(
  row: ExpiryCandidateRow,
): PriorityNotificationExpiryCandidate {
  return {
    guildId: row.guild_id,
    recipientUserId: row.recipient_user_id,
    sourceId: row.source_id,
    grantId: row.grant_id,
    creditId: row.credit_id,
    eventId: row.event_id,
    assignmentId: row.assignment_id,
    expiresAt: row.expires_at,
    eventTitle: row.event_title,
  };
}

function seatingCandidateFromRow(
  row: SeatingCandidateRow,
): PriorityNotificationSeatingCandidate {
  return {
    guildId: row.guild_id,
    recipientUserId: row.recipient_user_id,
    sourceId: row.source_id,
    action: row.action,
    eventId: row.event_id,
    assignmentId: row.assignment_id,
    grantId: row.grant_id,
    creditId: row.credit_id,
    occurredAt: row.occurred_at,
    eventTitle: row.event_title,
    tableTitle: row.table_title,
  };
}

function sameEnqueueRequest(
  notification: PriorityNotification,
  input: EnqueuePriorityNotificationInput,
): boolean {
  return (
    notification.guildId === input.guildId &&
    notification.recipientUserId === input.recipientUserId &&
    notification.notificationKind === input.notificationKind &&
    notification.sourceKind === input.sourceKind &&
    notification.sourceId === input.sourceId &&
    notification.grantId === (input.grantId ?? null) &&
    notification.creditId === (input.creditId ?? null) &&
    notification.eventId === (input.eventId ?? null) &&
    notification.assignmentId === (input.assignmentId ?? null) &&
    notification.templateRevision === input.templateRevision &&
    (
      notification.notificationKind !== "credit_expiring" ||
      notification.configRevision === input.configRevision
    ) &&
    notification.content === input.content &&
    notification.scheduledFor === input.scheduledFor &&
    notification.idempotencyKey === input.idempotencyKey &&
    notification.discordNonce === input.discordNonce
  );
}

export class PriorityNotificationIdempotencyConflictError extends Error {
  constructor() {
    super("The notification idempotency key is already associated with different data.");
    this.name = "PriorityNotificationIdempotencyConflictError";
  }
}

export class PriorityNotificationConfigConflictError extends Error {
  constructor() {
    super("The configuration idempotency key is already associated with different data.");
    this.name = "PriorityNotificationConfigConflictError";
  }
}

export class PriorityNotificationRepository {
  constructor(private readonly db: D1Database) {}

  async getConfig(guildId: string): Promise<PriorityNotificationConfig> {
    requireIdentifier(guildId, "guildId");
    await this.db
      .prepare(
        `INSERT INTO priority_notification_config (
           guild_id, config_revision, template_revision,
           pre_expiry_lead_ms, max_delivery_attempts
         ) VALUES (?, 1, ?, ?, 5)
         ON CONFLICT (guild_id) DO NOTHING`,
      )
      .bind(
        guildId,
        DEFAULT_PRIORITY_NOTIFICATION_TEMPLATE_REVISION,
        DEFAULT_PRIORITY_PRE_EXPIRY_LEAD_MS,
      )
      .run();
    const row = await this.db
      .prepare(
        `SELECT guild_id, config_revision, template_revision, pre_expiry_lead_ms,
                max_delivery_attempts, created_at, updated_at
         FROM priority_notification_config WHERE guild_id = ?`,
      )
      .bind(guildId)
      .first<ConfigRow>();
    if (!row) throw new Error("DM priority notification configuration is missing");
    return {
      guildId: row.guild_id,
      configRevision: row.config_revision,
      templateRevision: row.template_revision,
      preExpiryLeadMs: row.pre_expiry_lead_ms,
      maxDeliveryAttempts: row.max_delivery_attempts,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async updateConfig(
    input: UpdatePriorityNotificationConfigInput,
  ): Promise<UpdatePriorityNotificationConfigResult> {
    requireIdentifier(input.guildId, "guildId");
    requireIdentifier(input.configEventId, "configEventId");
    requireIdentifier(input.idempotencyKey, "idempotencyKey");
    requireIdentifier(input.actorUserId, "actorUserId");
    const reason = requireIdentifier(input.reason, "reason").slice(0, 500);
    requireFiniteTime(input.updatedAt, "updatedAt");
    if (
      !Number.isInteger(input.preExpiryLeadMs) ||
      input.preExpiryLeadMs < 0 ||
      input.preExpiryLeadMs > 2_592_000_000
    ) {
      throw new RangeError("preExpiryLeadMs must be an integer from 0 through 2592000000");
    }

    await this.getConfig(input.guildId);

    const results = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO priority_notification_config_events (
             config_event_id, guild_id, idempotency_key,
             from_revision, to_revision,
             from_pre_expiry_lead_ms, to_pre_expiry_lead_ms,
             actor_user_id, reason, occurred_at, created_at
           )
           SELECT ?, guild_id, ?, config_revision, config_revision + 1,
                  pre_expiry_lead_ms, ?, ?, ?, ?, ?
           FROM priority_notification_config
           WHERE guild_id = ?
             AND NOT EXISTS (
               SELECT 1 FROM priority_notification_config_events
               WHERE guild_id = ? AND idempotency_key = ?
             )
           ON CONFLICT DO NOTHING`,
        )
        .bind(
          input.configEventId,
          input.idempotencyKey,
          input.preExpiryLeadMs,
          input.actorUserId,
          reason,
          input.updatedAt,
          input.updatedAt,
          input.guildId,
          input.guildId,
          input.idempotencyKey,
        ),
      this.db
        .prepare(
          `UPDATE priority_notification_config
           SET pre_expiry_lead_ms = (
                 SELECT to_pre_expiry_lead_ms
                 FROM priority_notification_config_events
                 WHERE guild_id = ? AND idempotency_key = ? AND applied_at IS NULL
               ),
               config_revision = (
                 SELECT to_revision FROM priority_notification_config_events
                 WHERE guild_id = ? AND idempotency_key = ? AND applied_at IS NULL
               ),
               updated_at = ?
           WHERE guild_id = ?
             AND config_revision = (
               SELECT from_revision FROM priority_notification_config_events
               WHERE guild_id = ? AND idempotency_key = ? AND applied_at IS NULL
             )`,
        )
        .bind(
          input.guildId,
          input.idempotencyKey,
          input.guildId,
          input.idempotencyKey,
          input.updatedAt,
          input.guildId,
          input.guildId,
          input.idempotencyKey,
        ),
      this.db
        .prepare(
          `UPDATE priority_notification_config_events
           SET applied_at = ?
           WHERE guild_id = ? AND idempotency_key = ? AND applied_at IS NULL
             AND EXISTS (
               SELECT 1 FROM priority_notification_config config
               WHERE config.guild_id = priority_notification_config_events.guild_id
                 AND config.config_revision = priority_notification_config_events.to_revision
                 AND config.pre_expiry_lead_ms =
                     priority_notification_config_events.to_pre_expiry_lead_ms
             )`,
        )
        .bind(input.updatedAt, input.guildId, input.idempotencyKey),
    ]);

    const row = await this.db
      .prepare(
        `SELECT * FROM priority_notification_config_events
         WHERE guild_id = ? AND idempotency_key = ?`,
      )
      .bind(input.guildId, input.idempotencyKey)
      .first<ConfigEventRow>();
    if (!row) throw new Error("Notification configuration update was not persisted");
    if (
      row.to_pre_expiry_lead_ms !== input.preExpiryLeadMs ||
      row.actor_user_id !== input.actorUserId ||
      row.reason !== reason
    ) {
      throw new PriorityNotificationConfigConflictError();
    }
    const event = configEventFromRow(row);
    const config = await this.getConfig(input.guildId);
    return {
      applied: results[1]?.meta.changes === 1,
      replayed: results[1]?.meta.changes !== 1,
      config,
      event,
    };
  }

  async getNotification(
    guildId: string,
    notificationId: string,
  ): Promise<PriorityNotification | null> {
    const row = await this.db
      .prepare(
        "SELECT * FROM priority_notification_outbox WHERE guild_id = ? AND notification_id = ?",
      )
      .bind(guildId, notificationId)
      .first<NotificationRow>();
    return row ? notificationFromRow(row) : null;
  }

  async enqueue(
    input: EnqueuePriorityNotificationInput,
  ): Promise<{ created: boolean; notification: PriorityNotification }> {
    requireIdentifier(input.notificationId, "notificationId");
    requireIdentifier(input.guildId, "guildId");
    requireIdentifier(input.recipientUserId, "recipientUserId");
    requireIdentifier(input.sourceId, "sourceId");
    requireIdentifier(input.templateRevision, "templateRevision");
    requireIdentifier(input.idempotencyKey, "idempotencyKey");
    requireIdentifier(input.discordNonce, "discordNonce");
    requireFiniteTime(input.scheduledFor, "scheduledFor");
    requireFiniteTime(input.createdAt, "createdAt");
    if (input.content.length < 1 || input.content.length > 2000) {
      throw new RangeError("Notification content must contain 1 through 2000 characters");
    }
    if (input.discordNonce.length > 25) {
      throw new RangeError("Discord nonce cannot exceed 25 characters");
    }
    if (!Number.isInteger(input.configRevision) || input.configRevision < 1) {
      throw new RangeError("configRevision must be a positive integer");
    }

    const inserted = await this.db
      .prepare(
        `INSERT INTO priority_notification_outbox (
           notification_id, guild_id, recipient_user_id, notification_kind,
           source_kind, source_id, grant_id, credit_id, event_id, assignment_id,
           template_revision, config_revision, content, scheduled_for,
           idempotency_key, discord_nonce, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT DO NOTHING`,
      )
      .bind(
        input.notificationId,
        input.guildId,
        input.recipientUserId,
        input.notificationKind,
        input.sourceKind,
        input.sourceId,
        input.grantId ?? null,
        input.creditId ?? null,
        input.eventId ?? null,
        input.assignmentId ?? null,
        input.templateRevision,
        input.configRevision,
        input.content,
        input.scheduledFor,
        input.idempotencyKey,
        input.discordNonce,
        input.createdAt,
        input.createdAt,
      )
      .run();

    let row = await this.db
      .prepare(
        `SELECT * FROM priority_notification_outbox
         WHERE guild_id = ? AND idempotency_key = ?`,
      )
      .bind(input.guildId, input.idempotencyKey)
      .first<NotificationRow>();
    row ??= await this.db
      .prepare(
        `SELECT * FROM priority_notification_outbox
         WHERE guild_id = ? AND source_kind = ? AND source_id = ?
           AND notification_kind = ? AND template_revision = ?
           AND recipient_user_id = ?`,
      )
      .bind(
        input.guildId,
        input.sourceKind,
        input.sourceId,
        input.notificationKind,
        input.templateRevision,
        input.recipientUserId,
      )
      .first<NotificationRow>();

    if (!row) throw new Error("Notification enqueue did not persist or resolve a replay");
    const notification = notificationFromRow(row);
    if (!sameEnqueueRequest(notification, input)) {
      throw new PriorityNotificationIdempotencyConflictError();
    }
    return { created: inserted.meta.changes === 1, notification };
  }

  async claimDue(input: ClaimPriorityNotificationsInput): Promise<PriorityNotification[]> {
    requireIdentifier(input.claimToken, "claimToken");
    requireFiniteTime(input.claimedAt, "claimedAt");
    assertPositiveLimit(input.limit);
    const results = await this.db.batch<NotificationRow>([
      this.db
        .prepare(
          `UPDATE priority_notification_outbox
           SET status = 'sending', claim_token = ?, claimed_at = ?,
               attempt_count = attempt_count + 1, next_attempt_at = NULL,
               updated_at = ?
           WHERE notification_id IN (
             SELECT notification_id FROM priority_notification_outbox
             WHERE status IN ('pending', 'retry')
               AND scheduled_for <= ?
               AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
             ORDER BY scheduled_for ASC, created_at ASC, notification_id ASC
             LIMIT ?
           )
             AND status IN ('pending', 'retry')`,
        )
        .bind(
          input.claimToken,
          input.claimedAt,
          input.claimedAt,
          input.claimedAt,
          input.claimedAt,
          input.limit,
        ),
      this.db
        .prepare(
          `SELECT * FROM priority_notification_outbox
           WHERE status = 'sending' AND claim_token = ? AND claimed_at = ?
           ORDER BY scheduled_for ASC, created_at ASC, notification_id ASC`,
        )
        .bind(input.claimToken, input.claimedAt),
    ]);
    return (results[1]?.results ?? []).map(notificationFromRow);
  }

  async markSent(input: MarkPriorityNotificationSentInput): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE priority_notification_outbox
         SET status = 'sent', claim_token = NULL, claimed_at = NULL,
             next_attempt_at = NULL, last_error_kind = NULL,
             last_error_code = NULL, last_error_at = NULL,
             dm_channel_id = ?, sent_message_id = ?, sent_at = ?,
             terminal_at = ?, updated_at = ?
         WHERE notification_id = ? AND status = 'sending' AND claim_token = ?`,
      )
      .bind(
        input.dmChannelId,
        input.sentMessageId,
        input.completedAt,
        input.completedAt,
        input.completedAt,
        input.notificationId,
        input.claimToken,
      )
      .run();
    return result.meta.changes === 1;
  }

  async markRetry(input: MarkPriorityNotificationRetryInput): Promise<boolean> {
    requireIdentifier(input.errorKind, "errorKind");
    const result = await this.db
      .prepare(
        `UPDATE priority_notification_outbox
         SET status = 'retry', claim_token = NULL, claimed_at = NULL,
             next_attempt_at = ?, last_error_kind = ?, last_error_code = ?,
             last_error_at = ?, dm_channel_id = COALESCE(?, dm_channel_id),
             terminal_at = NULL, updated_at = ?
         WHERE notification_id = ? AND status = 'sending' AND claim_token = ?`,
      )
      .bind(
        input.nextAttemptAt,
        input.errorKind,
        input.errorCode ?? null,
        input.completedAt,
        input.dmChannelId ?? null,
        input.completedAt,
        input.notificationId,
        input.claimToken,
      )
      .run();
    return result.meta.changes === 1;
  }

  async markTerminal(input: MarkPriorityNotificationTerminalInput): Promise<boolean> {
    if (!(["blocked", "failed", "uncertain"] as const).includes(input.status)) {
      throw new TypeError("Notification terminal status is invalid");
    }
    requireIdentifier(input.errorKind, "errorKind");
    const result = await this.db
      .prepare(
        `UPDATE priority_notification_outbox
         SET status = ?, claim_token = NULL, claimed_at = NULL,
             next_attempt_at = NULL, last_error_kind = ?, last_error_code = ?,
             last_error_at = ?, dm_channel_id = COALESCE(?, dm_channel_id),
             terminal_at = ?, updated_at = ?
         WHERE notification_id = ? AND status = 'sending' AND claim_token = ?`,
      )
      .bind(
        input.status,
        input.errorKind,
        input.errorCode ?? null,
        input.completedAt,
        input.dmChannelId ?? null,
        input.completedAt,
        input.completedAt,
        input.notificationId,
        input.claimToken,
      )
      .run();
    return result.meta.changes === 1;
  }

  async quarantineStaleSending(claimedBefore: number, now: number, limit: number): Promise<number> {
    requireFiniteTime(claimedBefore, "claimedBefore");
    requireFiniteTime(now, "now");
    assertPositiveLimit(limit);
    const result = await this.db
      .prepare(
        `UPDATE priority_notification_outbox
         SET status = 'uncertain', claim_token = NULL, claimed_at = NULL,
             next_attempt_at = NULL, last_error_kind = 'stale_sending_claim',
             last_error_code = NULL, last_error_at = ?, terminal_at = ?, updated_at = ?
         WHERE notification_id IN (
           SELECT notification_id FROM priority_notification_outbox
           WHERE status = 'sending' AND claimed_at <= ?
           ORDER BY claimed_at ASC, notification_id ASC LIMIT ?
         ) AND status = 'sending'`,
      )
      .bind(now, now, now, claimedBefore, limit)
      .run();
    return result.meta.changes;
  }

  async cancelSupersededExpiryReminders(
    guildId: string,
    currentConfigRevision: number,
    now: number,
    limit: number,
  ): Promise<number> {
    requireIdentifier(guildId, "guildId");
    if (!Number.isInteger(currentConfigRevision) || currentConfigRevision < 1) {
      throw new RangeError("currentConfigRevision must be a positive integer");
    }
    requireFiniteTime(now, "now");
    assertPositiveLimit(limit);
    const result = await this.db
      .prepare(
        `UPDATE priority_notification_outbox
         SET status = 'cancelled', claim_token = NULL, claimed_at = NULL,
             next_attempt_at = NULL,
             last_error_kind = 'notification_config_superseded',
             last_error_code = NULL, last_error_at = ?, terminal_at = ?, updated_at = ?
         WHERE notification_id IN (
           SELECT notification_id FROM priority_notification_outbox
           WHERE guild_id = ?
             AND notification_kind = 'credit_expiring'
             AND status IN ('pending', 'retry')
             AND config_revision <> ?
           ORDER BY scheduled_for ASC, notification_id ASC
           LIMIT ?
         ) AND status IN ('pending', 'retry')`,
      )
      .bind(
        now,
        now,
        now,
        guildId,
        currentConfigRevision,
        limit,
      )
      .run();
    return result.meta.changes;
  }

  async cancelInvalidExpiryReminders(now: number, limit: number): Promise<number> {
    requireFiniteTime(now, "now");
    assertPositiveLimit(limit);
    const result = await this.db
      .prepare(
        `UPDATE priority_notification_outbox
         SET status = 'cancelled', claim_token = NULL, claimed_at = NULL,
             next_attempt_at = NULL,
             last_error_kind = 'credit_no_longer_expiry_eligible',
             last_error_code = NULL, last_error_at = ?, terminal_at = ?, updated_at = ?
         WHERE notification_id IN (
           SELECT notification.notification_id
           FROM priority_notification_outbox notification
           LEFT JOIN dm_priority_credits credit
             ON credit.guild_id = notification.guild_id
            AND credit.credit_id = notification.credit_id
           LEFT JOIN priority_notification_config config
             ON config.guild_id = notification.guild_id
           WHERE notification.notification_kind = 'credit_expiring'
             AND notification.status IN ('pending', 'retry')
             AND (
               credit.credit_id IS NULL
               OR credit.status NOT IN ('available', 'reserved')
               OR credit.expires_at <= ?
               OR COALESCE(config.pre_expiry_lead_ms, ?) = 0
               OR notification.config_revision <> COALESCE(config.config_revision, 1)
             )
           ORDER BY notification.scheduled_for ASC, notification.notification_id ASC
           LIMIT ?
         ) AND status IN ('pending', 'retry')`,
      )
      .bind(now, now, now, now, DEFAULT_PRIORITY_PRE_EXPIRY_LEAD_MS, limit)
      .run();
    return result.meta.changes;
  }

  async listLifecycleCandidates(
    templateRevision: string,
    now: number,
    limit: number,
  ): Promise<PriorityNotificationLifecycleCandidate[]> {
    requireIdentifier(templateRevision, "templateRevision");
    requireFiniteTime(now, "now");
    assertPositiveLimit(limit);
    const result = await this.db
      .prepare(
        `WITH candidates AS (
           SELECT
             grant.guild_id,
             grant.dm_user_id AS recipient_user_id,
             'grant_awarded' AS notification_kind,
             'grant' AS source_kind,
             grant.grant_id AS source_id,
             grant.grant_id,
             NULL AS credit_id,
             grant.source_event_id AS event_id,
             NULL AS assignment_id,
             grant.earned_at AS occurred_at,
             grant.expires_at,
             event.title AS event_title,
             plan_table.title AS table_title,
             NULL AS reason,
             NULL AS credit_status
           FROM dm_priority_grants grant
           JOIN weekly_events event ON event.event_id = grant.source_event_id
           JOIN plan_tables plan_table ON plan_table.table_id = grant.source_table_id

           UNION ALL

           SELECT
             grant.guild_id,
             grant.dm_user_id AS recipient_user_id,
             'grant_corrected' AS notification_kind,
             'grant' AS source_kind,
             grant.grant_id AS source_id,
             grant.grant_id,
             NULL AS credit_id,
             grant.source_event_id AS event_id,
             NULL AS assignment_id,
             grant.corrected_at AS occurred_at,
             grant.expires_at,
             event.title AS event_title,
             plan_table.title AS table_title,
             grant.correction_reason AS reason,
             NULL AS credit_status
           FROM dm_priority_grants grant
           JOIN weekly_events event ON event.event_id = grant.source_event_id
           JOIN plan_tables plan_table ON plan_table.table_id = grant.source_table_id
           WHERE grant.status = 'corrected'

           UNION ALL

           SELECT
             credit_event.guild_id,
             credit.user_id AS recipient_user_id,
             CASE credit_event.action
               WHEN 'reserved' THEN 'credit_reserved'
               WHEN 'redeemed' THEN 'credit_redeemed'
               WHEN 'refunded' THEN 'credit_refunded'
               WHEN 'expired' THEN 'credit_expired'
             END AS notification_kind,
             'credit_event' AS source_kind,
             credit_event.credit_event_id AS source_id,
             credit.grant_id,
             credit.credit_id,
             credit_event.target_event_id AS event_id,
             credit_event.target_assignment_id AS assignment_id,
             credit_event.occurred_at,
             credit.expires_at,
             target_event.title AS event_title,
             NULL AS table_title,
             credit_event.reason,
             credit_event.to_status AS credit_status
           FROM dm_priority_credit_events credit_event
           JOIN dm_priority_credits credit
             ON credit.credit_id = credit_event.credit_id
            AND credit.guild_id = credit_event.guild_id
           LEFT JOIN weekly_events target_event
             ON target_event.event_id = credit_event.target_event_id
            AND target_event.guild_id = credit_event.guild_id
           WHERE credit_event.action IN ('reserved', 'redeemed', 'refunded', 'expired')
         )
         SELECT candidates.*,
                (
                  SELECT count(*)
                  FROM dm_priority_credits balance
                  WHERE balance.guild_id = candidates.guild_id
                    AND balance.user_id = candidates.recipient_user_id
                    AND balance.status = 'available'
                    AND balance.expires_at > ?
                ) AS available_balance
         FROM candidates
         WHERE NOT EXISTS (
           SELECT 1 FROM priority_notification_outbox notification
           WHERE notification.guild_id = candidates.guild_id
             AND notification.source_kind = candidates.source_kind
             AND notification.source_id = candidates.source_id
             AND notification.notification_kind = candidates.notification_kind
             AND notification.template_revision = ?
             AND notification.recipient_user_id = candidates.recipient_user_id
         )
         ORDER BY occurred_at ASC, source_id ASC, notification_kind ASC
         LIMIT ?`,
      )
      .bind(now, templateRevision, limit)
      .all<LifecycleCandidateRow>();
    return result.results.map(lifecycleCandidateFromRow);
  }

  async listExpiryCandidates(
    now: number,
    limit: number,
  ): Promise<PriorityNotificationExpiryCandidate[]> {
    requireFiniteTime(now, "now");
    assertPositiveLimit(limit);
    const result = await this.db
      .prepare(
        `SELECT
           credit.guild_id,
           credit.user_id AS recipient_user_id,
           credit.credit_id AS source_id,
           credit.grant_id,
           credit.credit_id,
           credit.target_event_id AS event_id,
           credit.target_assignment_id AS assignment_id,
           credit.expires_at,
           target_event.title AS event_title
         FROM dm_priority_credits credit
         LEFT JOIN priority_notification_config config
           ON config.guild_id = credit.guild_id
         LEFT JOIN weekly_events target_event
           ON target_event.event_id = credit.target_event_id
          AND target_event.guild_id = credit.guild_id
         WHERE credit.status IN ('available', 'reserved')
           AND credit.expires_at > ?
           AND COALESCE(config.pre_expiry_lead_ms, ?) > 0
           AND NOT EXISTS (
             SELECT 1 FROM priority_notification_outbox notification
             WHERE notification.guild_id = credit.guild_id
               AND notification.source_kind = 'credit'
               AND notification.source_id = credit.credit_id
               AND notification.notification_kind = 'credit_expiring'
               AND notification.template_revision = COALESCE(
                 config.template_revision, ?
               )
               AND notification.config_revision = COALESCE(config.config_revision, 1)
               AND notification.recipient_user_id = credit.user_id
           )
         ORDER BY credit.expires_at ASC, credit.credit_id ASC
         LIMIT ?`,
      )
      .bind(
        now,
        DEFAULT_PRIORITY_PRE_EXPIRY_LEAD_MS,
        DEFAULT_PRIORITY_NOTIFICATION_TEMPLATE_REVISION,
        limit,
      )
      .all<ExpiryCandidateRow>();
    return result.results.map(expiryCandidateFromRow);
  }

  async listSeatingCandidates(
    templateRevision: string,
    limit: number,
  ): Promise<PriorityNotificationSeatingCandidate[]> {
    requireIdentifier(templateRevision, "templateRevision");
    assertPositiveLimit(limit);
    const result = await this.db
      .prepare(
        `SELECT
           seating.guild_id,
           seating.user_id AS recipient_user_id,
           seating.seating_event_id AS source_id,
           seating.action,
           seating.event_id,
           seating.assignment_id,
           credit.grant_id,
           seating.priority_credit_id AS credit_id,
           seating.occurred_at,
           event.title AS event_title,
           plan_table.title AS table_title
         FROM priority_seating_events seating
         JOIN weekly_events event
           ON event.event_id = seating.event_id
          AND event.guild_id = seating.guild_id
         LEFT JOIN plan_tables plan_table
           ON plan_table.table_id = seating.table_id
          AND plan_table.plan_id = seating.plan_id
         LEFT JOIN dm_priority_credits credit
           ON credit.credit_id = seating.priority_credit_id
          AND credit.guild_id = seating.guild_id
         WHERE seating.action IN ('displaced', 'promoted')
           AND NOT EXISTS (
             SELECT 1 FROM priority_notification_outbox notification
             WHERE notification.guild_id = seating.guild_id
               AND notification.source_kind = 'seating_event'
               AND notification.source_id = seating.seating_event_id
               AND notification.notification_kind = CASE seating.action
                 WHEN 'displaced' THEN 'seat_displaced'
                 ELSE 'seat_promoted'
               END
               AND notification.template_revision = ?
               AND notification.recipient_user_id = seating.user_id
           )
         ORDER BY seating.occurred_at ASC, seating.seating_event_id ASC
         LIMIT ?`,
      )
      .bind(templateRevision, limit)
      .all<SeatingCandidateRow>();
    return result.results.map(seatingCandidateFromRow);
  }
}
