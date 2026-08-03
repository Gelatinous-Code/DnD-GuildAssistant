import {
  DiscordRestClient,
  discordNonce,
  renderFinalManifest,
  renderPlanPreview,
  renderPublishedTable,
  renderSignupMessage,
  safeAllowedMentions,
  type DiscordMessagePayload,
  type PlanPreviewInput,
  type PublishedTableInput,
} from "./discord-api";
import {
  planTables,
  rankGmCandidates,
  type GmCandidate,
} from "./domain/table-planner";
import {
  GAME_TIERS,
  gameTierLabel,
  type GameTier,
} from "./domain/game-tier";
import {
  cadenceFromConfig,
  NEW_DAWN_CADENCE,
  cadenceWindowsForStart,
  nextWeeklyOccurrence,
} from "./schedule";
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

const ALGORITHM_VERSION = "tiered-balanced-rotation-v1";
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

function gmSignupAnnouncement(
  payload: DiscordMessagePayload,
  roleId: string | null,
): DiscordMessagePayload {
  if (!roleId) return payload;
  return {
    ...payload,
    content: [
      `<@&${roleId}> **GM signup is now open.**`,
      payload.content,
    ].filter((line): line is string => Boolean(line)).join("\n"),
    allowed_mentions: safeAllowedMentions([roleId]),
  };
}

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

  private cadenceWindows(config: GuildConfig, startsAt: number): {
    gmSignupOpensAt: number;
    playerSignupOpensAt: number;
    tablesPublishAt: number;
    openSeatingAt: number;
  } {
    const cadence = cadenceFromConfig(config);
    if (!cadence) {
      const gmSignupOpensAt = startsAt - config.signupOpenLeadDays * 86_400_000;
      const tablesPublishAt = startsAt - config.signupLockLeadHours * 3_600_000;
      return {
        gmSignupOpensAt,
        playerSignupOpensAt: gmSignupOpensAt,
        tablesPublishAt,
        openSeatingAt: tablesPublishAt,
      };
    }
    const windows = cadenceWindowsForStart(
      cadence,
      new Date(startsAt).toISOString(),
    );
    return {
      gmSignupOpensAt: Date.parse(windows.gmSignupOpensAt),
      playerSignupOpensAt: Date.parse(windows.playerSignupOpensAt),
      tablesPublishAt: Date.parse(windows.tablesPublishAt),
      openSeatingAt: Date.parse(windows.openSeatingAt),
    };
  }

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
      "**Player signup and tables:** " + (config.eventChannelId ? "<#" + config.eventChannelId + ">" : "missing"),
      "**GM signup channel:** " + (config.gmSignupChannelId ? "<#" + config.gmSignupChannelId + ">" : "same as player signup"),
      "**GM signup notification role:** " +
        (config.gmNotificationRoleId ? "<@&" + config.gmNotificationRoleId + ">" : "not configured"),
      "**Player reminder role:** " +
        (config.reminderRoleId ? "<@&" + config.reminderRoleId + ">" : "not configured"),
      "**Time zone:** " + config.timezone,
      "**GM signup:** " +
        (WEEKDAY_NAMES[config.gmSignupDay ?? NEW_DAWN_CADENCE.gmSignup.weekday]) +
        " at " + (config.gmSignupTime ?? NEW_DAWN_CADENCE.gmSignup.time),
      "**Player interest:** " +
        (WEEKDAY_NAMES[config.playerSignupDay ?? NEW_DAWN_CADENCE.playerSignup.weekday]) +
        " at " + (config.playerSignupTime ?? NEW_DAWN_CADENCE.playerSignup.time),
      "**Tables publish:** " +
        (WEEKDAY_NAMES[config.tablePublishDay ?? NEW_DAWN_CADENCE.tablePublish.weekday]) +
        " at " + (config.tablePublishTime ?? NEW_DAWN_CADENCE.tablePublish.time),
      "**Open seating:** " +
        (WEEKDAY_NAMES[config.openSeatingDay ?? NEW_DAWN_CADENCE.openSeating.weekday]) +
        " at " + (config.openSeatingTime ?? NEW_DAWN_CADENCE.openSeating.time),
      "**Games:** " +
        (WEEKDAY_NAMES[config.weeklyDay] ?? "weekday " + config.weeklyDay) +
        " at " + config.weeklyTime + " for " + config.eventDurationMinutes + " minutes",
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
        (config.autoPublishEnabled ? "on" : "off"),
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
      "**Signups:** " +
        counts.gms +
        " tiered GM" +
        (counts.gms === 1 ? "" : "s") +
        (counts.gmBackups ? " + " + counts.gmBackups + " backups" : "") +
        " / " +
        counts.players +
        " players",
      "**Plan:** " +
        (currentPlan
          ? currentPlan.status + " revision " + currentPlan.generation +
            " (" + currentPlan.selectedGmCount + " tables)"
          : "not generated"),
      "**GM signup opens:** " + unix(event.signupOpensAt),
      "**Player signup opens:** " + unix(event.playerSignupOpensAt ?? event.signupOpensAt),
      "**Tables publish:** " + unix(event.signupLocksAt),
      "**Open seating:** " + unix(event.openSeatingAt ?? event.signupLocksAt),
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
    const windows = this.cadenceWindows(config, startsAt);

    const event = await this.repository.createWeeklyEvent({
      eventId: this.id(),
      guildId: input.guildId,
      title: input.title?.trim() || "Weekly Games",
      startsAt,
      endsAt: startsAt + config.eventDurationMinutes * 60_000,
      signupOpensAt: windows.gmSignupOpensAt,
      playerSignupOpensAt: windows.playerSignupOpensAt,
      signupLocksAt: windows.tablesPublishAt,
      openSeatingAt: windows.openSeatingAt,
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
  async openPlayerSignups(event: WeeklyEvent): Promise<void> {
    if (event.status !== "open") return;
    const config = await this.requireConfig(event.guildId);
    const latest = (await this.repository.getWeeklyEvent(event.eventId)) ?? event;
    await this.ensureSignupPost(latest, config);
  }

  async openSeating(event: WeeklyEvent): Promise<void> {
    const latest = (await this.repository.getWeeklyEvent(event.eventId)) ?? event;
    if (latest.status !== "published") return;
    const plan = await this.repository.getCurrentPlan(latest.eventId);
    if (!plan || plan.status !== "published") return;
    const bundle = await this.repository.getPlanBundle(plan.planId);
    if (!bundle) throw new Error("The published plan could not be loaded for open seating");

    await this.refreshPublishedTables(latest, bundle);
    const config = await this.requireConfig(latest.guildId);
    const channelId =
      latest.tableChannelId ??
      config.tableChannelId ??
      config.eventChannelId;
    if (!channelId) throw new Error("No channel is available for open seating");
    await this.discord.sendChannelMessage(channelId, {
      content:
        "🔓 **Open seating is now active.**\n" +
        "Signup-order reservations have ended. Any active player may claim an available table seat first-come, first-served until games begin " +
        unix(latest.tableSelectionClosesAt) +
        ". Players who did not choose earlier are not penalized.",
      nonce: discordNonce("open-seating:" + latest.eventId),
      enforce_nonce: true,
      allowed_mentions: safeAllowedMentions(),
    });
    await this.repository.appendAudit({
      guildId: latest.guildId,
      eventId: latest.eventId,
      action: "week.open-seating",
      entityType: "weekly_event",
      entityId: latest.eventId,
      details: {
        openSeatingAt: latest.openSeatingAt ?? latest.signupLocksAt,
      },
    });
  }


  async signupPayload(
    event: WeeklyEvent,
    audience: "combined" | "gm" | "player" = "combined",
  ): Promise<DiscordMessagePayload> {
    const [gms, players] = await Promise.all([
      this.repository.listActiveSignups(event.eventId, "gm"),
      this.repository.listActiveSignups(event.eventId, "player"),
    ]);
    const now = this.now();
    const playerSignupOpensAt = event.playerSignupOpensAt ?? event.signupOpensAt;
    const gmSignupEnabled = event.status === "open" && audience !== "player";
    const playerSignupEnabled =
      event.status === "open" && audience !== "gm" && now >= playerSignupOpensAt;
    const withdrawEnabled =
      (event.status === "open" || event.status === "published") &&
      now < event.tableSelectionClosesAt;
    const description =
      audience === "gm"
        ? gmSignupEnabled
          ? "Choose the tier you plan to run, or volunteer as a backup GM. This post is routed to the guild's GM signup channel."
          : "GM signup is closed. Withdraw only if you are dropping from this week's games."
        : audience === "player"
          ? playerSignupEnabled
            ? "Choose your character's tier to play. Signup order reserves capacity within that tier until open seating."
            : "Player signup is not open yet."
          : playerSignupEnabled
            ? "Choose a tier to run or play. Player signup order reserves capacity within that tier until open seating."
            : gmSignupEnabled
              ? "GM signup is open. Player interest opens at the time shown below."
              : "Tables are published. Withdraw only if you are dropping from this week's games.";
    const primaryGms = gms.filter((signup) => signup.gmCommitment !== "backup");
    const backupGms = gms.filter((signup) => signup.gmCommitment === "backup");
    const visibleSignups =
      audience === "gm"
        ? primaryGms
        : audience === "player"
          ? players
          : [...primaryGms, ...players];
    const unclassified = visibleSignups.filter((signup) => signup.gameTier === null);
    return renderSignupMessage({
      eventId: event.eventId,
      title: event.title,
      startsAt: event.startsAt,
      playerSignupOpensAt,
      signupDeadline: event.signupLocksAt,
      description,
      status:
        event.status === "open"
          ? "open"
          : event.status === "archived" || event.status === "cancelled"
            ? "archived"
            : "locked",
      audience,
      gmSignupEnabled,
      playerSignupEnabled,
      withdrawEnabled,
      tierSignups: GAME_TIERS.map((gameTier) => ({
        gameTier,
        gmNames: primaryGms
          .filter((signup) => signup.gameTier === gameTier)
          .map(userLabel),
        playerNames: players
          .filter((signup) => signup.gameTier === gameTier)
          .map(userLabel),
      })),
      backupGmNames: backupGms.map(userLabel),
      unclassifiedNames: unclassified.map(userLabel),
    });
  }

  private async ensureSignupPost(
    event: WeeklyEvent,
    config: GuildConfig,
  ): Promise<void> {
    const playerChannelId = config.eventChannelId;
    if (!playerChannelId) throw new UserFacingError("No player signup channel is configured.");

    const gmChannelId = config.gmSignupChannelId;
    if (!gmChannelId || gmChannelId === playerChannelId) {
      const payload = await this.signupPayload(event, "combined");
      if (event.signupChannelId && event.signupMessageId) {
        await this.discord.editChannelMessage(
          event.signupChannelId,
          event.signupMessageId,
          payload,
        );
        return;
      }
      const message = await this.discord.sendChannelMessage(playerChannelId, {
        ...gmSignupAnnouncement(payload, config.gmNotificationRoleId),
        nonce: discordNonce("signup:" + event.eventId),
        enforce_nonce: true,
      });
      await this.repository.setEventMessages(event.eventId, {
        signupChannelId: playerChannelId,
        signupMessageId: message.id,
      });
      return;
    }

    const gmPayload = await this.signupPayload(event, "gm");
    if (event.gmSignupChannelId && event.gmSignupMessageId) {
      await this.discord.editChannelMessage(
        event.gmSignupChannelId,
        event.gmSignupMessageId,
        gmPayload,
      );
    } else {
      const message = await this.discord.sendChannelMessage(gmChannelId, {
        ...gmSignupAnnouncement(gmPayload, config.gmNotificationRoleId),
        nonce: discordNonce("signup-gm:" + event.eventId),
        enforce_nonce: true,
      });
      await this.repository.setEventMessages(event.eventId, {
        gmSignupChannelId: gmChannelId,
        gmSignupMessageId: message.id,
      });
    }

    const playerSignupOpensAt = event.playerSignupOpensAt ?? event.signupOpensAt;
    if (this.now() < playerSignupOpensAt && !event.signupMessageId) return;

    const playerPayload = await this.signupPayload(event, "player");
    if (event.signupChannelId && event.signupMessageId) {
      await this.discord.editChannelMessage(
        event.signupChannelId,
        event.signupMessageId,
        playerPayload,
      );
      return;
    }
    const message = await this.discord.sendChannelMessage(playerChannelId, {
      ...playerPayload,
      nonce: discordNonce("signup-player:" + event.eventId),
      enforce_nonce: true,
    });
    await this.repository.setEventMessages(event.eventId, {
      signupChannelId: playerChannelId,
      signupMessageId: message.id,
    });
  }

  async refreshSignupPosts(event: WeeklyEvent): Promise<void> {
    const split = Boolean(event.gmSignupChannelId && event.gmSignupMessageId);
    const edits: Promise<unknown>[] = [];
    if (event.gmSignupChannelId && event.gmSignupMessageId) {
      edits.push(
        this.discord.editChannelMessage(
          event.gmSignupChannelId,
          event.gmSignupMessageId,
          await this.signupPayload(event, "gm"),
        ),
      );
    }
    if (event.signupChannelId && event.signupMessageId) {
      edits.push(
        this.discord.editChannelMessage(
          event.signupChannelId,
          event.signupMessageId,
          await this.signupPayload(event, split ? "player" : "combined"),
        ),
      );
    }
    await Promise.all(edits);
  }

  async changeSignup(input: {
    guildId: string;
    eventId: string;
    userId: string;
    displayName: string;
    action: SignupKind | "backup" | "withdraw";
    gameTier?: GameTier;
  }): Promise<{ event: WeeklyEvent; payload: DiscordMessagePayload; message: string }> {
    const event = await this.repository.getWeeklyEvent(input.eventId);
    if (!event) throw new UserFacingError("That weekly signup no longer exists.");
    if (event.guildId !== input.guildId) {
      throw new UserFacingError("That weekly signup belongs to a different server.");
    }
    const now = this.now();
    let message: string;

    if (input.action === "withdraw") {
      if (
        !["open", "published"].includes(event.status) ||
        now >= event.tableSelectionClosesAt
      ) {
        throw new UserFacingError(
          "Self-service withdrawal is closed. Ask an organizer for a correction.",
        );
      }
      const existing = await this.repository.getSignup(event.eventId, input.userId);
      if (event.status === "published" && existing?.signupKind === "gm") {
        throw new UserFacingError(
          "A published GM change affects an entire table. Please contact an organizer.",
        );
      }
      const changed = await this.repository.withdrawSignup(input.eventId, input.userId);
      message = changed ? "You dropped from this week's games." : "You were not actively signed up.";
      if (changed && event.status === "published") {
        const plan = await this.repository.getCurrentPlan(event.eventId);
        if (plan?.status === "published") {
          const result = await this.repository.withdrawAssignmentAndPromote(
            plan.planId,
            input.userId,
            now < (event.openSeatingAt ?? event.signupLocksAt),
          );
          const bundle = await this.repository.getPlanBundle(plan.planId);
          if (bundle) await this.refreshPublishedTables(event, bundle);
          if (result.rosterPromoted) {
            message += " The first waitlisted player now has the reserved opening and will be notified.";
          }
        }
      }
    } else {
      if (
        event.status !== "open" &&
        !(event.status === "published" && input.action === "player" &&
          now < event.tableSelectionClosesAt)
      ) {
        throw new UserFacingError(
          event.status === "published" &&
            (input.action === "gm" || input.action === "backup")
            ? "GM signup closed when tables were published. Ask an organizer about a late correction."
            : "New signups closed for this week.",
        );
      }
      const playerSignupOpensAt = event.playerSignupOpensAt ?? event.signupOpensAt;
      if (input.action === "player" && now < playerSignupOpensAt) {
        throw new UserFacingError(
          "Player signup opens " + unix(playerSignupOpensAt) + ". GM signup is open now.",
        );
      }
      // Discord and slash-command handlers require an explicit tier. The
      // fallback keeps trusted internal callers and pre-tier test fixtures
      // deterministic without accepting an old public button.
      const selectedTier = input.gameTier ?? 1;
      const previousSignup = await this.repository.getSignup(
        event.eventId,
        input.userId,
      );
      const publishedTierChange =
        event.status === "published" &&
        input.action === "player" &&
        previousSignup?.status === "active" &&
        previousSignup.signupKind === "player" &&
        previousSignup.gameTier !== selectedTier;
      const signupKind: SignupKind =
        input.action === "backup" ? "gm" : input.action;
      await this.repository.saveSignup({
        eventId: input.eventId,
        userId: input.userId,
        displayName: input.displayName,
        signupKind,
        gameTier: input.action === "backup" ? null : selectedTier,
        gmCommitment:
          input.action === "gm"
            ? "primary"
            : input.action === "backup"
              ? "backup"
              : null,
        source: "native",
      });
      if (input.action === "gm") {
        message = `Signed up to run ${gameTierLabel(selectedTier)}.`;
      } else if (input.action === "backup") {
        message = "Signed up as a backup GM. You do not count as a planned table unless an organizer moves you into a tier.";
      } else if (event.status === "published") {
        const plan = await this.repository.getCurrentPlan(event.eventId);
        if (!plan || plan.status !== "published") {
          throw new UserFacingError(
            "The published table plan is not available. Ask an organizer for help.",
          );
        }
        const currentAssignment = await this.repository.getAssignment(
          plan.planId,
          input.userId,
        );
        const assignmentTierChanged =
          currentAssignment?.status !== "withdrawn" &&
          currentAssignment?.gameTier !== undefined &&
          currentAssignment.gameTier !== selectedTier;
        if (publishedTierChange || assignmentTierChanged) {
          await this.repository.withdrawAssignmentAndPromote(
            plan.planId,
            input.userId,
            now < (event.openSeatingAt ?? event.signupLocksAt),
          );
        }
        const assignment = await this.repository.ensureUnassignedAssignment({
          assignmentId: this.id(),
          planId: plan.planId,
          userId: input.userId,
          displayName: input.displayName,
        });
        if (publishedTierChange || assignmentTierChanged) {
          const bundle = await this.repository.getPlanBundle(plan.planId);
          if (bundle) await this.refreshPublishedTables(event, bundle);
        }
        const openSeatingAt = event.openSeatingAt ?? event.signupLocksAt;
        message = now >= openSeatingAt
            ? `Signed up to play ${gameTierLabel(selectedTier)}. Open seating is active; claim any available table in that tier before game time.`
          : assignment.rosterStatus === "reserved"
            ? `Signed up to play ${gameTierLabel(selectedTier)}. An open weekly reservation is yours; choose a table in that tier with space.`
            : `Signed up to play ${gameTierLabel(selectedTier)}. That tier's planned seats are reserved, so you are on its waitlist. You will be privately notified if a reservation opens.`;
      } else {
        message = `Signed up to play ${gameTierLabel(selectedTier)}.`;
      }
    }
    await this.repository.appendAudit({
      guildId: event.guildId,
      eventId: event.eventId,
      actorUserId: input.userId,
      action: "signup." + input.action,
      entityType: "signup",
      entityId: input.userId,
      details: {
        gameTier:
          input.action === "withdraw" || input.action === "backup"
            ? null
            : input.gameTier ?? 1,
        gmCommitment:
          input.action === "gm"
            ? "primary"
            : input.action === "backup"
              ? "backup"
              : null,
      },
    });
    const latest = (await this.repository.getWeeklyEvent(event.eventId)) ?? event;
    return { event: latest, payload: await this.signupPayload(latest), message };
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
    await this.refreshSignupPosts(locked);
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
    action: SignupKind | "backup" | "withdraw";
    gameTier?: GameTier;
  }): Promise<{ event: WeeklyEvent; warning?: string; requiresReplan: boolean }> {
    const event = await this.repository.getCurrentWeeklyEvent(input.guildId);
    if (!event) throw new UserFacingError("There is no active week to correct.");
    if (event.status === "archived" || event.status === "cancelled") {
      throw new UserFacingError("Archived or cancelled weeks cannot be corrected.");
    }
    const previousSignup = await this.repository.getSignup(event.eventId, input.userId);
    const selectedTier = input.gameTier ?? previousSignup?.gameTier ?? 1;
    const plan = ["planned", "published"].includes(event.status)
      ? await this.repository.getCurrentPlan(event.eventId)
      : null;
    const previousAssignment =
      plan?.status === "published"
        ? await this.repository.getAssignment(plan.planId, input.userId)
        : null;
    const playerTierChanged =
      input.action === "player" &&
      (
        (
          previousSignup?.status === "active" &&
          previousSignup.signupKind === "player" &&
          previousSignup.gameTier !== selectedTier
        ) ||
        (
          previousAssignment?.status !== "withdrawn" &&
          previousAssignment?.gameTier !== undefined &&
          previousAssignment.gameTier !== selectedTier
        )
      );
    const affectsGm =
      input.action === "gm" ||
      input.action === "backup" ||
      previousSignup?.signupKind === "gm";
    const affectsDraftPlayers =
      event.status === "planned" &&
      (input.action === "player" || previousSignup?.signupKind === "player");
    let assignmentMayHaveChanged = false;
    if (input.action === "withdraw") {
      await this.repository.withdrawSignup(event.eventId, input.userId);
      if (plan) {
        await this.repository.withdrawAssignmentAndPromote(
          plan.planId,
          input.userId,
          this.now() < (event.openSeatingAt ?? event.signupLocksAt),
        );
        assignmentMayHaveChanged = true;
      }
    } else {
      await this.repository.saveSignup({
        eventId: event.eventId,
        userId: input.userId,
        displayName: input.displayName,
        signupKind: input.action === "backup" ? "gm" : input.action,
        gameTier: input.action === "backup" ? null : selectedTier,
        gmCommitment:
          input.action === "gm"
            ? "primary"
            : input.action === "backup"
              ? "backup"
              : null,
        source: "admin",
      });
      if (plan?.status === "published" && input.action === "player") {
        if (playerTierChanged) {
          await this.repository.withdrawAssignmentAndPromote(
            plan.planId,
            input.userId,
            this.now() < (event.openSeatingAt ?? event.signupLocksAt),
          );
          assignmentMayHaveChanged = true;
        }
        await this.repository.ensureUnassignedAssignment({
          assignmentId: this.id(),
          planId: plan.planId,
          userId: input.userId,
          displayName: input.displayName,
        });
      } else if (
        plan?.status === "published" &&
        (input.action === "gm" || input.action === "backup")
      ) {
        // A seated player who becomes a GM must immediately release their seat;
        // the normal promotion path keeps the visible published plan consistent.
        await this.repository.withdrawAssignmentAndPromote(
          plan.planId,
          input.userId,
          this.now() < (event.openSeatingAt ?? event.signupLocksAt),
        );
        assignmentMayHaveChanged = true;
      }
    }
    if (plan?.status === "published" && assignmentMayHaveChanged) {
      const bundle = await this.repository.getPlanBundle(plan.planId);
      if (bundle) await this.refreshPublishedTables(event, bundle);
    }
    const latest = (await this.repository.getWeeklyEvent(event.eventId)) ?? event;
    await this.refreshSignupPosts(latest);
    await this.repository.appendAudit({
      guildId: input.guildId,
      eventId: event.eventId,
      actorUserId: input.actorUserId,
      action: "signup.admin-correction",
      entityType: "signup",
      entityId: input.userId,
      details: { action: input.action, gameTier: input.gameTier ?? null },
    });
    const requiresReplan =
      ["planned", "published"].includes(event.status) &&
      (affectsGm || affectsDraftPlayers || playerTierChanged);
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
    roster: ReadonlyMap<
      string,
      { rosterStatus: "reserved" | "bench"; rosterRank: number }
    >,
  ): SaveDraftPlanInput["assignments"] {
    const next = new Map<string, SaveDraftPlanInput["assignments"][number]>(
      players.map((player) => {
        const rosterEntry = roster.get(player.userId);
        if (!rosterEntry) throw new Error("Player roster rank was not generated");
        return [
          player.userId,
          {
            assignmentId: this.id(),
            tableId: null,
            userId: player.userId,
            displayName: player.displayName || player.userId,
            gameTier: player.gameTier!,
            status: "unassigned" as const,
            waitlistPosition: null,
            ...rosterEntry,
          },
        ];
      }),
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
      if (roster.get(assignment.userId)?.rosterStatus === "bench") continue;
      if (assignment.status !== "assigned" && assignment.status !== "waitlisted") continue;
      const desiredTableId = assignment.desiredTableId ?? assignment.tableId;
      const previousTable = desiredTableId
        ? previousTableById.get(desiredTableId)
        : undefined;
      const nextTable = previousTable
        ? nextTableByGm.get(previousTable.gmUserId)
        : undefined;
      const player = playerById.get(assignment.userId)!;
      if (!nextTable || nextTable.gameTier !== player.gameTier) continue;
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
        const base = next.get(player.userId)!;
        if (index < table.capacity) {
          next.set(player.userId, {
            ...base,
            tableId: table.tableId,
            desiredTableId: table.tableId,
            status: "assigned",
            waitlistPosition: null,
            assignedAt:
              previousAssignment.status === "assigned"
                ? (previousAssignment.assignedAt ?? this.now())
                : this.now(),
          });
        } else {
          next.set(player.userId, {
            ...base,
            tableId: null,
            desiredTableId: table.tableId,

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
    const [players, allGms, stats] = await Promise.all([
      this.repository.listActiveSignups(event.eventId, "player"),
      this.repository.listActiveSignups(event.eventId, "gm"),
      this.repository.listGmSelectionStats(guildId),
    ]);
    const gms = allGms.filter((signup) => signup.gmCommitment !== "backup");
    const unclassified = [...players, ...gms].filter(
      (signup) => signup.gameTier === null,
    );
    if (unclassified.length) {
      throw new UserFacingError(
        "A table draft cannot mix unclassified signups. Ask these members to use a tier button, or correct them with /week signup: " +
          unclassified
            .slice(0, 8)
            .map((signup) => safeInline(userLabel(signup)))
            .join(", ") +
          (unclassified.length > 8 ? ` and ${unclassified.length - 8} more` : "") +
          ".",
      );
    }
    const statsByGm = new Map(stats.map((stat) => [stat.gmUserId, stat]));
    const tierPlans = GAME_TIERS.map((gameTier) => {
      const tierPlayers = players.filter((player) => player.gameTier === gameTier);
      const tierGms = gms.filter((gm) => gm.gameTier === gameTier);
      const gmCandidates: GmCandidate[] = tierGms.map((gm) => {
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
        players: tierPlayers.map((player) => ({
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
      return { gameTier, players: tierPlayers, gmCandidates, planned };
    });
    const selectedTableCount = tierPlans.reduce(
      (total, tier) => total + tier.planned.tables.length,
      0,
    );
    if (selectedTableCount === 0) {
      const reason =
        players.length === 0
          ? "No players are signed up."
          : gms.length === 0
            ? "No GMs are signed up."
            : "The current table policy cannot produce a table.";
      throw new UserFacingError("No table draft was created. " + reason);
    }

    const planId = this.id();
    const generation = await this.repository.getNextPlanGeneration(event.eventId);
    let tableNumber = 0;
    const tables: SaveDraftPlanInput["tables"] = tierPlans.flatMap((tier) =>
      tier.planned.tables.map((table) => {
        tableNumber += 1;
        return {
          tableId: this.id(),
          tableNumber,
          gameTier: tier.gameTier,
          title: `Table ${tableNumber} · T${tier.gameTier}`,
          capacity: table.capacity,
          gmUserId: table.gm.userId,
          gmDisplayName: table.gm.displayName ?? table.gm.userId,
        };
      }),
    );
    const roster = new Map<
      string,
      { rosterStatus: "reserved" | "bench"; rosterRank: number }
    >();
    for (const tier of tierPlans) {
      const rankedPlayers = [...tier.players].sort(
        (left, right) =>
          left.signedUpAt - right.signedUpAt ||
          left.userId.localeCompare(right.userId),
      );
      const benchUserIds = new Set(
        tier.planned.waitlist.map((player) => player.userId),
      );
      for (const [index, player] of rankedPlayers.entries()) {
        roster.set(player.userId, {
          rosterStatus: benchUserIds.has(player.userId) ? "bench" : "reserved",
          rosterRank: index + 1,
        });
      }
    }
    // Revisions preserve table choices only for players who still hold a reserved seat.
    const assignments = this.carryForwardAssignments(players, tables, previousBundle, roster);

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
        selectedGmCount: selectedTableCount,
        waitlistCount: tierPlans.reduce(
          (total, tier) => total + tier.planned.waitlist.length,
          0,
        ),
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
        tiers: tierPlans.map((tier) => ({
          gameTier: tier.gameTier,
          playerCount: tier.players.length,
          selectedGms: tier.planned.selectedGms.map((gm) => gm.userId),
          unselectedGms: tier.planned.unselectedGms.map((gm) => gm.userId),
          capacities: tier.planned.tables.map((table) => table.capacity),
          waitlistCount: tier.planned.waitlist.length,
        })),
      },
    });
    const explanations = tierPlans.flatMap((tier) =>
      tier.players.length || tier.gmCandidates.length
        ? [
            `${gameTierLabel(tier.gameTier)}: ${tier.planned.rationale}`,
            ...this.gmDecisionExplanations(
              tier.gmCandidates,
              new Set(tier.planned.selectedGms.map((gm) => gm.userId)),
              tier.players.length,
              config.tableMinSize,
            ).map((explanation) => `T${tier.gameTier}: ${explanation}`),
          ]
        : [],
    );
    return {
      event,
      bundle,
      preview: this.planPreview(event, bundle, explanations),
    };
  }

  planPreview(
    event: WeeklyEvent,
    bundle: PlanBundle,
    explanations: readonly string[] = [],
  ): DiscordMessagePayload {
    const unassigned = bundle.assignments.filter(
      (item) => item.status === "unassigned" && item.rosterStatus !== "bench",
    );
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
    if (unassigned.length) warnings.push(unassigned.length + " reserved players still need to choose a table");
    if (bundle.plan.waitlistCount) {
      const tierWaitlists = GAME_TIERS
        .map((gameTier) => ({
          gameTier,
          count: bundle.assignments.filter(
            (assignment) =>
              assignment.gameTier === gameTier &&
              assignment.rosterStatus === "bench" &&
              assignment.status !== "withdrawn",
          ).length,
        }))
        .filter((tier) => tier.count > 0)
        .map((tier) => `T${tier.gameTier}: ${tier.count}`)
        .join(", ");
      warnings.push(
        bundle.plan.waitlistCount +
          " players are on tier waitlists in signup order (" +
          tierWaitlists +
          "). A drop before open seating promotes the first person in that tier.",
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
        gameTier: table.gameTier,
        capacity: table.capacity,
        players: bundle.assignments
          .filter((assignment) => assignment.tableId === table.tableId)
          .map((assignment) => assignment.displayName),
      })),
      waitlist: bundle.assignments
        .filter((assignment) => assignment.rosterStatus === "bench")
        .map((assignment) => `${assignment.displayName} (T${assignment.gameTier})`),
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
    const draftBundle = await this.repository.getPlanBundle(plan.planId);
    const targetTable = draftBundle?.tables.find(
      (table) => table.tableNumber === input.tableNumber,
    );
    if (!targetTable) {
      throw new UserFacingError("That draft table does not exist.");
    }
    let gmDisplayName: string | undefined;
    if (input.gmUserId) {
      const signup = await this.repository.getSignup(event.eventId, input.gmUserId);
      if (
        !signup ||
        signup.status !== "active" ||
        signup.signupKind !== "gm" ||
        signup.gmCommitment === "backup"
      ) {
        throw new UserFacingError("The selected member is not an active GM signup for this week.");
      }
      if (signup.gameTier !== targetTable.gameTier) {
        throw new UserFacingError(
          `That GM signed up for ${signup.gameTier ? gameTierLabel(signup.gameTier) : "no tier"}. This table is ${gameTierLabel(targetTable.gameTier)}.`,
        );
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
    const gmCandidates: GmCandidate[] = gms
      .filter((gm) => gm.gmCommitment !== "backup")
      .map((gm) => ({
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
      gameTier: table.gameTier,
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
      openSeatingAt: event.openSeatingAt ?? event.signupLocksAt,
      openSeating: this.now() >= (event.openSeatingAt ?? event.signupLocksAt),
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

    const [previous, currentBundle] = await Promise.all([
      this.repository.getAssignment(input.planId, input.userId),
      this.repository.getPlanBundle(input.planId),
    ]);
    const requestedTable = currentBundle?.tables.find(
      (candidate) => candidate.tableId === input.tableId,
    );
    if (!requestedTable) {
      throw new UserFacingError("That table no longer exists.");
    }
    if (input.action === "join") {
      if (!previous || previous.status === "withdrawn") {
        throw new UserFacingError("Only an active player signup can choose a table.");
      }
      const openSeatingAt = event.openSeatingAt ?? event.signupLocksAt;
      if (previous.rosterStatus === "bench" && this.now() < openSeatingAt) {
        throw new UserFacingError(
          `You are on the ${gameTierLabel(previous.gameTier)} waitlist because that tier's planned seats were reserved by earlier signups. ` +
            "If a reserved player in your tier drops, its first waitlisted player is promoted and privately notified. " +
            "Any remaining seats become first-come, first-served " +
            unix(openSeatingAt) +
            ".",
        );
      }
      if (previous.gameTier !== requestedTable.gameTier) {
        throw new UserFacingError(
          `Your weekly signup is ${gameTierLabel(previous.gameTier)}. Choose a table marked T${previous.gameTier}.`,
        );
      }
    }
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
        if (candidate.gameTier !== table.gameTier) return false;
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
    await this.refreshSignupPosts(projectedArchived);
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
    await this.refreshSignupPosts(cancelled);
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
