import {
  InteractionResponseType,
  MessageFlags,
  type DiscordInteraction,
  type DiscordInteractionOption,
} from "./discord";
import { isGameTier, type GameTier } from "./domain/game-tier";

const ADMINISTRATOR = 1n << 3n;
const MANAGE_GUILD = 1n << 5n;

export interface CommandInvocation {
  command: string;
  subcommand?: string;
  options: ReadonlyMap<string, string | number | boolean>;
}

export function parseCommand(interaction: DiscordInteraction): CommandInvocation {
  const command = interaction.data?.name ?? "";
  const topOptions = interaction.data?.options ?? [];
  const subcommand = topOptions.find((option) => option.type === 1);
  const values = new Map<string, string | number | boolean>();
  collectValues(subcommand?.options ?? topOptions, values);
  return { command, subcommand: subcommand?.name, options: values };
}

function collectValues(
  options: readonly DiscordInteractionOption[],
  values: Map<string, string | number | boolean>,
): void {
  for (const option of options) {
    if (option.value !== undefined) {
      values.set(option.name, option.value);
    }
    if (option.options) {
      collectValues(option.options, values);
    }
  }
}

export function stringOption(
  invocation: CommandInvocation,
  name: string,
): string | undefined {
  const value = invocation.options.get(name);
  return typeof value === "string" ? value : undefined;
}

export function numberOption(
  invocation: CommandInvocation,
  name: string,
): number | undefined {
  const value = invocation.options.get(name);
  return typeof value === "number" ? value : undefined;
}

export function booleanOption(
  invocation: CommandInvocation,
  name: string,
): boolean | undefined {
  const value = invocation.options.get(name);
  return typeof value === "boolean" ? value : undefined;
}

export function invokingUserId(interaction: DiscordInteraction): string | undefined {
  return interaction.member?.user?.id ?? interaction.user?.id;
}

export function invokingDisplayName(interaction: DiscordInteraction): string {
  const user = interaction.member?.user ?? interaction.user;
  return interaction.member?.nick ?? user?.global_name ?? user?.username ?? "adventurer";
}

export function isGuildAdmin(interaction: DiscordInteraction): boolean {
  const permissions = interaction.member?.permissions;
  if (!permissions) return false;
  try {
    const value = BigInt(permissions);
    return (value & ADMINISTRATOR) !== 0n || (value & MANAGE_GUILD) !== 0n;
  } catch {
    return false;
  }
}

export function ephemeral(content: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({
    type: InteractionResponseType.ChannelMessageWithSource,
    data: {
      content,
      flags: MessageFlags.Ephemeral,
      allowed_mentions: { parse: [] },
      ...extra,
    },
  });
}

export function updateMessage(data: Record<string, unknown>): Response {
  return Response.json({
    type: InteractionResponseType.UpdateMessage,
    data: {
      allowed_mentions: { parse: [] },
      ...data,
    },
  });
}

export function requireGuild(interaction: DiscordInteraction): string {
  if (!interaction.guild_id) {
    throw new UserFacingError("This command only works inside a Discord server.");
  }
  return interaction.guild_id;
}

export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

export type GuildComponent =
  | {
      kind: "signup";
      action:
        | "gm"
        | "player"
        | "backup"
        | "withdraw"
        | "withdraw_gm"
        | "withdraw_player";
      eventId: string;
      gameTier?: GameTier;
    }
  | { kind: "table"; action: "join" | "leave"; planId: string; tableId: string }
  | {
      kind: "priority";
      action: "preview";
      planId: string;
      tableId: string;
    }
  | { kind: "priority"; action: "confirm"; previewId: string };

export function parseComponentId(customId: string | undefined): GuildComponent | undefined {
  if (!customId) return undefined;
  const parts = customId.split(":");
  if (
    parts.length === 5 &&
    parts[0] === "guild" &&
    parts[1] === "signup" &&
    (parts[2] === "gm" || parts[2] === "player") &&
    isGameTier(Number(parts[3])) &&
    parts[4]
  ) {
    return {
      kind: "signup",
      action: parts[2],
      gameTier: Number(parts[3]) as GameTier,
      eventId: parts[4],
    };
  }
  if (
    parts.length === 4 &&
    parts[0] === "guild" &&
    parts[1] === "signup" &&
    (parts[2] === "gm" ||
      parts[2] === "player" ||
      parts[2] === "backup" ||
      parts[2] === "withdraw" ||
      parts[2] === "withdraw_gm" ||
      parts[2] === "withdraw_player") &&
    parts[3]
  ) {
    return { kind: "signup", action: parts[2], eventId: parts[3] };
  }
  if (
    parts.length === 5 &&
    parts[0] === "guild" &&
    parts[1] === "table" &&
    (parts[2] === "join" || parts[2] === "leave") &&
    parts[3] &&
    parts[4]
  ) {
    return {
      kind: "table",
      action: parts[2],
      planId: parts[3],
      tableId: parts[4],
    };
  }
  if (
    parts.length === 5 &&
    parts[0] === "guild" &&
    parts[1] === "priority" &&
    parts[2] === "preview" &&
    parts[3] &&
    parts[4]
  ) {
    return {
      kind: "priority",
      action: "preview",
      planId: parts[3],
      tableId: parts[4],
    };
  }
  if (
    parts.length === 4 &&
    parts[0] === "guild" &&
    parts[1] === "priority" &&
    parts[2] === "confirm" &&
    parts[3]
  ) {
    return { kind: "priority", action: "confirm", previewId: parts[3] };
  }
  return undefined;
}
