export const InteractionType = {
  Ping: 1,
  ApplicationCommand: 2,
  MessageComponent: 3,
  ModalSubmit: 5,
} as const;

export const InteractionResponseType = {
  Pong: 1,
  ChannelMessageWithSource: 4,
  DeferredChannelMessageWithSource: 5,
  DeferredUpdateMessage: 6,
  UpdateMessage: 7,
  Modal: 9,
} as const;

export const MessageFlags = {
  Ephemeral: 1 << 6,
} as const;

export interface DiscordInteraction {
  id?: string;
  application_id?: string;
  type: number;
  token?: string;
  guild_id?: string;
  channel_id?: string;
  app_permissions?: string;
  data?: {
    name?: string;
    custom_id?: string;
    component_type?: number;
    options?: DiscordInteractionOption[];
    components?: DiscordInteractionComponent[];
  };
  member?: {
    user?: DiscordUser;
    nick?: string | null;
    roles?: string[];
    permissions?: string;
  };
  user?: DiscordUser;
  message?: {
    id?: string;
    channel_id?: string;
  };
}

export interface DiscordInteractionComponent {
  type: number;
  custom_id?: string;
  value?: string;
  components?: DiscordInteractionComponent[];
}

export interface DiscordInteractionOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: DiscordInteractionOption[];
}

export interface DiscordUser {
  id?: string;
  global_name?: string | null;
  username?: string;
}
