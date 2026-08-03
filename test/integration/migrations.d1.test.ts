import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { GuildRepository } from "../../src/storage/repository";

describe("D1 migrations", () => {
  it("applies the DM priority ledger schema with foreign keys intact", async () => {
    const tables = await env.DB.prepare(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table' AND name LIKE 'dm_priority_%'
       ORDER BY name ASC`,
    ).all<{ name: string }>();

    expect(tables.results.map((row) => row.name)).toEqual([
      "dm_priority_credit_events",
      "dm_priority_credits",
      "dm_priority_grants",
    ]);

    const foreignKeyViolations = await env.DB.prepare("PRAGMA foreign_key_check").all();
    expect(foreignKeyViolations.results).toEqual([]);
  });
  it("adds audience-specific signup routing columns", async () => {
    const guildColumns = await env.DB.prepare("PRAGMA table_info(guild_config)")
      .all<{ name: string }>();
    const eventColumns = await env.DB.prepare("PRAGMA table_info(weekly_events)")
      .all<{ name: string }>();

    expect(guildColumns.results.map((column) => column.name)).toEqual(
      expect.arrayContaining(["gm_signup_channel_id", "gm_notification_role_id"]),
    );
    expect(eventColumns.results.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "gm_signup_channel_id",
        "gm_signup_message_id",
      ]),
    );
  });

  it("round-trips split signup routing through the repository", async () => {
    const repository = new GuildRepository(env.DB, () => 1_000);
    const config = await repository.saveGuildConfig({
      guildId: "routing-guild",
      eventChannelId: "player-channel",
      gmSignupChannelId: "gm-channel",
      gmNotificationRoleId: "gm-notification-role",
      tableChannelId: "player-channel",
      reminderChannelId: "player-channel",
    });

    expect(config.gmSignupChannelId).toBe("gm-channel");
    expect(config.gmNotificationRoleId).toBe("gm-notification-role");

    await repository.createWeeklyEvent({
      eventId: "routing-event",
      guildId: config.guildId,
      title: "Routing test",
      startsAt: 10_000,
      signupOpensAt: 2_000,
      playerSignupOpensAt: 3_000,
      signupLocksAt: 4_000,
    });
    await repository.setEventMessages("routing-event", {
      gmSignupChannelId: "gm-channel",
      gmSignupMessageId: "gm-message",
      signupChannelId: "player-channel",
      signupMessageId: "player-message",
    });

    expect(await repository.getWeeklyEvent("routing-event")).toMatchObject({
      gmSignupChannelId: "gm-channel",
      gmSignupMessageId: "gm-message",
      signupChannelId: "player-channel",
      signupMessageId: "player-message",
    });
  });
});
