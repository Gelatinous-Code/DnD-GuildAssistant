import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPERATION_LEASE_MS,
  GuildRepository,
  TableSelectionUnavailableError,
} from "../src/storage/repository";
import {
  WEEKLY_ROSTER_MAX_ASSIGNMENTS,
  WEEKLY_ROSTER_MAX_ROWS,
  WEEKLY_ROSTER_MAX_TABLES,
  WeeklyExportLimitError,
} from "../src/weekly-export-contract";

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

function rowsResult<T>(rows: T[]): D1Result<T> {
  return { ...result(), results: rows } as D1Result<T>;
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

  async first<T = Record<string, unknown>>(columnName?: string): Promise<T | null> {
    const value = this.database.firstResults.shift() ?? null;
    if (columnName && value && typeof value === "object") {
      return (value as Record<string, unknown>)[columnName] as T;
    }
    return value as T | null;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return (this.database.runResults.shift() ?? result()) as D1Result<T>;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const rows = (this.database.allResults.shift() ?? []) as T[];
    return { ...result(), results: rows } as D1Result<T>;
  }
}

class FakeDatabase {
  readonly statements: FakeStatement[] = [];
  readonly batches: FakeStatement[][] = [];
  readonly firstResults: unknown[] = [];
  readonly allResults: unknown[][] = [];
  readonly runResults: D1Result[] = [];
  readonly batchResults: D1Result[][] = [];

  prepare(sql: string): FakeStatement {
    const statement = new FakeStatement(sql, this);
    this.statements.push(statement);
    return statement;
  }

  async batch(statements: FakeStatement[] = []): Promise<D1Result[]> {
    this.batches.push(statements);
    return this.batchResults.shift() ?? [];
  }
}

const eventRow = {
  event_id: "event-1",
  guild_id: "guild-1",
  title: "Weekly Games",
  starts_at: 1_000,
  ends_at: 2_000,
  signup_opens_at: 100,
  signup_locks_at: 900,
  table_selection_closes_at: 1_000,
  reminder_at: null,
  status: "published",
  source: "native",
  source_external_id: null,
  signup_channel_id: "channel-1",
  signup_message_id: "message-1",
  table_channel_id: "channel-2",
  table_message_id: null,
  final_manifest_channel_id: null,
  final_manifest_message_id: null,
  created_by_user_id: null,
  created_at: 100,
  updated_at: 200,
  published_at: 200,
  archived_at: null,
};

const signupRow = {
  event_id: "event-1",
  user_id: "player-1",
  display_name: "Player One",
  signup_kind: "player",
  status: "active",
  source: "native",
  source_external_id: null,
  signed_up_at: 100,
  withdrawn_at: null,
  updated_at: 100,
};

const planRow = {
  plan_id: "plan-1",
  event_id: "event-1",
  generation: 2,
  status: "published",
  algorithm_version: "planner-v1",
  min_table_size: 4,
  preferred_table_size: 6,
  max_table_size: 6,
  player_count: 1,
  gm_signup_count: 1,
  selected_gm_count: 1,
  waitlist_count: 0,
  created_by_user_id: "admin-1",
  created_at: 100,
  published_at: 150,
};

const tableRow = {
  table_id: "table-1",
  plan_id: "plan-1",
  table_number: 1,
  title: "Table 1",
  capacity: 6,
  gm_user_id: "gm-1",
  gm_display_name: "GM One",
  channel_id: null,
  message_id: null,
  created_at: 100,
};

const assignmentRow = {
  assignment_id: "assignment-1",
  plan_id: "plan-1",
  table_id: "table-1",
  desired_table_id: "table-1",
  user_id: "player-1",
  display_name: "Player One",
  status: "assigned",
  waitlist_position: null,
  assigned_at: 150,
  updated_at: 150,
};

function operationRow(
  status: "started" | "succeeded" | "failed",
  updatedAt = 300,
) {
  return {
    operation_key: "week:guild-1:publish",
    guild_id: "guild-1",
    event_id: "event-1",
    operation_kind: "week-publish",
    status,
    request_json: "{\"request\":true}",
    result_json: status === "succeeded" ? "{\"ok\":true}" : null,
    last_error: status === "failed" ? "failed" : null,
    started_at: 100,
    updated_at: updatedAt,
    completed_at: status === "started" ? null : updatedAt,
  };
}

const reminderRow = {
  delivery_id: "delivery-1",
  rule_id: "rule-1",
  event_id: "event-1",
  channel_id: "channel-1",
  recipient_kind: "role",
  recipient_id: "role-1",
  content: "Game reminder",
  scheduled_for: 250,
  status: "failed",
  idempotency_key: "reminder:scheduled:event-1:rule-1",
  attempt_count: 1,
  next_attempt_at: null,
  last_error: "Missing Permissions",
  sent_message_id: null,
  created_at: 100,
  updated_at: 200,
  sent_at: null,
};

const configRow = {
  guild_id: "guild-1",
  event_channel_id: "channel-1",
  table_channel_id: "channel-2",
  reminder_channel_id: "channel-3",
  admin_role_id: "admin-role",
  gm_role_id: "gm-role",
  reminder_role_id: "reminder-role",
  timezone: "America/Denver",
  weekly_day: 7,
  weekly_time: "18:00",
  event_duration_minutes: 240,
  signup_open_lead_days: 7,
  signup_lock_lead_hours: 24,
  table_min_size: 4,
  table_preferred_size: 6,
  table_max_size: 6,
  scheduling_enabled: 1,
  role_sync_enabled: 1,
  auto_publish_enabled: 1,
  created_at: 100,
  updated_at: 200,
};

describe("D1 persistence model", () => {
  it("defines the workflow and idempotency constraints", () => {
    const migration = readFileSync("migrations/0001_initial.sql", "utf8");
    const gmSelectionMigration = readFileSync(
      "migrations/0002_gm_selection_current.sql",
      "utf8",
    );
    const autopilotMigration = readFileSync(
      "migrations/0003_autopilot_and_final_manifest.sql",
      "utf8",
    );

    expect(migration).toContain("CREATE TABLE weekly_events");
    expect(migration).toContain("CREATE TABLE gm_selections");
    expect(migration).toContain("desired_table_id TEXT");
    expect(migration).toContain("ON assignments(plan_id, desired_table_id, waitlist_position)");
    expect(migration).toContain("idempotency_key TEXT NOT NULL UNIQUE");
    expect(migration).toContain("operation_key TEXT PRIMARY KEY");
    expect(migration).toContain("WHERE released_at IS NULL");
    expect(gmSelectionMigration).toContain("ADD COLUMN is_current");
    expect(gmSelectionMigration).toContain("gm_selections_current_priority_idx");
    expect(autopilotMigration).toContain("auto_publish_enabled INTEGER NOT NULL DEFAULT 0");
    expect(autopilotMigration).toContain("table_selection_closes_at");
    expect(autopilotMigration).toContain("final_manifest_message_id");
    expect(autopilotMigration).toContain("weekly_events_scheduler_deadlines_idx");
  });

  it("writes large draft plans in a bounded number of D1 statements", async () => {
    const fake = new FakeDatabase();
    fake.firstResults.push({
      plan_id: "plan-1",
      event_id: "event-1",
      generation: 1,
      status: "draft",
      algorithm_version: "planner-v1",
      min_table_size: 4,
      preferred_table_size: 6,
      max_table_size: 6,
      player_count: 48,
      gm_signup_count: 8,
      selected_gm_count: 8,
      waitlist_count: 0,
      created_by_user_id: null,
      created_at: 200,
      published_at: null,
    });
    fake.allResults.push([], []);
    const repository = new GuildRepository(fake as unknown as D1Database, () => 200);
    const tables = Array.from({ length: 8 }, (_, index) => ({
      tableId: `table-${index + 1}`,
      tableNumber: index + 1,
      gameTier: 1 as const,
      title: `Table ${index + 1}`,
      capacity: 6,
      gmUserId: `gm-${index + 1}`,
      gmDisplayName: `GM ${index + 1}`,
    }));
    const assignments = Array.from({ length: 48 }, (_, index) => ({
      assignmentId: `assignment-${index + 1}`,
      tableId: `table-${Math.floor(index / 6) + 1}`,
      userId: `player-${index + 1}`,
      displayName: `Player ${index + 1}`,
      gameTier: 1 as const,
      status: "assigned" as const,
      waitlistPosition: null,
    }));

    await repository.saveDraftPlan({
      plan: {
        planId: "plan-1",
        eventId: "event-1",
        generation: 1,
        algorithmVersion: "planner-v1",
        minTableSize: 4,
        preferredTableSize: 6,
        maxTableSize: 6,
        playerCount: 48,
        gmSignupCount: 8,
        selectedGmCount: 8,
        waitlistCount: 0,
        createdByUserId: null,
      },
      tables,
      assignments,
    });

    expect(fake.batches[0]).toHaveLength(4);
    const bulkTables = fake.batches[0]?.find((statement) =>
      statement.sql.includes("INSERT INTO plan_tables"),
    );
    const bulkAssignments = fake.batches[0]?.find((statement) =>
      statement.sql.includes("INSERT INTO assignments"),
    );
    expect(bulkTables?.sql).toContain("FROM json_each(?)");
    expect(bulkAssignments?.sql).toContain("FROM json_each(?)");
    expect(bulkTables?.values).toHaveLength(3);
    expect(bulkAssignments?.values).toHaveLength(3);
    expect(Math.max(...(fake.batches[0]?.map(({ values }) => values.length) ?? []))).toBeLessThan(100);
  });

  it("saves configuration with bound parameters and maps canonical aliases", async () => {
    const fake = new FakeDatabase();
    fake.batchResults.push([result(1), result(1)]);
    fake.firstResults.push(configRow);
    const repository = new GuildRepository(fake as unknown as D1Database, () => 200);

    const saved = await repository.saveGuildConfig({
      guildId: "guild-1",
      announcementChannelId: "channel-1",
      weeklyWeekday: 7,
      minPlayersPerTable: 4,
      preferredPlayersPerTable: 6,
      maxPlayersPerTable: 6,
      schedulingEnabled: true,
      autoPublishEnabled: true,
    });

    expect(saved.announcementChannelId).toBe("channel-1");
    expect(saved.weeklyWeekday).toBe(7);
    expect(saved.preferredPlayersPerTable).toBe(6);
    expect(saved.schedulingEnabled).toBe(true);
    expect(saved.autoPublishEnabled).toBe(true);
    expect(fake.statements[1]?.sql).not.toContain("guild-1");
    expect(fake.statements[1]?.values).toContain("channel-1");
    expect(fake.statements[1]?.values).toContain(7);
  });

  it("explicitly clears configured roles without treating omitted roles as null", async () => {
    const fake = new FakeDatabase();
    fake.batchResults.push([result(1), result(1)]);
    fake.firstResults.push({
      ...configRow,
      admin_role_id: null,
      gm_role_id: null,
      reminder_role_id: null,
    });
    const repository = new GuildRepository(fake as unknown as D1Database, () => 200);

    const saved = await repository.saveGuildConfig({
      guildId: "guild-1",
      adminRoleId: null,
      gmRoleId: null,
      reminderRoleId: null,
    });

    expect(saved.adminRoleId).toBeNull();
    expect(saved.gmRoleId).toBeNull();
    expect(saved.reminderRoleId).toBeNull();
    expect(fake.statements[1]?.sql).toContain(
      "admin_role_id = CASE WHEN ? = 1 THEN ? ELSE admin_role_id END",
    );
    expect(fake.statements[1]?.values.slice(5, 11)).toEqual([
      1, null, 1, null, 1, null,
    ]);
  });

  it("defaults table selection close to event start and maps final manifest fields", async () => {
    const fake = new FakeDatabase();
    fake.firstResults.push(eventRow);
    const repository = new GuildRepository(fake as unknown as D1Database, () => 200);

    const created = await repository.createWeeklyEvent({
      eventId: "event-1",
      guildId: "guild-1",
      title: "Weekly Games",
      startsAt: 1_000,
      endsAt: 2_000,
      signupOpensAt: 100,
      signupLocksAt: 900,
    });

    expect(created.tableSelectionClosesAt).toBe(1_000);
    expect(created.finalManifestMessageId).toBeNull();
    expect(fake.statements[0]?.sql).toContain("table_selection_closes_at");
    expect(fake.statements[0]?.values[9]).toBe(1_000);
  });

  it("gets the tenant-scoped latest weekly event", async () => {
    const fake = new FakeDatabase();
    fake.firstResults.push(eventRow);
    const repository = new GuildRepository(fake as unknown as D1Database, () => 200);

    await expect(repository.getLatestWeeklyEvent("guild-1")).resolves.toMatchObject({
      eventId: "event-1",
      guildId: "guild-1",
    });
    expect(fake.statements[0]?.sql).toContain("WHERE guild_id = ?");
    expect(fake.statements[0]?.sql).toContain("ORDER BY starts_at DESC");
    expect(fake.statements[0]?.values).toEqual(["guild-1"]);
  });

  it("lists active and withdrawn signups for a complete export", async () => {
    const fake = new FakeDatabase();
    fake.allResults.push([
      {
        event_id: "event-1",
        user_id: "player-1",
        display_name: "Player One",
        signup_kind: "player",
        status: "active",
        source: "native",
        source_external_id: null,
        signed_up_at: 100,
        withdrawn_at: null,
        updated_at: 100,
      },
      {
        event_id: "event-1",
        user_id: "player-2",
        display_name: "Player Two",
        signup_kind: "player",
        status: "withdrawn",
        source: "native",
        source_external_id: null,
        signed_up_at: 101,
        withdrawn_at: 150,
        updated_at: 150,
      },
    ]);
    const repository = new GuildRepository(fake as unknown as D1Database, () => 200);

    await expect(repository.listAllSignups("event-1")).resolves.toEqual([
      expect.objectContaining({ userId: "player-1", status: "active" }),
      expect.objectContaining({ userId: "player-2", status: "withdrawn" }),
    ]);
    expect(fake.statements[0]?.sql).not.toContain(
      "WHERE event_id = ? AND status = 'active'",
    );
    expect(fake.statements[0]?.values).toEqual(["event-1"]);
  });

  it("reads a bounded tenant-scoped weekly export in one D1 batch", async () => {
    const fake = new FakeDatabase();
    fake.batchResults.push([
      rowsResult([eventRow]),
      rowsResult([signupRow]),
      rowsResult([planRow]),
      rowsResult([tableRow]),
      rowsResult([assignmentRow]),
    ]);
    const repository = new GuildRepository(fake as unknown as D1Database, () => 200);

    const snapshot = await repository.getWeeklyExportSnapshot("guild-1", "event-1");

    expect(snapshot).toMatchObject({
      event: { eventId: "event-1", guildId: "guild-1" },
      signups: [{ userId: "player-1" }],
      planBundle: {
        plan: { planId: "plan-1", generation: 2, status: "published" },
        tables: [{ tableId: "table-1" }],
        assignments: [{ assignmentId: "assignment-1" }],
      },
    });
    expect(fake.batches).toHaveLength(1);
    expect(fake.batches[0]).toHaveLength(5);
    expect(fake.batches[0]?.every((statement) => statement.sql.includes("selected_event"))).toBe(true);
    expect(fake.batches[0]?.[0]?.sql).toContain("event_id = ?1 AND guild_id = ?2");
    expect(fake.batches[0]?.[0]?.values).toEqual(["event-1", "guild-1"]);
    expect(fake.batches[0]?.[1]?.values).toEqual([
      "event-1",
      "guild-1",
      WEEKLY_ROSTER_MAX_ROWS + 1,
    ]);
    expect(fake.batches[0]?.[2]?.sql).toContain(
      "CASE plans.status WHEN 'published' THEN 0 ELSE 1 END",
    );
    expect(fake.batches[0]?.[3]?.values).toEqual([
      "event-1",
      "guild-1",
      WEEKLY_ROSTER_MAX_TABLES + 1,
    ]);
    expect(fake.batches[0]?.[4]?.values).toEqual([
      "event-1",
      "guild-1",
      WEEKLY_ROSTER_MAX_ASSIGNMENTS + 1,
    ]);
  });

  it("uses current-then-latest event selection for a default export", async () => {
    const fake = new FakeDatabase();
    fake.batchResults.push([
      rowsResult([]),
      rowsResult([]),
      rowsResult([]),
      rowsResult([]),
      rowsResult([]),
    ]);
    const repository = new GuildRepository(fake as unknown as D1Database, () => 200);

    await expect(repository.getWeeklyExportSnapshot("guild-1")).resolves.toBeNull();
    expect(fake.batches[0]?.[0]?.values).toEqual(["guild-1", 200]);
    expect(fake.batches[0]?.[0]?.sql).toContain(
      "status NOT IN ('archived', 'cancelled')",
    );
    expect(fake.batches[0]?.[0]?.sql).toContain(
      "WHEN status IN ('archived', 'cancelled') THEN starts_at",
    );
  });

  it("rejects over-limit snapshot collections before returning partial data", async () => {
    const cases = [
      {
        limit: "rows",
        maximum: WEEKLY_ROSTER_MAX_ROWS,
        resultIndex: 1,
        rows: Array.from({ length: WEEKLY_ROSTER_MAX_ROWS + 1 }, (_, index) => ({
          ...signupRow,
          user_id: `player-${index}`,
        })),
      },
      {
        limit: "assignments",
        maximum: WEEKLY_ROSTER_MAX_ASSIGNMENTS,
        resultIndex: 4,
        rows: Array.from(
          { length: WEEKLY_ROSTER_MAX_ASSIGNMENTS + 1 },
          (_, index) => ({
            ...assignmentRow,
            assignment_id: `assignment-${index}`,
            user_id: `player-${index}`,
          }),
        ),
      },
      {
        limit: "tables",
        maximum: WEEKLY_ROSTER_MAX_TABLES,
        resultIndex: 3,
        rows: Array.from({ length: WEEKLY_ROSTER_MAX_TABLES + 1 }, (_, index) => ({
          ...tableRow,
          table_id: `table-${index}`,
          table_number: index + 1,
          gm_user_id: `gm-${index}`,
        })),
      },
    ] as const;

    for (const testCase of cases) {
      const fake = new FakeDatabase();
      const batchRows: unknown[][] = [
        [eventRow],
        [signupRow],
        [planRow],
        [tableRow],
        [assignmentRow],
      ];
      batchRows[testCase.resultIndex] = [...testCase.rows];
      fake.batchResults.push(batchRows.map((rows) => rowsResult(rows)));
      const repository = new GuildRepository(fake as unknown as D1Database, () => 200);

      await expect(
        repository.getWeeklyExportSnapshot("guild-1", "event-1"),
      ).rejects.toEqual(
        expect.objectContaining<Partial<WeeklyExportLimitError>>({
          name: "WeeklyExportLimitError",
          limit: testCase.limit,
          maximum: testCase.maximum,
          actual: testCase.maximum + 1,
        }),
      );
    }
  });

  it("persists the final manifest projection idempotently", async () => {
    const fake = new FakeDatabase();
    fake.runResults.push(result(1));
    const repository = new GuildRepository(fake as unknown as D1Database, () => 200);

    await expect(
      repository.setFinalManifest(
        "event-1",
        "channel-final",
        "message-final",
        "plan-1",
        7,
        190,
      ),
    ).resolves.toBe(true);
    expect(fake.statements[0]?.sql).toContain("final_manifest_channel_id = ?");
    expect(fake.statements[0]?.sql).toContain("final_manifest_message_id IS NULL");
    expect(fake.statements[0]?.sql).toContain("table_state_version = ?");
    expect(fake.statements[0]?.sql).toContain("plans.status = 'published'");
    expect(fake.statements[0]?.values).toEqual([
      "channel-final",
      "message-final",
      "plan-1",
      7,
      190,
      200,
      "event-1",
      7,
      "plan-1",
      "channel-final",
      "message-final",
    ]);
  });

  it("inserts a late player once and revives a withdrawn assignment", async () => {
    const fake = new FakeDatabase();
    fake.batchResults.push([result(0), result(1)]);
    fake.firstResults.push({
      assignment_id: "assignment-1",
      plan_id: "plan-1",
      table_id: null,
      desired_table_id: null,
      user_id: "player-1",
      display_name: "Player One",
      status: "unassigned",
      waitlist_position: null,
      assigned_at: null,
      updated_at: 200,
    });
    const repository = new GuildRepository(fake as unknown as D1Database, () => 200);

    await expect(repository.ensureUnassignedAssignment({
      assignmentId: "assignment-1",
      planId: "plan-1",
      userId: "player-1",
      displayName: "Player One",
    })).resolves.toMatchObject({ status: "unassigned", tableId: null });

    expect(fake.batches[0]).toHaveLength(3);
    expect(fake.batches[0]?.[0]?.sql).toContain("INSERT OR IGNORE INTO assignments");
    expect(fake.batches[0]?.[0]?.sql).toContain("plan.status = 'published'");
    expect(fake.batches[0]?.[1]?.sql).toContain(
      "status = CASE WHEN status = 'withdrawn' THEN 'unassigned' ELSE status END",
    );
    expect(fake.batches[0]?.[1]?.sql).toContain(
      "desired_table_id = CASE WHEN status = 'withdrawn' THEN NULL",
    );
    expect(fake.batches[0]?.[2]?.sql).toContain(
      "table_state_version = table_state_version + 1",
    );
    expect(fake.batches[0]?.[1]?.sql).toContain("signup.status = 'active'");
  });

  it("returns a table-specific waitlist result from an atomic join batch", async () => {
    const fake = new FakeDatabase();
    const before = {
      assignment_id: "assignment-1",
      plan_id: "plan-1",
      table_id: null,
      desired_table_id: null,
      user_id: "user-1",
      display_name: "Player One",
      status: "unassigned",
      waitlist_position: null,
      assigned_at: null,
      updated_at: 100,
    };
    const after = {
      ...before,
      desired_table_id: "table-1",
      status: "waitlisted",
      waitlist_position: 2,
      updated_at: 200,
    };
    fake.firstResults.push(before, after);
    fake.batchResults.push([result(1), result(0)]);
    const repository = new GuildRepository(fake as unknown as D1Database, () => 200);

    const joined = await repository.joinOrWaitlist("plan-1", "user-1", "table-1");

    expect(joined.outcome).toBe("waitlisted");
    expect(joined.position).toBe(2);
    const update = fake.statements.find((statement) => statement.sql.includes("WITH target AS"));
    expect(update?.sql).toContain("p.status = 'published'");
    expect(update?.sql).toContain("weekly.status = 'published'");
    expect(update?.sql).toContain("strftime('%s', 'now')");
    expect(update?.sql).toContain("queued.desired_table_id = ?");
    expect(update?.values).toContain("table-1");
    expect(fake.batches[0]?.[1]?.sql).toContain(
      "table_state_version = table_state_version + 1",
    );
  });

  it("rejects an assignment mutation when its atomic deadline guard loses the race", async () => {
    const fake = new FakeDatabase();
    fake.firstResults.push({
      assignment_id: "assignment-1",
      plan_id: "plan-1",
      table_id: null,
      desired_table_id: "table-1",
      user_id: "user-1",
      display_name: "Player One",
      status: "waitlisted",
      waitlist_position: 1,
      assigned_at: null,
      updated_at: 100,
    });
    fake.batchResults.push([result(0), result(0), result(0)]);
    const repository = new GuildRepository(fake as unknown as D1Database, () => 200);

    await expect(
      repository.leaveTableAndPromote("plan-1", "user-1"),
    ).rejects.toBeInstanceOf(TableSelectionUnavailableError);
    expect(fake.batches[0]?.[0]?.sql).toContain("strftime('%s', 'now')");
    expect(fake.batches[0]?.[1]?.sql).toContain(
      "table_state_version = table_state_version + 1",
    );
  });

  it("retries failed or lease-expired operations", async () => {
    const fake = new FakeDatabase();
    fake.runResults.push(result(1));
    const repository = new GuildRepository(fake as unknown as D1Database, () => 300);

    await expect(repository.retryOperation("week:guild-1:publish")).resolves.toBe(true);
    expect(fake.statements[0]?.sql).toContain("status = 'failed'");
    expect(fake.statements[0]?.sql).toContain("status = 'started' AND updated_at <= ?");
    expect(fake.statements[0]?.values).toEqual([
      300,
      300,
      "week:guild-1:publish",
      300 - DEFAULT_OPERATION_LEASE_MS,
    ]);
  });

  it("atomically reclaims a stale started operation but not a fresh owner", async () => {
    const stale = new FakeDatabase();
    stale.runResults.push(result(0), result(1));
    stale.firstResults.push(operationRow("started", 1));
    const staleRepository = new GuildRepository(
      stale as unknown as D1Database,
      () => DEFAULT_OPERATION_LEASE_MS + 10,
    );

    const reclaimed = await staleRepository.beginOperation({
      operationKey: "week:guild-1:publish",
      guildId: "guild-1",
      eventId: "event-1",
      operationKind: "week-publish",
    });

    expect(reclaimed.claimed).toBe(true);
    expect(stale.statements[1]?.sql).toContain("status = 'started' AND updated_at <= ?");
    expect(stale.statements[1]?.values.at(-1)).toBe(10);

    const fresh = new FakeDatabase();
    fresh.runResults.push(result(0), result(0));
    fresh.firstResults.push(operationRow("started", DEFAULT_OPERATION_LEASE_MS + 10));
    const freshRepository = new GuildRepository(
      fresh as unknown as D1Database,
      () => DEFAULT_OPERATION_LEASE_MS + 10,
    );
    await expect(freshRepository.beginOperation({
      operationKey: "week:guild-1:publish",
      guildId: "guild-1",
      operationKind: "week-publish",
    })).resolves.toMatchObject({ claimed: false });
  });

  it("recovers stale reminder sends and supports retry and skip on the original row", async () => {
    const due = new FakeDatabase();
    due.allResults.push([]);
    const dueRepository = new GuildRepository(due as unknown as D1Database, () => 1_000);
    await dueRepository.listDueRemindersWithLease(1_000, 25, 100);
    expect(due.statements[0]?.sql).toContain("config.scheduling_enabled = 1");
    expect(due.statements[0]?.sql).toContain(
      "deliveries.status = 'sending' AND deliveries.updated_at <= ?",
    );
    expect(due.statements[0]?.values).toEqual([1_000, 1_000, 900, 25]);

    const claim = new FakeDatabase();
    claim.runResults.push(result(1));
    const claimRepository = new GuildRepository(claim as unknown as D1Database, () => 1_000);
    await expect(claimRepository.claimReminder("delivery-1", 100)).resolves.toBe(true);
    expect(claim.statements[0]?.values).toEqual([1_000, "delivery-1", 1_000, 1_000, 900]);

    const retry = new FakeDatabase();
    retry.runResults.push(result(1), result(1));
    const retryRepository = new GuildRepository(retry as unknown as D1Database, () => 1_000);
    await expect(retryRepository.retryReminder("delivery-1", 100)).resolves.toBe(true);
    await expect(retryRepository.skipReminder("delivery-1", "operator skip", 100)).resolves.toBe(true);
    expect(retry.statements[0]?.sql).toContain("status = 'failed'");
    expect(retry.statements[0]?.sql).toContain("status = 'sending' AND updated_at <= ?");
    expect(retry.statements[1]?.sql).toContain("status IN ('pending', 'failed')");
    expect(retry.statements[1]?.values).toEqual(["operator skip", 1_000, "delivery-1", 900]);
  });

  it("gets and lists recent reminder occurrences for recovery tooling", async () => {
    const fake = new FakeDatabase();
    fake.firstResults.push(reminderRow);
    fake.allResults.push([reminderRow]);
    const repository = new GuildRepository(fake as unknown as D1Database, () => 300);

    await expect(repository.getReminder("delivery-1")).resolves.toMatchObject({
      deliveryId: "delivery-1",
      status: "failed",
      nextAttemptAt: null,
    });
    await expect(repository.listRecentReminders("guild-1", 5)).resolves.toEqual([
      expect.objectContaining({ deliveryId: "delivery-1" }),
    ]);
    expect(fake.statements[1]?.sql).toContain("JOIN weekly_events");
    expect(fake.statements[1]?.values).toEqual(["guild-1", 5]);
  });

  it("lists recent persisted operations by guild and event", async () => {
    const fake = new FakeDatabase();
    fake.allResults.push([operationRow("succeeded")]);
    const repository = new GuildRepository(fake as unknown as D1Database, () => 300);

    await expect(repository.listRecentOperations("guild-1", "event-1", 5)).resolves.toEqual([
      expect.objectContaining({
        operationKey: "week:guild-1:publish",
        guildId: "guild-1",
        eventId: "event-1",
        status: "succeeded",
      }),
    ]);
    expect(fake.statements[0]?.sql).toContain("WHERE guild_id = ? AND event_id = ?");
    expect(fake.statements[0]?.values).toEqual(["guild-1", "event-1", 5]);
  });

  it("selects the nearest future workflow event but the current started published event for roles", async () => {
    const workflow = new FakeDatabase();
    workflow.firstResults.push(eventRow);
    const workflowRepository = new GuildRepository(workflow as unknown as D1Database, () => 750);
    await expect(workflowRepository.getCurrentWeeklyEvent("guild-1")).resolves.toMatchObject({
      eventId: "event-1",
    });
    expect(workflow.statements[0]?.sql).toContain("CASE WHEN starts_at > ? THEN 0 ELSE 1 END");
    expect(workflow.statements[0]?.values).toEqual(["guild-1", 750, 750, 750]);

    const roles = new FakeDatabase();
    roles.firstResults.push(eventRow);
    const roleRepository = new GuildRepository(roles as unknown as D1Database, () => 1_500);
    await expect(roleRepository.getCurrentPublishedEvent("guild-1")).resolves.toMatchObject({
      eventId: "event-1",
    });
    expect(roles.statements[0]?.sql).toContain("CASE WHEN starts_at <= ? THEN 0 ELSE 1 END");
    expect(roles.statements[0]?.values).toEqual(["guild-1", 1_500, 1_500, 1_500]);
  });

  it("exposes only archived events that still have active role leases to the scheduler", async () => {
    const fake = new FakeDatabase();
    fake.allResults.push([]);
    const repository = new GuildRepository(fake as unknown as D1Database, () => 300);

    await repository.listEventsForScheduler(300);

    expect(fake.statements[0]?.sql).toContain("status = 'archived'");
    expect(fake.statements[0]?.sql).toContain("role_leases.event_id = weekly_events.event_id");
    expect(fake.statements[0]?.sql).toContain("role_leases.released_at IS NULL");
    expect(fake.statements[0]?.values).toEqual([300, 300, 300, 300]);
  });

  it("publishes only the final GM set as current priority history", async () => {
    const fake = new FakeDatabase();
    fake.batchResults.push([result(), result(1), result(1), result(2), result(2)]);
    const repository = new GuildRepository(fake as unknown as D1Database, () => 300);

    await expect(repository.publishPlan({
      planId: "plan-2",
      eventId: "event-1",
      guildId: "guild-1",
    })).resolves.toBe(true);

    expect(fake.batches[0]).toHaveLength(5);
    expect(fake.batches[0]?.[3]?.sql).toContain("UPDATE gm_selections SET is_current = 0");
    expect(fake.batches[0]?.[3]?.sql).toContain("target.status = 'published'");
    expect(fake.batches[0]?.[4]?.sql).toContain("ON CONFLICT(event_id, gm_user_id) DO UPDATE");
    expect(fake.batches[0]?.[4]?.sql).toContain("is_current = 1");
    expect(fake.batches[0]?.[2]?.sql).toContain(
      "table_state_version = table_state_version + 1",
    );
    expect(fake.batches[0]?.[2]?.sql).toContain("changes() = 1");

    const stats = new FakeDatabase();
    stats.allResults.push([]);
    const statsRepository = new GuildRepository(stats as unknown as D1Database, () => 300);
    await statsRepository.listGmSelectionStats("guild-1");
    expect(stats.statements[0]?.sql).toContain("is_current = 1");
  });

  it("returns the highest-generation superseded plan for card reconciliation", async () => {
    const fake = new FakeDatabase();
    fake.firstResults.push({
      plan_id: "plan-2",
      event_id: "event-1",
      generation: 2,
      status: "superseded",
      algorithm_version: "planner-v1",
      min_table_size: 4,
      preferred_table_size: 6,
      max_table_size: 6,
      player_count: 12,
      gm_signup_count: 3,
      selected_gm_count: 2,
      waitlist_count: 0,
      created_by_user_id: "admin-1",
      created_at: 200,
      published_at: 250,
    });
    const repository = new GuildRepository(fake as unknown as D1Database, () => 300);

    await expect(repository.getLatestSupersededPlan("event-1")).resolves.toMatchObject({
      planId: "plan-2",
      generation: 2,
      status: "superseded",
    });
    expect(fake.statements[0]?.sql).toContain("status = 'superseded'");
    expect(fake.statements[0]?.sql).toContain("ORDER BY generation DESC LIMIT 1");
    expect(fake.statements[0]?.values).toEqual(["event-1"]);
  });

  it("leaves a table without withdrawing the active player", async () => {
    const fake = new FakeDatabase();
    const assigned = {
      assignment_id: "assignment-1",
      plan_id: "plan-1",
      table_id: "table-1",
      desired_table_id: "table-1",
      user_id: "user-1",
      display_name: "Player One",
      status: "assigned",
      waitlist_position: null,
      assigned_at: 100,
      updated_at: 100,
    };
    const queued = {
      ...assigned,
      assignment_id: "assignment-2",
      table_id: null,
      user_id: "user-2",
      display_name: "Player Two",
      status: "waitlisted",
      waitlist_position: 1,
      assigned_at: null,
    };
    const after = {
      ...assigned,
      table_id: null,
      desired_table_id: null,
      status: "unassigned",
      assigned_at: null,
      updated_at: 200,
    };
    const promoted = {
      ...queued,
      table_id: "table-1",
      status: "assigned",
      waitlist_position: null,
      assigned_at: 200,
      updated_at: 200,
    };
    fake.firstResults.push(assigned, queued, after, promoted);
    fake.batchResults.push([result(1), result(1)]);
    const repository = new GuildRepository(fake as unknown as D1Database, () => 200);

    const left = await repository.leaveTableAndPromote("plan-1", "user-1");

    expect(left.left).toBe(true);
    expect(left.assignment?.status).toBe("unassigned");
    expect(left.promoted?.userId).toBe("user-2");
    const leave = fake.statements.find((statement) =>
      statement.sql.includes("status = 'unassigned'"),
    );
    expect(leave?.sql).toContain("desired_table_id = NULL");
  });

  it("updates table overrides only while the owning plan is a draft", async () => {
    const draftDb = new FakeDatabase();
    draftDb.runResults.push(result(1));
    draftDb.firstResults.push({
      table_id: "table-1",
      plan_id: "plan-1",
      table_number: 1,
      title: "One Shot",
      capacity: 7,
      gm_user_id: "gm-2",
      gm_display_name: "GM Two",
      channel_id: null,
      message_id: null,
      created_at: 100,
    });
    const draftRepository = new GuildRepository(
      draftDb as unknown as D1Database,
      () => 200,
    );

    await expect(
      draftRepository.updateDraftTable({
        planId: "plan-1",
        tableNumber: 1,
        title: "One Shot",
        capacity: 7,
        gmUserId: "gm-2",
        gmDisplayName: "GM Two",
      }),
    ).resolves.toMatchObject({
      tableId: "table-1",
      title: "One Shot",
      capacity: 7,
      gmUserId: "gm-2",
    });

    const update = draftDb.statements[0];
    expect(update?.sql).toContain("plans.status = 'draft'");
    expect(update?.sql).toContain("assignments.status = 'assigned'");
    expect(update?.values).toEqual([
      "One Shot",
      7,
      "gm-2",
      "GM Two",
      "plan-1",
      1,
      7,
      7,
    ]);

    const publishedDb = new FakeDatabase();
    publishedDb.runResults.push(result(0));
    const publishedRepository = new GuildRepository(
      publishedDb as unknown as D1Database,
      () => 200,
    );
    await expect(
      publishedRepository.updateDraftTable({
        planId: "published-plan",
        tableNumber: 1,
        title: "Must Not Change",
      }),
    ).resolves.toBeNull();
    expect(publishedDb.statements).toHaveLength(1);
    expect(publishedDb.statements[0]?.sql).toContain("plans.status = 'draft'");
  });
});
