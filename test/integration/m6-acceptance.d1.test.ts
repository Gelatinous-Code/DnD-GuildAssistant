import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { PriorityNotificationService } from "../../src/priority-notification-service";
import { PriorityService } from "../../src/priority-service";
import {
  SessionService,
  SessionSourceUnavailableError,
} from "../../src/session-service";
import { PriorityNotificationRepository } from "../../src/storage/priority-notification-repository";
import { PriorityRepository } from "../../src/storage/priority-repository";
import { PrioritySeatingRepository } from "../../src/storage/priority-seating-repository";
import { SessionRepository } from "../../src/storage/session-repository";

const BASE_TIME = Date.parse("2026-08-18T18:00:00Z");

interface AcceptanceFixture {
  prefix: string;
  guildId: string;
  otherGuildId: string;
  adminId: string;
  dmId: string;
  sourceEventId: string;
  sourcePlanId: string;
  sourceTableId: string;
  firstEventId: string;
  firstPlanId: string;
  firstTableId: string;
  firstPriorityAssignmentId: string;
  firstStandardIds: readonly [string, string, string];
  secondEventId: string;
  secondPlanId: string;
  secondTableId: string;
  secondPriorityAssignmentId: string;
  now: number;
  firstClosesAt: number;
  secondClosesAt: number;
}

async function insertPlayer(input: {
  eventId: string;
  planId: string;
  tableId: string;
  assignmentId: string;
  userId: string;
  displayName: string;
  status: "unassigned" | "assigned" | "waitlisted";
  requestedAt: number | null;
  waitlistPosition?: number | null;
}): Promise<void> {
  const assigned = input.status === "assigned";
  const requested = input.status !== "unassigned";
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO signups (
         event_id, user_id, display_name, signup_kind, status, signed_up_at
       ) VALUES (?, ?, ?, 'player', 'active', ?)`,
    ).bind(input.eventId, input.userId, input.displayName, BASE_TIME - 20_000),
    env.DB.prepare(
      `INSERT INTO assignments (
         assignment_id, plan_id, table_id, desired_table_id, user_id,
         display_name, status, waitlist_position, assigned_at, updated_at,
         table_requested_at, seat_request_version
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      input.assignmentId,
      input.planId,
      assigned ? input.tableId : null,
      requested ? input.tableId : null,
      input.userId,
      input.displayName,
      input.status,
      input.waitlistPosition ?? null,
      assigned ? input.requestedAt : null,
      BASE_TIME - 10_000,
      input.requestedAt,
      requested ? 1 : 0,
    ),
  ]);
}

async function seedAcceptanceFixture(): Promise<AcceptanceFixture> {
  const prefix = crypto.randomUUID();
  const fixture: AcceptanceFixture = {
    prefix,
    guildId: `${prefix}:guild`,
    otherGuildId: `${prefix}:other-guild`,
    adminId: `${prefix}:admin`,
    dmId: `${prefix}:dm`,
    sourceEventId: `${prefix}:source-event`,
    sourcePlanId: `${prefix}:source-plan`,
    sourceTableId: `${prefix}:source-table`,
    firstEventId: `${prefix}:first-event`,
    firstPlanId: `${prefix}:first-plan`,
    firstTableId: `${prefix}:first-table`,
    firstPriorityAssignmentId: `${prefix}:first-priority-assignment`,
    firstStandardIds: [
      `${prefix}:standard-a`,
      `${prefix}:standard-b`,
      `${prefix}:standard-c`,
    ],
    secondEventId: `${prefix}:second-event`,
    secondPlanId: `${prefix}:second-plan`,
    secondTableId: `${prefix}:second-table`,
    secondPriorityAssignmentId: `${prefix}:second-priority-assignment`,
    now: BASE_TIME,
    firstClosesAt: BASE_TIME + 10_000,
    secondClosesAt: BASE_TIME + 30_000,
  };
  const sourceStartsAt = BASE_TIME - 4 * 60 * 60 * 1_000;
  const sourceEndsAt = BASE_TIME - 1_000;

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO guild_config (guild_id, timezone) VALUES (?, 'America/Denver')",
    ).bind(fixture.guildId),
    env.DB.prepare(
      "INSERT INTO guild_config (guild_id, timezone) VALUES (?, 'UTC')",
    ).bind(fixture.otherGuildId),
    env.DB.prepare(
      `INSERT INTO weekly_events (
         event_id, guild_id, title, starts_at, ends_at, signup_opens_at,
         signup_locks_at, status, table_selection_closes_at,
         final_manifest_channel_id, final_manifest_message_id,
         table_state_version, finalized_plan_id, finalized_table_state_version,
         tables_finalized_at, archived_at
       ) VALUES (
         ?, ?, 'Completed source game', ?, ?, ?, ?, 'archived', ?,
         'manifest-channel', 'manifest-message', 1, ?, 1, ?, ?
       )`,
    ).bind(
      fixture.sourceEventId,
      fixture.guildId,
      sourceStartsAt,
      sourceEndsAt,
      sourceStartsAt - 7 * 24 * 60 * 60 * 1_000,
      sourceStartsAt - 24 * 60 * 60 * 1_000,
      sourceStartsAt - 2 * 60 * 60 * 1_000,
      fixture.sourcePlanId,
      sourceEndsAt - 2_000,
      sourceEndsAt,
    ),
    env.DB.prepare(
      `INSERT INTO plans (
         plan_id, event_id, generation, status, algorithm_version,
         min_table_size, preferred_table_size, max_table_size,
         player_count, gm_signup_count, selected_gm_count, published_at
       ) VALUES (?, ?, 1, 'published', 'm6-acceptance', 1, 2, 3, 1, 1, 1, ?)`,
    ).bind(fixture.sourcePlanId, fixture.sourceEventId, sourceStartsAt - 3_000),
    env.DB.prepare(
      `INSERT INTO plan_tables (
         table_id, plan_id, table_number, title, capacity,
         gm_user_id, gm_display_name
       ) VALUES (?, ?, 1, 'Source Table', 3, ?, 'Acceptance DM')`,
    ).bind(fixture.sourceTableId, fixture.sourcePlanId, fixture.dmId),
    env.DB.prepare(
      `INSERT INTO assignments (
         assignment_id, plan_id, table_id, desired_table_id, user_id,
         display_name, status, assigned_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'Source Player', 'assigned', ?, ?)`,
    ).bind(
      `${prefix}:source-player-assignment`,
      fixture.sourcePlanId,
      fixture.sourceTableId,
      fixture.sourceTableId,
      `${prefix}:source-player`,
      sourceStartsAt - 2_000,
      sourceStartsAt - 2_000,
    ),
    env.DB.prepare(
      `INSERT INTO weekly_events (
         event_id, guild_id, title, starts_at, ends_at, signup_opens_at,
         signup_locks_at, table_selection_closes_at, status, published_at
       ) VALUES (?, ?, 'First target game', ?, ?, ?, ?, ?, 'published', ?)`,
    ).bind(
      fixture.firstEventId,
      fixture.guildId,
      BASE_TIME + 60_000,
      BASE_TIME + 120_000,
      BASE_TIME - 100_000,
      BASE_TIME - 50_000,
      fixture.firstClosesAt,
      BASE_TIME - 10_000,
    ),
    env.DB.prepare(
      `INSERT INTO plans (
         plan_id, event_id, generation, status, algorithm_version,
         min_table_size, preferred_table_size, max_table_size,
         player_count, gm_signup_count, selected_gm_count, published_at
       ) VALUES (?, ?, 1, 'published', 'm6-acceptance', 1, 2, 2, 4, 1, 1, ?)`,
    ).bind(fixture.firstPlanId, fixture.firstEventId, BASE_TIME - 10_000),
    env.DB.prepare(
      `INSERT INTO plan_tables (
         table_id, plan_id, table_number, title, capacity,
         gm_user_id, gm_display_name
       ) VALUES (?, ?, 1, 'First Target', 2, ?, 'First Target DM')`,
    ).bind(fixture.firstTableId, fixture.firstPlanId, `${prefix}:first-target-dm`),
    env.DB.prepare(
      `INSERT INTO weekly_events (
         event_id, guild_id, title, starts_at, ends_at, signup_opens_at,
         signup_locks_at, table_selection_closes_at, status, published_at
       ) VALUES (?, ?, 'Second target game', ?, ?, ?, ?, ?, 'published', ?)`,
    ).bind(
      fixture.secondEventId,
      fixture.guildId,
      BASE_TIME + 120_000,
      BASE_TIME + 180_000,
      BASE_TIME - 100_000,
      BASE_TIME - 50_000,
      fixture.secondClosesAt,
      BASE_TIME - 10_000,
    ),
    env.DB.prepare(
      `INSERT INTO plans (
         plan_id, event_id, generation, status, algorithm_version,
         min_table_size, preferred_table_size, max_table_size,
         player_count, gm_signup_count, selected_gm_count, published_at
       ) VALUES (?, ?, 1, 'published', 'm6-acceptance', 1, 1, 1, 2, 1, 1, ?)`,
    ).bind(fixture.secondPlanId, fixture.secondEventId, BASE_TIME - 10_000),
    env.DB.prepare(
      `INSERT INTO plan_tables (
         table_id, plan_id, table_number, title, capacity,
         gm_user_id, gm_display_name
       ) VALUES (?, ?, 1, 'Second Target', 1, ?, 'Second Target DM')`,
    ).bind(fixture.secondTableId, fixture.secondPlanId, `${prefix}:second-target-dm`),
  ]);

  await insertPlayer({
    eventId: fixture.firstEventId,
    planId: fixture.firstPlanId,
    tableId: fixture.firstTableId,
    assignmentId: fixture.firstPriorityAssignmentId,
    userId: fixture.dmId,
    displayName: "Priority DM",
    status: "unassigned",
    requestedAt: null,
  });
  for (const [index, userId] of fixture.firstStandardIds.entries()) {
    await insertPlayer({
      eventId: fixture.firstEventId,
      planId: fixture.firstPlanId,
      tableId: fixture.firstTableId,
      assignmentId: `${prefix}:first-standard-assignment:${index}`,
      userId,
      displayName: `Standard ${index}`,
      status: index < 2 ? "assigned" : "waitlisted",
      requestedAt: BASE_TIME - 4_000 + index * 1_000,
      waitlistPosition: index === 2 ? 1 : null,
    });
  }
  await insertPlayer({
    eventId: fixture.secondEventId,
    planId: fixture.secondPlanId,
    tableId: fixture.secondTableId,
    assignmentId: fixture.secondPriorityAssignmentId,
    userId: fixture.dmId,
    displayName: "Priority DM",
    status: "unassigned",
    requestedAt: null,
  });
  await insertPlayer({
    eventId: fixture.secondEventId,
    planId: fixture.secondPlanId,
    tableId: fixture.secondTableId,
    assignmentId: `${prefix}:second-standard-assignment`,
    userId: `${prefix}:second-standard`,
    displayName: "Second Standard",
    status: "assigned",
    requestedAt: BASE_TIME - 3_000,
  });
  return fixture;
}

async function stateCounts(guildId: string): Promise<Record<string, number>> {
  const states = await env.DB.prepare(
    `SELECT status, count(*) AS count FROM dm_priority_credits
     WHERE guild_id = ? GROUP BY status ORDER BY status`,
  ).bind(guildId).all<{ status: string; count: number }>();
  return Object.fromEntries(states.results.map((row) => [row.status, row.count]));
}

async function assignedCount(planId: string, tableId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT count(*) AS count FROM assignments
     WHERE plan_id = ? AND table_id = ? AND status = 'assigned'`,
  ).bind(planId, tableId).first<{ count: number }>();
  return row?.count ?? -1;
}

describe("M6 real-D1 acceptance", () => {
  it("carries two earned credits through deterministic seating, expiry, and correction", async () => {
    const fixture = await seedAcceptanceFixture();
    let clock = fixture.now;
    let prioritySequence = 0;
    let sessionSequence = 0;
    const priorities = new PriorityRepository(env.DB, () => clock);
    const priority = new PriorityService(priorities, {
      now: () => clock,
      id: () => `${fixture.prefix}:priority:${++prioritySequence}`,
    });
    const sessions = new SessionRepository(env.DB);
    const session = new SessionService(sessions, priorities, priority, {
      now: () => clock,
      id: () => `${fixture.prefix}:session:${++sessionSequence}`,
    });
    const seating = new PrioritySeatingRepository(env.DB, () => clock);

    const confirmation = {
      guildId: fixture.guildId,
      eventId: fixture.sourceEventId,
      tableNumber: 1,
      result: "completed" as const,
      confirmedByUserId: fixture.adminId,
      idempotencyKey: `${fixture.prefix}:confirm-source`,
    };
    const confirmed = await session.confirmSession(confirmation);
    const confirmationReplay = await session.confirmSession({
      ...confirmation,
      idempotencyKey: `${fixture.prefix}:confirm-source-retry`,
    });
    expect(confirmed).toMatchObject({
      created: true,
      replayed: false,
      revision: { result: "completed", actualDmUserId: fixture.dmId },
      reward: { status: "synced" },
    });
    expect(confirmationReplay).toMatchObject({
      created: false,
      replayed: true,
      revision: { completionRevisionId: confirmed.revision.completionRevisionId },
      reward: { status: "synced" },
    });
    const grant = await priorities.getActiveGrantForSourceTable(
      fixture.guildId,
      fixture.sourceEventId,
      fixture.sourceTableId,
    );
    expect(grant).not.toBeNull();
    expect(await priorities.listCreditsForGrant(fixture.guildId, grant!.grantId))
      .toHaveLength(2);
    expect(await stateCounts(fixture.guildId)).toEqual({ available: 2 });

    const firstSelectionInput = {
      guildId: fixture.guildId,
      eventId: fixture.firstEventId,
      planId: fixture.firstPlanId,
      tableId: fixture.firstTableId,
      userId: fixture.dmId,
      actorUserId: fixture.dmId,
      operationKey: `${fixture.prefix}:first-select`,
    };
    const firstSelection = await seating.selectTableWithPriority(firstSelectionInput);
    const firstSelectionReplay = await seating.selectTableWithPriority(firstSelectionInput);
    expect(firstSelection.displaced.map((assignment) => assignment.userId)).toEqual([
      fixture.firstStandardIds[1],
    ]);
    expect(firstSelectionReplay).toMatchObject({ applied: false, replayed: true });
    expect(await assignedCount(fixture.firstPlanId, fixture.firstTableId)).toBe(2);
    expect(await stateCounts(fixture.guildId)).toEqual({ available: 1, reserved: 1 });

    clock += 1_000;
    const leaveInput = {
      guildId: fixture.guildId,
      eventId: fixture.firstEventId,
      planId: fixture.firstPlanId,
      userId: fixture.firstStandardIds[0],
      actorUserId: fixture.firstStandardIds[0],
      reason: "Member reopened the seat",
      operationKey: `${fixture.prefix}:first-leave`,
    };
    const reopened = await seating.leaveTable(leaveInput);
    const reopenedReplay = await seating.leaveTable(leaveInput);
    expect(reopened.promoted.map((assignment) => assignment.userId)).toEqual([
      fixture.firstStandardIds[1],
    ]);
    expect(reopenedReplay).toMatchObject({ applied: false, replayed: true });
    expect(await assignedCount(fixture.firstPlanId, fixture.firstTableId)).toBe(2);

    clock = fixture.firstClosesAt;
    const firstSettlementInput = {
      guildId: fixture.guildId,
      eventId: fixture.firstEventId,
      planId: fixture.firstPlanId,
      operationKey: `${fixture.prefix}:first-settle`,
    };
    const firstSettlement = await seating.settleEvent(firstSettlementInput);
    const firstSettlementReplay = await seating.settleEvent(firstSettlementInput);
    expect(firstSettlement).toMatchObject({ applied: true, replayed: false });
    expect(firstSettlementReplay).toMatchObject({ applied: false, replayed: true });
    expect(await stateCounts(fixture.guildId)).toEqual({ available: 1, redeemed: 1 });

    const secondSelectionInput = {
      guildId: fixture.guildId,
      eventId: fixture.secondEventId,
      planId: fixture.secondPlanId,
      tableId: fixture.secondTableId,
      userId: fixture.dmId,
      actorUserId: fixture.dmId,
      operationKey: `${fixture.prefix}:second-select`,
    };
    const secondSelection = await seating.selectTableWithPriority(secondSelectionInput);
    expect(secondSelection.displaced).toHaveLength(1);
    expect(await assignedCount(fixture.secondPlanId, fixture.secondTableId)).toBe(1);
    clock = fixture.secondClosesAt;
    const secondSettlementInput = {
      guildId: fixture.guildId,
      eventId: fixture.secondEventId,
      planId: fixture.secondPlanId,
      operationKey: `${fixture.prefix}:second-settle`,
    };
    await seating.settleEvent(secondSettlementInput);
    expect((await seating.settleEvent(secondSettlementInput)).replayed).toBe(true);
    expect(await stateCounts(fixture.guildId)).toEqual({ redeemed: 2 });

    clock += 1;
    const cancellationInput = {
      guildId: fixture.guildId,
      eventId: fixture.secondEventId,
      planId: fixture.secondPlanId,
      actorUserId: fixture.adminId,
      reason: "Second guild game cancelled",
      operationKey: `${fixture.prefix}:second-cancel`,
    };
    const cancellation = await seating.cancelEvent(cancellationInput);
    const cancellationReplay = await seating.cancelEvent(cancellationInput);
    expect(cancellation).toMatchObject({ applied: true, replayed: false });
    expect(cancellationReplay).toMatchObject({ applied: false, replayed: true });
    expect(await stateCounts(fixture.guildId)).toEqual({ available: 1, redeemed: 1 });

    const creditsBeforeExpiry = await priorities.listCreditsForGrant(
      fixture.guildId,
      grant!.grantId,
    );
    clock = creditsBeforeExpiry[0]!.expiresAt;
    expect(await priority.expireDueCredits(fixture.guildId)).toHaveLength(1);
    expect(await priority.expireDueCredits(fixture.guildId)).toEqual([]);
    expect(await stateCounts(fixture.guildId)).toEqual({ expired: 1, redeemed: 1 });

    clock += 1;
    const correctionInput = {
      guildId: fixture.guildId,
      eventId: fixture.sourceEventId,
      tableNumber: 1,
      result: "cancelled" as const,
      confirmedByUserId: fixture.adminId,
      reason: "Organizer audit found that the source table did not run",
      idempotencyKey: `${fixture.prefix}:correct-source`,
    };
    const correction = await session.confirmSession(correctionInput);
    const correctionReplay = await session.confirmSession({
      ...correctionInput,
      idempotencyKey: `${fixture.prefix}:correct-source-retry`,
    });
    expect(correction).toMatchObject({
      created: true,
      replayed: false,
      revision: {
        revisionNumber: 2,
        result: "cancelled",
        supersedesRevisionId: confirmed.revision.completionRevisionId,
      },
      reward: { status: "synced", activeGrant: null },
    });
    expect(correctionReplay).toMatchObject({
      created: false,
      replayed: true,
      revision: { completionRevisionId: correction.revision.completionRevisionId },
    });
    expect(await stateCounts(fixture.guildId)).toEqual({ corrected: 1, expired: 1 });

    const lifecycle = await env.DB.prepare(
      `SELECT action, count(*) AS count FROM dm_priority_credit_events
       WHERE guild_id = ? GROUP BY action ORDER BY action`,
    ).bind(fixture.guildId).all<{ action: string; count: number }>();
    expect(Object.fromEntries(lifecycle.results.map((row) => [row.action, row.count])))
      .toEqual({
        corrected: 1,
        expired: 1,
        granted: 2,
        redeemed: 2,
        refunded: 1,
        reserved: 2,
      });
    const seatingEvents = await env.DB.prepare(
      `SELECT action, count(*) AS count FROM priority_seating_events
       WHERE guild_id = ? GROUP BY action ORDER BY action`,
    ).bind(fixture.guildId).all<{ action: string; count: number }>();
    expect(Object.fromEntries(seatingEvents.results.map((row) => [row.action, row.count])))
      .toMatchObject({
        cancelled: 1,
        displaced: 2,
        left: 1,
        priority_redeemed: 2,
        priority_requested: 2,
        promoted: 3,
      });

    const notificationRepository = new PriorityNotificationRepository(env.DB);
    const notifications = new PriorityNotificationService(
      notificationRepository,
      {
        async createDmChannel() {
          return { id: "unused-dm-channel", type: 1 };
        },
        async sendChannelMessage() {
          throw new Error("Delivery is outside this repair acceptance test");
        },
      },
      { now: () => clock },
    );
    await expect(notifications.repairSeatingNotifications()).resolves.toEqual({
      examined: 5,
      enqueued: 5,
      replayed: 0,
    });
    await expect(notifications.repairSeatingNotifications()).resolves.toEqual({
      examined: 0,
      enqueued: 0,
      replayed: 0,
    });
    const repairedSeatingNotifications = await env.DB.prepare(
      `SELECT notification_kind, count(*) AS count
       FROM priority_notification_outbox
       WHERE guild_id = ? AND source_kind = 'seating_event'
       GROUP BY notification_kind ORDER BY notification_kind`,
    ).bind(fixture.guildId).all<{ notification_kind: string; count: number }>();
    expect(repairedSeatingNotifications.results).toEqual([
      { notification_kind: "seat_displaced", count: 2 },
      { notification_kind: "seat_promoted", count: 3 },
    ]);

    const persisted = await env.DB.prepare(
      `SELECT
         (SELECT count(*) FROM session_completion_revisions
          WHERE guild_id = ?) AS revisions,
         (SELECT count(*) FROM dm_priority_grants
          WHERE guild_id = ?) AS grants,
         (SELECT count(*) FROM dm_priority_grants
          WHERE guild_id = ? AND status = 'corrected'
            AND correction_reason = ?) AS audited_corrections,
         (SELECT count(*) FROM dm_priority_credit_events
          WHERE guild_id = ? AND action = 'redeemed') AS redemptions,
         (SELECT count(DISTINCT credit_id) FROM dm_priority_credit_events
          WHERE guild_id = ? AND action = 'redeemed') AS redeemed_credits`,
    ).bind(
      fixture.guildId,
      fixture.guildId,
      fixture.guildId,
      correctionInput.reason,
      fixture.guildId,
      fixture.guildId,
    ).first<{
      revisions: number;
      grants: number;
      audited_corrections: number;
      redemptions: number;
      redeemed_credits: number;
    }>();
    expect(persisted).toEqual({
      revisions: 2,
      grants: 1,
      audited_corrections: 1,
      redemptions: 2,
      redeemed_credits: 2,
    });

    await expect(
      session.status(fixture.otherGuildId, fixture.sourceEventId, 1),
    ).rejects.toBeInstanceOf(SessionSourceUnavailableError);
    expect(await priorities.listAvailableCredits(
      fixture.otherGuildId,
      fixture.dmId,
      clock,
    )).toEqual([]);
    expect(await seating.getAssignment(
      fixture.otherGuildId,
      fixture.firstPlanId,
      fixture.dmId,
    )).toBeNull();
    expect(await env.DB.prepare(
      "SELECT count(*) AS count FROM dm_priority_credits WHERE guild_id = ?",
    ).bind(fixture.otherGuildId).first<{ count: number }>()).toEqual({ count: 0 });
  });
});
