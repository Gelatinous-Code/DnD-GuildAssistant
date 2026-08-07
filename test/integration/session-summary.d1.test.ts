import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { DiscordMessage, DiscordMessagePayload } from "../../src/discord-api";
import { SUMMARY_EDIT_WINDOW_MS, SUMMARY_REMINDER_AFTER_MS } from "../../src/domain/session-summary";
import { PriorityService } from "../../src/priority-service";
import { SessionService } from "../../src/session-service";
import { SessionRecapOperationsService } from "../../src/session-recap-operations-service";
import { SessionSummaryService, SummaryAccessError } from "../../src/session-summary-service";
import { PriorityRepository } from "../../src/storage/priority-repository";
import { SessionRepository } from "../../src/storage/session-repository";
import { SessionRecapOperationsRepository } from "../../src/storage/session-recap-operations-repository";
import { SessionSummaryRepository } from "../../src/storage/session-summary-repository";
import { handleWebsiteReadRequest } from "../../src/website-read-model";

const INITIAL_NOW = Date.parse("2026-09-01T18:00:00Z");

describe("D1 session summary workflow", () => {
  it("auto-completes a table, DMs once, reminds, submits, and preserves editable revisions", async () => {
    const prefix = crypto.randomUUID();
    const guildId = (
      BigInt(`0x${prefix.replaceAll("-", "").slice(0, 15)}`) + 100000000000000000n
    ).toString();
    const roleId = (BigInt(guildId) + 1n).toString();
    const adminRoleId = (BigInt(guildId) + 2n).toString();
    const eventId = `${prefix}:event`;
    const planId = `${prefix}:plan`;
    const tableId = `${prefix}:table`;
    const dmUserId = `${prefix}:dm`;
    const playerUserId = `${prefix}:player`;
    const startsAt = INITIAL_NOW - 4 * 60 * 60 * 1_000;
    const endsAt = INITIAL_NOW - 60 * 60 * 1_000;

    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO guild_config (guild_id, reminder_role_id, admin_role_id) VALUES (?, ?, ?)",
      ).bind(guildId, roleId, adminRoleId),
      env.DB.prepare(
        `INSERT INTO weekly_events (
           event_id, guild_id, title, starts_at, ends_at, signup_opens_at,
           signup_locks_at, status, table_selection_closes_at,
           final_manifest_channel_id, final_manifest_message_id,
           table_state_version, finalized_plan_id,
           finalized_table_state_version, tables_finalized_at, archived_at
         ) VALUES (
           ?, ?, 'Summary acceptance', ?, ?, ?, ?, 'archived', ?,
           '100000000000000001', '100000000000000002', 1, ?, 1, ?, ?
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
         ) VALUES (?, ?, 1, 'published', 'summary-v1', 1, 1, 6, 1, 1, 1, ?)`,
      ).bind(planId, eventId, startsAt - 3_000),
      env.DB.prepare(
        `INSERT INTO plan_tables (
           table_id, plan_id, table_number, title, capacity,
           gm_user_id, gm_display_name, game_tier
         ) VALUES (?, ?, 1, 'Summary Table', 6, ?, 'Summary DM', 2)`,
      ).bind(tableId, planId, dmUserId),
      env.DB.prepare(
        `INSERT INTO assignments (
           assignment_id, plan_id, table_id, desired_table_id, user_id,
           display_name, status, assigned_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'Player', 'assigned', ?, ?)`,
      ).bind(`${prefix}:assignment`, planId, tableId, tableId, playerUserId, startsAt, startsAt),
      env.DB.prepare(
        `INSERT INTO table_thread_workflows (
           workflow_id, guild_id, event_id, table_number, plan_id, table_id,
           parent_channel_id, thread_name, gm_user_id, gm_display_name, status,
           cancelled_at, cancelled_by_user_id, cancellation_reason, created_at, updated_at
         ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 'cancelled', ?, ?, ?, ?, ?)`,
      ).bind(
        `${prefix}:workflow`, guildId, eventId, planId, tableId,
        "100000000000000001", "Summary Table", dmUserId, "Summary DM",
        endsAt - 10_000, `${prefix}:admin`, "Table was manually closed",
        startsAt, endsAt - 10_000,
      ),
    ]);

    let now = INITIAL_NOW;
    let sequence = 0;
    const ids = () => `${prefix}:id:${++sequence}`;
    const sent: Array<{ userId: string; deliveryKey: string; content: string }> = [];
    const discord = {
      async sendDirectMessage(
        userId: string,
        payload: DiscordMessagePayload,
        deliveryKey: string,
      ): Promise<DiscordMessage> {
        sent.push({ userId, deliveryKey, content: payload.content ?? "" });
        return {
          id: String(200000000000000000n + BigInt(sent.length)),
          channel_id: "100000000000000003",
          content: payload.content ?? "",
          components: payload.components,
        };
      },
    };
    const sessionRepository = new SessionRepository(env.DB);
    const priorityRepository = new PriorityRepository(env.DB, () => now);
    const priority = new PriorityService(priorityRepository, { now: () => now, id: ids });
    const sessions = new SessionService(sessionRepository, priorityRepository, priority, {
      now: () => now,
      id: ids,
    });
    const repository = new SessionSummaryRepository(env.DB);
    const operationsRepository = new SessionRecapOperationsRepository(env.DB);
    const operations = new SessionRecapOperationsService(operationsRepository, sessions, {
      now: () => now,
      id: ids,
    });
    const summaries = new SessionSummaryService(repository, sessions, discord, {
      now: () => now,
      id: ids,
      recapsEnabled: true,
      rewardPolicyVersion: "test-recap-reward-v1",
      operations: operationsRepository,
    });

    await summaries.runScheduled();
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM session_completion_revisions WHERE guild_id = ?",
    ).bind(guildId).first<number>("count")).toBe(0);
    expect(sent).toHaveLength(0);
    await env.DB.prepare(
      `UPDATE table_thread_workflows SET status = 'pending',
         cancelled_at = NULL, cancelled_by_user_id = NULL, cancellation_reason = NULL
       WHERE guild_id = ? AND event_id = ? AND table_id = ?`,
    ).bind(guildId, eventId, tableId).run();

    await summaries.runScheduled();
    const created = await env.DB.prepare(
      "SELECT summary_id FROM session_summaries WHERE guild_id = ?",
    ).bind(guildId).first<{ summary_id: string }>();
    expect(created?.summary_id).toBeTruthy();
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM session_completion_revisions WHERE guild_id = ? AND is_current = 1",
    ).bind(guildId).first<number>("count")).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ userId: dmUserId });
    expect(sent[0]!.content).toContain("bonus gold or items");
    expect(sent[0]!.content).toContain("Summary acceptance");
    expect(sent[0]!.content).toContain("Table 1");
    expect(sent[0]!.content).toContain("Tier 2");
    expect(sent[0]!.content).toContain("recorded DM");

    await summaries.runScheduled();
    expect(sent).toHaveLength(1);

    now = endsAt + SUMMARY_REMINDER_AFTER_MS;
    await summaries.runScheduled();
    expect(sent).toHaveLength(2);
    expect(sent[1]!.content).toContain("still waiting");

    const summaryId = created!.summary_id;
    await expect(summaries.getForDm(summaryId, playerUserId)).rejects.toBeInstanceOf(
      SummaryAccessError,
    );
    const first = await summaries.submit({
      summaryId,
      userId: dmUserId,
      fields: {
        summaryText: "The party stopped the ritual and rescued the missing scouts.",
        area: "Bloom",
        importantEvents: "The passage bell cracked.",
        bonusRewards: "A moon-silver key.",
        otherNotes: null,
      },
    });
    expect(first.onTime).toBe(true);
    expect(first.summary.version).toBe(2);
    expect(first.summary.editExpiresAt).toBe(now + SUMMARY_EDIT_WINDOW_MS);
    expect(await operationsRepository.getQualification(summaryId)).toMatchObject({
      qualification: "timely",
      timingPolicyVersion: "recap-timing-v1",
      rewardPolicyVersion: "test-recap-reward-v1",
      rewardStatus: "qualified_ungranted",
    });
    let membershipChecks = 0;
    const readSummaryFeed = (etag?: string) => handleWebsiteReadRequest(
      new Request(
        `https://guild.example/api/v1/guilds/${guildId}/session-summaries?limit=1&area=Bloom&tier=2`,
        {
          headers: {
            Authorization: "Bearer test-token",
            "X-Guild-Contract-Version": "session-summaries.v1",
            ...(etag ? { "If-None-Match": etag } : {}),
          },
        },
      ),
      env,
      {
        now: () => now,
        fetch: async () => {
          membershipChecks++;
          return Response.json({ user: { id: playerUserId }, roles: [roleId], pending: false });
        },
      },
    );
    const readAdminSummaryFeed = () => handleWebsiteReadRequest(
      new Request(
        `https://guild.example/api/v1/guilds/${guildId}/session-summaries?visibility=all`,
        { headers: {
          Authorization: "Bearer admin-token",
          "X-Guild-Contract-Version": "session-summaries.v1",
        } },
      ),
      env,
      {
        now: () => now,
        fetch: async () => Response.json({
          user: { id: `${prefix}:admin-reader` },
          roles: [adminRoleId],
          pending: false,
        }),
      },
    );
    const feedResponse = await readSummaryFeed();
    expect(feedResponse?.status).toBe(200);
    expect(feedResponse?.headers.get("cache-control")).toBe("private, no-store");
    const feed = await feedResponse!.json() as {
      schemaVersion: string;
      items: Array<{
        summary: string;
        area: string;
        gameTier: number;
        gmName: string | null;
        seasonName: string | null;
      }>;
    };
    expect(feed).toMatchObject({
      schemaVersion: "session-summaries.v1",
      items: [{
        summary: "The party stopped the ritual and rescued the missing scouts.",
        area: "Bloom",
        gameTier: 2,
        gmName: "Summary DM",
        seasonName: null,
      }],
    });
    const validator = feedResponse!.headers.get("etag");
    expect(validator).toBeTruthy();
    expect((await readSummaryFeed(validator!))?.status).toBe(304);
    expect(membershipChecks).toBe(2);
    expect(await env.DB.prepare(
      "SELECT revision_number FROM session_summary_revisions WHERE summary_id = ? AND is_current = 1",
    ).bind(summaryId).first<number>("revision_number")).toBe(1);
    expect(await env.DB.prepare(
      "SELECT status FROM session_summary_deliveries WHERE summary_id = ? AND delivery_kind = 'reminder'",
    ).bind(summaryId).first<string>("status")).toBe("sent");

    await summaries.runScheduled();
    expect(sent).toHaveLength(2);

    await operations.manage({
      guildId,
      eventId,
      tableNumber: 1,
      action: "lock",
      actorUserId: `${prefix}:admin`,
      reason: "Temporarily lock edits for moderation",
      idempotencyKey: `${prefix}:lock`,
    });
    await expect(summaries.getForDm(summaryId, dmUserId)).rejects.toThrow("locked");
    await operations.manage({
      guildId,
      eventId,
      tableNumber: 1,
      action: "reopen",
      actorUserId: `${prefix}:admin`,
      reason: "DM may resume editing",
      idempotencyKey: `${prefix}:reopen`,
      reopenHours: 48,
    });

    now += 24 * 60 * 60 * 1_000;
    const edited = await summaries.submit({
      summaryId,
      userId: dmUserId,
      fields: {
        summaryText: "The party stopped the ritual, rescued the scouts, and sealed the gate.",
        area: "Bloom and the Old Passage",
        importantEvents: "The passage bell cracked.",
        bonusRewards: "A moon-silver key.",
        otherNotes: "The gate remains unstable.",
      },
    });
    expect(edited.summary.version).toBe(3);
    const revisions = await env.DB.prepare(
      "SELECT revision_number, is_current FROM session_summary_revisions WHERE summary_id = ? ORDER BY revision_number",
    ).bind(summaryId).all<{ revision_number: number; is_current: number }>();
    expect(revisions.results).toEqual([
      { revision_number: 1, is_current: 0 },
      { revision_number: 2, is_current: 1 },
    ]);
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM session_summary_qualifications WHERE summary_id = ?",
    ).bind(summaryId).first<number>("count")).toBe(1);
    await operations.manage({
      guildId,
      eventId,
      tableNumber: 1,
      action: "hide",
      actorUserId: `${prefix}:admin`,
      reason: "Hide while a correction is prepared",
      idempotencyKey: `${prefix}:hide`,
    });
    const hiddenFeed = await (await readSummaryFeed())!.json() as { items: unknown[] };
    expect(hiddenFeed.items).toHaveLength(0);
    const hiddenAdminFeed = await (await readAdminSummaryFeed())!.json() as {
      viewer: { capabilities: { readModerationDiagnostics: boolean } };
      items: Array<{ publicationStatus: string; moderation: { reason: string } }>;
    };
    expect(hiddenAdminFeed.viewer.capabilities.readModerationDiagnostics).toBe(true);
    expect(hiddenAdminFeed.items[0]).toMatchObject({
      publicationStatus: "hidden",
      moderation: { reason: "Hide while a correction is prepared" },
    });
    await operations.manage({
      guildId,
      eventId,
      tableNumber: 1,
      action: "correction",
      actorUserId: `${prefix}:admin`,
      reason: "Correct an inaccurate public detail",
      publicCorrection: "Correction: the gate was stabilized, not permanently sealed.",
      idempotencyKey: `${prefix}:correction`,
    });
    await operations.manage({
      guildId,
      eventId,
      tableNumber: 1,
      action: "unhide",
      actorUserId: `${prefix}:admin`,
      reason: "Correction is now recorded",
      idempotencyKey: `${prefix}:unhide`,
    });
    expect((await operations.status(guildId, eventId, 1)).events.map(
      (event) => event.eventKind,
    )).toEqual(expect.arrayContaining([
      "edit_locked", "edit_reopened", "hidden", "correction_appended", "unhidden",
    ]));
    const correctedFeed = await (await readSummaryFeed())!.json() as {
      items: Array<{ corrections: Array<{ text: string }> }>;
    };
    expect(correctedFeed.items[0]?.corrections).toEqual([
      { text: "Correction: the gate was stabilized, not permanently sealed.", correctedAt: now },
    ]);
    const adminCorrectedFeed = await (await readAdminSummaryFeed())!.json() as {
      items: Array<{ corrections: Array<{ provenance: { eventId: string; reason: string } }> }>;
    };
    expect(adminCorrectedFeed.items[0]?.corrections[0]?.provenance).toMatchObject({
      eventId: expect.any(String),
      reason: "Correct an inaccurate public detail",
    });

    now = first.summary.editExpiresAt! + 1;
    await expect(summaries.getForDm(summaryId, dmUserId)).rejects.toThrow(
      "edit window has closed",
    );

    await sessions.confirmSession({
      guildId,
      eventId,
      tableNumber: 1,
      result: "cancelled",
      confirmedByUserId: `${prefix}:admin`,
      reason: "Administrator corrected the table to cancelled",
      idempotencyKey: `${prefix}:cancel-correction`,
    });
    await expect(summaries.getForDm(summaryId, dmUserId)).rejects.toThrow(
      "no longer exists",
    );

    now += 1_000;
    await sessions.confirmSession({
      guildId,
      eventId,
      tableNumber: 1,
      result: "completed",
      confirmedByUserId: `${prefix}:admin`,
      reason: "Administrator restored the completed result",
      idempotencyKey: `${prefix}:restore-completed`,
    });
    await summaries.runScheduled();
    expect(sent).toHaveLength(3);
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM session_summaries WHERE guild_id = ?",
    ).bind(guildId).first<number>("count")).toBe(2);
    const currentSummaryId = await env.DB.prepare(
      `SELECT summary.summary_id FROM session_summaries summary
       JOIN session_completion_revisions revision
         ON revision.completion_revision_id = summary.completion_revision_id
        AND revision.is_current = 1
       WHERE summary.guild_id = ?`,
    ).bind(guildId).first<string>("summary_id");
    const late = await summaries.submit({
      summaryId: currentSummaryId!,
      userId: dmUserId,
      fields: {
        summaryText: "The restored session recap was submitted after its deadline.",
        area: "Bloom",
        importantEvents: null,
        bonusRewards: null,
        otherNotes: null,
      },
    });
    expect(late.onTime).toBe(false);
    expect(await operationsRepository.getQualification(currentSummaryId!)).toMatchObject({
      qualification: "late",
      rewardStatus: "not_qualified",
    });

    await sessions.confirmSession({
      guildId,
      eventId,
      tableNumber: 1,
      result: "cancelled",
      confirmedByUserId: `${prefix}:admin`,
      reason: "Administrator reopened the scenario for a pending-recap test",
      idempotencyKey: `${prefix}:cancel-late-summary`,
    });
    now += 1_000;
    await sessions.confirmSession({
      guildId,
      eventId,
      tableNumber: 1,
      result: "completed",
      confirmedByUserId: `${prefix}:admin`,
      reason: "Administrator restored the scenario for a pending-recap test",
      idempotencyKey: `${prefix}:restore-pending-summary`,
    });
    await summaries.runScheduled();
    expect(sent).toHaveLength(4);
    const pendingSummaryId = await env.DB.prepare(
      `SELECT summary.summary_id FROM session_summaries summary
       JOIN session_completion_revisions revision
         ON revision.completion_revision_id = summary.completion_revision_id
        AND revision.is_current = 1
       WHERE summary.guild_id = ?`,
    ).bind(guildId).first<string>("summary_id");
    expect(await operations.pending(guildId, dmUserId)).toHaveLength(1);
    const retryInput = {
      guildId,
      eventId,
      tableNumber: 1,
      action: "retry_delivery" as const,
      actorUserId: `${prefix}:admin`,
      reason: "DM requested a replacement prompt",
      idempotencyKey: `${prefix}:retry-prompt`,
    };
    await Promise.all([
      operations.manage(retryInput),
      operations.manage(retryInput),
    ]);
    expect((await operations.status(guildId, eventId, 1)).deliveries.find(
      (delivery) => delivery.deliveryKind === "prompt",
    )?.repairCount).toBe(1);
    await summaries.deliverDue();
    expect(sent).toHaveLength(5);
    await operations.reportDidNotRun(pendingSummaryId!, dmUserId);
    expect((await sessions.status(guildId, eventId, 1)).currentRevision?.result).toBe("cancelled");
    await env.DB.prepare(
      "DELETE FROM session_summary_admin_events WHERE guild_id = ? AND idempotency_key = ?",
    ).bind(guildId, `recap:not-run:${pendingSummaryId}`).run();
    await operations.reportDidNotRun(pendingSummaryId!, dmUserId);
    expect(await env.DB.prepare(
      `SELECT count(*) AS count FROM session_summary_admin_events
       WHERE guild_id = ? AND idempotency_key = ?`,
    ).bind(guildId, `recap:not-run:${pendingSummaryId}`).first<number>("count")).toBe(1);
    expect(await operations.pending(guildId, dmUserId)).toHaveLength(0);
  });
});
