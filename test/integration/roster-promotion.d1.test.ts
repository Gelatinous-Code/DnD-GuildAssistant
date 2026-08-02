import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { GuildRepository } from "../../src/storage/repository";

describe("global roster promotion persistence", () => {
  it("promotes exactly the first bench player before open seating and queues one DM", async () => {
    const prefix = crypto.randomUUID();
    const guildId = `${prefix}:guild`;
    const eventId = `${prefix}:event`;
    const planId = `${prefix}:plan`;
    const tableId = `${prefix}:table`;
    const departingId = `${prefix}:departing`;
    const firstBenchId = `${prefix}:bench:1`;
    const secondBenchId = `${prefix}:bench:2`;
    let now = Date.parse("2026-08-09T18:00:00Z");
    const openSeatingAt = Date.parse("2026-08-10T23:00:00Z");
    const startsAt = Date.parse("2026-08-12T00:00:00Z");

    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO guild_config (guild_id, timezone) VALUES (?, 'America/Denver')",
      ).bind(guildId),
      env.DB.prepare(
        `INSERT INTO weekly_events (
           event_id, guild_id, title, starts_at, ends_at, signup_opens_at,
           player_signup_opens_at, signup_locks_at, open_seating_at,
           table_selection_closes_at, status, published_at
         ) VALUES (?, ?, 'Roster integration game', ?, ?, ?, ?, ?, ?, ?, 'published', ?)`,
      ).bind(
        eventId,
        guildId,
        startsAt,
        startsAt + 3 * 60 * 60_000,
        startsAt - 7 * 86_400_000,
        startsAt - 6 * 86_400_000,
        startsAt - 3 * 86_400_000,
        openSeatingAt,
        startsAt,
        now - 1_000,
      ),
      env.DB.prepare(
        `INSERT INTO plans (
           plan_id, event_id, generation, status, algorithm_version,
           min_table_size, preferred_table_size, max_table_size,
           player_count, gm_signup_count, selected_gm_count, waitlist_count,
           published_at
         ) VALUES (?, ?, 1, 'published', 'roster-integration-v1',
           1, 1, 1, 3, 1, 1, 2, ?)`,
      ).bind(planId, eventId, now - 1_000),
      env.DB.prepare(
        `INSERT INTO plan_tables (
           table_id, plan_id, table_number, title, capacity,
           gm_user_id, gm_display_name
         ) VALUES (?, ?, 1, 'Integration Table', 1, ?, 'Integration GM')`,
      ).bind(tableId, planId, `${prefix}:gm`),
      env.DB.prepare(
        `INSERT INTO assignments (
           assignment_id, plan_id, table_id, desired_table_id, user_id,
           display_name, status, roster_status, roster_rank, assigned_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'Departing Player', 'assigned',
           'reserved', 1, ?, ?)`,
      ).bind(
        `${prefix}:assignment:departing`,
        planId,
        tableId,
        tableId,
        departingId,
        now - 500,
        now - 500,
      ),
      env.DB.prepare(
        `INSERT INTO assignments (
           assignment_id, plan_id, user_id, display_name, status,
           roster_status, roster_rank, updated_at
         ) VALUES (?, ?, ?, 'First Bench', 'unassigned', 'bench', 2, ?)`,
      ).bind(`${prefix}:assignment:bench:1`, planId, firstBenchId, now - 400),
      env.DB.prepare(
        `INSERT INTO assignments (
           assignment_id, plan_id, user_id, display_name, status,
           roster_status, roster_rank, updated_at
         ) VALUES (?, ?, ?, 'Second Bench', 'unassigned', 'bench', 3, ?)`,
      ).bind(`${prefix}:assignment:bench:2`, planId, secondBenchId, now - 300),
    ]);

    const repository = new GuildRepository(env.DB, () => now);
    const duplicateResults = await Promise.all([
      repository.withdrawAssignmentAndPromote(planId, departingId, true),
      repository.withdrawAssignmentAndPromote(planId, departingId, true),
    ]);
    const withdrawn = duplicateResults.find((item) => item.left) ?? duplicateResults[0];
    expect(duplicateResults.filter((item) => item.left)).toHaveLength(1);

    expect(withdrawn.rosterPromoted).toMatchObject({
      userId: firstBenchId,
      rosterStatus: "reserved",
      rosterRank: 2,
      rosterPromotedAt: now,
    });
    expect(await repository.getAssignment(planId, secondBenchId)).toMatchObject({
      rosterStatus: "bench",
      rosterRank: 3,
    });

    const due = await repository.listDueRosterPromotionNotifications(now);
    expect(due).toEqual([
      expect.objectContaining({
        assignmentId: `${prefix}:assignment:bench:1`,
        recipientUserId: firstBenchId,
        openSeatingAt,
        eventStartsAt: startsAt,
        attemptCount: 0,
      }),
    ]);
    expect(
      await repository.claimRosterPromotionNotification(due[0].assignmentId, now),
    ).toBe(true);
    expect(
      await repository.claimRosterPromotionNotification(due[0].assignmentId, now),
    ).toBe(false);
    expect(
      await repository.markRosterPromotionNotificationSent(
        due[0].assignmentId,
        `${prefix}:dm-channel`,
        `${prefix}:dm-message`,
        now,
      ),
    ).toBe(true);
    expect(await repository.listDueRosterPromotionNotifications(now)).toEqual([]);

    now = openSeatingAt + 1;
    const lateDrop = await repository.withdrawAssignmentAndPromote(
      planId,
      firstBenchId,
      false,
    );
    expect(lateDrop.rosterPromoted).toBeNull();
    expect(await repository.getAssignment(planId, secondBenchId)).toMatchObject({
      rosterStatus: "bench",
      rosterRank: 3,
    });

    const lateSignupId = `${prefix}:late-signup`;
    await env.DB.prepare(
      `INSERT INTO signups (
         event_id, user_id, display_name, signup_kind, status, source,
         signed_up_at, updated_at
       ) VALUES (?, ?, 'Late Signup', 'player', 'active', 'native', ?, ?)`,
    ).bind(eventId, lateSignupId, now, now).run();
    const lateAssignment = await repository.ensureUnassignedAssignment({
      assignmentId: `${prefix}:assignment:late-signup`,
      planId,
      userId: lateSignupId,
      displayName: "Late Signup",
    });

    expect(lateAssignment).toMatchObject({
      userId: lateSignupId,
      status: "unassigned",
      rosterStatus: "reserved",
      rosterRank: 4,
    });
    expect(await repository.getAssignment(planId, secondBenchId)).toMatchObject({
      rosterStatus: "bench",
    });
  });
});
