import { describe, expect, it, vi } from "vitest";
import {
  runScheduledTick,
  schedulerOperationKey,
  type SchedulerCallbacks,
  type SchedulerRepository,
} from "../src/scheduler";
import {
  DEFAULT_OPERATION_LEASE_MS,
  type GuildConfig,
  type OperationRecord,
  type WeeklyEvent,
} from "../src/storage/repository";

const now = Date.parse("2026-08-01T20:00:00Z");

function config(): GuildConfig {
  return {
    guildId: "100",
    eventChannelId: "200",
    tableChannelId: "200",
    reminderChannelId: "200",
    adminRoleId: null,
    gmRoleId: "300",
    reminderRoleId: "400",
    timezone: "America/Denver",
    weeklyDay: 6,
    weeklyTime: "18:30",
    eventDurationMinutes: 240,
    signupOpenLeadDays: 7,
    signupLockLeadHours: 24,
    tableMinSize: 4,
    tablePreferredSize: 6,
    tableMaxSize: 6,
    schedulingEnabled: true,
    roleSyncEnabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

function event(status: WeeklyEvent["status"], overrides: Partial<WeeklyEvent> = {}): WeeklyEvent {
  return {
    eventId: "event-100",
    guildId: "100",
    title: "Weekly Games",
    startsAt: now + 86_400_000,
    endsAt: now + 90_000_000,
    signupOpensAt: now - 1,
    signupLocksAt: now - 1,
    status,
    source: "native",
    sourceExternalId: null,
    signupChannelId: null,
    signupMessageId: "signup-message",
    tableChannelId: null,
    tableMessageId: null,
    createdByUserId: null,
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

function callbacks(): SchedulerCallbacks {
  return {
    openEvent: vi.fn().mockResolvedValue(undefined),
    lockAndPlanEvent: vi.fn().mockResolvedValue(undefined),
    archiveEvent: vi.fn().mockResolvedValue(undefined),
    enqueueEventReminders: vi.fn().mockResolvedValue(undefined),
    deliverReminder: vi.fn().mockResolvedValue(undefined),
  };
}

function operation(
  status: OperationRecord["status"] = "started",
  overrides: Partial<OperationRecord> = {},
): OperationRecord {
  return {
    operationKey: "scheduler:test:event-100",
    guildId: "100",
    eventId: "event-100",
    operationKind: "scheduler-test",
    status,
    request: null,
    result: null,
    lastError: status === "failed" ? "previous failure" : null,
    startedAt: now,
    updatedAt: now,
    completedAt: status === "started" ? null : now,
    ...overrides,
  };
}

function schedulerRepository(
  overrides: Partial<SchedulerRepository> = {},
): SchedulerRepository {
  return {
    listSchedulingGuilds: vi.fn().mockResolvedValue([]),
    findWeeklyEventByStart: vi.fn().mockResolvedValue(null),
    createWeeklyEvent: vi.fn().mockResolvedValue(event("draft")),
    listEventsForScheduler: vi.fn().mockResolvedValue([]),
    listDueReminders: vi.fn().mockResolvedValue([]),
    beginOperation: vi.fn().mockImplementation(async (input) => ({
      claimed: true,
      operation: operation("started", {
        operationKey: input.operationKey,
        guildId: input.guildId,
        eventId: input.eventId ?? null,
        operationKind: input.operationKind,
      }),
    })),
    reclaimOperation: vi.fn().mockResolvedValue(true),
    finishOperation: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("scheduled orchestration", () => {
  it("creates one deterministic next event and opens a due draft", async () => {
    const due = event("draft");
    const created = event("draft", {
      eventId: "event-100-1785630600000",
      startsAt: 1_785_630_600_000,
    });
    const repository = schedulerRepository({
      listSchedulingGuilds: vi.fn().mockResolvedValue([config()]),
      findWeeklyEventByStart: vi.fn().mockResolvedValueOnce(null),
      createWeeklyEvent: vi.fn().mockResolvedValue(created),
      listEventsForScheduler: vi.fn().mockResolvedValue([due]),
    });
    const handler = callbacks();

    const report = await runScheduledTick(repository, handler, now);

    expect(repository.createWeeklyEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "event-100-1785630600000",
        guildId: "100",
        startsAt: 1_785_630_600_000,
        signupOpensAt: 1_785_025_800_000,
        signupLocksAt: 1_785_544_200_000,
      }),
    );
    expect(handler.enqueueEventReminders).toHaveBeenCalledWith(created);
    expect(handler.openEvent).toHaveBeenCalledWith(due);
    expect(report.actions.map(({ action, status }) => [action, status])).toEqual([
      ["create", "succeeded"],
      ["reminder", "succeeded"],
      ["open", "succeeded"],
    ]);
  });

  it("does not duplicate an existing scheduled event", async () => {
    const existing = event("open", { eventId: "existing" });
    const repository = schedulerRepository({
      listSchedulingGuilds: vi.fn().mockResolvedValue([config()]),
      findWeeklyEventByStart: vi.fn().mockResolvedValue(existing),
      createWeeklyEvent: vi.fn(),
    });

    const report = await runScheduledTick(repository, callbacks(), now);

    expect(repository.createWeeklyEvent).not.toHaveBeenCalled();
    expect(report.actions[0]).toMatchObject({ action: "create", status: "skipped" });
  });

  it("isolates failures and continues to later reminders", async () => {
    const repository = schedulerRepository({
      listEventsForScheduler: vi.fn().mockResolvedValue([event("open")]),
      listDueReminders: vi.fn().mockResolvedValue([
        { deliveryId: "d1" },
        { deliveryId: "d2" },
      ]),
    } as Partial<SchedulerRepository>);
    const handler = callbacks();
    vi.mocked(handler.lockAndPlanEvent).mockRejectedValue(new Error("permission denied"));

    const report = await runScheduledTick(repository, handler, now);

    expect(handler.deliverReminder).toHaveBeenCalledTimes(2);
    expect(report.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "lock-plan", status: "failed" }),
      expect.objectContaining({ action: "reminder", entityId: "d2", status: "succeeded" }),
    ]));
  });

  it("lets only one concurrent scheduler invocation own a lifecycle operation", async () => {
    const due = event("draft");
    const repository = schedulerRepository({
      listEventsForScheduler: vi.fn().mockResolvedValue([due]),
      beginOperation: vi.fn().mockResolvedValue({
        claimed: false,
        operation: operation("started", {
          operationKey: schedulerOperationKey("open", due.eventId),
        }),
      }),
    });
    const handler = callbacks();

    const report = await runScheduledTick(repository, handler, now);

    expect(handler.openEvent).not.toHaveBeenCalled();
    expect(repository.reclaimOperation).not.toHaveBeenCalled();
    expect(repository.finishOperation).not.toHaveBeenCalled();
    expect(report.actions).toContainEqual(expect.objectContaining({
      action: "open",
      operationKey: "scheduler:open:event-100",
      status: "skipped",
    }));
  });

  it("reclaims a stale started lifecycle operation and persists its result", async () => {
    const due = event("draft");
    const repository = schedulerRepository({
      listEventsForScheduler: vi.fn().mockResolvedValue([due]),
      beginOperation: vi.fn().mockResolvedValue({
        claimed: false,
        operation: operation("started", {
          operationKey: schedulerOperationKey("open", due.eventId),
          updatedAt: now - DEFAULT_OPERATION_LEASE_MS - 1,
        }),
      }),
    });
    const handler = callbacks();

    const report = await runScheduledTick(repository, handler, now);

    expect(repository.reclaimOperation).toHaveBeenCalledWith(
      "scheduler:open:event-100",
      now - DEFAULT_OPERATION_LEASE_MS,
    );
    expect(handler.openEvent).toHaveBeenCalledWith(due);
    expect(repository.finishOperation).toHaveBeenCalledWith(
      "scheduler:open:event-100",
      expect.objectContaining({ status: "succeeded" }),
    );
    expect(report.actions).toContainEqual(expect.objectContaining({
      action: "open",
      status: "succeeded",
    }));
  });

  it("retries the persisted open step when an open event has no signup post", async () => {
    const partial = event("open", { signupMessageId: null, signupLocksAt: now - 1 });
    const repository = schedulerRepository({
      listEventsForScheduler: vi.fn().mockResolvedValue([partial]),
      beginOperation: vi.fn().mockResolvedValue({
        claimed: false,
        operation: operation("failed", {
          operationKey: schedulerOperationKey("open", partial.eventId),
        }),
      }),
    });
    const handler = callbacks();

    await runScheduledTick(repository, handler, now);

    expect(repository.reclaimOperation).toHaveBeenCalled();
    expect(handler.openEvent).toHaveBeenCalledWith(partial);
    expect(handler.lockAndPlanEvent).not.toHaveBeenCalled();
  });

  it("retries plan generation for an event already transitioned to locked", async () => {
    const partial = event("locked");
    const repository = schedulerRepository({
      listEventsForScheduler: vi.fn().mockResolvedValue([partial]),
    });
    const handler = callbacks();

    await runScheduledTick(repository, handler, now);

    expect(handler.lockAndPlanEvent).toHaveBeenCalledWith(partial);
    expect(repository.beginOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationKey: "scheduler:lock-plan:event-100",
      eventId: "event-100",
    }));
  });

  it("retries archive side effects for an archived event returned with active leases", async () => {
    const partial = event("archived", { archivedAt: now });
    const repository = schedulerRepository({
      listEventsForScheduler: vi.fn().mockResolvedValue([partial]),
    });
    const handler = callbacks();

    await runScheduledTick(repository, handler, now);

    expect(handler.archiveEvent).toHaveBeenCalledWith(partial);
    expect(repository.beginOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationKey: "scheduler:archive:event-100",
      eventId: "event-100",
    }));
  });
});
