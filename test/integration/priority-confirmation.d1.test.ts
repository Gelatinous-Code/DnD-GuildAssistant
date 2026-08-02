import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { InteractionType, type DiscordInteraction } from "../../src/discord";
import { UserFacingError } from "../../src/interaction-utils";
import { handleM6Command, handleM6Component } from "../../src/m6-app";
import { PriorityConfirmationRepository } from
  "../../src/storage/priority-confirmation-repository";
import { PriorityRepository } from "../../src/storage/priority-repository";

interface ConfirmationFixture {
  prefix: string;
  guildId: string;
  otherGuildId: string;
  userId: string;
  eventId: string;
  planId: string;
  tableId: string;
  assignmentId: string;
  earlyCreditId: string;
  eligibleCreditId: string;
  now: number;
  startsAt: number;
  closesAt: number;
}

interface InteractionPayload {
  type: number;
  data: {
    content: string;
    components?: Array<{
      components: Array<{ custom_id?: string }>;
    }>;
  };
}

async function seedFixture(): Promise<ConfirmationFixture> {
  const prefix = crypto.randomUUID();
  const now = Date.now();
  const startsAt = now + 5 * 60_000;
  const closesAt = now + 2 * 60_000;
  const fixture: ConfirmationFixture = {
    prefix,
    guildId: `${prefix}:guild`,
    otherGuildId: `${prefix}:other-guild`,
    userId: `${prefix}:member`,
    eventId: `${prefix}:event`,
    planId: `${prefix}:plan`,
    tableId: `${prefix}:table`,
    assignmentId: `${prefix}:assignment`,
    earlyCreditId: `${prefix}:credit-early`,
    eligibleCreditId: `${prefix}:credit-eligible`,
    now,
    startsAt,
    closesAt,
  };
  const sourceEventId = `${prefix}:source-event`;
  const sourcePlanId = `${prefix}:source-plan`;
  const sourceTableId = `${prefix}:source-table`;

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO guild_config (guild_id, timezone) VALUES (?, 'America/Denver')",
    ).bind(fixture.guildId),
    env.DB.prepare(
      `INSERT INTO weekly_events (
         event_id, guild_id, title, starts_at, ends_at, signup_opens_at,
         signup_locks_at, table_selection_closes_at, status, archived_at
       ) VALUES (?, ?, 'Completed source game', ?, ?, ?, ?, ?, 'archived', ?)`,
    ).bind(
      sourceEventId,
      fixture.guildId,
      now - 10 * 60_000,
      now - 5 * 60_000,
      now - 20 * 60_000,
      now - 15 * 60_000,
      now - 6 * 60_000,
      now - 5 * 60_000,
    ),
    env.DB.prepare(
      `INSERT INTO plans (
         plan_id, event_id, generation, status, algorithm_version,
         min_table_size, preferred_table_size, max_table_size,
         player_count, gm_signup_count, selected_gm_count, published_at
       ) VALUES (?, ?, 1, 'published', 'confirmation-test', 1, 2, 2, 1, 1, 1, ?)`,
    ).bind(sourcePlanId, sourceEventId, now - 11 * 60_000),
    env.DB.prepare(
      `INSERT INTO plan_tables (
         table_id, plan_id, table_number, title, capacity,
         gm_user_id, gm_display_name
       ) VALUES (?, ?, 1, 'Completed Table', 2, ?, 'Priority DM')`,
    ).bind(sourceTableId, sourcePlanId, fixture.userId),
    env.DB.prepare(
      `INSERT INTO weekly_events (
         event_id, guild_id, title, starts_at, ends_at, signup_opens_at,
         signup_locks_at, table_selection_closes_at, status, published_at
       ) VALUES (?, ?, 'Upcoming Game', ?, ?, ?, ?, ?, 'published', ?)`,
    ).bind(
      fixture.eventId,
      fixture.guildId,
      fixture.startsAt,
      fixture.startsAt + 4 * 60 * 60_000,
      now - 7 * 24 * 60 * 60_000,
      now - 60_000,
      fixture.closesAt,
      now - 30_000,
    ),
    env.DB.prepare(
      `INSERT INTO plans (
         plan_id, event_id, generation, status, algorithm_version,
         min_table_size, preferred_table_size, max_table_size,
         player_count, gm_signup_count, selected_gm_count, published_at
       ) VALUES (?, ?, 1, 'published', 'confirmation-test', 1, 2, 2, 1, 1, 1, ?)`,
    ).bind(fixture.planId, fixture.eventId, now - 30_000),
    env.DB.prepare(
      `INSERT INTO plan_tables (
         table_id, plan_id, table_number, title, capacity,
         gm_user_id, gm_display_name
       ) VALUES (?, ?, 1, 'Upcoming Table', 2, ?, 'Upcoming DM')`,
    ).bind(fixture.tableId, fixture.planId, `${prefix}:upcoming-dm`),
    env.DB.prepare(
      `INSERT INTO signups (
         event_id, user_id, display_name, signup_kind, status, signed_up_at
       ) VALUES (?, ?, 'Priority Member', 'player', 'active', ?)`,
    ).bind(fixture.eventId, fixture.userId, now - 50_000),
    env.DB.prepare(
      `INSERT INTO assignments (
         assignment_id, plan_id, user_id, display_name, status,
         updated_at, seat_request_version
       ) VALUES (?, ?, ?, 'Priority Member', 'unassigned', ?, 0)`,
    ).bind(fixture.assignmentId, fixture.planId, fixture.userId, now - 40_000),
  ]);

  const priority = new PriorityRepository(env.DB, () => now);
  await priority.grantCompletedSessionReward({
    grantId: `${prefix}:grant`,
    creditIds: [fixture.earlyCreditId, fixture.eligibleCreditId],
    guildId: fixture.guildId,
    completionRevisionId: `${prefix}:completion`,
    sourceEventId,
    sourcePlanId,
    sourceTableId,
    dmUserId: fixture.userId,
    policyVersion: "dm-priority-v1",
    earnedTimeZone: "America/Denver",
    earnedAt: now - 10 * 60_000,
    expiresAt: fixture.startsAt + 60 * 60_000,
    grantedByUserId: `${prefix}:organizer`,
    idempotencyKey: `${prefix}:grant-operation`,
  });
  await env.DB.prepare(
    "UPDATE dm_priority_credits SET expires_at = ? WHERE credit_id = ? AND guild_id = ?",
  ).bind(
    fixture.startsAt - 1,
    fixture.earlyCreditId,
    fixture.guildId,
  ).run();
  return fixture;
}

function priorityCommand(
  fixture: ConfirmationFixture,
  userId = fixture.userId,
): DiscordInteraction {
  return {
    type: InteractionType.ApplicationCommand,
    guild_id: fixture.guildId,
    member: { user: { id: userId } },
    data: {
      name: "priority",
      options: [{
        type: 1,
        name: "use",
        options: [
          { type: 4, name: "table_number", value: 1 },
          // A stale registration may still send this old option. It must never
          // bypass the persisted private preview.
          { type: 5, name: "confirm", value: true },
        ],
      }],
    },
  };
}

function componentInteraction(
  fixture: ConfirmationFixture,
  userId = fixture.userId,
): DiscordInteraction {
  return {
    type: InteractionType.MessageComponent,
    guild_id: fixture.guildId,
    member: { user: { id: userId } },
  };
}

async function createPreview(fixture: ConfirmationFixture): Promise<{
  previewId: string;
  payload: InteractionPayload;
}> {
  const response = await handleM6Command(priorityCommand(fixture), env);
  if (!response) throw new Error("The priority command was not handled");
  const payload = await response.json() as InteractionPayload;
  const customId = payload.data.components?.[0]?.components[0]?.custom_id;
  if (!customId) throw new Error("The confirmation button was not rendered");
  const parts = customId.split(":");
  expect(parts.slice(0, 3)).toEqual(["guild", "priority", "confirm"]);
  if (!parts[3]) throw new Error("The confirmation preview ID was not rendered");
  return { previewId: parts[3], payload };
}

describe("persisted priority confirmation previews", () => {
  it("makes /priority use preview-only and binds the earliest event-eligible token", async () => {
    const fixture = await seedFixture();
    const { previewId, payload } = await createPreview(fixture);
    const previews = new PriorityConfirmationRepository(env.DB);
    const preview = await previews.get(fixture.guildId, previewId, fixture.userId);

    expect(payload.data.content).toContain("## Confirm DM Priority Token");
    expect(payload.data.content).toContain("Current balance:** 2 tokens");
    expect(preview).toMatchObject({
      guildId: fixture.guildId,
      userId: fixture.userId,
      eventId: fixture.eventId,
      planId: fixture.planId,
      tableId: fixture.tableId,
      assignmentId: fixture.assignmentId,
      assignmentVersion: 0,
      tableStateVersion: 0,
      creditId: fixture.eligibleCreditId,
      tableWasFull: false,
      usedAt: null,
    });
    const state = await env.DB.prepare(
      `SELECT
         (SELECT count(*) FROM priority_seating_operations WHERE guild_id = ?) AS operations,
         (SELECT count(*) FROM dm_priority_credits
          WHERE guild_id = ? AND status = 'reserved') AS reserved`,
    ).bind(fixture.guildId, fixture.guildId).first<{
      operations: number;
      reserved: number;
    }>();
    expect(state).toEqual({ operations: 0, reserved: 0 });
  });

  it("scopes the button to one guild/member and safely replays a used preview", async () => {
    const fixture = await seedFixture();
    const { previewId } = await createPreview(fixture);
    const previews = new PriorityConfirmationRepository(env.DB);

    await expect(
      handleM6Component(
        componentInteraction(fixture, `${fixture.prefix}:intruder`),
        env,
        { kind: "priority", action: "confirm", previewId },
      ),
    ).rejects.toEqual(expect.objectContaining({
      message: expect.stringContaining("confirmation preview expired"),
    }));
    expect(await previews.get(fixture.otherGuildId, previewId, fixture.userId)).toBeNull();
    expect(await previews.get(
      fixture.guildId,
      previewId,
      `${fixture.prefix}:intruder`,
    )).toBeNull();

    const firstResponse = await handleM6Component(
      componentInteraction(fixture),
      env,
      { kind: "priority", action: "confirm", previewId },
    );
    const firstPayload = await firstResponse.json() as InteractionPayload;
    expect(firstPayload.data.content).toContain("seat at **Upcoming Table** is protected");

    const replayResponse = await handleM6Component(
      componentInteraction(fixture),
      env,
      { kind: "priority", action: "confirm", previewId },
    );
    const replayPayload = await replayResponse.json() as InteractionPayload;
    expect(replayPayload.data.content).toContain("already completed");
    expect(replayPayload.data.content).toContain("No additional token was reserved");

    expect((await previews.get(fixture.guildId, previewId, fixture.userId))?.usedAt)
      .toEqual(expect.any(Number));
    const state = await env.DB.prepare(
      `SELECT
         (SELECT count(*) FROM priority_seating_operations WHERE guild_id = ?) AS operations,
         (SELECT count(*) FROM dm_priority_credits
          WHERE guild_id = ? AND status = 'reserved') AS reserved,
         (SELECT status FROM dm_priority_credits
          WHERE guild_id = ? AND credit_id = ?) AS eligible_status,
         (SELECT status FROM dm_priority_credits
          WHERE guild_id = ? AND credit_id = ?) AS early_status`,
    ).bind(
      fixture.guildId,
      fixture.guildId,
      fixture.guildId,
      fixture.eligibleCreditId,
      fixture.guildId,
      fixture.earlyCreditId,
    ).first<{
      operations: number;
      reserved: number;
      eligible_status: string;
      early_status: string;
    }>();
    expect(state).toEqual({
      operations: 1,
      reserved: 1,
      eligible_status: "reserved",
      early_status: "available",
    });
  });

  it("rejects and cleans up an expired preview without mutating priority", async () => {
    const fixture = await seedFixture();
    const { previewId } = await createPreview(fixture);
    const previews = new PriorityConfirmationRepository(env.DB);
    await env.DB.prepare(
      "UPDATE priority_confirmation_previews SET expires_at = ? WHERE preview_id = ?",
    ).bind(fixture.now - 1, previewId).run();

    await expect(
      handleM6Component(
        componentInteraction(fixture),
        env,
        { kind: "priority", action: "confirm", previewId },
      ),
    ).rejects.toBeInstanceOf(UserFacingError);
    await expect(
      handleM6Component(
        componentInteraction(fixture),
        env,
        { kind: "priority", action: "confirm", previewId },
      ),
    ).rejects.toEqual(expect.objectContaining({
      message: expect.stringContaining("confirmation preview expired"),
    }));
    expect(await previews.deleteExpired(fixture.now, 500)).toBe(1);
    expect(await previews.get(fixture.guildId, previewId, fixture.userId)).toBeNull();
    const reserved = await env.DB.prepare(
      "SELECT count(*) AS count FROM dm_priority_credits WHERE guild_id = ? AND status = 'reserved'",
    ).bind(fixture.guildId).first<{ count: number }>();
    expect(reserved?.count).toBe(0);
  });

  it("rejects a bound confirmation when exact table state becomes stale", async () => {
    const fixture = await seedFixture();
    const { previewId } = await createPreview(fixture);
    const previews = new PriorityConfirmationRepository(env.DB);
    await env.DB.prepare(
      `UPDATE weekly_events SET table_state_version = table_state_version + 1
       WHERE event_id = ? AND guild_id = ?`,
    ).bind(fixture.eventId, fixture.guildId).run();

    await expect(
      handleM6Component(
        componentInteraction(fixture),
        env,
        { kind: "priority", action: "confirm", previewId },
      ),
    ).rejects.toEqual(expect.objectContaining({
      message: "This confirmation preview is stale. Preview priority again before changing a seat.",
    }));
    expect((await previews.get(fixture.guildId, previewId, fixture.userId))?.usedAt)
      .toBeNull();
    const state = await env.DB.prepare(
      `SELECT
         (SELECT count(*) FROM priority_seating_operations WHERE guild_id = ?) AS operations,
         (SELECT count(*) FROM dm_priority_credits
          WHERE guild_id = ? AND status = 'reserved') AS reserved`,
    ).bind(fixture.guildId, fixture.guildId).first<{
      operations: number;
      reserved: number;
    }>();
    expect(state).toEqual({ operations: 0, reserved: 0 });
  });
});
