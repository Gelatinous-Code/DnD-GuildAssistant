import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  DiscordApiError,
  type DiscordChannel,
  type DiscordMessage,
  type DiscordMessagePayload,
} from "../../src/discord-api";
import { TableThreadService } from "../../src/table-thread-service";
import { TableThreadRepository } from "../../src/storage/table-thread-repository";

const NOW = Date.parse("2026-08-10T18:00:00Z");

describe("D1 pre-session table threads", () => {
  it("creates once, notifies each current GM, and supports audited repair controls", async () => {
    const prefix = crypto.randomUUID();
    const guildId = "1533181439376494642";
    const parentId = "1533181439376494643";
    const sourceId = "1533181439376494644";
    const replacementSourceId = "1533181439376494650";
    const gm1 = "1533181439376494645";
    const gm2 = "1533181439376494646";
    const eventId = `${prefix}:event`;
    const planId = `${prefix}:plan`;
    const tableId = `${prefix}:table`;
    const startsAt = NOW + 30 * 60 * 60_000;
    const selectionClosesAt = NOW + 20 * 60 * 60_000;

    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO guild_config (guild_id, timezone, table_channel_id, scheduling_enabled) VALUES (?, 'America/Denver', ?, 1)",
      ).bind(guildId, parentId),
      env.DB.prepare(
        `INSERT INTO weekly_events (
           event_id, guild_id, title, starts_at, ends_at, signup_opens_at,
           signup_locks_at, status, table_selection_closes_at, table_channel_id
         ) VALUES (?, ?, 'Thread acceptance', ?, ?, ?, ?, 'published', ?, ?)`,
      ).bind(
        eventId,
        guildId,
        startsAt,
        startsAt + 4 * 60 * 60_000,
        NOW - 2 * 60 * 60_000,
        NOW - 60 * 60_000,
        selectionClosesAt,
        parentId,
      ),
      env.DB.prepare(
        `INSERT INTO plans (
           plan_id, event_id, generation, status, algorithm_version,
           min_table_size, preferred_table_size, max_table_size,
           player_count, gm_signup_count, selected_gm_count, published_at
         ) VALUES (?, ?, 1, 'published', 'thread-v1', 1, 4, 6, 1, 1, 1, ?)`,
      ).bind(planId, eventId, NOW - 1_000),
      env.DB.prepare(
        `INSERT INTO plan_tables (
           table_id, plan_id, table_number, title, capacity, gm_user_id,
           gm_display_name, channel_id, message_id, game_tier
         ) VALUES (?, ?, 1, 'Murder Mystery in Bloom', 6, ?, 'FrankB', ?, ?, 2)`,
      ).bind(tableId, planId, gm1, parentId, sourceId),
    ]);

    const existingThreads = new Map<string, DiscordChannel>();
    let failNextStart = true;
    const started: Array<{ channelId: string; messageId: string; name: string }> = [];
    const directMessages: Array<{
      userId: string;
      payload: DiscordMessagePayload;
      key: string;
    }> = [];
    const archived: string[] = [];
    const anchors: DiscordMessage[] = [];
    const discord = {
      async getChannel(id: string): Promise<DiscordChannel> {
        if (id === parentId) return { id, type: 0, guild_id: guildId };
        const thread = existingThreads.get(id);
        if (thread) return thread;
        throw new DiscordApiError("GET", `/channels/${id}`, 404, { message: "Unknown Channel" });
      },
      async startThreadFromMessage(
        channelId: string,
        messageId: string,
        input: { name: string },
      ): Promise<DiscordChannel> {
        if (failNextStart) {
          failNextStart = false;
          throw new Error("Simulated Discord outage");
        }
        started.push({ channelId, messageId, name: input.name });
        const thread = { id: messageId, type: 11, guild_id: guildId, parent_id: channelId, name: input.name };
        existingThreads.set(messageId, thread);
        return thread;
      },
      async startForumThread(): Promise<DiscordChannel> {
        throw new Error("Forum creation was not expected");
      },
      async listActiveGuildThreads(): Promise<{ threads: DiscordChannel[] }> {
        return { threads: [...existingThreads.values()] };
      },
      async editChannel(id: string): Promise<DiscordChannel> {
        archived.push(id);
        return existingThreads.get(id) ?? { id, type: 11 };
      },
      async sendChannelMessage(channelId: string, payload: DiscordMessagePayload): Promise<DiscordMessage> {
        const message = {
          id: replacementSourceId,
          channel_id: channelId,
          content: payload.content ?? "",
        };
        anchors.push(message);
        return message;
      },
      async sendDirectMessage(
        userId: string,
        payload: DiscordMessagePayload,
        key: string,
      ): Promise<DiscordMessage> {
        directMessages.push({ userId, payload, key });
        return {
          id: String(1533181439376494700n + BigInt(directMessages.length)),
          channel_id: "1533181439376494699",
          content: payload.content ?? "",
          components: payload.components,
        };
      },
    };
    let sequence = 0;
    const service = new TableThreadService(
      new TableThreadRepository(env.DB),
      discord,
      { now: () => NOW, id: () => `${prefix}:id:${++sequence}` },
    );

    await service.runScheduled();
    expect(started).toHaveLength(0);
    expect(directMessages).toHaveLength(0);
    expect((await service.status({ guildId, eventId, tableNumber: 1 })).workflow?.status).toBe("failed");
    const retried = await service.manage({
      guildId,
      eventId,
      tableNumber: 1,
      action: "retry",
      actorUserId: "1533181439376494647",
      reason: "Retry after Discord recovered",
    });
    expect(retried.status).toBe("current");
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ channelId: parentId, messageId: sourceId });
    expect(started[0]!.name).toContain("T2 Table 1");
    expect(directMessages).toHaveLength(1);
    expect(directMessages[0]!.userId).toBe(gm1);
    expect(directMessages[0]!.payload.content).toContain(
      "Add or tag the current players only after you are happy",
    );
    expect(directMessages[0]!.payload.allowed_mentions).toMatchObject({ parse: [] });
    expect(directMessages[0]!.payload.components?.[0]?.components[0]).toMatchObject({
      style: 5,
      url: `https://discord.com/channels/${guildId}/${sourceId}`,
    });

    await service.runScheduled();
    expect(started).toHaveLength(1);
    expect(directMessages).toHaveLength(1);

    await env.DB.prepare(
      "UPDATE plan_tables SET gm_user_id = ?, gm_display_name = 'New DM' WHERE table_id = ?",
    ).bind(gm2, tableId).run();
    await service.runScheduled();
    expect(started).toHaveLength(1);
    expect(directMessages.map((message) => message.userId)).toEqual([gm1, gm2]);
    const workflow = await env.DB.prepare(
      "SELECT workflow_id, gm_revision FROM table_thread_workflows WHERE guild_id = ? AND event_id = ?",
    ).bind(guildId, eventId).first<{ workflow_id: string; gm_revision: number }>();
    expect(workflow?.gm_revision).toBe(2);

    const recreated = await service.manage({
      guildId,
      eventId,
      tableNumber: 1,
      action: "recreate",
      actorUserId: "1533181439376494647",
      reason: "Move to a fresh introduction thread",
    });
    expect(recreated.status).toBe("current");
    expect(recreated.threadGeneration).toBe(2);
    expect(recreated.threadId).toBe(replacementSourceId);
    expect(anchors).toHaveLength(1);
    expect(archived).toContain(sourceId);
    expect(started.at(-1)).toMatchObject({ messageId: replacementSourceId });
    expect(directMessages.at(-1)?.payload.components?.[0]?.components[0]).toMatchObject({
      url: `https://discord.com/channels/${guildId}/${replacementSourceId}`,
    });

    const cancelled = await service.manage({
      guildId,
      eventId,
      tableNumber: 1,
      action: "cancel",
      actorUserId: "1533181439376494647",
      reason: "Administrator closed this table",
    });
    expect(cancelled.status).toBe("cancelled");
    await service.runScheduled();
    expect(started).toHaveLength(2);
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM table_thread_events WHERE workflow_id = ?",
    ).bind(workflow!.workflow_id).first<number>("count")).toBe(3);
  });
});
