import type { DiscordInteraction } from "./discord";
import { DiscordRestClient } from "./discord-api";
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
import {
  TableThreadService,
  TableThreadUserError,
  tableThreadUrl,
} from "./table-thread-service";
import { TableThreadRepository } from "./storage/table-thread-repository";

function requiredText(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new UserFacingError(`${label} is required.`);
  return value.trim();
}

function requiredTableNumber(value: number | undefined): number {
  if (!Number.isSafeInteger(value) || value! < 1 || value! > 25) {
    throw new UserFacingError("A table number from 1 through 25 is required.");
  }
  return value!;
}

function service(env: Env): TableThreadService {
  return new TableThreadService(
    new TableThreadRepository(env.DB),
    new DiscordRestClient(env.DISCORD_BOT_TOKEN),
  );
}

export async function handleTableThreadCommand(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response | null> {
  const invocation = parseCommand(interaction);
  if (invocation.command !== "table-thread-admin") return null;
  try {
    if (!isGuildAdmin(interaction)) {
      throw new UserFacingError("This command requires Manage Server permission.");
    }
    const guildId = requireGuild(interaction);
    const actorUserId = invokingUserId(interaction);
    if (!actorUserId) throw new UserFacingError("Discord did not identify the member.");
    const tableNumber = requiredTableNumber(numberOption(invocation, "table_number"));
    const eventId = stringOption(invocation, "event_id")?.trim() || undefined;
    const threads = service(env);

    if (invocation.subcommand === "status") {
      const result = await threads.status({ guildId, eventId, tableNumber });
      if (!result.target) return ephemeral("No current published table matches that request.");
      if (!result.workflow) {
        return ephemeral(
          `Table ${tableNumber} is published, but its thread workflow has not been created yet.`,
        );
      }
      const workflow = result.workflow;
      const link = workflow.threadId
        ? ` · ${tableThreadUrl(workflow.guildId, workflow.threadId)}`
        : "";
      return ephemeral([
        `**Table ${workflow.tableNumber} thread workflow**`,
        `State: **${workflow.status}**${link}`,
        `GM: <@${workflow.gmUserId}> · revision ${workflow.gmRevision}`,
        `Generation: ${workflow.threadGeneration} · attempts: ${workflow.attemptCount}`,
        workflow.nextAttemptAt ? `Next retry: <t:${Math.floor(workflow.nextAttemptAt / 1_000)}:R>` : null,
        workflow.lastErrorKind ? `Last error: \`${workflow.lastErrorKind}\`` : null,
        workflow.cancellationReason ? `Cancellation: ${workflow.cancellationReason}` : null,
      ].filter(Boolean).join("\n"));
    }

    if (invocation.subcommand === "manage") {
      if (booleanOption(invocation, "confirm") !== true) {
        throw new UserFacingError("Set confirm to True to change the workflow.");
      }
      const action = requiredText(stringOption(invocation, "action"), "Action");
      if (action !== "retry" && action !== "recreate" && action !== "cancel") {
        throw new UserFacingError("Choose retry, recreate, or cancel.");
      }
      const workflow = await threads.manage({
        guildId,
        eventId,
        tableNumber,
        action,
        parentChannelId: stringOption(invocation, "channel"),
        actorUserId,
        reason: requiredText(stringOption(invocation, "reason"), "Reason"),
      });
      const link = workflow.threadId && workflow.status === "current"
        ? ` ${tableThreadUrl(workflow.guildId, workflow.threadId)}`
        : "";
      return ephemeral(`✅ Table ${tableNumber} workflow is now **${workflow.status}**.${link}`);
    }
    throw new UserFacingError("Choose a table-thread-admin action.");
  } catch (error) {
    if (error instanceof TableThreadUserError || error instanceof TypeError || error instanceof RangeError) {
      throw new UserFacingError(error.message);
    }
    throw error;
  }
}
