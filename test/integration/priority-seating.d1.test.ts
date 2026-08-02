import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { PriorityRepository } from "../../src/storage/priority-repository";
import { PriorityNotificationRepository } from "../../src/storage/priority-notification-repository";
import {
  PrioritySeatingIdempotencyConflictError,
  PrioritySeatingRepository,
  PrioritySeatingUnavailableError,
} from "../../src/storage/priority-seating-repository";

interface SeatingFixture {
  prefix: string;
  guildId: string;
  eventId: string;
  planId: string;
  tableId: string;
  priorityUserId: string;
  standardUserIds: readonly [string, string];
  now: number;
  closesAt: number;
}

async function seedFixture(capacity = 2): Promise<SeatingFixture> {
  const prefix = crypto.randomUUID();
  const guildId = `${prefix}:guild`;
  const sourceEventId = `${prefix}:source-event`;
  const sourcePlanId = `${prefix}:source-plan`;
  const sourceTableId = `${prefix}:source-table`;
  const eventId = `${prefix}:event`;
  const planId = `${prefix}:plan`;
  const tableId = `${prefix}:table`;
  const priorityUserId = `${prefix}:priority`;
  const standardUserIds = [
    `${prefix}:standard-a`,
    `${prefix}:standard-b`,
  ] as const;
  const now = Date.now() + 60_000;
  const closesAt = now + 60_000;
  const startsAt = now + 120_000;

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO guild_config (guild_id, timezone) VALUES (?, 'America/Denver')",
    ).bind(guildId),
    env.DB.prepare(
      `INSERT INTO weekly_events (
         event_id, guild_id, title, starts_at, ends_at, signup_opens_at,
         signup_locks_at, table_selection_closes_at, status, archived_at
       ) VALUES (?, ?, 'Source', ?, ?, ?, ?, ?, 'archived', ?)`,
    ).bind(
      sourceEventId,
      guildId,
      now - 1_000_000,
      now - 900_000,
      now - 1_200_000,
      now - 1_100_000,
      now - 900_000,
      now - 900_000,
    ),
    env.DB.prepare(
      `INSERT INTO plans (
         plan_id, event_id, generation, status, algorithm_version,
         min_table_size, preferred_table_size, max_table_size,
         player_count, gm_signup_count, selected_gm_count, published_at
       ) VALUES (?, ?, 1, 'published', 'test', 1, 2, 2, 1, 1, 1, ?)`,
    ).bind(sourcePlanId, sourceEventId, now - 1_100_000),
    env.DB.prepare(
      `INSERT INTO plan_tables (
         table_id, plan_id, table_number, title, capacity,
         gm_user_id, gm_display_name
       ) VALUES (?, ?, 1, 'Source', 2, ?, 'Priority DM')`,
    ).bind(sourceTableId, sourcePlanId, priorityUserId),
    env.DB.prepare(
      `INSERT INTO weekly_events (
         event_id, guild_id, title, starts_at, ends_at, signup_opens_at,
         signup_locks_at, table_selection_closes_at, status, published_at
       ) VALUES (?, ?, 'Target', ?, ?, ?, ?, ?, 'published', ?)`,
    ).bind(
      eventId,
      guildId,
      startsAt,
      startsAt + 60_000,
      now - 200_000,
      now - 100_000,
      closesAt,
      now - 10_000,
    ),
    env.DB.prepare(
      `INSERT INTO plans (
         plan_id, event_id, generation, status, algorithm_version,
         min_table_size, preferred_table_size, max_table_size,
         player_count, gm_signup_count, selected_gm_count, published_at
       ) VALUES (?, ?, 1, 'published', 'test', 1, 2, 2, 3, 1, 1, ?)`,
    ).bind(planId, eventId, now - 10_000),
    env.DB.prepare(
      `INSERT INTO plan_tables (
         table_id, plan_id, table_number, title, capacity,
         gm_user_id, gm_display_name
       ) VALUES (?, ?, 1, 'Target', ?, ?, 'Target DM')`,
    ).bind(tableId, planId, capacity, `${prefix}:target-dm`),
  ]);

  for (const [index, userId] of [priorityUserId, ...standardUserIds].entries()) {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO signups (
           event_id, user_id, display_name, signup_kind, status, signed_up_at
         ) VALUES (?, ?, ?, 'player', 'active', ?)`,
      ).bind(eventId, userId, `Member ${index}`, now - 50_000 + index),
      env.DB.prepare(
        `INSERT INTO assignments (
           assignment_id, plan_id, table_id, desired_table_id, user_id,
           display_name, status, waitlist_position, assigned_at, updated_at,
           table_requested_at, seat_request_version
         ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      ).bind(
        `${prefix}:assignment:${index}`,
        planId,
        index === 0 ? null : tableId,
        index === 0 ? null : tableId,
        userId,
        `Member ${index}`,
        index === 0 ? "unassigned" : "assigned",
        index === 0 ? null : now - 40_000 + index,
        now - 40_000 + index,
        index === 0 ? null : now - 40_000 + index,
        index === 0 ? 0 : 1,
      ),
    ]);
  }

  const priority = new PriorityRepository(env.DB, () => now - 500_000);
  await priority.grantCompletedSessionReward({
    grantId: `${prefix}:grant`,
    creditIds: [`${prefix}:credit-1`, `${prefix}:credit-2`],
    guildId,
    completionRevisionId: `${prefix}:completion`,
    sourceEventId,
    sourcePlanId,
    sourceTableId,
    dmUserId: priorityUserId,
    policyVersion: "dm-priority-v1",
    earnedTimeZone: "America/Denver",
    earnedAt: now - 500_000,
    expiresAt: now + 1_000_000,
    grantedByUserId: `${prefix}:organizer`,
    idempotencyKey: `${prefix}:grant-op`,
  });

  return {
    prefix,
    guildId,
    eventId,
    planId,
    tableId,
    priorityUserId,
    standardUserIds,
    now,
    closesAt,
  };
}

function guardedSelectionInput(fixture: SeatingFixture, operationKey: string) {
  return {
    guildId: fixture.guildId,
    eventId: fixture.eventId,
    planId: fixture.planId,
    tableId: fixture.tableId,
    userId: fixture.priorityUserId,
    actorUserId: fixture.priorityUserId,
    operationKey,
    expectedAssignmentId: `${fixture.prefix}:assignment:0`,
    expectedSeatRequestVersion: 0,
    expectedTableStateVersion: 0,
    expectedCreditId: `${fixture.prefix}:credit-1`,
  };
}

async function expectNoPriorityMutation(
  fixture: SeatingFixture,
  operationKey: string,
): Promise<void> {
  const state = await env.DB.prepare(
    `SELECT
       (SELECT count(*) FROM priority_seating_operations
        WHERE guild_id = ? AND operation_key = ?) AS operation_count,
       (SELECT count(*) FROM priority_seating_events
        WHERE guild_id = ? AND operation_key = ?) AS event_count,
       (SELECT count(*) FROM dm_priority_credits
        WHERE guild_id = ? AND status = 'reserved') AS reserved_count,
       (SELECT count(*) FROM assignments
        WHERE plan_id = ? AND table_id = ? AND status = 'assigned') AS assigned_count,
       (SELECT count(*) FROM assignments
        WHERE plan_id = ? AND user_id = ? AND status = 'unassigned'
          AND table_id IS NULL AND priority_credit_id IS NULL) AS requester_unchanged_count`,
  ).bind(
    fixture.guildId,
    operationKey,
    fixture.guildId,
    operationKey,
    fixture.guildId,
    fixture.planId,
    fixture.tableId,
    fixture.planId,
    fixture.priorityUserId,
  ).first<{
    operation_count: number;
    event_count: number;
    reserved_count: number;
    assigned_count: number;
    requester_unchanged_count: number;
  }>();
  expect(state).toEqual({
    operation_count: 0,
    event_count: 0,
    reserved_count: 0,
    assigned_count: 2,
    requester_unchanged_count: 1,
  });
}

const staleConfirmationScenarios: Array<{
  label: string;
  mutate(fixture: SeatingFixture): Promise<unknown>;
}> = [
  {
    label: "table-state version",
    mutate: (fixture) => env.DB.prepare(
      `UPDATE weekly_events SET table_state_version = table_state_version + 1
       WHERE event_id = ? AND guild_id = ?`,
    ).bind(fixture.eventId, fixture.guildId).run(),
  },
  {
    label: "assignment identity",
    mutate: (fixture) => env.DB.prepare(
      "UPDATE assignments SET assignment_id = ? WHERE assignment_id = ?",
    ).bind(
      `${fixture.prefix}:replacement-assignment`,
      `${fixture.prefix}:assignment:0`,
    ).run(),
  },
  {
    label: "assignment request version",
    mutate: (fixture) => env.DB.prepare(
      `UPDATE assignments SET seat_request_version = seat_request_version + 1
       WHERE assignment_id = ?`,
    ).bind(`${fixture.prefix}:assignment:0`).run(),
  },
  {
    label: "exact credit",
    mutate: (fixture) => env.DB.prepare(
      `UPDATE dm_priority_credits
       SET status = 'expired', version = version + 1, updated_at = ?
       WHERE guild_id = ? AND credit_id = ?`,
    ).bind(fixture.now, fixture.guildId, `${fixture.prefix}:credit-1`).run(),
  },
];

describe("priority seating D1 transactions", () => {
  it("atomically reserves, assigns, displaces, and replays from persisted results", async () => {
    const fixture = await seedFixture();
    const repository = new PrioritySeatingRepository(env.DB, () => fixture.now);
    const input = {
      guildId: fixture.guildId,
      eventId: fixture.eventId,
      planId: fixture.planId,
      tableId: fixture.tableId,
      userId: fixture.priorityUserId,
      actorUserId: fixture.priorityUserId,
      operationKey: `${fixture.prefix}:priority-select`,
      expectedAssignmentId: `${fixture.prefix}:assignment:0`,
      expectedSeatRequestVersion: 0,
      expectedTableStateVersion: 0,
      expectedCreditId: `${fixture.prefix}:credit-1`,
    };

    const first = await repository.selectTableWithPriority(input);
    const replay = await repository.selectTableWithPriority(input);

    expect(first).toMatchObject({
      applied: true,
      replayed: false,
      assignment: {
        userId: fixture.priorityUserId,
        status: "assigned",
        priorityRequestedAt: fixture.now,
      },
    });
    expect(first.displaced.map((item) => item.userId)).toEqual([
      fixture.standardUserIds[1],
    ]);
    expect(first.displaced[0]).toMatchObject({
      status: "waitlisted",
      waitlistPosition: 1,
    });
    expect(replay).toMatchObject({ applied: false, replayed: true });
    expect(replay.assignment?.tableRequestedAt).toBe(first.assignment?.tableRequestedAt);
    expect(replay.assignment?.priorityRequestedAt).toBe(
      first.assignment?.priorityRequestedAt,
    );
    await expect(repository.selectTableWithPriority({
      ...input,
      actorUserId: `${fixture.prefix}:different-actor`,
    })).rejects.toBeInstanceOf(PrioritySeatingIdempotencyConflictError);
    await expect(repository.selectStandardTable({
      ...input,
      operationKey: `${fixture.prefix}:implicit-priority-release`,
    })).rejects.toBeInstanceOf(PrioritySeatingUnavailableError);

    const state = await env.DB.prepare(
      `SELECT
         (SELECT count(*) FROM assignments
          WHERE plan_id = ? AND table_id = ? AND status = 'assigned') assigned_count,
         (SELECT count(*) FROM dm_priority_credits
          WHERE guild_id = ? AND status = 'reserved') reserved_count,
         (SELECT count(*) FROM priority_seating_events
          WHERE guild_id = ? AND operation_key = ?) event_count,
         (SELECT table_state_version FROM weekly_events
          WHERE event_id = ?) table_state_version`,
    ).bind(
      fixture.planId,
      fixture.tableId,
      fixture.guildId,
      fixture.guildId,
      input.operationKey,
      fixture.eventId,
    ).first<{
      assigned_count: number;
      reserved_count: number;
      event_count: number;
      table_state_version: number;
    }>();
    expect(state).toEqual({
      assigned_count: 2,
      reserved_count: 1,
      event_count: 2,
      table_state_version: 1,
    });
  });

  it("names the destination displacement and origin promotion in a cross-table move", async () => {
    const fixture = await seedFixture();
    const alternateTableId = `${fixture.prefix}:alternate-table`;
    const displacedUserId = fixture.standardUserIds[1];
    const promotedUserId = `${fixture.prefix}:origin-waitlist`;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO plan_tables (
           table_id, plan_id, table_number, title, capacity,
           gm_user_id, gm_display_name
         ) VALUES (?, ?, 2, 'Alternate table', 1, ?, 'Alternate DM')`,
      ).bind(
        alternateTableId,
        fixture.planId,
        `${fixture.prefix}:alternate-dm`,
      ),
      env.DB.prepare(
        `UPDATE assignments
         SET table_id = ?, desired_table_id = ?, status = 'assigned',
             waitlist_position = NULL, assigned_at = ?, table_requested_at = ?,
             updated_at = ?, seat_request_version = 1
         WHERE plan_id = ? AND user_id = ?`,
      ).bind(
        fixture.tableId,
        fixture.tableId,
        fixture.now - 60_000,
        fixture.now - 60_000,
        fixture.now - 60_000,
        fixture.planId,
        fixture.priorityUserId,
      ),
      env.DB.prepare(
        `UPDATE assignments
         SET table_id = ?, desired_table_id = ?
         WHERE plan_id = ? AND user_id = ?`,
      ).bind(alternateTableId, alternateTableId, fixture.planId, displacedUserId),
      env.DB.prepare(
        `INSERT INTO signups (
           event_id, user_id, display_name, signup_kind, status, signed_up_at
         ) VALUES (?, ?, 'Origin waitlist', 'player', 'active', ?)`,
      ).bind(fixture.eventId, promotedUserId, fixture.now - 70_000),
      env.DB.prepare(
        `INSERT INTO assignments (
           assignment_id, plan_id, table_id, desired_table_id, user_id,
           display_name, status, waitlist_position, updated_at,
           table_requested_at, seat_request_version
         ) VALUES (?, ?, NULL, ?, ?, 'Origin waitlist', 'waitlisted', 1, ?, ?, 1)`,
      ).bind(
        `${fixture.prefix}:origin-waitlist-assignment`,
        fixture.planId,
        fixture.tableId,
        promotedUserId,
        fixture.now - 50_000,
        fixture.now - 50_000,
      ),
    ]);

    const repository = new PrioritySeatingRepository(env.DB, () => fixture.now);
    const selectionKey = `${fixture.prefix}:cross-table-select`;
    const selected = await repository.selectTableWithPriority({
      guildId: fixture.guildId,
      eventId: fixture.eventId,
      planId: fixture.planId,
      tableId: alternateTableId,
      userId: fixture.priorityUserId,
      actorUserId: fixture.priorityUserId,
      operationKey: selectionKey,
    });
    const displaced = selected.events.find(
      (event) => event.action === "displaced" && event.userId === displacedUserId,
    );
    expect(displaced).toMatchObject({
      tableId: alternateTableId,
      fromStatus: "assigned",
      toStatus: "waitlisted",
    });
    const promoted = selected.events.find(
      (event) => event.action === "promoted" && event.userId === promotedUserId,
    );
    expect(promoted).toMatchObject({
      tableId: fixture.tableId,
      fromStatus: "waitlisted",
      toStatus: "assigned",
    });

    const notificationRepository = new PriorityNotificationRepository(env.DB);
    const candidates = await notificationRepository.listSeatingCandidates(
      "dm-priority-notifications-v1",
      20,
    );
    expect(
      candidates.find((candidate) => candidate.sourceId === displaced?.seatingEventId),
    ).toMatchObject({
      action: "displaced",
      recipientUserId: displacedUserId,
      tableTitle: "Alternate table",
    });
    expect(
      candidates.find((candidate) => candidate.sourceId === promoted?.seatingEventId),
    ).toMatchObject({
      action: "promoted",
      recipientUserId: promotedUserId,
      tableTitle: "Target",
    });
  });

  it.each(staleConfirmationScenarios)(
    "rejects a stale $label before reserving a token or displacing a member",
    async ({ label, mutate }) => {
      const fixture = await seedFixture();
      const repository = new PrioritySeatingRepository(env.DB, () => fixture.now);
      const operationKey = `${fixture.prefix}:stale:${label}`;
      const input = guardedSelectionInput(fixture, operationKey);
      await mutate(fixture);

      await expect(repository.selectTableWithPriority(input))
        .rejects.toBeInstanceOf(PrioritySeatingUnavailableError);
      await expectNoPriorityMutation(fixture, operationKey);
    },
  );

  it("releases priority without losing the original standard request time", async () => {
    const fixture = await seedFixture();
    const repository = new PrioritySeatingRepository(env.DB, () => fixture.now);
    const selected = await repository.selectTableWithPriority({
      guildId: fixture.guildId,
      eventId: fixture.eventId,
      planId: fixture.planId,
      tableId: fixture.tableId,
      userId: fixture.priorityUserId,
      actorUserId: fixture.priorityUserId,
      operationKey: `${fixture.prefix}:select`,
    });
    const originalRequest = selected.assignment?.tableRequestedAt;

    const released = await repository.releasePriority({
      guildId: fixture.guildId,
      eventId: fixture.eventId,
      planId: fixture.planId,
      userId: fixture.priorityUserId,
      actorUserId: fixture.priorityUserId,
      reason: "Member chose ordinary seating",
      operationKey: `${fixture.prefix}:release`,
    });

    expect(released.assignment).toMatchObject({
      status: "waitlisted",
      priorityRequestedAt: null,
      priorityCreditId: null,
      tableRequestedAt: originalRequest,
      waitlistPosition: 1,
    });
    expect(released.promoted.map((item) => item.userId)).toEqual([
      fixture.standardUserIds[1],
    ]);
    expect(
      await env.DB.prepare(
        `SELECT count(*) AS count FROM dm_priority_credits
         WHERE guild_id = ? AND status = 'available'`,
      ).bind(fixture.guildId).first<{ count: number }>(),
    ).toEqual({ count: 2 });
  });

  it("settles assigned priority as redeemed and releases unseated priority", async () => {
    const fixture = await seedFixture(1);
    let clock = fixture.now;
    const repository = new PrioritySeatingRepository(env.DB, () => clock);
    const secondPriorityUser = `${fixture.prefix}:priority-a`;

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO signups (
           event_id, user_id, display_name, signup_kind, status, signed_up_at
         ) VALUES (?, ?, 'Second priority', 'player', 'active', ?)`,
      ).bind(fixture.eventId, secondPriorityUser, fixture.now - 10),
      env.DB.prepare(
        `INSERT INTO assignments (
           assignment_id, plan_id, user_id, display_name, status, updated_at
         ) VALUES (?, ?, ?, 'Second priority', 'unassigned', ?)`,
      ).bind(
        `${fixture.prefix}:second-priority-assignment`,
        fixture.planId,
        secondPriorityUser,
        fixture.now,
      ),
      env.DB.prepare(
        `INSERT INTO plan_tables (
           table_id, plan_id, table_number, title, capacity,
           gm_user_id, gm_display_name
         ) VALUES (?, ?, 2, 'Second source', 2, ?, 'Second priority')`,
      ).bind(
        `${fixture.prefix}:source-table-2`,
        `${fixture.prefix}:source-plan`,
        secondPriorityUser,
      ),
    ]);
    const priority = new PriorityRepository(env.DB, () => fixture.now - 400_000);
    await priority.grantCompletedSessionReward({
      grantId: `${fixture.prefix}:second-grant`,
      creditIds: [
        `${fixture.prefix}:second-credit-1`,
        `${fixture.prefix}:second-credit-2`,
      ],
      guildId: fixture.guildId,
      completionRevisionId: `${fixture.prefix}:second-completion`,
      sourceEventId: `${fixture.prefix}:source-event`,
      sourcePlanId: `${fixture.prefix}:source-plan`,
      sourceTableId: `${fixture.prefix}:source-table-2`,
      dmUserId: secondPriorityUser,
      policyVersion: "dm-priority-v1",
      earnedTimeZone: "America/Denver",
      earnedAt: fixture.now - 400_000,
      expiresAt: fixture.now + 1_000_000,
      grantedByUserId: `${fixture.prefix}:organizer`,
      idempotencyKey: `${fixture.prefix}:second-grant-op`,
    });

    await Promise.all([
      repository.selectTableWithPriority({
        guildId: fixture.guildId,
        eventId: fixture.eventId,
        planId: fixture.planId,
        tableId: fixture.tableId,
        userId: fixture.priorityUserId,
        actorUserId: fixture.priorityUserId,
        operationKey: `${fixture.prefix}:first-priority`,
      }),
      repository.selectTableWithPriority({
        guildId: fixture.guildId,
        eventId: fixture.eventId,
        planId: fixture.planId,
        tableId: fixture.tableId,
        userId: secondPriorityUser,
        actorUserId: secondPriorityUser,
        operationKey: `${fixture.prefix}:second-priority`,
      }),
    ]);

    clock = fixture.closesAt;
    const settled = await repository.settleEvent({
      guildId: fixture.guildId,
      eventId: fixture.eventId,
      planId: fixture.planId,
      operationKey: `${fixture.prefix}:settle`,
    });
    const replay = await repository.settleEvent({
      guildId: fixture.guildId,
      eventId: fixture.eventId,
      planId: fixture.planId,
      operationKey: `${fixture.prefix}:settle`,
    });

    expect(settled.applied).toBe(true);
    expect(replay.replayed).toBe(true);
    const creditStates = await env.DB.prepare(
      `SELECT status, count(*) AS count FROM dm_priority_credits
       WHERE guild_id = ? GROUP BY status ORDER BY status`,
    ).bind(fixture.guildId).all<{ status: string; count: number }>();
    expect(creditStates.results).toEqual([
      { status: "available", count: 3 },
      { status: "redeemed", count: 1 },
    ]);
    expect(
      await env.DB.prepare(
        `SELECT count(*) AS count FROM assignments
         WHERE plan_id = ? AND status = 'assigned'`,
      ).bind(fixture.planId).first<{ count: number }>(),
    ).toEqual({ count: 1 });
    const positions = await env.DB.prepare(
      `SELECT waitlist_position FROM assignments
       WHERE plan_id = ? AND status = 'waitlisted'
       ORDER BY waitlist_position`,
    ).bind(fixture.planId).all<{ waitlist_position: number }>();
    expect(positions.results.map((row) => row.waitlist_position)).toEqual([1, 2, 3]);
  });

  it("refunds a redeemed seat on cancellation without erasing its assignment history", async () => {
    const fixture = await seedFixture();
    let clock = fixture.now;
    const repository = new PrioritySeatingRepository(env.DB, () => clock);
    const selected = await repository.selectTableWithPriority({
      guildId: fixture.guildId,
      eventId: fixture.eventId,
      planId: fixture.planId,
      tableId: fixture.tableId,
      userId: fixture.priorityUserId,
      actorUserId: fixture.priorityUserId,
      operationKey: `${fixture.prefix}:select-before-cancel`,
    });
    const creditId = selected.priorityCreditId;
    const assignmentId = selected.assignment?.assignmentId;
    expect(creditId).not.toBeNull();
    expect(assignmentId).toBeTruthy();

    clock = fixture.closesAt;
    await repository.settleEvent({
      guildId: fixture.guildId,
      eventId: fixture.eventId,
      planId: fixture.planId,
      operationKey: `${fixture.prefix}:settle-before-cancel`,
    });
    expect(
      await env.DB.prepare(
        `SELECT status, target_assignment_id FROM dm_priority_credits
         WHERE guild_id = ? AND credit_id = ?`,
      ).bind(fixture.guildId, creditId).first<{
        status: string;
        target_assignment_id: string | null;
      }>(),
    ).toEqual({ status: "redeemed", target_assignment_id: assignmentId });

    clock += 1;
    const cancellation = {
      guildId: fixture.guildId,
      eventId: fixture.eventId,
      planId: fixture.planId,
      actorUserId: `${fixture.prefix}:organizer`,
      reason: "Guild event cancelled",
      operationKey: `${fixture.prefix}:cancel`,
    };
    const cancelled = await repository.cancelEvent(cancellation);
    const replay = await repository.cancelEvent(cancellation);

    expect(cancelled.applied).toBe(true);
    expect(cancelled.events).toHaveLength(1);
    expect(cancelled.events[0]).toMatchObject({
      action: "cancelled",
      assignmentId,
      priorityCreditId: creditId,
    });
    expect(replay.replayed).toBe(true);
    expect(
      await env.DB.prepare(
        `SELECT status, target_event_id, target_assignment_id
         FROM dm_priority_credits WHERE guild_id = ? AND credit_id = ?`,
      ).bind(fixture.guildId, creditId).first<{
        status: string;
        target_event_id: string | null;
        target_assignment_id: string | null;
      }>(),
    ).toEqual({
      status: "available",
      target_event_id: null,
      target_assignment_id: null,
    });
    expect(
      await env.DB.prepare(
        `SELECT target_assignment_id, from_status, to_status
         FROM dm_priority_credit_events
         WHERE guild_id = ? AND idempotency_key = ?`,
      ).bind(
        fixture.guildId,
        `${cancellation.operationKey}:cancel:${creditId}`,
      ).first<{
        target_assignment_id: string | null;
        from_status: string | null;
        to_status: string;
      }>(),
    ).toEqual({
      target_assignment_id: assignmentId,
      from_status: "redeemed",
      to_status: "available",
    });
  });
});
