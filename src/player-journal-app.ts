import {
  InteractionResponseType,
  type DiscordInteraction,
  type DiscordInteractionComponent,
} from "./discord";
import {
  ButtonStyle,
  ComponentType,
  DiscordRestClient,
  discordTimestamp,
} from "./discord-api";
import {
  booleanOption,
  ephemeral,
  invokingUserId,
  isGuildAdmin,
  parseCommand,
  requireGuild,
  stringOption,
  UserFacingError,
} from "./interaction-utils";
import {
  journalOpenCustomId,
  journalSubmitCustomId,
  parseJournalCustomId,
  PlayerJournalAccessError,
  PlayerJournalService,
} from "./player-journal-service";
import { PlayerJournalRepository } from "./storage/player-journal-repository";
import { GuildRepository } from "./storage/repository";
import type { PlayerJournal } from "./storage/player-journal-repository";

const TEXT_INPUT = 4;
const SHORT_INPUT = 1;
const PARAGRAPH_INPUT = 2;

function requireText(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new UserFacingError(`${label} is required.`);
  return value.trim();
}

function services(env: Env) {
  const repository = new PlayerJournalRepository(env.DB);
  return {
    journals: new PlayerJournalService(
      repository,
      new DiscordRestClient(env.DISCORD_BOT_TOKEN),
    ),
    guilds: new GuildRepository(env.DB),
    discord: new DiscordRestClient(env.DISCORD_BOT_TOKEN),
  };
}

async function requirePlayerRole(
  interaction: DiscordInteraction,
  env: Env,
  guildId: string,
): Promise<void> {
  if (isGuildAdmin(interaction)) return;
  const config = await new GuildRepository(env.DB).getGuildConfig(guildId);
  const playerRoleId = config?.reminderRoleId;
  if (!playerRoleId || !interaction.member?.roles?.includes(playerRoleId)) {
    throw new PlayerJournalAccessError(
      "You need the configured Guild Player role to write or edit a character journal.",
    );
  }
}

function journalButton(journal: PlayerJournal) {
  return {
    type: ComponentType.ActionRow,
    components: [{
      type: ComponentType.Button,
      style: ButtonStyle.Primary,
      custom_id: journalOpenCustomId(journal.journalId),
      label: journal.status === "submitted" ? "Edit character journal" : "Write character journal",
    }],
  };
}

export function renderPlayerJournalModal(journal: PlayerJournal): Response {
  return Response.json({
    type: InteractionResponseType.Modal,
    data: {
      custom_id: journalSubmitCustomId(journal.journalId),
      title: journal.status === "submitted" ? "Edit character journal" : "Character journal",
      components: [
        {
          type: ComponentType.ActionRow,
          components: [{
            type: TEXT_INPUT,
            custom_id: "journal_title",
            label: "Journal title",
            style: SHORT_INPUT,
            required: true,
            max_length: 100,
            ...(journal.title ? { value: journal.title } : {}),
          }],
        },
        {
          type: ComponentType.ActionRow,
          components: [{
            type: TEXT_INPUT,
            custom_id: "journal_text",
            label: "What did your character experience?",
            style: PARAGRAPH_INPUT,
            required: true,
            max_length: 3_000,
            placeholder: "Write from your character's point of view or record what mattered to them.",
            ...(journal.journalText ? { value: journal.journalText } : {}),
          }],
        },
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
  if (!userId) throw new PlayerJournalAccessError("Discord did not identify your account.");
  return userId;
}

export async function handlePlayerJournalCommand(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response | null> {
  const invocation = parseCommand(interaction);
  if (invocation.command !== "journal" && invocation.command !== "journal-admin") return null;
  try {
    const guildId = requireGuild(interaction);
    const actorUserId = requireUser(interaction);
    const journalServices = services(env);
    if (invocation.command === "journal-admin") {
      if (!isGuildAdmin(interaction)) {
        throw new UserFacingError("This command requires Manage Server permission.");
      }
      if (invocation.subcommand === "configure") {
        const threadId = requireText(stringOption(invocation, "thread"), "Journal thread");
        const channel = await journalServices.discord.getChannel(threadId);
        if (channel.name?.trim().toLowerCase() !== "player character journals") {
          throw new UserFacingError(
            "Choose the thread named `Player Character Journals`.",
          );
        }
        const config = await journalServices.journals.configure({
          guildId,
          threadId,
          actorUserId,
        });
        await journalServices.journals.deliverDue(25);
        return ephemeral(`✅ Player journals will publish in <#${config.threadId}>.`);
      }
      if (invocation.subcommand === "status") {
        const config = await journalServices.journals.getConfig(guildId);
        return ephemeral(config
          ? `Player journal thread: <#${config.threadId}> · configuration version ${config.version}.`
          : "⚠️ Player journal publication is not configured.");
      }
      if (invocation.subcommand === "manage") {
        if (booleanOption(invocation, "confirm") !== true) {
          throw new UserFacingError("Set confirm to True to apply this journal control.");
        }
        const action = requireText(stringOption(invocation, "action"), "Action");
        if (action !== "hide" && action !== "unhide" && action !== "retry") {
          throw new UserFacingError("Choose hide, unhide, or retry.");
        }
        const journal = await journalServices.journals.moderate({
          guildId,
          journalId: requireText(stringOption(invocation, "journal_id"), "Journal ID"),
          action,
          actorUserId,
          reason: requireText(stringOption(invocation, "reason"), "Reason"),
          operationKey: `journal:admin:${interaction.id ?? crypto.randomUUID()}`,
        });
        return ephemeral(
          `✅ Journal ${action} completed. Visibility: ${journal.publicationStatus}; ` +
          `delivery: ${journal.deliveryStatus}.`,
        );
      }
      throw new UserFacingError("Choose a journal-admin action.");
    }

    await requirePlayerRole(interaction, env, guildId);
    if (invocation.subcommand === "write") {
      const journal = await journalServices.journals.prepareDraft({
        guildId,
        authorUserId: actorUserId,
        characterId: requireText(stringOption(invocation, "character_id"), "Character ID"),
        sessionId: stringOption(invocation, "session_id"),
        operationKey: `journal:draft:${interaction.id ?? crypto.randomUUID()}`,
      });
      return ephemeral(
        journal.status === "submitted" && journal.editExpiresAt !== null
          ? `Your journal is saved. You may edit it until ${discordTimestamp(journal.editExpiresAt)}.`
          : "Your journal is private until you submit the form.",
        { components: [journalButton(journal)] },
      );
    }
    if (invocation.subcommand === "list") {
      const journals = await journalServices.journals.listForAuthor(guildId, actorUserId);
      if (!journals.length) return ephemeral("You have not started a character journal yet.");
      return ephemeral(
        "**Your character journals**\n" + journals.map((journal) =>
          `• ${journal.status === "submitted" ? "✅" : "📝"} ` +
          `${journal.title || "Draft journal"} · \`${journal.journalId}\`` +
          `${journal.publicationStatus === "hidden" ? " · hidden" : ""}`
        ).join("\n"),
        { components: journals.slice(0, 5).map(journalButton) },
      );
    }
    throw new UserFacingError("Choose a journal action.");
  } catch (error) {
    if (
      error instanceof PlayerJournalAccessError ||
      error instanceof UserFacingError ||
      error instanceof TypeError ||
      error instanceof RangeError
    ) {
      return ephemeral(`⚠️ ${error.message}`);
    }
    throw error;
  }
}

export async function handlePlayerJournalInteraction(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response | null> {
  const parsed = parseJournalCustomId(interaction.data?.custom_id);
  if (!parsed) return null;
  try {
    const guildId = requireGuild(interaction);
    const authorUserId = requireUser(interaction);
    await requirePlayerRole(interaction, env, guildId);
    const journalServices = services(env);
    if (parsed.action === "open") {
      return renderPlayerJournalModal(
        await journalServices.journals.getForAuthor(parsed.journalId, authorUserId),
      );
    }
    const values = collectModalValues(interaction.data?.components);
    const journal = await journalServices.journals.submit({
      journalId: parsed.journalId,
      authorUserId,
      title: values.get("journal_title") ?? "",
      journalText: values.get("journal_text") ?? "",
      operationKey: `journal:submit:${interaction.id ?? crypto.randomUUID()}`,
    });
    if (journal.editExpiresAt === null) throw new Error("Submitted journal lacks edit deadline");
    const publication = journal.deliveryStatus === "sent"
      ? "It is published in Player Character Journals."
      : journal.deliveryStatus === "not_configured"
      ? "It is saved; an admin must configure the journal thread before publication."
      : "It is saved and publication will retry automatically.";
    return ephemeral(
      `✅ Character journal saved. ${publication} You may edit it until ` +
      `${discordTimestamp(journal.editExpiresAt)}.`,
    );
  } catch (error) {
    if (
      error instanceof PlayerJournalAccessError ||
      error instanceof UserFacingError ||
      error instanceof TypeError ||
      error instanceof RangeError
    ) {
      return ephemeral(`⚠️ ${error.message}`);
    }
    throw error;
  }
}
