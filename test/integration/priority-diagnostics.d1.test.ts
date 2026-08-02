import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  PriorityDiagnosticsService,
  renderPriorityDiagnostics,
} from "../../src/priority-diagnostics";
import { PriorityRepository } from "../../src/storage/priority-repository";

const NOW = 1_810_000_000_000;
const SECRET_TEXT = "TOP SECRET free-form note <@999> **do not leak**";

interface DiagnosticsFixture {
  guildId: string;
  otherGuildId: string;
  memberId: string;
  otherMemberId: string;
  adminId: string;
  grantId: string;
  refundCreditId: string;
  sourceEventId: string;
  targetEventId: string;
  assignmentId: string;
}

async function seedDiagnosticsFixture(): Promise<DiagnosticsFixture> {
  const prefix = crypto.randomUUID();
  const guildId = prefix + ":guild";
  const otherGuildId = prefix + ":other-guild";
  const memberId = prefix + ":member";
  const otherMemberId = prefix + ":other-member";
  const adminId = prefix + ":admin";
  const sourceEventId = prefix + ":source-event";
  const grantId = prefix + ":grant";
  const firstCreditId = prefix + ":credit-one";
  const secondCreditId = prefix + ":credit-two";
  const sourcePlanId = prefix + ":source-plan";
  const sourceTableId = prefix + ":source-table";
  const targetEventId = prefix + ":target-event";
  const targetPlanId = prefix + ":target-plan";
  const targetTableId = prefix + ":target-table";
  const assignmentId = prefix + ":assignment";
  const otherAssignmentId = prefix + ":other-assignment";
  const sessionId = prefix + ":session";
  const revisionId = prefix + ":completion-revision";
  const sessionEventId = prefix + ":session-event";
  const operationKey = prefix + ":operation:contains-private-input";
  const seatingEventId = prefix + ":seating-event";
  const otherSeatingEventId = prefix + ":other-seating-event";

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO guild_config (guild_id, timezone) VALUES (?, 'America/Denver')",
    ).bind(guildId),
    env.DB.prepare(
      "INSERT INTO guild_config (guild_id, timezone) VALUES (?, 'UTC')",
    ).bind(otherGuildId),
    env.DB.prepare(
      "INSERT INTO weekly_events (event_id, guild_id, title, starts_at, " +
      "ends_at, signup_opens_at, signup_locks_at, status, archived_at) " +
      "VALUES (?, ?, 'Completed game', ?, ?, ?, ?, 'archived', ?)",
    ).bind(
      sourceEventId,
      guildId,
      NOW - 2_000_000,
      NOW - 1_000_000,
      NOW - 3_000_000,
      NOW - 2_500_000,
      NOW - 1_000_000,
    ),
    env.DB.prepare(
      "INSERT INTO plans (plan_id, event_id, generation, status, " +
      "algorithm_version, min_table_size, preferred_table_size, " +
      "max_table_size, player_count, gm_signup_count, selected_gm_count, " +
      "published_at) VALUES (?, ?, 1, 'published', 'diagnostics-test', " +
      "4, 6, 6, 5, 1, 1, ?)",
    ).bind(sourcePlanId, sourceEventId, NOW - 2_500_000),
    env.DB.prepare(
      "INSERT INTO plan_tables (table_id, plan_id, table_number, title, " +
      "capacity, gm_user_id, gm_display_name) " +
      "VALUES (?, ?, 1, 'Source table', 6, ?, 'Private display name')",
    ).bind(sourceTableId, sourcePlanId, memberId),
    env.DB.prepare(
      "INSERT INTO weekly_events (event_id, guild_id, title, starts_at, " +
      "ends_at, signup_opens_at, signup_locks_at, status) " +
      "VALUES (?, ?, 'Upcoming game', ?, ?, ?, ?, 'published')",
    ).bind(
      targetEventId,
      guildId,
      NOW + 86_400_000,
      NOW + 90_000_000,
      NOW - 100_000,
      NOW + 80_000_000,
    ),
    env.DB.prepare(
      "INSERT INTO signups (event_id, user_id, display_name, signup_kind, " +
      "status, signed_up_at) VALUES (?, ?, 'Member display', 'player', " +
      "'active', ?)",
    ).bind(targetEventId, memberId, NOW - 1_000),
    env.DB.prepare(
      "INSERT INTO plans (plan_id, event_id, generation, status, " +
      "algorithm_version, min_table_size, preferred_table_size, " +
      "max_table_size, player_count, gm_signup_count, selected_gm_count, " +
      "published_at) VALUES (?, ?, 1, 'published', 'diagnostics-test', " +
      "4, 6, 6, 2, 1, 1, ?)",
    ).bind(targetPlanId, targetEventId, NOW - 500),
    env.DB.prepare(
      "INSERT INTO plan_tables (table_id, plan_id, table_number, title, " +
      "capacity, gm_user_id, gm_display_name) " +
      "VALUES (?, ?, 1, 'Target table', 1, ?, 'Other private display')",
    ).bind(targetTableId, targetPlanId, prefix + ":target-dm"),
    env.DB.prepare(
      "INSERT INTO session_completions (session_id, guild_id, " +
      "source_event_id, source_plan_id, source_table_id, draft_open, " +
      "draft_version, draft_operation_key, reward_sync_revision_id, " +
      "reward_sync_status, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, 0, 2, ?, ?, 'synced', ?, ?)",
    ).bind(
      sessionId,
      guildId,
      sourceEventId,
      sourcePlanId,
      sourceTableId,
      prefix + ":draft-operation",
      revisionId,
      NOW - 500,
      NOW,
    ),
    env.DB.prepare(
      "INSERT INTO session_completion_revisions (" +
      "completion_revision_id, session_id, guild_id, revision_number, " +
      "result, actual_dm_user_id, earned_timezone, confirmed_by_user_id, " +
      "confirmed_at, reason, is_current, created_at) " +
      "VALUES (?, ?, ?, 1, 'completed', ?, 'America/Denver', ?, ?, ?, 1, ?)",
    ).bind(
      revisionId,
      sessionId,
      guildId,
      memberId,
      adminId,
      NOW - 400,
      SECRET_TEXT,
      NOW - 400,
    ),
    env.DB.prepare(
      "INSERT INTO session_completion_events (session_event_id, session_id, " +
      "guild_id, completion_revision_id, idempotency_key, action, " +
      "actor_user_id, subject_user_id, details_json, occurred_at) " +
      "VALUES (?, ?, ?, ?, ?, 'reward_synced', ?, ?, ?, ?)",
    ).bind(
      sessionEventId,
      sessionId,
      guildId,
      revisionId,
      prefix + ":session-idempotency",
      adminId,
      memberId,
      JSON.stringify({ note: SECRET_TEXT }),
      NOW - 300,
    ),
  ]);

  const priority = new PriorityRepository(env.DB, () => NOW - 200);
  const granted = await priority.grantCompletedSessionReward({
    grantId,
    creditIds: [firstCreditId, secondCreditId],
    guildId,
    completionRevisionId: revisionId,
    sourceEventId,
    sourcePlanId,
    sourceTableId,
    dmUserId: memberId,
    policyVersion: "dm-priority-v1",
    earnedTimeZone: "America/Denver",
    earnedAt: NOW - 400,
    expiresAt: NOW + 10 * 86_400_000,
    grantedByUserId: adminId,
    idempotencyKey: prefix + ":grant-idempotency",
  });
  const reserved = await priority.reserveNextCredit({
    creditEventId: prefix + ":reserve-event",
    guildId,
    userId: memberId,
    targetEventId,
    reservedAt: NOW - 100,
    actorUserId: memberId,
    idempotencyKey: prefix + ":reserve-idempotency",
  });
  if (!reserved) throw new Error("Expected the fixture credit reservation");

  await env.DB.batch([
    env.DB.prepare(
      "UPDATE dm_priority_credit_events SET reason = ? " +
      "WHERE guild_id = ? AND credit_event_id = ?",
    ).bind(SECRET_TEXT, guildId, reserved.event.creditEventId),
    env.DB.prepare(
      "INSERT INTO assignments (assignment_id, plan_id, table_id, " +
      "desired_table_id, user_id, display_name, status, assigned_at, " +
      "updated_at, table_requested_at, priority_requested_at, " +
      "priority_credit_id, seat_request_version) " +
      "VALUES (?, ?, ?, ?, ?, 'Member display', 'assigned', ?, ?, ?, ?, ?, 1)",
    ).bind(
      assignmentId,
      targetPlanId,
      targetTableId,
      targetTableId,
      memberId,
      NOW - 100,
      NOW - 100,
      NOW - 100,
      NOW - 100,
      reserved.credit.creditId,
    ),
    env.DB.prepare(
      "INSERT INTO assignments (assignment_id, plan_id, desired_table_id, " +
      "user_id, display_name, status, waitlist_position, updated_at, " +
      "table_requested_at, seat_request_version) " +
      "VALUES (?, ?, ?, ?, 'Other member display', 'waitlisted', 1, ?, ?, 1)",
    ).bind(
      otherAssignmentId,
      targetPlanId,
      targetTableId,
      otherMemberId,
      NOW - 90,
      NOW - 200,
    ),
    env.DB.prepare(
      "INSERT INTO priority_seating_operations (guild_id, operation_key, " +
      "operation_kind, event_id, plan_id, target_table_id, assignment_id, " +
      "user_id, actor_user_id, reason, selected_credit_id, previous_status, " +
      "previous_seat_request_version, occurred_at, completed_at) " +
      "VALUES (?, ?, 'select_priority', ?, ?, ?, ?, ?, ?, ?, ?, " +
      "'unassigned', 0, ?, ?)",
    ).bind(
      guildId,
      operationKey,
      targetEventId,
      targetPlanId,
      targetTableId,
      assignmentId,
      memberId,
      memberId,
      SECRET_TEXT,
      reserved.credit.creditId,
      NOW - 80,
      NOW - 80,
    ),
    env.DB.prepare(
      "INSERT INTO priority_seating_operation_members (guild_id, " +
      "operation_key, assignment_id, user_id, status, " +
      "seat_request_version) VALUES (?, ?, ?, ?, 'unassigned', 0)",
    ).bind(guildId, operationKey, assignmentId, memberId),
    env.DB.prepare(
      "INSERT INTO priority_seating_operation_members (guild_id, " +
      "operation_key, assignment_id, user_id, table_id, desired_table_id, " +
      "status, seat_request_version) VALUES (?, ?, ?, ?, ?, ?, " +
      "'assigned', 1)",
    ).bind(
      guildId,
      operationKey,
      otherAssignmentId,
      otherMemberId,
      targetTableId,
      targetTableId,
    ),
    env.DB.prepare(
      "INSERT INTO priority_seating_events (seating_event_id, guild_id, " +
      "operation_key, event_id, plan_id, table_id, assignment_id, user_id, " +
      "priority_credit_id, action, reason_code, from_status, to_status, " +
      "actor_user_id, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, " +
      "'priority_requested', 'member_priority_request', 'unassigned', " +
      "'assigned', ?, ?)",
    ).bind(
      seatingEventId,
      guildId,
      operationKey,
      targetEventId,
      targetPlanId,
      targetTableId,
      assignmentId,
      memberId,
      reserved.credit.creditId,
      memberId,
      NOW - 80,
    ),
    env.DB.prepare(
      "INSERT INTO priority_seating_events (seating_event_id, guild_id, " +
      "operation_key, event_id, plan_id, table_id, assignment_id, user_id, " +
      "action, reason_code, from_status, to_status, to_waitlist_position, " +
      "actor_user_id, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, " +
      "'displaced', 'dm_priority_displacement', 'assigned', 'waitlisted', " +
      "1, ?, ?)",
    ).bind(
      otherSeatingEventId,
      guildId,
      operationKey,
      targetEventId,
      targetPlanId,
      targetTableId,
      otherAssignmentId,
      otherMemberId,
      memberId,
      NOW - 80,
    ),
    env.DB.prepare(
      "INSERT INTO priority_notification_outbox (notification_id, guild_id, " +
      "recipient_user_id, notification_kind, source_kind, source_id, " +
      "credit_id, event_id, assignment_id, template_revision, " +
      "config_revision, content, scheduled_for, idempotency_key, " +
      "discord_nonce, status, created_at, updated_at) VALUES (?, ?, ?, " +
      "'seat_promoted', 'seating_event', ?, ?, ?, ?, " +
      "'dm-priority-notifications-v1', 1, ?, ?, ?, 'nonce-member', " +
      "'pending', ?, ?)",
    ).bind(
      prefix + ":notification",
      guildId,
      memberId,
      seatingEventId,
      reserved.credit.creditId,
      targetEventId,
      assignmentId,
      SECRET_TEXT,
      NOW - 70,
      prefix + ":notification-key",
      NOW - 70,
      NOW - 70,
    ),
    env.DB.prepare(
      "INSERT INTO priority_notification_outbox (notification_id, guild_id, " +
      "recipient_user_id, notification_kind, source_kind, source_id, " +
      "event_id, template_revision, config_revision, content, scheduled_for, " +
      "idempotency_key, discord_nonce, status, created_at, updated_at) " +
      "VALUES (?, ?, ?, 'seat_displaced', 'seating_event', ?, ?, " +
      "'dm-priority-notifications-v1', 1, ?, ?, ?, 'nonce-other', " +
      "'pending', ?, ?)",
    ).bind(
      prefix + ":other-notification",
      guildId,
      otherMemberId,
      otherSeatingEventId,
      targetEventId,
      SECRET_TEXT,
      NOW - 60,
      prefix + ":other-notification-key",
      NOW - 60,
      NOW - 60,
    ),
    env.DB.prepare(
      "INSERT INTO priority_notification_outbox (notification_id, guild_id, " +
      "recipient_user_id, notification_kind, source_kind, source_id, " +
      "template_revision, config_revision, content, scheduled_for, " +
      "idempotency_key, discord_nonce, status, created_at, updated_at) " +
      "VALUES (?, ?, ?, 'credit_expiring', 'credit', ?, " +
      "'dm-priority-notifications-v1', 1, ?, ?, ?, 'nonce-tenant', " +
      "'pending', ?, ?)",
    ).bind(
      prefix + ":tenant-notification",
      otherGuildId,
      prefix + ":tenant-member",
      prefix + ":tenant-credit",
      SECRET_TEXT,
      NOW - 50,
      prefix + ":tenant-notification-key",
      NOW - 50,
      NOW - 50,
    ),
  ]);

  expect(granted.credits).toHaveLength(2);
  return {
    guildId,
    otherGuildId,
    memberId,
    otherMemberId,
    adminId,
    grantId,
    refundCreditId: reserved.credit.creditId,
    sourceEventId,
    targetEventId,
    assignmentId,
  };
}

describe("priority diagnostics D1 projection", () => {
  it("isolates tenants, redacts persisted text, and hides other members", async () => {
    const fixture = await seedDiagnosticsFixture();
    const diagnostics = new PriorityDiagnosticsService(env.DB, () => NOW);

    const member = await diagnostics.member(
      fixture.guildId,
      fixture.memberId,
      100,
    );
    expect(member.counts).toMatchObject({
      guildExists: true,
      sessions: { total: 1, revisions: 1, events: 1 },
      grants: { total: 1 },
      credits: { total: 2 },
      seating: { operations: 1, events: 1 },
      notifications: { total: 1 },
    });
    expect(member.ledgerReferences).toEqual({
      correctGrantIds: [fixture.grantId],
      refundCreditIds: [fixture.refundCreditId],
      truncated: false,
    });
    expect(member.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          area: "grant",
          policyRevision: "dm-priority-v1",
          revision: 1,
          subject: "self",
          actor: "external",
        }),
        expect.objectContaining({
          area: "seating",
          action: "priority_requested",
          operationRevision: 0,
          subject: "self",
        }),
        expect.objectContaining({
          area: "notification",
          status: "pending",
          configRevision: 1,
          subject: "self",
        }),
      ]),
    );

    const serialized = JSON.stringify(member);
    for (const forbidden of [
      fixture.guildId,
      fixture.otherGuildId,
      fixture.memberId,
      fixture.otherMemberId,
      fixture.adminId,
      SECRET_TEXT,
      "contains-private-input",
      "<@999>",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(member.trace.every((row) => row.actor === "self" ||
      row.actor === "external" || row.actor === "system")).toBe(true);

    const guild = await diagnostics.guild(fixture.guildId, 100);
    expect(guild.counts.notifications.total).toBe(2);
    const otherGuild = await diagnostics.guild(fixture.otherGuildId, 100);
    expect(otherGuild.counts.notifications.total).toBe(1);
    expect(otherGuild.ledgerReferences).toEqual({
      correctGrantIds: [],
      refundCreditIds: [],
      truncated: false,
    });

    const targetEvent = await diagnostics.event(
      fixture.guildId,
      fixture.targetEventId,
      100,
    );
    expect(targetEvent.counts).toMatchObject({
      credits: { total: 1 },
      seating: { operations: 1, events: 2 },
      notifications: { total: 2 },
    });
    const sourceEvent = await diagnostics.event(
      fixture.guildId,
      fixture.sourceEventId,
      100,
    );
    expect(sourceEvent.counts).toMatchObject({
      sessions: { total: 1, revisions: 1 },
      grants: { total: 1 },
      credits: { total: 2 },
    });

    const rendered = renderPriorityDiagnostics(member);
    expect(rendered.length).toBeLessThanOrEqual(1_900);
    expect(rendered).toContain("actor:external");
    expect(rendered).not.toContain(SECRET_TEXT);
    expect(rendered).not.toContain(fixture.memberId);
    expect(rendered).toContain("grant_id: `" + fixture.grantId + "`");
    expect(rendered).toContain(
      "credit_id: `" + fixture.refundCreditId + "`",
    );

    const redeemed = await new PriorityRepository(env.DB, () => NOW)
      .redeemReservedCredit({
        creditEventId: fixture.refundCreditId + ":redeemed-event",
        guildId: fixture.guildId,
        userId: fixture.memberId,
        creditId: fixture.refundCreditId,
        targetEventId: fixture.targetEventId,
        targetAssignmentId: fixture.assignmentId,
        redeemedAt: NOW,
        actorUserId: fixture.adminId,
        idempotencyKey: fixture.refundCreditId + ":redeem-operation",
      });
    expect(redeemed?.credit.status).toBe("redeemed");
    const afterRedemption = await diagnostics.member(
      fixture.guildId,
      fixture.memberId,
      100,
    );
    expect(afterRedemption.ledgerReferences.refundCreditIds).toEqual([
      fixture.refundCreditId,
    ]);
  });
});
