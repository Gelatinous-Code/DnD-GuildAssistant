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
  UserFacingError,
} from "./interaction-utils";
import { CharacterRuleError, CharacterService } from "./character-service";
import {
  CharacterRepository,
  type GuildCharacter,
} from "./storage/character-repository";

function required(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new UserFacingError(`${label} is required.`);
  return value;
}

function operationKey(interaction: DiscordInteraction, action: string): string {
  return `character:${action}:${interaction.id ?? crypto.randomUUID()}`;
}

function characterLine(character: GuildCharacter): string {
  const flags = [
    character.isMain ? "main" : null,
    character.progressionState === "frozen" ? "frozen" : null,
    character.status !== "approved" ? character.status : null,
  ].filter(Boolean);
  const baseline = character.status === "approved"
    ? ` · ${character.openingXp} opening XP · ${character.openingGold} opening gold`
    : "";
  return `• **${character.name}** \`${character.characterId}\`${
    flags.length ? ` — ${flags.join(", ")}` : ""
  }${baseline}`;
}

function service(env: Env): CharacterService {
  return new CharacterService(new CharacterRepository(env.DB));
}

export async function handleCharacterCommand(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response | null> {
  const invocation = parseCommand(interaction);
  if (invocation.command !== "character" && invocation.command !== "character-admin") {
    return null;
  }
  try {
    const guildId = requireGuild(interaction);
    const actorUserId = invokingUserId(interaction);
    if (!actorUserId) throw new UserFacingError("Discord did not identify the member.");
    const characters = service(env);

    if (invocation.command === "character-admin") {
      if (!isGuildAdmin(interaction)) {
        throw new UserFacingError("This command requires Manage Server permission.");
      }
      if (invocation.subcommand === "pending") {
        const pending = await characters.listPending(guildId);
        return ephemeral(
          pending.length
            ? `**Pending characters**\n${pending.map((character) =>
                `${characterLine(character)} · owner <@${character.ownerUserId}>`,
              ).join("\n")}`
            : "There are no pending character approvals.",
        );
      }
      if (invocation.subcommand === "approve") {
        if (booleanOption(invocation, "confirm") !== true) {
          throw new UserFacingError("Set confirm to True to approve this character.");
        }
        const approved = await characters.approve({
          guildId,
          characterId: required(stringOption(invocation, "character_id"), "Character ID"),
          actorUserId,
          openingXp: numberOption(invocation, "opening_xp"),
          openingGold: numberOption(invocation, "opening_gold"),
          reason: required(stringOption(invocation, "reason"), "Reason"),
          operationKey: operationKey(interaction, "approve"),
        });
        return ephemeral(
          `✅ Approved **${approved.name}**${approved.isMain ? " as the member's main character" : ""}.`,
        );
      }
      if (invocation.subcommand === "revoke") {
        if (booleanOption(invocation, "confirm") !== true) {
          throw new UserFacingError("Set confirm to True to revoke this character.");
        }
        const revoked = await characters.revoke({
          guildId,
          characterId: required(stringOption(invocation, "character_id"), "Character ID"),
          actorUserId,
          reason: required(stringOption(invocation, "reason"), "Reason"),
          operationKey: operationKey(interaction, "revoke"),
        });
        return ephemeral(`✅ Revoked **${revoked.name}**. The audit history was retained.`);
      }
      throw new UserFacingError("Choose a character-admin action.");
    }

    if (invocation.subcommand === "create") {
      const created = await characters.register({
        guildId,
        ownerUserId: actorUserId,
        name: required(stringOption(invocation, "name"), "Character name"),
        sheetUrl: stringOption(invocation, "sheet_url"),
        season: stringOption(invocation, "season"),
        operationKey: operationKey(interaction, "create"),
      });
      return ephemeral(
        `✅ Registered **${created.name}** for admin approval. Character ID: \`${created.characterId}\`.`,
      );
    }
    if (invocation.subcommand === "list") {
      const owned = await characters.listForOwner(guildId, actorUserId);
      return ephemeral(
        owned.length
          ? `**Your characters**\n${owned.map(characterLine).join("\n")}`
          : "You have not registered a character yet. Use `/character create` to begin.",
      );
    }
    const characterId = required(stringOption(invocation, "character_id"), "Character ID");
    if (invocation.subcommand === "main") {
      const updated = await characters.setMain({
        guildId,
        ownerUserId: actorUserId,
        characterId,
        actorUserId,
        operationKey: operationKey(interaction, "main"),
      });
      return ephemeral(`✅ **${updated.name}** is now your main character.`);
    }
    if (invocation.subcommand === "freeze" || invocation.subcommand === "unfreeze") {
      const frozen = invocation.subcommand === "freeze";
      const updated = await characters.setFrozen({
        guildId,
        ownerUserId: actorUserId,
        characterId,
        frozen,
        actorUserId,
        operationKey: operationKey(interaction, invocation.subcommand),
      });
      return ephemeral(`✅ **${updated.name}** is now ${frozen ? "frozen" : "active"}.`);
    }
    if (invocation.subcommand === "archive") {
      if (booleanOption(invocation, "confirm") !== true) {
        throw new UserFacingError("Set confirm to True to archive this character.");
      }
      const updated = await characters.archive({
        guildId,
        ownerUserId: actorUserId,
        characterId,
        actorUserId,
        operationKey: operationKey(interaction, "archive"),
      });
      return ephemeral(`✅ Archived **${updated.name}**. Its history was retained.`);
    }
    throw new UserFacingError("Choose a character action.");
  } catch (error) {
    if (error instanceof CharacterRuleError || error instanceof TypeError || error instanceof RangeError) {
      throw new UserFacingError(error.message);
    }
    throw error;
  }
}
