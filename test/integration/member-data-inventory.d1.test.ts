import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { DiscordInteraction } from "../../src/discord";
import { handleMemberDataCommand } from "../../src/member-data-app";
import { MemberDataRepository } from "../../src/storage/member-data-repository";

const NOW = Date.parse("2026-09-25T18:00:00Z");

function numericId(suffix: string): string {
  const digits = crypto.randomUUID().replace(/\D/g, "").padEnd(17, "0").slice(0, 17);
  return `${digits}${suffix}`.slice(0, 18);
}

function interaction(input: {
  guildId: string;
  actorUserId: string;
  subjectUserId: string;
  permissions?: string;
}): DiscordInteraction {
  return {
    id: crypto.randomUUID(),
    type: 2,
    guild_id: input.guildId,
    member: {
      user: { id: input.actorUserId },
      permissions: input.permissions ?? "32",
    },
    data: {
      name: "member-data",
      options: [{
        type: 1,
        name: "preview",
        options: [
          { type: 6, name: "member", value: input.subjectUserId },
          { type: 3, name: "action", value: "departure" },
        ],
      }],
    },
  };
}

describe("member data inventory D1 boundary", () => {
  it("counts only the selected member in the selected guild and renders a private preview", async () => {
    const guildId = numericId("1");
    const otherGuildId = numericId("2");
    const subjectUserId = numericId("3");
    const otherUserId = numericId("4");
    const adminUserId = numericId("5");
    const prefix = crypto.randomUUID();

    await env.DB.batch([
      env.DB.prepare("INSERT INTO guild_config (guild_id) VALUES (?)").bind(guildId),
      env.DB.prepare("INSERT INTO guild_config (guild_id) VALUES (?)").bind(otherGuildId),
      env.DB.prepare(
        `INSERT INTO characters (
          character_id,guild_id,owner_user_id,name,status,is_main,opening_xp,opening_gold,
          version,created_at,created_by_user_id,updated_at,approved_at,approved_by_user_id
        ) VALUES (?, ?, ?, ?, 'approved', 1, 0, 0, 1, ?, ?, ?, ?, ?)`,
      ).bind(`${prefix}:subject`, guildId, subjectUserId, "Subject Hero", NOW, subjectUserId, NOW, NOW, adminUserId),
      env.DB.prepare(
        `INSERT INTO characters (
          character_id,guild_id,owner_user_id,name,status,is_main,opening_xp,opening_gold,
          version,created_at,created_by_user_id,updated_at,approved_at,approved_by_user_id
        ) VALUES (?, ?, ?, ?, 'approved', 1, 0, 0, 1, ?, ?, ?, ?, ?)`,
      ).bind(`${prefix}:other`, guildId, otherUserId, "Other Hero", NOW, otherUserId, NOW, NOW, adminUserId),
      env.DB.prepare(
        `INSERT INTO characters (
          character_id,guild_id,owner_user_id,name,status,is_main,opening_xp,opening_gold,
          version,created_at,created_by_user_id,updated_at,approved_at,approved_by_user_id
        ) VALUES (?, ?, ?, ?, 'approved', 1, 0, 0, 1, ?, ?, ?, ?, ?)`,
      ).bind(`${prefix}:cross-guild`, otherGuildId, subjectUserId, "Other Guild Hero", NOW, subjectUserId, NOW, NOW, adminUserId),
      env.DB.prepare(
        `INSERT INTO character_events (
          character_event_id,guild_id,character_id,idempotency_key,action,
          character_version,actor_user_id,occurred_at
        ) VALUES (?, ?, ?, ?, 'created', 1, ?, ?)`,
      ).bind(`${prefix}:character-event`, guildId, `${prefix}:subject`, `${prefix}:character-event`, subjectUserId, NOW),
      env.DB.prepare(
        `INSERT INTO progression_seasons (
          guild_id,season_id,name,status,starts_at,created_by_user_id,created_at,updated_at
        ) VALUES (?, 'season-1', 'Season One', 'current', ?, ?, ?, ?)`,
      ).bind(guildId, NOW - 1_000, adminUserId, NOW, NOW),
      env.DB.prepare(
        `INSERT INTO character_season_openings (
          opening_id,guild_id,season_id,character_id,opening_xp,opening_gold,
          policy_version,source_kind,actor_user_id,reason,idempotency_key,created_at
        ) VALUES (?, ?, 'season-1', ?, 0, 0, 'inventory-test-v1', 'approval', ?,
          'Member inventory fixture', ?, ?)`,
      ).bind(`${prefix}:opening`, guildId, `${prefix}:subject`, adminUserId, `${prefix}:opening`, NOW),
      env.DB.prepare(
        `INSERT INTO progression_ledger_entries (
          entry_id,guild_id,character_id,season_id,entry_kind,xp_delta,gold_delta,
          actor_user_id,reason,idempotency_key,occurred_at
        ) VALUES (?, ?, ?, 'season-1', 'admin_adjustment', 1, 50, ?,
          'Member inventory fixture', ?, ?)`,
      ).bind(`${prefix}:ledger`, guildId, `${prefix}:subject`, adminUserId, `${prefix}:ledger`, NOW),
      env.DB.prepare(
        `INSERT INTO weekly_events (
          event_id,guild_id,title,starts_at,signup_opens_at,signup_locks_at,status,created_at,updated_at
        ) VALUES (?, ?, 'Inventory Week', ?, ?, ?, 'archived', ?, ?)`,
      ).bind(`${prefix}:event`, guildId, NOW + 10_000, NOW - 10_000, NOW - 1_000, NOW, NOW),
      env.DB.prepare(
        `INSERT INTO signups (
          event_id,user_id,display_name,signup_kind,status,signed_up_at,updated_at
        ) VALUES (?, ?, 'Private Display Name', 'player', 'active', ?, ?)`,
      ).bind(`${prefix}:event`, subjectUserId, NOW - 5_000, NOW),
    ]);

    const counts = await new MemberDataRepository(env.DB).inventory(guildId, subjectUserId);
    expect(counts).toEqual({
      characters: 1,
      characterEvents: 1,
      journals: 0,
      journalRevisions: 0,
      seasonalBalances: 1,
      progressionEntries: 1,
      shopReceipts: 0,
      officialRecaps: 0,
      recapRevisions: 0,
      weeklySignups: 1,
      tableAssignments: 0,
      sessionParticipationRecords: 0,
      dmPriorityCredits: 0,
    });

    const response = await handleMemberDataCommand(interaction({
      guildId, actorUserId: adminUserId, subjectUserId,
    }), env, { getGuildMember: async () => ({}) });
    expect(response?.status).toBe(200);
    const payload = await response!.json() as { data: { content: string; flags: number } };
    expect(payload.data.flags).toBe(64);
    expect(payload.data.content).toContain("Read-only member departure preview");
    expect(payload.data.content).toContain("**Characters:** 2");
    expect(payload.data.content).toContain("**Seasonal progression:** 2");
    expect(payload.data.content).toContain("No data changed");
    expect(payload.data.content).not.toContain("Private Display Name");

    await expect(handleMemberDataCommand(interaction({
      guildId, actorUserId: otherUserId, subjectUserId, permissions: "0",
    }), env)).rejects.toThrow("requires Manage Server permission");
  });
});
