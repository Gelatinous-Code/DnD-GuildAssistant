import {
  DiscordRestClient,
  discordTimestamp,
  safeAllowedMentions,
  type DiscordMessagePayload,
} from "./discord-api";
import {
  InteractionResponseType,
  InteractionType,
  MessageFlags,
  type DiscordInteraction,
} from "./discord";
import {
  booleanOption,
  ephemeral,
  invokingDisplayName,
  invokingUserId,
  isGuildAdmin,
  numberOption,
  parseCommand,
  parseComponentId,
  requireGuild,
  stringOption,
  UserFacingError,
} from "./interaction-utils";
import {
  resolveSecondDawnPreset,
  SECOND_DAWN_PRESET,
} from "./guild-preset";
import {
  cancelPriorityForEvent,
  reconcilePriorityAfterPublish,
  handleM6Command,
  handleM6Component,
  runM6Scheduled,
  settlePriorityForEvent,
} from "./m6-app";
import {
  diagnoseChannelPermissions,
  diagnoseInteractionPermissions,
  effectiveChannelPermissions,
  renderReminderTemplate,
  validateTablePolicy,
} from "./policy";
import {
  ReminderConfigurationError,
  ReminderService,
  preLockReminderRuleId,
  reminderCapacitySummary,
  scheduledReminderKey,
} from "./reminder-service";
import {
  formatRoleDiagnostics,
  formatRoleReport,
  requireSuccessfulRoleReconciliation,
  RoleService,
} from "./role-service";
import { RosterNotificationService } from "./roster-notification-service";
import {
  NEW_DAWN_CADENCE,
  nextWeeklyOccurrence,
  validateWeeklyCadence,
} from "./schedule";
import { runScheduledTick, schedulerOperationKey } from "./scheduler";
import {
  GuildRepository,
  type GuildConfig,
  type WeeklyEvent,
} from "./storage/repository";
import { WeekService } from "./week-service";
import {
  generateWeeklyRosterCsv,
  WeeklyExportLimitError,
} from "./weekly-export";

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

interface InternalAttachmentResponse {
  filename: string;
  contentType: string;
  content: string;
  audit?: {
    guildId: string;
    eventId: string;
    actorUserId?: string;
    details: Record<string, unknown>;
  };
}

async function recordAttachmentDelivery(
  env: Env,
  attachment: InternalAttachmentResponse,
  status: "succeeded" | "failed",
  error?: unknown,
): Promise<void> {
  if (!attachment.audit) return;
  try {
    await new GuildRepository(env.DB).appendAudit({
      guildId: attachment.audit.guildId,
      eventId: attachment.audit.eventId,
      actorUserId: attachment.audit.actorUserId,
      action:
        status === "succeeded"
          ? "week.roster-exported"
          : "week.roster-export-delivery-failed",
      entityType: "weekly_event",
      entityId: attachment.audit.eventId,
      details: {
        ...attachment.audit.details,
        deliveryStatus: status,
        ...(status === "failed"
          ? { errorKind: error instanceof Error ? error.name : typeof error }
          : {}),
      },
    });
  } catch (auditError) {
    console.error(
      JSON.stringify({
        kind: "guild-assistant.attachment-audit-error",
        eventId: attachment.audit.eventId,
        deliveryStatus: status,
        errorKind: auditError instanceof Error ? auditError.name : typeof auditError,
      }),
    );
  }
}

function weekdayName(weekday: number): string {
  return WEEKDAY_NAMES[weekday] ?? `weekday ${weekday}`;
}

function automationMode(config: Pick<GuildConfig, "schedulingEnabled" | "autoPublishEnabled">): string {
  if (!config.schedulingEnabled) return "paused";
  return config.autoPublishEnabled ? "autopilot" : "review before publish";
}

function setupDashboard(config: GuildConfig | null): string {
  const timezone = config?.timezone ?? NEW_DAWN_CADENCE.timeZone;
  const weeklyDay = config?.weeklyDay ?? NEW_DAWN_CADENCE.game.weekday;
  const weeklyTime = config?.weeklyTime ?? NEW_DAWN_CADENCE.game.time;
  const gmDay = config?.gmSignupDay ?? NEW_DAWN_CADENCE.gmSignup.weekday;
  const gmTime = config?.gmSignupTime ?? NEW_DAWN_CADENCE.gmSignup.time;
  const playerDay = config?.playerSignupDay ?? NEW_DAWN_CADENCE.playerSignup.weekday;
  const playerTime = config?.playerSignupTime ?? NEW_DAWN_CADENCE.playerSignup.time;
  const tablesDay = config?.tablePublishDay ?? NEW_DAWN_CADENCE.tablePublish.weekday;
  const tablesTime = config?.tablePublishTime ?? NEW_DAWN_CADENCE.tablePublish.time;
  const openDay = config?.openSeatingDay ?? NEW_DAWN_CADENCE.openSeating.weekday;
  const openTime = config?.openSeatingTime ?? NEW_DAWN_CADENCE.openSeating.time;
  const next = Date.parse(
    nextWeeklyOccurrence(
      { weekday: weeklyDay, time: weeklyTime, timeZone: timezone },
      new Date().toISOString(),
    ),
  );
  return [
    "## Guild Assistant setup",
    config
      ? "Your saved configuration is below. Supply only the options you want to change."
      : "Nothing is saved yet. Choose the Second Dawn preset or select one workflow channel.",
    "",
    `${config?.eventChannelId ? "✅" : "❌"} **Player signup and tables:** ${
      config?.eventChannelId ? `<#${config.eventChannelId}>` : "choose a text channel"
    }`,
    `${config?.eventChannelId ? "✅" : "❌"} **GM signup:** ${
      config?.gmSignupChannelId ? `<#${config.gmSignupChannelId}>` : "same as the player channel"
    }`,
    `✅ **Weekly flow (${timezone}):**`,
    `1. GM signup opens ${weekdayName(gmDay)} at ${gmTime}`,
    `2. Player interest opens ${weekdayName(playerDay)} at ${playerTime}`,
    `3. Tables publish ${weekdayName(tablesDay)} at ${tablesTime}`,
    `4. Remaining seats become first-come ${weekdayName(openDay)} at ${openTime}`,
    `5. Games run ${weekdayName(weeklyDay)} at ${weeklyTime} for ${config?.eventDurationMinutes ?? 180} minutes`,
    `**Next game:** ${discordTimestamp(next)} (${discordTimestamp(next, "R")})`,
    `✅ **Tables:** ${config?.tableMinSize ?? 4} minimum / ${
      config?.tablePreferredSize ?? 6
    } preferred / ${config?.tableMaxSize ?? 6} maximum`,
    "**Player capacity:** signup order reserves available seats. Extra players form one global waitlist.",
    "**Drops:** before open seating, the first waitlisted player inherits the reservation and receives a private message.",
    "**No table chosen:** no penalty; at open seating, every remaining spot is first-come until game time.",
    `${config?.gmRoleId ? "✅" : "➖"} **Weekly GM role (optional):** ${
      config?.gmRoleId ? `<@&${config.gmRoleId}>` : "not configured"
    }`,
    `${config?.reminderRoleId ? "✅" : "➖"} **Reminder role (optional):** ${
      config?.reminderRoleId ? `<@&${config.reminderRoleId}>` : "channel-only reminders are available"
    }`,
    `${config?.adminRoleId ? "✅" : "➖"} **Organizer escalation role (optional):** ${
      config?.adminRoleId ? `<@&${config.adminRoleId}>` : "not configured"
    }`,
    `${config?.schedulingEnabled ? "✅" : "⏸️"} **Automation mode:** ${config ? automationMode(config) : "paused"}`,
    "",
    config
      ? "Next: run `/guild status`, then `/guild doctor`. Keep automation Paused until the test-guild pilot passes."
      : "Next: run `/guild setup channel:#your-channel`, then `/guild status` and `/guild doctor`.",
  ].join("\n");
}

function helpContent(interaction: DiscordInteraction): string {
  const topic = stringOption(parseCommand(interaction), "topic") ?? "player";

  if (topic === "gm") {
    return [
      "## Running a game",
      "1. When GM signup opens, click **Run a Game** on the weekly post.",
      "2. Volunteering does not guarantee selection; the bot uses the guild's fair rotation and the number of players.",
      "3. If your availability changes, click **Withdraw** and tell an organizer.",
      "4. After the game, an organizer confirms whether your table ran and records only roster changes.",
      "",
      "An eligible completed DM session earns two priority tokens. Check them with `/priority status`.",
      "",
      "Choose another `/help` topic for playing, priority tokens, or organizing.",
    ].join("\n");
  }

  if (topic === "priority") {
    return [
      "## DM priority tokens",
      "Eligible DMs receive two tokens after an organizer confirms a completed session.",
      "",
      "- `/priority status` privately shows your tokens and usable dates.",
      "- `/priority use table_number:<number>` shows a private seating preview. Nothing changes until you confirm.",
      "- `/priority release confirm:True` stops using the token but keeps your ordinary table request.",
      "",
      "Priority can move an ordinary player to a waitlist when a table is full. The preview explains the exact result first.",
      "",
      "If a token message did not arrive, run `/priority status`; message delivery does not create or erase the token.",
    ].join("\n");
  }

  if (topic === "organizer") {
    return [
      "## Organizing the server",
      "**First setup:** `/guild setup` -> `/guild status` -> `/guild doctor`.",
      "",
      "**Normal Review week:** use `/week status` to inspect the draft, then `/week publish` when it is correct.",
      "",
      "**After a game:** `/session status`, record only attendance differences, then `/session confirm`.",
      "",
      "**Stop safely:** `/guild automation mode:Paused confirm:True`, then check `/week status` and `/guild doctor`.",
      "",
      "Setup and lifecycle commands require **Manage Server**. Do not repair a roster by editing bot messages.",
    ].join("\n");
  }

  return [
    "## Playing this week",
    "1. Click **Play** on the newest weekly signup post.",
    "2. When tables appear, click **Join** on the table you want.",
    "3. If that table is full, the bot places you on its waitlist. If all weekly places were already reserved, it explains the global waitlist.",
    "4. At open seating, any still-free places become first-come, first-served.",
    "",
    "**Leave Table** clears only your table choice; you are still signed up for the week.",
    "**Withdraw** drops you from the whole week and may promote the next waiting player.",
    "",
    "Use the newest bot message if an old button is rejected. Choose another `/help` topic for GMing, priority tokens, or organizing.",
  ].join("\n");
}

function ephemeralAttachment(
  content: string,
  attachment: InternalAttachmentResponse,
): Response {
  return Response.json({
    type: InteractionResponseType.ChannelMessageWithSource,
    data: {
      content,
      flags: MessageFlags.Ephemeral,
      allowed_mentions: safeAllowedMentions(),
    },
    attachment,
  });
}

function boundedDiscordContent(content: string): string {
  return content.length <= 1_950 ? content : `${content.slice(0, 1_949)}…`;
}

async function coreAutomationProblems(
  discord: DiscordRestClient,
  guildId: string,
  config: GuildConfig,
): Promise<string[]> {
  const channelIds = [
    config.eventChannelId,
    config.gmSignupChannelId,
    config.tableChannelId,
    config.reminderChannelId,
  ].filter((value): value is string => Boolean(value));
  if (!config.eventChannelId) return ["Choose an operations channel in /guild setup."];

  const [roles, botMember] = await Promise.all([
    discord.getGuildRoles(guildId),
    discord.getCurrentBotGuildMember(guildId),
  ]);
  const problems: string[] = [];
  for (const channelId of [...new Set(channelIds)]) {
    try {
      const channel = await discord.getChannel(channelId);
      if (channel.guild_id && channel.guild_id !== guildId) {
        problems.push(`Channel ${channelId} belongs to another server.`);
        continue;
      }
      if (![0, 5].includes(channel.type)) {
        problems.push(`<#${channelId}> must be a normal text or announcement channel.`);
        continue;
      }
      const checks = diagnoseChannelPermissions(
        effectiveChannelPermissions({ guildId, channel, roles, botMember }),
      );
      problems.push(
        ...checks
          .filter((check) => check.level === "failure")
          .map((check) => `<#${channelId}> ${check.name}: ${check.detail}`),
      );
    } catch {
      problems.push(`Channel ${channelId} is missing or invisible to the bot.`);
    }
  }
  return problems;
}

function requireAdmin(interaction: DiscordInteraction): void {
  if (!isGuildAdmin(interaction)) {
    throw new UserFacingError(
      "This command requires the Discord Manage Server permission.",
    );
  }
}

function services(env: Env): {
  repository: GuildRepository;
  discord: DiscordRestClient;
  week: WeekService;
  roles: RoleService;
  reminders: ReminderService;
} {
  const repository = new GuildRepository(env.DB);
  const discord = new DiscordRestClient(env.DISCORD_BOT_TOKEN);
  return {
    repository,
    discord,
    week: new WeekService(repository, discord),
    roles: new RoleService(repository, discord),
    reminders: new ReminderService(repository, discord),
  };
}

type RecoverableSchedulerAction =
  | "open"
  | "lock-plan"
  | "publish"
  | "roles"
  | "finalize"
  | "archive";

async function runSchedulerRecovery(
  repository: GuildRepository,
  event: WeeklyEvent,
  action: RecoverableSchedulerAction,
  actorUserId: string | undefined,
  work: () => Promise<void>,
  operationEntityId = event.eventId,
): Promise<"completed" | "already-completed"> {
  const operationKey = schedulerOperationKey(action, operationEntityId);
  const claim = await repository.beginOperation({
    operationKey,
    guildId: event.guildId,
    eventId: event.eventId,
    operationKind: "scheduler-" + action,
    request: { action, entityId: operationEntityId, source: "admin-retry" },
  });
  let ownsClaim = claim.claimed;
  if (!ownsClaim && claim.operation.status !== "succeeded") {
    ownsClaim = await repository.retryOperation(operationKey);
  }
  if (!ownsClaim) {
    if (claim.operation.status === "succeeded") return "already-completed";
    throw new UserFacingError(
      "That scheduler step is currently running. Wait for its lease to expire, then retry.",
    );
  }
  try {
    await work();
    await repository.finishOperation(operationKey, {
      status: "succeeded",
      result: { recoveredByUserId: actorUserId ?? null },
    });
    await repository.appendAudit({
      guildId: event.guildId,
      eventId: event.eventId,
      actorUserId,
      action: "scheduler.admin-retry",
      entityType: "operation",
      entityId: operationKey,
      details: { step: action },
    });
    return "completed";
  } catch (error) {
    await repository.finishOperation(operationKey, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function skipSchedulerStep(
  repository: GuildRepository,
  event: WeeklyEvent,
  action: RecoverableSchedulerAction,
  actorUserId: string | undefined,
  reason: string,
  operationEntityId = event.eventId,
): Promise<"skipped" | "already-completed"> {
  const operationKey = schedulerOperationKey(action, operationEntityId);
  const claim = await repository.beginOperation({
    operationKey,
    guildId: event.guildId,
    eventId: event.eventId,
    operationKind: "scheduler-" + action,
    request: { action, entityId: operationEntityId, source: "admin-skip" },
  });
  let ownsClaim = claim.claimed;
  if (!ownsClaim && claim.operation.status !== "succeeded") {
    ownsClaim = await repository.retryOperation(operationKey);
  }
  if (!ownsClaim) {
    if (claim.operation.status === "succeeded") return "already-completed";
    throw new UserFacingError(
      "That scheduler step is currently running and cannot be skipped yet.",
    );
  }
  await repository.finishOperation(operationKey, {
    status: "succeeded",
    result: { skipped: true, reason, skippedByUserId: actorUserId ?? null },
  });
  await repository.appendAudit({
    guildId: event.guildId,
    eventId: event.eventId,
    actorUserId,
    action: "scheduler.admin-skip",
    entityType: "operation",
    entityId: operationKey,
    details: { step: action, reason },
  });
  return "skipped";
}

function setupSummary(config: GuildConfig): string {
  return [
    "✅ Guild configuration saved.",
    "**Player signup and tables:** " + (config.eventChannelId ? "<#" + config.eventChannelId + ">" : "missing"),
    "**GM signup channel:** " + (config.gmSignupChannelId ? "<#" + config.gmSignupChannelId + ">" : "same as player signup"),
    "**Time zone:** " + config.timezone,
    "**GM signup:** " +
      weekdayName(config.gmSignupDay ?? NEW_DAWN_CADENCE.gmSignup.weekday) +
      " at " + (config.gmSignupTime ?? NEW_DAWN_CADENCE.gmSignup.time),
    "**Player interest:** " +
      weekdayName(config.playerSignupDay ?? NEW_DAWN_CADENCE.playerSignup.weekday) +
      " at " + (config.playerSignupTime ?? NEW_DAWN_CADENCE.playerSignup.time),
    "**Tables publish:** " +
      weekdayName(config.tablePublishDay ?? NEW_DAWN_CADENCE.tablePublish.weekday) +
      " at " + (config.tablePublishTime ?? NEW_DAWN_CADENCE.tablePublish.time),
    "**Open seating:** " +
      weekdayName(config.openSeatingDay ?? NEW_DAWN_CADENCE.openSeating.weekday) +
      " at " + (config.openSeatingTime ?? NEW_DAWN_CADENCE.openSeating.time),
    "**Games:** " + weekdayName(config.weeklyDay) + " at " + config.weeklyTime +
      " for " + config.eventDurationMinutes + " minutes",
    "**Table sizes:** " + config.tableMinSize + " / " +
      config.tablePreferredSize + " / " + config.tableMaxSize,
    "**Player capacity:** signup-order reservations, one global waitlist, then first-come open seating.",
    "**Weekly GM role:** " +
      (config.gmRoleId ? "<@&" + config.gmRoleId + ">" : "optional; not configured"),
    "**Reminder role:** " +
      (config.reminderRoleId ? "<@&" + config.reminderRoleId + ">" : "not set"),
    "**Automation:** " + automationMode(config) + ", GM role sync " +
      (config.roleSyncEnabled ? "on" : "paused"),
  ].join("\n");
}

async function handleGuildCommand(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response> {
  requireAdmin(interaction);
  const guildId = requireGuild(interaction);
  const invocation = parseCommand(interaction);
  const { repository, discord, week, roles, reminders } = services(env);

  if (invocation.subcommand === "setup") {
    const current = await repository.getGuildConfig(guildId);
    if (invocation.options.size === 0) return ephemeral(setupDashboard(current));

    const preset = stringOption(invocation, "preset");
    if (preset !== undefined && preset !== SECOND_DAWN_PRESET) {
      throw new UserFacingError("Choose a recognized guild setup preset.");
    }
    let presetRouting: ReturnType<typeof resolveSecondDawnPreset> | undefined;
    if (preset === SECOND_DAWN_PRESET) {
      try {
        const [channels, guildRoles] = await Promise.all([
          discord.getGuildChannels(guildId),
          discord.getGuildRoles(guildId),
        ]);
        presetRouting = resolveSecondDawnPreset(channels, guildRoles);
      } catch (error) {
        throw new UserFacingError(
          "Second Dawn setup was not saved: " +
            (error instanceof Error ? error.message : "the guild resources could not be discovered"),
        );
      }
    }

    const selectedChannelId =
      stringOption(invocation, "channel") ?? presetRouting?.playerSignupChannelId;
    const channelId = selectedChannelId ?? current?.eventChannelId;
    if (!channelId) {
      throw new UserFacingError(
        "Choose an operations channel once. The Weekly GM role and every other setting are optional.",
      );
    }
    if (selectedChannelId) {
      const channel = await discord.getChannel(selectedChannelId);
      if (channel.guild_id && channel.guild_id !== guildId) {
        throw new UserFacingError("The selected channel belongs to a different server.");
      }
      if (![0, 5].includes(channel.type)) {
        throw new UserFacingError(
          "Choose a normal text or announcement channel for the weekly workflow.",
        );
      }
    }

    const selectedGmRoleId = stringOption(invocation, "gm_role");
    const selectedReminderRoleId =
      stringOption(invocation, "reminder_role") ?? presetRouting?.playerReminderRoleId;
    const selectedAdminRoleId = stringOption(invocation, "admin_role") ?? presetRouting?.adminRoleId;
    const clearGmRole = booleanOption(invocation, "clear_gm_role") === true;
    const clearReminderRole = booleanOption(invocation, "clear_reminder_role") === true;
    const clearAdminRole = booleanOption(invocation, "clear_admin_role") === true;
    if (clearGmRole && selectedGmRoleId) {
      throw new UserFacingError("Choose gm_role or clear_gm_role, not both.");
    }
    if (clearReminderRole && selectedReminderRoleId) {
      throw new UserFacingError("Choose reminder_role or clear_reminder_role, not both.");
    }
    if (clearAdminRole && selectedAdminRoleId) {
      throw new UserFacingError("Choose admin_role or clear_admin_role, not both.");
    }
    const timezone =
      stringOption(invocation, "timezone") ?? current?.timezone ?? NEW_DAWN_CADENCE.timeZone;
    const weeklyDay =
      numberOption(invocation, "weekday") ?? current?.weeklyDay ?? NEW_DAWN_CADENCE.game.weekday;
    const weeklyTime =
      stringOption(invocation, "time") ?? current?.weeklyTime ?? NEW_DAWN_CADENCE.game.time;
    const gmSignupDay =
      numberOption(invocation, "gm_day") ?? current?.gmSignupDay ?? NEW_DAWN_CADENCE.gmSignup.weekday;
    const gmSignupTime =
      stringOption(invocation, "gm_time") ?? current?.gmSignupTime ?? NEW_DAWN_CADENCE.gmSignup.time;
    const playerSignupDay =
      numberOption(invocation, "player_day") ?? current?.playerSignupDay ?? NEW_DAWN_CADENCE.playerSignup.weekday;
    const playerSignupTime =
      stringOption(invocation, "player_time") ?? current?.playerSignupTime ?? NEW_DAWN_CADENCE.playerSignup.time;
    const tablePublishDay =
      numberOption(invocation, "tables_day") ?? current?.tablePublishDay ?? NEW_DAWN_CADENCE.tablePublish.weekday;
    const tablePublishTime =
      stringOption(invocation, "tables_time") ?? current?.tablePublishTime ?? NEW_DAWN_CADENCE.tablePublish.time;
    const openSeatingDay =
      numberOption(invocation, "open_seating_day") ?? current?.openSeatingDay ?? NEW_DAWN_CADENCE.openSeating.weekday;
    const openSeatingTime =
      stringOption(invocation, "open_seating_time") ?? current?.openSeatingTime ?? NEW_DAWN_CADENCE.openSeating.time;
    const eventDurationMinutes =
      numberOption(invocation, "duration_minutes") ?? current?.eventDurationMinutes ?? 180;
    const tableMinSize = numberOption(invocation, "minimum") ?? current?.tableMinSize ?? 4;
    const tablePreferredSize =
      numberOption(invocation, "preferred") ?? current?.tablePreferredSize ?? 6;
    const tableMaxSize = numberOption(invocation, "maximum") ?? current?.tableMaxSize ?? 6;
    const errors = [
      ...validateWeeklyCadence({
        timeZone: timezone,
        game: { weekday: weeklyDay, time: weeklyTime },
        gmSignup: { weekday: gmSignupDay, time: gmSignupTime },
        playerSignup: { weekday: playerSignupDay, time: playerSignupTime },
        tablePublish: { weekday: tablePublishDay, time: tablePublishTime },
        openSeating: { weekday: openSeatingDay, time: openSeatingTime },
      }),
      ...(!Number.isInteger(eventDurationMinutes) || eventDurationMinutes < 60 || eventDurationMinutes > 720
        ? ["duration must be a whole number from 60 through 720 minutes"]
        : []),
      ...validateTablePolicy({
        minimum: tableMinSize,
        preferred: tablePreferredSize,
        maximum: tableMaxSize,
      }),
    ];
    if (errors.length) {
      throw new UserFacingError("Configuration was not saved:\n• " + errors.join("\n• "));
    }

    if (clearGmRole) {
      const cleanup = await roles.cleanupAllLeasedRoles(guildId);
      requireSuccessfulRoleReconciliation(cleanup, "Weekly GM role cleanup");
    }

    const config = await repository.saveGuildConfig({
      guildId,
      eventChannelId: selectedChannelId,
      tableChannelId: selectedChannelId,
      gmSignupChannelId: presetRouting?.gmSignupChannelId,
      reminderChannelId: selectedChannelId,
      gmRoleId: clearGmRole ? null : selectedGmRoleId,
      adminRoleId: clearAdminRole ? null : selectedAdminRoleId,
      reminderRoleId: clearReminderRole ? null : selectedReminderRoleId,
      timezone,
      weeklyDay,
      weeklyTime,
      gmSignupDay,
      gmSignupTime,
      playerSignupDay,
      playerSignupTime,
      tablePublishDay,
      tablePublishTime,
      openSeatingDay,
      openSeatingTime,
      eventDurationMinutes,
      tableMinSize,
      tablePreferredSize,
      tableMaxSize,
      roleSyncEnabled: clearGmRole ? false : undefined,
    });
    const permissionChecks = diagnoseInteractionPermissions(interaction.app_permissions, {
      roleSyncEnabled: config.roleSyncEnabled,
    });
    const roleChecks = config.gmRoleId ? await roles.diagnose(guildId) : null;
    const problems = [
      ...permissionChecks
        .filter((check) => check.level !== "pass")
        .map(
          (check) =>
            (check.level === "failure" ? "❌ " : "⚠️ ") +
            check.name +
            ": " +
            check.detail,
        ),
      ...(roleChecks?.items ?? [])
        .filter((check) => check.status !== "pass")
        .map(
          (check) =>
            (check.status === "fail" && config.roleSyncEnabled ? "❌ " : "⚠️ ") +
            check.title +
            ": " +
            (check.remediation ?? check.detail),
        ),
    ];
    return ephemeral(boundedDiscordContent(
      setupSummary(config) +
        (presetRouting
          ? "\n**Second Dawn preset:** GM signups route to <#" +
            presetRouting.gmSignupChannelId + ">; the permanent GM role <@&" +
            presetRouting.verifiedGmRoleId + "> remains managed by Discord channel access.\n"
          : "") +
        (problems.length
          ? "\n\n**Setup checks:**\n" + problems.join("\n")
          : "\n\n✅ Core setup checks passed.") +
        "\n\nNext: run `/guild doctor`, then choose `/guild automation` when ready.",
    ));
  }

  if (invocation.subcommand === "automation") {
    const config = await repository.getGuildConfig(guildId);
    if (!config) throw new UserFacingError("Run /guild setup first.");
    const mode = stringOption(invocation, "mode");
    if (mode !== "paused" && mode !== "review" && mode !== "autopilot") {
      throw new UserFacingError("Choose paused, review, or autopilot.");
    }
    if (booleanOption(invocation, "confirm") !== true) {
      throw new UserFacingError("Set confirm to True to change automation mode.");
    }

    const requestedRoleSync =
      mode === "paused"
        ? false
        : (booleanOption(invocation, "role_sync") ?? config.roleSyncEnabled);
    const reminderEnabled = booleanOption(invocation, "reminders");
    if (mode !== "paused") {
      const problems = await coreAutomationProblems(discord, guildId, config);
      if (problems.length) {
        throw new UserFacingError(
          "Automation remains paused. Fix these core checks first:\n• " + problems.join("\n• "),
        );
      }
      if (requestedRoleSync) {
        if (!config.gmRoleId) {
          throw new UserFacingError(
            "Role sync needs a normal Weekly GM role. Configure gm_role or leave role_sync False.",
          );
        }
        const report = await roles.diagnose(guildId);
        if (!report.ready) {
          const failures = report.items
            .filter((item) => item.status === "fail")
            .map((item) => item.remediation ?? item.detail);
          throw new UserFacingError(
            "Role sync remains paused:\n• " + failures.join("\n• "),
          );
        }
      }
    }

    if (reminderEnabled !== undefined) {
      const reminderChannelId = config.reminderChannelId ?? config.eventChannelId;
      if (!reminderChannelId) throw new UserFacingError("Configure an operations channel first.");
      if (reminderEnabled && config.reminderRoleId) {
        const role = (await discord.getGuildRoles(guildId)).find(
          (candidate) => candidate.id === config.reminderRoleId,
        );
        if (!role) throw new UserFacingError("The configured reminder role no longer exists.");
        if (!role.mentionable) {
          throw new UserFacingError(
            "The reminder role is not mentionable. Enable “Allow anyone to @mention this role”, then retry.",
          );
        }
      }
      await reminders.configurePreLockRule({
        guildId,
        channelId: reminderChannelId,
        roleId: config.reminderRoleId ?? undefined,
        template: "Please choose Run a Game or Play before signups close. We have {players} players and {gms} GMs.",
        minutesBeforeLock: 48 * 60,
        enabled: reminderEnabled,
      });
    }

    const saved = await repository.saveGuildConfig({
      guildId,
      schedulingEnabled: mode !== "paused",
      autoPublishEnabled: mode === "autopilot",
      roleSyncEnabled: requestedRoleSync,
    });
    await repository.appendAudit({
      guildId,
      actorUserId: invokingUserId(interaction),
      action: "guild.automation-changed",
      entityType: "guild_config",
      entityId: guildId,
      details: { mode, roleSyncEnabled: requestedRoleSync, reminderEnabled },
    });
    return ephemeral(
      `${mode === "paused" ? "⏸️" : "✅"} Automation mode is now **${automationMode(saved)}**.\n` +
        `GM role sync is **${saved.roleSyncEnabled ? "on" : "paused"}**.` +
        (reminderEnabled === undefined
          ? " Reminder configuration was unchanged."
          : ` Default reminders are **${reminderEnabled ? "on" : "off"}**.`),
    );
  }

  if (invocation.subcommand === "status") {
    return ephemeral(await week.getStatus(guildId));
  }

  if (invocation.subcommand === "doctor") {
    const config = await repository.getGuildConfig(guildId);
    if (!config) throw new UserFacingError("Run /guild setup first.");
    const channelIds = [
      config.eventChannelId,
      config.tableChannelId,
      config.gmSignupChannelId,
      config.reminderChannelId,
    ].filter((value): value is string => Boolean(value));
    const [guildRoles, botMember] = await Promise.all([
      discord.getGuildRoles(guildId),
      discord.getCurrentBotGuildMember(guildId),
    ]);
    const channelChecks = await Promise.all(
      [...new Set(channelIds)].map(async (channelId) => {
        try {
          const channel = await discord.getChannel(channelId);
          const checks = diagnoseChannelPermissions(
            effectiveChannelPermissions({
              guildId,
              channel,
              roles: guildRoles,
              botMember,
            }),
          );
          return {
            ready: checks.every((check) => check.level !== "failure"),
            text: [
              "✅ <#" + channel.id + "> exists.",
              ...checks.map(
                (check) =>
                  (check.level === "pass" ? "✅" : check.level === "warning" ? "⚠️" : "❌") +
                  " <#" +
                  channel.id +
                  "> **" +
                  check.name +
                  "** — " +
                  check.detail,
              ),
            ].join("\n"),
          };
        } catch {
          return {
            ready: false,
            text: "❌ Channel " + channelId + " is missing or invisible. Select it again in /guild setup.",
          };
        }
      }),
    );
    const permissionResults = diagnoseInteractionPermissions(interaction.app_permissions, {
      roleSyncEnabled: config.roleSyncEnabled,
    }).map(
      (check) =>
        (check.level === "pass" ? "✅" : check.level === "warning" ? "⚠️" : "❌") +
        " **" +
        check.name +
        "** — " +
        check.detail,
    );
    const notificationRoleResults = [
      ["Reminder role", config.reminderRoleId],
      ["Organizer escalation role", config.adminRoleId],
    ].flatMap(([label, roleId]) => {
      if (!roleId) return ["➖ **" + label + "** — optional and not configured."];
      const role = guildRoles.find((candidate) => candidate.id === roleId);
      if (!role) {
        return [
          "❌ **" + label + "** — configured role " + roleId + " is missing. Re-run /guild setup.",
        ];
      }
      return [
        (role.mentionable ? "✅" : "❌") +
          " **" +
          label +
          "** — @" +
          role.name +
          (role.mentionable
            ? " exists and is mentionable."
            : " exists but cannot notify members. Enable “Allow anyone to @mention this role”."),
      ];
    });
    const roleReport = config.gmRoleId ? await roles.diagnose(guildId) : null;
    const coreProblems = await coreAutomationProblems(discord, guildId, config);
    const coreReady = coreProblems.length === 0 && channelChecks.every((check) => check.ready);
    const roleReady = !config.roleSyncEnabled || Boolean(roleReport?.ready);
    return ephemeral(
      boundedDiscordContent([
        "## Guild Assistant doctor",
        coreReady
          ? "✅ **Core Discord workflow is ready.**"
          : "❌ **Core workflow needs attention:** " + coreProblems.join(" "),
        config.schedulingEnabled && coreReady
          ? "✅ **Scheduled lifecycle:** running in " + automationMode(config) + " mode."
          : config.schedulingEnabled
            ? "❌ **Scheduled lifecycle:** configured but blocked by the core checks above."
            : "⏸️ **Scheduled lifecycle:** paused until /guild automation is enabled.",
        config.autoPublishEnabled
          ? "✅ **Automatic publishing:** on."
          : "➖ **Automatic publishing:** off; an organizer reviews and runs /week publish.",
        config.roleSyncEnabled && roleReady
          ? "✅ **Weekly GM role sync:** on and ready."
          : config.roleSyncEnabled
            ? "❌ **Weekly GM role sync:** on but needs repair."
            : "➖ **Weekly GM role sync:** optional and paused.",
        ...(roleReport
          ? ["", "**Weekly GM role diagnostics**", formatRoleDiagnostics(roleReport, false)]
          : []),
        "",
        "**Configured resources**",
        ...channelChecks.map((check) => check.text),
        "",
        "**Optional notification roles**",
        ...notificationRoleResults,
        "",
        "**Permissions in this command channel**",
        ...permissionResults,
        "",
        coreReady
          ? "Next: choose Review or Autopilot with /guild automation."
          : "Next: repair the failed items, then run /guild doctor again.",
      ].join("\n")),
    );
  }

  throw new UserFacingError("Unknown /guild subcommand.");
}

async function handleWeekCommand(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response> {
  requireAdmin(interaction);
  const guildId = requireGuild(interaction);
  const actorUserId = invokingUserId(interaction);
  const invocation = parseCommand(interaction);
  const { repository, discord, week, roles, reminders } = services(env);

  if (invocation.subcommand === "open") {
    const event = await week.openWeek({
      guildId,
      actorUserId,
      startsAt: stringOption(invocation, "starts_at"),
      title: stringOption(invocation, "title"),
    });
    await reminders.enqueuePreLockReminder(event);
    return ephemeral("✅ Signups are open for **" + event.title + "** on <t:" + Math.floor(event.startsAt / 1000) + ":F>.");
  }
  if (invocation.subcommand === "status") {
    return ephemeral(await week.getStatus(guildId));
  }
  if (invocation.subcommand === "lock") {
    const event = await week.lockWeek(guildId, actorUserId);
    return ephemeral("🔒 Signups are locked for **" + event.title + "**.");
  }
  if (invocation.subcommand === "signup") {
    const userId = stringOption(invocation, "member");
    const action = stringOption(invocation, "kind");
    if (!userId || (action !== "gm" && action !== "player" && action !== "withdraw")) {
      throw new UserFacingError("member and a valid kind are required.");
    }
    let displayName = userId;
    try {
      const member = await discord.getGuildMember(guildId, userId);
      displayName =
        member.nick ??
        member.user?.global_name ??
        member.user?.username ??
        userId;
    } catch {
      if (action !== "withdraw") {
        throw new UserFacingError("That member could not be found in this server.");
      }
    }
    const result = await week.correctSignup({
      guildId,
      actorUserId,
      userId,
      displayName,
      action,
    });
    let automationText = "";
    let correctionWarning = result.warning;
    if (result.requiresReplan) {
      const config = await repository.getGuildConfig(guildId);
      if (config?.autoPublishEnabled) {
        try {
          await week.generatePlan(guildId, actorUserId, result.event.eventId);
          const published = await week.publishPlan(
            guildId,
            actorUserId,
            false,
            result.event.eventId,
          );
          await reconcilePriorityAfterPublish(
            env, result.event.eventId, published.bundle.plan.planId,
          );
          correctionWarning = undefined;
          automationText =
            "\n✅ Autopilot rebuilt and published revision " +
            published.bundle.plan.generation +
            ".";
          if (config.roleSyncEnabled) {
            try {
              automationText += "\n" + formatRoleReport(await roles.sync(guildId));
            } catch (error) {
              automationText +=
                "\n⚠️ Tables were updated, but GM role sync needs repair: " +
                (error instanceof Error ? error.message : String(error));
            }
          }
        } catch (error) {
          correctionWarning = undefined;
          automationText =
            "\n⚠️ The correction was saved, but autopilot could not rebuild the plan: " +
            (error instanceof Error ? error.message : String(error)) +
            " Run /week status, then retry or review /week plan.";
        }
      } else {
        automationText = "\n➖ The GM pool changed; review /week plan before publishing.";
      }
    }
    return ephemeral(
      "✅ Corrected <@" + userId + "> to **" + action + "**." +
        (correctionWarning ? "\n⚠️ " + correctionWarning : "") +
        automationText,
    );
  }
  if (invocation.subcommand === "plan") {
    const result = await week.generatePlan(guildId, actorUserId);
    return ephemeral(
      "Draft revision " + result.bundle.plan.generation + " is ready for review.",
      { ...result.preview },
    );
  }
  if (invocation.subcommand === "override") {
    const tableNumber = numberOption(invocation, "table_number");
    if (tableNumber === undefined) throw new UserFacingError("table_number is required.");
    const result = await week.overrideDraft({
      guildId,
      actorUserId,
      tableNumber,
      title: stringOption(invocation, "name"),
      capacity: numberOption(invocation, "capacity"),
      gmUserId: stringOption(invocation, "gm"),
      reason: stringOption(invocation, "reason") ?? "",
    });
    return ephemeral(
      "✅ Draft table " + tableNumber + " updated and audited.",
      { ...result.preview },
    );
  }
  if (invocation.subcommand === "publish") {
    const result = await week.publishPlan(guildId, actorUserId);
    await reconcilePriorityAfterPublish(
      env, result.event.eventId, result.bundle.plan.planId,
    );
    let roleText = "";
    const config = await repository.getGuildConfig(guildId);
    if (config?.roleSyncEnabled) {
      try {
        roleText = "\n" + formatRoleReport(await roles.sync(guildId));
      } catch (error) {
        roleText =
          "\n⚠️ Tables published, but GM role sync needs repair: " +
          (error instanceof Error ? error.message : String(error));
      }
    }
    return ephemeral(
      "✅ Published " +
        result.bundle.tables.length +
        " tables." +
        (result.links.length ? "\n" + result.links.join("\n") : "") +
      roleText,
    );
  }
  if (invocation.subcommand === "export") {
    const attachFiles = diagnoseInteractionPermissions(interaction.app_permissions).find(
      (check) => check.name === "Attach Files",
    );
    if (attachFiles?.level !== "pass") {
      throw new UserFacingError(
        "This channel does not grant the bot Attach Files. Allow that permission, then retry the export.",
      );
    }
    try {
      const snapshot = await week.exportSnapshot(
        guildId,
        stringOption(invocation, "event_id"),
      );
      const exported = generateWeeklyRosterCsv(snapshot);
      return ephemeralAttachment(
        "✅ Private roster snapshot ready: **" + exported.filename + "** (" + exported.rowCount + " rows).",
        {
          filename: exported.filename,
          contentType: exported.contentType,
          content: exported.text,
          audit: {
            guildId,
            eventId: snapshot.event.eventId,
            actorUserId,
            details: {
              schemaVersion: exported.schemaVersion,
              rowCount: exported.rowCount,
              byteLength: exported.byteLength,
              filename: exported.filename,
              planId: snapshot.planBundle?.plan.planId ?? null,
              planGeneration: snapshot.planBundle?.plan.generation ?? null,
              planStatus: snapshot.planBundle?.plan.status ?? null,
            },
          },
        },
      );
    } catch (error) {
      if (error instanceof WeeklyExportLimitError) {
        throw new UserFacingError(
          "The roster is too large for a safe Discord attachment (" +
            error.actual +
            " " +
            error.limit +
            "; limit " +
            error.maximum +
            ").",
        );
      }
      throw error;
    }
  }
  if (invocation.subcommand === "archive") {
    const current = await repository.getCurrentWeeklyEvent(guildId);
    if (current) await settlePriorityForEvent(env, current);
    await week.archiveWeek(guildId, actorUserId);
    let roleText = "⚠️ GM role sync is paused; no Discord roles were changed.";
    try {
      roleText = formatRoleReport(await roles.sync(guildId));
    } catch (error) {
      if (!(error instanceof UserFacingError)) throw error;
    }
    return ephemeral("📦 Week archived.\n" + roleText);
  }
  if (invocation.subcommand === "cancel") {
    const reason = stringOption(invocation, "reason") ?? "";
    if (reason.replace(/[\r\n]+/g, " ").trim().length < 3) {
      throw new UserFacingError("reason must contain at least 3 characters.");
    }
    const current = await repository.getCurrentWeeklyEvent(guildId);
    if (!current) throw new UserFacingError("There is no active week to cancel.");
    await cancelPriorityForEvent(
      env, current, actorUserId ?? interaction.id ?? "discord-interaction", reason);
    let roleText = "⚠️ GM role sync is paused; no Discord roles were changed.";
    const event = await week.cancelWeek(guildId, actorUserId, reason);
    try {
      roleText = formatRoleReport(await roles.sync(guildId));
    } catch (error) {
      if (!(error instanceof UserFacingError)) throw error;
    }
    return ephemeral(
      "🛑 Cancelled **" + event.title + "**.\n" + roleText,
    );
  }
  if (invocation.subcommand === "retry") {
    const step = stringOption(invocation, "step");
    if (step === "publish") {
      const event = await repository.getCurrentWeeklyEvent(guildId);
      if (!event) throw new UserFacingError("There is no active week.");
      const outcome = await runSchedulerRecovery(
        repository,
        event,
        "publish",
        actorUserId,
        async () => {
          const published = await week.publishPlan(guildId, actorUserId, true, event.eventId);
          await reconcilePriorityAfterPublish(
            env, event.eventId, published.bundle.plan.planId,
          );
        },
      );
      return ephemeral("✅ Table publication step is " + outcome + ".");
    }
    if (step === "open") {
      const event = await repository.getCurrentWeeklyEvent(guildId);
      if (!event) throw new UserFacingError("There is no active week.");
      const outcome = await runSchedulerRecovery(
        repository,
        event,
        "open",
        actorUserId,
        () => week.openExistingEvent(event),
      );
      return ephemeral("✅ Open-signups step is " + outcome + ".");
    }
    if (step === "lock") {
      const event = await repository.getCurrentWeeklyEvent(guildId);
      if (!event) throw new UserFacingError("There is no active week.");
      const outcome = await runSchedulerRecovery(
        repository,
        event,
        "lock-plan",
        actorUserId,
        async () => {
          await week.lockWeek(guildId, actorUserId, event.eventId);
          await week.generatePlan(guildId, actorUserId, event.eventId);
        },
      );
      return ephemeral("✅ Lock and draft generation are " + outcome + ".");
    }
    if (step === "remind") {
      const event = await repository.getCurrentWeeklyEvent(guildId);
      if (!event) throw new UserFacingError("There is no active week.");
      const deliveryId = scheduledReminderKey(
        event.eventId,
        preLockReminderRuleId(guildId),
      );
      const result = await reminders.retryScheduledReminder(deliveryId);
      return ephemeral(
        "Scheduled reminder retry: " +
          result.status +
          (result.reason ? " — " + result.reason : "."),
      );
    }
    if (step === "roles") {
      const event = await repository.getCurrentWeeklyEvent(guildId);
      if (!event) throw new UserFacingError("There is no active week.");
      const plan = await repository.getCurrentPlan(event.eventId);
      if (!plan || plan.status !== "published") {
        throw new UserFacingError("The week has no authoritative published plan.");
      }
      let report = "";
      const outcome = await runSchedulerRecovery(
        repository,
        event,
        "roles",
        actorUserId,
        async () => {
          const roleReport = await roles.sync(guildId);
          report = formatRoleReport(roleReport);
          requireSuccessfulRoleReconciliation(roleReport);
        },
        event.eventId + ":" + plan.planId,
      );
      return ephemeral("✅ GM role reconciliation is " + outcome + "." + (report ? "\n" + report : ""));
    }
    if (step === "finalize") {
      const event = await repository.getCurrentWeeklyEvent(guildId);
      if (!event) throw new UserFacingError("There is no active week.");
      const plan = await repository.getCurrentPlan(event.eventId);
      if (!plan || plan.status !== "published") {
        throw new UserFacingError("The week has no authoritative published plan.");
      }
      const outcome = await runSchedulerRecovery(
        repository,
        event,
        "finalize",
        actorUserId,
        async () => {
          await settlePriorityForEvent(env, event);
          await week.finalizeTables(guildId, event.eventId);
        },
        event.eventId + ":" + plan.planId + ":" + event.tableStateVersion,
      );
      return ephemeral("✅ Final table manifest step is " + outcome + ".");
    }
    throw new UserFacingError("Choose a valid retry step.");
  }
  if (invocation.subcommand === "skip") {
    if (booleanOption(invocation, "confirm") !== true) {
      throw new UserFacingError("Set confirm to True to skip a scheduled occurrence.");
    }
    const reason = (stringOption(invocation, "reason") ?? "")
      .replace(/[\r\n]+/g, " ")
      .trim();
    if (reason.length < 3 || reason.length > 500) {
      throw new UserFacingError("reason must contain 3 through 500 characters.");
    }
    const step = stringOption(invocation, "step");
    const event = await repository.getCurrentWeeklyEvent(guildId);
    if (!event) throw new UserFacingError("There is no active week.");
    if (step === "remind") {
      const result = await reminders.skipScheduledReminder(
        scheduledReminderKey(event.eventId, preLockReminderRuleId(guildId)),
        reason,
      );
      await repository.appendAudit({
        guildId,
        eventId: event.eventId,
        actorUserId,
        action: "reminder.admin-skip",
        entityType: "reminder_delivery",
        entityId: result.deliveryId,
        details: { reason },
      });
      return ephemeral("⏭️ Scheduled reminder: " + result.reason);
    }
    const action =
      step === "open"
        ? "open"
        : step === "lock"
          ? "lock-plan"
          : step === "publish"
            ? "publish"
            : step === "finalize"
              ? "finalize"
          : step === "archive"
            ? "archive"
            : null;
    if (!action) throw new UserFacingError("Choose a valid scheduled step.");
    let operationEntityId = event.eventId;
    if (action === "finalize") {
      const plan = await repository.getCurrentPlan(event.eventId);
      if (!plan || plan.status !== "published") {
        throw new UserFacingError("The week has no authoritative published plan.");
      }
      operationEntityId =
        event.eventId + ":" + plan.planId + ":" + event.tableStateVersion;
    }
    const result = await skipSchedulerStep(
      repository,
      event,
      action,
      actorUserId,
      reason,
      operationEntityId,
    );
    return ephemeral("⏭️ Scheduled " + action + " step is " + result + ".");
  }
  throw new UserFacingError("Unknown /week subcommand.");
}

async function handleRolesCommand(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response> {
  requireAdmin(interaction);
  const guildId = requireGuild(interaction);
  const invocation = parseCommand(interaction);
  if (invocation.subcommand !== "sync") throw new UserFacingError("Unknown /roles subcommand.");
  const report = await services(env).roles.sync(
    guildId,
    booleanOption(invocation, "dry_run") ?? false,
  );
  return ephemeral(formatRoleReport(report));
}

async function handleReminderCommand(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response> {
  requireAdmin(interaction);
  const guildId = requireGuild(interaction);
  const invocation = parseCommand(interaction);
  const { repository, discord, reminders } = services(env);
  const config = await repository.getGuildConfig(guildId);
  if (!config) throw new UserFacingError("Run /guild setup first.");

  if (invocation.subcommand === "configure") {
    const channelId =
      stringOption(invocation, "channel") ??
      config.reminderChannelId ??
      config.eventChannelId;
    if (!channelId) throw new UserFacingError("Choose a reminder channel.");
    const roleId =
      stringOption(invocation, "role") ?? config.reminderRoleId ?? undefined;
    const template =
      stringOption(invocation, "message") ??
      "Please respond before signups close. We have {players} players and {gms} GMs.";
    const minutesBeforeLock =
      (numberOption(invocation, "hours_before") ?? 48) * 60;
    const enabled = booleanOption(invocation, "enabled");
    if (enabled === undefined) throw new UserFacingError("enabled is required.");
    const channel = await discord.getChannel(channelId);
    if (channel.guild_id && channel.guild_id !== guildId) {
      throw new UserFacingError("The reminder channel belongs to a different server.");
    }
    if (![0, 5].includes(channel.type)) {
      throw new UserFacingError(
        "The reminder destination must be a normal text or announcement channel.",
      );
    }
    if (roleId) {
      const role = (await discord.getGuildRoles(guildId)).find(
        (candidate) => candidate.id === roleId,
      );
      if (!role) {
        throw new UserFacingError("The reminder role no longer exists in this server.");
      }
      if (!role.mentionable) {
        throw new UserFacingError(
          "The reminder role is not mentionable. Enable “Allow anyone to @mention this role”, then retry.",
        );
      }
    }
    const roleMemberCounts =
      roleId || config.adminRoleId
        ? await discord.getGuildRoleMemberCounts(guildId)
        : {};
    const audienceCount = roleId ? roleMemberCounts[roleId] ?? 0 : null;
    const escalationCount = config.adminRoleId
      ? roleMemberCounts[config.adminRoleId] ?? 0
      : null;
    const rule = await reminders.configurePreLockRule({
      guildId,
      channelId,
      roleId,
      template,
      minutesBeforeLock,
      enabled,
    });
    await repository.saveGuildConfig({
      guildId,
      reminderChannelId: channelId,
      reminderRoleId: roleId,
    });
    const event = await repository.getCurrentWeeklyEvent(guildId);
    const counts = event
      ? await repository.countActiveSignups(event.eventId)
      : { gms: 0, players: 0 };
    const capacity = reminderCapacitySummary(counts, config.tableMaxSize);
    const rendered = renderReminderTemplate(rule.messageTemplate, {
      event: event?.title ?? "Next weekly game",
      when: event ? discordTimestamp(event.startsAt, "F") : "not scheduled yet",
      players: counts.players,
      gms: counts.gms,
      openSeats: capacity.openSeats,
    });
    return ephemeral(
      (rule.enabled ? "✅ Reminder enabled." : "⏸️ Reminder disabled.") +
        "\n**Channel:** <#" +
        channelId +
        ">\n**Role:** " +
        (roleId ? "<@&" + roleId + ">" : "no role ping") +
        "\n**Audience:** " +
        (audienceCount === null
          ? "channel subscribers (Discord does not expose a channel audience count)"
          : audienceCount + " current role member" + (audienceCount === 1 ? "" : "s")) +
        "\n**Capacity escalation:** " +
        (config.adminRoleId
          ? "<@&" +
            config.adminRoleId +
            "> (" +
            escalationCount +
            " organizer" +
            (escalationCount === 1 ? "" : "s") +
            "), pinged only when projected seats are insufficient"
          : "not configured") +
        "\n**Timing:** " +
        rule.offsetMinutes +
        " minutes before signup lock\n**Rendered preview:**\n" +
        rendered +
        "\n" +
        capacity.summary,
    );
  }

  if (invocation.subcommand === "send") {
    const event = await repository.getCurrentWeeklyEvent(guildId);
    if (!event) throw new UserFacingError("There is no active week.");
    const explicitResend = booleanOption(invocation, "resend") ?? false;
    if (explicitResend && booleanOption(invocation, "confirm") !== true) {
      throw new UserFacingError(
        "A resend creates a new notification. Set confirm to True to continue.",
      );
    }
    const result = await reminders.sendManualReminder({
      event,
      explicitResend,
    });
    return ephemeral(
      result.status === "sent"
        ? "✅ Reminder sent."
        : "Reminder was " + result.status + (result.reason ? ": " + result.reason : "."),
    );
  }
  throw new UserFacingError("Unknown /reminder subcommand.");
}

async function handleComponent(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response> {
  const component = parseComponentId(interaction.data?.custom_id);
  if (!component) throw new UserFacingError("This control is no longer recognized.");
  const guildId = requireGuild(interaction);
  const userId = invokingUserId(interaction);
  if (!userId) throw new UserFacingError("Discord did not identify the member.");
  const { week } = services(env);

  if (component.kind === "signup") {
    const result = await week.changeSignup({
      guildId,
      eventId: component.eventId,
      userId,
      displayName: invokingDisplayName(interaction),
      action: component.action,
    });
    await week.refreshSignupPosts(result.event);
    return ephemeral("✅ " + result.message);
  }

  return handleM6Component(interaction, env, component);
}

async function executeDiscordInteraction(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response> {
  try {
    if (interaction.type === InteractionType.MessageComponent) {
      return await handleComponent(interaction, env);
    }
    if (interaction.type !== InteractionType.ApplicationCommand) {
      return ephemeral("I don't recognize that interaction.");
    }
    const command = interaction.data?.name;
    if (command === "ping") {
      return ephemeral(
        "🎲 Pong! The guild assistant is awake, " + invokingDisplayName(interaction) + ".",
      );
    }
    if (command === "help") return ephemeral(helpContent(interaction));
    if (command === "guild") return handleGuildCommand(interaction, env);
    if (command === "week") return handleWeekCommand(interaction, env);
    if (command === "roles") return handleRolesCommand(interaction, env);
    if (command === "reminder") return handleReminderCommand(interaction, env);
    const m6Response = await handleM6Command(interaction, env);
    if (m6Response !== null) return m6Response;
    return ephemeral("I don't recognize that command yet.");
  } catch (error) {
    if (error instanceof UserFacingError || error instanceof ReminderConfigurationError) {
      return ephemeral("⚠️ " + error.message);
    }
    console.error(
      JSON.stringify({
        kind: "guild-assistant.interaction-error",
        interactionId: interaction.id,
        command: interaction.data?.name,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return ephemeral(
      "⚠️ The assistant could not complete that action. An administrator can run /guild doctor and check Worker logs.",
    );
  }
}

async function finishDeferredInteraction(
  interaction: DiscordInteraction,
  env: Env,
): Promise<void> {
  const applicationId = interaction.application_id ?? env.DISCORD_APPLICATION_ID;
  const token = interaction.token;
  if (!token) return;
  const discord = new DiscordRestClient(env.DISCORD_BOT_TOKEN);
  const response = await executeDiscordInteraction(interaction, env);
  const body = (await response.json()) as {
    type?: number;
    data?: Record<string, unknown>;
    attachment?: InternalAttachmentResponse;
  };
  if (interaction.type === InteractionType.ApplicationCommand) {
    const { flags: _initialOnlyFlags, ...messageData } = body.data ?? {
      content: "The command completed without a response body.",
    };
    if (body.attachment) {
      const { audit: _audit, ...file } = body.attachment;
      try {
        await discord.editOriginalInteractionResponseWithFile(
          applicationId,
          token,
          messageData as DiscordMessagePayload,
          file,
        );
        await recordAttachmentDelivery(env, body.attachment, "succeeded");
      } catch (error) {
        await recordAttachmentDelivery(env, body.attachment, "failed", error);
        console.error(
          JSON.stringify({
            kind: "guild-assistant.attachment-delivery-error",
            interactionId: interaction.id,
            eventId: body.attachment.audit?.eventId,
            errorKind: error instanceof Error ? error.name : typeof error,
          }),
        );
        await discord.editOriginalInteractionResponse(applicationId, token, {
          content:
            "⚠️ The roster was generated, but Discord did not receive the file. Check Attach Files and run /week export again.",
          allowed_mentions: safeAllowedMentions(),
        });
      }
    } else {
      await discord.editOriginalInteractionResponse(
        applicationId,
        token,
        messageData as DiscordMessagePayload,
      );
    }
    return;
  }
  if (body.type === InteractionResponseType.ChannelMessageWithSource && body.data) {
    await discord.createInteractionFollowup(applicationId, token, {
      ...body.data,
      flags: MessageFlags.Ephemeral,
      allowed_mentions: safeAllowedMentions(),
    } as never);
  }
}

export async function handleDiscordInteraction(
  interaction: DiscordInteraction,
  env: Env,
  context?: ExecutionContext,
): Promise<Response> {
  const canDefer =
    context !== undefined &&
    Boolean(interaction.token) &&
    interaction.type !== InteractionType.Ping &&
    !(
      interaction.type === InteractionType.ApplicationCommand &&
      interaction.data?.name === "ping"
    );
  if (!canDefer) return executeDiscordInteraction(interaction, env);

  context.waitUntil(
    finishDeferredInteraction(interaction, env).catch((error) => {
      console.error(
        JSON.stringify({
          kind: "guild-assistant.deferred-error",
          interactionId: interaction.id,
          command: interaction.data?.name,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }),
  );
  return Response.json(
    interaction.type === InteractionType.MessageComponent
      ? { type: InteractionResponseType.DeferredUpdateMessage }
      : {
          type: InteractionResponseType.DeferredChannelMessageWithSource,
          data: { flags: MessageFlags.Ephemeral },
        },
  );
}

export async function handleScheduled(env: Env, now = Date.now()): Promise<void> {
  const { repository, discord, week, roles, reminders } = services(env);
  const rosterNotifications = new RosterNotificationService(repository, discord);
  await runScheduledTick(
    repository,
    {
      openEvent: (event) => week.openExistingEvent(event),
      openPlayerSignups: (event) => week.openPlayerSignups(event),
      lockAndPlanEvent: async (event) => {
        await week.lockWeek(event.guildId, undefined, event.eventId);
        await week.generatePlan(event.guildId, undefined, event.eventId);
      },
      publishEvent: async (event) => {
        const published = await week.publishPlan(
          event.guildId, undefined, true, event.eventId,
        );
        await reconcilePriorityAfterPublish(
          env, event.eventId, published.bundle.plan.planId,
        );
      },
      openSeating: (event) => week.openSeating(event),
      syncRoles: async (event) => {
        requireSuccessfulRoleReconciliation(await roles.sync(event.guildId));
      },
      finalizeEvent: async (event) => {
        await settlePriorityForEvent(env, event);
        await week.finalizeTables(event.guildId, event.eventId);
      },
      archiveEvent: async (event) => {
        await settlePriorityForEvent(env, event);
        await week.archiveWeek(event.guildId, undefined, event.eventId);
        const config = await repository.getGuildConfig(event.guildId);
        if (config?.roleSyncEnabled) {
          requireSuccessfulRoleReconciliation(await roles.sync(event.guildId));
        }
      },
      enqueueEventReminders: async (event) => {
        await reminders.enqueuePreLockReminder(event);
      },
      deliverReminder: async (delivery) => {
        await reminders.deliverReminder(delivery);
      },
    },
    now,
  );
  await Promise.all([
    rosterNotifications.deliverDue(now),
    runM6Scheduled(env, now),
  ]);
}
