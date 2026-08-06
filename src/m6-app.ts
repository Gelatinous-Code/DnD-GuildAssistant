import {
  ButtonStyle,
  ComponentType,
  DiscordRestClient,
  safeAllowedMentions,
  type DiscordMessagePayload,
} from "./discord-api";
import type { DiscordInteraction } from "./discord";
import {
  booleanOption,
  ephemeral,
  invokingUserId,
  isGuildAdmin,
  numberOption,
  parseCommand,
  requireGuild,
  stringOption,
  type GuildComponent,
  UserFacingError,
} from "./interaction-utils";
import { PriorityDiagnosticsService } from "./priority-diagnostics";
import { runPriorityNotificationMaintenance } from "./priority-maintenance";
import { PriorityNotificationService } from "./priority-notification-service";
import { reconcilePublishedPlanPriority } from "./priority-publish-reconciler";
import { PriorityRewardCoordinator } from "./priority-reward-coordinator";
import { PriorityService } from "./priority-service";
import { ProgressionService } from "./progression-service";
import {
  renderPriorityConfirmation,
  renderPriorityStatus,
  renderPriorityUseOutcome,
} from "./priority-ui";
import { PriorityWorkflowService } from "./priority-workflow-service";
import { SessionService, SessionSourceUnavailableError } from "./session-service";
import { SessionSummaryService } from "./session-summary-service";
import { TableThreadService } from "./table-thread-service";
import { PriorityConfirmationRepository } from "./storage/priority-confirmation-repository";
import { PriorityNotificationRepository } from "./storage/priority-notification-repository";
import { PriorityRepository } from "./storage/priority-repository";
import {
  PrioritySeatingRepository,
} from "./storage/priority-seating-repository";
import { GuildRepository, type WeeklyEvent } from "./storage/repository";
import { SessionRepository } from "./storage/session-repository";
import { SessionRecapOperationsRepository } from "./storage/session-recap-operations-repository";
import { SessionSummaryRepository } from "./storage/session-summary-repository";
import { TableThreadRepository } from "./storage/table-thread-repository";
import { CharacterRepository } from "./storage/character-repository";
import { ProgressionRepository } from "./storage/progression-repository";
import { WebsiteReadRepository } from "./storage/website-read-repository";
import { WeekService } from "./week-service";

export interface M6Services {
  repository: GuildRepository;
  discord: DiscordRestClient;
  week: WeekService;
  priorityRepository: PriorityRepository;
  priority: PriorityService;
  priorityRewards: PriorityRewardCoordinator;
  seating: PrioritySeatingRepository;
  notifications: PriorityNotificationService;
  workflow: PriorityWorkflowService;
  sessionRepository: SessionRepository;
  progression: ProgressionService;
  sessions: SessionService;
}

export function createM6Services(env: Env): M6Services {
  const repository = new GuildRepository(env.DB);
  const discord = new DiscordRestClient(env.DISCORD_BOT_TOKEN);
  const week = new WeekService(repository, discord);
  const priorityRepository = new PriorityRepository(env.DB);
  const priority = new PriorityService(priorityRepository);
  const seating = new PrioritySeatingRepository(env.DB);
  const notificationRepository = new PriorityNotificationRepository(env.DB);
  const notifications = new PriorityNotificationService(notificationRepository, discord);
  const priorityRewards = new PriorityRewardCoordinator(env.DB, priority, seating, {
    afterLedgerMutation: async () => {
      await notifications.repairLifecycleNotifications(50);
      await notifications.repairExpiryReminders(50);
    },
    afterSeatingRepair: async ({ eventId, planId }) => {
      await notifications.repairSeatingNotifications(50);
      const [event, bundle] = await Promise.all([
        repository.getWeeklyEvent(eventId),
        repository.getPlanBundle(planId),
      ]);
      if (event && bundle?.plan.status === "published") {
        await week.refreshPublishedTables(
          event,
          bundle,
          event.status !== "published" || Date.now() >= event.tableSelectionClosesAt,
        );
      }
    },
  });
  const sessionRepository = new SessionRepository(env.DB);
  const progression = new ProgressionService(
    new ProgressionRepository(env.DB),
    new CharacterRepository(env.DB),
  );
  return {
    repository,
    discord,
    week,
    priorityRepository,
    priority,
    priorityRewards,
    seating,
    notifications,
    workflow: new PriorityWorkflowService(repository, seating, week, { notifications }),
    sessionRepository,
    progression,
    sessions: new SessionService(sessionRepository, priorityRepository, priorityRewards, {
      progression,
    }),
  };
}

function requireAdmin(interaction: DiscordInteraction): void {
  if (!isGuildAdmin(interaction)) {
    throw new UserFacingError(
      "This command requires the Discord Manage Server permission.",
    );
  }
}

function requireMember(interaction: DiscordInteraction): string {
  const userId = invokingUserId(interaction);
  if (!userId) throw new UserFacingError("Discord did not identify the member.");
  return userId;
}

function priorityConfirmationId(previewId: string): string {
  const value = ["guild", "priority", "confirm", previewId].join(":");
  if (value.length > 100) throw new Error("Priority component ID exceeds Discord's limit");
  return value;
}

function confirmationPayload(
  content: string,
  previewId: string,
): DiscordMessagePayload {
  return {
    content,
    allowed_mentions: safeAllowedMentions(),
    components: [
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.Button,
            style: ButtonStyle.Success,
            label: "Confirm priority",
            custom_id: priorityConfirmationId(previewId),
          },
        ],
      },
    ],
  };
}

async function latestArchivedEventId(
  env: Env,
  guildId: string,
  explicitEventId?: string,
): Promise<string> {
  if (explicitEventId) return explicitEventId;
  const row = await env.DB
    .prepare(
      `SELECT event_id FROM weekly_events
       WHERE guild_id = ? AND status = 'archived'
       ORDER BY COALESCE(archived_at, updated_at) DESC, starts_at DESC
       LIMIT 1`,
    )
    .bind(guildId)
    .first<{ event_id: string }>();
  if (!row) throw new UserFacingError("There is no archived week to confirm yet.");
  return row.event_id;
}

function sessionStatusText(
  status: Awaited<ReturnType<SessionService["status"]>>,
): string {
  const revision = status.currentRevision;
  const lines = [
    "## Session completion",
    `**Table:** ${status.source.tableNumber}`,
    `**Source:** event \`${status.source.eventId}\`, plan \`${status.source.planId}\``,
    `**Attendance state:** ${status.view}`,
    `**Result:** ${revision?.result ?? "not confirmed"}`,
    `**Reward sync:** ${status.session?.rewardSyncStatus ?? "not started"}`,
  ];
  if (revision) {
    lines.push(
      `**Revision:** ${revision.revisionNumber} (\`${revision.completionRevisionId}\`)`,
      `**Actual DM:** ${revision.actualDmUserId ? `<@${revision.actualDmUserId}>` : "none"}`,
    );
  }
  if (status.participants.length) {
    lines.push(
      "",
      "**Actual attendance**",
      ...status.participants.map(
        (participant) =>
          `- <@${participant.userId}> — ${participant.role}, ${participant.outcome}` +
          (participant.replacesUserId ? `; replaces <@${participant.replacesUserId}>` : ""),
      ),
    );
  } else {
    lines.push("No attendance deviations or confirmed snapshot exist yet.");
  }
  return lines.join("\n").slice(0, 1_950);
}

async function handleSessionCommand(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response> {
  requireAdmin(interaction);
  const guildId = requireGuild(interaction);
  const actorUserId = requireMember(interaction);
  const invocation = parseCommand(interaction);
  const tableNumber = numberOption(invocation, "table_number");
  if (tableNumber === undefined) throw new UserFacingError("table_number is required.");
  const eventId = await latestArchivedEventId(
    env,
    guildId,
    stringOption(invocation, "event_id"),
  );
  const { sessions } = createM6Services(env);

  if (invocation.subcommand === "status") {
    return ephemeral(sessionStatusText(await sessions.status(guildId, eventId, tableNumber)));
  }
  if (invocation.subcommand === "attendance") {
    const userId = stringOption(invocation, "member");
    const role = stringOption(invocation, "role");
    const outcome = stringOption(invocation, "outcome");
    if (!userId || (role !== "dm" && role !== "player")) {
      throw new UserFacingError("member and a valid role are required.");
    }
    if (
      outcome !== "attended" &&
      outcome !== "no_show" &&
      outcome !== "substitute" &&
      outcome !== "walk_in"
    ) {
      throw new UserFacingError("Choose a valid attendance outcome.");
    }
    const status = await sessions.recordAttendance({
      guildId,
      eventId,
      tableNumber,
      userId,
      role,
      outcome,
      replacesUserId: stringOption(invocation, "replaces") ?? null,
      recordedByUserId: actorUserId,
      reason: stringOption(invocation, "reason") ?? null,
      idempotencyKey: interaction.id ?? crypto.randomUUID(),
    });
    return ephemeral("✅ Attendance draft updated.\n\n" + sessionStatusText(status));
  }
  if (invocation.subcommand === "confirm") {
    if (booleanOption(invocation, "confirm") !== true) {
      throw new UserFacingError("Set confirm to True to freeze the session outcome.");
    }
    const result = stringOption(invocation, "result");
    if (result !== "completed" && result !== "cancelled") {
      throw new UserFacingError("Choose Completed or Cancelled.");
    }
    const requestedDm = stringOption(invocation, "dm");
    if (requestedDm) {
      const current = await sessions.status(guildId, eventId, tableNumber);
      if (requestedDm !== current.source.plannedDmUserId) {
        const reason = stringOption(invocation, "reason") ??
          "Organizer recorded a replacement DM at confirmation";
        await sessions.recordAttendance({
          guildId,
          eventId,
          tableNumber,
          userId: current.source.plannedDmUserId,
          role: "dm",
          outcome: "no_show",
          recordedByUserId: actorUserId,
          reason,
          idempotencyKey: interaction.id + ":planned-dm",
        });
        await sessions.recordAttendance({
          guildId,
          eventId,
          tableNumber,
          userId: requestedDm,
          role: "dm",
          outcome: "substitute",
          replacesUserId: current.source.plannedDmUserId,
          recordedByUserId: actorUserId,
          reason,
          idempotencyKey: interaction.id + ":replacement-dm",
        });
      }
    }
    const confirmed = await sessions.confirmSession({
      guildId,
      eventId,
      tableNumber,
      result,
      confirmedByUserId: actorUserId,
      reason: stringOption(invocation, "reason") ?? null,
      idempotencyKey: interaction.id ?? crypto.randomUUID(),
    });
    return ephemeral(
      `${confirmed.replayed ? "↩️ Existing" : "✅ New"} session revision ` +
        `${confirmed.revision.revisionNumber} confirmed. ` +
        (confirmed.reward.status === "synced"
          ? confirmed.revision.actualDmUserId
            ? "The eligible DM reward is synchronized exactly once."
            : "No DM reward was due."
          : "The outcome is saved; reward reconciliation will retry safely."),
    );
  }
  throw new UserFacingError("Unknown /session subcommand.");
}

async function priorityPreviewResponse(
  env: Env,
  guildId: string,
  userId: string,
  planId: string,
  tableId: string,
): Promise<Response> {
  const { repository, priority, workflow } = createM6Services(env);
  const context = await workflow.previewPriority({ guildId, userId, planId, tableId });
  const config = await repository.getGuildConfig(guildId);
  if (!config) throw new UserFacingError("Run /guild setup first.");
  const availableCredits = await priority.listAvailableCredits(guildId, userId);
  const eligibleCredits = availableCredits.filter(
    (credit) => context.event.startsAt < credit.expiresAt,
  );
  const first = eligibleCredits[0];
  if (!first) {
    throw new UserFacingError("You do not have an available token valid for this game.");
  }
  const now = Date.now();
  const previewId = crypto.randomUUID();
  const expiresAt = Math.min(
    now + 10 * 60 * 1_000,
    context.event.tableSelectionClosesAt,
    first.expiresAt,
  );
  if (expiresAt <= now) {
    throw new UserFacingError("This token or table-selection window just expired.");
  }
  await new PriorityConfirmationRepository(env.DB).create({
    previewId,
    guildId,
    userId,
    eventId: context.event.eventId,
    planId,
    tableId,
    assignmentId: context.assignment.assignmentId,
    assignmentVersion: context.assignment.seatRequestVersion,
    tableStateVersion: context.event.tableStateVersion,
    creditId: first.creditId,
    tableWasFull: context.tableIsFull,
    expiresAt,
    createdAt: now,
  });
  const payload = confirmationPayload(
    renderPriorityConfirmation({
      eventTitle: context.event.title,
      tableTitle: context.table.title,
      balance: availableCredits.length,
      creditExpiresAt: first.expiresAt,
      timeZone: config.timezone,
      tableIsFull: context.tableIsFull,
    }),
    previewId,
  );
  return ephemeral(payload.content ?? "Confirm priority", {
    components: payload.components,
  });
}

async function priorityConfirmResponse(
  env: Env,
  guildId: string,
  userId: string,
  previewId: string,
): Promise<Response> {
  const { repository, priority, workflow } = createM6Services(env);
  const previews = new PriorityConfirmationRepository(env.DB);
  const preview = await previews.get(guildId, previewId, userId);
  const now = Date.now();
  if (preview && preview.usedAt !== null) {
    return ephemeral(
      "✅ This priority confirmation was already completed. No additional token was reserved.",
    );
  }
  if (!preview || preview.expiresAt <= now) {
    throw new UserFacingError(
      "This private confirmation preview expired. Run `/priority use` or use the latest table card again.",
    );
  }
  const result = await workflow.select({
    guildId,
    userId,
    planId: preview.planId,
    tableId: preview.tableId,
    usePriority: true,
    confirmation: {
      previewId,
      expectedAssignmentId: preview.assignmentId,
      expectedSeatRequestVersion: preview.assignmentVersion,
      expectedTableStateVersion: preview.tableStateVersion,
      expectedCreditId: preview.creditId,
    },
  });
  const markedUsed = await previews.markUsed(guildId, previewId, userId, now);
  if (!markedUsed) {
    return ephemeral(
      "✅ This priority confirmation was already completed. No additional token was reserved.",
    );
  }
  const config = await repository.getGuildConfig(guildId);
  if (!config) throw new UserFacingError("Run /guild setup first.");
  const remaining = await priority.listAvailableCredits(guildId, userId);
  return ephemeral(
    renderPriorityUseOutcome({
      tableTitle: result.table.title,
      assigned: result.assignment.status === "assigned",
      waitlistPosition: result.assignment.waitlistPosition,
      displaced: result.mutation.displaced.length > 0,
      remainingCredits: remaining,
      timeZone: config.timezone,
    }),
  );
}

async function currentPriorityContext(
  services: M6Services,
  guildId: string,
  userId: string,
): Promise<{ event: WeeklyEvent; planId: string; tableId: string }> {
  const event = await services.repository.getCurrentPublishedEvent(guildId);
  if (!event) throw new UserFacingError("There is no published week.");
  const plan = await services.repository.getCurrentPlan(event.eventId);
  if (!plan || plan.status !== "published") {
    throw new UserFacingError("The current week has no published plan.");
  }
  const assignment = await services.seating.getAssignment(guildId, plan.planId, userId);
  const tableId = assignment?.desiredTableId ?? assignment?.tableId;
  if (!assignment || !tableId) {
    throw new UserFacingError("You do not have a current table request.");
  }
  return { event, planId: plan.planId, tableId };
}

async function handlePriorityCommand(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response> {
  const guildId = requireGuild(interaction);
  const userId = requireMember(interaction);
  const invocation = parseCommand(interaction);
  const services = createM6Services(env);
  const config = await services.repository.getGuildConfig(guildId);
  if (!config) throw new UserFacingError("Run /guild setup first.");

  if (invocation.subcommand === "status") {
    return ephemeral(
      renderPriorityStatus(
        await services.priority.listAvailableCredits(guildId, userId),
        config.timezone,
      ),
    );
  }
  if (invocation.subcommand === "use") {
    const tableNumber = numberOption(invocation, "table_number");
    if (tableNumber === undefined) throw new UserFacingError("table_number is required.");
    const context = await services.workflow.findCurrentTable(guildId, userId, tableNumber);
    return priorityPreviewResponse(
      env,
      guildId,
      userId,
      context.bundle.plan.planId,
      context.table.tableId,
    );
  }
  if (invocation.subcommand === "release") {
    if (booleanOption(invocation, "confirm") !== true) {
      throw new UserFacingError("Set confirm to True to release priority.");
    }
    const current = await currentPriorityContext(services, guildId, userId);
    const result = await services.workflow.releasePriority({
      guildId,
      userId,
      planId: current.planId,
      tableId: current.tableId,
    });
    return ephemeral("✅ " + result.message);
  }
  throw new UserFacingError("Unknown /priority subcommand.");
}

async function handlePriorityAdminCommand(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response> {
  requireAdmin(interaction);
  const guildId = requireGuild(interaction);
  const actorUserId = requireMember(interaction);
  const invocation = parseCommand(interaction);
  const services = createM6Services(env);

  if (invocation.subcommand === "correct") {
    if (booleanOption(invocation, "confirm") !== true) {
      throw new UserFacingError("Set confirm to True to append the correction.");
    }
    const grantId = stringOption(invocation, "grant_id");
    const reason = stringOption(invocation, "reason");
    if (!grantId || !reason) throw new UserFacingError("grant_id and reason are required.");
    const result = await services.priorityRewards.correctGrant({
      guildId,
      grantId,
      actorUserId,
      reason,
      idempotencyKey: interaction.id ?? crypto.randomUUID(),
    });
    if (!result) throw new UserFacingError("That active grant was not found in this server.");
    return ephemeral(
      `✅ Grant \`${grantId}\` was corrected; ${result.credits.length} token records remain in the audit trail.`,
    );
  }
  if (invocation.subcommand === "refund") {
    if (booleanOption(invocation, "confirm") !== true) {
      throw new UserFacingError("Set confirm to True to refund the token.");
    }
    const creditId = stringOption(invocation, "credit_id");
    const reason = stringOption(invocation, "reason");
    if (!creditId || !reason) throw new UserFacingError("credit_id and reason are required.");
    const credit = await services.priorityRepository.getCredit(guildId, creditId);
    if (!credit || !credit.targetEventId) {
      throw new UserFacingError("That reserved or redeemed token was not found in this server.");
    }
    const result = await services.priorityRewards.refundCredit({
      guildId,
      userId: credit.userId,
      creditId,
      targetEventId: credit.targetEventId,
      targetAssignmentId: credit.targetAssignmentId,
      actorUserId,
      reason,
      idempotencyKey: interaction.id ?? crypto.randomUUID(),
    });
    if (!result) throw new UserFacingError("That token can no longer be refunded.");
    return ephemeral(`✅ Token \`${creditId}\` was refunded and audited.`);
  }
  if (invocation.subcommand === "diagnose") {
    const diagnostics = new PriorityDiagnosticsService(env.DB);
    const memberUserId = stringOption(invocation, "member");
    const eventId = stringOption(invocation, "event_id");
    const report = memberUserId
      ? await diagnostics.member(guildId, memberUserId)
      : eventId
        ? await diagnostics.event(guildId, eventId)
        : await diagnostics.guild(guildId);
    return ephemeral(diagnostics.render(report));
  }
  if (invocation.subcommand === "configure") {
    if (booleanOption(invocation, "confirm") !== true) {
      throw new UserFacingError("Set confirm to True to save reminder configuration.");
    }
    const reminderHours = numberOption(invocation, "reminder_hours");
    if (reminderHours === undefined) {
      throw new UserFacingError("reminder_hours is required.");
    }
    const result = await services.notifications.configurePreExpiryLead({
      guildId,
      reminderHours,
      actorUserId,
      idempotencyKey: interaction.id ?? crypto.randomUUID(),
    });
    return ephemeral(
      result.config.preExpiryLeadMs === 0
        ? `✅ Pre-expiration DMs disabled at config revision ${result.config.configRevision}.`
        : `✅ Pre-expiration DMs set to ${reminderHours} hours at config revision ${result.config.configRevision}.`,
    );
  }
  throw new UserFacingError("Unknown /priority-admin subcommand.");
}

export async function handleM6Command(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response | null> {
  const command = interaction.data?.name;
  if (command === "session") {
    try {
      return await handleSessionCommand(interaction, env);
    } catch (error) {
      if (error instanceof SessionSourceUnavailableError) {
        throw new UserFacingError(
          "That table is not ready for session confirmation. Finalize and archive its week first.",
        );
      }
      if (error instanceof TypeError) {
        throw new UserFacingError(
          "The session draft is invalid. Check attendance, the replacement member, the audit reason, and that a completed table has exactly one actual DM.",
        );
      }
      throw error;
    }
  }
  if (command === "priority") return handlePriorityCommand(interaction, env);
  if (command === "priority-admin") return handlePriorityAdminCommand(interaction, env);
  return null;
}

export async function handleM6Component(
  interaction: DiscordInteraction,
  env: Env,
  component: Extract<GuildComponent, { kind: "table" | "priority" }>,
): Promise<Response> {
  const guildId = requireGuild(interaction);
  const userId = requireMember(interaction);
  if (component.kind === "priority") {
    return component.action === "preview"
      ? priorityPreviewResponse(env, guildId, userId, component.planId, component.tableId)
      : priorityConfirmResponse(env, guildId, userId, component.previewId);
  }
  const services = createM6Services(env);
  const result = component.action === "join"
    ? await services.workflow.select({
        guildId,
        userId,
        planId: component.planId,
        tableId: component.tableId,
        usePriority: false,
      })
    : await services.workflow.leave({
        guildId,
        userId,
        planId: component.planId,
        tableId: component.tableId,
      });
  return ephemeral("✅ " + result.message);
}

export async function settlePriorityForEvent(
  env: Env,
  event: WeeklyEvent,
): Promise<void> {
  const services = createM6Services(env);
  const plan = await services.repository.getCurrentPlan(event.eventId);
  if (plan?.status === "published") {
    await services.priorityRewards.repairInvalidSeatingForPlan({
      guildId: event.guildId,
      eventId: event.eventId,
      planId: plan.planId,
      reason: "invalid priority was repaired before table settlement",
    });
    await services.workflow.settle(event, plan.planId);
    await services.notifications.repairSeatingNotifications(50);
    const bundle = await services.repository.getPlanBundle(plan.planId);
    if (bundle) await services.week.refreshPublishedTables(event, bundle, true);
  }
}

export async function cancelPriorityForEvent(
  env: Env,
  event: WeeklyEvent,
  actorUserId: string,
  reason: string,
): Promise<void> {
  const services = createM6Services(env);
  const plan = await services.repository.getCurrentPlan(event.eventId);
  if (plan?.status === "published") {
    await services.workflow.cancel(event, plan.planId, actorUserId, reason);
  }
}

export async function reconcilePriorityAfterPublish(
  env: Env,
  eventId: string,
  nextPlanId: string,
): Promise<void> {
  await reconcilePublishedPlanPriority(createM6Services(env), eventId, nextPlanId);
}

export async function runM6Scheduled(env: Env, now = Date.now()): Promise<void> {
  const services = createM6Services(env);
  await new PriorityConfirmationRepository(env.DB).deleteExpired(now, 500);
  await new TableThreadService(
    new TableThreadRepository(env.DB),
    services.discord,
    { now: () => now },
  ).runScheduled(50);
  await new SessionSummaryService(
    new SessionSummaryRepository(env.DB),
    services.sessions,
    services.discord,
    {
      now: () => now,
      recapsEnabled: String(env.SESSION_RECAP_WORKFLOW_ENABLED).toLowerCase() === "true",
      rewardPolicyVersion: env.SESSION_RECAP_REWARD_POLICY_VERSION,
      operations: new SessionRecapOperationsRepository(env.DB),
    },
  ).runScheduled(50);
  await services.sessions.reconcilePendingRewards(50);
  await new WebsiteReadRepository(env.DB).deleteExpiredRateLimits(now, 1_000);
  const guilds = await env.DB
    .prepare(
      `SELECT DISTINCT guild_id FROM dm_priority_credits
       WHERE status IN ('available', 'reserved') AND expires_at <= ?
       ORDER BY guild_id ASC LIMIT 100`,
    )
    .bind(now)
    .all<{ guild_id: string }>();
  for (const row of guilds.results) {
    await services.priorityRewards.expireDueCredits(row.guild_id, 100);
  }
  const stalePublishedPlans =
    await services.seating.listPublishedPlansNeedingPriorityReconciliation(100);
  for (const target of stalePublishedPlans) {
    await reconcilePublishedPlanPriority(
      services, target.eventId, target.planId,
    );
  }
  await services.priorityRewards.reconcileInvalidSeating(100);
  await runPriorityNotificationMaintenance(services.notifications);
}
