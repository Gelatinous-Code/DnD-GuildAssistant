import {
  DiscordRestClient,
  discordTimestamp,
  safeAllowedMentions,
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
  updateMessage,
  UserFacingError,
} from "./interaction-utils";
import {
  diagnoseChannelPermissions,
  diagnoseInteractionPermissions,
  effectiveChannelPermissions,
  renderReminderTemplate,
  validateGuildSchedule,
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
  RoleService,
} from "./role-service";
import { runScheduledTick, schedulerOperationKey } from "./scheduler";
import {
  GuildRepository,
  type WeeklyEvent,
} from "./storage/repository";
import { WeekService } from "./week-service";

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

type RecoverableSchedulerAction = "open" | "lock-plan" | "archive";

async function runSchedulerRecovery(
  repository: GuildRepository,
  event: WeeklyEvent,
  action: RecoverableSchedulerAction,
  actorUserId: string | undefined,
  work: () => Promise<void>,
): Promise<"completed" | "already-completed"> {
  const operationKey = schedulerOperationKey(action, event.eventId);
  const claim = await repository.beginOperation({
    operationKey,
    guildId: event.guildId,
    eventId: event.eventId,
    operationKind: "scheduler-" + action,
    request: { action, source: "admin-retry" },
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
): Promise<"skipped" | "already-completed"> {
  const operationKey = schedulerOperationKey(action, event.eventId);
  const claim = await repository.beginOperation({
    operationKey,
    guildId: event.guildId,
    eventId: event.eventId,
    operationKind: "scheduler-" + action,
    request: { action, source: "admin-skip" },
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

function setupSummary(config: {
  eventChannelId: string | null;
  gmRoleId: string | null;
  adminRoleId: string | null;
  reminderRoleId: string | null;
  timezone: string;
  weeklyDay: number;
  weeklyTime: string;
  tableMinSize: number;
  tablePreferredSize: number;
  tableMaxSize: number;
  schedulingEnabled: boolean;
  roleSyncEnabled: boolean;
}): string {
  return [
    "✅ Guild configuration saved.",
    "**Channel:** " + (config.eventChannelId ? "<#" + config.eventChannelId + ">" : "missing"),
    "**Weekly GM role:** " + (config.gmRoleId ? "<@&" + config.gmRoleId + ">" : "missing"),
    "**Organizer escalation role:** " +
      (config.adminRoleId ? "<@&" + config.adminRoleId + ">" : "not set"),
    "**Reminder role:** " +
      (config.reminderRoleId ? "<@&" + config.reminderRoleId + ">" : "not set"),
    "**Schedule:** ISO weekday " +
      config.weeklyDay +
      " at " +
      config.weeklyTime +
      " (" +
      config.timezone +
      ")",
    "**Table sizes:** " +
      config.tableMinSize +
      " / " +
      config.tablePreferredSize +
      " / " +
      config.tableMaxSize,
    "**Automation:** scheduling " +
      (config.schedulingEnabled ? "on" : "paused") +
      ", GM role sync " +
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
  const { repository, discord, week, roles } = services(env);

  if (invocation.subcommand === "setup") {
    const current = await repository.getGuildConfig(guildId);
    const channelId = stringOption(invocation, "channel");
    const gmRoleId = stringOption(invocation, "gm_role");
    if (!channelId || !gmRoleId) {
      throw new UserFacingError("channel and gm_role are required.");
    }
    const channel = await discord.getChannel(channelId);
    if (channel.guild_id && channel.guild_id !== guildId) {
      throw new UserFacingError("The selected channel belongs to a different server.");
    }
    if (![0, 5].includes(channel.type)) {
      throw new UserFacingError(
        "Choose a normal text or announcement channel for the MVP workflow.",
      );
    }
    const timezone = stringOption(invocation, "timezone") ?? current?.timezone ?? "America/Denver";
    const weeklyDay = numberOption(invocation, "weekday") ?? current?.weeklyDay ?? 6;
    const weeklyTime = stringOption(invocation, "time") ?? current?.weeklyTime ?? "18:30";
    const tableMinSize = numberOption(invocation, "minimum") ?? current?.tableMinSize ?? 4;
    const tablePreferredSize =
      numberOption(invocation, "preferred") ?? current?.tablePreferredSize ?? 6;
    const tableMaxSize = numberOption(invocation, "maximum") ?? current?.tableMaxSize ?? 6;
    const signupOpenLeadDays =
      numberOption(invocation, "signup_lead_days") ?? current?.signupOpenLeadDays ?? 7;
    const signupLockLeadHours =
      numberOption(invocation, "lock_lead_hours") ?? current?.signupLockLeadHours ?? 24;
    const schedulingEnabled =
      booleanOption(invocation, "scheduling_enabled") ??
      current?.schedulingEnabled ??
      false;
    const roleSyncEnabled =
      booleanOption(invocation, "role_sync_enabled") ??
      current?.roleSyncEnabled ??
      false;
    const errors = [
      ...validateGuildSchedule({
        timezone,
        weeklyDay,
        weeklyTime,
        signupOpenLeadDays,
        signupLockLeadHours,
      }),
      ...validateTablePolicy({
        minimum: tableMinSize,
        preferred: tablePreferredSize,
        maximum: tableMaxSize,
      }),
    ];
    if (errors.length) {
      throw new UserFacingError("Configuration was not saved:\n• " + errors.join("\n• "));
    }

    const config = await repository.saveGuildConfig({
      guildId,
      eventChannelId: channelId,
      tableChannelId: channelId,
      reminderChannelId: channelId,
      gmRoleId,
      adminRoleId: stringOption(invocation, "admin_role"),
      reminderRoleId: stringOption(invocation, "reminder_role"),
      timezone,
      weeklyDay,
      weeklyTime,
      signupOpenLeadDays,
      signupLockLeadHours,
      tableMinSize,
      tablePreferredSize,
      tableMaxSize,
      schedulingEnabled,
      roleSyncEnabled,
    });
    const permissionChecks = diagnoseInteractionPermissions(interaction.app_permissions, {
      roleSyncEnabled: config.roleSyncEnabled,
    });
    const roleChecks = await roles.diagnose(guildId);
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
      ...roleChecks.items
        .filter((check) => check.status !== "pass")
        .map(
          (check) =>
            (check.status === "fail" && config.roleSyncEnabled ? "❌ " : "⚠️ ") +
            check.title +
            ": " +
            (check.remediation ?? check.detail),
        ),
    ];
    return ephemeral(
      setupSummary(config) +
        (problems.length ? "\n\n**Setup checks:**\n" + problems.join("\n") : "\n\n✅ Setup checks passed."),
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
      config.reminderChannelId,
    ].filter((value): value is string => Boolean(value));
    const [guildRoles, botMember, roleReport] = await Promise.all([
      discord.getGuildRoles(guildId),
      discord.getCurrentBotGuildMember(guildId),
      roles.diagnose(guildId),
    ]);
    const channelResults = await Promise.all(
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
          return [
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
          ].join("\n");
        } catch {
          return "❌ Channel " + channelId + " is missing or invisible. Select it again in /guild setup.";
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
      if (!roleId) return ["⚠️ **" + label + "** — not configured."];
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
    const displayedRoleReport = config.roleSyncEnabled
      ? roleReport
      : {
          ...roleReport,
          ready: true,
          items: roleReport.items.map((item) => ({
            ...item,
            status: item.status === "fail" ? ("warn" as const) : item.status,
            remediation:
              item.status === "fail"
                ? "Role sync is paused; complete this fix before enabling it. " +
                  (item.remediation ?? "")
                : item.remediation,
          })),
        };
    return ephemeral(
      [
        formatRoleDiagnostics(displayedRoleReport),
        "",
        "**Configured resources**",
        ...channelResults,
        "",
        "**Notification roles**",
        ...notificationRoleResults,
        "",
        "**Permissions in this command channel**",
        ...permissionResults,
      ].join("\n"),
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
    return ephemeral(
      "✅ Corrected <@" + userId + "> to **" + action + "**." +
        (result.warning ? "\n⚠️ " + result.warning : ""),
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
    let roleText = "";
    try {
      roleText = "\n" + formatRoleReport(await roles.sync(guildId));
    } catch (error) {
      roleText =
        "\n⚠️ Tables published, but GM role sync needs repair: " +
        (error instanceof Error ? error.message : String(error));
    }
    return ephemeral(
      "✅ Published " +
        result.bundle.tables.length +
        " tables." +
        (result.links.length ? "\n" + result.links.join("\n") : "") +
        roleText,
    );
  }
  if (invocation.subcommand === "archive") {
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
    const event = await week.cancelWeek(guildId, actorUserId, reason);
    let roleText = "⚠️ GM role sync is paused; no Discord roles were changed.";
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
      const result = await week.retryPublish(guildId, actorUserId);
      return ephemeral("✅ Publication retry completed for " + result.bundle.tables.length + " tables.");
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
      return ephemeral(formatRoleReport(await roles.sync(guildId)));
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
          : step === "archive"
            ? "archive"
            : null;
    if (!action) throw new UserFacingError("Choose a valid scheduled step.");
    const result = await skipSchedulerStep(
      repository,
      event,
      action,
      actorUserId,
      reason,
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
  const { discord, week } = services(env);

  if (component.kind === "signup") {
    const result = await week.changeSignup({
      guildId,
      eventId: component.eventId,
      userId,
      displayName: invokingDisplayName(interaction),
      action: component.action,
    });
    if (result.event.signupChannelId && result.event.signupMessageId) {
      await discord.editChannelMessage(
        result.event.signupChannelId,
        result.event.signupMessageId,
        result.payload,
      );
    }
    return updateMessage({ ...result.payload });
  }

  const result = await week.selectTable({
    guildId,
    planId: component.planId,
    tableId: component.tableId,
    userId,
    action: component.action,
  });
  return updateMessage({ ...result.payload });
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
    if (command === "guild") return handleGuildCommand(interaction, env);
    if (command === "week") return handleWeekCommand(interaction, env);
    if (command === "roles") return handleRolesCommand(interaction, env);
    if (command === "reminder") return handleReminderCommand(interaction, env);
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
  };
  if (interaction.type === InteractionType.ApplicationCommand) {
    const { flags: _initialOnlyFlags, ...messageData } = body.data ?? {
      content: "The command completed without a response body.",
    };
    await discord.editOriginalInteractionResponse(
      applicationId,
      token,
      messageData as never,
    );
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
  const { repository, week, roles, reminders } = services(env);
  await runScheduledTick(
    repository,
    {
      openEvent: (event) => week.openExistingEvent(event),
      lockAndPlanEvent: async (event) => {
        await week.lockWeek(event.guildId, undefined, event.eventId);
        await week.generatePlan(event.guildId, undefined, event.eventId);
      },
      archiveEvent: async (event) => {
        await week.archiveWeek(event.guildId, undefined, event.eventId);
        const config = await repository.getGuildConfig(event.guildId);
        if (config?.roleSyncEnabled) await roles.sync(event.guildId);
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
}
