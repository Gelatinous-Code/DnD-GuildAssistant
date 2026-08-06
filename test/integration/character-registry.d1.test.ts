import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { CharacterRuleError, CharacterService } from "../../src/character-service";
import { CharacterRepository } from "../../src/storage/character-repository";

describe("D1 character registry", () => {
  it("supports approval, main selection, freezing, and reward routing", async () => {
    const guildId = `character-guild-${crypto.randomUUID()}`;
    const userId = "member-1";
    await env.DB.prepare("INSERT INTO guild_config (guild_id) VALUES (?)")
      .bind(guildId)
      .run();

    let next = 0;
    const service = new CharacterService(new CharacterRepository(env.DB), {
      now: () => 1_000 + next,
      id: () => `character-test-${++next}`,
    });
    const first = await service.register({
      guildId,
      ownerUserId: userId,
      name: "Aster",
      operationKey: "create-aster",
    });
    const second = await service.register({
      guildId,
      ownerUserId: userId,
      name: "Bracken",
      operationKey: "create-bracken",
    });
    const approvedFirst = await service.approve({
      guildId,
      characterId: first.characterId,
      actorUserId: "admin-1",
      openingXp: 7,
      openingGold: 250,
      reason: "Import existing guild character",
      operationKey: "approve-aster",
    });
    const approvedSecond = await service.approve({
      guildId,
      characterId: second.characterId,
      actorUserId: "admin-1",
      reason: "Approve new secondary character",
      operationKey: "approve-bracken",
    });

    expect(approvedFirst).toMatchObject({ isMain: true, openingXp: 7, openingGold: 250 });
    expect(approvedSecond.isMain).toBe(false);
    await expect(service.setFrozen({
      guildId,
      ownerUserId: userId,
      characterId: first.characterId,
      frozen: true,
      actorUserId: userId,
      operationKey: "freeze-main-rejected",
    })).rejects.toThrow("Set another active character as main");

    await service.setMain({
      guildId,
      ownerUserId: userId,
      characterId: second.characterId,
      actorUserId: userId,
      operationKey: "main-bracken",
    });
    await service.setFrozen({
      guildId,
      ownerUserId: userId,
      characterId: first.characterId,
      frozen: true,
      actorUserId: userId,
      operationKey: "freeze-aster",
    });

    await expect(service.resolveRewardCharacter({
      guildId,
      ownerUserId: userId,
      role: "player",
      playedCharacterId: first.characterId,
    })).resolves.toMatchObject({ characterId: second.characterId, isMain: true });
    await expect(service.resolveRewardCharacter({
      guildId,
      ownerUserId: userId,
      role: "dm",
      selectedCharacterId: first.characterId,
    })).rejects.toBeInstanceOf(CharacterRuleError);

    const events = await env.DB.prepare(
      "SELECT action FROM character_events WHERE guild_id = ? ORDER BY occurred_at, character_event_id",
    ).bind(guildId).all<{ action: string }>();
    expect(events.results.map((event) => event.action)).toEqual(
      expect.arrayContaining(["created", "approved", "main_changed", "frozen"]),
    );
    const violations = await env.DB.prepare("PRAGMA foreign_key_check").all();
    expect(violations.results).toEqual([]);
  });
});
