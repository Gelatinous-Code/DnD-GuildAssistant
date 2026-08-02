import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  DiscordApiError,
  safeAllowedMentions,
  type DiscordChannel,
  type DiscordMessage,
  type DiscordMessagePayload,
} from "../../src/discord-api";
import {
  PriorityNotificationService,
  type PriorityNotificationDiscord,
} from "../../src/priority-notification-service";
import { PriorityNotificationRepository } from "../../src/storage/priority-notification-repository";
import { PriorityRepository } from "../../src/storage/priority-repository";

const NOW = 1_800_000_000_000;

interface NotificationFixture {
  prefix: string;
  guildId: string;
  userId: string;
  sourceEventId: string;
  sourcePlanId: string;
  sourceTableId: string;
  targetEventId: string;
  earnedAt: number;
  expiresAt: number;
}

async function createNotificationFixture(): Promise<NotificationFixture> {
  const prefix = crypto.randomUUID();
  const guildId = `${prefix}:guild`;
  const userId = `${prefix}:member`;
  const sourceEventId = `${prefix}:source-event`;
  const sourcePlanId = `${prefix}:source-plan`;
  const sourceTableId = `${prefix}:source-table`;
  const targetEventId = `${prefix}:target-event`;
  const earnedAt = NOW;
  const expiresAt = NOW + 10 * 24 * 60 * 60 * 1000;

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO guild_config (guild_id, timezone) VALUES (?, 'America/Denver')",
    ).bind(guildId),
    env.DB.prepare(
      `INSERT INTO weekly_events (
         event_id, guild_id, title, starts_at, ends_at, signup_opens_at,
         signup_locks_at, status, archived_at
       ) VALUES (?, ?, 'Completed source game', ?, ?, ?, ?, 'archived', ?)`,
    ).bind(
      sourceEventId,
      guildId,
      earnedAt - 1_000_000,
      earnedAt - 900_000,
      earnedAt - 1_300_000,
      earnedAt - 1_100_000,
      earnedAt - 900_000,
    ),
    env.DB.prepare(
      `INSERT INTO plans (
         plan_id, event_id, generation, status, algorithm_version,
         min_table_size, preferred_table_size, max_table_size,
         player_count, gm_signup_count, selected_gm_count, published_at
       ) VALUES (?, ?, 1, 'published', 'notification-test', 4, 6, 6, 5, 1, 1, ?)`,
    ).bind(sourcePlanId, sourceEventId, earnedAt - 1_100_000),
    env.DB.prepare(
      `INSERT INTO plan_tables (
         table_id, plan_id, table_number, title, capacity,
         gm_user_id, gm_display_name
       ) VALUES (?, ?, 1, 'The Sunless Citadel', 6, ?, 'Integration DM')`,
    ).bind(sourceTableId, sourcePlanId, userId),
    env.DB.prepare(
      `INSERT INTO weekly_events (
         event_id, guild_id, title, starts_at, ends_at, signup_opens_at,
         signup_locks_at, status
       ) VALUES (?, ?, 'Next Friday game', ?, ?, ?, ?, 'open')`,
    ).bind(
      targetEventId,
      guildId,
      NOW + 2_000_000,
      NOW + 2_100_000,
      NOW - 1_000_000,
      NOW + 1_000_000,
    ),
    env.DB.prepare(
      `INSERT INTO signups (
         event_id, user_id, display_name, signup_kind, status, signed_up_at
       ) VALUES (?, ?, 'Integration member', 'player', 'active', ?)`,
    ).bind(targetEventId, userId, NOW - 1_000),
  ]);

  return {
    prefix,
    guildId,
    userId,
    sourceEventId,
    sourcePlanId,
    sourceTableId,
    targetEventId,
    earnedAt,
    expiresAt,
  };
}

class RecordingDiscord implements PriorityNotificationDiscord {
  openError: unknown;
  sendError: unknown;
  readonly payloads: DiscordMessagePayload[] = [];

  async createDmChannel(): Promise<DiscordChannel> {
    if (this.openError) throw this.openError;
    return { id: "300", type: 1 };
  }

  async sendChannelMessage(
    channelId: string,
    payload: DiscordMessagePayload,
  ): Promise<DiscordMessage> {
    this.payloads.push(payload);
    if (this.sendError) throw this.sendError;
    return {
      id: crypto.randomUUID().replaceAll("-", ""),
      channel_id: channelId,
      content: payload.content ?? "",
    };
  }
}

describe("priority notification D1 outbox", () => {
  it("repairs grant/credit lifecycle once, schedules 72-hour reminders, and delivers due rows", async () => {
    const fixture = await createNotificationFixture();
    const priority = new PriorityRepository(env.DB, () => fixture.earnedAt);
    const granted = await priority.grantCompletedSessionReward({
      grantId: `${fixture.prefix}:grant`,
      creditIds: [
        `${fixture.prefix}:credit:one`,
        `${fixture.prefix}:credit:two`,
      ],
      guildId: fixture.guildId,
      completionRevisionId: `${fixture.prefix}:completion:one`,
      sourceEventId: fixture.sourceEventId,
      sourcePlanId: fixture.sourcePlanId,
      sourceTableId: fixture.sourceTableId,
      dmUserId: fixture.userId,
      policyVersion: "dm-priority-v1",
      earnedTimeZone: "America/Denver",
      earnedAt: fixture.earnedAt,
      expiresAt: fixture.expiresAt,
      grantedByUserId: `${fixture.prefix}:admin`,
      idempotencyKey: `${fixture.prefix}:grant-operation`,
    });
    expect(granted.credits).toHaveLength(2);

    const outbox = new PriorityNotificationRepository(env.DB);
    const discord = new RecordingDiscord();
    let clock = fixture.earnedAt;
    const notifications = new PriorityNotificationService(outbox, discord, {
      now: () => clock,
    });

    expect(await outbox.getConfig(fixture.guildId)).toMatchObject({
      configRevision: 1,
      templateRevision: "dm-priority-notifications-v1",
      preExpiryLeadMs: 72 * 60 * 60 * 1000,
    });
    await expect(notifications.repairLifecycleNotifications()).resolves.toMatchObject({
      examined: 1,
      enqueued: 1,
    });
    await expect(notifications.repairExpiryReminders()).resolves.toMatchObject({
      examined: 2,
      enqueued: 2,
    });
    await expect(notifications.repairLifecycleNotifications()).resolves.toMatchObject({
      examined: 0,
    });
    await expect(notifications.repairExpiryReminders()).resolves.toMatchObject({
      examined: 0,
    });

    const repaired = await env.DB.prepare(
      `SELECT notification_kind, status, scheduled_for, content
       FROM priority_notification_outbox
       WHERE guild_id = ? ORDER BY notification_kind, source_id`,
    ).bind(fixture.guildId).all<{
      notification_kind: string;
      status: string;
      scheduled_for: number;
      content: string;
    }>();
    expect(repaired.results).toHaveLength(3);
    expect(repaired.results.filter((row) => row.notification_kind === "grant_awarded")).toHaveLength(1);
    expect(repaired.results.filter((row) => row.notification_kind === "credit_expiring")).toHaveLength(2);
    expect(
      repaired.results
        .filter((row) => row.notification_kind === "credit_expiring")
        .every(
          (row) => row.scheduled_for === fixture.expiresAt - 72 * 60 * 60 * 1000,
        ),
    ).toBe(true);
    const awardContent = repaired.results.find(
      (row) => row.notification_kind === "grant_awarded",
    )?.content;
    expect(awardContent).toContain("Status: **awarded**");
    expect(awardContent).toContain("Current available balance: **2**");

    clock += 1;
    const reserved = await priority.reserveNextCredit({
      creditEventId: `${fixture.prefix}:reserve-event`,
      guildId: fixture.guildId,
      userId: fixture.userId,
      targetEventId: fixture.targetEventId,
      reservedAt: clock,
      actorUserId: fixture.userId,
      idempotencyKey: `${fixture.prefix}:reserve-operation`,
    });
    expect(reserved?.event.action).toBe("reserved");
    await expect(notifications.repairLifecycleNotifications()).resolves.toMatchObject({
      examined: 1,
      enqueued: 1,
    });
    const reservedContent = await env.DB.prepare(
      `SELECT content FROM priority_notification_outbox
       WHERE guild_id = ? AND notification_kind = 'credit_reserved'`,
    ).bind(fixture.guildId).first<{ content: string }>();
    expect(reservedContent?.content).toContain("Status: **reserved**");
    expect(reservedContent?.content).toContain("Token expiry:");
    expect(reservedContent?.content).toContain("Current available balance: **1**");
    expect(reservedContent?.content).toContain("/priority status");

    const delivered = await notifications.deliverDue(10);
    expect(delivered).toMatchObject({ claimed: 2, sent: 2 });
    expect(discord.payloads).toHaveLength(2);
    expect(
      discord.payloads.every(
        (payload) =>
          payload.enforce_nonce === true &&
          typeof payload.nonce === "string" &&
          JSON.stringify(payload.allowed_mentions) === JSON.stringify(safeAllowedMentions()),
      ),
    ).toBe(true);

    const counts = await env.DB.prepare(
      `SELECT
         sum(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent_count,
         sum(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
         count(DISTINCT idempotency_key) AS key_count,
         count(*) AS total_count
       FROM priority_notification_outbox WHERE guild_id = ?`,
    ).bind(fixture.guildId).first<{
      sent_count: number;
      pending_count: number;
      key_count: number;
      total_count: number;
    }>();
    expect(counts).toEqual({
      sent_count: 2,
      pending_count: 2,
      key_count: 4,
      total_count: 4,
    });

    const configured = await notifications.configurePreExpiryLead({
      guildId: fixture.guildId,
      reminderHours: 24,
      actorUserId: `${fixture.prefix}:admin`,
      idempotencyKey: `${fixture.prefix}:reschedule-expiry-reminders`,
    });
    expect(configured).toMatchObject({
      applied: true,
      replayed: false,
      config: { configRevision: 2, preExpiryLeadMs: 24 * 60 * 60 * 1000 },
      event: { fromRevision: 1, toRevision: 2 },
    });
    await expect(notifications.cancelInvalidExpiryReminders()).resolves.toBe(0);
    await expect(notifications.repairExpiryReminders()).resolves.toMatchObject({
      examined: 2,
      enqueued: 2,
    });

    const reminders = await env.DB.prepare(
      `SELECT config_revision, status, scheduled_for
       FROM priority_notification_outbox
       WHERE guild_id = ? AND notification_kind = 'credit_expiring'
       ORDER BY config_revision, source_id`,
    ).bind(fixture.guildId).all<{
      config_revision: number;
      status: string;
      scheduled_for: number;
    }>();
    expect(reminders.results).toHaveLength(4);
    expect(
      reminders.results.filter(
        (row) =>
          row.config_revision === 1 &&
          row.status === "cancelled" &&
          row.scheduled_for === fixture.expiresAt - 72 * 60 * 60 * 1000,
      ),
    ).toHaveLength(2);
    expect(
      reminders.results.filter(
        (row) =>
          row.config_revision === 2 &&
          row.status === "pending" &&
          row.scheduled_for === fixture.expiresAt - 24 * 60 * 60 * 1000,
      ),
    ).toHaveLength(2);
  });

  it("isolates guild configuration and safely replays A after B", async () => {
    const prefix = crypto.randomUUID();
    const guildId = `${prefix}:guild:a`;
    const otherGuildId = `${prefix}:guild:b`;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO guild_config (guild_id, timezone) VALUES (?, 'America/Denver')",
      ).bind(guildId),
      env.DB.prepare(
        "INSERT INTO guild_config (guild_id, timezone) VALUES (?, 'America/Denver')",
      ).bind(otherGuildId),
    ]);

    const repository = new PriorityNotificationRepository(env.DB);
    const notifications = new PriorityNotificationService(
      repository,
      new RecordingDiscord(),
      { now: () => NOW },
    );
    const initialConfig = await repository.getConfig(guildId);
    const firstRevision = initialConfig.configRevision + 1;
    const firstInput = {
      guildId,
      reminderHours: 0,
      actorUserId: `${prefix}:admin`,
      idempotencyKey: `${prefix}:configuration:a`,
    } as const;
    const secondInput = {
      ...firstInput,
      reminderHours: 24,
      idempotencyKey: `${prefix}:configuration:b`,
    } as const;

    await expect(notifications.configurePreExpiryLead(firstInput)).resolves.toMatchObject({
      applied: true,
      replayed: false,
      config: { configRevision: firstRevision, preExpiryLeadMs: 0 },
    });
    await expect(notifications.configurePreExpiryLead(secondInput)).resolves.toMatchObject({
      applied: true,
      replayed: false,
      config: { configRevision: firstRevision + 1, preExpiryLeadMs: 24 * 60 * 60 * 1000 },
    });
    await expect(notifications.configurePreExpiryLead(firstInput)).resolves.toMatchObject({
      applied: false,
      replayed: true,
      config: {
        configRevision: firstRevision + 1,
        preExpiryLeadMs: 24 * 60 * 60 * 1000,
      },
      event: { toRevision: firstRevision, toPreExpiryLeadMs: 0 },
    });
    await expect(
      notifications.configurePreExpiryLead({ ...firstInput, reminderHours: 48 }),
    ).rejects.toThrow("idempotency key");

    const audit = await env.DB.prepare(
      `SELECT count(*) AS event_count, max(to_revision) AS revision
       FROM priority_notification_config_events
       WHERE guild_id = ? AND idempotency_key = ?`,
    ).bind(guildId, firstInput.idempotencyKey).first<{
      event_count: number;
      revision: number;
    }>();
    expect(audit).toEqual({ event_count: 1, revision: firstRevision });
    expect(await repository.getConfig(guildId)).toMatchObject({
      configRevision: firstRevision + 1,
      preExpiryLeadMs: 24 * 60 * 60 * 1000,
    });
    expect(await repository.getConfig(otherGuildId)).toMatchObject({
      configRevision: 1,
      preExpiryLeadMs: 72 * 60 * 60 * 1000,
    });
  });

  it("claims concurrently once and persists blocked/uncertain terminal outcomes", async () => {
    const prefix = crypto.randomUUID();
    const guildId = `${prefix}:guild`;
    await env.DB.prepare(
      "INSERT INTO guild_config (guild_id, timezone) VALUES (?, 'America/Denver')",
    ).bind(guildId).run();
    const firstRepository = new PriorityNotificationRepository(env.DB);
    const secondRepository = new PriorityNotificationRepository(env.DB);
    const baseService = new PriorityNotificationService(
      firstRepository,
      new RecordingDiscord(),
      { now: () => NOW },
    );

    const queued = await baseService.enqueueSeatingDecision({
      guildId,
      recipientUserId: `${prefix}:member`,
      seatingEventId: `${prefix}:seating:concurrent`,
      action: "promoted",
      eventId: `${prefix}:event`,
      occurredAt: NOW,
    });
    await baseService.configurePreExpiryLead({
      guildId,
      reminderHours: 24,
      actorUserId: `${prefix}:admin`,
      idempotencyKey: `${prefix}:config:24-hours`,
    });
    const replayed = await baseService.enqueueSeatingDecision({
      guildId,
      recipientUserId: `${prefix}:member`,
      seatingEventId: `${prefix}:seating:concurrent`,
      action: "promoted",
      eventId: `${prefix}:event`,
      occurredAt: NOW,
    });
    expect(replayed).toMatchObject({
      created: false,
      notification: {
        notificationId: queued.notification.notificationId,
        configRevision: 1,
      },
    });
    const claims = await Promise.all([
      firstRepository.claimDue({ claimToken: `${prefix}:claim:a`, claimedAt: NOW, limit: 10 }),
      secondRepository.claimDue({ claimToken: `${prefix}:claim:b`, claimedAt: NOW, limit: 10 }),
    ]);
    expect(claims[0].length + claims[1].length).toBe(1);
    const winningClaim = claims.find((rows) => rows.length === 1)?.[0];
    expect(winningClaim?.notificationId).toBe(queued.notification.notificationId);
    await firstRepository.markTerminal({
      notificationId: winningClaim!.notificationId,
      claimToken: winningClaim!.claimToken!,
      completedAt: NOW + 1,
      status: "uncertain",
      errorKind: "test_claim_cleanup",
    });

    const blockedDiscord = new RecordingDiscord();
    blockedDiscord.openError = new DiscordApiError("POST", "/users/@me/channels", 403, {
      code: 50_007,
      message: "Cannot send messages to this user",
    });
    const blockedService = new PriorityNotificationService(
      firstRepository,
      blockedDiscord,
      { now: () => NOW + 2 },
    );
    const blocked = await blockedService.enqueueSeatingDecision({
      guildId,
      recipientUserId: `${prefix}:member`,
      seatingEventId: `${prefix}:seating:blocked`,
      action: "displaced",
      eventId: `${prefix}:event`,
      occurredAt: NOW + 2,
    });
    await expect(blockedService.deliverDue()).resolves.toMatchObject({ blocked: 1 });

    const uncertainDiscord = new RecordingDiscord();
    uncertainDiscord.sendError = new DiscordApiError(
      "POST",
      "/channels/300/messages",
      0,
      "network timeout",
    );
    const uncertainService = new PriorityNotificationService(
      firstRepository,
      uncertainDiscord,
      { now: () => NOW + 3 },
    );
    const uncertain = await uncertainService.enqueueSeatingDecision({
      guildId,
      recipientUserId: `${prefix}:member`,
      seatingEventId: `${prefix}:seating:uncertain`,
      action: "promoted",
      eventId: `${prefix}:event`,
      occurredAt: NOW + 3,
    });
    await expect(uncertainService.deliverDue()).resolves.toMatchObject({ uncertain: 1 });

    expect(await firstRepository.getNotification(guildId, blocked.notification.notificationId)).toMatchObject({
      status: "blocked",
      lastErrorKind: "discord_dm_blocked",
      lastErrorCode: 50_007,
      nextAttemptAt: null,
    });
    expect(await firstRepository.getNotification(guildId, uncertain.notification.notificationId)).toMatchObject({
      status: "uncertain",
      lastErrorKind: "discord_send_outcome_uncertain",
      nextAttemptAt: null,
    });
  });
});
