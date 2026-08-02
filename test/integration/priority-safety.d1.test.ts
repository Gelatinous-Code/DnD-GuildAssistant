import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  PriorityRepository,
  type DmPriorityCredit,
} from "../../src/storage/priority-repository";

interface SafetyFixture {
  prefix: string;
  guildId: string;
  userId: string;
  sourceEventId: string;
  sourcePlanId: string;
  sourceTableId: string;
  targetEventId: string;
  otherEventId: string;
  earnedAt: number;
  reservedAt: number;
  expiresAt: number;
}

async function seedSafetyFixture(): Promise<SafetyFixture> {
  const prefix = crypto.randomUUID();
  const guildId = `${prefix}:guild`;
  const userId = `${prefix}:member`;
  const sourceEventId = `${prefix}:source-event`;
  const sourcePlanId = `${prefix}:source-plan`;
  const sourceTableId = `${prefix}:source-table`;
  const targetEventId = `${prefix}:target-event`;
  const otherEventId = `${prefix}:other-event`;
  const earnedAt = 1_810_000_000_000;
  const reservedAt = earnedAt + 10_000;
  const expiresAt = earnedAt + 10_000_000;
  const sourceStartsAt = earnedAt - 1_000_000;

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO guild_config (guild_id, timezone) VALUES (?, 'America/Denver')",
    ).bind(guildId),
    env.DB.prepare(
      `INSERT INTO weekly_events (
         event_id, guild_id, title, starts_at, ends_at, signup_opens_at,
         signup_locks_at, status, archived_at
       ) VALUES (?, ?, 'Completed source game', ?, ?, ?, ?, 'archived', ?)`,
    ).bind(
      sourceEventId,
      guildId,
      sourceStartsAt,
      sourceStartsAt + 100_000,
      sourceStartsAt - 200_000,
      sourceStartsAt - 100_000,
      sourceStartsAt + 100_000,
    ),
    env.DB.prepare(
      `INSERT INTO plans (
         plan_id, event_id, generation, status, algorithm_version,
         min_table_size, preferred_table_size, max_table_size,
         player_count, gm_signup_count, selected_gm_count, published_at
       ) VALUES (?, ?, 1, 'published', 'integration-test', 4, 6, 6, 5, 1, 1, ?)`,
    ).bind(sourcePlanId, sourceEventId, sourceStartsAt - 50_000),
    env.DB.prepare(
      `INSERT INTO plan_tables (
         table_id, plan_id, table_number, title, capacity,
         gm_user_id, gm_display_name
       ) VALUES (?, ?, 1, 'Source table', 6, ?, 'Integration DM')`,
    ).bind(sourceTableId, sourcePlanId, userId),
    ...[targetEventId, otherEventId].flatMap((eventId, index) => {
      const startsAt = earnedAt + (index + 1) * 1_000_000;
      return [
        env.DB.prepare(
          `INSERT INTO weekly_events (
             event_id, guild_id, title, starts_at, ends_at, signup_opens_at,
             signup_locks_at, status
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open')`,
        ).bind(
          eventId,
          guildId,
          `Target ${index + 1}`,
          startsAt,
          startsAt + 100_000,
          startsAt - 500_000,
          startsAt - 100_000,
        ),
        env.DB.prepare(
          `INSERT INTO signups (
             event_id, user_id, display_name, signup_kind, status, signed_up_at
           ) VALUES (?, ?, 'Integration member', 'player', 'active', ?)`,
        ).bind(eventId, userId, reservedAt - 1_000),
      ];
    }),
  ]);

  return {
    prefix,
    guildId,
    userId,
    sourceEventId,
    sourcePlanId,
    sourceTableId,
    targetEventId,
    otherEventId,
    earnedAt,
    reservedAt,
    expiresAt,
  };
}

async function grantTokens(
  repository: PriorityRepository,
  fixture: SafetyFixture,
): Promise<readonly [DmPriorityCredit, DmPriorityCredit]> {
  const result = await repository.grantCompletedSessionReward({
    grantId: `${fixture.prefix}:grant`,
    creditIds: [`${fixture.prefix}:credit:one`, `${fixture.prefix}:credit:two`],
    guildId: fixture.guildId,
    completionRevisionId: `${fixture.prefix}:completion`,
    sourceEventId: fixture.sourceEventId,
    sourcePlanId: fixture.sourcePlanId,
    sourceTableId: fixture.sourceTableId,
    dmUserId: fixture.userId,
    policyVersion: "dm-priority-v1",
    earnedTimeZone: "America/Denver",
    earnedAt: fixture.earnedAt,
    expiresAt: fixture.expiresAt,
    grantedByUserId: `${fixture.prefix}:organizer`,
    idempotencyKey: `${fixture.prefix}:grant-operation`,
  });
  return result.credits;
}

async function seedAssignment(
  fixture: SafetyFixture,
  eventId: string,
  suffix: string,
): Promise<string> {
  const planId = `${fixture.prefix}:${suffix}:plan`;
  const tableId = `${fixture.prefix}:${suffix}:table`;
  const assignmentId = `${fixture.prefix}:${suffix}:assignment`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO plans (
         plan_id, event_id, generation, status, algorithm_version,
         min_table_size, preferred_table_size, max_table_size,
         player_count, gm_signup_count, selected_gm_count, published_at
       ) VALUES (?, ?, 1, 'published', 'integration-test', 4, 6, 6, 1, 1, 1, ?)`,
    ).bind(planId, eventId, fixture.reservedAt),
    env.DB.prepare(
      `INSERT INTO plan_tables (
         table_id, plan_id, table_number, title, capacity,
         gm_user_id, gm_display_name
       ) VALUES (?, ?, 1, 'Target table', 6, ?, 'Target DM')`,
    ).bind(tableId, planId, `${fixture.prefix}:${suffix}:dm`),
    env.DB.prepare(
      `INSERT INTO assignments (
         assignment_id, plan_id, table_id, desired_table_id, user_id,
         display_name, status, assigned_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'Integration member', 'assigned', ?, ?)`,
    ).bind(
      assignmentId,
      planId,
      tableId,
      tableId,
      fixture.userId,
      fixture.reservedAt,
      fixture.reservedAt,
    ),
  ]);
  return assignmentId;
}

describe("DM priority D1 safety guards", () => {
  it("rejects an assignment from another event before redeeming", async () => {
    const fixture = await seedSafetyFixture();
    const repository = new PriorityRepository(env.DB, () => fixture.earnedAt);
    await grantTokens(repository, fixture);
    const reservation = await repository.reserveNextCredit({
      creditEventId: `${fixture.prefix}:reserve-event`,
      guildId: fixture.guildId,
      userId: fixture.userId,
      targetEventId: fixture.targetEventId,
      reservedAt: fixture.reservedAt,
      actorUserId: fixture.userId,
      idempotencyKey: `${fixture.prefix}:reserve-operation`,
    });
    expect(reservation?.credit.status).toBe("reserved");

    const wrongAssignmentId = await seedAssignment(
      fixture,
      fixture.otherEventId,
      "wrong",
    );
    const rejected = await repository.redeemReservedCredit({
      creditEventId: `${fixture.prefix}:redeem-wrong-event`,
      guildId: fixture.guildId,
      userId: fixture.userId,
      creditId: reservation!.credit.creditId,
      targetEventId: fixture.targetEventId,
      targetAssignmentId: wrongAssignmentId,
      redeemedAt: fixture.reservedAt + 1,
      actorUserId: fixture.userId,
      idempotencyKey: `${fixture.prefix}:redeem-wrong-operation`,
    });
    expect(rejected).toBeNull();
    expect(
      (await repository.getCredit(fixture.guildId, reservation!.credit.creditId))?.status,
    ).toBe("reserved");

    const validAssignmentId = await seedAssignment(
      fixture,
      fixture.targetEventId,
      "valid",
    );
    const redeemed = await repository.redeemReservedCredit({
      creditEventId: `${fixture.prefix}:redeem-valid-event`,
      guildId: fixture.guildId,
      userId: fixture.userId,
      creditId: reservation!.credit.creditId,
      targetEventId: fixture.targetEventId,
      targetAssignmentId: validAssignmentId,
      redeemedAt: fixture.reservedAt + 2,
      actorUserId: fixture.userId,
      idempotencyKey: `${fixture.prefix}:redeem-valid-operation`,
    });
    expect(redeemed?.applied).toBe(true);
    expect(redeemed?.credit.status).toBe("redeemed");
    expect(redeemed?.credit.targetAssignmentId).toBe(validAssignmentId);
  });

  it("rolls a correction back when a derived lifecycle key collides", async () => {
    const fixture = await seedSafetyFixture();
    const repository = new PriorityRepository(env.DB, () => fixture.earnedAt);
    const credits = await grantTokens(repository, fixture);
    const correctionKey = `${fixture.prefix}:correction`;

    await env.DB.prepare(
      `INSERT INTO dm_priority_credit_events (
         credit_event_id, guild_id, credit_id, idempotency_key, action,
         from_status, to_status, credit_version, reason, occurred_at
       ) VALUES (?, ?, ?, ?, 'expired', 'available', 'expired', 2,
                 'collision fixture', ?)`,
    ).bind(
      `${fixture.prefix}:collision-event`,
      fixture.guildId,
      credits[1].creditId,
      `${correctionKey}:${credits[0].creditId}`,
      fixture.earnedAt + 1,
    ).run();

    await expect(
      repository.correctGrant({
        guildId: fixture.guildId,
        grantId: credits[0].grantId,
        correctedAt: fixture.earnedAt + 2,
        correctedByUserId: `${fixture.prefix}:organizer`,
        reason: "Correct the actual DM",
        idempotencyKey: correctionKey,
      }),
    ).rejects.toThrow();

    expect(await repository.getGrant(fixture.guildId, credits[0].grantId)).toMatchObject({
      status: "active",
      correctionKey: null,
    });
    expect(await repository.listCreditsForGrant(fixture.guildId, credits[0].grantId))
      .toEqual([
        expect.objectContaining({ creditId: credits[0].creditId, status: "available" }),
        expect.objectContaining({ creditId: credits[1].creditId, status: "available" }),
      ]);
  });
});
