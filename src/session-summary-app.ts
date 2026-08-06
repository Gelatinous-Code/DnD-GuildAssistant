import {
  InteractionResponseType,
  type DiscordInteraction,
  type DiscordInteractionComponent,
} from "./discord";
import { ButtonStyle, ComponentType, discordTimestamp } from "./discord-api";
import {
  booleanOption,
  ephemeral,
  invokingUserId,
  isGuildAdmin,
  numberOption,
  parseCommand,
  requireGuild,
  stringOption,
  UserFacingError,
} from "./interaction-utils";
import { createM6Services } from "./m6-app";
import {
  RecapControlError,
  type RecapAdminAction,
  type RecapAdminStatus,
  SessionRecapOperationsService,
} from "./session-recap-operations-service";
import {
  parseSummaryCustomId,
  SessionSummaryService,
  SummaryAccessError,
  summaryDidNotRunCustomId,
  summaryOpenCustomId,
  summarySubmitCustomId,
} from "./session-summary-service";
import { SessionRecapOperationsRepository } from "./storage/session-recap-operations-repository";
import type { SessionSummary } from "./storage/session-summary-repository";
import { SessionSummaryRepository } from "./storage/session-summary-repository";

const TEXT_INPUT = 4;
const SHORT_INPUT = 1;
const PARAGRAPH_INPUT = 2;
interface ModalTextInput {
  type: typeof TEXT_INPUT;
  custom_id: string;
  label: string;
  style: typeof SHORT_INPUT | typeof PARAGRAPH_INPUT;
  required: boolean;
  max_length: number;
  value?: string;
  placeholder?: string;
}

function inputRow(input: ModalTextInput) {
  return { type: 1, components: [input] };
}

function existingValue(value: string | null): { value?: string } {
  return value ? { value } : {};
}

export function renderSessionSummaryModal(summary: SessionSummary): Response {
  return Response.json({
    type: InteractionResponseType.Modal,
    data: {
      custom_id: summarySubmitCustomId(summary.summaryId),
      title: summary.status === "submitted" ? "Edit session summary" : "Session summary",
      components: [
        inputRow({
          type: TEXT_INPUT,
          custom_id: "summary_text",
          label: "What happened?",
          style: PARAGRAPH_INPUT,
          required: true,
          max_length: 2_000,
          placeholder: "A concise, player-facing summary of the session",
          ...existingValue(summary.summaryText),
        }),
        inputRow({
          type: TEXT_INPUT,
          custom_id: "area",
          label: "Area or location",
          style: SHORT_INPUT,
          required: true,
          max_length: 200,
          placeholder: "Where the adventure took place",
          ...existingValue(summary.area),
        }),
        inputRow({
          type: TEXT_INPUT,
          custom_id: "important_events",
          label: "Important events (optional)",
          style: PARAGRAPH_INPUT,
          required: false,
          max_length: 1_500,
          ...existingValue(summary.importantEvents),
        }),
        inputRow({
          type: TEXT_INPUT,
          custom_id: "bonus_rewards",
          label: "Bonus gold or items (optional)",
          style: PARAGRAPH_INPUT,
          required: false,
          max_length: 1_000,
          ...existingValue(summary.bonusRewards),
        }),
        inputRow({
          type: TEXT_INPUT,
          custom_id: "other_notes",
          label: "Other notes (optional)",
          style: PARAGRAPH_INPUT,
          required: false,
          max_length: 1_000,
          ...existingValue(summary.otherNotes),
        }),
      ],
    },
  });
}

function collectModalValues(
  components: readonly DiscordInteractionComponent[] | undefined,
  values = new Map<string, string>(),
): Map<string, string> {
  for (const component of components ?? []) {
    if (component.custom_id && typeof component.value === "string") {
      values.set(component.custom_id, component.value);
    }
    collectModalValues(component.components, values);
  }
  return values;
}

function requireUser(interaction: DiscordInteraction): string {
  const userId = invokingUserId(interaction);
  if (!userId) throw new SummaryAccessError("Discord did not identify your account.");
  return userId;
}

function services(env: Env) {
  const core = createM6Services(env);
  const repository = new SessionSummaryRepository(env.DB);
  const operationsRepository = new SessionRecapOperationsRepository(env.DB);
  return {
    summaries: new SessionSummaryService(repository, core.sessions, core.discord, {
      operations: operationsRepository,
    }),
    operations: new SessionRecapOperationsService(operationsRepository, core.sessions),
  };
}

function didNotRunConfirmation(summaryId: string): Response {
  return ephemeral(
    "⚠️ Confirm only if this table did not run. This changes the authoritative session result to cancelled and reverses its automatic rewards.",
    {
      components: [{
        type: ComponentType.ActionRow,
        components: [{
          type: ComponentType.Button,
          style: ButtonStyle.Danger,
          custom_id: summaryDidNotRunCustomId(summaryId, true),
          label: "Confirm session did not run",
        }],
      }],
    },
  );
}

function pendingResponse(items: Awaited<ReturnType<SessionRecapOperationsService["pending"]>>): Response {
  if (!items.length) return ephemeral("✅ You have no pending session recaps for this server.");
  const lines = items.slice(0, 5).map(
    (item) =>
      `- **${item.eventTitle}** — Table ${item.tableNumber}: ${item.tableTitle} · due ${discordTimestamp(item.dueAt)}`,
  );
  return ephemeral(
    "## Pending session recaps\n" + lines.join("\n") +
      "\n\nUse a button below to open the same form sent by DM.",
    {
      components: items.slice(0, 5).map((item) => ({
        type: ComponentType.ActionRow,
        components: [{
          type: ComponentType.Button,
          style: ButtonStyle.Primary,
          custom_id: summaryOpenCustomId(item.summaryId),
          label: `Table ${item.tableNumber}: Write recap`.slice(0, 80),
        }],
      })),
    },
  );
}

function recapStatusText(status: RecapAdminStatus): string {
  const { context } = status;
  const lines = [
    "## Session recap status",
    `**Session:** ${context.eventTitle} — Table ${context.tableNumber}: ${context.tableTitle}`,
    `**DM:** <@${context.dmUserId}>`,
    `**Recap:** ${context.status}; publication ${context.publicationStatus}; edits ${context.authorEditStatus}`,
    `**Deadline:** ${discordTimestamp(context.dueAt)}`,
    `**Qualification:** ${status.qualification?.qualification ?? "not submitted"}` +
      (status.qualification ? ` (${status.qualification.rewardStatus})` : ""),
    "",
    "**Deliveries**",
    ...status.deliveries.map(
      (delivery) =>
        `- ${delivery.deliveryKind}: ${delivery.status}; attempts ${delivery.attemptCount}; repairs ${delivery.repairCount}` +
        (delivery.lastErrorKind ? `; last error ${delivery.lastErrorKind}` : ""),
    ),
  ];
  if (status.events.length) {
    lines.push(
      "",
      "**Recent controls**",
      ...status.events.slice(0, 5).map(
        (event) =>
          `- ${event.eventKind} by <@${event.actorUserId}> ${discordTimestamp(event.createdAt)} — ${event.reason}`,
      ),
    );
  }
  return lines.join("\n").slice(0, 1_950);
}

async function latestArchivedEventId(
  env: Env,
  guildId: string,
  explicitEventId?: string,
): Promise<string> {
  if (explicitEventId) return explicitEventId;
  const row = await env.DB.prepare(
    `SELECT event_id FROM weekly_events
     WHERE guild_id = ? AND status = 'archived'
     ORDER BY COALESCE(archived_at, updated_at) DESC, starts_at DESC LIMIT 1`,
  ).bind(guildId).first<{ event_id: string }>();
  if (!row) throw new UserFacingError("There is no archived week with recaps yet.");
  return row.event_id;
}

function adminAction(value: string | undefined): RecapAdminAction {
  switch (value) {
    case "retry_delivery":
    case "lock":
    case "reopen":
    case "hide":
    case "unhide":
    case "correction":
      return value;
    default:
      throw new UserFacingError("Choose a valid recap action.");
  }
}

export async function handleSessionSummaryCommand(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response | null> {
  const invocation = parseCommand(interaction);
  if (invocation.command !== "recap" && invocation.command !== "recap-admin") return null;
  try {
    const guildId = requireGuild(interaction);
    const actorUserId = requireUser(interaction);
    const recapServices = services(env);
    if (invocation.command === "recap") {
      if (invocation.subcommand !== "pending") throw new UserFacingError("Unknown /recap subcommand.");
      return pendingResponse(await recapServices.operations.pending(guildId, actorUserId));
    }
    if (!isGuildAdmin(interaction)) {
      throw new UserFacingError("This command requires Manage Server or Administrator.");
    }
    const tableNumber = numberOption(invocation, "table_number");
    if (!tableNumber || !Number.isInteger(tableNumber) || tableNumber < 1) {
      throw new UserFacingError("table_number must be a positive whole number.");
    }
    const eventId = await latestArchivedEventId(
      env,
      guildId,
      stringOption(invocation, "event_id"),
    );
    if (invocation.subcommand === "status") {
      return ephemeral(recapStatusText(
        await recapServices.operations.status(guildId, eventId, tableNumber),
      ));
    }
    if (invocation.subcommand !== "manage") {
      throw new UserFacingError("Unknown /recap-admin subcommand.");
    }
    if (booleanOption(invocation, "confirm") !== true) {
      throw new UserFacingError("Set confirm to True to apply this audited change.");
    }
    const action = adminAction(stringOption(invocation, "action"));
    let status = await recapServices.operations.manage({
      guildId,
      eventId,
      tableNumber,
      action,
      actorUserId,
      reason: stringOption(invocation, "reason") ?? "",
      idempotencyKey: interaction.id ?? crypto.randomUUID(),
      reopenHours: numberOption(invocation, "hours"),
      publicCorrection: stringOption(invocation, "correction"),
    });
    if (action === "retry_delivery") await recapServices.summaries.deliverDue(5);
    return ephemeral(`✅ Recap control applied.\n\n${recapStatusText(status)}`);
  } catch (error) {
    if (
      error instanceof SummaryAccessError ||
      error instanceof RecapControlError ||
      error instanceof UserFacingError ||
      error instanceof TypeError ||
      error instanceof RangeError
    ) {
      return ephemeral(`⚠️ ${error.message}`);
    }
    throw error;
  }
}

export async function handleSessionSummaryInteraction(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response | null> {
  const parsed = parseSummaryCustomId(interaction.data?.custom_id);
  if (!parsed) return null;

  try {
    const userId = requireUser(interaction);
    const recapServices = services(env);
    if (parsed.action === "open") {
      const summary = await recapServices.summaries.getForDm(parsed.summaryId, userId);
      return renderSessionSummaryModal(summary);
    }
    if (parsed.action === "not_run") {
      await recapServices.operations.getForDm(parsed.summaryId, userId);
      return didNotRunConfirmation(parsed.summaryId);
    }
    if (parsed.action === "not_run_confirm") {
      await recapServices.operations.reportDidNotRun(parsed.summaryId, userId);
      return ephemeral("✅ The session is now recorded as not run. No recap is required.");
    }

    const values = collectModalValues(interaction.data?.components);
    const result = await recapServices.summaries.submit({
      summaryId: parsed.summaryId,
      userId,
      fields: {
        summaryText: values.get("summary_text") ?? "",
        area: values.get("area") ?? "",
        importantEvents: values.get("important_events") ?? null,
        bonusRewards: values.get("bonus_rewards") ?? null,
        otherNotes: values.get("other_notes") ?? null,
      },
    });
    const timing = result.onTime ? "Submitted on time." : "Submitted after the on-time deadline.";
    if (result.summary.editExpiresAt === null) {
      throw new Error("A submitted session summary is missing its edit deadline");
    }
    return ephemeral(
      `✅ Session summary saved. ${timing} You may edit it until ${discordTimestamp(result.summary.editExpiresAt)}.`,
    );
  } catch (error) {
    if (
      error instanceof SummaryAccessError ||
      error instanceof RecapControlError ||
      error instanceof TypeError ||
      error instanceof RangeError
    ) {
      return ephemeral(`⚠️ ${error.message}`);
    }
    throw error;
  }
}
