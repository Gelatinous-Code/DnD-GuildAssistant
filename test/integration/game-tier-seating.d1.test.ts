import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  GuildRepository,
  TableSelectionUnavailableError,
} from "../../src/storage/repository";

describe("game-tier seating D1 boundary", () => {
  it("persists signup, backup, table, and assignment tier snapshots", async () => {
    const prefix = crypto.randomUUID();
    const guildId = `${prefix}:guild`;
    const eventId = `${prefix}:event`;
    const planId = `${prefix}:plan`;
    const now = Date.now();
    const startsAt = now + 86_400_000;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO guild_config (guild_id, created_at, updated_at) VALUES (?, ?, ?)",
      ).bind(guildId, now, now),
      env.DB.prepare(
        `INSERT INTO weekly_events (
           event_id, guild_id, title, starts_at, ends_at, signup_opens_at,
           signup_locks_at, table_selection_closes_at, status, created_at,
           updated_at
         ) VALUES (?, ?, 'Tier persistence', ?, ?, ?, ?, ?, 'locked', ?, ?)`,
      ).bind(
        eventId,
        guildId,
        startsAt,
        startsAt + 3 * 60 * 60_000,
        now - 86_400_000,
        now - 60_000,
        startsAt,
        now,
        now,
      ),
    ]);
    const repository = new GuildRepository(env.DB, () => now);
    await repository.saveSignup({
      eventId,
      userId: `${prefix}:gm`,
      displayName: "GM",
      signupKind: "gm",
      gameTier: 2,
      gmCommitment: "primary",
    });
    await repository.saveSignup({
      eventId,
      userId: `${prefix}:backup`,
      displayName: "Backup",
      signupKind: "gm",
      gameTier: null,
      gmCommitment: "backup",
    });
    await repository.saveSignup({
      eventId,
      userId: `${prefix}:player`,
      displayName: "Player",
      signupKind: "player",
      gameTier: 2,
    });

    await expect(repository.countActiveSignups(eventId)).resolves.toEqual({
      players: 1,
      gms: 1,
      gmBackups: 1,
    });
    const bundle = await repository.saveDraftPlan({
      plan: {
        planId,
        eventId,
        generation: 1,
        algorithmVersion: "tier-test",
        minTableSize: 1,
        preferredTableSize: 2,
        maxTableSize: 2,
        playerCount: 1,
        gmSignupCount: 1,
        selectedGmCount: 1,
        waitlistCount: 0,
        createdByUserId: null,
      },
      tables: [{
        tableId: `${prefix}:table`,
        tableNumber: 1,
        gameTier: 2,
        title: "Tier 2",
        capacity: 2,
        gmUserId: `${prefix}:gm`,
        gmDisplayName: "GM",
      }],
      assignments: [{
        assignmentId: `${prefix}:assignment`,
        tableId: null,
        userId: `${prefix}:player`,
        displayName: "Player",
        gameTier: 2,
        status: "unassigned",
        waitlistPosition: null,
        rosterStatus: "reserved",
        rosterRank: 1,
      }],
    });

    expect(bundle.tables[0]).toMatchObject({ gameTier: 2 });
    expect(bundle.assignments[0]).toMatchObject({ gameTier: 2, rosterRank: 1 });
  });

  it("rejects a cross-tier table atomically and accepts a same-tier table", async () => {
    const prefix = crypto.randomUUID();
    const guildId = `${prefix}:guild`;
    const eventId = `${prefix}:event`;
    const planId = `${prefix}:plan`;
    const userId = `${prefix}:player`;
    const legacyUserId = `${prefix}:legacy-player`;
    const tierOneTableId = `${prefix}:table:t1`;
    const tierTwoTableId = `${prefix}:table:t2`;
    const legacyTableId = `${prefix}:table:legacy`;
    const assignmentId = `${prefix}:assignment`;
    const now = Date.now();
    const startsAt = now + 86_400_000;

    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO guild_config (guild_id, created_at, updated_at) VALUES (?, ?, ?)",
      ).bind(guildId, now, now),
      env.DB.prepare(
        `INSERT INTO weekly_events (
           event_id, guild_id, title, starts_at, ends_at, signup_opens_at,
           signup_locks_at, table_selection_closes_at, status, created_at,
           updated_at, published_at
         ) VALUES (?, ?, 'Tier test', ?, ?, ?, ?, ?, 'published', ?, ?, ?)`,
      ).bind(
        eventId,
        guildId,
        startsAt,
        startsAt + 3 * 60 * 60_000,
        now - 86_400_000,
        now - 60_000,
        startsAt,
        now,
        now,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO plans (
           plan_id, event_id, generation, status, algorithm_version,
           min_table_size, preferred_table_size, max_table_size, player_count,
           gm_signup_count, selected_gm_count, waitlist_count, created_at,
           published_at
         ) VALUES (?, ?, 1, 'published', 'tier-test', 1, 2, 2, 1, 2, 2, 0, ?, ?)`,
      ).bind(planId, eventId, now, now),
      env.DB.prepare(
        `INSERT INTO plan_tables (
           table_id, plan_id, table_number, game_tier, title, capacity,
           gm_user_id, gm_display_name, created_at
         ) VALUES (?, ?, 1, 1, 'Tier 1', 2, ?, 'GM 1', ?)`,
      ).bind(tierOneTableId, planId, `${prefix}:gm:t1`, now),
      env.DB.prepare(
        `INSERT INTO plan_tables (
           table_id, plan_id, table_number, game_tier, title, capacity,
           gm_user_id, gm_display_name, created_at
         ) VALUES (?, ?, 2, 2, 'Tier 2', 2, ?, 'GM 2', ?)`,
      ).bind(tierTwoTableId, planId, `${prefix}:gm:t2`, now),
      env.DB.prepare(
        `INSERT INTO plan_tables (
           table_id, plan_id, table_number, game_tier, title, capacity,
           gm_user_id, gm_display_name, created_at
         ) VALUES (?, ?, 3, NULL, 'Legacy table', 1, ?, 'Legacy GM', ?)`,
      ).bind(legacyTableId, planId, `${prefix}:gm:legacy`, now),
      env.DB.prepare(
        `INSERT INTO signups (
           event_id, user_id, display_name, signup_kind, status, source,
           signed_up_at, updated_at, game_tier
         ) VALUES (?, ?, 'Player', 'player', 'active', 'native', ?, ?, 1)`,
      ).bind(eventId, userId, now, now),
      env.DB.prepare(
        `INSERT INTO assignments (
           assignment_id, plan_id, user_id, display_name, game_tier, status,
           roster_status, roster_rank, updated_at
         ) VALUES (?, ?, ?, 'Player', 1, 'unassigned', 'reserved', 1, ?)`,
      ).bind(assignmentId, planId, userId, now),
      env.DB.prepare(
        `INSERT INTO assignments (
           assignment_id, plan_id, user_id, display_name, game_tier, status,
           roster_status, roster_rank, updated_at
         ) VALUES (?, ?, ?, 'Legacy Player', NULL, 'unassigned', 'reserved', 1, ?)`,
      ).bind(`${prefix}:legacy-assignment`, planId, legacyUserId, now),
    ]);

    // Fill Tier 1 before the player moves to Tier 2. A revival that uses the
    // old tier would incorrectly bench the player and continue Tier 1's rank.
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE assignments SET roster_rank = 3
         WHERE assignment_id = ?`,
      ).bind(assignmentId),
      env.DB.prepare(
        `INSERT INTO assignments (
           assignment_id, plan_id, user_id, display_name, game_tier, status,
           roster_status, roster_rank, updated_at
         ) VALUES (?, ?, ?, 'Tier 1 filler A', 1, 'unassigned', 'reserved', 1, ?)`,
      ).bind(`${prefix}:filler:a`, planId, `${prefix}:filler-user:a`, now),
      env.DB.prepare(
        `INSERT INTO assignments (
           assignment_id, plan_id, user_id, display_name, game_tier, status,
           roster_status, roster_rank, updated_at
         ) VALUES (?, ?, ?, 'Tier 1 filler B', 1, 'unassigned', 'reserved', 2, ?)`,
      ).bind(`${prefix}:filler:b`, planId, `${prefix}:filler-user:b`, now),
    ]);

    const repository = new GuildRepository(env.DB, () => now);
    await expect(
      repository.joinOrWaitlist(planId, userId, tierTwoTableId),
    ).rejects.toBeInstanceOf(TableSelectionUnavailableError);
    await expect(
      repository.joinOrWaitlist(planId, userId, tierOneTableId),
    ).resolves.toMatchObject({
      outcome: "assigned",
      assignment: {
        userId,
        gameTier: 1,
        tableId: tierOneTableId,
      },
    });
    await expect(
      repository.joinOrWaitlist(planId, legacyUserId, legacyTableId),
    ).resolves.toMatchObject({
      outcome: "assigned",
      assignment: {
        userId: legacyUserId,
        gameTier: null,
        tableId: legacyTableId,
      },
    });

    await repository.withdrawAssignmentAndPromote(planId, userId, false);
    await repository.saveSignup({
      eventId,
      userId,
      displayName: "Player",
      signupKind: "player",
      gameTier: 2,
    });
    await expect(
      repository.ensureUnassignedAssignment({
        assignmentId: `${prefix}:replacement`,
        planId,
        userId,
        displayName: "Player",
      }),
    ).resolves.toMatchObject({
      assignmentId,
      gameTier: 2,
      status: "unassigned",
      rosterStatus: "reserved",
      rosterRank: 1,
    });
  });
});
