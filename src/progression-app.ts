import type { DiscordInteraction } from "./discord";
import { levelForXp } from "./domain/progression";
import { CharacterRuleError } from "./character-service";
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
import { ProgressionService } from "./progression-service";
import { CharacterRepository } from "./storage/character-repository";
import { ProgressionRepository } from "./storage/progression-repository";
import { SessionRepository } from "./storage/session-repository";

function requireText(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new UserFacingError(`${label} is required.`);
  return value;
}

function requireInteger(value: number | undefined, label: string): number {
  if (!Number.isSafeInteger(value)) throw new UserFacingError(`${label} is required.`);
  return value!;
}

function services(env: Env) {
  const characterRepository = new CharacterRepository(env.DB);
  return {
    characters: characterRepository,
    progression: new ProgressionService(
      new ProgressionRepository(env.DB),
      characterRepository,
    ),
    sessions: new SessionRepository(env.DB),
  };
}

async function latestArchivedEventId(
  env: Env,
  guildId: string,
  requested: string | undefined,
): Promise<string> {
  if (requested?.trim()) return requested.trim();
  const eventId = await env.DB
    .prepare(
      `SELECT event_id FROM weekly_events
       WHERE guild_id = ? AND status = 'archived' AND ends_at <= ?
       ORDER BY starts_at DESC, event_id DESC LIMIT 1`,
    )
    .bind(guildId, Date.now())
    .first<string>("event_id");
  if (!eventId) {
    throw new UserFacingError("No ended archived session is available yet.");
  }
  return eventId;
}

async function selectTarget(input: {
  interaction: DiscordInteraction;
  env: Env;
  guildId: string;
  ownerUserId: string;
  actorUserId: string;
  characterId: string;
  tableNumber: number;
  eventId?: string;
  reason?: string | null;
}) {
  const eventId = await latestArchivedEventId(input.env, input.guildId, input.eventId);
  const { progression, sessions } = services(input.env);
  const source = await sessions.resolveFinalizedSource(
    input.guildId,
    eventId,
    input.tableNumber,
    Date.now(),
  );
  if (!source) {
    throw new UserFacingError("That table is not an ended, archived session with a final roster.");
  }
  const completion = await sessions.getSessionBySource(
    input.guildId,
    eventId,
    source.tableId,
  );
  if (completion?.rewardSyncStatus === "synced") {
    throw new UserFacingError(
      "Rewards are already synchronized. An admin can make a reasoned ledger adjustment.",
    );
  }
  return progression.selectSessionCharacter({
    guildId: input.guildId,
    sourceEventId: eventId,
    sourceTableId: source.tableId,
    ownerUserId: input.ownerUserId,
    characterId: input.characterId,
    actorUserId: input.actorUserId,
    reason: input.reason,
    operationKey: `progression:target:${input.interaction.id ?? crypto.randomUUID()}`,
  });
}

export async function handleProgressionCommand(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response | null> {
  const invocation = parseCommand(interaction);
  if (invocation.command !== "progression" && invocation.command !== "progression-admin") {
    return null;
  }
  try {
    const guildId = requireGuild(interaction);
    const actorUserId = invokingUserId(interaction);
    if (!actorUserId) throw new UserFacingError("Discord did not identify the member.");
    const { characters, progression } = services(env);

    if (invocation.command === "progression-admin") {
      if (!isGuildAdmin(interaction)) {
        throw new UserFacingError("This command requires Manage Server permission.");
      }
      if (invocation.subcommand === "adjust") {
        if (booleanOption(invocation, "confirm") !== true) {
          throw new UserFacingError("Set confirm to True to append this adjustment.");
        }
        const entry = await progression.adjust({
          guildId,
          characterId: requireText(stringOption(invocation, "character_id"), "Character ID"),
          xpDelta: numberOption(invocation, "xp_delta") ?? 0,
          goldDelta: numberOption(invocation, "gold_delta") ?? 0,
          actorUserId,
          reason: requireText(stringOption(invocation, "reason"), "Reason"),
          operationKey: `progression:adjust:${interaction.id ?? crypto.randomUUID()}`,
        });
        const balance = await progression.getBalance(guildId, entry.characterId);
        return ephemeral(
          `✅ Adjustment appended: XP ${entry.xpDelta >= 0 ? "+" : ""}${entry.xpDelta}, ` +
          `gold ${entry.goldDelta >= 0 ? "+" : ""}${entry.goldDelta}. ` +
          `New balance: ${balance?.xp} XP, ${balance?.gold} gold.`,
        );
      }
      if (invocation.subcommand === "history") {
        const characterId = requireText(
          stringOption(invocation, "character_id"),
          "Character ID",
        );
        const history = await progression.listHistory(guildId, characterId, 20);
        return ephemeral(
          history.length
            ? `**Recent progression entries**\n${history.map((entry) =>
                `• ${entry.entryKind} · XP ${entry.xpDelta >= 0 ? "+" : ""}${entry.xpDelta}` +
                ` · gold ${entry.goldDelta >= 0 ? "+" : ""}${entry.goldDelta}` +
                ` · \`${entry.entryId}\`${entry.reason ? ` · ${entry.reason}` : ""}`,
              ).join("\n")}`.slice(0, 1_950)
            : "No progression entries exist for that character.",
        );
      }
      if (invocation.subcommand === "target") {
        const memberId = requireText(stringOption(invocation, "member"), "Member");
        const target = await selectTarget({
          interaction,
          env,
          guildId,
          ownerUserId: memberId,
          actorUserId,
          characterId: requireText(stringOption(invocation, "character_id"), "Character ID"),
          tableNumber: requireInteger(numberOption(invocation, "table_number"), "Table number"),
          eventId: stringOption(invocation, "event_id"),
          reason: requireText(stringOption(invocation, "reason"), "Reason"),
        });
        return ephemeral(`✅ Reward character override saved at version ${target.version}.`);
      }
      throw new UserFacingError("Choose a progression-admin action.");
    }

    if (invocation.subcommand === "balance") {
      const [owned, balances] = await Promise.all([
        characters.listForOwner(guildId, actorUserId),
        progression.listBalancesForOwner(guildId, actorUserId),
      ]);
      const byCharacter = new Map(balances.map((balance) => [balance.characterId, balance]));
      const lines = owned
        .filter((character) => character.status === "approved")
        .map((character) => {
          const balance = byCharacter.get(character.characterId);
          if (!balance) return null;
          return `• **${character.name}**${character.isMain ? " — main" : ""}` +
            `${character.progressionState === "frozen" ? " — frozen" : ""}` +
            ` · Level ${levelForXp(balance.xp)} · ${balance.xp} XP · ${balance.gold} gold`;
        })
        .filter((line): line is string => line !== null);
      return ephemeral(lines.length ? `**Your progression**\n${lines.join("\n")}` :
        "You do not have an approved character yet.");
    }
    if (invocation.subcommand === "select") {
      const target = await selectTarget({
        interaction,
        env,
        guildId,
        ownerUserId: actorUserId,
        actorUserId,
        characterId: requireText(stringOption(invocation, "character_id"), "Character ID"),
        tableNumber: requireInteger(numberOption(invocation, "table_number"), "Table number"),
        eventId: stringOption(invocation, "event_id"),
      });
      return ephemeral(
        `✅ Session character selected. If it is frozen and you play, rewards route to your main character. ` +
        `DM rewards require the selection to be active. Target version ${target.version}.`,
      );
    }
    throw new UserFacingError("Choose a progression action.");
  } catch (error) {
    if (error instanceof CharacterRuleError || error instanceof TypeError || error instanceof RangeError) {
      throw new UserFacingError(error.message);
    }
    throw error;
  }
}
