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
  type Plan,
  type WeeklyEvent,
} from "../src/storage/repository";

const now = Date.parse("2026-08-01T20:00:00Z");

function config(overrides: Partial<GuildConfig> = {}): GuildConfig {
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
    autoPublishEnabled: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
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
    tableSelectionClosesAt: now + 86_400_000,
    status,
    source: "native",
    sourceExternalId: null,
    signupChannelId: null,
    signupMessageId: "signup-message",
    tableChannelId: null,
    tableMessageId: null,
    finalManifestChannelId: null,
    finalManifestMessageId: null,
    tableStateVersion: 0,
    finalizedPlanId: null,
    finalizedTableStateVersion: null,
    tablesFinalizedAt: null,
    createdByUserId: null,
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    planId: "plan-100",
    eventId: "event-100",
    generation: 1,
    status: "published",
    algorithmVersion: "test-v1",
    minTableSize: 4,
    preferredTableSize: 6,
    maxTableSize: 6,
    playerCount: 12,
    gmSignupCount: 2,
    selectedGmCount: 2,
    waitlistCount: 0,
    createdByUserId: null,
    createdAt: now,
    publishedAt: now,
    ...overrides,
  };
}

function callbacks(): SchedulerCallbacks {
  return {
    openEvent: vi.fn().mockResolvedValue(undefined),
    openPlayerSignups: vi.fn().mockResolvedValue(undefined),
    lockAndPlanEvent: vi.fn().mockResolvedValue(undefined),
    publishEvent: vi.fn().mockResolvedValue(undefined),
    openSeating: vi.fn().mockResolvedValue(undefined),
    syncRoles: vi.fn().mockResolvedValue(undefined),
    finalizeEvent: vi.fn().mockResolvedValue(undefined),
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
    listSchedulingGuilds: vi.fn().mockResolvedValue([config()]),
    findWeeklyEventByStart: vi.fn().mockResolvedValue(null),
    createWeeklyEvent: vi.fn().mockResolvedValue(event("draft")),
    getWeeklyEvent: vi.fn().mockImplementation(async (eventId: string) =>
      event("open", { eventId }),
    ),
    getCurrentPlan: vi.fn().mockImplementation(async (eventId: string) =>
      plan({ eventId }),
    ),
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
        tableSelectionClosesAt: 1_785_630_600_000,
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


  it("refreshes the signup card when the separate player stage opens", async () => {
    const playerOpen = event("open", {
      playerSignupOpensAt: now - 1,
      signupLocksAt: now + 60_000,
    });
    const repository = schedulerRepository({
      listEventsForScheduler: vi.fn().mockResolvedValue([playerOpen]),
    });
    const handler = callbacks();

    const report = await runScheduledTick(repository, handler, now);

    expect(handler.openPlayerSignups).toHaveBeenCalledWith(playerOpen);
    expect(report.actions).toContainEqual(
      expect.objectContaining({
        action: "player-open",
        entityId: playerOpen.eventId,
        status: "succeeded",
      }),
    );
  });

  it("announces open seating once through a persisted scheduler operation", async () => {
    const published = event("published", {
      openSeatingAt: now - 1,
      tableSelectionClosesAt: now + 60_000,
    });
    const repository = schedulerRepository({
      listSchedulingGuilds: vi.fn().mockResolvedValue([
        config({ roleSyncEnabled: false }),
      ]),
      listEventsForScheduler: vi.fn().mockResolvedValue([published]),
    });
    const handler = callbacks();

    const report = await runScheduledTick(repository, handler, now);

    expect(handler.openSeating).toHaveBeenCalledWith(published);
    expect(repository.beginOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operationKey: schedulerOperationKey("open-seating", published.eventId),
      }),
    );
    expect(report.actions).toContainEqual(
      expect.objectContaining({ action: "open-seating", status: "succeeded" }),
    );
  });
  it("isolates failures and continues to later reminders", async () => {
    const repository = schedulerRepository({
      listEventsForScheduler: vi.fn().mockResolvedValue([event("open")]),
      listDueReminders: vi.fn().mockResolvedValue([
        { deliveryId: "d1", eventId: "event-100" },
        { deliveryId: "d2", eventId: "event-100" },
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

  it("continues cron work when recording a scheduler failure also fails", async () => {
    const due = event("open");
    const repository = schedulerRepository({
      listEventsForScheduler: vi.fn().mockResolvedValue([due]),
      listDueReminders: vi.fn().mockResolvedValue([
        { deliveryId: "after-failure", eventId: due.eventId },
      ]),
      finishOperation: vi.fn().mockImplementation(async (operationKey, outcome) => {
        if (
          operationKey === schedulerOperationKey("lock-plan", due.eventId) &&
          outcome.status === "failed"
        ) {
          throw new Error("D1 failure recording unavailable");
        }
        return true;
      }),
    });
    const handler = callbacks();
    vi.mocked(handler.lockAndPlanEvent).mockRejectedValue(new Error("Discord unavailable"));

    const report = await runScheduledTick(repository, handler, now);

    expect(handler.deliverReminder).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryId: "after-failure" }),
    );
    expect(report.actions).toContainEqual(expect.objectContaining({
      action: "lock-plan",
      status: "failed",
      detail: expect.stringContaining("Recording the scheduler failure also failed"),
    }));
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

  it("auto-publishes planned events only after the guild opts in", async () => {
    const planned = event("planned");
    const enabledRepository = schedulerRepository({
      listSchedulingGuilds: vi.fn().mockResolvedValue([
        config({ autoPublishEnabled: true }),
      ]),
      listEventsForScheduler: vi.fn().mockResolvedValue([planned]),
    });
    const enabledHandler = callbacks();

    await runScheduledTick(enabledRepository, enabledHandler, now);

    expect(enabledHandler.publishEvent).toHaveBeenCalledWith(planned);
    expect(enabledRepository.beginOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operationKey: "scheduler:publish:event-100",
        operationKind: "scheduler-publish",
      }),
    );

    const reviewRepository = schedulerRepository({
      listSchedulingGuilds: vi.fn().mockResolvedValue([config()]),
      listEventsForScheduler: vi.fn().mockResolvedValue([planned]),
    });
    const reviewHandler = callbacks();

    await runScheduledTick(reviewRepository, reviewHandler, now);

    expect(reviewHandler.publishEvent).not.toHaveBeenCalled();
  });

  it("syncs roles, finalizes the manifest, then archives a completed published event", async () => {
    const published = event("published", {
      tableSelectionClosesAt: now - 1,
      endsAt: now - 1,
    });
    const repository = schedulerRepository({
      listEventsForScheduler: vi.fn().mockResolvedValue([published]),
    });
    const handler = callbacks();

    const report = await runScheduledTick(repository, handler, now);

    expect(handler.syncRoles).toHaveBeenCalledWith(published);
    expect(handler.finalizeEvent).toHaveBeenCalledWith(published);
    expect(handler.archiveEvent).toHaveBeenCalledWith(published);
    expect(repository.beginOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationKey: "scheduler:roles:event-100:plan-100",
      eventId: published.eventId,
    }));
    expect(repository.beginOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationKey: "scheduler:finalize:event-100:plan-100:0",
      eventId: published.eventId,
    }));
    const lifecycle = report.actions
      .filter(({ action }) => ["roles", "finalize", "archive"].includes(action))
      .map(({ action }) => action);
    expect(lifecycle).toEqual(expect.arrayContaining(["roles", "finalize", "archive"]));
    expect(lifecycle.indexOf("finalize")).toBeLessThan(lifecycle.indexOf("archive"));
  });

  it("does not archive until a due final manifest succeeds", async () => {
    const published = event("published", {
      tableSelectionClosesAt: now - 1,
      endsAt: now - 1,
    });
    const repository = schedulerRepository({
      listSchedulingGuilds: vi.fn().mockResolvedValue([
        config({ roleSyncEnabled: false }),
      ]),
      listEventsForScheduler: vi.fn().mockResolvedValue([published]),
    });
    const handler = callbacks();
    vi.mocked(handler.finalizeEvent).mockRejectedValue(new Error("Discord unavailable"));

    const report = await runScheduledTick(repository, handler, now);

    expect(handler.finalizeEvent).toHaveBeenCalledWith(published);
    expect(handler.archiveEvent).not.toHaveBeenCalled();
    expect(report.actions).toContainEqual(expect.objectContaining({
      action: "finalize",
      status: "failed",
    }));
  });

  it("treats a previously completed finalization operation as safe to skip", async () => {
    const published = event("published", {
      tableSelectionClosesAt: now - 1,
      endsAt: now + 1,
    });
    const repository = schedulerRepository({
      listSchedulingGuilds: vi.fn().mockResolvedValue([
        config({ roleSyncEnabled: false }),
      ]),
      listEventsForScheduler: vi.fn().mockResolvedValue([published]),
      beginOperation: vi.fn().mockImplementation(async (input) => {
        if (
          input.operationKey ===
          schedulerOperationKey("finalize", `${published.eventId}:plan-100:0`)
        ) {
          return {
            claimed: false,
            operation: operation("succeeded", {
              operationKey: input.operationKey,
              operationKind: input.operationKind,
            }),
          };
        }
        return {
          claimed: true,
          operation: operation("started", {
            operationKey: input.operationKey,
            operationKind: input.operationKind,
          }),
        };
      }),
    });
    const handler = callbacks();

    const report = await runScheduledTick(repository, handler, now);

    expect(handler.finalizeEvent).not.toHaveBeenCalled();
    expect(report.actions).toContainEqual(expect.objectContaining({
      action: "finalize",
      status: "skipped",
      detail: "The persisted scheduler operation already succeeded.",
    }));
  });

  it("does not finalize again when the current plan and table state are already final", async () => {
    const published = event("published", {
      tableSelectionClosesAt: now - 1,
      tableStateVersion: 3,
      finalizedPlanId: "plan-100",
      finalizedTableStateVersion: 3,
      tablesFinalizedAt: now - 10,
      finalManifestMessageId: "manifest-1",
    });
    const repository = schedulerRepository({
      listSchedulingGuilds: vi.fn().mockResolvedValue([
        config({ roleSyncEnabled: false }),
      ]),
      listEventsForScheduler: vi.fn().mockResolvedValue([published]),
    });
    const handler = callbacks();

    const report = await runScheduledTick(repository, handler, now);

    expect(handler.finalizeEvent).not.toHaveBeenCalled();
    expect(report.actions.some(({ action }) => action === "finalize")).toBe(false);
  });

  it("finalizes a new table-state version even when a prior manifest exists", async () => {
    const published = event("published", {
      tableSelectionClosesAt: now - 1,
      tableStateVersion: 4,
      finalizedPlanId: "plan-100",
      finalizedTableStateVersion: 3,
      tablesFinalizedAt: now - 10,
      finalManifestMessageId: "manifest-1",
    });
    const repository = schedulerRepository({
      listSchedulingGuilds: vi.fn().mockResolvedValue([
        config({ roleSyncEnabled: false }),
      ]),
      listEventsForScheduler: vi.fn().mockResolvedValue([published]),
    });
    const handler = callbacks();

    await runScheduledTick(repository, handler, now);

    expect(handler.finalizeEvent).toHaveBeenCalledWith(published);
    expect(repository.beginOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationKey: "scheduler:finalize:event-100:plan-100:4",
      eventId: published.eventId,
    }));
  });

  it("finalizes a newly published plan even when the table-state version is unchanged", async () => {
    const published = event("published", {
      tableSelectionClosesAt: now - 1,
      tableStateVersion: 4,
      finalizedPlanId: "plan-previous",
      finalizedTableStateVersion: 4,
      tablesFinalizedAt: now - 10,
      finalManifestMessageId: "manifest-1",
    });
    const current = plan({ planId: "plan-current", generation: 2 });
    const repository = schedulerRepository({
      listSchedulingGuilds: vi.fn().mockResolvedValue([
        config({ roleSyncEnabled: false }),
      ]),
      getCurrentPlan: vi.fn().mockResolvedValue(current),
      listEventsForScheduler: vi.fn().mockResolvedValue([published]),
    });
    const handler = callbacks();

    await runScheduledTick(repository, handler, now);

    expect(handler.finalizeEvent).toHaveBeenCalledWith(published);
    expect(repository.beginOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationKey: "scheduler:finalize:event-100:plan-current:4",
      eventId: published.eventId,
    }));
  });

  it("does not finalize or archive a published event without a current published plan", async () => {
    const published = event("published", {
      tableSelectionClosesAt: now - 1,
      endsAt: now - 1,
    });
    const repository = schedulerRepository({
      listSchedulingGuilds: vi.fn().mockResolvedValue([
        config({ roleSyncEnabled: false }),
      ]),
      getCurrentPlan: vi.fn().mockResolvedValue(null),
      listEventsForScheduler: vi.fn().mockResolvedValue([published]),
    });
    const handler = callbacks();

    await runScheduledTick(repository, handler, now);

    expect(handler.finalizeEvent).not.toHaveBeenCalled();
    expect(handler.archiveEvent).not.toHaveBeenCalled();
  });

  it("does no lifecycle or reminder work for a paused guild", async () => {
    const repository = schedulerRepository({
      listSchedulingGuilds: vi.fn().mockResolvedValue([]),
      listEventsForScheduler: vi.fn().mockResolvedValue([
        event("published", { tableSelectionClosesAt: now - 1, endsAt: now - 1 }),
      ]),
      listDueReminders: vi.fn().mockResolvedValue([
        { deliveryId: "delivery-1", eventId: "event-100" },
      ]),
    } as Partial<SchedulerRepository>);
    const handler = callbacks();

    const report = await runScheduledTick(repository, handler, now);

    expect(handler.openEvent).not.toHaveBeenCalled();
    expect(handler.lockAndPlanEvent).not.toHaveBeenCalled();
    expect(handler.publishEvent).not.toHaveBeenCalled();
    expect(handler.syncRoles).not.toHaveBeenCalled();
    expect(handler.finalizeEvent).not.toHaveBeenCalled();
    expect(handler.archiveEvent).not.toHaveBeenCalled();
    expect(handler.deliverReminder).not.toHaveBeenCalled();
    expect(report.actions).toEqual([]);
  });
});
