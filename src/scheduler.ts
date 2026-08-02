import { cadenceFromConfig, cadenceWindows, nextWeeklyOccurrence } from "./schedule";
import { DEFAULT_OPERATION_LEASE_MS } from "./storage/repository";
import type {
  BeginOperationResult,
  GuildConfig,
  Plan,
  ReminderDelivery,
  WeeklyEvent,
  CreateWeeklyEventInput,
} from "./storage/repository";

export interface SchedulerRepository {
  listSchedulingGuilds(): Promise<GuildConfig[]>;
  findWeeklyEventByStart(guildId: string, startsAt: number): Promise<WeeklyEvent | null>;
  createWeeklyEvent(input: CreateWeeklyEventInput): Promise<WeeklyEvent>;
  getWeeklyEvent(eventId: string): Promise<WeeklyEvent | null>;
  getCurrentPlan(eventId: string): Promise<Plan | null>;
  listEventsForScheduler(through: number): Promise<WeeklyEvent[]>;
  listDueReminders(now: number, limit?: number): Promise<ReminderDelivery[]>;
  beginOperation(input: {
    operationKey: string;
    guildId: string;
    eventId?: string;
    operationKind: string;
    request?: unknown;
  }): Promise<BeginOperationResult>;
  reclaimOperation(operationKey: string, staleBefore: number): Promise<boolean>;
  finishOperation(
    operationKey: string,
    outcome:
      | { status: "succeeded"; result?: unknown }
      | { status: "failed"; error: string },
  ): Promise<boolean>;
}

export interface SchedulerCallbacks {
  openEvent(event: WeeklyEvent): Promise<void>;
  openPlayerSignups(event: WeeklyEvent): Promise<void>;
  lockAndPlanEvent(event: WeeklyEvent): Promise<void>;
  publishEvent(event: WeeklyEvent): Promise<void>;
  openSeating(event: WeeklyEvent): Promise<void>;
  syncRoles(event: WeeklyEvent): Promise<void>;
  finalizeEvent(event: WeeklyEvent): Promise<void>;
  archiveEvent(event: WeeklyEvent): Promise<void>;
  enqueueEventReminders(event: WeeklyEvent): Promise<void>;
  deliverReminder(delivery: ReminderDelivery): Promise<void>;
}

export interface ScheduledActionResult {
  action:
    | "create"
    | "open"
    | "player-open"
    | "lock-plan"
    | "publish"
    | "open-seating"
    | "roles"
    | "finalize"
    | "archive"
    | "reminder";
  entityId: string;
  status: "succeeded" | "skipped" | "failed";
  operationKey?: string;
  detail?: string;
}

export interface SchedulerReport {
  startedAt: number;
  completedAt: number;
  actions: ScheduledActionResult[];
}

function scheduledEventId(guildId: string, startsAt: number): string {
  return "event-" + guildId + "-" + startsAt;
}

function eventTitle(startsAt: number, timeZone: string): string {
  return (
    "Weekly Games — " +
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(startsAt))
  );
}

function eventInput(config: GuildConfig, now: number): CreateWeeklyEventInput {
  const after = new Date(now).toISOString();
  const cadence = cadenceFromConfig(config);
  const startsAt = Date.parse(cadence
    ? cadenceWindows(cadence, after).startsAt
    : nextWeeklyOccurrence(
        {
          weekday: config.weeklyDay,
          time: config.weeklyTime,
          timeZone: config.timezone,
        },
        after,
      ));
  const staged = cadence ? cadenceWindows(cadence, after) : null;
  const signupOpensAt = staged
    ? Date.parse(staged.gmSignupOpensAt)
    : startsAt - config.signupOpenLeadDays * 86_400_000;
  const playerSignupOpensAt = staged
    ? Date.parse(staged.playerSignupOpensAt)
    : signupOpensAt;
  const tablesPublishAt = staged
    ? Date.parse(staged.tablesPublishAt)
    : startsAt - config.signupLockLeadHours * 3_600_000;
  const openSeatingAt = staged
    ? Date.parse(staged.openSeatingAt)
    : tablesPublishAt;
  return {
    eventId: scheduledEventId(config.guildId, startsAt),
    guildId: config.guildId,
    title: eventTitle(startsAt, config.timezone),
    startsAt,
    endsAt: startsAt + config.eventDurationMinutes * 60_000,
    signupOpensAt,
    playerSignupOpensAt,
    signupLocksAt: tablesPublishAt,
    openSeatingAt,
    tableSelectionClosesAt: startsAt,
    reminderAt:
      tablesPublishAt - 48 * 3_600_000,
    status: "draft",
    source: "native",
  };
}

async function captureUnpersisted(
  actions: ScheduledActionResult[],
  action: ScheduledActionResult["action"],
  entityId: string,
  work: () => Promise<void>,
): Promise<void> {
  try {
    await work();
    actions.push({ action, entityId, status: "succeeded" });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    actions.push({ action, entityId, status: "failed", detail: detail.slice(0, 500) });
  }
}

export function schedulerOperationKey(
  action: "create" | "open" | "player-open" | "lock-plan" | "publish" | "open-seating" | "roles" | "finalize" | "archive",
  entityId: string,
): string {
  return `scheduler:${action}:${entityId}`;
}

interface PersistedWorkResult {
  status?: "succeeded" | "skipped";
  detail?: string;
  result?: unknown;
}

type PersistedCaptureResult = "completed" | "busy" | "failed";

async function capturePersisted(
  repository: SchedulerRepository,
  actions: ScheduledActionResult[],
  action: "create" | "open" | "player-open" | "lock-plan" | "publish" | "open-seating" | "roles" | "finalize" | "archive",
  entityId: string,
  guildId: string,
  eventId: string | undefined,
  now: number,
  work: () => Promise<PersistedWorkResult | void>,
): Promise<PersistedCaptureResult> {
  const operationKey = schedulerOperationKey(action, entityId);
  try {
    const claim = await repository.beginOperation({
      operationKey,
      guildId,
      eventId,
      operationKind: `scheduler-${action}`,
      request: { action, entityId },
    });
    let ownsClaim = claim.claimed;
    if (
      !ownsClaim &&
      (claim.operation.status === "failed" ||
        (claim.operation.status === "started" &&
          claim.operation.updatedAt <= now - DEFAULT_OPERATION_LEASE_MS))
    ) {
      ownsClaim = await repository.reclaimOperation(
        operationKey,
        now - DEFAULT_OPERATION_LEASE_MS,
      );
    }
    if (!ownsClaim) {
      const detail =
        claim.operation.status === "succeeded"
          ? "The persisted scheduler operation already succeeded."
          : "Another scheduler invocation owns this operation.";
      actions.push({ action, entityId, operationKey, status: "skipped", detail });
      return claim.operation.status === "succeeded" ? "completed" : "busy";
    }

    const outcome = (await work()) ?? {};
    const completed = await repository.finishOperation(operationKey, {
      status: "succeeded",
      result: {
        action,
        entityId,
        outcome: outcome.status ?? "succeeded",
        detail: outcome.detail,
        value: outcome.result,
      },
    });
    if (!completed) {
      throw new Error("Scheduler operation completion could not be persisted.");
    }
    actions.push({
      action,
      entityId,
      operationKey,
      status: outcome.status ?? "succeeded",
      detail: outcome.detail,
    });
    return "completed";
  } catch (error) {
    const workDetail = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    let detail = workDetail;
    try {
      const recorded = await repository.finishOperation(operationKey, {
        status: "failed",
        error: workDetail,
      });
      if (!recorded) {
        detail = (
          workDetail + " The scheduler failure status could not be persisted."
        ).slice(0, 500);
      }
    } catch (persistenceError) {
      const persistenceDetail =
        persistenceError instanceof Error
          ? persistenceError.message
          : String(persistenceError);
      detail = (
        workDetail +
        " Recording the scheduler failure also failed: " +
        persistenceDetail
      ).slice(0, 500);
    }
    actions.push({ action, entityId, operationKey, status: "failed", detail });
    return "failed";
  }
}

/**
 * Runs one bounded cron pass. All state-changing callbacks must use conditional
 * writes/idempotency keys; this orchestrator intentionally tolerates duplicate
 * and overlapping Cloudflare scheduled deliveries.
 */
export async function runScheduledTick(
  repository: SchedulerRepository,
  callbacks: SchedulerCallbacks,
  now = Date.now(),
): Promise<SchedulerReport> {
  const actions: ScheduledActionResult[] = [];
  const configs = await repository.listSchedulingGuilds();
  const configByGuild = new Map(
    configs
      .filter((config) => config.schedulingEnabled)
      .map((config) => [config.guildId, config] as const),
  );

  for (const config of configs) {
    if (!config.schedulingEnabled || !config.eventChannelId) continue;
    const input = eventInput(config, now);
    let event: WeeklyEvent | null = null;
    await capturePersisted(
      repository,
      actions,
      "create",
      input.eventId,
      config.guildId,
      undefined,
      now,
      async () => {
        event = await repository.findWeeklyEventByStart(config.guildId, input.startsAt);
        if (event) {
          return {
            status: "skipped",
            detail: "The scheduled event already exists.",
            result: { created: false, eventId: event.eventId },
          };
        }
        event = await repository.createWeeklyEvent(input);
        return { result: { created: true, eventId: event.eventId } };
      },
    );
    event ??= await repository.findWeeklyEventByStart(config.guildId, input.startsAt);
    if (event) {
      await captureUnpersisted(actions, "reminder", event.eventId, () =>
        callbacks.enqueueEventReminders(event!),
      );
    }
  }

  const dueEvents = await repository.listEventsForScheduler(now);
  for (const event of dueEvents) {
    const config = configByGuild.get(event.guildId);
    if (!config) continue;

    if (event.status === "draft" && event.signupOpensAt <= now) {
      await capturePersisted(
        repository,
        actions,
        "open",
        event.eventId,
        event.guildId,
        event.eventId,
        now,
        async () => {
          await callbacks.openEvent(event);
        },
      );
      continue;
    }
    // Opening is a multi-step operation: the event transition can commit before
    // Discord accepts (and we persist) the signup post. Reconcile that missing
    // side effect before allowing the same event to advance to its lock step.
    const playerSignupOpensAt = event.playerSignupOpensAt ?? event.signupOpensAt;
    if (event.status === "open" && playerSignupOpensAt <= now) {
      await capturePersisted(
        repository,
        actions,
        "player-open",
        event.eventId,
        event.guildId,
        event.eventId,
        now,
        async () => {
          await callbacks.openPlayerSignups(event);
        },
      );
    }

    const signupPostReady = now < playerSignupOpensAt
      ? Boolean(event.gmSignupMessageId || event.signupMessageId)
      : Boolean(event.signupMessageId);
    if (event.status === "open" && !signupPostReady) {
      await capturePersisted(
        repository,
        actions,
        "open",
        event.eventId,
        event.guildId,
        event.eventId,
        now,
        async () => {
          await callbacks.openEvent(event);
        },
      );
      continue;
    }
    if (event.status === "open" && event.signupLocksAt <= now) {
      await capturePersisted(
        repository,
        actions,
        "lock-plan",
        event.eventId,
        event.guildId,
        event.eventId,
        now,
        async () => {
          await callbacks.lockAndPlanEvent(event);
        },
      );
      continue;
    }
    // A crash after the open -> locked transition must resume plan generation
    // with the same persisted operation rather than strand the event forever.
    if (event.status === "locked") {
      await capturePersisted(
        repository,
        actions,
        "lock-plan",
        event.eventId,
        event.guildId,
        event.eventId,
        now,
        async () => {
          await callbacks.lockAndPlanEvent(event);
        },
      );
      continue;
    }

    if (event.status === "planned" && config.autoPublishEnabled) {
      await capturePersisted(
        repository,
        actions,
        "publish",
        event.eventId,
        event.guildId,
        event.eventId,
        now,
        async () => {
          await callbacks.publishEvent(event);
        },
      );
      continue;
    }

    if (event.status === "published") {
      const openSeatingAt = event.openSeatingAt ?? event.signupLocksAt;
      if (openSeatingAt <= now && now < event.tableSelectionClosesAt) {
        await capturePersisted(
          repository,
          actions,
          "open-seating",
          event.eventId,
          event.guildId,
          event.eventId,
          now,
          async () => {
            await callbacks.openSeating(event);
          },
        );
      }

      const currentPlan = await repository.getCurrentPlan(event.eventId);
      const publishedPlan = currentPlan?.status === "published" ? currentPlan : null;

      if (config.roleSyncEnabled && publishedPlan) {
        const rolesEntityId = `${event.eventId}:${publishedPlan.planId}`;
        await capturePersisted(
          repository,
          actions,
          "roles",
          rolesEntityId,
          event.guildId,
          event.eventId,
          now,
          async () => {
            await callbacks.syncRoles(event);
          },
        );
      }

      let finalization: PersistedCaptureResult = publishedPlan ? "completed" : "failed";
      const finalizationDue =
        publishedPlan !== null &&
        event.tableSelectionClosesAt <= now &&
        (event.finalizedPlanId !== publishedPlan.planId ||
          event.finalizedTableStateVersion !== event.tableStateVersion);
      if (finalizationDue && publishedPlan) {
        const finalizationEntityId =
          `${event.eventId}:${publishedPlan.planId}:${event.tableStateVersion}`;
        finalization = await capturePersisted(
          repository,
          actions,
          "finalize",
          finalizationEntityId,
          event.guildId,
          event.eventId,
          now,
          async () => {
            await callbacks.finalizeEvent(event);
          },
        );
      }

      if (event.endsAt !== null && event.endsAt <= now && finalization === "completed") {
        await capturePersisted(
          repository,
          actions,
          "archive",
          event.eventId,
          event.guildId,
          event.eventId,
          now,
          async () => {
            await callbacks.archiveEvent(event);
          },
        );
      }
      continue;
    }

    if (
      (event.status === "planned" && event.endsAt !== null && event.endsAt <= now) ||
      event.status === "archived"
    ) {
      await capturePersisted(
        repository,
        actions,
        "archive",
        event.eventId,
        event.guildId,
        event.eventId,
        now,
        async () => {
          await callbacks.archiveEvent(event);
        },
      );
    }
  }

  const reminders = await repository.listDueReminders(now, 25);
  for (const reminder of reminders) {
    const reminderEvent = await repository.getWeeklyEvent(reminder.eventId);
    if (!reminderEvent || !configByGuild.has(reminderEvent.guildId)) continue;
    await captureUnpersisted(actions, "reminder", reminder.deliveryId, () =>
      callbacks.deliverReminder(reminder),
    );
  }

  const report = {
    startedAt: now,
    completedAt: Date.now(),
    actions,
  };
  console.log(JSON.stringify({ kind: "guild-assistant.scheduler", ...report }));
  return report;
}
