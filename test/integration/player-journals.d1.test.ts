import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { CharacterService } from "../../src/character-service";
import { DiscordRestClient } from "../../src/discord-api";
import { handlePlayerJournalCommand } from "../../src/player-journal-app";
import {
  PlayerJournalAccessError,
  PlayerJournalService,
} from "../../src/player-journal-service";
import { CharacterRepository } from "../../src/storage/character-repository";
import { PlayerJournalRepository } from "../../src/storage/player-journal-repository";
import { handleWebsiteLibraryReadRequest } from "../../src/website-library-read-model";

const START = Date.parse("2026-08-20T18:00:00Z");

async function seedCompletedSession(prefix: string) {
  const guildId = prefix.replace(/\D/g, "").padEnd(18, "0").slice(0, 18);
  const eventId = `${prefix}:event`;
  const planId = `${prefix}:plan`;
  const tableId = `${prefix}:table`;
  const sessionId = `${prefix}:session`;
  const completionRevisionId = `${prefix}:completion`;
  const summaryId = `${prefix}:summary`;
  const playerId = `${prefix}:player`;
  const dmId = `${prefix}:dm`;
  const adminId = `${prefix}:admin`;
  const startsAt = START - 4 * 60 * 60_000;
  const endsAt = START - 60_000;

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO guild_config (guild_id, reminder_role_id) VALUES (?, 'role-player')",
    ).bind(guildId),
    env.DB.prepare(
      `INSERT INTO weekly_events (
         event_id, guild_id, title, starts_at, ends_at, signup_opens_at,
         signup_locks_at, status, table_selection_closes_at,
         final_manifest_channel_id, final_manifest_message_id,
         table_state_version, finalized_plan_id,
         finalized_table_state_version, tables_finalized_at, archived_at
       ) VALUES (?, ?, 'Journal Adventure', ?, ?, ?, ?, 'archived', ?,
         'manifest-channel', 'manifest-message', 1, ?, 1, ?, ?)`,
    ).bind(
      eventId,
      guildId,
      startsAt,
      endsAt,
      startsAt - 10_000,
      startsAt - 5_000,
      startsAt - 2_000,
      planId,
      endsAt - 2_000,
      endsAt,
    ),
    env.DB.prepare(
      `INSERT INTO plans (
         plan_id, event_id, generation, status, algorithm_version,
         min_table_size, preferred_table_size, max_table_size,
         player_count, gm_signup_count, selected_gm_count, published_at
       ) VALUES (?, ?, 1, 'published', 'journal-v1', 1, 1, 6, 1, 1, 1, ?)`,
    ).bind(planId, eventId, startsAt - 3_000),
    env.DB.prepare(
      `INSERT INTO plan_tables (
         table_id, plan_id, table_number, title, capacity, gm_user_id, gm_display_name
       ) VALUES (?, ?, 1, 'Journal Table', 6, ?, 'Journal DM')`,
    ).bind(tableId, planId, dmId),
    env.DB.prepare(
      `INSERT INTO session_completions (
         session_id, guild_id, source_event_id, source_plan_id, source_table_id,
         draft_open, draft_version, draft_operation_key, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?, ?)`,
    ).bind(sessionId, guildId, eventId, planId, tableId, `${prefix}:draft`, endsAt, endsAt),
    env.DB.prepare(
      `INSERT INTO session_completion_revisions (
         completion_revision_id, session_id, guild_id, revision_number, result,
         actual_dm_user_id, earned_timezone, confirmed_by_user_id, confirmed_at,
         is_current, created_at
       ) VALUES (?, ?, ?, 1, 'completed', ?, 'America/Denver', ?, ?, 1, ?)`,
    ).bind(completionRevisionId, sessionId, guildId, dmId, adminId, endsAt, endsAt),
    env.DB.prepare(
      `INSERT INTO session_completion_participants (
         completion_revision_id, session_id, guild_id, user_id, participant_role,
         attendance_outcome, was_planned, recorded_by_user_id, recorded_at
       ) VALUES (?, ?, ?, ?, 'player', 'attended', 1, ?, ?)`,
    ).bind(completionRevisionId, sessionId, guildId, playerId, adminId, endsAt),
    env.DB.prepare(
      `INSERT INTO session_completion_participants (
         completion_revision_id, session_id, guild_id, user_id, participant_role,
         attendance_outcome, was_planned, recorded_by_user_id, recorded_at
       ) VALUES (?, ?, ?, ?, 'dm', 'attended', 1, ?, ?)`,
    ).bind(completionRevisionId, sessionId, guildId, dmId, adminId, endsAt),
    env.DB.prepare(
      `INSERT INTO session_summaries (
         summary_id, guild_id, session_id, completion_revision_id, dm_user_id,
         session_ends_at, due_at, reward_policy_version, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'test-reward-v1', ?, ?)`,
    ).bind(
      summaryId,
      guildId,
      sessionId,
      completionRevisionId,
      dmId,
      endsAt,
      endsAt + 72 * 60 * 60_000,
      endsAt,
      endsAt,
    ),
  ]);

  let sequence = 0;
  const ids = () => `${prefix}:id:${++sequence}`;
  const characterRepository = new CharacterRepository(env.DB);
  const characters = new CharacterService(characterRepository, { now: () => START, id: ids });
  const pending = await characters.register({
    guildId,
    ownerUserId: playerId,
    name: "Journal Hero",
    operationKey: `${prefix}:character:create`,
  });
  const character = await characters.approve({
    guildId,
    characterId: pending.characterId,
    actorUserId: adminId,
    openingXp: 0,
    openingGold: 0,
    reason: "Journal integration fixture",
    operationKey: `${prefix}:character:approve`,
  });
  return {
    guildId,
    sessionId,
    playerId,
    adminId,
    characterId: character.characterId,
    ids,
  };
}

describe("D1 player journals", () => {
  it("submits, publishes, edits, retries, moderates, and enforces seven days", async () => {
    const prefix = crypto.randomUUID();
    const fixture = await seedCompletedSession(prefix);
    let now = START;
    let failDiscord = false;
    const requests: Array<{ method: string; url: string }> = [];
    const fetcher: typeof fetch = vi.fn(async (input, init) => {
      requests.push({ method: init?.method ?? "GET", url: String(input) });
      if (failDiscord) return new Response("outage", { status: 500 });
      return Response.json({
        id: "987654321",
        channel_id: "123456789",
        content: "",
      });
    });
    const repository = new PlayerJournalRepository(env.DB);
    const service = new PlayerJournalService(
      repository,
      new DiscordRestClient("test-token", {
        fetch: fetcher,
        apiBaseUrl: "https://discord.test/api/v10",
      }),
      () => now,
      fixture.ids,
    );

    const draft = await service.prepareDraft({
      guildId: fixture.guildId,
      authorUserId: fixture.playerId,
      characterId: fixture.characterId,
      sessionId: fixture.sessionId,
      operationKey: `${prefix}:journal:draft`,
    });
    const submitted = await service.submit({
      journalId: draft.journalId,
      authorUserId: fixture.playerId,
      title: "A Hero's Reflection",
      journalText: "The ruined observatory changed how my character sees the stars.",
      operationKey: `${prefix}:journal:submit:1`,
    });
    expect(submitted.deliveryStatus).toBe("not_configured");
    const replayedSubmission = await service.submit({
      journalId: draft.journalId,
      authorUserId: fixture.playerId,
      title: "A Hero's Reflection",
      journalText: "The ruined observatory changed how my character sees the stars.",
      operationKey: `${prefix}:journal:submit:1`,
    });
    expect(replayedSubmission.version).toBe(submitted.version);
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM player_journal_revisions WHERE journal_id = ?",
    ).bind(draft.journalId).first<number>("count")).toBe(1);
    expect(requests).toHaveLength(0);

    await service.configure({
      guildId: fixture.guildId,
      threadId: "123456789",
      actorUserId: fixture.adminId,
    });
    await service.deliverDue();
    let journal = await repository.get(fixture.guildId, draft.journalId);
    expect(journal).toMatchObject({
      status: "submitted",
      deliveryStatus: "sent",
      discordMessageId: "987654321",
    });
    expect(requests.filter((request) => request.method === "POST")).toHaveLength(1);

    const journalFeedResponse = await handleWebsiteLibraryReadRequest(new Request(
      `https://guild.example/api/v1/guilds/${fixture.guildId}/player-journals?limit=1`,
      { headers: {
        Authorization: "Bearer test-token",
        "X-Guild-Contract-Version": "player-journals.v1",
      } },
    ), env, {
      now: () => now,
      fetch: async () => Response.json({
        user: { id: fixture.playerId }, roles: ["role-player"], pending: false,
      }),
    });
    expect(journalFeedResponse?.status).toBe(200);
    const journalFeed = await journalFeedResponse!.json() as {
      items: Array<Record<string, unknown>>;
    };
    expect(journalFeed.items).toEqual([expect.objectContaining({
      journalId: draft.journalId,
      characterName: "Journal Hero",
      title: "A Hero's Reflection",
      journal: "The ruined observatory changed how my character sees the stars.",
    })]);
    expect(journalFeed.items[0]).not.toHaveProperty("authorUserId");

    now += 60_000;
    journal = await service.submit({
      journalId: draft.journalId,
      authorUserId: fixture.playerId,
      title: "A Hero's Reflection, Revised",
      journalText: "The observatory changed us, and the recovered chart points north.",
      operationKey: `${prefix}:journal:submit:2`,
    });
    expect(journal.deliveryStatus).toBe("sent");
    expect(requests.filter((request) => request.method === "POST")).toHaveLength(1);
    expect(requests.some((request) => request.method === "PATCH")).toBe(true);
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM player_journal_revisions WHERE journal_id = ?",
    ).bind(draft.journalId).first<number>("count")).toBe(2);

    failDiscord = true;
    now += 60_000;
    journal = await service.submit({
      journalId: draft.journalId,
      authorUserId: fixture.playerId,
      title: "A Hero's Reflection, Final",
      journalText: "The final chart marks a road our party still needs to follow.",
      operationKey: `${prefix}:journal:submit:3`,
    });
    expect(journal.deliveryStatus).toBe("failed");
    expect(journal.nextDeliveryAttemptAt).not.toBeNull();
    failDiscord = false;
    now += 60 * 60_000;
    await service.deliverDue();
    expect(await repository.get(fixture.guildId, draft.journalId)).toMatchObject({
      deliveryStatus: "sent",
      discordMessageId: "987654321",
    });

    await service.moderate({
      guildId: fixture.guildId,
      journalId: draft.journalId,
      action: "hide",
      actorUserId: fixture.adminId,
      reason: "Temporarily hidden for moderation",
      operationKey: `${prefix}:journal:hide`,
    });
    expect(await repository.get(fixture.guildId, draft.journalId)).toMatchObject({
      publicationStatus: "hidden",
      deliveryStatus: "hidden",
    });
    const hiddenMemberResponse = await handleWebsiteLibraryReadRequest(new Request(
      `https://guild.example/api/v1/guilds/${fixture.guildId}/player-journals`,
      { headers: {
        Authorization: "Bearer player-token",
        "X-Guild-Contract-Version": "player-journals.v1",
      } },
    ), env, {
      now: () => now,
      fetch: async () => Response.json({
        user: { id: fixture.playerId }, roles: ["role-player"], pending: false,
      }),
    });
    await expect(hiddenMemberResponse!.json()).resolves.toMatchObject({ items: [] });

    await env.DB.prepare(
      "UPDATE guild_config SET admin_role_id = 'role-admin' WHERE guild_id = ?",
    ).bind(fixture.guildId).run();
    const hiddenAdminResponse = await handleWebsiteLibraryReadRequest(new Request(
      `https://guild.example/api/v1/guilds/${fixture.guildId}/player-journals?visibility=all`,
      { headers: {
        Authorization: "Bearer admin-token",
        "X-Guild-Contract-Version": "player-journals.v1",
      } },
    ), env, {
      now: () => now,
      fetch: async () => Response.json({
        user: { id: fixture.adminId }, roles: ["role-admin"], pending: false,
      }),
    });
    const hiddenAdminFeed = await hiddenAdminResponse!.json() as {
      adminDiagnostics: { hiddenJournals: number };
      items: Array<{
        publicationStatus: string;
        moderation: { reason: string };
      }>;
    };
    expect(hiddenAdminFeed.adminDiagnostics.hiddenJournals).toBe(1);
    expect(hiddenAdminFeed.items[0]).toMatchObject({
      publicationStatus: "hidden",
      moderation: { reason: "Temporarily hidden for moderation" },
    });
    await service.moderate({
      guildId: fixture.guildId,
      journalId: draft.journalId,
      action: "unhide",
      actorUserId: fixture.adminId,
      reason: "Moderation concern resolved",
      operationKey: `${prefix}:journal:unhide`,
    });
    expect(await repository.get(fixture.guildId, draft.journalId)).toMatchObject({
      publicationStatus: "visible",
      deliveryStatus: "sent",
    });

    now = START + 8 * 24 * 60 * 60_000;
    await expect(service.getForAuthor(draft.journalId, fixture.playerId)).rejects.toBeInstanceOf(
      PlayerJournalAccessError,
    );
  });

  it("denies journal commands after the configured Guild Player role is lost", async () => {
    const prefix = crypto.randomUUID();
    const fixture = await seedCompletedSession(prefix);
    const response = await handlePlayerJournalCommand({
      id: `${prefix}:interaction`,
      type: 2,
      guild_id: fixture.guildId,
      member: {
        user: { id: fixture.playerId, username: "Player" },
        roles: [],
      },
      data: {
        name: "journal",
        options: [{
          name: "write",
          type: 1,
          options: [{ name: "character_id", type: 3, value: fixture.characterId }],
        }],
      },
    }, env);
    expect(response).not.toBeNull();
    const body = await response!.json() as { data: { content: string } };
    expect(body.data.content).toContain("Guild Player role");
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM player_journals WHERE guild_id = ?",
    ).bind(fixture.guildId).first<number>("count")).toBe(0);
  });
});
