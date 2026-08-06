import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { CharacterService } from "../../src/character-service";
import { PriorityService } from "../../src/priority-service";
import { ProgressionService } from "../../src/progression-service";
import { SessionService } from "../../src/session-service";
import { CharacterRepository } from "../../src/storage/character-repository";
import { PriorityRepository } from "../../src/storage/priority-repository";
import { ProgressionRepository } from "../../src/storage/progression-repository";
import { SessionRepository } from "../../src/storage/session-repository";

const NOW = Date.parse("2026-08-25T18:00:00Z");

describe("D1 progression ledger", () => {
  it("awards, retries, and reverses player and substitute-DM progression", async () => {
    const prefix = crypto.randomUUID();
    const guildId = `${prefix}:guild`;
    const eventId = `${prefix}:event`;
    const planId = `${prefix}:plan`;
    const tableId = `${prefix}:table`;
    const plannedDmId = `${prefix}:planned-dm`;
    const substituteDmId = `${prefix}:substitute-dm`;
    const playerId = `${prefix}:player`;
    const adminId = `${prefix}:admin`;
    const startsAt = NOW - 4 * 60 * 60 * 1_000;
    const endsAt = NOW - 1_000;

    await env.DB.batch([
      env.DB.prepare("INSERT INTO guild_config (guild_id) VALUES (?)").bind(guildId),
      env.DB.prepare(
        `INSERT INTO weekly_events (
           event_id, guild_id, title, starts_at, ends_at, signup_opens_at,
           signup_locks_at, status, table_selection_closes_at,
           final_manifest_channel_id, final_manifest_message_id,
           table_state_version, finalized_plan_id,
           finalized_table_state_version, tables_finalized_at, archived_at
         ) VALUES (
           ?, ?, 'Progression acceptance', ?, ?, ?, ?, 'archived', ?,
           'manifest-channel', 'manifest-message', 1, ?, 1, ?, ?
         )`,
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
         ) VALUES (?, ?, 1, 'published', 'progression-v1', 1, 1, 6, 1, 1, 1, ?)`,
      ).bind(planId, eventId, startsAt - 3_000),
      env.DB.prepare(
        `INSERT INTO plan_tables (
           table_id, plan_id, table_number, title, capacity,
           gm_user_id, gm_display_name
         ) VALUES (?, ?, 1, 'Progression Table', 6, ?, 'Planned DM')`,
      ).bind(tableId, planId, plannedDmId),
      env.DB.prepare(
        `INSERT INTO assignments (
           assignment_id, plan_id, table_id, desired_table_id, user_id,
           display_name, status, assigned_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'Player', 'assigned', ?, ?)`,
      ).bind(`${prefix}:assignment`, planId, tableId, tableId, playerId, startsAt, startsAt),
    ]);

    let sequence = 0;
    const ids = () => `${prefix}:id:${++sequence}`;
    const characterRepository = new CharacterRepository(env.DB);
    const characters = new CharacterService(characterRepository, { now: () => NOW, id: ids });
    const progressionRepository = new ProgressionRepository(env.DB);
    const progression = new ProgressionService(progressionRepository, characterRepository, {
      now: () => NOW,
      id: ids,
    });

    async function approvedCharacter(
      ownerUserId: string,
      name: string,
      openingXp: number,
    ) {
      const pending = await characters.register({
        guildId,
        ownerUserId,
        name,
        operationKey: `${prefix}:create:${name}`,
      });
      return characters.approve({
        guildId,
        characterId: pending.characterId,
        actorUserId: adminId,
        openingXp,
        openingGold: 0,
        reason: "Progression acceptance fixture",
        operationKey: `${prefix}:approve:${name}`,
      });
    }

    const playerMain = await approvedCharacter(playerId, "Player Main", 2);
    const playerSecondary = await approvedCharacter(playerId, "Frozen Secondary", 10);
    await characters.setFrozen({
      guildId,
      ownerUserId: playerId,
      characterId: playerSecondary.characterId,
      frozen: true,
      actorUserId: playerId,
      operationKey: `${prefix}:freeze-secondary`,
    });
    const substituteDmCharacter = await approvedCharacter(
      substituteDmId,
      "Substitute DM Character",
      7,
    );
    await progression.selectSessionCharacter({
      guildId,
      sourceEventId: eventId,
      sourceTableId: tableId,
      ownerUserId: playerId,
      characterId: playerSecondary.characterId,
      actorUserId: playerId,
      operationKey: `${prefix}:target-player-secondary`,
    });

    const sessionRepository = new SessionRepository(env.DB);
    const priorityRepository = new PriorityRepository(env.DB, () => NOW);
    const priority = new PriorityService(priorityRepository, { now: () => NOW, id: ids });
    const sessions = new SessionService(sessionRepository, priorityRepository, priority, {
      now: () => NOW,
      id: ids,
      progression,
    });
    await sessions.recordAttendance({
      guildId,
      eventId,
      tableNumber: 1,
      userId: plannedDmId,
      role: "dm",
      outcome: "no_show",
      recordedByUserId: adminId,
      reason: "Planned DM cancelled",
      idempotencyKey: `${prefix}:planned-dm-no-show`,
    });
    await sessions.recordAttendance({
      guildId,
      eventId,
      tableNumber: 1,
      userId: substituteDmId,
      role: "dm",
      outcome: "substitute",
      replacesUserId: plannedDmId,
      recordedByUserId: adminId,
      reason: "Substitute DM ran the table",
      idempotencyKey: `${prefix}:substitute-dm`,
    });
    const confirmed = await sessions.confirmSession({
      guildId,
      eventId,
      tableNumber: 1,
      result: "completed",
      confirmedByUserId: adminId,
      idempotencyKey: `${prefix}:confirm-completed`,
    });
    expect(confirmed.reward.status).toBe("synced");

    await expect(progression.getBalance(guildId, playerMain.characterId)).resolves.toMatchObject({
      xp: 3,
      gold: 50,
    });
    await expect(
      progression.getBalance(guildId, playerSecondary.characterId),
    ).resolves.toMatchObject({ xp: 10, gold: 0 });
    await expect(
      progression.getBalance(guildId, substituteDmCharacter.characterId),
    ).resolves.toMatchObject({ xp: 9, gold: 200 });

    const replay = await sessions.confirmSession({
      guildId,
      eventId,
      tableNumber: 1,
      result: "completed",
      confirmedByUserId: adminId,
      idempotencyKey: `${prefix}:confirm-replay`,
    });
    expect(replay.replayed).toBe(true);
    const awardCount = await env.DB.prepare(
      `SELECT count(*) AS count FROM progression_ledger_entries
       WHERE guild_id = ? AND entry_kind = 'session_award'`,
    ).bind(guildId).first<number>("count");
    expect(awardCount).toBe(2);

    const cancelled = await sessions.confirmSession({
      guildId,
      eventId,
      tableNumber: 1,
      result: "cancelled",
      confirmedByUserId: adminId,
      reason: "Admin corrected the table to cancelled",
      idempotencyKey: `${prefix}:correct-cancelled`,
    });
    expect(cancelled.reward.status).toBe("synced");
    await expect(progression.getBalance(guildId, playerMain.characterId)).resolves.toMatchObject({
      xp: 2,
      gold: 0,
    });
    await expect(
      progression.getBalance(guildId, substituteDmCharacter.characterId),
    ).resolves.toMatchObject({ xp: 7, gold: 0 });
    const reversalCount = await env.DB.prepare(
      `SELECT count(*) AS count FROM progression_ledger_entries
       WHERE guild_id = ? AND entry_kind = 'reversal'`,
    ).bind(guildId).first<number>("count");
    expect(reversalCount).toBe(2);
  });
});
