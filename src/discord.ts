export const InteractionType = {
  Ping: 1,
  ApplicationCommand: 2,
} as const;

export const InteractionResponseType = {
  Pong: 1,
  ChannelMessageWithSource: 4,
} as const;

export const MessageFlags = {
  Ephemeral: 1 << 6,
} as const;

export interface DiscordInteraction {
  type: number;
  data?: {
    name?: string;
  };
  member?: {
    user?: DiscordUser;
  };
  user?: DiscordUser;
}

interface DiscordUser {
  global_name?: string | null;
  username?: string;
}
