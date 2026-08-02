import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { runM6Scheduled } from "../../src/m6-app";
import { PriorityRewardCoordinator } from "../../src/priority-reward-coordinator";
import { PriorityService } from "../../src/priority-service";
import { PriorityRepository } from "../../src/storage/priority-repository";
import {
  PrioritySeatingRepository,
  PrioritySeatingUnavailableError,
} from "../../src/storage/priority-seating-repository";

import { GuildRepository } from "../../src/storage/repository";
interface InvariantFixture {
  prefix: string;
  guildId: string;
  eventId: string;
  planId: string;
  tableId: string;
  sourceEventId: string;
  sourcePlanId: string;
  sourceTableId: string;
  priorityUserId: string;
  standardUserId: string;
  priorityAssignmentId: string;
  grantId: string;
  creditId: string;
  now: number;
  closesAt: number;
  expiresAt: number;
}

async function seedInvariantFixture(): Promise<InvariantFixture> {
  const prefix = crypto.randomUUID();
  const guildId = `${prefix}:guild`;
  const sourceEventId = `${prefix}:source-event`;
  const sourcePlanId = `${prefix}:source-plan`;
  const sourceTableId = `${prefix}:source-table`;
  const eventId = `${prefix}:event`;
  const planId = `${prefix}:plan`;
  const tableId = `${prefix}:table`;
  const priorityUserId = `${prefix}:priority`;
  const standardUserId = `${prefix}:standard`;
  const priorityAssignmentId = `${prefix}:priority-assignment`;
  const grantId = `${prefix}:grant`;
  const creditId = `${prefix}:credit-1`;
  const now = Date.now() + 60_000;
  const closesAt = now + 10_000;
  const expiresAt = now + 5_000;

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
      now - 100_000,
      now - 90_000,
      now - 120_000,
      now - 110_000,
      now - 90_000,
      now - 90_000,
    ),
    env.DB.prepare(
      `INSERT INTO plans (
         plan_id, event_id, generation, status, algorithm_version,
         min_table_size, preferred_table_size, max_table_size,
         player_count, gm_signup_count, selected_gm_count, published_at
       ) VALUES (?, ?, 1, 'published', 'test', 1, 1, 1, 1, 1, 1, ?)`,
    ).bind(sourcePlanId, sourceEventId, now - 110_000),
    env.DB.prepare(
      `INSERT INTO plan_tables (
         table_id, plan_id, table_number, title, capacity,
         gm_user_id, gm_display_name
       ) VALUES (?, ?, 1, 'Source', 1, ?, 'Priority DM')`,
    ).bind(sourceTableId, sourcePlanId, priorityUserId),
    env.DB.prepare(
      `INSERT INTO weekly_events (
         event_id, guild_id, title, starts_at, ends_at, signup_opens_at,
         signup_locks_at, table_selection_closes_at, status, published_at
       ) VALUES (?, ?, 'Target', ?, ?, ?, ?, ?, 'published', ?)`,
    ).bind(
      eventId,
      guildId,
      now + 2_000,
      now + 20_000,
      now - 20_000,
      now - 10_000,
      closesAt,
      now - 5_000,
    ),
    env.DB.prepare(
      `INSERT INTO plans (
         plan_id, event_id, generation, status, algorithm_version,
         min_table_size, preferred_table_size, max_table_size,
         player_count, gm_signup_count, selected_gm_count, published_at
       ) VALUES (?, ?, 1, 'published', 'test', 1, 1, 1, 2, 1, 1, ?)`,
    ).bind(planId, eventId, now - 5_000),
    env.DB.prepare(
      `INSERT INTO plan_tables (
         table_id, plan_id, table_number, title, capacity,
         gm_user_id, gm_display_name
       ) VALUES (?, ?, 1, 'Target', 1, ?, 'Target DM')`,
    ).bind(tableId, planId, `${prefix}:target-dm`),
    env.DB.prepare(
      `INSERT INTO signups (
         event_id, user_id, display_name, signup_kind, status, signed_up_at
       ) VALUES (?, ?, 'Priority', 'player', 'active', ?)`,
    ).bind(eventId, priorityUserId, now - 4_000),
    env.DB.prepare(
      `INSERT INTO signups (
         event_id, user_id, display_name, signup_kind, status, signed_up_at
       ) VALUES (?, ?, 'Standard', 'player', 'active', ?)`,
    ).bind(eventId, standardUserId, now - 4_100),
    env.DB.prepare(
      `INSERT INTO assignments (
         assignment_id, plan_id, user_id, display_name, status, updated_at
       ) VALUES (?, ?, ?, 'Priority', 'unassigned', ?)`,
    ).bind(priorityAssignmentId, planId, priorityUserId, now - 4_000),
    env.DB.prepare(
      `INSERT INTO assignments (
         assignment_id, plan_id, table_id, desired_table_id, user_id,
         display_name, status, assigned_at, updated_at,
         table_requested_at, seat_request_version
       ) VALUES (?, ?, ?, ?, ?, 'Standard', 'assigned', ?, ?, ?, 1)`,
    ).bind(
      `${prefix}:standard-assignment`,
      planId,
      tableId,
      tableId,
      standardUserId,
      now - 3_000,
      now - 3_000,
      now - 3_000,
    ),
  ]);

  const priority = new PriorityRepository(env.DB, () => now - 50_000);
  await priority.grantCompletedSessionReward({
    grantId,
    creditIds: [creditId, `${prefix}:credit-2`],
    guildId,
    completionRevisionId: `${prefix}:completion`,
    sourceEventId,
    sourcePlanId,
    sourceTableId,
    dmUserId: priorityUserId,
    policyVersion: "dm-priority-v1",
    earnedTimeZone: "America/Denver",
    earnedAt: now - 50_000,
    expiresAt,
    grantedByUserId: `${prefix}:organizer`,
    idempotencyKey: `${prefix}:grant-operation`,
  });

  return {
    prefix,
    guildId,
    eventId,
    planId,
    tableId,
    sourceEventId,
    sourcePlanId,
    sourceTableId,
    priorityUserId,
    standardUserId,
    priorityAssignmentId,
    grantId,
    creditId,
    now,
    closesAt,
    expiresAt,
  };
}

function services(fixture: InvariantFixture, clock: { value: number }) {
  let sequence = 0;
  const repository = new PriorityRepository(env.DB, () => clock.value);
  const priority = new PriorityService(repository, {
    now: () => clock.value,
    id: () => `${fixture.prefix}:generated:${++sequence}`,
  });
  const seating = new PrioritySeatingRepository(env.DB, () => clock.value);
  const coordinator = new PriorityRewardCoordinator(
    env.DB,
    priority,
    seating,
    { now: () => clock.value },
  );
  return { repository, priority, seating, coordinator };
}

async function reserve(
  fixture: InvariantFixture,
  seating: PrioritySeatingRepository,
): Promise<string> {
  const selected = await seating.selectTableWithPriority({
    guildId: fixture.guildId,
    eventId: fixture.eventId,
    planId: fixture.planId,
    tableId: fixture.tableId,
    userId: fixture.priorityUserId,
    actorUserId: fixture.priorityUserId,
    operationKey: `${fixture.prefix}:select`,
  });
  expect(selected.assignment).toMatchObject({
    status: "assigned",
    priorityCreditId: fixture.creditId,
  });
  return selected.priorityCreditId!;
}

async function seatingState(fixture: InvariantFixture): Promise<{
  priority_status: string;
  priority_credit_id: string | null;
  standard_status: string;
  credit_status: string;
}> {
  return (await env.DB.prepare(
    `SELECT
       (SELECT status FROM assignments WHERE assignment_id = ?) priority_status,
       (SELECT priority_credit_id FROM assignments WHERE assignment_id = ?)
         priority_credit_id,
       (SELECT status FROM assignments
        WHERE plan_id = ? AND user_id = ?) standard_status,
       (SELECT status FROM dm_priority_credits
        WHERE guild_id = ? AND credit_id = ?) credit_status`,
  ).bind(
    fixture.priorityAssignmentId,
    fixture.priorityAssignmentId,
    fixture.planId,
    fixture.standardUserId,
    fixture.guildId,
    fixture.creditId,
  ).first<{
    priority_status: string;
    priority_credit_id: string | null;
    standard_status: string;
    credit_status: string;
  }>())!;
}

interface ReplacementPlanFixture {
  planId: string;
  tableId: string;
  assignmentId: string;
}

async function seedReplacementPlan(
  fixture: InvariantFixture,
): Promise<ReplacementPlanFixture> {
  const planId = fixture.prefix + ":next-plan";
  const tableId = fixture.prefix + ":next-table";
  const assignmentId = fixture.prefix + ":next-assignment";
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO plans (
         plan_id, event_id, generation, status, algorithm_version,
         min_table_size, preferred_table_size, max_table_size,
         player_count, gm_signup_count, selected_gm_count
       ) VALUES (?, ?, 2, 'draft', 'test', 1, 1, 1, 2, 1, 1)`,
    ).bind(planId, fixture.eventId),
    env.DB.prepare(
      `INSERT INTO plan_tables (
         table_id, plan_id, table_number, title, capacity,
         gm_user_id, gm_display_name
       ) SELECT ?, ?, 1, 'Replacement', 1, gm_user_id, gm_display_name
         FROM plan_tables WHERE table_id = ?`,
    ).bind(tableId, planId, fixture.tableId),
    env.DB.prepare(
      `INSERT INTO assignments (
         assignment_id, plan_id, desired_table_id, user_id, display_name,
         status, waitlist_position, updated_at, table_requested_at,
         seat_request_version
       ) VALUES (?, ?, ?, ?, 'Priority', 'waitlisted', 1, ?, ?, 1)`,
    ).bind(
      assignmentId,
      planId,
      tableId,
      fixture.priorityUserId,
      fixture.now,
      fixture.now,
    ),
  ]);
  return { planId, tableId, assignmentId };
}

async function tableStateVersion(eventId: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT table_state_version FROM weekly_events WHERE event_id = ?",
  ).bind(eventId).first<{ table_state_version: number }>();
  if (!row) throw new Error("Test event was not found");
  return row.table_state_version;
}

describe("priority invariant ownership", () => {
  it("expires a reserved token, clears its active request, and reranks deterministically", async () => {
    const fixture = await seedInvariantFixture();
    const clock = { value: fixture.now };
    const { seating, coordinator } = services(fixture, clock);
    await reserve(fixture, seating);

    clock.value = fixture.expiresAt;
    expect(await coordinator.expireDueCredits(fixture.guildId)).toHaveLength(2);

    expect(await seatingState(fixture)).toEqual({
      priority_status: "waitlisted",
      priority_credit_id: null,
      standard_status: "assigned",
      credit_status: "expired",
    });
  });

  it("routes an administrative refund through seating cleanup and reranking", async () => {
    const fixture = await seedInvariantFixture();
    const clock = { value: fixture.now };
    const { seating, coordinator } = services(fixture, clock);
    const creditId = await reserve(fixture, seating);

    const refunded = await coordinator.refundCredit({
      guildId: fixture.guildId,
      userId: fixture.priorityUserId,
      creditId,
      targetEventId: fixture.eventId,
      actorUserId: `${fixture.prefix}:admin`,
      reason: "Organizer approved an administrative refund",
      idempotencyKey: `${fixture.prefix}:admin-refund`,
    });

    expect(refunded?.credit.status).toBe("available");
    expect(await seatingState(fixture)).toEqual({
      priority_status: "waitlisted",
      priority_credit_id: null,
      standard_status: "assigned",
      credit_status: "available",
    });
  });

  it("corrects an active reward grant and removes its seating advantage", async () => {
    const fixture = await seedInvariantFixture();
    const clock = { value: fixture.now };
    const { seating, coordinator } = services(fixture, clock);
    await reserve(fixture, seating);

    const corrected = await coordinator.correctGrant({
      guildId: fixture.guildId,
      grantId: fixture.grantId,
      actorUserId: `${fixture.prefix}:admin`,
      reason: "The recorded DM did not run this table",
      idempotencyKey: `${fixture.prefix}:grant-correction`,
    });

    expect(corrected?.credits.every((credit) => credit.status === "corrected")).toBe(true);
    expect(await seatingState(fixture)).toEqual({
      priority_status: "waitlisted",
      priority_credit_id: null,
      standard_status: "assigned",
      credit_status: "corrected",
    });
  });

  it("settlement defensively scrubs a correction committed just after closure", async () => {
    const fixture = await seedInvariantFixture();
    const clock = { value: fixture.now };
    const { priority, seating } = services(fixture, clock);
    await reserve(fixture, seating);

    clock.value = fixture.closesAt;
    await priority.correctGrant({
      guildId: fixture.guildId,
      grantId: fixture.grantId,
      actorUserId: `${fixture.prefix}:admin`,
      reason: "Correction raced table settlement",
      idempotencyKey: `${fixture.prefix}:racing-correction`,
    });
    await seating.settleEvent({
      guildId: fixture.guildId,
      eventId: fixture.eventId,
      planId: fixture.planId,
      operationKey: `${fixture.prefix}:settle`,
    });

    expect(await seatingState(fixture)).toEqual({
      priority_status: "waitlisted",
      priority_credit_id: null,
      standard_status: "assigned",
      credit_status: "corrected",
    });
    expect(
      await env.DB.prepare(
        `SELECT count(*) AS count FROM dm_priority_credits
         WHERE guild_id = ? AND status = 'redeemed'`,

      ).bind(fixture.guildId).first<{ count: number }>(),
    ).toEqual({ count: 0 });
  });

  it("carries only after publication and replays without another state change", async () => {
    const fixture = await seedInvariantFixture();
    const clock = { value: fixture.now };
    const { seating } = services(fixture, clock);
    await reserve(fixture, seating);
    const next = await seedReplacementPlan(fixture);
    const operationKey = fixture.prefix + ":carry-published";
    const beforeAttempt = await tableStateVersion(fixture.eventId);

    await expect(seating.carryForwardPriorityRequest({
      guildId: fixture.guildId,
      eventId: fixture.eventId,
      previousPlanId: fixture.planId,
      nextPlanId: next.planId,
      previousAssignmentId: fixture.priorityAssignmentId,
      nextAssignmentId: next.assignmentId,
      operationKey,
    })).rejects.toBeInstanceOf(PrioritySeatingUnavailableError);
    expect(await tableStateVersion(fixture.eventId)).toBe(beforeAttempt);
    expect(
      await env.DB.prepare(
        "SELECT priority_credit_id FROM assignments WHERE assignment_id = ?",
      ).bind(next.assignmentId).first<{ priority_credit_id: string | null }>(),
    ).toEqual({ priority_credit_id: null });

    const guildRepository = new GuildRepository(env.DB, () => clock.value);
    await expect(guildRepository.publishPlan({
      guildId: fixture.guildId,
      eventId: fixture.eventId,
      planId: next.planId,
    })).resolves.toBe(true);
    const afterPublish = await tableStateVersion(fixture.eventId);

    const applied = await seating.carryForwardPriorityRequest({
      guildId: fixture.guildId,
      eventId: fixture.eventId,
      previousPlanId: fixture.planId,
      nextPlanId: next.planId,
      previousAssignmentId: fixture.priorityAssignmentId,
      nextAssignmentId: next.assignmentId,
      operationKey,
    });
    const replay = await seating.carryForwardPriorityRequest({
      guildId: fixture.guildId,
      eventId: fixture.eventId,
      previousPlanId: fixture.planId,
      nextPlanId: next.planId,
      previousAssignmentId: fixture.priorityAssignmentId,
      nextAssignmentId: next.assignmentId,
      operationKey,
    });

    expect(applied).toMatchObject({
      applied: true,
      replayed: false,
      priorityCreditId: fixture.creditId,
    });
    expect(replay).toMatchObject({
      applied: false,
      replayed: true,
      priorityCreditId: fixture.creditId,
    });
    expect(await tableStateVersion(fixture.eventId)).toBe(afterPublish + 1);
    expect(
      await env.DB.prepare(
        `SELECT priority_credit_id, priority_requested_at, table_requested_at
         FROM assignments WHERE assignment_id = ?`,
      ).bind(next.assignmentId).first<{
        priority_credit_id: string | null;
        priority_requested_at: number | null;
        table_requested_at: number | null;
      }>(),
    ).toEqual({
      priority_credit_id: fixture.creditId,
      priority_requested_at: fixture.now,
      table_requested_at: fixture.now,
    });
    expect(
      await env.DB.prepare(
        `SELECT count(*) AS count FROM priority_seating_events
         WHERE guild_id = ? AND operation_key = ? AND action = 'carried_forward'`,
      ).bind(fixture.guildId, operationKey).first<{ count: number }>(),
    ).toEqual({ count: 1 });
  });

  it("cron recovers a reservation skipped across two published generations", async () => {
    const fixture = await seedInvariantFixture();
    const clock = { value: fixture.now };
    const { seating } = services(fixture, clock);
    await reserve(fixture, seating);
    const guildRepository = new GuildRepository(env.DB, () => clock.value);

    const middle = await seedReplacementPlan(fixture);
    await expect(guildRepository.publishPlan({
      guildId: fixture.guildId,
      eventId: fixture.eventId,
      planId: middle.planId,
    })).resolves.toBe(true);

    const currentPlanId = fixture.prefix + ":current-plan";
    const currentTableId = fixture.prefix + ":current-table";
    const currentAssignmentId = fixture.prefix + ":current-assignment";
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO plans (
           plan_id, event_id, generation, status, algorithm_version,
           min_table_size, preferred_table_size, max_table_size,
           player_count, gm_signup_count, selected_gm_count
         ) VALUES (?, ?, 3, 'draft', 'test', 1, 1, 1, 2, 1, 1)`,
      ).bind(currentPlanId, fixture.eventId),
      env.DB.prepare(
        `INSERT INTO plan_tables (
           table_id, plan_id, table_number, title, capacity,
           gm_user_id, gm_display_name
         ) SELECT ?, ?, 1, 'Current', 1, gm_user_id, gm_display_name
           FROM plan_tables WHERE table_id = ?`,
      ).bind(currentTableId, currentPlanId, fixture.tableId),
      env.DB.prepare(
        `INSERT INTO assignments (
           assignment_id, plan_id, desired_table_id, user_id, display_name,
           status, waitlist_position, updated_at, table_requested_at,
           seat_request_version
         ) VALUES (?, ?, ?, ?, 'Priority', 'waitlisted', 1, ?, ?, 1)`,
      ).bind(
        currentAssignmentId,
        currentPlanId,
        currentTableId,
        fixture.priorityUserId,
        fixture.now,
        fixture.now,
      ),
    ]);
    await expect(guildRepository.publishPlan({
      guildId: fixture.guildId,
      eventId: fixture.eventId,
      planId: currentPlanId,
    })).resolves.toBe(true);

    expect(
      await env.DB.prepare(
        "SELECT priority_credit_id FROM assignments WHERE assignment_id = ?",
      ).bind(currentAssignmentId).first<{ priority_credit_id: string | null }>(),
    ).toEqual({ priority_credit_id: null });
    await expect(
      seating.listPublishedPlansNeedingPriorityReconciliation(10),
    ).resolves.toContainEqual({
      guildId: fixture.guildId,
      eventId: fixture.eventId,
      planId: currentPlanId,
    });

    await runM6Scheduled(env, clock.value);

    expect(
      await env.DB.prepare(
        `SELECT priority_credit_id, priority_requested_at
         FROM assignments WHERE assignment_id = ?`,
      ).bind(currentAssignmentId).first<{
        priority_credit_id: string | null;
        priority_requested_at: number | null;
      }>(),
    ).toEqual({
      priority_credit_id: fixture.creditId,
      priority_requested_at: fixture.now,
    });
  });

  it("refuses to carry an invalid credit into a replacement plan", async () => {
    const fixture = await seedInvariantFixture();
    const clock = { value: fixture.now };
    const { priority, seating } = services(fixture, clock);
    await reserve(fixture, seating);

    const nextPlanId = `${fixture.prefix}:next-plan`;
    const nextTableId = `${fixture.prefix}:next-table`;
    const nextAssignmentId = `${fixture.prefix}:next-assignment`;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO plans (
           plan_id, event_id, generation, status, algorithm_version,
           min_table_size, preferred_table_size, max_table_size,
           player_count, gm_signup_count, selected_gm_count
         ) VALUES (?, ?, 2, 'draft', 'test', 1, 1, 1, 2, 1, 1)`,
      ).bind(nextPlanId, fixture.eventId),
      env.DB.prepare(
        `INSERT INTO plan_tables (
           table_id, plan_id, table_number, title, capacity,
           gm_user_id, gm_display_name
         ) SELECT ?, ?, 1, 'Replacement', 1, gm_user_id, gm_display_name
           FROM plan_tables WHERE table_id = ?`,
      ).bind(nextTableId, nextPlanId, fixture.tableId),
      env.DB.prepare(
        `INSERT INTO assignments (
           assignment_id, plan_id, desired_table_id, user_id, display_name,
           status, waitlist_position, updated_at, table_requested_at,
           seat_request_version
         ) VALUES (?, ?, ?, ?, 'Priority', 'waitlisted', 1, ?, ?, 1)`,
      ).bind(
        nextAssignmentId,
        nextPlanId,
        nextTableId,
        fixture.priorityUserId,
        fixture.now,
        fixture.now,
      ),
    ]);
    const guildRepository = new GuildRepository(env.DB, () => clock.value);
    await expect(guildRepository.publishPlan({
      guildId: fixture.guildId,
      eventId: fixture.eventId,
      planId: nextPlanId,
    })).resolves.toBe(true);
    await priority.correctGrant({
      guildId: fixture.guildId,
      grantId: fixture.grantId,
      actorUserId: `${fixture.prefix}:admin`,
      reason: "Correction landed before republish carry",
      idempotencyKey: `${fixture.prefix}:pre-carry-correction`,
    });

    await expect(seating.carryForwardPriorityRequest({
      guildId: fixture.guildId,
      eventId: fixture.eventId,
      previousPlanId: fixture.planId,
      nextPlanId,
      previousAssignmentId: fixture.priorityAssignmentId,
      nextAssignmentId,
      operationKey: `${fixture.prefix}:carry`,
    })).rejects.toBeInstanceOf(PrioritySeatingUnavailableError);

    expect(
      await env.DB.prepare(
        `SELECT priority_credit_id, priority_requested_at
         FROM assignments WHERE assignment_id = ?`,
      ).bind(nextAssignmentId).first<{
        priority_credit_id: string | null;
        priority_requested_at: number | null;
      }>(),
    ).toEqual({ priority_credit_id: null, priority_requested_at: null });
  });
});
