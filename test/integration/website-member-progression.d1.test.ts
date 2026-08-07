import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { CharacterService } from "../../src/character-service";
import { CharacterRepository } from "../../src/storage/character-repository";
import { ProgressionRepository } from "../../src/storage/progression-repository";
import { handleWebsiteLibraryReadRequest } from "../../src/website-library-read-model";

const NOW = Date.parse("2026-09-15T18:00:00Z");

describe("member-safe website progression contract", () => {
  it("scopes characters, balances, and paginated ledger history to the verified member", async () => {
    const prefix = crypto.randomUUID();
    const guildId = prefix.replace(/\D/g, "").padEnd(18, "0").slice(0, 18);
    const ownerId = `${prefix}:owner`;
    const otherOwnerId = `${prefix}:other`;
    const emptyOwnerId = `${prefix}:empty`;
    const adminId = `${prefix}:admin`;
    await env.DB.prepare(
      `INSERT INTO guild_config (guild_id, reminder_role_id, admin_role_id)
       VALUES (?, 'role-player', 'role-admin')`,
    ).bind(guildId).run();

    let sequence = 0;
    const ids = () => `${prefix}:id:${++sequence}`;
    const characterRepository = new CharacterRepository(env.DB);
    const characters = new CharacterService(characterRepository, { now: () => NOW, id: ids });
    const progression = new ProgressionRepository(env.DB);

    async function approved(ownerUserId: string, name: string, operation: string) {
      const pending = await characters.register({
        guildId, ownerUserId, name, operationKey: `${operation}:register`,
      });
      return characters.approve({
        guildId,
        characterId: pending.characterId,
        actorUserId: adminId,
        openingXp: 3,
        openingGold: 100,
        reason: "Approved website contract fixture",
        operationKey: `${operation}:approve`,
      });
    }

    const main = await approved(ownerId, "Main Hero", `${prefix}:main`);
    const frozen = await approved(ownerId, "Frozen Hero", `${prefix}:frozen`);
    await characters.setFrozen({
      guildId,
      ownerUserId: ownerId,
      characterId: frozen.characterId,
      frozen: true,
      actorUserId: ownerId,
      operationKey: `${prefix}:freeze`,
    });
    const archived = await approved(ownerId, "Archived Hero", `${prefix}:archived`);
    await characters.archive({
      guildId,
      ownerUserId: ownerId,
      characterId: archived.characterId,
      actorUserId: ownerId,
      operationKey: `${prefix}:archive`,
    });
    const other = await approved(otherOwnerId, "Other Member Hero", `${prefix}:other`);

    const first = await progression.appendEntry({
      entryId: `${prefix}:entry:1`,
      guildId,
      characterId: main.characterId,
      entryKind: "admin_adjustment",
      xpDelta: 2,
      goldDelta: 100,
      actorUserId: adminId,
      reason: "First reconciliation fixture",
      idempotencyKey: `${prefix}:entry:1`,
      occurredAt: NOW - 2_000,
    });
    await progression.appendEntry({
      entryId: `${prefix}:entry:2`,
      guildId,
      characterId: main.characterId,
      entryKind: "reversal",
      xpDelta: -2,
      goldDelta: -100,
      reversesEntryId: first.entryId,
      actorUserId: adminId,
      reason: "Reverse the first fixture entry",
      idempotencyKey: `${prefix}:entry:2`,
      occurredAt: NOW - 1_000,
    });
    await progression.appendEntry({
      entryId: `${prefix}:entry:3`,
      guildId,
      characterId: main.characterId,
      entryKind: "admin_adjustment",
      xpDelta: 1,
      goldDelta: 50,
      actorUserId: adminId,
      reason: "Current reconciliation fixture",
      idempotencyKey: `${prefix}:entry:3`,
      occurredAt: NOW,
    });
    await progression.appendEntry({
      entryId: `${prefix}:entry:other`,
      guildId,
      characterId: other.characterId,
      entryKind: "admin_adjustment",
      xpDelta: 5,
      goldDelta: 500,
      actorUserId: adminId,
      reason: "Another member private fixture",
      idempotencyKey: `${prefix}:entry:other`,
      occurredAt: NOW,
    });

    const read = (userId: string, cursor?: string, etag?: string) =>
      handleWebsiteLibraryReadRequest(new Request(
        `https://guild.example/api/v1/guilds/${guildId}/progression-seasons?season=all&limit=1`
          + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""),
        { headers: {
          Authorization: "Bearer test-token",
          "X-Guild-Contract-Version": "progression-seasons.v1",
          ...(etag ? { "If-None-Match": etag } : {}),
        } },
      ), env, {
        now: () => NOW,
        fetch: async () => Response.json({
          user: { id: userId }, roles: ["role-player"], pending: false,
        }),
      });

    const response = await read(ownerId);
    expect(response?.status).toBe(200);
    const body = await response!.json() as {
      viewer: { userId: string };
      characters: Array<{
        characterId: string;
        status: string;
        progressionState: string;
      }>;
      balances: Array<{ characterId: string; xp: number; gold: number; level: number }>;
      history: Array<{
        entryId: string;
        effective: boolean;
        reversal: { entryId: string } | null;
      }>;
      nextCursor: string | null;
    };
    expect(body.viewer.userId).toBe(ownerId);
    expect(body.characters).toEqual(expect.arrayContaining([
      expect.objectContaining({ characterId: main.characterId, status: "approved" }),
      expect.objectContaining({ characterId: frozen.characterId, progressionState: "frozen" }),
      expect.objectContaining({ characterId: archived.characterId, status: "archived" }),
    ]));
    expect(body.characters.some((character) => character.characterId === other.characterId))
      .toBe(false);
    expect(body.balances).toEqual(expect.arrayContaining([
      expect.objectContaining({ characterId: main.characterId, xp: 4, gold: 150, level: 4 }),
    ]));
    expect(body.balances.some((balance) => balance.characterId === other.characterId)).toBe(false);
    expect(body.history).toHaveLength(1);
    expect(body.history[0]?.entryId).toBe(`${prefix}:entry:3`);
    expect(body.nextCursor).toBeTruthy();

    const nextResponse = await read(ownerId, body.nextCursor!);
    const nextBody = await nextResponse!.json() as typeof body;
    expect(nextBody.history).toHaveLength(1);
    expect(nextBody.history[0]).toMatchObject({
      entryId: `${prefix}:entry:2`,
      effective: true,
      reversal: null,
    });
    const reversedResponse = await read(ownerId, nextBody.nextCursor!);
    const reversedBody = await reversedResponse!.json() as typeof body;
    expect(reversedBody.history[0]).toMatchObject({
      entryId: `${prefix}:entry:1`,
      effective: false,
      reversal: { entryId: `${prefix}:entry:2` },
    });

    const ownerEtag = response!.headers.get("etag")!;
    const otherResponse = await read(otherOwnerId, undefined, ownerEtag);
    expect(otherResponse?.status).toBe(200);
    expect(otherResponse?.headers.get("etag")).not.toBe(ownerEtag);
    const otherBody = await otherResponse!.json() as typeof body;
    expect(otherBody.characters.map((character) => character.characterId)).toEqual([
      other.characterId,
    ]);

    const emptyResponse = await read(emptyOwnerId);
    const emptyBody = await emptyResponse!.json() as typeof body;
    expect(emptyBody.characters).toEqual([]);
    expect(emptyBody.balances).toEqual([]);
    expect(emptyBody.history).toEqual([]);
    expect(emptyBody.nextCursor).toBeNull();
  });

  it("rejects contract mismatches, role loss, and malformed cursors", async () => {
    const prefix = crypto.randomUUID();
    const guildId = prefix.replace(/\D/g, "").padEnd(18, "0").slice(0, 18);
    await env.DB.prepare(
      "INSERT INTO guild_config (guild_id, reminder_role_id) VALUES (?, 'role-player')",
    ).bind(guildId).run();
    await env.DB.prepare(
      `INSERT INTO progression_seasons (
         guild_id, season_id, name, status, starts_at,
         created_by_user_id, created_at, updated_at
       ) VALUES (?, 'current', 'Current', 'current', ?, 'fixture', ?, ?)`,
    ).bind(guildId, NOW, NOW, NOW).run();
    const request = (contract: string, roles: string[], cursor = "") =>
      handleWebsiteLibraryReadRequest(new Request(
        `https://guild.example/api/v1/guilds/${guildId}/progression-seasons${cursor}`,
        { headers: {
          Authorization: "Bearer test-token",
          "X-Guild-Contract-Version": contract,
        } },
      ), env, {
        now: () => NOW,
        fetch: async () => Response.json({
          user: { id: `${prefix}:member` }, roles, pending: false,
        }),
      });

    expect((await request("progression-seasons.v0", ["role-player"]))?.status).toBe(406);
    expect((await request("progression-seasons.v1", []))?.status).toBe(403);
    const malformed = await request("progression-seasons.v1", ["role-player"], "?cursor=broken");
    expect(malformed?.status).toBe(400);
    await expect(malformed!.json()).resolves.toEqual({ error: "cursor is invalid" });
  });
});
