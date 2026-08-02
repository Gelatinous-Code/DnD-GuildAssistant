import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PriorityIdempotencyConflictError,
  PriorityRepository,
  type GrantCompletedSessionRewardInput,
} from "../src/storage/priority-repository";

function result(changes = 0): D1Result {
  return {
    success: true,
    results: [],
    meta: {
      duration: 0,
      size_after: 0,
      rows_read: 0,
      rows_written: changes,
      last_row_id: 0,
      changed_db: changes > 0,
      changes,
    },
  };
}

class FakeStatement {
  values: unknown[] = [];

  constructor(
    readonly sql: string,
    private readonly database: FakeDatabase,
  ) {}

  bind(...values: unknown[]): FakeStatement {
    this.values = values;
    return this;
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.database.firstResults.shift() ?? null) as T | null;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return {
      ...result(),
      results: (this.database.allResults.shift() ?? []) as T[],
    } as D1Result<T>;
  }
}

class FakeDatabase {
  readonly statements: FakeStatement[] = [];
  readonly batches: FakeStatement[][] = [];
  readonly firstResults: unknown[] = [];
  readonly allResults: unknown[][] = [];
  readonly batchResults: D1Result[][] = [];

  prepare(sql: string): FakeStatement {
    const statement = new FakeStatement(sql, this);
    this.statements.push(statement);
    return statement;
  }

  async batch(statements: FakeStatement[]): Promise<D1Result[]> {
    this.batches.push(statements);
    return this.batchResults.shift() ?? [];
  }
}

const grantInput: GrantCompletedSessionRewardInput = {
  grantId: "grant-1",
  creditIds: ["credit-1", "credit-2"],
  guildId: "guild-1",
  completionRevisionId: "completion-1-rev-1",
  sourceEventId: "event-1",
  sourcePlanId: "plan-1",
  sourceTableId: "table-1",
  dmUserId: "dm-1",
  policyVersion: "dm-priority-v1",
  earnedTimeZone: "America/Denver",
  earnedAt: 1_000,
  expiresAt: 2_000,
  grantedByUserId: "admin-1",
  idempotencyKey: "grant:completion-1-rev-1",
};

function grantRow(overrides: Record<string, unknown> = {}) {
  return {
    grant_id: "grant-1",
    guild_id: "guild-1",
    completion_revision_id: "completion-1-rev-1",
    source_event_id: "event-1",
    source_plan_id: "plan-1",
    source_table_id: "table-1",
    dm_user_id: "dm-1",
    policy_version: "dm-priority-v1",
    earned_timezone: "America/Denver",
    earned_at: 1_000,
    expires_at: 2_000,
    granted_by_user_id: "admin-1",
    idempotency_key: "grant:completion-1-rev-1",
    status: "active",
    corrected_at: null,
    corrected_by_user_id: null,
    correction_reason: null,
    correction_key: null,
    created_at: 1_000,
    updated_at: 1_000,
    ...overrides,
  };
}

function creditRow(
  ordinal: 1 | 2 = 1,
  overrides: Record<string, unknown> = {},
) {
  return {
    credit_id: `credit-${ordinal}`,
    grant_id: "grant-1",
    guild_id: "guild-1",
    user_id: "dm-1",
    ordinal,
    earned_at: 1_000,
    expires_at: 2_000,
    status: "available",
    target_event_id: null,
    target_assignment_id: null,
    reserved_at: null,
    redeemed_at: null,
    last_operation_key: null,
    version: 1,
    created_at: 1_000,
    updated_at: 1_000,
    ...overrides,
  };
}

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    credit_event_id: "transition-1",
    guild_id: "guild-1",
    credit_id: "credit-1",
    idempotency_key: "reserve:event-2:dm-1",
    action: "reserved",
    from_status: "available",
    to_status: "reserved",
    credit_version: 2,
    target_event_id: "event-2",
    target_assignment_id: null,
    actor_user_id: "dm-1",
    reason: null,
    details_json: null,
    occurred_at: 1_500,
    ...overrides,
  };
}

describe("DM priority D1 migration", () => {
  it("enforces exactly two ordinals, tenant keys, active-use uniqueness, and immutable events", () => {
    const migration = readFileSync("migrations/0005_dm_priority_credits.sql", "utf8");
    expect(migration).toContain("CREATE TABLE dm_priority_grants");
    expect(migration).toContain("UNIQUE (guild_id, completion_revision_id)");
    expect(migration).toContain("ordinal INTEGER NOT NULL CHECK (ordinal IN (1, 2))");
    expect(migration).toContain("WHERE status IN ('reserved', 'redeemed')");
    expect(migration).toContain("UNIQUE (credit_id, credit_version)");
    expect(migration).toContain("ON DELETE RESTRICT");
  });
});

describe("PriorityRepository", () => {
  it("finds an active grant by tenant-scoped source table", async () => {
    const fake = new FakeDatabase();
    fake.firstResults.push(grantRow());
    const repository = new PriorityRepository(fake as unknown as D1Database);

    await expect(
      repository.getActiveGrantForSourceTable("guild-1", "event-1", "table-1"),
    ).resolves.toMatchObject({ grantId: "grant-1", status: "active" });
    expect(fake.statements[0]?.values).toEqual(["guild-1", "event-1", "table-1"]);
    expect(fake.statements[0]?.sql).toContain("status = 'active'");
  });

  it("atomically creates one grant, two credits, and two grant events", async () => {
    const fake = new FakeDatabase();
    fake.batchResults.push([
      result(1),
      result(1),
      result(1),
      result(1),
      result(1),
    ]);
    fake.firstResults.push(grantRow());
    fake.allResults.push([creditRow(1), creditRow(2)]);
    const repository = new PriorityRepository(fake as unknown as D1Database, () => 1_000);

    const saved = await repository.grantCompletedSessionReward(grantInput);

    expect(saved.created).toBe(true);
    expect(saved.credits.map((credit) => credit.ordinal)).toEqual([1, 2]);
    expect(fake.batches[0]).toHaveLength(5);
    expect(fake.batches[0]?.[0]?.sql).toContain(
      "ON CONFLICT(guild_id, completion_revision_id) DO NOTHING",
    );
    expect(fake.batches[0]?.[0]?.sql).not.toContain("INSERT OR IGNORE");
    expect(fake.batches[0]?.[1]?.sql).toContain("ON CONFLICT(grant_id, ordinal) DO NOTHING");
    expect(fake.batches[0]?.[3]?.sql).toContain("ON CONFLICT(credit_id, credit_version)");
  });

  it("rejects a retry whose completion revision points at different source data", async () => {
    const fake = new FakeDatabase();
    fake.batchResults.push([result(), result(), result(), result(), result()]);
    fake.firstResults.push(grantRow({ source_table_id: "other-table" }));
    const repository = new PriorityRepository(fake as unknown as D1Database, () => 1_100);

    await expect(repository.grantCompletedSessionReward(grantInput)).rejects.toBeInstanceOf(
      PriorityIdempotencyConflictError,
    );
  });

  it("orders available tenant credits by expiry, earned time, and stable ID", async () => {
    const fake = new FakeDatabase();
    fake.allResults.push([]);
    const repository = new PriorityRepository(fake as unknown as D1Database, () => 1_500);

    await repository.listAvailableCredits("guild-1", "dm-1", 1_500);

    expect(fake.statements[0]?.sql).toContain("guild_id = ? AND user_id = ?");
    expect(fake.statements[0]?.sql).toContain("earned_at <= ? AND expires_at > ?");
    expect(fake.statements[0]?.sql).toContain(
      "ORDER BY expires_at ASC, earned_at ASC, credit_id ASC",
    );
    expect(fake.statements[0]?.values).toEqual(["guild-1", "dm-1", 1_500, 1_500]);
  });

  it("reserves in one tenant-scoped transaction with signup and both time guards", async () => {
    const fake = new FakeDatabase();
    fake.batchResults.push([result(1), result(1)]);
    fake.firstResults.push(
      eventRow(),
      creditRow(1, {
        status: "reserved",
        target_event_id: "event-2",
        reserved_at: 1_500,
        last_operation_key: "reserve:event-2:dm-1",
        version: 2,
        updated_at: 1_500,
      }),
    );
    const repository = new PriorityRepository(fake as unknown as D1Database, () => 1_500);

    const reserved = await repository.reserveNextCredit({
      creditEventId: "transition-1",
      guildId: "guild-1",
      userId: "dm-1",
      targetEventId: "event-2",
      reservedAt: 1_500,
      actorUserId: "dm-1",
      idempotencyKey: "reserve:event-2:dm-1",
    });

    expect(reserved).toMatchObject({ applied: true, replayed: false });
    const update = fake.batches[0]?.[0];
    expect(update?.sql).toContain("signup.signup_kind = 'player'");
    expect(update?.sql).toContain("signup.status = 'active'");
    expect(update?.sql).toContain("candidate.expires_at > ?");
    expect(update?.sql).toContain("target.starts_at >= ?");
    expect(update?.sql).toContain("target.starts_at < candidate.expires_at");
    expect(update?.sql).toContain("active.status IN ('reserved', 'redeemed')");
    expect(fake.batches[0]?.[1]?.sql).toContain("changes() = 1");
  });

  it("returns the original reservation on an idempotent replay", async () => {
    const fake = new FakeDatabase();
    fake.batchResults.push([result(), result()]);
    fake.firstResults.push(
      eventRow(),
      creditRow(1, {
        status: "reserved",
        target_event_id: "event-2",
        reserved_at: 1_500,
        last_operation_key: "reserve:event-2:dm-1",
        version: 2,
      }),
    );
    const repository = new PriorityRepository(fake as unknown as D1Database, () => 1_600);

    await expect(
      repository.reserveNextCredit({
        creditEventId: "ignored-on-replay",
        guildId: "guild-1",
        userId: "dm-1",
        targetEventId: "event-2",
        reservedAt: 1_600,
        actorUserId: "dm-1",
        idempotencyKey: "reserve:event-2:dm-1",
      }),
    ).resolves.toMatchObject({ applied: false, replayed: true });
  });

  it("refunds reserved or redeemed state without extending the original expiry", async () => {
    const fake = new FakeDatabase();
    fake.batchResults.push([result(1), result(1), result(), result()]);
    fake.firstResults.push(
      eventRow({
        idempotency_key: "refund:event-2:dm-1",
        action: "refunded",
        from_status: "reserved",
        to_status: "available",
        reason: "event cancelled",
      }),
      creditRow(),
    );
    const repository = new PriorityRepository(fake as unknown as D1Database, () => 1_600);

    await repository.refundCredit({
      creditEventId: "transition-refund",
      guildId: "guild-1",
      userId: "dm-1",
      creditId: "credit-1",
      targetEventId: "event-2",
      refundedAt: 1_600,
      actorUserId: "admin-1",
      reason: "event cancelled",
      idempotencyKey: "refund:event-2:dm-1",
    });

    expect(fake.batches[0]).toHaveLength(4);
    expect(fake.batches[0]?.[0]?.sql).toContain(
      "CASE WHEN ? < expires_at THEN 'available' ELSE 'expired' END",
    );
    expect(fake.batches[0]?.[2]?.sql).toContain("status = 'redeemed'");
    expect(fake.batches[0]?.[0]?.sql).not.toContain("expires_at =");
  });

  it("corrects every remaining credit, including redeemed history, in the grant batch", async () => {
    const fake = new FakeDatabase();
    fake.batchResults.push([result(1), result(2), result(2)]);
    fake.firstResults.push(
      grantRow({
        status: "corrected",
        corrected_at: 1_800,
        corrected_by_user_id: "admin-1",
        correction_reason: "wrong DM",
        correction_key: "correct:grant-1",
        updated_at: 1_800,
      }),
    );
    fake.allResults.push([
      creditRow(1, { status: "corrected", version: 2 }),
      creditRow(2, { status: "corrected", version: 2 }),
    ]);
    const repository = new PriorityRepository(fake as unknown as D1Database, () => 1_800);

    const corrected = await repository.correctGrant({
      guildId: "guild-1",
      grantId: "grant-1",
      correctedAt: 1_800,
      correctedByUserId: "admin-1",
      reason: "wrong DM",
      idempotencyKey: "correct:grant-1",
    });

    expect(corrected).toMatchObject({ applied: true, replayed: false });
    expect(fake.batches[0]?.[1]?.sql).toContain(
      "credit.status IN ('available', 'reserved', 'redeemed')",
    );
    expect(fake.batches[0]?.[2]?.sql).toContain("status = 'corrected'");
    expect(fake.batches[0]?.[1]?.sql).toContain("credit.target_event_id");
  });
});
