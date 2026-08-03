import { describe, expect, it, vi } from "vitest";
import {
  DiscordApiError,
  discordNonce,
  type DiscordMessagePayload,
  type DiscordRole,
} from "../src/discord-api";
import {
  ReminderConfigurationError,
  ReminderService,
  manualReminderKey,
  preLockReminderRuleId,
  reminderCapacitySummary,
  scheduledReminderKey,
  type ReminderLogEntry,
  type ReminderRepository,
} from "../src/reminder-service";
import type {
  GuildConfig,
  ReminderDelivery,
  ReminderRule,
  WeeklyEvent,
} from "../src/storage/repository";

const NOW = 1_000_000;
const GUILD_ID = "100";
const CHANNEL_ID = "200";
const ROLE_ID = "300";
const ADMIN_ROLE_ID = "301";

function discordRole(id: string, mentionable = true): DiscordRole {
  return {
    id,
    name: `Role ${id}`,
    color: 0,
    position: 1,
    permissions: "0",
    managed: false,
    mentionable,
  };
}

function event(overrides: Partial<WeeklyEvent> = {}): WeeklyEvent {
  return {
    eventId: "event-1",
    guildId: GUILD_ID,
    title: "Saturday Games",
    startsAt: NOW + 24 * 60 * 60_000,
    endsAt: NOW + 28 * 60 * 60_000,
    signupOpensAt: NOW - 7 * 24 * 60 * 60_000,
    signupLocksAt: NOW + 2 * 60 * 60_000,
    tableSelectionClosesAt: NOW + 24 * 60 * 60_000,
    status: "open",
    source: "native",
    sourceExternalId: null,
    signupChannelId: CHANNEL_ID,
    signupMessageId: "400",
    tableChannelId: CHANNEL_ID,
    tableMessageId: null,
    finalManifestChannelId: null,
    finalManifestMessageId: null,
    tableStateVersion: 0,
    finalizedPlanId: null,
    finalizedTableStateVersion: null,
    tablesFinalizedAt: null,
    createdByUserId: "500",
    createdAt: NOW - 1,
    updatedAt: NOW - 1,
    publishedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

function config(overrides: Partial<GuildConfig> = {}): GuildConfig {
  return {
    guildId: GUILD_ID,
    eventChannelId: CHANNEL_ID,
    tableChannelId: CHANNEL_ID,
    reminderChannelId: CHANNEL_ID,
    adminRoleId: null,
    gmRoleId: null,
    gmNotificationRoleId: null,
    reminderRoleId: ROLE_ID,
    timezone: "America/Denver",
    weeklyDay: 6,
    weeklyTime: "18:00",
    eventDurationMinutes: 240,
    signupOpenLeadDays: 7,
    signupLockLeadHours: 24,
    tableMinSize: 4,
    tablePreferredSize: 6,
    tableMaxSize: 6,
    schedulingEnabled: true,
    roleSyncEnabled: false,
    autoPublishEnabled: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function rule(overrides: Partial<ReminderRule> = {}): ReminderRule {
  return {
    ruleId: preLockReminderRuleId(GUILD_ID),
    guildId: GUILD_ID,
    name: "pre-lock",
    triggerKind: "signup_lock",
    offsetMinutes: 60,
    audienceKind: "configured_role",
    roleId: ROLE_ID,
    channelId: CHANNEL_ID,
    messageTemplate:
      "{event} locks at {when}. Current: {players} players, {gms} GMs, {open_seats} open seats.",
    mentionRole: true,
    enabled: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function delivery(overrides: Partial<ReminderDelivery> = {}): ReminderDelivery {
  const baseRule = rule();
  return {
    deliveryId: "delivery-1",
    ruleId: baseRule.ruleId,
    eventId: "event-1",
    channelId: CHANNEL_ID,
    recipientKind: "role",
    recipientId: ROLE_ID,
    content: baseRule.messageTemplate,
    scheduledFor: NOW - 1,
    status: "pending",
    idempotencyKey: "idempotency-1",
    attemptCount: 0,
    nextAttemptAt: null,
    lastError: null,
    sentMessageId: null,
    createdAt: NOW - 1,
    updatedAt: NOW - 1,
    sentAt: null,
    ...overrides,
  };
}

function repository(overrides: Partial<ReminderRepository> = {}): ReminderRepository {
  const scheduledKey = scheduledReminderKey("event-1", rule().ruleId);
  return {
    saveReminderRule: vi.fn().mockImplementation(async (input) => rule({
      ...input,
      roleId: input.roleId ?? null,
      channelId: input.channelId ?? null,
    })),
    listEnabledReminderRules: vi.fn().mockResolvedValue([rule()]),
    enqueueReminder: vi.fn().mockImplementation(async (input) => ({
      enqueued: true,
      delivery: delivery({
        deliveryId: input.deliveryId,
        ruleId: input.ruleId ?? null,
        eventId: input.eventId,
        channelId: input.channelId,
        recipientKind: input.recipientKind,
        recipientId: input.recipientId ?? null,
        content: input.content,
        scheduledFor: input.scheduledFor,
        idempotencyKey: input.idempotencyKey,
      }),
    })),
    claimReminder: vi.fn().mockResolvedValue(true),
    markReminderSent: vi.fn().mockResolvedValue(true),
    markReminderFailed: vi.fn().mockResolvedValue(true),
    getReminder: vi.fn().mockResolvedValue(delivery({
      idempotencyKey: scheduledKey,
    })),
    retryReminder: vi.fn().mockResolvedValue(true),
    skipReminder: vi.fn().mockResolvedValue(true),
    getWeeklyEvent: vi.fn().mockResolvedValue(event()),
    getGuildConfig: vi.fn().mockResolvedValue(config()),
    countActiveSignups: vi.fn().mockResolvedValue({ players: 9, gms: 2 }),
    ...overrides,
  };
}

function service(
  repo: ReminderRepository,
  sendChannelMessage = vi.fn().mockResolvedValue({ id: "message-1", channel_id: CHANNEL_ID }),
  logs: ReminderLogEntry[] = [],
  options: {
    now?: () => number;
    uniqueId?: () => string;
    maxAttempts?: number;
    getGuildRoles?: (guildId: string) => Promise<DiscordRole[]>;
  } = {},
): {
  instance: ReminderService;
  sendChannelMessage: ReturnType<typeof vi.fn>;
  getGuildRoles: (guildId: string) => Promise<DiscordRole[]>;
} {
  const getGuildRoles =
    options.getGuildRoles ??
    vi.fn(async (_guildId: string) => [
      discordRole(ROLE_ID),
      discordRole(ADMIN_ROLE_ID),
    ]);
  return {
    instance: new ReminderService(repo, { getGuildRoles, sendChannelMessage }, {
      now: options.now ?? (() => NOW),
      uniqueId: options.uniqueId ?? (() => "unique-1"),
      maxAttempts: options.maxAttempts,
      logger: (entry) => logs.push(entry),
    }),
    sendChannelMessage,
    getGuildRoles,
  };
}

describe("pre-lock reminder configuration and enqueue", () => {
  it("upserts one stable per-guild rule after policy validation", async () => {
    const repo = repository();
    const { instance } = service(repo);
    const input = {
      guildId: GUILD_ID,
      channelId: CHANNEL_ID,
      roleId: ROLE_ID,
      template: "{players} players and {gms} GMs; {open_seats} seats remain for {event}.",
      minutesBeforeLock: 90,
      enabled: true,
    };

    await instance.configurePreLockRule(input);
    await instance.configurePreLockRule({ ...input, minutesBeforeLock: 60 });

    expect(repo.saveReminderRule).toHaveBeenCalledTimes(2);
    expect(repo.saveReminderRule).toHaveBeenNthCalledWith(1, expect.objectContaining({
      ruleId: "reminder:pre-lock:100",
      triggerKind: "signup_lock",
      offsetMinutes: 90,
      audienceKind: "configured_role",
      mentionRole: true,
    }));
    expect(repo.saveReminderRule).toHaveBeenNthCalledWith(2, expect.objectContaining({
      ruleId: "reminder:pre-lock:100",
      offsetMinutes: 60,
    }));
  });

  it("rejects hostile templates and invalid offsets before storage", async () => {
    const repo = repository();
    const { instance } = service(repo);

    await expect(instance.configurePreLockRule({
      guildId: GUILD_ID,
      channelId: CHANNEL_ID,
      roleId: ROLE_ID,
      template: "@everyone click <@123>",
      minutesBeforeLock: 60,
      enabled: true,
    })).rejects.toThrow(ReminderConfigurationError);
    await expect(instance.configurePreLockRule({
      guildId: GUILD_ID,
      channelId: CHANNEL_ID,
      template: "Signups close soon.",
      minutesBeforeLock: 0,
      enabled: true,
    })).rejects.toThrow("minutesBeforeLock must be an integer");
    expect(repo.saveReminderRule).not.toHaveBeenCalled();
  });

  it("enqueues the per-event occurrence with a stable key and lock-relative time", async () => {
    const repo = repository();
    const { instance } = service(repo);
    const currentEvent = event();

    const result = await instance.enqueuePreLockReminder(currentEvent);

    const key = scheduledReminderKey(currentEvent.eventId, rule().ruleId);
    expect(result?.enqueued).toBe(true);
    expect(repo.enqueueReminder).toHaveBeenCalledWith({
      deliveryId: key,
      ruleId: rule().ruleId,
      eventId: currentEvent.eventId,
      channelId: CHANNEL_ID,
      recipientKind: "role",
      recipientId: ROLE_ID,
      content: rule().messageTemplate,
      scheduledFor: currentEvent.signupLocksAt - 60 * 60_000,
      idempotencyKey: key,
    });
  });

  it("skips enqueue when the rule is absent or disabled", async () => {
    const missing = repository({ listEnabledReminderRules: vi.fn().mockResolvedValue([]) });
    const disabled = repository({
      listEnabledReminderRules: vi.fn().mockResolvedValue([]),
    });

    await expect(service(missing).instance.enqueuePreLockReminder(event())).resolves.toBeNull();
    await expect(service(disabled).instance.enqueuePreLockReminder(event())).resolves.toBeNull();
    expect(missing.enqueueReminder).not.toHaveBeenCalled();
    expect(disabled.enqueueReminder).not.toHaveBeenCalled();
  });
});

describe("reminder delivery", () => {
  it("renders current counts and allows only the configured role mention", async () => {
    const repo = repository();
    const logs: ReminderLogEntry[] = [];
    const { instance, sendChannelMessage } = service(repo, undefined, logs);

    const result = await instance.deliverReminder(delivery());

    expect(result).toEqual({
      status: "sent",
      deliveryId: "delivery-1",
      messageId: "message-1",
    });
    expect(sendChannelMessage).toHaveBeenCalledTimes(1);
    const payload = sendChannelMessage.mock.calls[0][1] as DiscordMessagePayload;
    expect(payload.content).toContain("9 players, 2 GMs, 3 open seats");
    expect(payload.content).toContain(
      "Current signups: 9 players and 2 GMs; 3 maximum-capacity seats remain.",
    );
    expect(payload.allowed_mentions).toEqual({
      parse: [],
      roles: [ROLE_ID],
      users: [],
      replied_user: false,
    });
    expect(payload.content).not.toMatch(/non-?respond|did not respond|missing members/i);
    expect(repo.markReminderSent).toHaveBeenCalledWith("delivery-1", "message-1");
    expect(logs.at(-1)).toMatchObject({
      action: "deliver",
      status: "succeeded",
      deliveryId: "delivery-1",
      messageId: "message-1",
    });
    expect(JSON.stringify(logs)).not.toContain(rule().messageTemplate);
  });

  it("adds the administrator role and aggregate escalation when capacity is at risk", async () => {
    const repo = repository({
      getGuildConfig: vi.fn().mockResolvedValue(
        config({ adminRoleId: ADMIN_ROLE_ID }),
      ),
      countActiveSignups: vi.fn().mockResolvedValue({ players: 13, gms: 2 }),
    });
    const { instance, sendChannelMessage, getGuildRoles } = service(repo);

    await expect(instance.deliverReminder(delivery())).resolves.toMatchObject({
      status: "sent",
    });

    const payload = sendChannelMessage.mock.calls[0][1] as DiscordMessagePayload;
    expect(payload.allowed_mentions).toEqual({
      parse: [],
      roles: [ROLE_ID, ADMIN_ROLE_ID],
      users: [],
      replied_user: false,
    });
    expect(payload.content).toContain(
      "Organizer escalation — Capacity risk: 13 players and 2 GMs; 1 player exceeds current maximum table capacity.",
    );
    expect(getGuildRoles).toHaveBeenCalledWith(GUILD_ID);
  });

  it("fails clearly when the capacity-escalation role no longer exists", async () => {
    const repo = repository({
      getGuildConfig: vi.fn().mockResolvedValue(
        config({ adminRoleId: ADMIN_ROLE_ID }),
      ),
      countActiveSignups: vi.fn().mockResolvedValue({ players: 13, gms: 2 }),
    });
    const getGuildRoles = vi.fn(async (_guildId: string) => [discordRole(ROLE_ID)]);
    const { instance, sendChannelMessage } = service(repo, undefined, [], {
      getGuildRoles,
    });

    await expect(instance.deliverReminder(delivery())).resolves.toMatchObject({
      status: "failed",
      permanent: true,
      nextAttemptAt: null,
      reason: expect.stringContaining("organizer escalation role no longer exists"),
    });
    expect(sendChannelMessage).not.toHaveBeenCalled();
    expect(repo.markReminderFailed).toHaveBeenCalledWith(
      "delivery-1",
      expect.stringContaining("organizer escalation role no longer exists"),
      null,
    );
  });

  it("fails clearly when the capacity-escalation role cannot be mentioned", async () => {
    const repo = repository({
      getGuildConfig: vi.fn().mockResolvedValue(
        config({ adminRoleId: ADMIN_ROLE_ID }),
      ),
      countActiveSignups: vi.fn().mockResolvedValue({ players: 13, gms: 2 }),
    });
    const getGuildRoles = vi.fn(async (_guildId: string) => [
      discordRole(ROLE_ID),
      discordRole(ADMIN_ROLE_ID, false),
    ]);
    const { instance, sendChannelMessage } = service(repo, undefined, [], {
      getGuildRoles,
    });

    await expect(instance.deliverReminder(delivery())).resolves.toMatchObject({
      status: "failed",
      permanent: true,
      nextAttemptAt: null,
      reason: expect.stringContaining("organizer escalation role is not mentionable"),
    });
    expect(sendChannelMessage).not.toHaveBeenCalled();
  });

  it("does not ping the administrator role when current capacity is healthy", async () => {
    const repo = repository({
      getGuildConfig: vi.fn().mockResolvedValue(
        config({ adminRoleId: ADMIN_ROLE_ID }),
      ),
      countActiveSignups: vi.fn().mockResolvedValue({ players: 9, gms: 2 }),
    });
    const { instance, sendChannelMessage, getGuildRoles } = service(repo);

    await expect(instance.deliverReminder(delivery())).resolves.toMatchObject({
      status: "sent",
    });

    const payload = sendChannelMessage.mock.calls[0][1] as DiscordMessagePayload;
    expect(payload.allowed_mentions?.roles).toEqual([ROLE_ID]);
    expect(payload.allowed_mentions?.roles).not.toContain(ADMIN_ROLE_ID);
    expect(payload.content).not.toContain("Organizer escalation");
    expect(payload.content).toContain(
      "Current signups: 9 players and 2 GMs; 3 maximum-capacity seats remain.",
    );
    expect(getGuildRoles).not.toHaveBeenCalled();
  });

  it("does not double-send when another tick already claimed the occurrence", async () => {
    const repo = repository({ claimReminder: vi.fn().mockResolvedValue(false) });
    const { instance, sendChannelMessage } = service(repo);

    const result = await instance.deliverReminder(delivery({ status: "sent" }));

    expect(result.status).toBe("skipped");
    expect(sendChannelMessage).not.toHaveBeenCalled();
    expect(repo.markReminderSent).not.toHaveBeenCalled();
  });

  it("rejects a role that differs from the currently configured rule", async () => {
    const repo = repository();
    const { instance, sendChannelMessage } = service(repo);

    const result = await instance.deliverReminder(delivery({ recipientId: "999" }));

    expect(result).toMatchObject({ status: "failed", permanent: true });
    expect(sendChannelMessage).not.toHaveBeenCalled();
    expect(repo.markReminderFailed).toHaveBeenCalledWith(
      "delivery-1",
      expect.stringContaining("does not match the explicitly configured role"),
      null,
    );
  });

  it("retries transient Discord failures with capped exponential backoff", async () => {
    const repo = repository();
    const send = vi.fn().mockRejectedValue(
      new DiscordApiError("POST", `/channels/${CHANNEL_ID}/messages`, 503, {
        message: "temporarily unavailable",
      }),
    );
    const { instance } = service(repo, send);

    const result = await instance.deliverReminder(delivery({ attemptCount: 2 }));

    expect(result).toMatchObject({
      status: "failed",
      permanent: false,
      nextAttemptAt: NOW + 4 * 60_000,
    });
    expect(repo.markReminderFailed).toHaveBeenCalledWith(
      "delivery-1",
      expect.stringContaining("HTTP 503"),
      NOW + 4 * 60_000,
    );
  });

  it("does not retry permanent permission errors", async () => {
    const repo = repository();
    const send = vi.fn().mockRejectedValue(
      new DiscordApiError("POST", `/channels/${CHANNEL_ID}/messages`, 403, {
        message: "Missing Permissions",
      }),
    );
    const { instance } = service(repo, send);

    const result = await instance.deliverReminder(delivery());

    expect(result).toMatchObject({ status: "failed", permanent: true, nextAttemptAt: null });
    expect(repo.markReminderFailed).toHaveBeenCalledWith(
      "delivery-1",
      expect.stringContaining("HTTP 403"),
      null,
    );
  });

  it("expires before sending at the signup lock boundary", async () => {
    const lockingEvent = event({ signupLocksAt: NOW });
    const repo = repository({ getWeeklyEvent: vi.fn().mockResolvedValue(lockingEvent) });
    const { instance, sendChannelMessage } = service(repo);

    const result = await instance.deliverReminder(delivery());

    expect(result).toMatchObject({ status: "expired", permanent: true, nextAttemptAt: null });
    expect(sendChannelMessage).not.toHaveBeenCalled();
    expect(repo.markReminderFailed).toHaveBeenCalledWith(
      "delivery-1",
      "Pre-lock reminder expired when signups locked.",
      null,
    );
  });

  it("stops retrying once the maximum attempt count is reached", async () => {
    const repo = repository();
    const send = vi.fn().mockRejectedValue(new Error("network unavailable"));
    const { instance } = service(repo, send, [], { maxAttempts: 3 });

    const result = await instance.deliverReminder(delivery({ attemptCount: 2 }));

    expect(result).toMatchObject({ status: "failed", permanent: true, nextAttemptAt: null });
  });

  it("caps exponential backoff below the signup-lock expiry", async () => {
    const repo = repository();
    const send = vi.fn().mockRejectedValue(new Error("network unavailable"));
    const { instance } = service(repo, send, [], { maxAttempts: 20 });

    const result = await instance.deliverReminder(delivery({ attemptCount: 10 }));

    expect(result).toMatchObject({
      status: "failed",
      permanent: false,
      nextAttemptAt: NOW + 60 * 60_000,
    });
  });

  it("never retries an uncertain send that could already be visible", async () => {
    const repo = repository({ markReminderSent: vi.fn().mockResolvedValue(false) });
    const { instance, sendChannelMessage } = service(repo);

    const result = await instance.deliverReminder(delivery());

    expect(sendChannelMessage).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: "failed",
      permanent: true,
      nextAttemptAt: null,
      reason: expect.stringContaining("prevent a duplicate notification"),
    });
    expect(repo.markReminderFailed).toHaveBeenCalledWith(
      "delivery-1",
      expect.stringContaining("prevent a duplicate notification"),
      null,
    );
  });

  it("recovers a stale sending delivery with the same stable Discord nonce", async () => {
    const repo = repository();
    const { instance, sendChannelMessage } = service(repo);
    const stale = delivery({
      status: "sending",
      updatedAt: NOW - 10 * 60_000,
      idempotencyKey: scheduledReminderKey("event-1", rule().ruleId),
    });

    await expect(instance.deliverReminder(stale)).resolves.toMatchObject({ status: "sent" });

    expect(repo.claimReminder).toHaveBeenCalledWith(stale.deliveryId);
    const payload = sendChannelMessage.mock.calls[0][1] as DiscordMessagePayload;
    expect(payload.nonce).toBe(discordNonce("reminder:" + stale.deliveryId));
    expect(payload.enforce_nonce).toBe(true);
  });
});

describe("scheduled reminder recovery controls", () => {
  it("retries a permanently failed original occurrence without enqueueing a new one", async () => {
    const original = delivery({
      status: "failed",
      attemptCount: 1,
      nextAttemptAt: null,
      lastError: "Missing Permissions",
      idempotencyKey: scheduledReminderKey("event-1", rule().ruleId),
    });
    const repo = repository({ getReminder: vi.fn().mockResolvedValue(original) });
    const { instance, sendChannelMessage } = service(repo);

    const result = await instance.retryScheduledReminder(original.deliveryId);

    expect(result).toMatchObject({ status: "sent", deliveryId: original.deliveryId });
    expect(repo.retryReminder).toHaveBeenCalledWith(original.deliveryId);
    expect(repo.enqueueReminder).not.toHaveBeenCalled();
    const payload = sendChannelMessage.mock.calls[0][1] as DiscordMessagePayload;
    expect(payload.nonce).toBe(discordNonce("reminder:" + original.deliveryId));
    expect(payload.enforce_nonce).toBe(true);
  });

  it("skips the original scheduled occurrence without creating another delivery", async () => {
    const original = delivery({
      status: "failed",
      idempotencyKey: scheduledReminderKey("event-1", rule().ruleId),
    });
    const repo = repository({ getReminder: vi.fn().mockResolvedValue(original) });
    const { instance, sendChannelMessage } = service(repo);

    const result = await instance.skipScheduledReminder(original.deliveryId, "Not needed this week");

    expect(result).toMatchObject({
      status: "skipped",
      permanent: true,
      reason: "Not needed this week",
    });
    expect(repo.skipReminder).toHaveBeenCalledWith(original.deliveryId, "Not needed this week");
    expect(repo.enqueueReminder).not.toHaveBeenCalled();
    expect(sendChannelMessage).not.toHaveBeenCalled();
  });

  it("expires a retry at the signup lock and records the original occurrence as skipped", async () => {
    const original = delivery({
      status: "failed",
      idempotencyKey: scheduledReminderKey("event-1", rule().ruleId),
    });
    const repo = repository({
      getReminder: vi.fn().mockResolvedValue(original),
      getWeeklyEvent: vi.fn().mockResolvedValue(event({ signupLocksAt: NOW })),
    });
    const { instance, sendChannelMessage } = service(repo);

    const result = await instance.retryScheduledReminder(original.deliveryId);

    expect(result).toMatchObject({ status: "expired", permanent: true });
    expect(repo.skipReminder).toHaveBeenCalledWith(
      original.deliveryId,
      "Pre-lock reminder expired when signups locked.",
    );
    expect(repo.retryReminder).not.toHaveBeenCalled();
    expect(sendChannelMessage).not.toHaveBeenCalled();
  });

  it("rejects retry and skip for manual or resend occurrences", async () => {
    const manual = delivery({
      idempotencyKey: manualReminderKey("event-1", rule().ruleId),
    });
    const repo = repository({ getReminder: vi.fn().mockResolvedValue(manual) });
    const { instance } = service(repo);

    await expect(instance.retryScheduledReminder(manual.deliveryId)).rejects.toThrow(
      "Only the original scheduled reminder occurrence",
    );
    await expect(instance.skipScheduledReminder(manual.deliveryId)).rejects.toThrow(
      "Only the original scheduled reminder occurrence",
    );
    expect(repo.retryReminder).not.toHaveBeenCalled();
    expect(repo.skipReminder).not.toHaveBeenCalled();
  });
});

describe("manual reminders", () => {
  it("uses one stable key unless explicit resend is confirmed", async () => {
    const inputs: string[] = [];
    let claimCount = 0;
    const repo = repository({
      enqueueReminder: vi.fn().mockImplementation(async (input) => {
        inputs.push(input.idempotencyKey);
        return {
          enqueued: true,
          delivery: delivery({
            deliveryId: input.deliveryId,
            idempotencyKey: input.idempotencyKey,
            scheduledFor: input.scheduledFor,
          }),
        };
      }),
      claimReminder: vi.fn().mockImplementation(async () => {
        claimCount += 1;
        return claimCount !== 2;
      }),
    });
    let unique = 0;
    const { instance } = service(repo, undefined, [], {
      uniqueId: () => `unique-${++unique}`,
    });

    await instance.sendManualReminder({ event: event() });
    await instance.sendManualReminder({ event: event() });
    await instance.sendManualReminder({ event: event(), explicitResend: true });
    await instance.sendManualReminder({ event: event(), explicitResend: true });

    const stable = manualReminderKey("event-1", rule().ruleId);
    expect(inputs[0]).toBe(stable);
    expect(inputs[1]).toBe(stable);
    expect(inputs[2]).toBe(`${stable}:resend:${NOW}:unique-1`);
    expect(inputs[3]).toBe(`${stable}:resend:${NOW}:unique-2`);
    expect(new Set(inputs.slice(2)).size).toBe(2);
  });
});

describe("capacity summaries", () => {
  it("uses only aggregate counts for admin-safe risk reporting", () => {
    expect(reminderCapacitySummary({ players: 7, gms: 0, gmBackups: 0 }, 6)).toEqual({
      openSeats: 0,
      atRisk: true,
      summary: "Capacity risk: 7 players and 0 GMs; at least one GM is needed.",
    });
    expect(reminderCapacitySummary({ players: 13, gms: 2, gmBackups: 0 }, 6)).toEqual({
      openSeats: 0,
      atRisk: true,
      summary:
        "Capacity risk: 13 players and 2 GMs; 1 player exceeds current maximum table capacity.",
    });
  });
});
