import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { CharacterService } from "../../src/character-service";
import { ProgressionSeasonService } from "../../src/progression-season-service";
import { ProgressionService } from "../../src/progression-service";
import { CharacterRepository } from "../../src/storage/character-repository";
import { ProgressionRepository } from "../../src/storage/progression-repository";
import { handleWebsiteLibraryReadRequest } from "../../src/website-library-read-model";

const NOW = Date.parse("2026-09-01T18:00:00Z");

describe("D1 progression seasons", () => {
  it("previews and performs an exactly-once rollover while preserving history", async () => {
    const prefix = crypto.randomUUID();
    const guildId = prefix.replace(/\D/g, "").padEnd(18, "0").slice(0, 18);
    const ownerId = `${prefix}:player`;
    const adminId = `${prefix}:admin`;
    await env.DB.prepare(
      "INSERT INTO guild_config (guild_id, reminder_role_id) VALUES (?, 'role-player')",
    ).bind(guildId).run();

    let sequence = 0;
    const ids = () => `${prefix}:id:${++sequence}`;
    const characterRepository = new CharacterRepository(env.DB);
    const characters = new CharacterService(characterRepository, { now: () => NOW, id: ids });
    const progression = new ProgressionService(
      new ProgressionRepository(env.DB),
      characterRepository,
      { now: () => NOW, id: ids },
    );
    const seasons = new ProgressionSeasonService(env.DB, () => NOW, ids);

    const pending = await characters.register({
      guildId,
      ownerUserId: ownerId,
      name: "Season Hero",
      operationKey: `${prefix}:create`,
    });
    const character = await characters.approve({
      guildId,
      characterId: pending.characterId,
      actorUserId: adminId,
      openingXp: 12,
      openingGold: 500,
      reason: "Approved season fixture",
      operationKey: `${prefix}:approve`,
    });
    await progression.adjust({
      guildId,
      characterId: character.characterId,
      xpDelta: 3,
      goldDelta: 100,
      actorUserId: adminId,
      reason: "Pre-rollover adjustment",
      operationKey: `${prefix}:adjust:before`,
    });
    await progression.adjust({
      guildId,
      characterId: character.characterId,
      xpDelta: 0,
      goldDelta: -200,
      actorUserId: adminId,
      reason: "Pre-rollover purchase",
      operationKey: `${prefix}:purchase:before`,
    });
    const archivedCharacterId = `${prefix}:archived`;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO characters (
           character_id, guild_id, owner_user_id, name, status, opening_xp,
           opening_gold, created_at, created_by_user_id, updated_at,
           archived_at, archived_by_user_id
         ) VALUES (?, ?, ?, 'Archived Hero', 'archived', 20, 900, ?, ?, ?, ?, ?)` ,
      ).bind(archivedCharacterId, guildId, ownerId, NOW, adminId, NOW, NOW, adminId),
      env.DB.prepare(
        `INSERT INTO character_season_openings (
           opening_id, guild_id, season_id, character_id, opening_xp, opening_gold,
           policy_version, source_kind, actor_user_id, reason, idempotency_key, created_at
         ) VALUES (?, ?, 'legacy', ?, 20, 900, 'progression-season-v1', 'migration',
           ?, 'Preserve archived character history', ?, ?)` ,
      ).bind(
        `${prefix}:archived-opening`, guildId, archivedCharacterId, adminId,
        `${prefix}:archived-opening-key`, NOW,
      ),
    ]);

    await expect(seasons.previewRollover({
      guildId,
      nextSeasonId: "season-6",
      nextSeasonName: "Season 6",
    })).resolves.toMatchObject({
      continuingCharacterCount: 1,
      nonzeroBalanceCount: 1,
      totalXp: 15,
      totalGold: 400,
      currentSeason: { seasonId: "legacy" },
    });

    const rolled = await seasons.rollover({
      guildId,
      nextSeasonId: "season-6",
      nextSeasonName: "Season 6",
      actorUserId: adminId,
      reason: "Begin the next guild season",
      operationKey: `${prefix}:rollover:season-6`,
    });
    expect(rolled.replayed).toBe(false);
    expect(rolled.season).toMatchObject({ seasonId: "season-6", status: "current" });
    expect(await env.DB.prepare(
      `SELECT count(*) AS count FROM character_season_openings
       WHERE guild_id = ? AND season_id = 'season-6' AND character_id = ?`,
    ).bind(guildId, archivedCharacterId).first<number>("count")).toBe(0);
    await expect(progression.getBalance(guildId, character.characterId)).resolves.toMatchObject({
      xp: 0,
      gold: 0,
    });
    await expect(seasons.listBalances(guildId, "legacy")).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ characterId: character.characterId, xp: 15, gold: 400 }),
    ]));

    const progressionFeed = await handleWebsiteLibraryReadRequest(new Request(
      `https://guild.example/api/v1/guilds/${guildId}/progression-seasons?season=all`,
      { headers: {
        Authorization: "Bearer test-token",
        "X-Guild-Contract-Version": "progression-seasons.v1",
      } },
    ), env, {
      now: () => NOW,
      fetch: async () => Response.json({
        user: { id: ownerId }, roles: ["role-player"], pending: false,
      }),
    });
    expect(progressionFeed?.status).toBe(200);
    const progressionBody = await progressionFeed!.json() as {
      balances: Array<{ seasonId: string; xp: number; gold: number; level: number }>;
    };
    expect(progressionBody.balances).toEqual(expect.arrayContaining([
      expect.objectContaining({ seasonId: "legacy", xp: 15, gold: 400, level: 6 }),
      expect.objectContaining({ seasonId: "season-6", xp: 0, gold: 0, level: 3 }),
    ]));
    expect(JSON.stringify(progressionBody)).not.toContain(ownerId);

    const replay = await seasons.rollover({
      guildId,
      nextSeasonId: "season-6",
      nextSeasonName: "Season 6",
      actorUserId: adminId,
      reason: "Begin the next guild season",
      operationKey: `${prefix}:rollover:season-6`,
    });
    expect(replay.replayed).toBe(true);
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM progression_season_events WHERE guild_id = ?",
    ).bind(guildId).first<number>("count")).toBe(1);
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM character_season_openings WHERE guild_id = ? AND season_id = 'season-6'",
    ).bind(guildId).first<number>("count")).toBe(1);

    await progression.adjust({
      guildId,
      characterId: character.characterId,
      xpDelta: 1,
      goldDelta: 50,
      actorUserId: adminId,
      reason: "New-season adjustment",
      operationKey: `${prefix}:adjust:after`,
    });
    await expect(progression.getBalance(guildId, character.characterId)).resolves.toMatchObject({
      xp: 1,
      gold: 50,
    });
    expect(await env.DB.prepare(
      `SELECT season_id FROM progression_ledger_entries
       WHERE guild_id = ? AND idempotency_key = ?`,
    ).bind(guildId, `${prefix}:adjust:after`).first<string>("season_id")).toBe("season-6");

    await progression.adjust({
      guildId,
      characterId: character.characterId,
      seasonId: "legacy",
      xpDelta: 0,
      goldDelta: 25,
      actorUserId: adminId,
      reason: "Late correction to a prior-season purchase",
      operationKey: `${prefix}:late-correction`,
    });
    await expect(progression.getBalanceForSeason(
      guildId, character.characterId, "legacy",
    )).resolves.toMatchObject({ xp: 15, gold: 425 });
    await expect(progression.getBalance(guildId, character.characterId))
      .resolves.toMatchObject({ xp: 1, gold: 50 });
  });

  it("puts characters approved after rollover into the current season only", async () => {
    const prefix = crypto.randomUUID();
    const guildId = `${prefix}:guild`;
    const ownerId = `${prefix}:player`;
    const adminId = `${prefix}:admin`;
    await env.DB.prepare("INSERT INTO guild_config (guild_id) VALUES (?)").bind(guildId).run();

    let sequence = 0;
    const ids = () => `${prefix}:id:${++sequence}`;
    const characterRepository = new CharacterRepository(env.DB);
    const characters = new CharacterService(characterRepository, { now: () => NOW, id: ids });
    const seasons = new ProgressionSeasonService(env.DB, () => NOW, ids);
    await seasons.rollover({
      guildId,
      nextSeasonId: "season-new",
      nextSeasonName: "New Season",
      actorUserId: adminId,
      reason: "Open a clean season",
      operationKey: `${prefix}:rollover`,
    });

    const pending = await characters.register({
      guildId,
      ownerUserId: ownerId,
      name: "New Arrival",
      operationKey: `${prefix}:create`,
    });
    const character = await characters.approve({
      guildId,
      characterId: pending.characterId,
      actorUserId: adminId,
      openingXp: 4,
      openingGold: 125,
      reason: "Approved after rollover",
      operationKey: `${prefix}:approve`,
    });
    await expect(seasons.listBalances(guildId, "season-new")).resolves.toEqual([
      expect.objectContaining({ characterId: character.characterId, xp: 4, gold: 125 }),
    ]);
    await expect(seasons.listBalances(guildId, "legacy")).resolves.toEqual([]);
  });
});
