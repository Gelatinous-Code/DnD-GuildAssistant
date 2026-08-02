import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { PriorityService } from "../../src/priority-service";
import {
  SessionService,
  SessionSourceUnavailableError,
} from "../../src/session-service";
import { PriorityRepository } from "../../src/storage/priority-repository";
import { SessionRepository } from "../../src/storage/session-repository";

const BASE_TIME = Date.parse("2026-08-18T18:00:00Z");

interface SessionFixture {
  prefix: string;
  guildId: string;
  eventId: string;
  planId: string;
  tableId: string;
  plannedDmId: string;
  substituteDmId: string;
  playerId: string;
  adminId: string;
  now: number;
}

interface ServiceFixture {
  sessions: SessionRepository;
  priorities: PriorityRepository;
  service: SessionService;
  setNow(value: number): void;
}

async function seedSessionFixture(): Promise<SessionFixture> {
  const prefix = crypto.randomUUID();
  const guildId = `${prefix}:guild`;
  const eventId = `${prefix}:event`;
  const planId = `${prefix}:plan`;
  const tableId = `${prefix}:table`;
  const plannedDmId = `${prefix}:dm:planned`;
  const substituteDmId = `${prefix}:dm:substitute`;
  const playerId = `${prefix}:player`;
  const adminId = `${prefix}:admin`;
  const startsAt = BASE_TIME - 4 * 60 * 60 * 1_000;
  const endsAt = BASE_TIME - 1_000;

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO guild_config (guild_id, timezone) VALUES (?, 'America/Denver')",
    ).bind(guildId),
    env.DB.prepare(
      `INSERT INTO weekly_events (
         event_id, guild_id, title, starts_at, ends_at, signup_opens_at,
         signup_locks_at, status, table_selection_closes_at,
         final_manifest_channel_id, final_manifest_message_id,
         table_state_version, finalized_plan_id,
         finalized_table_state_version, tables_finalized_at, archived_at
       ) VALUES (
         ?, ?, 'Completed integration game', ?, ?, ?, ?, 'archived', ?,
         'manifest-channel', 'manifest-message', 1, ?, 1, ?, ?
       )`,
    ).bind(
      eventId,
      guildId,
      startsAt,
      endsAt,
      startsAt - 7 * 24 * 60 * 60 * 1_000,
      startsAt - 24 * 60 * 60 * 1_000,
      startsAt - 2 * 60 * 60 * 1_000,
      planId,
      endsAt - 2_000,
      endsAt,
    ),
    env.DB.prepare(
      `INSERT INTO plans (
         plan_id, event_id, generation, status, algorithm_version,
         min_table_size, preferred_table_size, max_table_size,
         player_count, gm_signup_count, selected_gm_count, published_at
       ) VALUES (
         ?, ?, 1, 'published', 'session-integration-v1',
         4, 6, 6, 1, 1, 1, ?
       )`,
    ).bind(planId, eventId, startsAt - 3_000),
    env.DB.prepare(
      `INSERT INTO plan_tables (
         table_id, plan_id, table_number, title, capacity,
         gm_user_id, gm_display_name
       ) VALUES (?, ?, 1, 'The Dawn Table', 6, ?, 'Planned DM')`,
    ).bind(tableId, planId, plannedDmId),
    env.DB.prepare(
      `INSERT INTO assignments (
         assignment_id, plan_id, table_id, desired_table_id, user_id,
         display_name, status, assigned_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'Integration Player', 'assigned', ?, ?)`,
    ).bind(
      `${prefix}:assignment`,
      planId,
      tableId,
      tableId,
      playerId,
      startsAt - 2_000,
      startsAt - 2_000,
    ),
  ]);

  return {
    prefix,
    guildId,
    eventId,
    planId,
    tableId,
    plannedDmId,
    substituteDmId,
    playerId,
    adminId,
    now: BASE_TIME,
  };
}

function createServices(fixture: SessionFixture, suffix = "one"): ServiceFixture {
  let now = fixture.now;
  let sessionSequence = 0;
  let prioritySequence = 0;
  const sessions = new SessionRepository(env.DB);
  const priorities = new PriorityRepository(env.DB, () => now);
  const priority = new PriorityService(priorities, {
    now: () => now,
    id: () => `${fixture.prefix}:${suffix}:priority:${++prioritySequence}`,
  });
  const service = new SessionService(sessions, priorities, priority, {
    now: () => now,
    id: () => `${fixture.prefix}:${suffix}:session:${++sessionSequence}`,
  });
  return {
    sessions,
    priorities,
    service,
    setNow(value: number) {
      now = value;
    },
  };
}

async function persistedCounts(fixture: SessionFixture): Promise<{
  session_count: number;
  revision_count: number;
  current_revision_count: number;
  grant_count: number;
  active_grant_count: number;
  credit_count: number;
}> {
  const counts = await env.DB.prepare(
    `SELECT
       (SELECT count(*) FROM session_completions
        WHERE guild_id = ?) AS session_count,
       (SELECT count(*) FROM session_completion_revisions
        WHERE guild_id = ?) AS revision_count,
       (SELECT count(*) FROM session_completion_revisions
        WHERE guild_id = ? AND is_current = 1) AS current_revision_count,
       (SELECT count(*) FROM dm_priority_grants
        WHERE guild_id = ?) AS grant_count,
       (SELECT count(*) FROM dm_priority_grants
        WHERE guild_id = ? AND status = 'active') AS active_grant_count,
       (SELECT count(*) FROM dm_priority_credits
        WHERE guild_id = ?) AS credit_count`,
  )
    .bind(
      fixture.guildId,
      fixture.guildId,
      fixture.guildId,
      fixture.guildId,
      fixture.guildId,
      fixture.guildId,
    )
    .first<{
      session_count: number;
      revision_count: number;
      current_revision_count: number;
      grant_count: number;
      active_grant_count: number;
      credit_count: number;
    }>();
  if (!counts) throw new Error("Expected aggregate count row");
  return counts;
}

async function confirmCompleted(fixture: SessionFixture, services: ServiceFixture) {
  return services.service.confirmSession({
    guildId: fixture.guildId,
    eventId: fixture.eventId,
    tableNumber: 1,
    result: "completed",
    confirmedByUserId: fixture.adminId,
    idempotencyKey: `${fixture.prefix}:confirm`,
  });
}

describe("session completion D1 workflow", () => {
  it("creates one completion and two credits under concurrent and sequential retries", async () => {
    const fixture = await seedSessionFixture();
    const first = createServices(fixture, "concurrent-one");
    const second = createServices(fixture, "concurrent-two");

    const results = await Promise.all([
      confirmCompleted(fixture, first),
      confirmCompleted(fixture, second),
    ]);
    const replay = await first.service.confirmSession({
      guildId: fixture.guildId,
      eventId: fixture.eventId,
      tableNumber: 1,
      result: "completed",
      confirmedByUserId: fixture.adminId,
      idempotencyKey: `${fixture.prefix}:confirm-retry`,
    });

    expect(results.map((result) => result.revision.completionRevisionId))
      .toEqual([results[0].revision.completionRevisionId, results[0].revision.completionRevisionId]);
    expect(replay).toMatchObject({
      created: false,
      replayed: true,
      revision: {
        result: "completed",
        actualDmUserId: fixture.plannedDmId,
        confirmedAt: BASE_TIME,
      },
      reward: { status: "synced" },
    });
    expect(await persistedCounts(fixture)).toEqual({
      session_count: 1,
      revision_count: 1,
      current_revision_count: 1,
      grant_count: 1,
      active_grant_count: 1,
      credit_count: 2,
    });

    const participants = await env.DB.prepare(
      `SELECT participant_role, user_id, attendance_outcome
       FROM session_completion_participants
       WHERE guild_id = ? ORDER BY participant_role, user_id`,
    )
      .bind(fixture.guildId)
      .all<{
        participant_role: string;
        user_id: string;
        attendance_outcome: string;
      }>();
    expect(participants.results).toEqual([
      {
        participant_role: "dm",
        user_id: fixture.plannedDmId,
        attendance_outcome: "attended",
      },
      {
        participant_role: "player",
        user_id: fixture.playerId,
        attendance_outcome: "attended",
      },
    ]);
  });

  it("preserves the original grant when a correction keeps the same actual DM", async () => {
    const fixture = await seedSessionFixture();
    const services = createServices(fixture);
    const initial = await confirmCompleted(fixture, services);
    const initialGrant = await services.priorities.getActiveGrantForSourceTable(
      fixture.guildId,
      fixture.eventId,
      fixture.tableId,
    );
    expect(initialGrant).not.toBeNull();

    const correctionTime = BASE_TIME + 60_000;
    services.setNow(correctionTime);
    await services.service.recordAttendance({
      guildId: fixture.guildId,
      eventId: fixture.eventId,
      tableNumber: 1,
      userId: fixture.playerId,
      role: "player",
      outcome: "no_show",
      recordedByUserId: fixture.adminId,
      reason: "Player reported they could not attend",
      idempotencyKey: `${fixture.prefix}:attendance-correction`,
    });
    const corrected = await services.service.confirmSession({
      guildId: fixture.guildId,
      eventId: fixture.eventId,
      tableNumber: 1,
      result: "completed",
      confirmedByUserId: fixture.adminId,
      reason: "Correct the player attendance record",
      idempotencyKey: `${fixture.prefix}:confirm-correction`,
    });

    const grantAfterCorrection = await services.priorities.getActiveGrantForSourceTable(
      fixture.guildId,
      fixture.eventId,
      fixture.tableId,
    );
    expect(corrected).toMatchObject({
      created: true,
      revision: {
        revisionNumber: 2,
        actualDmUserId: fixture.plannedDmId,
        supersedesRevisionId: initial.revision.completionRevisionId,
      },
      reward: { status: "synced" },
    });
    expect(grantAfterCorrection).toMatchObject({
      grantId: initialGrant!.grantId,
      completionRevisionId: initial.revision.completionRevisionId,
      earnedAt: BASE_TIME,
      status: "active",
    });
    expect(await persistedCounts(fixture)).toEqual({
      session_count: 1,
      revision_count: 2,
      current_revision_count: 1,
      grant_count: 1,
      active_grant_count: 1,
      credit_count: 2,
    });

    const player = await env.DB.prepare(
      `SELECT attendance_outcome FROM session_completion_participants
       WHERE guild_id = ? AND completion_revision_id = ?
         AND participant_role = 'player' AND user_id = ?`,
    )
      .bind(
        fixture.guildId,
        corrected.revision.completionRevisionId,
        fixture.playerId,
      )
      .first<{ attendance_outcome: string }>();
    expect(player?.attendance_outcome).toBe("no_show");
  });

  it("corrects the old credits and grants two new credits to a substitute DM", async () => {
    const fixture = await seedSessionFixture();
    const services = createServices(fixture);
    const initial = await confirmCompleted(fixture, services);

    const correctionTime = BASE_TIME + 120_000;
    services.setNow(correctionTime);
    await services.service.recordAttendance({
      guildId: fixture.guildId,
      eventId: fixture.eventId,
      tableNumber: 1,
      userId: fixture.substituteDmId,
      role: "dm",
      outcome: "substitute",
      replacesUserId: fixture.plannedDmId,
      recordedByUserId: fixture.adminId,
      reason: "The planned DM was ill",
      idempotencyKey: `${fixture.prefix}:substitute-dm`,
    });
    const corrected = await services.service.confirmSession({
      guildId: fixture.guildId,
      eventId: fixture.eventId,
      tableNumber: 1,
      result: "completed",
      confirmedByUserId: fixture.adminId,
      reason: "Record the DM who actually ran the table",
      idempotencyKey: `${fixture.prefix}:confirm-substitute`,
    });

    expect(corrected).toMatchObject({
      revision: {
        revisionNumber: 2,
        actualDmUserId: fixture.substituteDmId,
        supersedesRevisionId: initial.revision.completionRevisionId,
        confirmedAt: correctionTime,
      },
      reward: {
        status: "synced",
        activeGrant: {
          dmUserId: fixture.substituteDmId,
          completionRevisionId: corrected.revision.completionRevisionId,
          earnedAt: correctionTime,
        },
      },
    });
    expect(await persistedCounts(fixture)).toEqual({
      session_count: 1,
      revision_count: 2,
      current_revision_count: 1,
      grant_count: 2,
      active_grant_count: 1,
      credit_count: 4,
    });

    const lifecycle = await env.DB.prepare(
      `SELECT grant.status, grant.dm_user_id,
              sum(CASE WHEN credit.status = 'corrected' THEN 1 ELSE 0 END)
                AS corrected_credits,
              sum(CASE WHEN credit.status = 'available' THEN 1 ELSE 0 END)
                AS available_credits
       FROM dm_priority_grants grant
       JOIN dm_priority_credits credit ON credit.grant_id = grant.grant_id
       WHERE grant.guild_id = ?
       GROUP BY grant.grant_id, grant.status, grant.dm_user_id
       ORDER BY grant.status`,
    )
      .bind(fixture.guildId)
      .all<{
        status: string;
        dm_user_id: string;
        corrected_credits: number;
        available_credits: number;
      }>();
    expect(lifecycle.results).toEqual([
      {
        status: "active",
        dm_user_id: fixture.substituteDmId,
        corrected_credits: 0,
        available_credits: 2,
      },
      {
        status: "corrected",
        dm_user_id: fixture.plannedDmId,
        corrected_credits: 2,
        available_credits: 0,
      },
    ]);
  });

  it("does not reward a no-show DM or a cancelled table and enforces guild isolation", async () => {
    const fixture = await seedSessionFixture();
    const services = createServices(fixture);
    const otherGuildId = `${fixture.prefix}:other-guild`;
    await env.DB.prepare(
      "INSERT INTO guild_config (guild_id, timezone) VALUES (?, 'UTC')",
    )
      .bind(otherGuildId)
      .run();

    await expect(
      services.service.status(otherGuildId, fixture.eventId, 1),
    ).rejects.toBeInstanceOf(SessionSourceUnavailableError);
    await services.service.recordAttendance({
      guildId: fixture.guildId,
      eventId: fixture.eventId,
      tableNumber: 1,
      userId: fixture.plannedDmId,
      role: "dm",
      outcome: "no_show",
      recordedByUserId: fixture.adminId,
      reason: "The planned DM did not attend",
      idempotencyKey: `${fixture.prefix}:dm-no-show`,
    });
    await expect(
      services.service.confirmSession({
        guildId: fixture.guildId,
        eventId: fixture.eventId,
        tableNumber: 1,
        result: "completed",
        confirmedByUserId: fixture.adminId,
        idempotencyKey: `${fixture.prefix}:invalid-completion`,
      }),
    ).rejects.toThrow("exactly one");

    const cancelled = await services.service.confirmSession({
      guildId: fixture.guildId,
      eventId: fixture.eventId,
      tableNumber: 1,
      result: "cancelled",
      confirmedByUserId: fixture.adminId,
      reason: "The table did not run",
      idempotencyKey: `${fixture.prefix}:cancelled`,
    });
    expect(cancelled).toMatchObject({
      revision: { result: "cancelled", actualDmUserId: null },
      reward: { status: "synced", activeGrant: null },
    });
    expect(await persistedCounts(fixture)).toEqual({
      session_count: 1,
      revision_count: 1,
      current_revision_count: 1,
      grant_count: 0,
      active_grant_count: 0,
      credit_count: 0,
    });

    const persistedSession = await services.sessions.getSessionBySource(
      otherGuildId,
      fixture.eventId,
      fixture.tableId,
    );
    expect(persistedSession).toBeNull();
  });

  it("applies an attendance command once and rejects same-key payload drift", async () => {
    const fixture = await seedSessionFixture();
    const services = createServices(fixture, "attendance-idempotency");
    const idempotencyKey = `${fixture.prefix}:attendance-once`;
    const input = {
      guildId: fixture.guildId,
      eventId: fixture.eventId,
      tableNumber: 1,
      userId: fixture.playerId,
      role: "player" as const,
      outcome: "no_show" as const,
      recordedByUserId: fixture.adminId,
      reason: "Player reported they could not attend",
      idempotencyKey,
    };

    const first = await services.service.recordAttendance(input);
    const replay = await services.service.recordAttendance(input);

    expect(first.session?.draftVersion).toBe(2);
    expect(replay.session?.draftVersion).toBe(2);
    expect(replay.participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: fixture.playerId,
          outcome: "no_show",
        }),
      ]),
    );
    await expect(
      services.service.recordAttendance({
        ...input,
        outcome: "attended",
        reason: null,
      }),
    ).rejects.toThrow("session completion changed");

    const state = await env.DB.prepare(
      `SELECT
         (SELECT draft_version FROM session_completions
          WHERE guild_id = ? AND source_event_id = ?) AS draft_version,
         (SELECT count(*) FROM session_completion_events
          WHERE guild_id = ? AND idempotency_key = ?) AS event_count,
         (SELECT attendance_outcome
          FROM session_completion_draft_participants participant
          JOIN session_completions session
            ON session.session_id = participant.session_id
           AND session.guild_id = participant.guild_id
          WHERE session.guild_id = ? AND session.source_event_id = ?
            AND participant.user_id = ?) AS attendance_outcome`,
    ).bind(
      fixture.guildId,
      fixture.eventId,
      fixture.guildId,
      `session:attendance:${idempotencyKey}`,
      fixture.guildId,
      fixture.eventId,
      fixture.playerId,
    ).first<{
      draft_version: number;
      event_count: number;
      attendance_outcome: string;
    }>();
    expect(state).toEqual({
      draft_version: 2,
      event_count: 1,
      attendance_outcome: "no_show",
    });
  });
});
