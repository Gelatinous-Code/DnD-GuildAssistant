import { describe, expect, it } from "vitest";
import type { DiscordMessagePayload, DiscordRestClient } from "../src/discord-api";
import type {
  Assignment,
  BeginOperationResult,
  CreateWeeklyEventInput,
  GuildConfig,
  GuildRepository,
  JoinTableResult,
  LeaveTableResult,
  OperationRecord,
  Plan,
  PlanBundle,
  SaveDraftPlanInput,
  SaveSignupInput,
  Signup,
  SignupKind,
  WeeklyEvent,
} from "../src/storage/repository";
import { UserFacingError } from "../src/interaction-utils";
import { WeekService } from "../src/week-service";

const NOW = Date.parse("2026-08-01T20:00:00Z");
const STARTS_AT = Date.parse("2026-08-08T00:30:00Z");

function guildConfig(overrides: Partial<GuildConfig> = {}): GuildConfig {
  return {
    guildId: "synthetic-guild",
    eventChannelId: "events-channel",
    tableChannelId: "tables-channel",
    reminderChannelId: "reminders-channel",
    adminRoleId: "admin-role",
    gmRoleId: "gm-role",
    reminderRoleId: "gaming-role",
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
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function weeklyEvent(
  status: WeeklyEvent["status"] = "open",
  overrides: Partial<WeeklyEvent> = {},
): WeeklyEvent {
  return {
    eventId: "event-1",
    guildId: "synthetic-guild",
    title: "Synthetic Saturday Games",
    startsAt: STARTS_AT,
    endsAt: STARTS_AT + 4 * 60 * 60_000,
    signupOpensAt: STARTS_AT - 7 * 86_400_000,
    signupLocksAt: STARTS_AT - 24 * 3_600_000,
    reminderAt: STARTS_AT - 48 * 3_600_000,
    status,
    source: "native",
    sourceExternalId: null,
    signupChannelId: "events-channel",
    signupMessageId: "signup-message",
    tableChannelId: null,
    tableMessageId: null,
    createdByUserId: "admin-1",
    createdAt: NOW,
    updatedAt: NOW,
    publishedAt: status === "published" ? NOW : null,
    archivedAt: status === "archived" ? NOW : null,
    ...overrides,
  };
}

function signup(
  userId: string,
  kind: SignupKind,
  signedUpAt = NOW,
): Signup {
  return {
    eventId: "event-1",
    userId,
    displayName: userId,
    signupKind: kind,
    status: "active",
    source: "native",
    sourceExternalId: null,
    signedUpAt,
    withdrawnAt: null,
    updatedAt: signedUpAt,
  };
}

function draftPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planId: "plan-1",
    eventId: "event-1",
    generation: 1,
    status: "draft",
    algorithmVersion: "balanced-rotation-v1",
    minTableSize: 4,
    preferredTableSize: 6,
    maxTableSize: 6,
    playerCount: 2,
    gmSignupCount: 2,
    selectedGmCount: 2,
    waitlistCount: 0,
    createdByUserId: "admin-1",
    createdAt: NOW,
    publishedAt: null,
    ...overrides,
  };
}

function assignment(
  userId: string,
  status: Assignment["status"] = "unassigned",
  overrides: Partial<Assignment> = {},
): Assignment {
  return {
    assignmentId: "assignment-" + userId,
    planId: "plan-1",
    tableId: null,
    desiredTableId: null,
    userId,
    displayName: userId,
    status,
    waitlistPosition: null,
    assignedAt: null,
    updatedAt: NOW,
    ...overrides,
  };
}

function planBundle(plan = draftPlan()): PlanBundle {
  return {
    plan,
    tables: [
      {
        tableId: "table-1",
        planId: plan.planId,
        tableNumber: 1,
        title: "Table 1",
        capacity: 1,
        gmUserId: "gm-1",
        gmDisplayName: "GM One",
        channelId: null,
        messageId: null,
        createdAt: NOW,
      },
      {
        tableId: "table-2",
        planId: plan.planId,
        tableNumber: 2,
        title: "Table 2",
        capacity: 1,
        gmUserId: "gm-2",
        gmDisplayName: "GM Two",
        channelId: null,
        messageId: null,
        createdAt: NOW,
      },
    ],
    assignments: [],
  };
}

function operation(
  operationKey: string,
  status: OperationRecord["status"],
): OperationRecord {
  return {
    operationKey,
    guildId: "synthetic-guild",
    eventId: "event-1",
    operationKind: "publish-plan",
    status,
    request: { planId: "plan-1" },
    result: status === "succeeded" ? { planId: "plan-1" } : null,
    lastError: status === "failed" ? "synthetic failure" : null,
    startedAt: NOW,
    updatedAt: NOW,
    completedAt: status === "started" ? null : NOW,
  };
}

class FakeDiscord {
  readonly sends: Array<{ channelId: string; payload: DiscordMessagePayload }> = [];
  readonly edits: Array<{
    channelId: string;
    messageId: string;
    payload: DiscordMessagePayload;
  }> = [];
  failSendNumber: number | null = null;

  async sendChannelMessage(channelId: string, payload: DiscordMessagePayload) {
    this.sends.push({ channelId, payload });
    if (this.failSendNumber === this.sends.length) {
      throw new Error("synthetic Discord send failure");
    }
    return { id: "message-" + this.sends.length, channel_id: channelId };
  }

  async editChannelMessage(
    channelId: string,
    messageId: string,
    payload: DiscordMessagePayload,
  ) {
    this.edits.push({ channelId, messageId, payload });
    return { id: messageId, channel_id: channelId };
  }

  async getGuildMember() {
    return { roles: [] as string[] };
  }
}

class FakeRepository {
  config: GuildConfig | null = guildConfig();
  event: WeeklyEvent | null = null;
  readonly signups = new Map<string, Signup>();
  readonly gmStats: Array<{
    gmUserId: string;
    selectionCount: number;
    lastSelectedAt: number | null;
  }> = [];
  readonly bundles = new Map<string, PlanBundle>();
  readonly operations = new Map<string, OperationRecord>();
  readonly audits: Array<Record<string, unknown>> = [];
  readonly createdEvents: CreateWeeklyEventInput[] = [];
  readonly savedDrafts: SaveDraftPlanInput[] = [];
  readonly eventMessageWrites: Array<Record<string, unknown>> = [];
  readonly tableMessageWrites: Array<{ tableId: string; channelId: string; messageId: string }> = [];
  readonly finishedOperations: Array<{ key: string; outcome: unknown }> = [];
  readonly joinCalls: Array<{ planId: string; userId: string; tableId: string }> = [];
  readonly leaveCalls: Array<{ planId: string; userId: string }> = [];
  readonly withdrawSignupCalls: Array<{ eventId: string; userId: string }> = [];
  readonly withdrawAssignmentCalls: Array<{ planId: string; userId: string }> = [];
  readonly overrideCalls: Array<{
    planId: string;
    tableNumber: number;
    title?: string;
    capacity?: number;
    gmUserId?: string;
    gmDisplayName?: string;
  }> = [];
  failNextTransition = false;
  raceTransitionTo: WeeklyEvent["status"] | null = null;
  forcedClaim: BeginOperationResult | null = null;
  publishResult = true;
  returnTerminalEvent = false;

  async getGuildConfig() {
    return this.config;
  }

  async getCurrentWeeklyEvent() {
    return !this.returnTerminalEvent &&
      (this.event?.status === "archived" || this.event?.status === "cancelled")
      ? null
      : this.event;
  }

  async createWeeklyEvent(input: CreateWeeklyEventInput) {
    this.createdEvents.push(input);
    this.event = weeklyEvent(input.status ?? "draft", {
      ...input,
      endsAt: input.endsAt ?? null,
      reminderAt: input.reminderAt ?? null,
      source: input.source ?? "native",
      sourceExternalId: input.sourceExternalId ?? null,
      signupChannelId: null,
      signupMessageId: null,
      tableChannelId: null,
      tableMessageId: null,
      createdByUserId: input.createdByUserId ?? null,
    });
    return this.event;
  }

  async getWeeklyEvent(eventId: string) {
    return this.event?.eventId === eventId ? this.event : null;
  }

  async setEventMessages(eventId: string, values: Record<string, unknown>) {
    this.eventMessageWrites.push({ eventId, ...values });
    if (this.event?.eventId === eventId) Object.assign(this.event, values);
  }

  async listActiveSignups(eventId: string, kind?: SignupKind) {
    return [...this.signups.values()]
      .filter(
        (item) =>
          item.eventId === eventId &&
          item.status === "active" &&
          (kind === undefined || item.signupKind === kind),
      )
      .sort((left, right) => left.signedUpAt - right.signedUpAt || left.userId.localeCompare(right.userId));
  }

  async saveSignup(input: SaveSignupInput) {
    const saved: Signup = {
      eventId: input.eventId,
      userId: input.userId,
      displayName: input.displayName,
      signupKind: input.signupKind,
      status: "active",
      source: input.source ?? "native",
      sourceExternalId: input.sourceExternalId ?? null,
      signedUpAt: input.signedUpAt ?? NOW,
      withdrawnAt: null,
      updatedAt: NOW,
    };
    this.signups.set(input.userId, saved);
    return saved;
  }

  async withdrawSignup(eventId: string, userId: string) {
    this.withdrawSignupCalls.push({ eventId, userId });
    const current = this.signups.get(userId);
    if (!current || current.status !== "active") return false;
    this.signups.set(userId, { ...current, status: "withdrawn", withdrawnAt: NOW });
    return true;
  }

  async getSignup(eventId: string, userId: string) {
    const found = this.signups.get(userId);
    return found?.eventId === eventId ? found : null;
  }

  async countActiveSignups(eventId: string) {
    const active = await this.listActiveSignups(eventId);
    return {
      players: active.filter((item) => item.signupKind === "player").length,
      gms: active.filter((item) => item.signupKind === "gm").length,
    };
  }

  async listRecentOperations() {
    return [];
  }

  async listRecentReminders() {
    return [];
  }

  async appendAudit(input: Record<string, unknown>) {
    this.audits.push(input);
    return this.audits.length;
  }

  async transitionEventStatus(
    eventId: string,
    expected: WeeklyEvent["status"],
    next: WeeklyEvent["status"],
  ) {
    if (!this.event || this.event.eventId !== eventId) return false;
    if (this.failNextTransition) {
      this.failNextTransition = false;
      if (this.raceTransitionTo) this.event.status = this.raceTransitionTo;
      return false;
    }
    if (this.event.status !== expected) return false;
    this.event.status = next;
    if (next === "archived") this.event.archivedAt = NOW;
    return true;
  }

  async listGmSelectionStats() {
    return this.gmStats;
  }

  async getNextPlanGeneration(eventId: string) {
    return [...this.bundles.values()].filter((bundle) => bundle.plan.eventId === eventId).length + 1;
  }

  async saveDraftPlan(input: SaveDraftPlanInput) {
    this.savedDrafts.push(input);
    const plan: Plan = {
      ...input.plan,
      status: "draft",
      createdAt: input.plan.createdAt ?? NOW,
      publishedAt: null,
    };
    const bundle: PlanBundle = {
      plan,
      tables: input.tables.map((table) => ({
        ...table,
        planId: plan.planId,
        channelId: table.channelId ?? null,
        messageId: table.messageId ?? null,
        createdAt: NOW,
      })),
      assignments: input.assignments.map((item) => ({
        ...item,
        planId: plan.planId,
        desiredTableId: item.desiredTableId ?? item.tableId,
        assignedAt: item.assignedAt ?? null,
        updatedAt: NOW,
      })),
    };
    this.bundles.set(plan.planId, bundle);
    return bundle;
  }

  async getLatestDraftPlan(eventId: string) {
    return [...this.bundles.values()]
      .map((bundle) => bundle.plan)
      .filter((plan) => plan.eventId === eventId && plan.status === "draft")
      .sort((left, right) => right.generation - left.generation)[0] ?? null;
  }

  async getLatestSupersededPlan() {
    return null;
  }

  async getCurrentPlan(eventId: string) {
    return [...this.bundles.values()]
      .map((bundle) => bundle.plan)
      .filter(
        (plan) =>
          plan.eventId === eventId &&
          (plan.status === "published" || plan.status === "draft"),
      )
      .sort((left, right) => {
        if (left.status === "published" && right.status !== "published") return -1;
        if (right.status === "published" && left.status !== "published") return 1;
        return right.generation - left.generation;
      })[0] ?? null;
  }

  async getPlan(planId: string) {
    return this.bundles.get(planId)?.plan ?? null;
  }

  async getPlanBundle(planId: string) {
    return this.bundles.get(planId) ?? null;
  }

  async getAssignment(planId: string, userId: string) {
    return (
      this.bundles
        .get(planId)
        ?.assignments.find((item) => item.userId === userId) ?? null
    );
  }

  async updateDraftTable(input: {
    planId: string;
    tableNumber: number;
    title?: string;
    capacity?: number;
    gmUserId?: string;
    gmDisplayName?: string;
  }) {
    this.overrideCalls.push(input);
    const bundle = this.bundles.get(input.planId);
    if (!bundle || bundle.plan.status !== "draft") return null;
    const table = bundle.tables.find((item) => item.tableNumber === input.tableNumber);
    if (!table) return null;
    const assigned = bundle.assignments.filter(
      (item) => item.status === "assigned" && item.tableId === table.tableId,
    ).length;
    if (input.capacity !== undefined && input.capacity < assigned) return null;
    if (input.title !== undefined) table.title = input.title;
    if (input.capacity !== undefined) table.capacity = input.capacity;
    if (input.gmUserId !== undefined) table.gmUserId = input.gmUserId;
    if (input.gmDisplayName !== undefined) table.gmDisplayName = input.gmDisplayName;
    return table;
  }

  async setPlanTableMessage(tableId: string, channelId: string, messageId: string) {
    this.tableMessageWrites.push({ tableId, channelId, messageId });
    for (const bundle of this.bundles.values()) {
      const table = bundle.tables.find((item) => item.tableId === tableId);
      if (table) {
        table.channelId = channelId;
        table.messageId = messageId;
        return true;
      }
    }
    return false;
  }

  async beginOperation(input: { operationKey: string }): Promise<BeginOperationResult> {
    if (this.forcedClaim) return this.forcedClaim;
    const existing = this.operations.get(input.operationKey);
    if (existing) return { claimed: false, operation: existing };
    const claimed = operation(input.operationKey, "started");
    this.operations.set(input.operationKey, claimed);
    return { claimed: true, operation: claimed };
  }

  async getOperation(operationKey: string) {
    return this.operations.get(operationKey) ?? null;
  }

  async finishOperation(
    key: string,
    outcome: { status: "succeeded"; result?: unknown } | { status: "failed"; error: string },
  ) {
    this.finishedOperations.push({ key, outcome });
    const current = this.operations.get(key) ?? operation(key, "started");
    this.operations.set(key, {
      ...current,
      status: outcome.status,
      result: outcome.status === "succeeded" ? outcome.result ?? null : null,
      lastError: outcome.status === "failed" ? outcome.error : null,
      completedAt: NOW,
    });
    return true;
  }

  async retryOperation(key: string) {
    const existing = this.operations.get(key);
    if (!existing || existing.status !== "failed") return false;
    this.operations.set(key, {
      ...existing,
      status: "started",
      result: null,
      lastError: null,
      completedAt: null,
    });
    return true;
  }

  async publishPlan(input: { planId: string; eventId: string }) {
    if (!this.publishResult) return false;
    const bundle = this.bundles.get(input.planId);
    if (!bundle) return false;
    bundle.plan.status = "published";
    bundle.plan.publishedAt = NOW;
    if (this.event?.eventId === input.eventId) this.event.status = "published";
    return true;
  }

  private promote(planId: string, tableId: string | null): Assignment | null {
    if (!tableId) return null;
    const bundle = this.bundles.get(planId);
    if (!bundle) return null;
    const next = bundle.assignments
      .filter(
        (item) =>
          item.status === "waitlisted" && item.desiredTableId === tableId,
      )
      .sort((left, right) =>
        (left.waitlistPosition ?? 0) - (right.waitlistPosition ?? 0),
      )[0];
    if (!next) return null;
    Object.assign(next, {
      status: "assigned",
      tableId,
      desiredTableId: tableId,
      waitlistPosition: null,
      assignedAt: NOW,
    });
    return next;
  }

  async joinOrWaitlist(planId: string, userId: string, tableId: string): Promise<JoinTableResult> {
    this.joinCalls.push({ planId, userId, tableId });
    const bundle = this.bundles.get(planId);
    const selected = bundle?.assignments.find((item) => item.userId === userId);
    const table = bundle?.tables.find((item) => item.tableId === tableId);
    if (!bundle || !selected || !table) throw new Error("invalid synthetic selection");
    const oldTableId = selected.status === "assigned" ? selected.tableId : null;
    const occupied = bundle.assignments.filter(
      (item) => item.status === "assigned" && item.tableId === tableId && item.userId !== userId,
    ).length;
    let outcome: JoinTableResult["outcome"];
    if (occupied < table.capacity) {
      Object.assign(selected, {
        status: "assigned",
        tableId,
        desiredTableId: tableId,
        waitlistPosition: null,
        assignedAt: NOW,
      });
      outcome = "assigned";
    } else {
      const position =
        Math.max(
          0,
          ...bundle.assignments
            .filter((item) => item.status === "waitlisted" && item.desiredTableId === tableId)
            .map((item) => item.waitlistPosition ?? 0),
        ) + 1;
      Object.assign(selected, {
        status: "waitlisted",
        tableId: null,
        desiredTableId: tableId,
        waitlistPosition: position,
        assignedAt: null,
      });
      outcome = "waitlisted";
    }
    const promoted = oldTableId && oldTableId !== tableId ? this.promote(planId, oldTableId) : null;
    return {
      outcome,
      position: selected.waitlistPosition,
      assignment: selected,
      promoted,
    };
  }

  async leaveTableAndPromote(planId: string, userId: string): Promise<LeaveTableResult> {
    this.leaveCalls.push({ planId, userId });
    const bundle = this.bundles.get(planId);
    const selected = bundle?.assignments.find((item) => item.userId === userId) ?? null;
    if (!selected || !["assigned", "waitlisted"].includes(selected.status)) {
      return { left: false, assignment: selected, promoted: null };
    }
    const oldTableId = selected.status === "assigned" ? selected.tableId : null;
    Object.assign(selected, {
      status: "unassigned",
      tableId: null,
      desiredTableId: null,
      waitlistPosition: null,
      assignedAt: null,
    });
    return {
      left: true,
      assignment: selected,
      promoted: this.promote(planId, oldTableId),
    };
  }

  async withdrawAssignmentAndPromote(
    planId: string,
    userId: string,
  ): Promise<LeaveTableResult> {
    this.withdrawAssignmentCalls.push({ planId, userId });
    const bundle = this.bundles.get(planId);
    const selected = bundle?.assignments.find((item) => item.userId === userId) ?? null;
    if (!selected || selected.status === "withdrawn") {
      return { left: false, assignment: selected, promoted: null };
    }
    const oldTableId = selected.status === "assigned" ? selected.tableId : null;
    Object.assign(selected, {
      status: "withdrawn",
      tableId: null,
      desiredTableId: null,
      waitlistPosition: null,
      assignedAt: null,
    });
    return {
      left: true,
      assignment: selected,
      promoted: this.promote(planId, oldTableId),
    };
  }
}

function service(
  repository: FakeRepository,
  discord: FakeDiscord,
  ids: string[] = [],
): WeekService {
  let counter = 0;
  return new WeekService(
    repository as unknown as GuildRepository,
    discord as unknown as DiscordRestClient,
    { now: () => NOW, id: () => ids[counter++] ?? "generated-" + counter },
  );
}

describe("WeekService", () => {
  it("opens a manual week idempotently and creates only one signup post", async () => {
    const repository = new FakeRepository();
    const discord = new FakeDiscord();
    const instance = service(repository, discord, ["event-new"]);

    await instance.openWeek({
      guildId: "synthetic-guild",
      startsAt: "2026-08-08T00:30:00Z",
      actorUserId: "admin-1",
    });
    await instance.openWeek({ guildId: "synthetic-guild" });

    expect(repository.createdEvents).toHaveLength(1);
    expect(discord.sends).toHaveLength(1);
    expect(discord.edits).toHaveLength(1);
    expect(repository.eventMessageWrites[0]).toMatchObject({
      signupChannelId: "events-channel",
      signupMessageId: "message-1",
    });
  });

  it("switches signup kind authoritatively and then withdraws", async () => {
    const repository = new FakeRepository();
    repository.event = weeklyEvent("open");
    const instance = service(repository, new FakeDiscord());

    await instance.changeSignup({
      guildId: "synthetic-guild",
      eventId: "event-1",
      userId: "player-1",
      displayName: "Player One",
      action: "gm",
    });
    const switched = await instance.changeSignup({
      guildId: "synthetic-guild",
      eventId: "event-1",
      userId: "player-1",
      displayName: "Player One",
      action: "player",
    });
    const withdrawn = await instance.changeSignup({
      guildId: "synthetic-guild",
      eventId: "event-1",
      userId: "player-1",
      displayName: "Player One",
      action: "withdraw",
    });

    expect(switched.message).toBe("Signed up to play.");
    expect(repository.signups.get("player-1")?.signupKind).toBe("player");
    expect(repository.signups.get("player-1")?.status).toBe("withdrawn");
    expect(withdrawn.message).toBe("Signup withdrawn.");
    expect(repository.audits.map((item) => item.action)).toEqual([
      "signup.gm",
      "signup.player",
      "signup.withdraw",
    ]);
  });

  it("rejects a signup interaction replayed from a different guild", async () => {
    const repository = new FakeRepository();
    repository.event = weeklyEvent("open");
    const instance = service(repository, new FakeDiscord());

    await expect(
      instance.changeSignup({
        guildId: "other-guild",
        eventId: "event-1",
        userId: "player-1",
        displayName: "Player One",
        action: "player",
      }),
    ).rejects.toThrow("That weekly signup belongs to a different server.");
    expect(repository.signups.size).toBe(0);
    expect(repository.audits).toHaveLength(0);
  });

  it("rejects late signup changes without mutating persistence", async () => {
    const repository = new FakeRepository();
    repository.event = weeklyEvent("locked");
    const instance = service(repository, new FakeDiscord());

    await expect(
      instance.changeSignup({
        guildId: "synthetic-guild",
        eventId: "event-1",
        userId: "late-player",
        displayName: "Late Player",
        action: "player",
      }),
    ).rejects.toThrow("Signups are locked");
    expect(repository.signups.size).toBe(0);
    expect(repository.audits).toHaveLength(0);
  });

  it.each(["gm", "player"] as const)(
    "applies a late admin %s correction with admin provenance and audit",
    async (action) => {
      const repository = new FakeRepository();
      repository.event = weeklyEvent("locked");
      const discord = new FakeDiscord();
      const instance = service(repository, discord);

      const corrected = await instance.correctSignup({
        guildId: "synthetic-guild",
        actorUserId: "admin-1",
        userId: "corrected-member",
        displayName: "Corrected Member",
        action,
      });

      expect(repository.signups.get("corrected-member")).toMatchObject({
        signupKind: action,
        status: "active",
        source: "admin",
      });
      expect(corrected.warning).toBeUndefined();
      expect(repository.audits.at(-1)).toMatchObject({
        guildId: "synthetic-guild",
        eventId: "event-1",
        actorUserId: "admin-1",
        action: "signup.admin-correction",
        entityType: "signup",
        entityId: "corrected-member",
        details: { action },
      });
      expect(discord.edits).toHaveLength(1);
      expect(discord.edits[0]).toMatchObject({
        channelId: "events-channel",
        messageId: "signup-message",
      });
    },
  );

  it.each(["planned", "published"] as const)(
    "warns that a %s plan predates an admin correction",
    async (status) => {
      const repository = new FakeRepository();
      repository.event = weeklyEvent(status);
      const instance = service(repository, new FakeDiscord());

      const corrected = await instance.correctSignup({
        guildId: "synthetic-guild",
        actorUserId: "admin-1",
        userId: "late-player",
        displayName: "Late Player",
        action: "player",
      });

      expect(corrected.warning).toBe(
        "The plan predates this correction. Run /week plan, review the new revision, and publish it.",
      );
    },
  );

  it("withdraws signup and assignment, promotes, and refreshes published tables", async () => {
    const repository = new FakeRepository();
    repository.event = weeklyEvent("published");
    repository.signups.set("departing", signup("departing", "player"));
    const bundle = planBundle(draftPlan({ status: "published", publishedAt: NOW }));
    for (const [index, table] of bundle.tables.entries()) {
      table.channelId = "tables-channel";
      table.messageId = "table-message-" + (index + 1);
    }
    bundle.assignments.push(
      assignment("departing", "assigned", {
        tableId: "table-1",
        desiredTableId: "table-1",
      }),
      assignment("next-player", "waitlisted", {
        desiredTableId: "table-1",
        waitlistPosition: 1,
      }),
    );
    repository.bundles.set("plan-1", bundle);
    const discord = new FakeDiscord();
    const instance = service(repository, discord);

    const corrected = await instance.correctSignup({
      guildId: "synthetic-guild",
      actorUserId: "admin-1",
      userId: "departing",
      displayName: "Departing Player",
      action: "withdraw",
    });

    expect(repository.withdrawSignupCalls).toEqual([
      { eventId: "event-1", userId: "departing" },
    ]);
    expect(repository.withdrawAssignmentCalls).toEqual([
      { planId: "plan-1", userId: "departing" },
    ]);
    expect(repository.signups.get("departing")?.status).toBe("withdrawn");
    expect(bundle.assignments.find((item) => item.userId === "departing")?.status).toBe(
      "withdrawn",
    );
    expect(bundle.assignments.find((item) => item.userId === "next-player")).toMatchObject({
      status: "assigned",
      tableId: "table-1",
    });
    expect(discord.edits).toHaveLength(3);
    expect(discord.edits.slice(0, 2).map((item) => item.messageId)).toEqual([
      "table-message-1",
      "table-message-2",
    ]);
    expect(discord.edits[2]?.messageId).toBe("signup-message");
    expect(corrected.warning).toContain("Run /week plan");
    expect(repository.audits.at(-1)).toMatchObject({
      action: "signup.admin-correction",
      entityId: "departing",
      details: { action: "withdraw" },
    });
  });

  it.each(["archived", "cancelled"] as const)(
    "rejects admin correction when a %s event is explicitly reachable",
    async (status) => {
      const repository = new FakeRepository();
      repository.event = weeklyEvent(status);
      repository.returnTerminalEvent = true;
      const instance = service(repository, new FakeDiscord());

      await expect(
        instance.correctSignup({
          guildId: "synthetic-guild",
          actorUserId: "admin-1",
          userId: "member-1",
          displayName: "Member One",
          action: "player",
        }),
      ).rejects.toThrow("Archived or cancelled weeks cannot be corrected");
      expect(repository.signups.size).toBe(0);
      expect(repository.audits).toHaveLength(0);
    },
  );

  it("allows an administrator to retry locking after a concurrent transition", async () => {
    const repository = new FakeRepository();
    repository.event = weeklyEvent("open");
    repository.failNextTransition = true;
    repository.raceTransitionTo = "locked";
    const discord = new FakeDiscord();
    const instance = service(repository, discord);

    await expect(instance.lockWeek("synthetic-guild", "admin-1")).rejects.toThrow(
      "run /week status and retry",
    );
    await expect(instance.lockWeek("synthetic-guild", "admin-1")).resolves.toMatchObject({
      status: "locked",
    });
    expect(discord.edits).toHaveLength(1);
  });

  it("persists every player as unassigned while reporting projected overflow", async () => {
    const repository = new FakeRepository();
    repository.event = weeklyEvent("locked");
    repository.signups.set("gm-1", signup("gm-1", "gm", NOW));
    for (let index = 1; index <= 8; index += 1) {
      const id = "player-" + index;
      repository.signups.set(id, signup(id, "player", NOW + index));
    }
    const ids = [
      "plan-deterministic",
      "table-deterministic",
      ...Array.from({ length: 8 }, (_, index) => "assignment-" + (index + 1)),
    ];
    const instance = service(repository, new FakeDiscord(), ids);

    const generated = await instance.generatePlan("synthetic-guild", "admin-1");
    const saved = repository.savedDrafts[0];

    expect(saved?.plan).toMatchObject({
      planId: "plan-deterministic",
      selectedGmCount: 1,
      waitlistCount: 2,
    });
    expect(saved?.tables).toEqual([
      expect.objectContaining({
        tableId: "table-deterministic",
        tableNumber: 1,
        capacity: 6,
        gmUserId: "gm-1",
      }),
    ]);
    expect(saved?.assignments).toEqual(
      Array.from({ length: 8 }, (_, index) =>
        expect.objectContaining({
          assignmentId: "assignment-" + (index + 1),
          userId: "player-" + (index + 1),
          status: "unassigned",
          tableId: null,
          waitlistPosition: null,
        }),
      ),
    );
    expect(generated.bundle.assignments).toEqual(
      expect.arrayContaining(
        Array.from({ length: 8 }, (_, index) =>
          expect.objectContaining({
            userId: "player-" + (index + 1),
            status: "unassigned",
            tableId: null,
            desiredTableId: null,
            waitlistPosition: null,
          }),
        ),
      ),
    );
    expect(JSON.stringify(generated.preview)).toContain(
      "Projected capacity shortfall: 2 players exceed currently planned seats; live table waitlists begin only after selection.",
    );
    expect(generated.event.status).toBe("planned");
  });

  it("explains the priority and history of every selected and waitlisted GM", async () => {
    const repository = new FakeRepository();
    repository.event = weeklyEvent("locked");
    repository.signups.set("gm-new", {
      ...signup("gm-new", "gm", NOW + 100),
      displayName: "New GM",
    });
    repository.signups.set("gm-veteran", {
      ...signup("gm-veteran", "gm", NOW),
      displayName: "Veteran GM",
    });
    repository.gmStats.push({
      gmUserId: "gm-veteran",
      selectionCount: 2,
      lastSelectedAt: NOW - 7 * 86_400_000,
    });
    for (let index = 1; index <= 4; index += 1) {
      const id = "player-" + index;
      repository.signups.set(id, signup(id, "player", NOW + index));
    }
    const instance = service(repository, new FakeDiscord(), [
      "plan-explanations",
      "table-explanations",
      "assignment-1",
      "assignment-2",
      "assignment-3",
      "assignment-4",
    ]);

    const generated = await instance.generatePlan("synthetic-guild", "admin-1");
    const preview = JSON.stringify(generated.preview);

    expect(preview).toContain(
      "Selected GM New GM — priority 1 of 2; never selected before.",
    );
    expect(preview).toContain(
      "Waitlisted GM Veteran GM — priority 2 of 2; 2 prior selections; last selected",
    );
    expect(preview).toContain(
      "The 4 player signups support fewer tables at the configured minimum of 4.",
    );
    expect(repository.audits.at(-1)).toMatchObject({
      action: "plan.generated",
      details: {
        selectedGms: ["gm-new"],
        unselectedGms: ["gm-veteran"],
      },
    });
  });

  it("overrides a draft table with an active GM and renders the persisted preview", async () => {
    const repository = new FakeRepository();
    repository.event = weeklyEvent("planned");
    const bundle = planBundle();
    repository.bundles.set("plan-1", bundle);
    repository.signups.set("gm-new", {
      ...signup("gm-new", "gm"),
      displayName: "New GM",
    });
    const instance = service(repository, new FakeDiscord());

    const overridden = await instance.overrideDraft({
      guildId: "synthetic-guild",
      actorUserId: "admin-1",
      tableNumber: 1,
      title: "  One\nShot  ",
      capacity: 8,
      gmUserId: "gm-new",
      reason: "Balancing table capacity",
    });

    expect(repository.overrideCalls).toEqual([
      {
        planId: "plan-1",
        tableNumber: 1,
        title: "One Shot",
        capacity: 8,
        gmUserId: "gm-new",
        gmDisplayName: "New GM",
      },
    ]);
    expect(overridden.bundle.tables[0]).toMatchObject({
      title: "One Shot",
      capacity: 8,
      gmUserId: "gm-new",
      gmDisplayName: "New GM",
    });
    expect(JSON.stringify(overridden.preview)).toContain("One Shot");
    expect(JSON.stringify(overridden.preview)).toContain("New GM");
    expect(repository.audits.at(-1)).toMatchObject({
      action: "plan.table-overridden",
      entityType: "plan_table",
      entityId: "table-1",
      details: {
        tableNumber: 1,
        title: "One Shot",
        capacity: 8,
        gmUserId: "gm-new",
        reason: "Balancing table capacity",
      },
    });
    expect(JSON.stringify(overridden.preview)).toContain(
      "Admin override: Balancing table capacity",
    );
  });

  it("requires an administrator to explain every draft override", async () => {
    const repository = new FakeRepository();
    repository.event = weeklyEvent("planned");
    repository.bundles.set("plan-1", planBundle());
    const instance = service(repository, new FakeDiscord());

    await expect(
      instance.overrideDraft({
        guildId: "synthetic-guild",
        actorUserId: "admin-1",
        tableNumber: 1,
        title: "A changed title",
        reason: " ",
      }),
    ).rejects.toThrow("reason must contain 3 through 500 characters.");
    expect(repository.overrideCalls).toHaveLength(0);
    expect(repository.audits).toHaveLength(0);
  });

  it.each([0, 21, 1.5])("rejects invalid override capacity %s", async (capacity) => {
    const repository = new FakeRepository();
    repository.event = weeklyEvent("planned");
    repository.bundles.set("plan-1", planBundle());
    const instance = service(repository, new FakeDiscord());

    await expect(
      instance.overrideDraft({
        guildId: "synthetic-guild",
        tableNumber: 1,
        capacity,
        reason: "Testing capacity validation",
      }),
    ).rejects.toThrow("capacity must be an integer from 1 through 20");
    expect(repository.overrideCalls).toHaveLength(0);
  });

  it("rejects an override with no changed fields", async () => {
    const repository = new FakeRepository();
    repository.event = weeklyEvent("planned");
    repository.bundles.set("plan-1", planBundle());
    const instance = service(repository, new FakeDiscord());

    await expect(
      instance.overrideDraft({
        guildId: "synthetic-guild",
        tableNumber: 1,
        reason: "No fields selected",
      }),
    ).rejects.toThrow("Choose at least one of name, capacity, or gm");
    expect(repository.overrideCalls).toHaveLength(0);
  });

  it("rejects a table override when the selected member is not an active GM", async () => {
    const repository = new FakeRepository();
    repository.event = weeklyEvent("planned");
    repository.bundles.set("plan-1", planBundle());
    repository.signups.set("not-gm", signup("not-gm", "player"));
    const instance = service(repository, new FakeDiscord());

    await expect(
      instance.overrideDraft({
        guildId: "synthetic-guild",
        tableNumber: 1,
        gmUserId: "not-gm",
        reason: "Replacing the scheduled GM",
      }),
    ).rejects.toThrow("not an active GM signup");
    expect(repository.overrideCalls).toHaveLength(0);
    expect(repository.audits).toHaveLength(0);
  });

  it("persists each successful table message before a later publish failure", async () => {
    const repository = new FakeRepository();
    repository.event = weeklyEvent("planned");
    repository.bundles.set("plan-1", planBundle());
    const discord = new FakeDiscord();
    discord.failSendNumber = 2;
    const instance = service(repository, discord);

    await expect(instance.publishPlan("synthetic-guild", "admin-1")).rejects.toThrow(
      "synthetic Discord send failure",
    );

    expect(repository.tableMessageWrites).toEqual([
      { tableId: "table-1", channelId: "tables-channel", messageId: "message-1" },
    ]);
    expect(repository.bundles.get("plan-1")?.tables[0]).toMatchObject({
      channelId: "tables-channel",
      messageId: "message-1",
    });
    expect(repository.finishedOperations.at(-1)?.outcome).toMatchObject({ status: "failed" });
  });

  it("resumes partial table publication by editing persisted messages and sending only missing ones", async () => {
    const repository = new FakeRepository();
    repository.event = weeklyEvent("planned");
    const bundle = planBundle();
    bundle.tables[0]!.channelId = "tables-channel";
    bundle.tables[0]!.messageId = "persisted-message";
    repository.bundles.set("plan-1", bundle);
    const discord = new FakeDiscord();
    const instance = service(repository, discord);

    const published = await instance.publishPlan("synthetic-guild", "admin-1");

    expect(discord.edits).toHaveLength(1);
    expect(discord.edits[0]).toMatchObject({
      channelId: "tables-channel",
      messageId: "persisted-message",
    });
    expect(discord.sends).toHaveLength(1);
    expect(repository.tableMessageWrites).toEqual([
      { tableId: "table-2", channelId: "tables-channel", messageId: "message-1" },
    ]);
    expect(published.links).toHaveLength(2);
    expect(repository.finishedOperations.at(-1)?.outcome).toMatchObject({
      status: "succeeded",
    });

    const sends = discord.sends.length;
    const edits = discord.edits.length;
    const replay = await instance.publishPlan("synthetic-guild", "admin-1");
    expect(replay.links).toEqual(published.links);
    expect(discord.sends).toHaveLength(sends);
    expect(discord.edits).toHaveLength(edits);
  });

  it("reclaims a failed publication and resumes its persisted messages", async () => {
    const repository = new FakeRepository();
    repository.event = weeklyEvent("planned");
    const bundle = planBundle();
    bundle.tables[0]!.channelId = "tables-channel";
    bundle.tables[0]!.messageId = "persisted-before-failure";
    repository.bundles.set("plan-1", bundle);
    repository.operations.set(
      "publish:event-1:plan-1",
      operation("publish:event-1:plan-1", "failed"),
    );
    const discord = new FakeDiscord();
    const instance = service(repository, discord);

    const retried = await instance.retryPublish("synthetic-guild", "admin-1");

    expect(retried.links).toHaveLength(2);
    expect(discord.edits).toHaveLength(1);
    expect(discord.sends).toHaveLength(1);
    expect(repository.operations.get("publish:event-1:plan-1")?.status).toBe("succeeded");
  });

  it("replays a succeeded publication without sending or editing duplicate messages", async () => {
    const repository = new FakeRepository();
    repository.event = weeklyEvent("planned");
    const bundle = planBundle();
    for (const [index, table] of bundle.tables.entries()) {
      table.channelId = "tables-channel";
      table.messageId = "persisted-" + (index + 1);
    }
    repository.bundles.set("plan-1", bundle);
    repository.forcedClaim = {
      claimed: false,
      operation: operation("publish:event-1:plan-1", "succeeded"),
    };
    const discord = new FakeDiscord();
    const instance = service(repository, discord);

    const replay = await instance.publishPlan("synthetic-guild");

    expect(replay.links).toHaveLength(2);
    expect(discord.sends).toHaveLength(0);
    expect(discord.edits).toHaveLength(0);
    expect(repository.finishedOperations).toHaveLength(0);
  });

  it.each([
    ["started", "Another administrator is already publishing"],
    ["failed", "The last publish failed"],
  ] as const)("reports an existing %s publish operation", async (status, message) => {
    const repository = new FakeRepository();
    repository.event = weeklyEvent("planned");
    repository.bundles.set("plan-1", planBundle());
    repository.forcedClaim = {
      claimed: false,
      operation: operation("publish:event-1:plan-1", status),
    };
    const instance = service(repository, new FakeDiscord());

    await expect(instance.publishPlan("synthetic-guild")).rejects.toThrow(message);
  });

  it("joins, changes, leaves, promotes, and refreshes only affected table cards", async () => {
    const repository = new FakeRepository();
    repository.event = weeklyEvent("published");
    const bundle = planBundle(draftPlan({ status: "published", publishedAt: NOW }));
    for (const [index, table] of bundle.tables.entries()) {
      table.channelId = "tables-channel";
      table.messageId = "table-message-" + (index + 1);
    }
    bundle.assignments.push(
      assignment("player-a", "assigned", {
        tableId: "table-1",
        desiredTableId: "table-1",
      }),
      assignment("player-b"),
      assignment("player-w", "waitlisted", {
        desiredTableId: "table-1",
        waitlistPosition: 1,
      }),
    );
    repository.bundles.set("plan-1", bundle);
    const discord = new FakeDiscord();
    const instance = service(repository, discord);

    await expect(
      instance.selectTable({
        guildId: "synthetic-guild",
        planId: "plan-1",
        tableId: "table-2",
        userId: "player-b",
        action: "join",
      }),
    ).resolves.toMatchObject({ message: "You joined this table." });
    await expect(
      instance.selectTable({
        guildId: "synthetic-guild",
        planId: "plan-1",
        tableId: "table-1",
        userId: "player-b",
        action: "join",
      }),
    ).resolves.toMatchObject({
      message: "This table is full; you are waitlisted at position 2.",
    });
    const left = await instance.selectTable({
      guildId: "synthetic-guild",
      planId: "plan-1",
      tableId: "table-1",
      userId: "player-a",
      action: "leave",
    });

    expect(left.message).toBe("You left the table and player-w was promoted.");
    expect(repository.joinCalls).toHaveLength(2);
    expect(repository.leaveCalls).toHaveLength(1);
    expect(bundle.assignments.find((item) => item.userId === "player-w")).toMatchObject({
      status: "assigned",
      tableId: "table-1",
    });
    expect(discord.edits.map((edit) => edit.messageId)).toEqual([
      "table-message-2",
      "table-message-1",
      "table-message-2",
      "table-message-1",
    ]);
  });

  it("rejects a table interaction replayed from a different guild", async () => {
    const repository = new FakeRepository();
    repository.event = weeklyEvent("published");
    const bundle = planBundle(draftPlan({ status: "published", publishedAt: NOW }));
    bundle.assignments.push(assignment("player-a"));
    repository.bundles.set("plan-1", bundle);
    const discord = new FakeDiscord();
    const instance = service(repository, discord);

    await expect(
      instance.selectTable({
        guildId: "other-guild",
        planId: "plan-1",
        tableId: "table-1",
        userId: "player-a",
        action: "join",
      }),
    ).rejects.toThrow("That table plan belongs to a different server.");
    expect(repository.joinCalls).toHaveLength(0);
    expect(repository.leaveCalls).toHaveLength(0);
    expect(discord.edits).toHaveLength(0);
  });

  it("guards unfinished weeks from archive and supports explicit audited cancellation", async () => {
    const repository = new FakeRepository();
    repository.event = weeklyEvent("open");
    const discord = new FakeDiscord();
    const instance = service(repository, discord);

    await expect(instance.archiveWeek("synthetic-guild", "admin-1")).rejects.toThrow(
      "Only planned or published weeks can be archived. Use /week cancel for an unfinished week.",
    );
    expect(repository.event.status).toBe("open");
    expect(repository.audits).toHaveLength(0);

    const cancelled = await instance.cancelWeek(
      "synthetic-guild",
      "admin-1",
      "Venue unavailable this week",
    );

    expect(cancelled.status).toBe("cancelled");
    expect(discord.edits).toHaveLength(1);
    expect(discord.edits[0]?.payload.components).toEqual([]);
    expect(repository.audits.at(-1)).toMatchObject({
      action: "week.cancelled",
      entityType: "weekly_event",
      entityId: "event-1",
      details: { reason: "Venue unavailable this week" },
    });
  });

  it("archives signup and table messages with all controls closed", async () => {
    const repository = new FakeRepository();
    repository.event = weeklyEvent("published");
    const bundle = planBundle(draftPlan({ status: "published", publishedAt: NOW }));
    bundle.tables[0]!.channelId = "tables-channel";
    bundle.tables[0]!.messageId = "table-message-1";
    bundle.tables.splice(1);
    repository.bundles.set("plan-1", bundle);
    const discord = new FakeDiscord();
    const instance = service(repository, discord);

    const archived = await instance.archiveWeek("synthetic-guild", "admin-1");

    expect(archived.status).toBe("archived");
    expect(discord.edits).toHaveLength(2);
    expect(discord.edits[0]?.payload.components).toEqual([]);
    const tableButtons = discord.edits[1]?.payload.components?.[0]?.components ?? [];
    expect(tableButtons.every((button) => button.disabled === true)).toBe(true);
  });

  it("renders a complete status from synthetic values without null artifacts", async () => {
    const repository = new FakeRepository();
    repository.event = weeklyEvent("planned");
    repository.signups.set("gm-1", signup("gm-1", "gm"));
    repository.signups.set("player-1", signup("player-1", "player"));
    repository.bundles.set("plan-1", planBundle());
    const instance = service(repository, new FakeDiscord());

    const status = await instance.getStatus("synthetic-guild");

    expect(status).toContain("## Guild Assistant status");
    expect(status).toContain("Synthetic Saturday Games");
    expect(status).toContain("1 GMs / 1 players");
    expect(status).toContain("draft revision 1");
    expect(status).not.toContain("undefined");
    expect(status).not.toContain("null");
  });

  it("escapes Markdown and flattens newlines in a hostile event title", async () => {
    const repository = new FakeRepository();
    repository.event = weeklyEvent("planned", {
      title: "**Forged**\n| fake field |\r\n`code`",
    });
    const instance = service(repository, new FakeDiscord());

    const status = await instance.getStatus("synthetic-guild");
    const currentWeek = status
      .split("\n")
      .find((line) => line.startsWith("**Current week:**"));

    expect(currentWeek).toContain("\\*\\*Forged\\*\\*");
    expect(currentWeek).toContain("\\| fake field \\|");
    expect(currentWeek).toContain("\\`code\\`");
    expect(currentWeek).not.toContain("\r");
    expect(status.split("\n").filter((line) => line.includes("fake field"))).toHaveLength(1);
  });

  it("uses user-facing errors for missing configuration", async () => {
    const repository = new FakeRepository();
    repository.config = null;
    const instance = service(repository, new FakeDiscord());

    await expect(instance.openWeek({ guildId: "synthetic-guild" })).rejects.toBeInstanceOf(
      UserFacingError,
    );
  });
});
