import {
  DiscordRestClient,
  discordNonce,
  renderFinalManifest,
  renderPlanPreview,
  renderPublishedTable,
  renderSignupMessage,
  type DiscordMessagePayload,
  type PlanPreviewInput,
  type PublishedTableInput,
} from "./discord-api";
import {
  planTables,
  rankGmCandidates,
  type GmCandidate,
} from "./domain/table-planner";
import { nextWeeklyOccurrence } from "./schedule";
import {
  GuildRepository,
  TableSelectionUnavailableError,
  type Assignment,
  type GuildConfig,
  type PlanBundle,
  type PlanTable,
  type SaveDraftPlanInput,
  type Signup,
  type SignupKind,
  type WeeklyEvent,
} from "./storage/repository";
import { UserFacingError } from "./interaction-utils";

const ALGORITHM_VERSION = "balanced-rotation-v1";
const WEEKDAY_NAMES = [
  "",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export interface WeekServiceOptions {
  now?: () => number;
  id?: () => string;
}

export interface TableSelectionResult {
  message: string;
  payload: DiscordMessagePayload;
}

function defaultId(): string {
  return crypto.randomUUID();
}

function unix(value: number): string {
  return "<t:" + Math.floor(value / 1000) + ":F>";
}

function userLabel(signup: Signup): string {
  return signup.displayName || "<@" + signup.userId + ">";
}

function safeInline(value: string, maximum = 100): string {
  return value
    .replace(/[\\`*_~|]/g, "\\$&")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, maximum);
}

export class WeekService {
  private readonly now: () => number;
  private readonly id: () => string;

  constructor(
    private readonly repository: GuildRepository,
    private readonly discord: DiscordRestClient,
    options: WeekServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.id = options.id ?? defaultId;
  }

  private gmDecisionExplanations(
    candidates: readonly GmCandidate[],
    selectedUserIds: ReadonlySet<string>,
    playerCount: number,
    minimumPlayersPerTable: number,
  ): string[] {
    const ranked = rankGmCandidates(candidates);
    return ranked.map((gm, index) => {
      const name = gm.displayName ?? gm.userId;
      const history =
        gm.selectionCount === 0
          ? "never selected before"
          : gm.selectionCount +
            " prior selection" +
            (gm.selectionCount === 1 ? "" : "s") +
            (gm.lastSelectedAt === null || gm.lastSelectedAt === undefined
              ? ""
              : "; last selected " + unix(gm.lastSelectedAt));
      const priority = "priority " + (index + 1) + " of " + ranked.length;
      return selectedUserIds.has(gm.userId)
        ? "Selected GM " + name + " — " + priority + "; " + history + "."
        : "Waitlisted GM " +
            name +
            " — " +
            priority +
            "; " +
            history +
            ". The " +
            playerCount +
            " player signups support fewer tables at the configured minimum of " +
            minimumPlayersPerTable +
            ".";
    });
  }

  async requireConfig(guildId: string): Promise<GuildConfig> {
    const config = await this.repository.getGuildConfig(guildId);
    if (!config) {
      throw new UserFacingError(
        "This server is not configured yet. An administrator must run /guild setup.",
      );
    }
    if (!config.eventChannelId) {
      throw new UserFacingError(
        "The event channel is missing. Run /guild setup and choose a channel.",
      );
    }
    return config;
  }

  async getStatus(guildId: string): Promise<string> {
    const config = await this.repository.getGuildConfig(guildId);
    if (!config) {
      return "⚠️ Not configured. Run /guild setup.";
    }
    const event = await this.repository.getCurrentWeeklyEvent(guildId);
    const lines = [
      "## Guild Assistant status",
      "**Channel:** " + (config.eventChannelId ? "<#" + config.eventChannelId + ">" : "missing"),
      "**Weekly GM role:** " +
        (config.gmRoleId ? "<@&" + config.gmRoleId + ">" : "optional; not configured"),
      "**Reminder role:** " +
        (config.reminderRoleId ? "<@&" + config.reminderRoleId + ">" : "not configured"),
      "**Schedule:** " +
        (WEEKDAY_NAMES[config.weeklyDay] ?? "weekday " + config.weeklyDay) +
        " at " +
        config.weeklyTime +
        " (" +
        config.timezone +
        ")",
      "**Signup timing:** opens " +
        config.signupOpenLeadDays +
        " day" +
        (config.signupOpenLeadDays === 1 ? "" : "s") +
        " before; locks " +
        config.signupLockLeadHours +
        " hour" +
        (config.signupLockLeadHours === 1 ? "" : "s") +
        " before",
      "**Tables:** " +
        config.tableMinSize +
        " minimum / " +
        config.tablePreferredSize +
        " preferred / " +
        config.tableMaxSize +
        " maximum",
      "**Automation:** scheduling " +
        (config.schedulingEnabled ? "on" : "off") +
        ", auto-publish " +
        (config.autoPublishEnabled ? "on" : "off") +
        ", role sync " +
        (config.roleSyncEnabled ? "on" : "off"),
    ];
    if (!event) {
      lines.push("**Current week:** none");
      return lines.join("\n");
    }

    const [counts, draft, operations, reminders] = await Promise.all([
      this.repository.countActiveSignups(event.eventId),
      this.repository.getLatestDraftPlan(event.eventId),
      this.repository.listRecentOperations(guildId, event.eventId, 5),
      this.repository.listRecentReminders(guildId, 5),
    ]);
    const currentPlan = draft ?? (await this.repository.getCurrentPlan(event.eventId));
    const bundle = currentPlan
      ? await this.repository.getPlanBundle(currentPlan.planId)
      : null;
    lines.push(
      "**Current week:** " + safeInline(event.title) + " — " + unix(event.startsAt),
      "**Event ID:** " + safeInline(event.eventId, 180),
      "**Phase:** " + event.status,
      "**Signups:** " + counts.gms + " GMs / " + counts.players + " players",
      "**Plan:** " +
        (currentPlan
          ? currentPlan.status + " revision " + currentPlan.generation +
            " (" + currentPlan.selectedGmCount + " tables)"
          : "not generated"),
    );
    if (currentPlan?.status === "published") {
      const manifestCurrent =
        Boolean(event.finalManifestChannelId && event.finalManifestMessageId) &&
        event.finalizedPlanId === currentPlan.planId &&
        event.finalizedTableStateVersion === event.tableStateVersion;
      lines.push(
        "**Final roster:** " +
          (manifestCurrent
            ? "current (state " + event.tableStateVersion + ")"
            : this.now() < event.tableSelectionClosesAt
              ? "scheduled after table selection closes " + unix(event.tableSelectionClosesAt)
              : "awaiting regeneration for state " + event.tableStateVersion),
      );
    }
    if (bundle?.tables.some((table) => table.channelId && table.messageId)) {
      lines.push(
        "**Published table messages:**",
        ...bundle.tables
          .filter((table) => table.channelId && table.messageId)
          .map(
            (table) =>
              "• " +
              safeInline(table.title) +
              ": https://discord.com/channels/" +
              guildId +
              "/" +
              table.channelId +
              "/" +
              table.messageId,
          ),
      );
    }
    const relevantReminders = reminders.filter(
      (reminder) => reminder.eventId === event.eventId,
    );
    if (relevantReminders.length) {
      lines.push(
        "**Recent reminders:**",
        ...relevantReminders.map(
          (reminder) =>
            "• " +
            reminder.status +
            " · attempts " +
            reminder.attemptCount +
            (reminder.sentMessageId
              ? " · https://discord.com/channels/" +
                guildId +
                "/" +
                reminder.channelId +
                "/" +
                reminder.sentMessageId
              : "") +
            (reminder.lastError ? " · " + safeInline(reminder.lastError, 180) : ""),
        ),
      );
    }
    if (operations.length) {
      lines.push(
        "**Recent operations:**",
        ...operations.map(
          (operation) =>
            "• " +
            operation.status +
            " · " +
            safeInline(operation.operationKind) +
            " · " +
            safeInline(operation.operationKey) +
            (operation.lastError ? " · " + safeInline(operation.lastError, 180) : ""),
        ),
      );
    }
    return lines.join("\n");
  }

  async openWeek(input: {
    guildId: string;
    actorUserId?: string;
    startsAt?: string;
    title?: string;
  }): Promise<WeeklyEvent> {
    const config = await this.requireConfig(input.guildId);
    const current = await this.repository.getCurrentWeeklyEvent(input.guildId);
    if (current) {
      if (current.status === "open") {
        await this.ensureSignupPost(current, config);
        return current;
      }
      throw new UserFacingError(
        "A week is already active in phase '" +
          current.status +
          "'. Finish or archive it before opening another.",
      );
    }

    let startsAt: number;
    if (input.startsAt) {
      startsAt = Date.parse(input.startsAt);
      if (!Number.isFinite(startsAt)) {
        throw new UserFacingError(
          "starts_at must be a valid ISO-8601 instant such as 2026-08-09T00:30:00Z.",
        );
      }
    } else {
      startsAt = Date.parse(
        nextWeeklyOccurrence(
          {
            weekday: config.weeklyDay,
            time: config.weeklyTime,
            timeZone: config.timezone,
          },
          new Date(this.now()).toISOString(),
        ),
      );
    }
    if (startsAt <= this.now()) {
      throw new UserFacingError("The game start must be in the future.");
    }

    const event = await this.repository.createWeeklyEvent({
      eventId: this.id(),
      guildId: input.guildId,
      title: input.title?.trim() || "Weekly Games",
      startsAt,
      endsAt: startsAt + config.eventDurationMinutes * 60_000,
      signupOpensAt: startsAt - config.signupOpenLeadDays * 86_400_000,
      signupLocksAt: startsAt - config.signupLockLeadHours * 3_600_000,
      tableSelectionClosesAt: startsAt,
      status: "open",
      source: "native",
      createdByUserId: input.actorUserId,
    });
    await this.ensureSignupPost(event, config);
    await this.repository.appendAudit({
      guildId: input.guildId,
      eventId: event.eventId,
      actorUserId: input.actorUserId,
      action: "week.opened",
      entityType: "weekly_event",
      entityId: event.eventId,
      details: { startsAt },
    });
    return (await this.repository.getWeeklyEvent(event.eventId)) ?? event;
  }

  async openExistingEvent(event: WeeklyEvent): Promise<void> {
    const config = await this.requireConfig(event.guildId);
    if (event.status === "draft") {
      const transitioned = await this.repository.transitionEventStatus(
        event.eventId,
        "draft",
        "open",
      );
      if (!transitioned) {
        const latest = await this.repository.getWeeklyEvent(event.eventId);
        if (latest?.status !== "open") {
          throw new Error("Could not move scheduled event from draft to open.");
        }
      }
    } else if (event.status !== "open") {
      return;
    }
    const latest = (await this.repository.getWeeklyEvent(event.eventId)) ?? event;
    await this.ensureSignupPost(latest, config);
  }

  async signupPayload(event: WeeklyEvent): Promise<DiscordMessagePayload> {
    const [gms, players] = await Promise.all([
      this.repository.listActiveSignups(event.eventId, "gm"),
      this.repository.listActiveSignups(event.eventId, "player"),
    ]);
    return renderSignupMessage({
      eventId: event.eventId,
      title: event.title,
      startsAt: event.startsAt,
      signupDeadline: event.signupLocksAt,
      description: "Choose Run a Game or Play. Your latest choice is authoritative.",
      status:
        event.status === "open"
          ? "open"
          : event.status === "archived" || event.status === "cancelled"
            ? "archived"
            : "locked",
      gmNames: gms.map(userLabel),
      playerNames: players.map(userLabel),
    });
  }

  private async ensureSignupPost(
    event: WeeklyEvent,
    config: GuildConfig,
  ): Promise<void> {
    const payload = await this.signupPayload(event);
    if (event.signupChannelId && event.signupMessageId) {
      await this.discord.editChannelMessage(
        event.signupChannelId,
        event.signupMessageId,
        payload,
      );
      return;
    }
    const channelId = config.eventChannelId;
    if (!channelId) throw new UserFacingError("No event channel is configured.");
    const message = await this.discord.sendChannelMessage(channelId, {
      ...payload,
      nonce: discordNonce("signup:" + event.eventId),
      enforce_nonce: true,
    });
    await this.repository.setEventMessages(event.eventId, {
      signupChannelId: channelId,
      signupMessageId: message.id,
    });
  }

  async changeSignup(input: {
    guildId: string;
    eventId: string;
    userId: string;
    displayName: string;
    action: SignupKind | "withdraw";
  }): Promise<{ event: WeeklyEvent; payload: DiscordMessagePayload; message: string }> {
    const event = await this.repository.getWeeklyEvent(input.eventId);
    if (!event) throw new UserFacingError("That weekly signup no longer exists.");
    if (event.guildId !== input.guildId) {
      throw new UserFacingError("That weekly signup belongs to a different server.");
    }
    if (event.status !== "open") {
      throw new UserFacingError(
        "Signups are " + event.status + ". Ask an administrator about a late correction.",
      );
    }

    let message: string;
    if (input.action === "withdraw") {
      const changed = await this.repository.withdrawSignup(input.eventId, input.userId);
      message = changed ? "Signup withdrawn." : "You were not actively signed up.";
    } else {
      await this.repository.saveSignup({
        eventId: input.eventId,
        userId: input.userId,
        displayName: input.displayName,
        signupKind: input.action,
        source: "native",
      });
      message = input.action === "gm" ? "Signed up to run a game." : "Signed up to play.";
    }
    await this.repository.appendAudit({
      guildId: event.guildId,
      eventId: event.eventId,
      actorUserId: input.userId,
      action: "signup." + input.action,
      entityType: "signup",
      entityId: input.userId,
    });
    return { event, payload: await this.signupPayload(event), message };
  }

  async lockWeek(
    guildId: string,
    actorUserId?: string,
    eventId?: string,
  ): Promise<WeeklyEvent> {
    const event = eventId
      ? await this.repository.getWeeklyEvent(eventId)
      : await this.repository.getCurrentWeeklyEvent(guildId);
    if (!event) throw new UserFacingError("There is no active week to lock.");
    if (event.guildId !== guildId) {
      throw new UserFacingError("That weekly event belongs to a different server.");
    }
    if (event.status === "open") {
      const transitioned = await this.repository.transitionEventStatus(
        event.eventId,
        "open",
        "locked",
      );
      if (!transitioned) throw new UserFacingError("The week changed; run /week status and retry.");
    } else if (!["locked", "planned", "published"].includes(event.status)) {
      throw new UserFacingError(
        "Cannot lock a week in phase '" + event.status + "'. Open signups first.",
      );
    }
    const locked = (await this.repository.getWeeklyEvent(event.eventId)) ?? event;
    if (locked.signupChannelId && locked.signupMessageId) {
      await this.discord.editChannelMessage(
        locked.signupChannelId,
        locked.signupMessageId,
        await this.signupPayload(locked),
      );
    }
    await this.repository.appendAudit({
      guildId,
      eventId: event.eventId,
      actorUserId,
      action: "week.locked",
      entityType: "weekly_event",
      entityId: event.eventId,
    });
    return locked;
  }

  async correctSignup(input: {
    guildId: string;
    actorUserId?: string;
    userId: string;
    displayName: string;
    action: SignupKind | "withdraw";
  }): Promise<{ event: WeeklyEvent; warning?: string; requiresReplan: boolean }> {
    const event = await this.repository.getCurrentWeeklyEvent(input.guildId);
    if (!event) throw new UserFacingError("There is no active week to correct.");
    if (event.status === "archived" || event.status === "cancelled") {
      throw new UserFacingError("Archived or cancelled weeks cannot be corrected.");
    }
    const previousSignup = await this.repository.getSignup(event.eventId, input.userId);
    const plan = ["planned", "published"].includes(event.status)
      ? await this.repository.getCurrentPlan(event.eventId)
      : null;
    const affectsGm =
      input.action === "gm" || previousSignup?.signupKind === "gm";
    let assignmentMayHaveChanged = false;
    if (input.action === "withdraw") {
      await this.repository.withdrawSignup(event.eventId, input.userId);
      if (plan) {
        await this.repository.withdrawAssignmentAndPromote(plan.planId, input.userId);
        assignmentMayHaveChanged = true;
      }
    } else {
      await this.repository.saveSignup({
        eventId: event.eventId,
        userId: input.userId,
        displayName: input.displayName,
        signupKind: input.action,
        source: "admin",
      });
      if (plan?.status === "published" && input.action === "player") {
        await this.repository.ensureUnassignedAssignment({
          assignmentId: this.id(),
          planId: plan.planId,
          userId: input.userId,
          displayName: input.displayName,
        });
      } else if (plan?.status === "published" && input.action === "gm") {
        // A seated player who becomes a GM must immediately release their seat;
        // the normal promotion path keeps the visible published plan consistent.
        await this.repository.withdrawAssignmentAndPromote(plan.planId, input.userId);
        assignmentMayHaveChanged = true;
      }
    }
    if (plan?.status === "published" && assignmentMayHaveChanged) {
      const bundle = await this.repository.getPlanBundle(plan.planId);
      if (bundle) await this.refreshPublishedTables(event, bundle);
    }
    const latest = (await this.repository.getWeeklyEvent(event.eventId)) ?? event;
    if (latest.signupChannelId && latest.signupMessageId) {
      await this.discord.editChannelMessage(
        latest.signupChannelId,
        latest.signupMessageId,
        await this.signupPayload(latest),
      );
    }
    await this.repository.appendAudit({
      guildId: input.guildId,
      eventId: event.eventId,
      actorUserId: input.actorUserId,
      action: "signup.admin-correction",
      entityType: "signup",
      entityId: input.userId,
      details: { action: input.action },
    });
    const requiresReplan =
      ["planned", "published"].includes(event.status) && affectsGm;
    return {
      event: latest,
      requiresReplan,
      warning: requiresReplan
        ? "The plan predates this correction. Run /week plan, review the new revision, and publish it."
        : undefined,
    };
  }

  private carryForwardAssignments(
    players: readonly Signup[],
    tables: ReadonlyArray<SaveDraftPlanInput["tables"][number]>,
    previous: PlanBundle | null,
  ): SaveDraftPlanInput["assignments"] {
    const next = new Map<string, SaveDraftPlanInput["assignments"][number]>(
      players.map((player) => [
        player.userId,
        {
          assignmentId: this.id(),
          tableId: null,
          userId: player.userId,
          displayName: player.displayName || player.userId,
          status: "unassigned" as const,
          waitlistPosition: null,
        },
      ]),
    );
    if (!previous) return players.map((player) => next.get(player.userId)!);

    const playerById = new Map(players.map((player) => [player.userId, player]));
    const previousTableById = new Map(
      previous.tables.map((table) => [table.tableId, table]),
    );
    const nextTableByGm = new Map(tables.map((table) => [table.gmUserId, table]));
    const compatible = new Map<string, Assignment[]>();

    for (const assignment of previous.assignments) {
      if (!playerById.has(assignment.userId)) continue;
      if (assignment.status !== "assigned" && assignment.status !== "waitlisted") continue;
      const desiredTableId = assignment.desiredTableId ?? assignment.tableId;
      const previousTable = desiredTableId
        ? previousTableById.get(desiredTableId)
        : undefined;
      const nextTable = previousTable
        ? nextTableByGm.get(previousTable.gmUserId)
        : undefined;
      if (!nextTable) continue;
      const candidates = compatible.get(nextTable.tableId) ?? [];
      candidates.push(assignment);
      compatible.set(nextTable.tableId, candidates);
    }

    for (const table of tables) {
      const candidates = (compatible.get(table.tableId) ?? []).sort((left, right) => {
        const status =
          Number(left.status === "waitlisted") - Number(right.status === "waitlisted");
        if (status !== 0) return status;
        if (left.status === "waitlisted" && right.status === "waitlisted") {
          const position =
            (left.waitlistPosition ?? Number.MAX_SAFE_INTEGER) -
            (right.waitlistPosition ?? Number.MAX_SAFE_INTEGER);
          if (position !== 0) return position;
        }
        const time =
          (left.assignedAt ?? left.updatedAt) - (right.assignedAt ?? right.updatedAt);
        return time || left.userId.localeCompare(right.userId);
      });
      for (const [index, previousAssignment] of candidates.entries()) {
        const player = playerById.get(previousAssignment.userId)!;
        if (index < table.capacity) {
          next.set(player.userId, {
            assignmentId: next.get(player.userId)!.assignmentId,
            tableId: table.tableId,
            desiredTableId: table.tableId,
            userId: player.userId,
            displayName: player.displayName || player.userId,
            status: "assigned",
            waitlistPosition: null,
            assignedAt:
              previousAssignment.status === "assigned"
                ? (previousAssignment.assignedAt ?? this.now())
                : this.now(),
          });
        } else {
          next.set(player.userId, {
            assignmentId: next.get(player.userId)!.assignmentId,
            tableId: null,
            desiredTableId: table.tableId,
            userId: player.userId,
            displayName: player.displayName || player.userId,
            status: "waitlisted",
            waitlistPosition: index - table.capacity + 1,
          });
        }
      }
    }

    return players.map((player) => next.get(player.userId)!);
  }

  async generatePlan(
    guildId: string,
    actorUserId?: string,
    eventId?: string,
  ): Promise<{ event: WeeklyEvent; bundle: PlanBundle; preview: DiscordMessagePayload }> {
    const config = await this.requireConfig(guildId);
    let event = eventId
      ? await this.repository.getWeeklyEvent(eventId)
      : await this.repository.getCurrentWeeklyEvent(guildId);
    if (!event) throw new UserFacingError("There is no active week to plan.");
    if (event.guildId !== guildId) {
      throw new UserFacingError("That weekly event belongs to a different server.");
    }
    if (event.status === "open") {
      event = await this.lockWeek(guildId, actorUserId, event.eventId);
    }
    if (!["locked", "planned", "published"].includes(event.status)) {
      throw new UserFacingError(
        "A table draft requires locked signups; current phase is '" + event.status + "'.",
      );
    }

    const previousPlan =
      event.status === "published"
        ? await this.repository.getCurrentPlan(event.eventId)
        : null;
    const previousBundle =
      previousPlan?.status === "published"
        ? await this.repository.getPlanBundle(previousPlan.planId)
        : null;
    const [players, gms, stats] = await Promise.all([
      this.repository.listActiveSignups(event.eventId, "player"),
      this.repository.listActiveSignups(event.eventId, "gm"),
      this.repository.listGmSelectionStats(guildId),
    ]);
    const statsByGm = new Map(stats.map((stat) => [stat.gmUserId, stat]));
    const gmCandidates: GmCandidate[] = gms.map((gm) => {
      const history = statsByGm.get(gm.userId);
      return {
        userId: gm.userId,
        displayName: gm.displayName,
        signedUpAt: gm.signedUpAt,
        selectionCount: history?.selectionCount ?? 0,
        lastSelectedAt: history?.lastSelectedAt ?? null,
      };
    });
    const planned = planTables({
      players: players.map((player) => ({
        userId: player.userId,
        displayName: player.displayName,
        signedUpAt: player.signedUpAt,
      })),
      gms: gmCandidates,
      constraints: {
        minPlayersPerTable: config.tableMinSize,
        preferredPlayersPerTable: config.tablePreferredSize,
        maxPlayersPerTable: config.tableMaxSize,
      },
    });
    if (planned.tables.length === 0) {
      const reason =
        players.length === 0
          ? "No players are signed up."
          : gms.length === 0
            ? "No GMs are signed up."
            : "The current table policy cannot produce a table.";
      throw new UserFacingError("No table draft was created. " + reason);
    }

    const planId = this.id();
    const tableIds = planned.tables.map(() => this.id());
    const generation = await this.repository.getNextPlanGeneration(event.eventId);
    const tables: SaveDraftPlanInput["tables"] = planned.tables.map((table, index) => ({
      tableId: tableIds[index],
      tableNumber: table.tableNumber,
      title: "Table " + table.tableNumber,
      capacity: table.capacity,
      gmUserId: table.gm.userId,
      gmDisplayName: table.gm.displayName ?? table.gm.userId,
    }));
    // A revision keeps choices only when the selected GM still owns a table.
    // Assigned players retain first claim on capacity; compatible waitlists
    // preserve their stable order and fill any remaining seats.
    const assignments = this.carryForwardAssignments(players, tables, previousBundle);

    const bundle = await this.repository.saveDraftPlan({
      plan: {
        planId,
        eventId: event.eventId,
        generation,
        algorithmVersion: ALGORITHM_VERSION,
        minTableSize: config.tableMinSize,
        preferredTableSize: config.tablePreferredSize,
        maxTableSize: config.tableMaxSize,
        playerCount: players.length,
        gmSignupCount: gms.length,
        selectedGmCount: planned.tables.length,
        waitlistCount: planned.waitlist.length,
        createdByUserId: actorUserId ?? null,
      },
      tables,
      assignments,
    });
    if (event.status === "locked") {
      await this.repository.transitionEventStatus(event.eventId, "locked", "planned");
      event = (await this.repository.getWeeklyEvent(event.eventId)) ?? event;
    }
    await this.repository.appendAudit({
      guildId,
      eventId: event.eventId,
      actorUserId,
      action: "plan.generated",
      entityType: "plan",
      entityId: bundle.plan.planId,
      details: {
        generation,
        selectedGms: planned.selectedGms.map((gm) => gm.userId),
        unselectedGms: planned.unselectedGms.map((gm) => gm.userId),
        capacities: planned.tables.map((table) => table.capacity),
      },
    });
    const gmExplanations = this.gmDecisionExplanations(
      gmCandidates,
      new Set(planned.selectedGms.map((gm) => gm.userId)),
      players.length,
      config.tableMinSize,
    );
    return {
      event,
      bundle,
      preview: this.planPreview(event, bundle, [planned.rationale, ...gmExplanations]),
    };
  }

  planPreview(
    event: WeeklyEvent,
    bundle: PlanBundle,
    explanations: readonly string[] = [],
  ): DiscordMessagePayload {
    const unassigned = bundle.assignments.filter((item) => item.status === "unassigned");
    const warnings = [
      bundle.plan.selectedGmCount +
        " of " +
        bundle.plan.gmSignupCount +
        " signed-up GMs produce capacities " +
        bundle.tables.map((table) => table.capacity).join(", ") +
        " for " +
        bundle.plan.playerCount +
        " players.",
      ...explanations,
    ];
    if (unassigned.length) warnings.push(unassigned.length + " players will choose a table");
    if (bundle.plan.waitlistCount) {
      warnings.push(
        "Projected capacity shortfall: " +
          bundle.plan.waitlistCount +
          " players exceed currently planned seats; live table waitlists begin only after selection.",
      );
    }
    const input: PlanPreviewInput = {
      planId: bundle.plan.planId,
      eventTitle: event.title,
      startsAt: event.startsAt,
      tables: bundle.tables.map((table) => ({
        id: table.tableId,
        label: table.title,
        gmName: table.gmDisplayName,
        capacity: table.capacity,
        players: bundle.assignments
          .filter((assignment) => assignment.tableId === table.tableId)
          .map((assignment) => assignment.displayName),
      })),
      waitlist: bundle.assignments
        .filter((assignment) => assignment.status === "waitlisted")
        .map((assignment) => assignment.displayName),
      warnings,
    };
    return renderPlanPreview(input);
  }

  async overrideDraft(input: {
    guildId: string;
    actorUserId?: string;
    tableNumber: number;
    title?: string;
    capacity?: number;
    gmUserId?: string;
    reason: string;
  }): Promise<{ event: WeeklyEvent; bundle: PlanBundle; preview: DiscordMessagePayload }> {
    if (!Number.isInteger(input.tableNumber) || input.tableNumber < 1) {
      throw new UserFacingError("table_number must be a positive integer.");
    }
    if (
      input.capacity !== undefined &&
      (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 20)
    ) {
      throw new UserFacingError("capacity must be an integer from 1 through 20.");
    }
    const title = input.title?.replace(/[\r\n]+/g, " ").trim();
    const reason = input.reason.replace(/[\r\n]+/g, " ").trim();
    if (reason.length < 3 || reason.length > 500) {
      throw new UserFacingError("reason must contain 3 through 500 characters.");
    }
    if (title !== undefined && (title.length < 1 || title.length > 80)) {
      throw new UserFacingError("name must contain 1 through 80 characters.");
    }
    if (title === undefined && input.capacity === undefined && input.gmUserId === undefined) {
      throw new UserFacingError("Choose at least one of name, capacity, or gm.");
    }

    const event = await this.repository.getCurrentWeeklyEvent(input.guildId);
    if (!event) throw new UserFacingError("There is no active week.");
    const plan = await this.repository.getLatestDraftPlan(event.eventId);
    if (!plan) throw new UserFacingError("There is no draft to override. Run /week plan first.");
    let gmDisplayName: string | undefined;
    if (input.gmUserId) {
      const signup = await this.repository.getSignup(event.eventId, input.gmUserId);
      if (!signup || signup.status !== "active" || signup.signupKind !== "gm") {
        throw new UserFacingError("The selected member is not an active GM signup for this week.");
      }
      gmDisplayName = signup.displayName;
    }
    const table = await this.repository.updateDraftTable({
      planId: plan.planId,
      tableNumber: input.tableNumber,
      title,
      capacity: input.capacity,
      gmUserId: input.gmUserId,
      gmDisplayName,
    });
    if (!table) {
      throw new UserFacingError(
        "That draft table does not exist, changed concurrently, or the capacity is below its assigned players.",
      );
    }
    const bundle = await this.repository.getPlanBundle(plan.planId);
    if (!bundle) throw new UserFacingError("The updated draft could not be loaded.");
    await this.repository.appendAudit({
      guildId: input.guildId,
      eventId: event.eventId,
      actorUserId: input.actorUserId,
      action: "plan.table-overridden",
      entityType: "plan_table",
      entityId: table.tableId,
      details: {
        tableNumber: input.tableNumber,
        title,
        capacity: input.capacity,
        gmUserId: input.gmUserId,
        reason,
      },
    });
    const [gms, stats, config] = await Promise.all([
      this.repository.listActiveSignups(event.eventId, "gm"),
      this.repository.listGmSelectionStats(input.guildId),
      this.requireConfig(input.guildId),
    ]);
    const statsByGm = new Map(stats.map((stat) => [stat.gmUserId, stat]));
    const gmCandidates: GmCandidate[] = gms.map((gm) => ({
      userId: gm.userId,
      displayName: gm.displayName,
      signedUpAt: gm.signedUpAt,
      selectionCount: statsByGm.get(gm.userId)?.selectionCount ?? 0,
      lastSelectedAt: statsByGm.get(gm.userId)?.lastSelectedAt ?? null,
    }));
    const explanations = this.gmDecisionExplanations(
      gmCandidates,
      new Set(bundle.tables.map((candidate) => candidate.gmUserId)),
      bundle.plan.playerCount,
      config.tableMinSize,
    );
    return {
      event,
      bundle,
      preview: this.planPreview(event, bundle, [
        "Admin override: " + reason,
        ...explanations,
      ]),
    };
  }

  private publishedTableInput(
    event: WeeklyEvent,
    bundle: PlanBundle,
    table: PlanTable,
    closed?: boolean,
  ): PublishedTableInput {
    return {
      planId: bundle.plan.planId,
      id: table.tableId,
      label: table.title,
      gmName: table.gmDisplayName,
      capacity: table.capacity,
      players: bundle.assignments
        .filter((assignment) => assignment.status === "assigned" && assignment.tableId === table.tableId)
        .map((assignment) => assignment.displayName),
      waitlist: bundle.assignments
        .filter(
          (assignment) =>
            assignment.status === "waitlisted" &&
            assignment.desiredTableId === table.tableId,
        )
        .map((assignment) => assignment.displayName),
      eventTitle: event.title,
      startsAt: event.startsAt,
      closed: closed ?? this.now() >= event.tableSelectionClosesAt,
    };
  }

  private async reconcileSupersededCards(event: WeeklyEvent): Promise<void> {
    const superseded = await this.repository.getLatestSupersededPlan(event.eventId);
    if (!superseded) return;
    const bundle = await this.repository.getPlanBundle(superseded.planId);
    if (!bundle) return;
    await Promise.all(
      bundle.tables.map(async (table) => {
        if (!table.channelId || !table.messageId) return;
        await this.discord.editChannelMessage(table.channelId, table.messageId, {
          ...renderPublishedTable(this.publishedTableInput(event, bundle, table, true)),
          content: "⚠️ This table card was superseded by a newer published revision.",
        });
      }),
    );
  }

  async publishPlan(
    guildId: string,
    actorUserId?: string,
    retryFailed = false,
    eventId?: string,
  ): Promise<{ event: WeeklyEvent; bundle: PlanBundle; links: string[] }> {
    const config = await this.requireConfig(guildId);
    const event = eventId
      ? await this.repository.getWeeklyEvent(eventId)
      : await this.repository.getCurrentWeeklyEvent(guildId);
    if (!event) throw new UserFacingError("There is no active week to publish.");
    if (event.guildId !== guildId) {
      throw new UserFacingError("That weekly event belongs to a different server.");
    }
    const draft = await this.repository.getLatestDraftPlan(event.eventId);
    const current = await this.repository.getCurrentPlan(event.eventId);
    const plan = draft ?? (current?.status === "published" ? current : null);
    if (!plan) throw new UserFacingError("There is no unpublished draft. Run /week plan first.");
    let bundle = await this.repository.getPlanBundle(plan.planId);
    if (!bundle) throw new UserFacingError("The draft could not be loaded.");

    if (plan.status === "published" && !draft) {
      await this.reconcileSupersededCards(event);
      const operationKey = "publish:" + event.eventId + ":" + plan.planId;
      const previousOperation = await this.repository.getOperation(operationKey);
      if (retryFailed && previousOperation?.status === "failed") {
        const reclaimed = await this.repository.retryOperation(operationKey);
        if (reclaimed) {
          await this.repository.finishOperation(operationKey, {
            status: "succeeded",
            result: { planId: plan.planId, reconciled: true },
          });
        }
      }
      return {
        event,
        bundle,
        links: bundle.tables
          .filter((table) => table.channelId && table.messageId)
          .map(
            (table) =>
              "https://discord.com/channels/" +
              guildId +
              "/" +
              table.channelId +
              "/" +
              table.messageId,
          ),
      };
    }

    const operationKey = "publish:" + event.eventId + ":" + plan.planId;
    const claim = await this.repository.beginOperation({
      operationKey,
      guildId,
      eventId: event.eventId,
      operationKind: "publish-plan",
      request: { planId: plan.planId },
    });
    let ownsClaim = claim.claimed;
    if (!ownsClaim && claim.operation.status === "failed" && retryFailed) {
      ownsClaim = await this.repository.retryOperation(operationKey);
    }
    if (!claim.claimed && claim.operation.status === "succeeded") {
      return {
        event,
        bundle,
        links: bundle.tables
          .filter((table) => table.channelId && table.messageId)
          .map(
            (table) =>
              "https://discord.com/channels/" +
              guildId +
              "/" +
              table.channelId +
              "/" +
              table.messageId,
          ),
      };
    }
    if (!ownsClaim) {
      throw new UserFacingError(
        claim.operation.status === "failed"
          ? "The last publish failed. Use /week retry step:publish before trying again."
          : "Another administrator is already publishing this draft.",
      );
    }

    const channelId = config.tableChannelId ?? config.eventChannelId;
    if (!channelId) throw new UserFacingError("No table channel is configured.");
    try {
      for (const table of bundle.tables) {
        const payload = renderPublishedTable(
          this.publishedTableInput(event, bundle, table),
        );
        if (table.channelId && table.messageId) {
          await this.discord.editChannelMessage(table.channelId, table.messageId, payload);
        } else {
          const message = await this.discord.sendChannelMessage(channelId, {
            ...payload,
            nonce: discordNonce("table:" + table.tableId),
            enforce_nonce: true,
          });
          await this.repository.setPlanTableMessage(table.tableId, channelId, message.id);
        }
      }
      const published = await this.repository.publishPlan({
        planId: plan.planId,
        eventId: event.eventId,
        guildId,
      });
      if (!published) {
        const existing = await this.repository.getPlan(plan.planId);
        if (existing?.status !== "published") {
          throw new Error("The draft changed before publication completed.");
        }
      }
      bundle = (await this.repository.getPlanBundle(plan.planId)) ?? bundle;
      await this.reconcileSupersededCards(event);
      await this.repository.setEventMessages(event.eventId, {
        tableChannelId: channelId,
        tableMessageId: bundle.tables[0]?.messageId ?? undefined,
      });
      await this.repository.finishOperation(operationKey, {
        status: "succeeded",
        result: { planId: plan.planId, tableCount: bundle.tables.length },
      });
      await this.repository.appendAudit({
        guildId,
        eventId: event.eventId,
        actorUserId,
        action: "plan.published",
        entityType: "plan",
        entityId: plan.planId,
      });
    } catch (error) {
      await this.repository.finishOperation(operationKey, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    return {
      event: (await this.repository.getWeeklyEvent(event.eventId)) ?? event,
      bundle,
      links: bundle.tables
        .filter((table) => table.channelId && table.messageId)
        .map(
          (table) =>
            "https://discord.com/channels/" +
            guildId +
            "/" +
            table.channelId +
            "/" +
            table.messageId,
        ),
    };
  }

  async retryPublish(
    guildId: string,
    actorUserId?: string,
  ): Promise<{ event: WeeklyEvent; bundle: PlanBundle; links: string[] }> {
    return this.publishPlan(guildId, actorUserId, true);
  }

  async selectTable(input: {
    guildId: string;
    planId: string;
    tableId: string;
    userId: string;
    action: "join" | "leave";
  }): Promise<TableSelectionResult> {
    const plan = await this.repository.getPlan(input.planId);
    if (!plan || plan.status !== "published") {
      throw new UserFacingError("That table plan is not currently published.");
    }
    const event = await this.repository.getWeeklyEvent(plan.eventId);
    if (!event) {
      throw new UserFacingError("Table selection is closed for this week.");
    }
    if (event.guildId !== input.guildId) {
      throw new UserFacingError("That table plan belongs to a different server.");
    }
    if (
      event.status !== "published" ||
      this.now() >= event.tableSelectionClosesAt
    ) {
      throw new UserFacingError(
        "Table selection closed " + unix(event.tableSelectionClosesAt) + ".",
      );
    }

    const previous = await this.repository.getAssignment(input.planId, input.userId);
    const affectedTableIds = new Set(
      [input.tableId, previous?.tableId, previous?.desiredTableId].filter(
        (value): value is string => Boolean(value),
      ),
    );
    let message: string;
    let joinedWaitlist = false;
    try {
      if (input.action === "join") {
        const result = await this.repository.joinOrWaitlist(
          input.planId,
          input.userId,
          input.tableId,
        );
        message =
          result.outcome === "assigned"
            ? "You joined this table."
            : "This table is full; you are waitlisted at position " + result.position + ".";
        joinedWaitlist = result.outcome === "waitlisted";
      } else {
        const result = await this.repository.leaveTableAndPromote(
          input.planId,
          input.userId,
        );
        message = result.left
          ? result.promoted
            ? "You left the table and " + result.promoted.displayName + " was promoted."
            : "You left the table."
          : "You did not have an active table choice.";
      }
    } catch (error) {
      if (error instanceof TableSelectionUnavailableError) {
        throw new UserFacingError(
          "Table selection closed " + unix(event.tableSelectionClosesAt) + ".",
        );
      }
      throw error;
    }

    const bundle = await this.reconcilePublishedTableMessages(
      event,
      input.planId,
      affectedTableIds,
    );
    if (!bundle) throw new UserFacingError("The published plan could not be refreshed.");
    const table = bundle.tables.find((candidate) => candidate.tableId === input.tableId);
    if (!table) throw new UserFacingError("That table no longer exists.");
    if (joinedWaitlist) {
      const openTables = bundle.tables.filter((candidate) => {
        if (candidate.tableId === input.tableId) return false;
        const occupied = bundle.assignments.filter(
          (assignment) =>
            assignment.status === "assigned" &&
            assignment.tableId === candidate.tableId,
        ).length;
        return occupied < candidate.capacity;
      });
      if (openTables.length) {
        message +=
          " Open tables with seats: " +
          openTables.map((candidate) => safeInline(candidate.title)).join(", ") +
          ".";
      }
    }
    return {
      message,
      payload: renderPublishedTable(this.publishedTableInput(event, bundle, table)),
    };
  }

  private tableRenderFingerprint(
    bundle: PlanBundle,
    tableIds: ReadonlySet<string>,
  ): string {
    return JSON.stringify(
      bundle.assignments
        .filter(
          (assignment) =>
            (assignment.tableId !== null && tableIds.has(assignment.tableId)) ||
            (assignment.desiredTableId !== null &&
              tableIds.has(assignment.desiredTableId)),
        )
        .map((assignment) => [
          assignment.assignmentId,
          assignment.status,
          assignment.tableId,
          assignment.desiredTableId,
          assignment.waitlistPosition,
          assignment.updatedAt,
        ])
        .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
    );
  }

  /**
   * Patch only cards affected by a table choice. Re-reading after each patch
   * prevents an older concurrent snapshot from being the final visible state:
   * an invocation that observes a newer D1 fingerprint renders it again.
   */
  private async reconcilePublishedTableMessages(
    event: WeeklyEvent,
    planId: string,
    tableIds: ReadonlySet<string>,
  ): Promise<PlanBundle | null> {
    let bundle = await this.repository.getPlanBundle(planId);
    if (!bundle || tableIds.size === 0) return bundle;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const renderedFingerprint = this.tableRenderFingerprint(bundle, tableIds);
      await Promise.all(
        bundle.tables
          .filter((table) => tableIds.has(table.tableId))
          .map(async (table) => {
            if (!table.channelId || !table.messageId) return;
            await this.discord.editChannelMessage(
              table.channelId,
              table.messageId,
              renderPublishedTable(this.publishedTableInput(event, bundle!, table)),
            );
          }),
      );
      const latest = await this.repository.getPlanBundle(planId);
      if (!latest) return null;
      if (this.tableRenderFingerprint(latest, tableIds) === renderedFingerprint) {
        return latest;
      }
      bundle = latest;
    }

    // A burst may still be active. The final pass is authoritative at the
    // time of its read and limits Discord traffic to a bounded retry budget.
    await Promise.all(
      bundle.tables
        .filter((table) => tableIds.has(table.tableId))
        .map(async (table) => {
          if (!table.channelId || !table.messageId) return;
          await this.discord.editChannelMessage(
            table.channelId,
            table.messageId,
            renderPublishedTable(this.publishedTableInput(event, bundle!, table)),
          );
        }),
    );
    return bundle;
  }

  async refreshPublishedTables(
    event: WeeklyEvent,
    bundle: PlanBundle,
    closed?: boolean,
  ): Promise<void> {
    await Promise.all(
      bundle.tables.map(async (table) => {
        if (!table.channelId || !table.messageId) return;
        await this.discord.editChannelMessage(
          table.channelId,
          table.messageId,
          renderPublishedTable(this.publishedTableInput(event, bundle, table, closed)),
        );
      }),
    );
  }

  async finalizeTables(
    guildId: string,
    eventId?: string,
  ): Promise<{
    event: WeeklyEvent;
    bundle: PlanBundle;
    channelId: string;
    messageId: string;
  }> {
    const event = eventId
      ? await this.repository.getWeeklyEvent(eventId)
      : await this.repository.getCurrentWeeklyEvent(guildId);
    if (!event) throw new UserFacingError("There is no week to finalize.");
    if (event.guildId !== guildId) {
      throw new UserFacingError("That weekly event belongs to a different server.");
    }
    if (event.status !== "published" && event.status !== "archived") {
      throw new UserFacingError("Only a published week can be finalized.");
    }
    if (this.now() < event.tableSelectionClosesAt) {
      throw new UserFacingError(
        "The final roster cannot be created until table selection closes " +
          unix(event.tableSelectionClosesAt) +
          ".",
      );
    }
    const plan = await this.repository.getCurrentPlan(event.eventId);
    if (!plan || plan.status !== "published") {
      throw new UserFacingError("The week has no authoritative published plan.");
    }
    const bundle = await this.repository.getPlanBundle(plan.planId);
    if (!bundle) throw new UserFacingError("The published plan could not be loaded.");

    await this.refreshPublishedTables(event, bundle, true);
    const payload = renderFinalManifest({
      planId: plan.planId,
      generation: plan.generation,
      eventTitle: event.title,
      startsAt: event.startsAt,
      tables: bundle.tables.map((table) => ({
        id: table.tableId,
        label: table.title,
        gmName: table.gmDisplayName,
        capacity: table.capacity,
        players: bundle.assignments
          .filter(
            (assignment) =>
              assignment.status === "assigned" && assignment.tableId === table.tableId,
          )
          .map((assignment) => assignment.displayName),
        waitlist: bundle.assignments
          .filter(
            (assignment) =>
              assignment.status === "waitlisted" &&
              assignment.desiredTableId === table.tableId,
          )
          .sort(
            (left, right) =>
              (left.waitlistPosition ?? Number.MAX_SAFE_INTEGER) -
                (right.waitlistPosition ?? Number.MAX_SAFE_INTEGER) ||
              left.userId.localeCompare(right.userId),
          )
          .map((assignment) => assignment.displayName),
      })),
      unassigned: bundle.assignments
        .filter((assignment) => assignment.status === "unassigned")
        .map((assignment) => assignment.displayName),
    });

    const expectedTableStateVersion = event.tableStateVersion;
    const finalizationWasCurrent =
      Boolean(event.finalManifestChannelId && event.finalManifestMessageId) &&
      event.finalizedPlanId === plan.planId &&
      event.finalizedTableStateVersion === expectedTableStateVersion;
    let channelId = event.finalManifestChannelId;
    let messageId = event.finalManifestMessageId;
    if (channelId && messageId) {
      await this.discord.editChannelMessage(channelId, messageId, payload);
    } else {
      const config = await this.requireConfig(guildId);
      channelId = config.tableChannelId ?? config.eventChannelId;
      if (!channelId) throw new UserFacingError("No table channel is configured.");
      const message = await this.discord.sendChannelMessage(channelId, {
        ...payload,
        nonce: discordNonce(
          "manifest:" + event.eventId + ":" + plan.planId + ":" + expectedTableStateVersion,
        ),
        enforce_nonce: true,
      });
      messageId = message.id;
    }
    if (!channelId || !messageId) {
      throw new Error("The final manifest location could not be resolved.");
    }
    const finalizedAt = this.now();
    const stored = await this.repository.setFinalManifest(
      event.eventId,
      channelId,
      messageId,
      plan.planId,
      expectedTableStateVersion,
      finalizedAt,
    );
    if (!stored) {
      throw new Error(
        "The published plan or table roster changed while the final manifest was being written.",
      );
    }
    if (!finalizationWasCurrent) {
      await this.repository.appendAudit({
        guildId,
        eventId: event.eventId,
        action: "tables.finalized",
        entityType: "plan",
        entityId: plan.planId,
        details: {
          channelId,
          messageId,
          generation: plan.generation,
          tableStateVersion: expectedTableStateVersion,
          finalizedAt,
        },
      });
    }
    const latest = (await this.repository.getWeeklyEvent(event.eventId)) ?? event;
    return { event: latest, bundle, channelId, messageId };
  }

  async archiveWeek(
    guildId: string,
    actorUserId?: string,
    eventId?: string,
  ): Promise<WeeklyEvent> {
    const event = eventId
      ? await this.repository.getWeeklyEvent(eventId)
      : await this.repository.getCurrentWeeklyEvent(guildId);
    if (!event) throw new UserFacingError("There is no active week to archive.");
    if (event.guildId !== guildId) {
      throw new UserFacingError("That weekly event belongs to a different server.");
    }
    if (
      event.status !== "planned" &&
      event.status !== "published" &&
      !(eventId && event.status === "archived")
    ) {
      throw new UserFacingError(
        "Only planned or published weeks can be archived. Use /week cancel for an unfinished week.",
      );
    }
    const planBeforeArchive = await this.repository.getCurrentPlan(event.eventId);
    const hasPublishedPlan =
      (event.status === "published" || event.status === "archived") &&
      planBeforeArchive?.status === "published";
    if (hasPublishedPlan) await this.finalizeTables(guildId, event.eventId);

    const projectedArchived: WeeklyEvent = {
      ...event,
      status: "archived",
      archivedAt: event.archivedAt ?? this.now(),
      updatedAt: this.now(),
    };
    if (projectedArchived.signupChannelId && projectedArchived.signupMessageId) {
      await this.discord.editChannelMessage(
        projectedArchived.signupChannelId,
        projectedArchived.signupMessageId,
        await this.signupPayload(projectedArchived),
      );
    }
    if (planBeforeArchive && !hasPublishedPlan) {
      const bundle = await this.repository.getPlanBundle(planBeforeArchive.planId);
      if (bundle) await this.refreshPublishedTables(projectedArchived, bundle, true);
    }

    if (event.status !== "archived") {
      const changed = await this.repository.transitionEventStatus(
        event.eventId,
        event.status,
        "archived",
      );
      if (!changed) throw new UserFacingError("The week changed; run /week status and retry.");
    }
    const archived = (await this.repository.getWeeklyEvent(event.eventId)) ?? event;
    await this.repository.appendAudit({
      guildId,
      eventId: event.eventId,
      actorUserId,
      action: "week.archived",
      entityType: "weekly_event",
      entityId: event.eventId,
    });
    return archived;
  }

  async cancelWeek(
    guildId: string,
    actorUserId: string | undefined,
    rawReason: string,
  ): Promise<WeeklyEvent> {
    const reason = rawReason.replace(/[\r\n]+/g, " ").trim();
    if (reason.length < 3 || reason.length > 500) {
      throw new UserFacingError("reason must contain 3 through 500 characters.");
    }
    const event = await this.repository.getCurrentWeeklyEvent(guildId);
    if (!event) throw new UserFacingError("There is no active week to cancel.");
    if (event.status === "archived" || event.status === "cancelled") {
      throw new UserFacingError("That week is already terminal.");
    }
    const changed = await this.repository.transitionEventStatus(
      event.eventId,
      event.status,
      "cancelled",
    );
    if (!changed) throw new UserFacingError("The week changed; run /week status and retry.");
    const cancelled = (await this.repository.getWeeklyEvent(event.eventId)) ?? event;
    if (cancelled.signupChannelId && cancelled.signupMessageId) {
      await this.discord.editChannelMessage(
        cancelled.signupChannelId,
        cancelled.signupMessageId,
        await this.signupPayload(cancelled),
      );
    }
    const plan = await this.repository.getCurrentPlan(event.eventId);
    if (plan) {
      const bundle = await this.repository.getPlanBundle(plan.planId);
      if (bundle) await this.refreshPublishedTables(cancelled, bundle, true);
    }
    await this.repository.appendAudit({
      guildId,
      eventId: event.eventId,
      actorUserId,
      action: "week.cancelled",
      entityType: "weekly_event",
      entityId: event.eventId,
      details: { reason },
    });
    return cancelled;
  }

  async exportSnapshot(
    guildId: string,
    eventId?: string,
  ): Promise<{
    event: WeeklyEvent;
    signups: Signup[];
    planBundle: PlanBundle | null;
  }> {
    const snapshot = await this.repository.getWeeklyExportSnapshot(guildId, eventId);
    if (!snapshot) {
      throw new UserFacingError("There is no weekly event to export for this server.");
    }
    return snapshot;
  }

  async planBundleForCurrent(guildId: string): Promise<{
    event: WeeklyEvent;
    bundle: PlanBundle;
  }> {
    const event = await this.repository.getCurrentWeeklyEvent(guildId);
    if (!event) throw new UserFacingError("There is no active week.");
    const plan =
      (await this.repository.getLatestDraftPlan(event.eventId)) ??
      (await this.repository.getCurrentPlan(event.eventId));
    if (!plan) throw new UserFacingError("There is no table plan yet.");
    const bundle = await this.repository.getPlanBundle(plan.planId);
    if (!bundle) throw new UserFacingError("The table plan could not be loaded.");
    return { event, bundle };
  }

  selectedGmIds(bundle: PlanBundle): string[] {
    return bundle.tables.map((table) => table.gmUserId);
  }

  async activeRoleHolderIds(
    guildId: string,
    roleId: string,
    desiredUserIds: readonly string[],
    leasedUserIds: readonly string[],
  ): Promise<string[]> {
    const candidates = [...new Set([...desiredUserIds, ...leasedUserIds])];
    const results = await Promise.all(
      candidates.map(async (userId) => {
        try {
          const member = await this.discord.getGuildMember(guildId, userId);
          return member.roles.includes(roleId) ? userId : null;
        } catch {
          return null;
        }
      }),
    );
    return results.filter((userId): userId is string => userId !== null);
  }
}
