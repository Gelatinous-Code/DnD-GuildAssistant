import type { DiscordChannel, DiscordRole } from "./discord-api";

export const SECOND_DAWN_PRESET = "second_dawn";

export interface GuildRoutingPreset {
  gmSignupChannelId: string;
  playerSignupChannelId: string;
  playerReminderRoleId: string;
  adminRoleId: string;
  verifiedGmRoleId: string;
}

function normalizedName(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function requireUniqueNamed<T extends { name?: string }>(
  values: readonly T[],
  expectedName: string,
  label: string,
): T {
  const expected = normalizedName(expectedName);
  const matches = values.filter(
    (value) => value.name !== undefined && normalizedName(value.name) === expected,
  );
  if (matches.length === 0) throw new Error(`Missing ${label} named ${expectedName}.`);
  if (matches.length > 1) {
    throw new Error(`More than one ${label} is named ${expectedName}; rename the duplicate.`);
  }
  return matches[0]!;
}

export function resolveSecondDawnPreset(
  channels: readonly DiscordChannel[],
  roles: readonly DiscordRole[],
): GuildRoutingPreset {
  const messageChannels = channels.filter((channel) => channel.type === 0 || channel.type === 5);
  return {
    gmSignupChannelId: requireUniqueNamed(messageChannels, "gm-sign-up", "text channel").id,
    playerSignupChannelId: requireUniqueNamed(messageChannels, "game-sign-ups", "text channel").id,
    verifiedGmRoleId: requireUniqueNamed(roles, "GM", "role").id,
    playerReminderRoleId: requireUniqueNamed(roles, "Guild Player", "role").id,
    adminRoleId: requireUniqueNamed(roles, "Administrator", "role").id,
  };
}
