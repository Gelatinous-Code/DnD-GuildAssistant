import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  PriorityRepository,
  type GrantCompletedSessionRewardInput,
} from "../../src/storage/priority-repository";

interface PriorityFixture {
  prefix: string;
  guildId: string;
  userId: string;
  sourceEventId: string;
  sourcePlanId: string;
  sourceTableId: string;
  targetEventIds: readonly [string, string, string];
  earnedAt: number;
  expiresAt: number;
  reservedAt: number;
}

async function createPriorityFixture(): Promise<PriorityFixture> {
  const prefix = crypto.randomUUID();
  const guildId = `${prefix}:guild`;
  const userId = `${prefix}:member`;
  const sourceEventId = `${prefix}:source-event`;
  const sourcePlanId = `${prefix}:source-plan`;
  const sourceTableId = `${prefix}:source-table`;
  const targetEventIds = [
    `${prefix}:target-one`,
    `${prefix}:target-two`,
    `${prefix}:target-three`,
  ] as const;
  const earnedAt = 1_800_000_000_000;
  const reservedAt = earnedAt + 10_000;
  const expiresAt = earnedAt + 10_000_000;
  const sourceStartsAt = earnedAt - 1_000_000;
  const targetStarts = [
    earnedAt + 1_000_000,
    earnedAt + 2_000_000,
    earnedAt + 3_000_000,
  ] as const;

  const statements: D1PreparedStatement[] = [
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
       ) VALUES (?, ?, 1, 'Completed table', 6, ?, 'Integration DM')`,
    ).bind(sourceTableId, sourcePlanId, userId),
  ];

  for (let index = 0; index < targetEventIds.length; index += 1) {
    const eventId = targetEventIds[index];
    const startsAt = targetStarts[index];
    statements.push(
      env.DB.prepare(
        `INSERT INTO weekly_events (
           event_id, guild_id, title, starts_at, ends_at, signup_opens_at,
           signup_locks_at, status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open')`,
      ).bind(
        eventId,
        guildId,
        `Target game ${index + 1}`,
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
    );
  }

  await env.DB.batch(statements);
  return {
    prefix,
    guildId,
    userId,
    sourceEventId,
    sourcePlanId,
    sourceTableId,
    targetEventIds,
    earnedAt,
    expiresAt,
    reservedAt,
  };
}

function grantInput(
  fixture: PriorityFixture,
  suffix: string,
): GrantCompletedSessionRewardInput {
  return {
    grantId: `${fixture.prefix}:grant:${suffix}`,
    creditIds: [
      `${fixture.prefix}:credit:${suffix}:one`,
      `${fixture.prefix}:credit:${suffix}:two`,
    ],
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
  };
}

describe("DM priority D1 contention", () => {
  it("grants exactly two tokens on concurrent retries and never reserves one twice", async () => {
    const fixture = await createPriorityFixture();
    const firstRepository = new PriorityRepository(env.DB, () => fixture.earnedAt);
    const secondRepository = new PriorityRepository(env.DB, () => fixture.earnedAt);

    const grantResults = await Promise.all([
      firstRepository.grantCompletedSessionReward(grantInput(fixture, "first")),
      secondRepository.grantCompletedSessionReward(grantInput(fixture, "second")),
    ]);

    expect(grantResults.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(grantResults.map((result) => result.grant.grantId)).size).toBe(1);
    expect(grantResults[0].credits).toHaveLength(2);
    expect(grantResults[1].credits).toHaveLength(2);

    const persisted = await env.DB.prepare(
      `SELECT
         (SELECT count(*) FROM dm_priority_grants
          WHERE guild_id = ?) AS grant_count,
         (SELECT count(*) FROM dm_priority_credits
          WHERE guild_id = ?) AS credit_count,
         (SELECT count(*) FROM dm_priority_credit_events
          WHERE guild_id = ? AND action = 'granted') AS grant_event_count`,
    ).bind(fixture.guildId, fixture.guildId, fixture.guildId).first<{
      grant_count: number;
      credit_count: number;
      grant_event_count: number;
    }>();
    expect(persisted).toEqual({
      grant_count: 1,
      credit_count: 2,
      grant_event_count: 2,
    });

    const firstReservation = await firstRepository.reserveNextCredit({
      creditEventId: `${fixture.prefix}:reserve-event:one`,
      guildId: fixture.guildId,
      userId: fixture.userId,
      targetEventId: fixture.targetEventIds[0],
      reservedAt: fixture.reservedAt,
      actorUserId: fixture.userId,
      idempotencyKey: `${fixture.prefix}:reserve-operation:one`,
    });
    expect(firstReservation?.applied).toBe(true);

    const competingReservations = await Promise.all([
      firstRepository.reserveNextCredit({
        creditEventId: `${fixture.prefix}:reserve-event:two`,
        guildId: fixture.guildId,
        userId: fixture.userId,
        targetEventId: fixture.targetEventIds[1],
        reservedAt: fixture.reservedAt + 1,
        actorUserId: fixture.userId,
        idempotencyKey: `${fixture.prefix}:reserve-operation:two`,
      }),
      secondRepository.reserveNextCredit({
        creditEventId: `${fixture.prefix}:reserve-event:three`,
        guildId: fixture.guildId,
        userId: fixture.userId,
        targetEventId: fixture.targetEventIds[2],
        reservedAt: fixture.reservedAt + 1,
        actorUserId: fixture.userId,
        idempotencyKey: `${fixture.prefix}:reserve-operation:three`,
      }),
    ]);

    expect(competingReservations.filter((result) => result !== null)).toHaveLength(1);

    const reservationState = await env.DB.prepare(
      `SELECT
         (SELECT count(*) FROM dm_priority_credits
          WHERE guild_id = ? AND status = 'reserved') AS reserved_count,
         (SELECT count(*) FROM dm_priority_credit_events
          WHERE guild_id = ? AND action = 'reserved') AS reservation_event_count,
         (SELECT count(DISTINCT credit_id) FROM dm_priority_credit_events
          WHERE guild_id = ? AND action = 'reserved') AS distinct_reserved_credits`,
    ).bind(fixture.guildId, fixture.guildId, fixture.guildId).first<{
      reserved_count: number;
      reservation_event_count: number;
      distinct_reserved_credits: number;
    }>();
    expect(reservationState).toEqual({
      reserved_count: 2,
      reservation_event_count: 2,
      distinct_reserved_credits: 2,
    });
  });
});
