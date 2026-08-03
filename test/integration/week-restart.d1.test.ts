import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { GuildRepository } from "../../src/storage/repository";

describe("cancelled week restart", () => {
  it("clears unfinished weekly state and reopens the same occurrence", async () => {
    const suffix = crypto.randomUUID();
    const guildId = "restart-guild-" + suffix;
    const eventId = "restart-event-" + suffix;
    const planId = "restart-plan-" + suffix;
    const now = 1_000;
    const startsAt = 50_000;
    const repository = new GuildRepository(env.DB, () => now);

    await repository.saveGuildConfig({
      guildId,
      eventChannelId: "player-channel",
      tableChannelId: "table-channel",
      reminderChannelId: "reminder-channel",
    });
    await repository.createWeeklyEvent({
      eventId,
      guildId,
      title: "Restart test",
      startsAt,
      endsAt: 60_000,
      signupOpensAt: 10_000,
      playerSignupOpensAt: 20_000,
      signupLocksAt: 30_000,
      openSeatingAt: 40_000,
      tableSelectionClosesAt: startsAt,
      status: "cancelled",
    });
    await repository.setEventMessages(eventId, {
      signupChannelId: "old-player-channel",
      signupMessageId: "old-player-message",
      gmSignupChannelId: "old-gm-channel",
      gmSignupMessageId: "old-gm-message",
      tableChannelId: "old-table-channel",
      tableMessageId: "old-table-message",
    });
    await repository.saveSignup({
      eventId,
      userId: "player-1",
      displayName: "Player One",
      signupKind: "player",
      gameTier: 1,
    });
    await repository.saveDraftPlan({
      plan: {
        planId,
        eventId,
        generation: 1,
        algorithmVersion: "restart-test",
        minTableSize: 4,
        preferredTableSize: 6,
        maxTableSize: 6,
        playerCount: 1,
        gmSignupCount: 1,
        selectedGmCount: 1,
        waitlistCount: 0,
        createdByUserId: "admin-1",
      },
      tables: [{
        tableId: "restart-table-" + suffix,
        tableNumber: 1,
        gameTier: 1,
        title: "Old table",
        capacity: 6,
        gmUserId: "gm-1",
        gmDisplayName: "GM One",
      }],
      assignments: [{
        assignmentId: "restart-assignment-" + suffix,
        tableId: null,
        userId: "player-1",
        displayName: "Player One",
        gameTier: 1,
        status: "unassigned",
        waitlistPosition: null,
        rosterStatus: "reserved",
        rosterRank: 1,
      }],
    });
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO reminder_deliveries (
           delivery_id, event_id, channel_id, recipient_kind, content,
           scheduled_for, status, idempotency_key, created_at, updated_at
         ) VALUES (?, ?, ?, 'channel', 'old reminder', ?, 'pending', ?, ?, ?)`,
      ).bind("restart-delivery-" + suffix, eventId, "reminder-channel", 20_000,
        "restart-reminder-" + suffix, now, now),
      env.DB.prepare(
        `INSERT INTO operations (
           operation_key, guild_id, event_id, operation_kind, status,
           started_at, updated_at
         ) VALUES (?, ?, ?, 'scheduler-open', 'succeeded', ?, ?)`,
      ).bind("restart-operation-" + suffix, guildId, eventId, now, now),
    ]);

    const restarted = await repository.restartCancelledWeeklyEvent({
      eventId,
      guildId,
      title: "Restart test",
      startsAt,
      endsAt: 60_000,
      signupOpensAt: 11_000,
      playerSignupOpensAt: 21_000,
      signupLocksAt: 31_000,
      openSeatingAt: 41_000,
      tableSelectionClosesAt: startsAt,
      status: "open",
      createdByUserId: "admin-2",
    });

    expect(restarted).toMatchObject({
      eventId,
      status: "open",
      signupChannelId: null,
      signupMessageId: null,
      gmSignupChannelId: null,
      gmSignupMessageId: null,
      tableChannelId: null,
      tableMessageId: null,
      tableStateVersion: 0,
      publishedAt: null,
      archivedAt: null,
    });
    const counts = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM signups WHERE event_id = ?) AS signups,
         (SELECT COUNT(*) FROM plans WHERE event_id = ?) AS plans,
         (SELECT COUNT(*) FROM reminder_deliveries WHERE event_id = ?) AS reminders,
         (SELECT COUNT(*) FROM operations WHERE event_id = ?) AS operations`,
    ).bind(eventId, eventId, eventId, eventId).first<{
      signups: number;
      plans: number;
      reminders: number;
      operations: number;
    }>();
    expect(counts).toEqual({
      signups: 0,
      plans: 0,
      reminders: 0,
      operations: 0,
    });
  });

  it("refuses to restart finalized weekly history", async () => {
    const suffix = crypto.randomUUID();
    const guildId = "restart-finalized-guild-" + suffix;
    const eventId = "restart-finalized-event-" + suffix;
    const repository = new GuildRepository(env.DB, () => 1_000);

    await repository.saveGuildConfig({
      guildId,
      eventChannelId: "player-channel",
      tableChannelId: "table-channel",
      reminderChannelId: "reminder-channel",
    });
    await repository.createWeeklyEvent({
      eventId,
      guildId,
      title: "Finalized restart test",
      startsAt: 50_000,
      signupOpensAt: 10_000,
      signupLocksAt: 30_000,
      status: "cancelled",
    });
    await env.DB.prepare(
      "UPDATE weekly_events SET tables_finalized_at = ? WHERE event_id = ?",
    ).bind(40_000, eventId).run();

    await expect(repository.restartCancelledWeeklyEvent({
      eventId,
      guildId,
      title: "Finalized restart test",
      startsAt: 50_000,
      signupOpensAt: 10_000,
      signupLocksAt: 30_000,
      status: "open",
    })).resolves.toBeNull();
    expect(await repository.getWeeklyEvent(eventId)).toMatchObject({
      status: "cancelled",
      tablesFinalizedAt: 40_000,
    });
  });
});

