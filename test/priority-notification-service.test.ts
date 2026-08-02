import { describe, expect, it, vi } from "vitest";
import {
  DiscordApiError,
  discordNonce,
  safeAllowedMentions,
  type DiscordChannel,
  type DiscordMessage,
  type DiscordMessagePayload,
} from "../src/discord-api";
import { runPriorityNotificationMaintenance } from "../src/priority-maintenance";
import {
  PriorityNotificationService,
  type PriorityNotificationDiscord,
  type PriorityNotificationServiceRepository,
} from "../src/priority-notification-service";
import type {
  ClaimPriorityNotificationsInput,
  EnqueuePriorityNotificationInput,
  MarkPriorityNotificationRetryInput,
  MarkPriorityNotificationSentInput,
  MarkPriorityNotificationTerminalInput,
  PriorityNotification,
  PriorityNotificationConfig,
  PriorityNotificationExpiryCandidate,
  PriorityNotificationLifecycleCandidate,
  PriorityNotificationSeatingCandidate,
  UpdatePriorityNotificationConfigInput,
  UpdatePriorityNotificationConfigResult,
} from "../src/storage/priority-notification-repository";

const NOW = 1_800_000_000_000;
const CONFIG: PriorityNotificationConfig = {
  guildId: "100",
  configRevision: 1,
  templateRevision: "dm-priority-notifications-v1",
  preExpiryLeadMs: 72 * 60 * 60 * 1000,
  maxDeliveryAttempts: 5,
  createdAt: NOW,
  updatedAt: NOW,
};

function notificationFromInput(
  input: EnqueuePriorityNotificationInput,
): PriorityNotification {
  return {
    notificationId: input.notificationId,
    guildId: input.guildId,
    recipientUserId: input.recipientUserId,
    notificationKind: input.notificationKind,
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    grantId: input.grantId ?? null,
    creditId: input.creditId ?? null,
    eventId: input.eventId ?? null,
    assignmentId: input.assignmentId ?? null,
    templateRevision: input.templateRevision,
    configRevision: input.configRevision,
    content: input.content,
    scheduledFor: input.scheduledFor,
    idempotencyKey: input.idempotencyKey,
    discordNonce: input.discordNonce,
    status: "pending",
    attemptCount: 0,
    nextAttemptAt: null,
    claimToken: null,
    claimedAt: null,
    lastErrorKind: null,
    lastErrorCode: null,
    lastErrorAt: null,
    dmChannelId: null,
    sentMessageId: null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    sentAt: null,
    terminalAt: null,
  };
}

function claimedNotification(
  overrides: Partial<PriorityNotification> = {},
): PriorityNotification {
  return {
    notificationId: "notification-1",
    guildId: "100",
    recipientUserId: "200",
    notificationKind: "credit_reserved",
    sourceKind: "credit_event",
    sourceId: "credit-event-1",
    grantId: "grant-1",
    creditId: "credit-1",
    eventId: "event-2",
    assignmentId: null,
    templateRevision: CONFIG.templateRevision,
    configRevision: CONFIG.configRevision,
    content: "Private lifecycle update",
    scheduledFor: NOW - 1,
    idempotencyKey: "priority-notify:reserved:credit-event-1",
    discordNonce: discordNonce("priority-notify:reserved:credit-event-1"),
    status: "sending",
    attemptCount: 1,
    nextAttemptAt: null,
    claimToken: "priority-notification-claim:fixed-id",
    claimedAt: NOW,
    lastErrorKind: null,
    lastErrorCode: null,
    lastErrorAt: null,
    dmChannelId: null,
    sentMessageId: null,
    createdAt: NOW - 100,
    updatedAt: NOW,
    sentAt: null,
    terminalAt: null,
    ...overrides,
  };
}

class FakeRepository implements PriorityNotificationServiceRepository {
  config = CONFIG;
  lifecycleCandidates: PriorityNotificationLifecycleCandidate[] = [];
  expiryCandidates: PriorityNotificationExpiryCandidate[] = [];
  seatingCandidates: PriorityNotificationSeatingCandidate[] = [];
  claimed: PriorityNotification[] = [];
  readonly enqueued = new Map<string, PriorityNotification>();
  readonly claimInputs: ClaimPriorityNotificationsInput[] = [];
  private claimOffset = 0;
  readonly sent: MarkPriorityNotificationSentInput[] = [];
  readonly retried: MarkPriorityNotificationRetryInput[] = [];
  readonly terminal: MarkPriorityNotificationTerminalInput[] = [];
  readonly configUpdates: UpdatePriorityNotificationConfigInput[] = [];
  quarantineCount = 0;
  cancellationCount = 0;
  readonly supersededCancellations: Array<{
    guildId: string;
    currentConfigRevision: number;
  }> = [];

  async getConfig(guildId: string): Promise<PriorityNotificationConfig> {
    return { ...this.config, guildId };
  }

  async updateConfig(
    input: UpdatePriorityNotificationConfigInput,
  ): Promise<UpdatePriorityNotificationConfigResult> {
    this.configUpdates.push(input);
    const previous = this.config;
    this.config = {
      ...previous,
      guildId: input.guildId,
      configRevision: previous.configRevision + 1,
      preExpiryLeadMs: input.preExpiryLeadMs,
      updatedAt: input.updatedAt,
    };
    return {
      applied: true,
      replayed: false,
      config: this.config,
      event: {
        guildId: input.guildId,
        configEventId: input.configEventId,
        idempotencyKey: input.idempotencyKey,
        fromRevision: previous.configRevision,
        toRevision: this.config.configRevision,
        fromPreExpiryLeadMs: previous.preExpiryLeadMs,
        toPreExpiryLeadMs: input.preExpiryLeadMs,
        actorUserId: input.actorUserId,
        reason: input.reason,
        occurredAt: input.updatedAt,
        appliedAt: input.updatedAt,
        createdAt: input.updatedAt,
      },
    };
  }

  async enqueue(input: EnqueuePriorityNotificationInput) {
    const existing = this.enqueued.get(input.idempotencyKey);
    if (existing) return { created: false, notification: existing };
    const notification = notificationFromInput(input);
    this.enqueued.set(input.idempotencyKey, notification);
    return { created: true, notification };
  }

  async claimDue(input: ClaimPriorityNotificationsInput): Promise<PriorityNotification[]> {
    this.claimInputs.push(input);
    const claimed = this.claimed.slice(
      this.claimOffset,
      this.claimOffset + input.limit,
    );
    this.claimOffset += claimed.length;
    return claimed;
  }

  async markSent(input: MarkPriorityNotificationSentInput): Promise<boolean> {
    this.sent.push(input);
    return true;
  }

  async markRetry(input: MarkPriorityNotificationRetryInput): Promise<boolean> {
    this.retried.push(input);
    return true;
  }

  async markTerminal(input: MarkPriorityNotificationTerminalInput): Promise<boolean> {
    this.terminal.push(input);
    return true;
  }

  async cancelSupersededExpiryReminders(
    guildId: string,
    currentConfigRevision: number,
  ): Promise<number> {
    this.supersededCancellations.push({
      guildId,
      currentConfigRevision,
    });
    return this.cancellationCount;
  }

  async quarantineStaleSending(): Promise<number> {
    return this.quarantineCount;
  }

  async cancelInvalidExpiryReminders(): Promise<number> {
    return this.cancellationCount;
  }

  async listLifecycleCandidates(
    _templateRevision: string,
    _now: number,
    _limit: number,
  ): Promise<PriorityNotificationLifecycleCandidate[]> {
    return this.lifecycleCandidates.filter(
      (candidate) =>
        ![...this.enqueued.values()].some(
          (notification) =>
            notification.sourceKind === candidate.sourceKind &&
            notification.sourceId === candidate.sourceId &&
            notification.notificationKind === candidate.notificationKind,
        ),
    );
  }

  async listSeatingCandidates(): Promise<PriorityNotificationSeatingCandidate[]> {
    return this.seatingCandidates.filter(
      (candidate) =>
        ![...this.enqueued.values()].some(
          (notification) =>
            notification.sourceKind === "seating_event" &&
            notification.sourceId === candidate.sourceId &&
            notification.notificationKind ===
              (candidate.action === "displaced" ? "seat_displaced" : "seat_promoted"),
        ),
    );
  }

  async listExpiryCandidates(): Promise<PriorityNotificationExpiryCandidate[]> {
    if (this.config.preExpiryLeadMs === 0) return [];
    return this.expiryCandidates.filter(
      (candidate) =>
        ![...this.enqueued.values()].some(
          (notification) =>
            notification.sourceKind === "credit" &&
            notification.sourceId === candidate.sourceId &&
            notification.notificationKind === "credit_expiring" &&
            notification.configRevision === this.config.configRevision,
        ),
    );
  }
}

class FakeDiscord implements PriorityNotificationDiscord {
  openError: unknown;
  sendError: unknown;
  readonly opened: string[] = [];
  readonly sent: Array<{ channelId: string; payload: DiscordMessagePayload }> = [];

  async createDmChannel(userId: string): Promise<DiscordChannel> {
    this.opened.push(userId);
    if (this.openError) throw this.openError;
    return { id: "300", type: 1 };
  }

  async sendChannelMessage(
    channelId: string,
    payload: DiscordMessagePayload,
  ): Promise<DiscordMessage> {
    this.sent.push({ channelId, payload });
    if (this.sendError) throw this.sendError;
    return { id: "400", channel_id: channelId, content: payload.content ?? "" };
  }
}

function service(repository: FakeRepository, discord = new FakeDiscord()) {
  return {
    service: new PriorityNotificationService(repository, discord, {
      now: () => NOW,
      id: () => "fixed-id",
    }),
    discord,
  };
}

describe("PriorityNotificationService repair", () => {
  it("creates one deterministic award notification and replays without duplication", async () => {
    const repository = new FakeRepository();
    repository.lifecycleCandidates = [
      {
        guildId: "100",
        recipientUserId: "200",
        notificationKind: "grant_awarded",
        sourceKind: "grant",
        sourceId: "grant-1",
        grantId: "grant-1",
        creditId: null,
        eventId: "event-1",
        assignmentId: null,
        occurredAt: NOW - 10,
        expiresAt: NOW + 10_000,
        eventTitle: "New Dawn <@999>",
        tableTitle: "Chandler's table",
        reason: null,
        creditStatus: null,
        availableBalance: 2,
      },
    ];
    const { service: notifications } = service(repository);

    await expect(notifications.repairLifecycleNotifications()).resolves.toEqual({
      examined: 1,
      enqueued: 1,
      replayed: 0,
    });
    await expect(notifications.repairLifecycleNotifications()).resolves.toEqual({
      examined: 0,
      enqueued: 0,
      replayed: 0,
    });

    const saved = [...repository.enqueued.values()][0];
    expect(saved?.idempotencyKey).toBe(
      "priority-notify:dm-priority-notifications-v1:grant_awarded:grant:grant-1",
    );
    expect(saved?.discordNonce).toBe(discordNonce(saved.idempotencyKey));
    expect(saved?.content).toContain("earned **2 tokens**");
    expect(saved?.content).toContain("Status: **awarded**");
    expect(saved?.content).toContain("Current available balance: **2**");
    expect(saved?.content).toContain("/priority status");
    expect(saved?.content).not.toContain("<@999>");
  });

  it("makes refund status, expiry, and current balance actionable", async () => {
    const repository = new FakeRepository();
    repository.lifecycleCandidates = [
      {
        guildId: "100",
        recipientUserId: "200",
        notificationKind: "credit_refunded",
        sourceKind: "credit_event",
        sourceId: "credit-event-refund",
        grantId: "grant-1",
        creditId: "credit-1",
        eventId: "event-1",
        assignmentId: "assignment-1",
        occurredAt: NOW - 10,
        expiresAt: NOW - 1,
        eventTitle: "New Dawn",
        tableTitle: null,
        reason: "sensitive admin detail",
        creditStatus: "expired",
        availableBalance: 0,
      },
    ];
    const { service: notifications } = service(repository);

    await expect(notifications.repairLifecycleNotifications()).resolves.toEqual({
      examined: 1,
      enqueued: 1,
      replayed: 0,
    });

    const saved = [...repository.enqueued.values()][0];
    expect(saved?.content).toContain("Status: **expired**");
    expect(saved?.content).toContain("token expired");
    expect(saved?.content).toContain("Current available balance: **0**");
    expect(saved?.content).toContain("/priority status");
    expect(saved?.content).not.toContain("sensitive admin detail");
  });

  it("schedules the default pre-expiry reminder exactly 72 hours before expiry", async () => {
    const repository = new FakeRepository();
    const expiresAt = NOW + 10 * 24 * 60 * 60 * 1000;
    repository.expiryCandidates = [
      {
        guildId: "100",
        recipientUserId: "200",
        sourceId: "credit-1",
        grantId: "grant-1",
        creditId: "credit-1",
        eventId: null,
        assignmentId: null,
        expiresAt,
        eventTitle: null,
      },
    ];
    const { service: notifications } = service(repository);

    await notifications.repairExpiryReminders();

    const saved = [...repository.enqueued.values()][0];
    expect(saved?.scheduledFor).toBe(expiresAt - 72 * 60 * 60 * 1000);
    expect(saved?.configRevision).toBe(1);
    expect(saved?.idempotencyKey).toBe(
      "priority-notify:dm-priority-notifications-v1:config-1:credit_expiring:credit:credit-1",
    );
  });

  it("retires the old reminder revision and schedules the configured lead time", async () => {
    const repository = new FakeRepository();
    const expiresAt = NOW + 10 * 24 * 60 * 60 * 1000;
    repository.expiryCandidates = [
      {
        guildId: "100",
        recipientUserId: "200",
        sourceId: "credit-1",
        grantId: "grant-1",
        creditId: "credit-1",
        eventId: null,
        assignmentId: null,
        expiresAt,
        eventTitle: null,
      },
    ];
    const { service: notifications } = service(repository);

    await notifications.repairExpiryReminders();
    await notifications.configurePreExpiryLead({
      guildId: "100",
      reminderHours: 24,
      actorUserId: "admin-1",
      idempotencyKey: "config:24-hour-reminders",
    });
    await notifications.repairExpiryReminders();

    const reminders = [...repository.enqueued.values()];
    expect(repository.supersededCancellations).toEqual([
      { guildId: "100", currentConfigRevision: 2 },
    ]);
    expect(reminders).toHaveLength(2);
    expect(reminders.map((reminder) => reminder.configRevision)).toEqual([1, 2]);
    expect(reminders[1]).toMatchObject({
      scheduledFor: expiresAt - 24 * 60 * 60 * 1000,
      idempotencyKey:
        "priority-notify:dm-priority-notifications-v1:config-2:credit_expiring:credit:credit-1",
    });
  });

  it("audits 0 hours as an explicit reminder disable and skips expiry repair", async () => {
    const repository = new FakeRepository();
    repository.expiryCandidates = [
      {
        guildId: "100",
        recipientUserId: "200",
        sourceId: "credit-1",
        grantId: "grant-1",
        creditId: "credit-1",
        eventId: null,
        assignmentId: null,
        expiresAt: NOW + 100_000,
        eventTitle: null,
      },
    ];
    const { service: notifications } = service(repository);

    const configured = await notifications.configurePreExpiryLead({
      reminderHours: 0,
      actorUserId: "admin-1",
      idempotencyKey: "config:disable-reminders",
      guildId: "100",
    });

    expect(configured.config).toMatchObject({ configRevision: 2, preExpiryLeadMs: 0 });
    expect(repository.configUpdates[0]).toMatchObject({
      preExpiryLeadMs: 0,
      reason: "pre-expiry reminders disabled",
      updatedAt: NOW,
      guildId: "100",
    });
    await expect(notifications.repairExpiryReminders()).resolves.toEqual({
      examined: 0,
      enqueued: 0,
      replayed: 0,
    });
    expect(repository.enqueued.size).toBe(0);
  });

  it("offers a seating-event hook without querying the provisional seating schema", async () => {
    const repository = new FakeRepository();
    const { service: notifications } = service(repository);

    const result = await notifications.enqueueSeatingDecision({
      guildId: "100",
      recipientUserId: "200",
      seatingEventId: "seat-event-1",
      action: "displaced",
      eventId: "event-2",
      assignmentId: "assignment-1",
      gameTitle: "Friday game",
      tableTitle: "Table 1",
      occurredAt: NOW,
    });

    expect(result.notification).toMatchObject({
      sourceKind: "seating_event",
      sourceId: "seat-event-1",
      notificationKind: "seat_displaced",
      scheduledFor: NOW,
    });
  });

  it("repairs persisted displaced and promoted seating events exactly once", async () => {
    const repository = new FakeRepository();
    repository.seatingCandidates = [
      {
        guildId: "100",
        recipientUserId: "201",
        sourceId: "seat-event-displaced",
        action: "displaced",
        eventId: "event-2",
        assignmentId: "assignment-1",
        grantId: null,
        creditId: null,
        occurredAt: NOW - 2,
        eventTitle: "Friday game",
        tableTitle: "Table 1",
      },
      {
        guildId: "100",
        recipientUserId: "202",
        sourceId: "seat-event-promoted",
        action: "promoted",
        eventId: "event-2",
        assignmentId: "assignment-2",
        grantId: null,
        creditId: null,
        occurredAt: NOW - 1,
        eventTitle: "Friday game",
        tableTitle: "Table 1",
      },
    ];
    const { service: notifications } = service(repository);

    await expect(notifications.repairSeatingNotifications()).resolves.toEqual({
      examined: 2,
      enqueued: 2,
      replayed: 0,
    });
    await expect(notifications.repairSeatingNotifications()).resolves.toEqual({
      examined: 0,
      enqueued: 0,
      replayed: 0,
    });

    expect([...repository.enqueued.values()]).toEqual([
      expect.objectContaining({
        sourceId: "seat-event-displaced",
        notificationKind: "seat_displaced",
      }),
      expect.objectContaining({
        sourceId: "seat-event-promoted",
        notificationKind: "seat_promoted",
      }),
    ]);
  });
});

describe("PriorityNotificationService delivery", () => {
  it("sends with safe mentions and the persisted stable enforced nonce", async () => {
    const repository = new FakeRepository();
    repository.claimed = [claimedNotification()];
    const { service: notifications, discord } = service(repository);

    await expect(notifications.deliverDue(10)).resolves.toEqual({
      claimed: 1,
      sent: 1,
      retried: 0,
      blocked: 0,
      failed: 0,
      uncertain: 0,
    });

    expect(discord.opened).toEqual(["200"]);
    expect(discord.sent[0]).toEqual({
      channelId: "300",
      payload: {
        content: "Private lifecycle update",
        allowed_mentions: safeAllowedMentions(),
        nonce: repository.claimed[0]?.discordNonce,
        enforce_nonce: true,
      },
    });
    expect(repository.sent[0]).toMatchObject({
      notificationId: "notification-1",
      dmChannelId: "300",
      sentMessageId: "400",
    });
  });

  it("claims only the next notification immediately before attempting it", async () => {
    const repository = new FakeRepository();
    repository.claimed = [
      claimedNotification({ notificationId: "notification-1", recipientUserId: "201" }),
      claimedNotification({ notificationId: "notification-2", recipientUserId: "202" }),
      claimedNotification({ notificationId: "notification-3", recipientUserId: "203" }),
    ];
    const { service: notifications, discord } = service(repository);

    await expect(notifications.deliverDue(3)).resolves.toEqual({
      claimed: 3,
      sent: 3,
      retried: 0,
      blocked: 0,
      failed: 0,
      uncertain: 0,
    });

    expect(repository.claimInputs).toHaveLength(3);
    expect(repository.claimInputs.every((input) => input.limit === 1)).toBe(true);
    expect(repository.sent.map((input) => input.notificationId)).toEqual([
      "notification-1",
      "notification-2",
      "notification-3",
    ]);
    expect(discord.opened).toEqual(["201", "202", "203"]);
  });

  it("makes Discord code 50007 a definite terminal blocked result", async () => {
    const repository = new FakeRepository();
    repository.claimed = [claimedNotification()];
    const discord = new FakeDiscord();
    discord.openError = new DiscordApiError("POST", "/users/@me/channels", 403, {
      code: 50_007,
      message: "Cannot send messages to this user",
    });
    const { service: notifications } = service(repository, discord);

    const delivered = await notifications.deliverDue();

    expect(delivered).toMatchObject({ claimed: 1, blocked: 1, retried: 0 });
    expect(repository.terminal[0]).toMatchObject({
      status: "blocked",
      errorKind: "discord_dm_blocked",
      errorCode: 50_007,
    });
    expect(repository.retried).toEqual([]);
  });

  it("quarantines an ambiguous post-send network failure as uncertain with no retry", async () => {
    const repository = new FakeRepository();
    repository.claimed = [claimedNotification()];
    const discord = new FakeDiscord();
    discord.sendError = new DiscordApiError("POST", "/channels/300/messages", 0, "timeout");
    const { service: notifications } = service(repository, discord);

    const delivered = await notifications.deliverDue();

    expect(delivered).toMatchObject({ claimed: 1, uncertain: 1, retried: 0 });
    expect(repository.terminal[0]).toMatchObject({
      status: "uncertain",
      errorKind: "discord_send_outcome_uncertain",
      dmChannelId: "300",
    });
    expect(repository.retried).toEqual([]);
  });

  it("retries a network failure before any message send attempt", async () => {
    const repository = new FakeRepository();
    repository.claimed = [claimedNotification()];
    const discord = new FakeDiscord();
    discord.openError = new DiscordApiError("POST", "/users/@me/channels", 0, "timeout");
    const { service: notifications } = service(repository, discord);

    const delivered = await notifications.deliverDue();

    expect(delivered).toMatchObject({ claimed: 1, retried: 1, uncertain: 0 });
    expect(repository.retried[0]).toMatchObject({
      errorKind: "discord_before_send_transient",
      nextAttemptAt: NOW + 5 * 60 * 1000,
    });
    expect(repository.terminal).toEqual([]);
  });

  it("fails terminally when the bounded pre-send retry budget is exhausted", async () => {
    const repository = new FakeRepository();
    repository.claimed = [claimedNotification({ attemptCount: 5 })];
    const discord = new FakeDiscord();
    discord.openError = new DiscordApiError("POST", "/users/@me/channels", 503, {
      message: "unavailable",
    });
    const { service: notifications } = service(repository, discord);

    await notifications.deliverDue();

    expect(repository.terminal[0]).toMatchObject({
      status: "failed",
      errorKind: "discord_before_send_transient_retry_exhausted",
    });
    expect(repository.retried).toEqual([]);
  });
});

describe("priority notification maintenance", () => {
  it("runs bounded notification work without a guild autopilot input", async () => {
    const calls: string[] = [];
    const maintenanceService = {
      quarantineStaleDeliveries: vi.fn(async () => {
        calls.push("stale");
        return 1;
      }),
      cancelInvalidExpiryReminders: vi.fn(async () => {
        calls.push("cancel");
        return 2;
      }),
      repairLifecycleNotifications: vi.fn(async () => {
        calls.push("lifecycle");
        return { examined: 3, enqueued: 3, replayed: 0 };
      }),
      repairSeatingNotifications: vi.fn(async () => {
        calls.push("seating");
        return { examined: 2, enqueued: 2, replayed: 0 };
      }),
      repairExpiryReminders: vi.fn(async () => {
        calls.push("expiry");
        return { examined: 4, enqueued: 4, replayed: 0 };
      }),
      deliverDue: vi.fn(async () => {
        calls.push("deliver");
        return { claimed: 5, sent: 5, retried: 0, blocked: 0, failed: 0, uncertain: 0 };
      }),
    };

    const result = await runPriorityNotificationMaintenance(maintenanceService);

    expect(calls).toEqual(["stale", "cancel", "lifecycle", "seating", "expiry", "deliver"]);
    expect(maintenanceService.deliverDue).toHaveBeenCalledWith(10);
    expect(result).toMatchObject({
      staleClaimsQuarantined: 1,
      expiryRemindersCancelled: 2,
      seatingRepair: { examined: 2, enqueued: 2 },
      delivery: { sent: 5 },
    });
  });
});
