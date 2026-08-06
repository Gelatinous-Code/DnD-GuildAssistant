import {
  InteractionResponseType,
  type DiscordInteraction,
  type DiscordInteractionComponent,
} from "./discord";
import { discordTimestamp } from "./discord-api";
import { ephemeral, invokingUserId } from "./interaction-utils";
import { createM6Services } from "./m6-app";
import {
  parseSummaryCustomId,
  SessionSummaryService,
  SummaryAccessError,
  summarySubmitCustomId,
} from "./session-summary-service";
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

function service(env: Env): SessionSummaryService {
  const core = createM6Services(env);
  return new SessionSummaryService(
    new SessionSummaryRepository(env.DB),
    core.sessions,
    core.discord,
  );
}

export async function handleSessionSummaryInteraction(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response | null> {
  const parsed = parseSummaryCustomId(interaction.data?.custom_id);
  if (!parsed) return null;

  try {
    const userId = requireUser(interaction);
    const summaries = service(env);
    if (parsed.action === "open") {
      const summary = await summaries.getForDm(parsed.summaryId, userId);
      return renderSessionSummaryModal(summary);
    }

    const values = collectModalValues(interaction.data?.components);
    const result = await summaries.submit({
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
    return ephemeral(
      `✅ Session summary saved. ${timing} You may edit it until ${discordTimestamp(result.summary.editExpiresAt!)}.`,
    );
  } catch (error) {
    if (
      error instanceof SummaryAccessError ||
      error instanceof TypeError ||
      error instanceof RangeError
    ) {
      return ephemeral(`⚠️ ${error.message}`);
    }
    throw error;
  }
}
