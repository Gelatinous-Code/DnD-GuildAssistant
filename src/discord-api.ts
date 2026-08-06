import {
  GAME_TIER_DEFINITIONS,
  type GameTier,
  gameTierDefinition,
  gameTierLabel,
} from "./domain/game-tier";

const DISCORD_API_BASE_URL = "https://discord.com/api/v10";
const MAX_ERROR_BODY_LENGTH = 16_384;
const MAX_ROLE_MENTIONS = 100;
const MAX_ATTACHMENT_BYTES = 512 * 1024;
const MAX_ATTACHMENT_FILENAME_LENGTH = 255;
const MAX_FINAL_MANIFEST_EMBED_CHARACTERS = 5_800;

export type Snowflake = string;
export type DiscordDate = Date | string | number;

export const ComponentType = {
  ActionRow: 1,
  Button: 2,
} as const;

export const ButtonStyle = {
  Primary: 1,
  Secondary: 2,
  Success: 3,
  Danger: 4,
  Link: 5,
} as const;

export interface DiscordUser {
  id: Snowflake;
  username: string;
  global_name?: string | null;
  bot?: boolean;
}

export interface DiscordGuildMember {
  user?: DiscordUser;
  nick?: string | null;
  roles: Snowflake[];
  joined_at?: string;
  pending?: boolean;
}

export interface DiscordRole {
  id: Snowflake;
  name: string;
  color: number;
  position: number;
  permissions: string;
  managed: boolean;
  mentionable: boolean;
}

export interface DiscordChannel {
  id: Snowflake;
  type: number;
  guild_id?: Snowflake;
  name?: string;
  parent_id?: Snowflake | null;
  message?: DiscordMessage;
  permission_overwrites?: DiscordPermissionOverwrite[];
}

export interface DiscordPermissionOverwrite {
  id: Snowflake;
  type: 0 | 1;
  allow: string;
  deny: string;
}

export interface DiscordButton {
  type: typeof ComponentType.Button;
  style: (typeof ButtonStyle)[keyof typeof ButtonStyle];
  custom_id?: string;
  url?: string;
  label: string;
  disabled?: boolean;
  emoji?: { name: string };
}

export interface DiscordActionRow {
  type: typeof ComponentType.ActionRow;
  components: DiscordButton[];
}

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  footer?: { text: string };
  timestamp?: string;
}

/**
 * A deliberately restrictive Allowed Mentions shape. `parse` is always empty,
 * so @everyone, @here, user mentions, and undeclared role mentions cannot ping.
 */
export interface SafeAllowedMentions {
  parse: [];
  roles: Snowflake[];
  users: [];
  replied_user: false;
}

export interface DiscordMessagePayload {
  content?: string;
  embeds?: DiscordEmbed[];
  components?: DiscordActionRow[];
  allowed_mentions?: SafeAllowedMentions;
  flags?: number;
  nonce?: string;
  enforce_nonce?: boolean;
}

export interface DiscordFileAttachment {
  filename: string;
  content: string | Uint8Array | ArrayBuffer;
  contentType?: string;
}

export interface DiscordMessage {
  id: Snowflake;
  channel_id: Snowflake;
  content: string;
  embeds?: DiscordEmbed[];
  components?: DiscordActionRow[];
}

export interface DiscordRestClientOptions {
  fetch?: typeof fetch;
  apiBaseUrl?: string;
}

function requireSnowflake(value: string, label: string): Snowflake {
  if (!/^\d{1,20}$/.test(value)) {
    throw new TypeError(`${label} must be a Discord snowflake`);
  }
  return value;
}

function truncate(value: string, maximum: number): string {
  if (value.length <= maximum) {
    return value;
  }
  return `${value.slice(0, maximum - 1)}…`;
}

function sanitizeForError(value: unknown, secret: string): unknown {
  const redact = (text: string): string =>
    truncate(secret ? text.split(secret).join("[REDACTED]") : text, MAX_ERROR_BODY_LENGTH);

  if (typeof value === "string") {
    return redact(value);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeForError(item, secret));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 100)
        .map(([key, item]) => [redact(key), sanitizeForError(item, secret)]),
    );
  }
  return value;
}

function errorCode(body: unknown): number | undefined {
  if (!body || typeof body !== "object") {
    return undefined;
  }
  const code = Reflect.get(body, "code");
  return typeof code === "number" ? code : undefined;
}

function errorDescription(body: unknown): string | undefined {
  if (typeof body === "string") {
    return truncate(body, 300);
  }
  if (!body || typeof body !== "object") {
    return undefined;
  }
  const message = Reflect.get(body, "message");
  return typeof message === "string" ? truncate(message, 300) : undefined;
}

export class DiscordApiError extends Error {
  readonly status: number;
  readonly code?: number;
  readonly body: unknown;

  constructor(method: string, path: string, status: number, body: unknown) {
    const code = errorCode(body);
    const description = errorDescription(body);
    const details = [
      status > 0 ? `HTTP ${status}` : "network error",
      code === undefined ? undefined : `Discord code ${code}`,
      description,
    ].filter(Boolean);
    super(`Discord API ${method} ${path} failed (${details.join(": ")})`);
    this.name = "DiscordApiError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

/** Allow notifications for only these exact role IDs. */
export function safeAllowedMentions(roleIds: readonly Snowflake[] = []): SafeAllowedMentions {
  const roles = [...new Set(roleIds.map((roleId) => requireSnowflake(roleId, "roleId")))];
  if (roles.length > MAX_ROLE_MENTIONS) {
    throw new RangeError(`Discord allows at most ${MAX_ROLE_MENTIONS} role mentions`);
  }

  return {
    parse: [],
    roles,
    users: [],
    replied_user: false,
  };
}

/** Stable unsigned 64-bit FNV-1a rendered within Discord's 25-character nonce limit. */
export function discordNonce(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString();
}

function safePayload(payload: DiscordMessagePayload): DiscordMessagePayload {
  return {
    ...payload,
    allowed_mentions: safeAllowedMentions(payload.allowed_mentions?.roles ?? []),
  };
}

function prepareFileAttachment(file: DiscordFileAttachment): {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
} {
  const filename = file.filename.trim();
  if (!filename) {
    throw new TypeError("Attachment filename is required");
  }
  if (filename.length > MAX_ATTACHMENT_FILENAME_LENGTH) {
    throw new RangeError(
      `Attachment filename cannot exceed ${MAX_ATTACHMENT_FILENAME_LENGTH} characters`,
    );
  }
  if (filename === "." || filename === ".." || /[\u0000-\u001f\u007f/\\]/.test(filename)) {
    throw new TypeError("Attachment filename cannot contain path separators or control characters");
  }

  const contentType = file.contentType?.trim() || "application/octet-stream";
  if (contentType.length > 255 || /[\u0000-\u001f\u007f]/.test(contentType)) {
    throw new TypeError("Attachment content type is invalid");
  }

  const bytes =
    typeof file.content === "string"
      ? new TextEncoder().encode(file.content)
      : file.content instanceof Uint8Array
        ? file.content
        : new Uint8Array(file.content);
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new RangeError(`Attachment content cannot exceed ${MAX_ATTACHMENT_BYTES} bytes`);
  }
  return { filename, contentType, bytes };
}

async function responseBody(response: Response, limitErrors: boolean): Promise<unknown> {
  if (response.status === 204 || response.status === 205) {
    return undefined;
  }

  const text = await response.text();
  if (!text) {
    return undefined;
  }

  const candidate = limitErrors ? truncate(text, MAX_ERROR_BODY_LENGTH) : text;
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return candidate;
  }
}

export class DiscordRestClient {
  readonly #botToken: string;
  readonly #fetch: typeof fetch;
  readonly #apiBaseUrl: string;

  constructor(botToken: string, options: DiscordRestClientOptions = {}) {
    if (!botToken.trim()) {
      throw new TypeError("A Discord bot token is required");
    }
    this.#botToken = botToken;
    this.#fetch =
      options.fetch ??
      ((input, init) => globalThis.fetch(input, init));
    this.#apiBaseUrl = (options.apiBaseUrl ?? DISCORD_API_BASE_URL).replace(/\/$/, "");
  }

  async #request<T>(
    method: string,
    path: string,
    body?: unknown,
    auditLogReason?: string,
    displayPath = path,
    additionalSecret = "",
    bodyFactory?: () => BodyInit,
  ): Promise<T> {
    const headers = new Headers({
      accept: "application/json",
      authorization: `Bot ${this.#botToken}`,
    });
    if (body !== undefined && !bodyFactory) {
      headers.set("content-type", "application/json");
    }
    if (auditLogReason?.trim()) {
      headers.set("x-audit-log-reason", encodeURIComponent(auditLogReason.trim().slice(0, 512)));
    }

    const requestBody = body === undefined ? undefined : JSON.stringify(body);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let response: Response;
      try {
        response = await this.#fetch(`${this.#apiBaseUrl}${path}`, {
          method,
          headers,
          body: bodyFactory ? bodyFactory() : requestBody,
        });
      } catch (cause) {
        const safeCause = sanitizeForError(
          cause instanceof Error ? cause.message : String(cause),
          this.#botToken,
        );
        throw new DiscordApiError(
          method,
          displayPath,
          0,
          sanitizeForError(safeCause, additionalSecret),
        );
      }

      if (response.status === 429 && attempt < 2) {
        const retryBody = await responseBody(response, true);
        const bodyDelay =
          retryBody && typeof retryBody === "object"
            ? Number(Reflect.get(retryBody, "retry_after"))
            : Number.NaN;
        const headerDelay = Number(response.headers.get("retry-after"));
        const seconds = Number.isFinite(bodyDelay)
          ? bodyDelay
          : Number.isFinite(headerDelay)
            ? headerDelay
            : 0.25;
        const delayMs = Math.min(Math.max(Math.ceil(seconds * 1000), 50), 2500);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      if (!response.ok) {
        const unsafeBody = await responseBody(response, true);
        const safeBody = sanitizeForError(
          sanitizeForError(unsafeBody, this.#botToken),
          additionalSecret,
        );
        throw new DiscordApiError(method, displayPath, response.status, safeBody);
      }

      return (await responseBody(response, false)) as T;
    }

    throw new DiscordApiError(method, displayPath, 429, "Discord rate-limit retry budget exhausted.");
  }

  sendChannelMessage(
    channelId: Snowflake,
    payload: DiscordMessagePayload,
  ): Promise<DiscordMessage> {
    requireSnowflake(channelId, "channelId");
    return this.#request(
      "POST",
      `/channels/${channelId}/messages`,
      safePayload(payload),
    );
  }

  editChannelMessage(
    channelId: Snowflake,
    messageId: Snowflake,
    payload: DiscordMessagePayload,
  ): Promise<DiscordMessage> {
    requireSnowflake(channelId, "channelId");
    requireSnowflake(messageId, "messageId");
    return this.#request(
      "PATCH",
      `/channels/${channelId}/messages/${messageId}`,
      safePayload(payload),
    );
  }

  getGuildMember(guildId: Snowflake, userId: Snowflake): Promise<DiscordGuildMember> {
    requireSnowflake(guildId, "guildId");
    requireSnowflake(userId, "userId");
    return this.#request("GET", `/guilds/${guildId}/members/${userId}`);
  }

  async getCurrentBotGuildMember(guildId: Snowflake): Promise<DiscordGuildMember> {
    requireSnowflake(guildId, "guildId");
    const currentBot = await this.#request<DiscordUser>("GET", "/users/@me");
    return this.getGuildMember(guildId, currentBot.id);
  }

  getGuildRoles(guildId: Snowflake): Promise<DiscordRole[]> {
    requireSnowflake(guildId, "guildId");
    return this.#request("GET", `/guilds/${guildId}/roles`);
  }

  getGuildChannels(guildId: Snowflake): Promise<DiscordChannel[]> {
    requireSnowflake(guildId, "guildId");
    return this.#request("GET", `/guilds/${guildId}/channels`);
  }

  getGuildRoleMemberCounts(guildId: Snowflake): Promise<Record<Snowflake, number>> {
    requireSnowflake(guildId, "guildId");
    return this.#request("GET", `/guilds/${guildId}/roles/member-counts`);
  }

  getChannel(channelId: Snowflake): Promise<DiscordChannel> {
    requireSnowflake(channelId, "channelId");
    return this.#request("GET", `/channels/${channelId}`);
  }

  startThreadFromMessage(
    channelId: Snowflake,
    messageId: Snowflake,
    input: { name: string; auto_archive_duration?: 60 | 1440 | 4320 | 10080 },
  ): Promise<DiscordChannel> {
    requireSnowflake(channelId, "channelId");
    requireSnowflake(messageId, "messageId");
    return this.#request(
      "POST",
      `/channels/${channelId}/messages/${messageId}/threads`,
      input,
    );
  }

  startForumThread(
    channelId: Snowflake,
    input: {
      name: string;
      auto_archive_duration?: 60 | 1440 | 4320 | 10080;
      message: DiscordMessagePayload;
    },
  ): Promise<DiscordChannel> {
    requireSnowflake(channelId, "channelId");
    return this.#request("POST", `/channels/${channelId}/threads`, {
      ...input,
      message: safePayload(input.message),
    });
  }

  listActiveGuildThreads(guildId: Snowflake): Promise<{ threads: DiscordChannel[] }> {
    requireSnowflake(guildId, "guildId");
    return this.#request("GET", `/guilds/${guildId}/threads/active`);
  }

  editChannel(
    channelId: Snowflake,
    input: { archived?: boolean; locked?: boolean; name?: string },
  ): Promise<DiscordChannel> {
    requireSnowflake(channelId, "channelId");
    return this.#request("PATCH", `/channels/${channelId}`, input);
  }

  createDmChannel(userId: Snowflake): Promise<DiscordChannel> {
    requireSnowflake(userId, "userId");
    return this.#request("POST", "/users/@me/channels", {
      recipient_id: userId,
    });
  }

  /**
   * Convenience wrapper for private delivery outside the durable outbox. The
   * delivery key is converted to a stable Discord nonce and enforced so an
   * idempotent retry resolves to the original message instead of duplicating it.
   */
  async sendDirectMessage(
    userId: Snowflake,
    payload: DiscordMessagePayload,
    deliveryKey: string,
  ): Promise<DiscordMessage> {
    if (!deliveryKey.trim()) throw new TypeError("deliveryKey is required");
    const channel = await this.createDmChannel(userId);
    return this.sendChannelMessage(channel.id, {
      ...payload,
      allowed_mentions: safeAllowedMentions(),
      nonce: discordNonce(deliveryKey),
      enforce_nonce: true,
    });
  }

  editOriginalInteractionResponse(
    applicationId: Snowflake,
    interactionToken: string,
    payload: DiscordMessagePayload,
  ): Promise<DiscordMessage> {
    requireSnowflake(applicationId, "applicationId");
    if (!interactionToken.trim()) throw new TypeError("interactionToken is required");
    const path =
      "/webhooks/" +
      applicationId +
      "/" +
      encodeURIComponent(interactionToken) +
      "/messages/@original";
    return this.#request(
      "PATCH",
      path,
      safePayload(payload),
      undefined,
      "/webhooks/" + applicationId + "/[interaction-token]/messages/@original",
      interactionToken,
    );
  }

  editOriginalInteractionResponseWithFile(
    applicationId: Snowflake,
    interactionToken: string,
    payload: DiscordMessagePayload,
    file: DiscordFileAttachment,
  ): Promise<DiscordMessage> {
    requireSnowflake(applicationId, "applicationId");
    if (!interactionToken.trim()) throw new TypeError("interactionToken is required");
    const attachment = prepareFileAttachment(file);
    const safeMessage = {
      ...safePayload(payload),
      attachments: [{ id: 0, filename: attachment.filename }],
    };
    const path =
      "/webhooks/" +
      applicationId +
      "/" +
      encodeURIComponent(interactionToken) +
      "/messages/@original";
    return this.#request(
      "PATCH",
      path,
      undefined,
      undefined,
      "/webhooks/" + applicationId + "/[interaction-token]/messages/@original",
      interactionToken,
      () => {
        const form = new FormData();
        form.append("payload_json", JSON.stringify(safeMessage));
        form.append(
          "files[0]",
          new Blob([attachment.bytes], { type: attachment.contentType }),
          attachment.filename,
        );
        return form;
      },
    );
  }

  createInteractionFollowup(
    applicationId: Snowflake,
    interactionToken: string,
    payload: DiscordMessagePayload,
  ): Promise<DiscordMessage> {
    requireSnowflake(applicationId, "applicationId");
    if (!interactionToken.trim()) throw new TypeError("interactionToken is required");
    const path =
      "/webhooks/" + applicationId + "/" + encodeURIComponent(interactionToken);
    return this.#request(
      "POST",
      path,
      safePayload(payload),
      undefined,
      "/webhooks/" + applicationId + "/[interaction-token]",
      interactionToken,
    );
  }

}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_~|]/g, "\\$&");
}

function unixTimestamp(value: DiscordDate): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Discord date must be finite");
    }
    return Math.floor(value > 10_000_000_000 ? value / 1000 : value);
  }
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError("Discord date must be a valid date");
  }
  return Math.floor(milliseconds / 1000);
}

export function discordTimestamp(value: DiscordDate, style: "F" | "f" | "R" = "F"): string {
  return `<t:${unixTimestamp(value)}:${style}>`;
}

function displayList(values: readonly string[], emptyLabel = "None yet"): string {
  if (!values.length) {
    return emptyLabel;
  }
  return truncate(values.map((value) => `• ${escapeMarkdown(value)}`).join("\n"), 1024);
}

function componentId(parts: readonly string[]): string {
  const customId = parts.join(":");
  if (customId.length > 100) {
    throw new RangeError("Discord component custom IDs cannot exceed 100 characters");
  }
  return customId;
}

export type SignupAction =
  | "gm"
  | "player"
  | "backup"
  | "withdraw"
  | "withdraw_gm"
  | "withdraw_player";

export function signupCustomId(
  eventId: string,
  action: SignupAction,
  gameTier?: GameTier,
): string {
  return gameTier === undefined
    ? componentId(["guild", "signup", action, eventId])
    : componentId(["guild", "signup", action, String(gameTier), eventId]);
}

export type TableAction = "join" | "leave";

export function tableCustomId(planId: string, tableId: string, action: TableAction): string {
  return componentId(["guild", "table", action, planId, tableId]);
}

export function priorityPreviewCustomId(
  planId: string, tableId: string,
): string {
  return componentId(["guild", "priority", "preview", planId, tableId]);
}

export interface SignupMessageInput {
  eventId: string;
  title: string;
  startsAt: DiscordDate;
  signupDeadline?: DiscordDate;
  playerSignupOpensAt?: DiscordDate;
  description?: string;
  status: "open" | "locked" | "archived";
  audience?: "combined" | "gm" | "player";
  gmSignupEnabled?: boolean;
  playerSignupEnabled?: boolean;
  withdrawEnabled?: boolean;
  gmNames?: readonly string[];
  playerNames?: readonly string[];
  tierSignups?: readonly {
    gameTier: GameTier;
    gmNames: readonly string[];
    playerNames: readonly string[];
  }[];
  backupGmNames?: readonly string[];
  unclassifiedNames?: readonly string[];
}

export function renderSignupMessage(input: SignupMessageInput): DiscordMessagePayload {
  const gmNames = input.gmNames ?? [];
  const playerNames = input.playerNames ?? [];
  const tierSignups = input.tierSignups;
  const backupGmNames = input.backupGmNames ?? [];
  const unclassifiedNames = input.unclassifiedNames ?? [];
  const stageOpen = input.status === "open";
  const gmSignupEnabled = input.gmSignupEnabled ?? stageOpen;
  const playerSignupEnabled = input.playerSignupEnabled ?? stageOpen;
  const withdrawEnabled = input.withdrawEnabled ?? stageOpen;
  const audience = input.audience ?? "combined";
  const timing = [
    `**When:** ${discordTimestamp(input.startsAt)} (${discordTimestamp(input.startsAt, "R")})`,
    input.playerSignupOpensAt && !playerSignupEnabled
      ? `**Player signup opens:** ${discordTimestamp(input.playerSignupOpensAt)} (${discordTimestamp(input.playerSignupOpensAt, "R")})`
      : undefined,
    input.signupDeadline
      ? `**Tables publish:** ${discordTimestamp(input.signupDeadline)} (${discordTimestamp(input.signupDeadline, "R")})`
      : undefined,
    `**Status:** ${input.status[0].toUpperCase()}${input.status.slice(1)}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    embeds: [
      {
        title: truncate(`🎲 ${escapeMarkdown(input.title)}`, 256),
        description: truncate(
          [input.description ? escapeMarkdown(input.description) : undefined, timing]
            .filter(Boolean)
            .join("\n\n"),
          4096,
        ),
        color: input.status === "open" ? 0x57f287 : input.status === "locked" ? 0xfee75c : 0x99aab5,
        fields: tierSignups
          ? [
              ...tierSignups.map((tier) => ({
                name: `${gameTierDefinition(tier.gameTier).emoji} ${gameTierLabel(tier.gameTier)}`,
                value: [
                  ...(audience === "player"
                    ? []
                    : [`**GMs (${tier.gmNames.length}):** ${tier.gmNames.length ? tier.gmNames.map(escapeMarkdown).join(", ") : "None yet"}`]),
                  ...(audience === "gm"
                    ? []
                    : [`**Players (${tier.playerNames.length}):** ${tier.playerNames.length ? tier.playerNames.map(escapeMarkdown).join(", ") : "None yet"}`]),
                ].join("\n").slice(0, 1024),
              })),
              ...(audience === "player"
                ? []
                : [{
                    name: `Backup GMs (${backupGmNames.length})`,
                    value: displayList(backupGmNames),
                  }]),
              ...(unclassifiedNames.length
                ? [{
                    name: `Needs a tier (${unclassifiedNames.length})`,
                    value: displayList(unclassifiedNames),
                  }]
                : []),
            ]
          : [
              ...(audience === "player" ? [] : [{
                name: `Game Masters (${gmNames.length})`,
                value: displayList(gmNames),
                inline: true,
              }]),
              ...(audience === "gm" ? [] : [{
                name: `Players (${playerNames.length})`,
                value: displayList(playerNames),
                inline: true,
              }]),
            ],
        footer: {
          text:
            input.status === "archived"
              ? "This week is closed."
              : audience === "gm" && gmSignupEnabled
                ? "Choose the tier you plan to run. Backup GMs do not count toward player capacity."
                : audience === "player" && playerSignupEnabled
                  ? "Choose your character's tier. Picking another tier updates this week's signup."
                  : audience === "player" && input.status === "open"
                    ? "Player signup is not open yet."
              : gmSignupEnabled && !playerSignupEnabled
                ? "GM signup is open. Player signup opens at the time shown above."
                : gmSignupEnabled || playerSignupEnabled
                  ? "Choose your tier for this week. Picking another tier updates your signup."
                  : withdrawEnabled
                    ? "Tables are published. Withdraw only if you are dropping from this week's games."
                    : "Signups and withdrawals are closed for this week.",
        },
      },
    ],
    components:
      input.status === "archived"
        ? []
        : tierSignups
          ? [
              ...(audience === "player" ? [] : [{
                type: ComponentType.ActionRow,
                components: [
                  ...GAME_TIER_DEFINITIONS.map((definition) => ({
                    type: ComponentType.Button,
                    style: ButtonStyle.Primary,
                    custom_id: signupCustomId(input.eventId, "gm", definition.tier),
                    label: `Run T${definition.tier}`,
                    emoji: { name: definition.emoji },
                    disabled: !gmSignupEnabled,
                  })),
                  {
                    type: ComponentType.Button,
                    style: ButtonStyle.Secondary,
                    custom_id: signupCustomId(input.eventId, "backup"),
                    label: "Backup GM",
                    disabled: !gmSignupEnabled,
                  },
                  {
                    type: ComponentType.Button,
                    style: ButtonStyle.Danger,
                    custom_id: signupCustomId(input.eventId, "withdraw_gm"),
                    label: audience === "combined" ? "Withdraw GM" : "Withdraw",
                    disabled: !withdrawEnabled,
                  },
                ],
              }]),
              ...(audience === "gm" ? [] : [{
                type: ComponentType.ActionRow,
                components: [
                  ...GAME_TIER_DEFINITIONS.map((definition) => ({
                    type: ComponentType.Button,
                    style: ButtonStyle.Success,
                    custom_id: signupCustomId(input.eventId, "player", definition.tier),
                    label: `Play T${definition.tier}`,
                    emoji: { name: definition.emoji },
                    disabled: !playerSignupEnabled,
                  })),
                  {
                    type: ComponentType.Button,
                    style: ButtonStyle.Danger,
                    custom_id: signupCustomId(input.eventId, "withdraw_player"),
                    label: audience === "combined" ? "Withdraw Player" : "Withdraw",
                    disabled: !withdrawEnabled,
                  },
                ],
              }]),
            ]
          : [
            {
              type: ComponentType.ActionRow,
              components: [
                ...(audience === "player" ? [] : [{
                    type: ComponentType.Button,
                    style: ButtonStyle.Primary,
                    custom_id: signupCustomId(input.eventId, "gm"),
                    label: "Run a Game",
                    emoji: { name: "🧙" },
                    disabled: !gmSignupEnabled,
                  }]),
                ...(audience === "gm" ? [] : [{
                    type: ComponentType.Button,
                    style: ButtonStyle.Success,
                    custom_id: signupCustomId(input.eventId, "player"),
                    label: "Play",
                    emoji: { name: "⚔️" },
                    disabled: !playerSignupEnabled,
                  }]),
                {
                  type: ComponentType.Button,
                  style: ButtonStyle.Secondary,
                  custom_id: signupCustomId(input.eventId, "withdraw"),
                  label: "Withdraw",
                  disabled: !withdrawEnabled,
                },
              ],
            },
          ],
    allowed_mentions: safeAllowedMentions(),
  };
}

export interface TableSummaryInput {
  id: string;
  label?: string;
  gmName: string;
  capacity: number;
  players: readonly string[];
  gameTitle?: string;
  gameTier?: GameTier;
}

export interface PlanPreviewInput {
  planId: string;
  eventTitle: string;
  startsAt: DiscordDate;
  tables: readonly TableSummaryInput[];
  waitlist?: readonly string[];
  warnings?: readonly string[];
}

function tableField(table: TableSummaryInput, index: number): DiscordEmbedField {
  const seats = `${table.players.length}/${table.capacity} seats`;
  const game = table.gameTitle ? `\n*${escapeMarkdown(table.gameTitle)}*` : "";
  return {
    name: truncate(`${table.label ?? `Table ${index + 1}`} — ${escapeMarkdown(table.gmName)}`, 256),
    value: truncate(`${seats}${game}\n${displayList(table.players, "No players assigned")}`, 1024),
  };
}

export function renderPlanPreview(input: PlanPreviewInput): DiscordMessagePayload {
  const visibleTables = input.tables.slice(0, 23);
  const omitted = input.tables.length - visibleTables.length;
  const fields = visibleTables.map(tableField);
  if (input.waitlist?.length) {
    fields.push({
      name: `Waitlist (${input.waitlist.length})`,
      value: displayList(input.waitlist),
    });
  }
  if (omitted > 0) {
    fields.push({ name: "Additional tables", value: `${omitted} table(s) omitted from this preview.` });
  }

  const playerCount = input.tables.reduce((sum, table) => sum + table.players.length, 0);
  const warnings = input.warnings?.length
    ? `\n\n⚠️ ${input.warnings.map(escapeMarkdown).join("\n⚠️ ")}`
    : "";

  return {
    embeds: [
      {
        title: truncate(`🧭 Draft plan — ${escapeMarkdown(input.eventTitle)}`, 256),
        description: truncate(
          `**When:** ${discordTimestamp(input.startsAt)}\n**Tables:** ${input.tables.length}\n**Assigned players:** ${playerCount}${warnings}`,
          4096,
        ),
        color: 0x5865f2,
        fields,
        footer: { text: `Draft ${input.planId} • Nothing has been published yet.` },
      },
    ],
    allowed_mentions: safeAllowedMentions(),
  };
}

function manifestTableField(
  table: {
    label?: string;
    gmName: string;
    capacity: number;
    players: readonly string[];
    waitlist?: readonly string[];
  },
  index: number,
): DiscordEmbedField {
  const sections = [
    `**Seats:** ${table.players.length}/${table.capacity}`,
    `**Players (${table.players.length})**\n${displayList(table.players, "No players assigned")}`,
  ];
  if (table.waitlist?.length) {
    sections.push(
      `**Waitlist (${table.waitlist.length})**\n${displayList(table.waitlist)}`,
    );
  }
  return {
    name: truncate(
      `${escapeMarkdown(table.label ?? `Table ${index + 1}`)} — ${escapeMarkdown(table.gmName)}`,
      256,
    ),
    value: truncate(sections.join("\n\n"), 1024),
  };
}

export function renderFinalManifest(input: {
  planId: string;
  generation: number;
  eventTitle: string;
  startsAt: DiscordDate;
  tables: readonly {
    id: string;
    label?: string;
    gmName: string;
    capacity: number;
    players: readonly string[];
    waitlist?: readonly string[];
  }[];
  unassigned: readonly string[];
}): DiscordMessagePayload {
  const title = truncate(`📜 Final manifest — ${escapeMarkdown(input.eventTitle)}`, 256);
  const description = truncate(
    [
      `**When:** ${discordTimestamp(input.startsAt)} (${discordTimestamp(input.startsAt, "R")})`,
      `**Plan revision:** ${input.generation}`,
      `**Tables:** ${input.tables.length}`,
      "**Status:** Final — table selection is closed.",
    ].join("\n"),
    4096,
  );
  const footerText = truncate(`Plan ${input.planId} • Final manifest`, 2048);
  const overflowFieldName = "Unassigned / overflow";
  const fields: DiscordEmbedField[] = [];
  let embedCharacters = title.length + description.length + footerText.length;

  for (const [index, table] of input.tables.slice(0, 23).entries()) {
    const field = manifestTableField(table, index);
    const fieldCharacters = field.name.length + field.value.length;
    const needsOverflowAfter = input.unassigned.length > 0 || index + 1 < input.tables.length;
    const overflowReserve = needsOverflowAfter ? overflowFieldName.length + 512 : 0;
    if (
      embedCharacters + fieldCharacters + overflowReserve >
      MAX_FINAL_MANIFEST_EMBED_CHARACTERS
    ) {
      break;
    }
    fields.push(field);
    embedCharacters += fieldCharacters;
  }

  const omittedTables = input.tables.length - fields.length;
  if (input.unassigned.length || omittedTables > 0) {
    const details = [
      input.unassigned.length
        ? `**Unassigned players (${input.unassigned.length})**\n${displayList(input.unassigned)}`
        : undefined,
      omittedTables > 0
        ? `**Additional tables:** ${omittedTables} omitted from this Discord summary.`
        : undefined,
    ].filter((value): value is string => Boolean(value));
    const remainingValueCharacters = Math.min(
      1024,
      Math.max(
        1,
        MAX_FINAL_MANIFEST_EMBED_CHARACTERS - embedCharacters - overflowFieldName.length,
      ),
    );
    fields.push({
      name: overflowFieldName,
      value: truncate(details.join("\n\n"), remainingValueCharacters),
    });
  }

  return {
    embeds: [
      {
        title,
        description,
        color: 0x5865f2,
        fields,
        footer: { text: footerText },
      },
    ],
    components: [],
    allowed_mentions: safeAllowedMentions(),
  };
}

export interface PublishedTableInput extends TableSummaryInput {
  planId: string;
  eventTitle: string;
  startsAt: DiscordDate;
  waitlist?: readonly string[];
  openSeatingAt?: DiscordDate;
  openSeating?: boolean;
  closed?: boolean;
}

export function renderPublishedTable(input: PublishedTableInput): DiscordMessagePayload {
  const full = input.players.length >= input.capacity;
  const tableLabel = input.label ?? "Table";
  return {
    embeds: [
      {
        title: truncate(`⚔️ ${escapeMarkdown(tableLabel)} — ${escapeMarkdown(input.gmName)}`, 256),
        description: truncate(
          [
            `**Event:** ${escapeMarkdown(input.eventTitle)}`,
            `**When:** ${discordTimestamp(input.startsAt)} (${discordTimestamp(input.startsAt, "R")})`,
            input.gameTitle ? `**Game:** ${escapeMarkdown(input.gameTitle)}` : undefined,
            input.gameTier ? `**Tier:** ${gameTierLabel(input.gameTier)}` : undefined,
            `**Seats:** ${input.players.length}/${input.capacity}${full ? " (full)" : ""}`,
          ]
            .filter(Boolean)
            .join("\n"),
          4096,
        ),
        color: full ? 0xed4245 : 0x57f287,
        fields: [
          { name: "Players", value: displayList(input.players, "Open table — no players yet") },
          ...(input.waitlist?.length
            ? [{
                name: `Waitlist (${input.waitlist.length})`,
                value: displayList(input.waitlist),
              }]
            : []),
        ],
        footer: {
          text: input.closed
            ? "Table selection is closed."
            : input.openSeating
              ? "Open seating: any active player may claim an available seat."
            : full
              ? "This table is full; Join Waitlist records the next eligible player."
              : input.openSeatingAt
                ? `Signup-order reservations apply until ${discordTimestamp(input.openSeatingAt)}.`
                : "Join or leave using the buttons below.",
        },
      },
    ],
    components: [
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.Button,
            style: ButtonStyle.Success,
            custom_id: tableCustomId(input.planId, input.id, "join"),
            label: full ? "Join Waitlist" : "Join Table",
            disabled: Boolean(input.closed),
          },
          {
            type: ComponentType.Button,
            style: ButtonStyle.Primary,
            custom_id: priorityPreviewCustomId(input.planId, input.id),
            label: "Use DM Priority",
            disabled: Boolean(input.closed),
          },
          {
            type: ComponentType.Button,
            style: ButtonStyle.Secondary,
            custom_id: tableCustomId(input.planId, input.id, "leave"),
            label: "Leave Table",
            disabled: Boolean(input.closed),
          },
        ],
      },
    ],
    allowed_mentions: safeAllowedMentions(),
  };
}

export function renderPublishedTables(
  tables: readonly PublishedTableInput[],
): DiscordMessagePayload[] {
  return tables.map(renderPublishedTable);
}

export interface ReminderMessageInput {
  eventTitle: string;
  startsAt: DiscordDate;
  body: string;
  roleIds?: readonly Snowflake[];
  heading?: string;
}

export function renderReminderMessage(input: ReminderMessageInput): DiscordMessagePayload {
  const roleIds = input.roleIds ?? [];
  const pings = roleIds.map((roleId) => `<@&${requireSnowflake(roleId, "roleId")}>`).join(" ");
  const content = [
    pings || undefined,
    `⏰ **${escapeMarkdown(input.heading ?? "Guild reminder")}**`,
    `**${escapeMarkdown(input.eventTitle)}** is ${discordTimestamp(input.startsAt, "R")} (${discordTimestamp(input.startsAt)}).`,
    escapeMarkdown(input.body),
  ]
    .filter(Boolean)
    .join("\n");

  return {
    content: truncate(content, 2000),
    allowed_mentions: safeAllowedMentions(roleIds),
  };
}
