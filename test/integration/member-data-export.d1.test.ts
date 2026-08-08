import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  recordAttachmentDelivery,
  type InternalAttachmentResponse,
} from "../../src/app";
import type { DiscordInteraction } from "../../src/discord";
import { handleMemberDataCommand } from "../../src/member-data-app";
import { GuildRepository } from "../../src/storage/repository";

const NOW = Date.parse("2026-09-26T18:00:00Z");

function id(suffix: string): string {
  return `${crypto.randomUUID().replaceAll("-", "")}:${suffix}`;
}

function command(input: {
  id: string;
  guildId: string;
  actorUserId: string;
  subcommand: "preview" | "export" | "status" | "retry";
  subjectUserId?: string;
  action?: "export" | "departure";
  revision?: string;
  operation?: string;
  permissions?: string;
}): DiscordInteraction {
  const options = input.subcommand === "preview"
    ? [
        { type: 6, name: "member", value: input.subjectUserId },
        { type: 3, name: "action", value: input.action ?? "export" },
      ]
    : input.subcommand === "export"
      ? [
          { type: 6, name: "member", value: input.subjectUserId },
          { type: 3, name: "revision", value: input.revision },
        ]
      : [{ type: 3, name: "operation", value: input.operation }];
  return {
    id: input.id,
    type: 2,
    guild_id: input.guildId,
    app_permissions: "32768",
    member: {
      user: { id: input.actorUserId },
      permissions: input.permissions ?? "32",
    },
    data: {
      name: "member-data",
      options: [{ type: 1, name: input.subcommand, options }],
    },
  };
}

describe("member data export D1 lifecycle", () => {
  it("isolates one verified member and supports duplicate, failure, safe audit, and retry", async () => {
    const guildId = id("guild");
    const otherGuildId = id("other-guild");
    const subjectUserId = id("subject");
    const otherUserId = id("other-user");
    const actorUserId = id("admin");
    const characterId = id("character");
    const otherCharacterId = id("other-character");
    await env.DB.batch([
      env.DB.prepare("INSERT INTO guild_config (guild_id) VALUES (?)").bind(guildId),
      env.DB.prepare("INSERT INTO guild_config (guild_id) VALUES (?)").bind(otherGuildId),
      env.DB.prepare(
        `INSERT INTO characters (
          character_id,guild_id,owner_user_id,name,sheet_url,status,is_main,
          opening_xp,opening_gold,version,created_at,created_by_user_id,updated_at,
          approved_at,approved_by_user_id
        ) VALUES (?, ?, ?, 'Subject Hero', 'https://example.invalid/private-sheet',
          'approved', 1, 0, 0, 1, ?, ?, ?, ?, ?)`,
      ).bind(characterId, guildId, subjectUserId, NOW, subjectUserId, NOW, NOW, actorUserId),
      env.DB.prepare(
        `INSERT INTO characters (
          character_id,guild_id,owner_user_id,name,status,is_main,opening_xp,opening_gold,
          version,created_at,created_by_user_id,updated_at,approved_at,approved_by_user_id
        ) VALUES (?, ?, ?, 'Other Secret Hero', 'approved', 1, 0, 0, 1, ?, ?, ?, ?, ?)`,
      ).bind(otherCharacterId, guildId, otherUserId, NOW, otherUserId, NOW, NOW, actorUserId),
    ]);

    const verified: Array<[string, string]> = [];
    const verifier = {
      async getGuildMember(verifiedGuildId: string, verifiedUserId: string) {
        verified.push([verifiedGuildId, verifiedUserId]);
        if (verifiedGuildId !== guildId || verifiedUserId !== subjectUserId) throw new Error("404");
        return {};
      },
    };
    const previewResponse = await handleMemberDataCommand(command({
      id: id("preview"), guildId, actorUserId, subcommand: "preview", subjectUserId,
    }), env, verifier);
    const preview = await previewResponse!.json() as { data: { content: string } };
    const revision = preview.data.content.match(/Revision: `([a-f0-9]{64})`/)?.[1];
    expect(revision).toMatch(/^[a-f0-9]{64}$/);

    const exportInteraction = command({
      id: id("export"), guildId, actorUserId, subcommand: "export",
      subjectUserId, revision,
    });
    const exportResponse = await handleMemberDataCommand(exportInteraction, env, verifier);
    const exported = await exportResponse!.json() as {
      data: { content: string };
      attachment: InternalAttachmentResponse;
    };
    const payload = JSON.parse(exported.attachment.content) as {
      subjectUserId: string;
      data: { characters: Array<{ name: string; sheetUrl: string }> };
    };
    expect(payload.subjectUserId).toBe(subjectUserId);
    expect(payload.data.characters).toEqual([
      expect.objectContaining({
        name: "Subject Hero",
        sheetUrl: "https://example.invalid/private-sheet",
      }),
    ]);
    expect(exported.attachment.content).not.toContain("Other Secret Hero");
    const operationKey = exported.attachment.audit?.operationKey;
    expect(operationKey).toMatch(/^member-export:/);

    const duplicateResponse = await handleMemberDataCommand(exportInteraction, env, verifier);
    const duplicate = await duplicateResponse!.json() as {
      data: { content: string };
      attachment?: unknown;
    };
    expect(duplicate.attachment).toBeUndefined();
    expect(duplicate.data.content).toContain("status: **started**");

    await recordAttachmentDelivery(env, exported.attachment, "failed", new Error("secret body"));
    const repository = new GuildRepository(env.DB);
    expect((await repository.getOperation(operationKey!))?.status).toBe("failed");
    const failedAudit = (await repository.listAudit(guildId, 1))[0];
    expect(failedAudit.action).toBe("member-data.export-delivery-failed");
    expect(JSON.stringify(failedAudit)).not.toContain("Subject Hero");
    expect(JSON.stringify(failedAudit)).not.toContain("private-sheet");
    expect(JSON.stringify(failedAudit)).not.toContain("secret body");

    const retryResponse = await handleMemberDataCommand(command({
      id: id("retry"), guildId, actorUserId, subcommand: "retry", operation: operationKey,
    }), env, verifier);
    const retried = await retryResponse!.json() as { attachment: InternalAttachmentResponse };
    const retriedPayload = JSON.parse(retried.attachment.content) as {
      revision: string;
      data: unknown;
    };
    expect(retriedPayload.revision).toBe(revision);
    expect(retriedPayload.data).toEqual(payload.data);
    await recordAttachmentDelivery(env, retried.attachment, "succeeded");
    expect((await repository.getOperation(operationKey!))?.status).toBe("succeeded");
    expect((await repository.listAudit(guildId, 1))[0].action).toBe("member-data.export-delivered");

    await expect(handleMemberDataCommand(command({
      id: id("wrong-guild-status"), guildId: otherGuildId, actorUserId,
      subcommand: "status", operation: operationKey,
    }), env, verifier)).rejects.toThrow("not found in this server");
    await expect(handleMemberDataCommand(command({
      id: id("wrong-member"), guildId, actorUserId, subcommand: "preview",
      subjectUserId: otherUserId,
    }), env, verifier)).rejects.toThrow("could not be verified");
    expect(verified).toContainEqual([guildId, subjectUserId]);
  });

  it("rejects a stale revision and audits only the rejection kind", async () => {
    const guildId = id("conflict-guild");
    const subjectUserId = id("conflict-subject");
    const actorUserId = id("conflict-admin");
    const characterId = id("conflict-character");
    await env.DB.batch([
      env.DB.prepare("INSERT INTO guild_config (guild_id) VALUES (?)").bind(guildId),
      env.DB.prepare(
        `INSERT INTO characters (
          character_id,guild_id,owner_user_id,name,status,is_main,opening_xp,opening_gold,
          version,created_at,created_by_user_id,updated_at,approved_at,approved_by_user_id
        ) VALUES (?, ?, ?, 'Before Name', 'approved', 1, 0, 0, 1, ?, ?, ?, ?, ?)`,
      ).bind(characterId, guildId, subjectUserId, NOW, subjectUserId, NOW, NOW, actorUserId),
    ]);
    const verifier = { getGuildMember: async () => ({}) };
    const previewResponse = await handleMemberDataCommand(command({
      id: id("conflict-preview"), guildId, actorUserId, subcommand: "preview", subjectUserId,
    }), env, verifier);
    const preview = await previewResponse!.json() as { data: { content: string } };
    const revision = preview.data.content.match(/Revision: `([a-f0-9]{64})`/)?.[1];
    await env.DB.prepare(
      "UPDATE characters SET name = 'After Name', version = version + 1, updated_at = ? WHERE character_id = ?",
    ).bind(NOW + 1, characterId).run();

    await expect(handleMemberDataCommand(command({
      id: id("conflict-export"), guildId, actorUserId, subcommand: "export",
      subjectUserId, revision,
    }), env, verifier)).rejects.toThrow("changed after preview");
    const audit = (await new GuildRepository(env.DB).listAudit(guildId, 1))[0];
    expect(audit).toMatchObject({
      action: "member-data.export-rejected",
      entityId: subjectUserId,
      details: { reason: "revision_conflict" },
    });
    expect(JSON.stringify(audit)).not.toContain("Before Name");
    expect(JSON.stringify(audit)).not.toContain("After Name");
  });
});
