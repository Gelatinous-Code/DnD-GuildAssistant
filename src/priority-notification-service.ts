import {
  DiscordApiError,
  discordNonce,
  discordTimestamp,
  safeAllowedMentions,
  type DiscordChannel,
  type DiscordMessage,
  type DiscordMessagePayload,
} from "./discord-api";
import {
  DEFAULT_PRIORITY_NOTIFICATION_TEMPLATE_REVISION,
  PriorityNotificationRepository,
  type EnqueuePriorityNotificationInput,
  type PriorityNotification,
  type PriorityNotificationConfig,
  type PriorityNotificationExpiryCandidate,
  type PriorityNotificationKind,
  type PriorityNotificationLifecycleCandidate,
  type UpdatePriorityNotificationConfigResult,
} from "./storage/priority-notification-repository";

export type PriorityNotificationServiceRepository = Pick<
  PriorityNotificationRepository,
  | "getConfig"
  | "updateConfig"
  | "enqueue"
  | "claimDue"
  | "markSent"
  | "markRetry"
  | "markTerminal"
  | "quarantineStaleSending"
  | "cancelSupersededExpiryReminders"
  | "cancelInvalidExpiryReminders"
  | "listLifecycleCandidates"
  | "listSeatingCandidates"
  | "listExpiryCandidates"
>;

export interface PriorityNotificationDiscord {
  createDmChannel(userId: string): Promise<DiscordChannel>;
  sendChannelMessage(
    channelId: string,
    payload: DiscordMessagePayload,
  ): Promise<DiscordMessage>;
}

export interface PriorityNotificationServiceOptions {
  now?: () => number;
  id?: () => string;
}

export interface PriorityNotificationRepairResult {
  examined: number;
  enqueued: number;
  replayed: number;
}

export interface PriorityNotificationDeliveryResult {
  claimed: number;
  sent: number;
  retried: number;
  blocked: number;
  failed: number;
  uncertain: number;
}

export interface EnqueueSeatingDecisionNotificationInput {
  guildId: string;
  recipientUserId: string;
  seatingEventId: string;
  action: "displaced" | "promoted";
  eventId: string;
  assignmentId?: string | null;
  grantId?: string | null;
  creditId?: string | null;
  gameTitle?: string | null;
  tableTitle?: string | null;
  occurredAt?: number;
}

export interface ConfigurePriorityExpiryReminderInput {
  guildId: string;
  reminderHours: number;
  actorUserId: string;
  idempotencyKey: string;
  reason?: string;
}

type DeliveryPhase = "open_dm" | "send_message";
type FailureDisposition = "retry" | "blocked" | "failed" | "uncertain";

function defaultId(): string {
  return crypto.randomUUID();
}

function requireIdentifier(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${fieldName} cannot be empty`);
  return normalized;
}

function assertPositiveLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new RangeError("limit must be an integer from 1 through 500");
  }
}

function safeLabel(value: string | null | undefined, fallback: string): string {
  const normalized = (value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\\/g, "\\\\")
    .replace(/([`*_~|])/g, "\\$1")
    .replace(/@/g, "@\u200b")
    .replace(/</g, "‹");
  const selected = normalized || fallback;
  return selected.length <= 120 ? selected : `${selected.slice(0, 119)}…`;
}

function lifecycleContent(candidate: PriorityNotificationLifecycleCandidate): string {
  const game = safeLabel(candidate.eventTitle, "your guild game");
  const table = safeLabel(candidate.tableTitle, "your table");
  const expiry = discordTimestamp(candidate.expiresAt, "R");
  const balance = `Current available balance: **${candidate.availableBalance}**.`;
  const review = "Use `/priority status` to review your tokens and reservations.";
  switch (candidate.notificationKind) {
    case "grant_awarded":
      return (
        "**DM Priority Tokens earned**\n" +
        `Status: **awarded**. You earned **2 tokens** for running **${table}** in **${game}**. ` +
        `They expire ${expiry}.\n${balance} ${review}`
      );
    case "credit_reserved":
      return (
        "**DM Priority Token reserved**\n" +
        `Status: **reserved** for **${game}**. It is not spent until your seat is confirmed. ` +
        `Token expiry: ${expiry}.\n${balance} ${review}`
      );
    case "credit_redeemed":
      return (
        "**DM Priority Token used**\n" +
        `Status: **redeemed**. One token was used when your seat for **${game}** was confirmed. ` +
        `Original token expiry: ${expiry}.\n${balance} ${review}`
      );
    case "credit_refunded": {
      const status = candidate.creditStatus === "available" ? "available" : "expired";
      const detail = status === "available"
        ? `It is available again and expires ${expiry}.`
        : `The refund was recorded, but the token expired ${expiry}.`;
      return (
        "**DM Priority Token returned**\n" +
        `Status: **${status}**. ${detail}\n${balance} ${review}`
      );
    }
    case "credit_expired":
      return (
        "**DM Priority Token expired**\n" +
        `Status: **expired**. One unused or reserved token expired ${expiry}.\n` +
        `${balance} ${review}`
      );
    case "grant_corrected":
      return (
        "**DM Priority Token correction**\n" +
        `Status: **corrected**. An admin corrected a prior token award that originally expired ${expiry}.\n` +
        `${balance} ${review}`
      );
  }
}

function expiryContent(candidate: PriorityNotificationExpiryCandidate): string {
  const target = candidate.eventTitle
    ? ` Your current reservation is for **${safeLabel(candidate.eventTitle, "your guild game")}**.`
    : "";
  return (
    "**DM Priority Token expiring soon**\n" +
    `One token expires ${discordTimestamp(candidate.expiresAt, "R")}.${target} ` +
    "Use `/priority status` to review it."
  );
}

function seatingContent(input: EnqueueSeatingDecisionNotificationInput): string {
  const game = safeLabel(input.gameTitle, "your guild game");
  const table = safeLabel(input.tableTitle, "your selected table");
  if (input.action === "displaced") {
    return (
      "**Table seat changed**\n" +
      `A DM Priority Token request filled a seat at **${table}** for **${game}**. ` +
      "You are now on the waitlist and will be promoted automatically if a seat opens."
    );
  }
  return (
    "**You were promoted to a table**\n" +
    `A seat opened at **${table}** for **${game}**, and you were moved from the waitlist into it.`
  );
}

function notificationIdempotencyKey(
  templateRevision: string,
  configRevision: number,
  kind: PriorityNotificationKind,
  sourceKind: string,
  sourceId: string,
): string {
  const revisionIdentity = kind === "credit_expiring"
    ? `config-${configRevision}:`
    : "";
  const key = `priority-notify:${templateRevision}:${revisionIdentity}${kind}:${sourceKind}:${sourceId}`;
  if (key.length > 500) {
    throw new RangeError("Notification source identifiers exceed the idempotency-key limit");
  }
  return key;
}

function classifyFailure(error: unknown, phase: DeliveryPhase): {
  disposition: FailureDisposition;
  errorKind: string;
  errorCode: number | null;
} {
  if (!(error instanceof DiscordApiError)) {
    return {
      disposition: phase === "send_message" ? "uncertain" : "failed",
      errorKind:
        phase === "send_message" ? "unknown_after_send_attempt" : "unexpected_before_send",
      errorCode: null,
    };
  }

  if (error.code === 50_007) {
    return {
      disposition: "blocked",
      errorKind: "discord_dm_blocked",
      errorCode: error.code,
    };
  }

  if (phase === "open_dm") {
    const retryable =
      error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500;
    return {
      disposition: retryable ? "retry" : "failed",
      errorKind: retryable ? "discord_before_send_transient" : "discord_before_send_permanent",
      errorCode: error.code ?? error.status,
    };
  }

  if (error.status === 429) {
    return {
      disposition: "retry",
      errorKind: "discord_rate_limited_before_acceptance",
      errorCode: error.code ?? error.status,
    };
  }
  if (error.status === 0 || error.status === 408 || error.status >= 500) {
    return {
      disposition: "uncertain",
      errorKind: "discord_send_outcome_uncertain",
      errorCode: error.code ?? (error.status || null),
    };
  }
  return {
    disposition: "failed",
    errorKind: "discord_send_rejected",
    errorCode: error.code ?? error.status,
  };
}

function retryAt(now: number, attemptCount: number): number {
  const exponent = Math.min(Math.max(attemptCount - 1, 0), 6);
  return now + Math.min(5 * 60 * 1000 * 2 ** exponent, 6 * 60 * 60 * 1000);
}

export class PriorityNotificationService {
  private readonly now: () => number;
  private readonly id: () => string;

  constructor(
    private readonly repository: PriorityNotificationServiceRepository,
    private readonly discord: PriorityNotificationDiscord,
    options: PriorityNotificationServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.id = options.id ?? defaultId;
  }

  private async configForGuild(
    guildId: string,
    cache: Map<string, PriorityNotificationConfig>,
  ): Promise<PriorityNotificationConfig> {
    const cached = cache.get(guildId);
    if (cached) return cached;
    const config = await this.repository.getConfig(guildId);
    cache.set(guildId, config);
    return config;
  }

  private async enqueue(
    config: PriorityNotificationConfig,
    input: Omit<
      EnqueuePriorityNotificationInput,
      "notificationId" | "templateRevision" | "configRevision" | "idempotencyKey" | "discordNonce" | "createdAt"
    >,
  ): Promise<{ created: boolean; notification: PriorityNotification }> {
    const idempotencyKey = notificationIdempotencyKey(
      config.templateRevision,
      config.configRevision,
      input.notificationKind,
      input.sourceKind,
      input.sourceId,
    );
    return this.repository.enqueue({
      ...input,
      notificationId: this.id(),
      templateRevision: config.templateRevision,
      configRevision: config.configRevision,
      idempotencyKey,
      discordNonce: discordNonce(idempotencyKey),
      createdAt: this.now(),
    });
  }

  async repairLifecycleNotifications(limit = 100): Promise<PriorityNotificationRepairResult> {
    assertPositiveLimit(limit);
    const candidates = await this.repository.listLifecycleCandidates(
      DEFAULT_PRIORITY_NOTIFICATION_TEMPLATE_REVISION,
      this.now(),
      limit,
    );
    const configs = new Map<string, PriorityNotificationConfig>();
    let enqueued = 0;
    for (const candidate of candidates) {
      const config = await this.configForGuild(candidate.guildId, configs);
      const result = await this.enqueue(config, {
        guildId: candidate.guildId,
        recipientUserId: candidate.recipientUserId,
        notificationKind: candidate.notificationKind,
        sourceKind: candidate.sourceKind,
        sourceId: candidate.sourceId,
        grantId: candidate.grantId,
        creditId: candidate.creditId,
        eventId: candidate.eventId,
        assignmentId: candidate.assignmentId,
        content: lifecycleContent(candidate),
        scheduledFor: candidate.occurredAt,
      });
      if (result.created) enqueued += 1;
    }
    return {
      examined: candidates.length,
      enqueued,
      replayed: candidates.length - enqueued,
    };
  }

  async repairSeatingNotifications(limit = 100): Promise<PriorityNotificationRepairResult> {
    assertPositiveLimit(limit);
    const candidates = await this.repository.listSeatingCandidates(
      DEFAULT_PRIORITY_NOTIFICATION_TEMPLATE_REVISION,
      limit,
    );
    const configs = new Map<string, PriorityNotificationConfig>();
    let enqueued = 0;
    for (const candidate of candidates) {
      const config = await this.configForGuild(candidate.guildId, configs);
      const seatingInput: EnqueueSeatingDecisionNotificationInput = {
        guildId: candidate.guildId,
        recipientUserId: candidate.recipientUserId,
        seatingEventId: candidate.sourceId,
        action: candidate.action,
        eventId: candidate.eventId,
        assignmentId: candidate.assignmentId,
        grantId: candidate.grantId,
        creditId: candidate.creditId,
        gameTitle: candidate.eventTitle,
        tableTitle: candidate.tableTitle,
        occurredAt: candidate.occurredAt,
      };
      const result = await this.enqueue(config, {
        guildId: candidate.guildId,
        recipientUserId: candidate.recipientUserId,
        notificationKind:
          candidate.action === "displaced" ? "seat_displaced" : "seat_promoted",
        sourceKind: "seating_event",
        sourceId: candidate.sourceId,
        grantId: candidate.grantId,
        creditId: candidate.creditId,
        eventId: candidate.eventId,
        assignmentId: candidate.assignmentId,
        content: seatingContent(seatingInput),
        scheduledFor: candidate.occurredAt,
      });
      if (result.created) enqueued += 1;
    }
    return {
      examined: candidates.length,
      enqueued,
      replayed: candidates.length - enqueued,
    };
  }

  async configurePreExpiryLead(
    input: ConfigurePriorityExpiryReminderInput,
  ): Promise<UpdatePriorityNotificationConfigResult> {
    requireIdentifier(input.guildId, "guildId");
    requireIdentifier(input.actorUserId, "actorUserId");
    requireIdentifier(input.idempotencyKey, "idempotencyKey");
    if (
      !Number.isInteger(input.reminderHours) ||
      input.reminderHours < 0 ||
      input.reminderHours > 720
    ) {
      throw new RangeError("reminderHours must be an integer from 0 through 720");
    }
    const reason = input.reason?.trim() ||
      (input.reminderHours === 0
        ? "pre-expiry reminders disabled"
        : `pre-expiry reminder configured to ${input.reminderHours} hours`);
    const updatedAt = this.now();
    const result = await this.repository.updateConfig({
      guildId: input.guildId,
      configEventId: this.id(),
      idempotencyKey: input.idempotencyKey,
      preExpiryLeadMs: input.reminderHours * 60 * 60 * 1000,
      actorUserId: input.actorUserId,
      reason,
      updatedAt,
    });
    await this.repository.cancelSupersededExpiryReminders(
      input.guildId,
      result.config.configRevision,
      updatedAt,
      500,
    );
    return result;
  }

  async repairExpiryReminders(limit = 100): Promise<PriorityNotificationRepairResult> {
    assertPositiveLimit(limit);
    const now = this.now();
    const candidates = await this.repository.listExpiryCandidates(now, limit);
    const configs = new Map<string, PriorityNotificationConfig>();
    let enqueued = 0;
    for (const candidate of candidates) {
      const config = await this.configForGuild(candidate.guildId, configs);
      if (config.preExpiryLeadMs === 0) continue;
      const result = await this.enqueue(config, {
        guildId: candidate.guildId,
        recipientUserId: candidate.recipientUserId,
        notificationKind: "credit_expiring",
        sourceKind: "credit",
        sourceId: candidate.sourceId,
        grantId: candidate.grantId,
        creditId: candidate.creditId,
        eventId: candidate.eventId,
        assignmentId: candidate.assignmentId,
        content: expiryContent(candidate),
        scheduledFor: Math.max(now, candidate.expiresAt - config.preExpiryLeadMs),
      });
      if (result.created) enqueued += 1;
    }
    return {
      examined: candidates.length,
      enqueued,
      replayed: candidates.length - enqueued,
    };
  }

  async enqueueSeatingDecision(
    input: EnqueueSeatingDecisionNotificationInput,
  ): Promise<{ created: boolean; notification: PriorityNotification }> {
    requireIdentifier(input.guildId, "guildId");
    requireIdentifier(input.recipientUserId, "recipientUserId");
    requireIdentifier(input.seatingEventId, "seatingEventId");
    requireIdentifier(input.eventId, "eventId");
    const config = await this.repository.getConfig(input.guildId);
    return this.enqueue(config, {
      guildId: input.guildId,
      recipientUserId: input.recipientUserId,
      notificationKind: input.action === "displaced" ? "seat_displaced" : "seat_promoted",
      sourceKind: "seating_event",
      sourceId: input.seatingEventId,
      grantId: input.grantId ?? null,
      creditId: input.creditId ?? null,
      eventId: input.eventId,
      assignmentId: input.assignmentId ?? null,
      content: seatingContent(input),
      scheduledFor: input.occurredAt ?? this.now(),
    });
  }

  async cancelInvalidExpiryReminders(limit = 100): Promise<number> {
    assertPositiveLimit(limit);
    return this.repository.cancelInvalidExpiryReminders(this.now(), limit);
  }

  async quarantineStaleDeliveries(
    limit = 100,
    staleAfterMs = 15 * 60 * 1000,
  ): Promise<number> {
    assertPositiveLimit(limit);
    if (!Number.isInteger(staleAfterMs) || staleAfterMs < 60_000) {
      throw new RangeError("staleAfterMs must be at least one minute");
    }
    const now = this.now();
    return this.repository.quarantineStaleSending(now - staleAfterMs, now, limit);
  }

  private async recordFailure(
    notification: PriorityNotification,
    claimToken: string,
    phase: DeliveryPhase,
    error: unknown,
    config: PriorityNotificationConfig,
    completedAt: number,
    dmChannelId: string | null,
  ): Promise<FailureDisposition> {
    let classified = classifyFailure(error, phase);
    if (
      classified.disposition === "retry" &&
      notification.attemptCount >= config.maxDeliveryAttempts
    ) {
      classified = {
        disposition: "failed",
        errorKind: `${classified.errorKind}_retry_exhausted`,
        errorCode: classified.errorCode,
      };
    }

    const common = {
      notificationId: notification.notificationId,
      claimToken,
      completedAt,
      errorKind: classified.errorKind,
      errorCode: classified.errorCode,
      dmChannelId,
    };
    const recorded = classified.disposition === "retry"
      ? await this.repository.markRetry({
          ...common,
          nextAttemptAt: retryAt(completedAt, notification.attemptCount),
        })
      : await this.repository.markTerminal({
          ...common,
          status: classified.disposition,
        });
    if (!recorded) {
      throw new Error(`Priority notification claim was lost for ${notification.notificationId}`);
    }
    return classified.disposition;
  }

  async deliverDue(limit = 50): Promise<PriorityNotificationDeliveryResult> {
    assertPositiveLimit(limit);
    const configs = new Map<string, PriorityNotificationConfig>();
    const result: PriorityNotificationDeliveryResult = {
      claimed: 0,
      sent: 0,
      retried: 0,
      blocked: 0,
      failed: 0,
      uncertain: 0,
    };

    for (let delivered = 0; delivered < limit; delivered += 1) {
      const claimedAt = this.now();
      const claimToken = `priority-notification-claim:${this.id()}`;
      const [notification] = await this.repository.claimDue({
        claimToken,
        claimedAt,
        limit: 1,
      });
      if (!notification) break;
      result.claimed += 1;
      const config = await this.configForGuild(notification.guildId, configs);
      let channel: DiscordChannel;
      try {
        channel = await this.discord.createDmChannel(notification.recipientUserId);
      } catch (error) {
        const disposition = await this.recordFailure(
          notification,
          claimToken,
          "open_dm",
          error,
          config,
          this.now(),
          null,
        );
        result[disposition === "retry" ? "retried" : disposition] += 1;
        continue;
      }

      let message: DiscordMessage;
      try {
        message = await this.discord.sendChannelMessage(channel.id, {
          content: notification.content,
          allowed_mentions: safeAllowedMentions(),
          nonce: notification.discordNonce,
          enforce_nonce: true,
        });
      } catch (error) {
        const disposition = await this.recordFailure(
          notification,
          claimToken,
          "send_message",
          error,
          config,
          this.now(),
          channel.id,
        );
        result[disposition === "retry" ? "retried" : disposition] += 1;
        continue;
      }

      const completedAt = this.now();
      const recorded = await this.repository.markSent({
        notificationId: notification.notificationId,
        claimToken,
        dmChannelId: channel.id,
        sentMessageId: message.id,
        completedAt,
      });
      if (!recorded) {
        throw new Error(`Priority notification claim was lost for ${notification.notificationId}`);
      }
      result.sent += 1;
    }

    return result;
  }
}
