import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ButtonStyle,
  ComponentType,
  DiscordApiError,
  DiscordRestClient,
  discordNonce,
  discordTimestamp,
  renderFinalManifest,
  renderPlanPreview,
  renderPublishedTable,
  renderPublishedTables,
  renderReminderMessage,
  renderSignupMessage,
  safeAllowedMentions,
  signupCustomId,
  tableCustomId,
} from "../src/discord-api";

const BOT_TOKEN = "not-a-real-bot-token";
const API_BASE_URL = "https://discord.test/api/v10";

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

describe("safeAllowedMentions", () => {
  it("allows only the exact, unique role IDs supplied", () => {
    expect(safeAllowedMentions(["123", "456", "123"])).toEqual({
      parse: [],
      roles: ["123", "456"],
      users: [],
      replied_user: false,
    });
  });

  it("rejects non-snowflakes and Discord's role mention limit", () => {
    expect(() => safeAllowedMentions(["@everyone"])).toThrow("Discord snowflake");
    expect(() =>
      safeAllowedMentions(Array.from({ length: 101 }, (_, index) => String(index + 1))),
    ).toThrow("at most 100");
  });
});

describe("discordNonce", () => {
  it("is deterministic, distinct, and within Discord's 25-character limit", () => {
    expect(discordNonce("signup:event-1")).toBe(discordNonce("signup:event-1"));
    expect(discordNonce("signup:event-1")).not.toBe(discordNonce("signup:event-2"));
    expect(discordNonce("x".repeat(500))).toMatch(/^\d{1,20}$/);
  });
});

describe("DiscordRestClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: DiscordRestClient;

  beforeEach(() => {
    fetchMock = vi.fn();
    client = new DiscordRestClient(BOT_TOKEN, {
      apiBaseUrl: `${API_BASE_URL}/`,
      fetch: fetchMock as typeof fetch,
    });
  });

  it("keeps the default Worker fetch receiver attached to globalThis", async () => {
    const receiverAwareFetch = vi.fn(function (
      this: unknown,
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ): Promise<Response> {
      expect(this).toBe(globalThis);
      return Promise.resolve(
        jsonResponse({ id: "900", channel_id: "200", content: "hello" }),
      );
    });
    vi.stubGlobal("fetch", receiverAwareFetch as typeof fetch);

    try {
      const defaultClient = new DiscordRestClient(BOT_TOKEN, {
        apiBaseUrl: `${API_BASE_URL}/`,
      });

      await defaultClient.sendChannelMessage("200", { content: "hello" });

      expect(receiverAwareFetch).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("sends channel messages through API v10 with safe mentions", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: "900", channel_id: "200", content: "hello" }),
    );

    const result = await client.sendChannelMessage("200", {
      content: "@everyone hello <@&300>",
      allowed_mentions: safeAllowedMentions(["300"]),
    });

    expect(result.id).toBe("900");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_BASE_URL}/channels/200/messages`);
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Bot ${BOT_TOKEN}`);
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init.body))).toMatchObject({
      content: "@everyone hello <@&300>",
      allowed_mentions: {
        parse: [],
        roles: ["300"],
        users: [],
        replied_user: false,
      },
    });
  });

  it("overrides unsafe mention fields at runtime", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: "900", channel_id: "200", content: "@everyone" }),
    );

    await client.sendChannelMessage("200", {
      content: "@everyone <@123>",
      allowed_mentions: {
        parse: ["everyone", "users"],
        roles: ["300"],
        users: ["123"],
        replied_user: true,
      },
    } as never);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).allowed_mentions).toEqual({
      parse: [],
      roles: ["300"],
      users: [],
      replied_user: false,
    });
  });

  it("edits a channel message with PATCH and an explicit no-mentions policy", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: "900", channel_id: "200", content: "updated" }),
    );

    await client.editChannelMessage("200", "900", { content: "updated" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_BASE_URL}/channels/200/messages/900`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body)).allowed_mentions).toEqual({
      parse: [],
      roles: [],
      users: [],
      replied_user: false,
    });
  });

  it("uses the member and role endpoints needed by reconciliation diagnostics", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ roles: ["30"], user: { id: "20", username: "GM" } }))
      .mockResolvedValueOnce(jsonResponse({ id: "99", username: "Bot", bot: true }))
      .mockResolvedValueOnce(jsonResponse({ roles: ["40"], user: { id: "99", username: "Bot" } }))
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: "40",
            name: "Assistant",
            color: 0,
            position: 5,
            permissions: "0",
            managed: true,
            mentionable: false,
          },
        ]),
      );

    await client.getGuildMember("10", "20");
    await client.getCurrentBotGuildMember("10");
    await client.getGuildRoles("10");

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `${API_BASE_URL}/guilds/10/members/20`,
      `${API_BASE_URL}/users/@me`,
      `${API_BASE_URL}/guilds/10/members/99`,
      `${API_BASE_URL}/guilds/10/roles`,
    ]);
    expect(fetchMock.mock.calls.every(([, init]) => (init as RequestInit).method === "GET")).toBe(
      true,
    );
  });

  it("checks that a configured channel still exists", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: "200", type: 0, guild_id: "10", name: "game-signups" }),
    );

    const channel = await client.getChannel("200");

    expect(channel.name).toBe("game-signups");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API_BASE_URL}/channels/200`);
  });

  it("lists guild channels for setup preset discovery", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([{ id: "200", type: 0, guild_id: "10", name: "gm-sign-up" }]),
    );

    const channels = await client.getGuildChannels("10");

    expect(channels).toEqual([
      expect.objectContaining({ id: "200", name: "gm-sign-up" }),
    ]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API_BASE_URL}/guilds/10/channels`);
  });
  it("opens a DM and enforces a stable nonce with no allowed mentions", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: "700", type: 1 }))
      .mockResolvedValueOnce(
        jsonResponse({ id: "900", channel_id: "700", content: "private" }),
      );

    const message = await client.sendDirectMessage(
      "20",
      {
        content: "@everyone private <@20>",
        allowed_mentions: {
          parse: ["everyone", "users"],
          roles: ["30"],
          users: ["20"],
          replied_user: true,
        } as never,
      },
      "priority-notification:one",
    );

    expect(message.id).toBe("900");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [openUrl, openInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(openUrl).toBe(`${API_BASE_URL}/users/@me/channels`);
    expect(openInit.method).toBe("POST");
    expect(JSON.parse(String(openInit.body))).toEqual({ recipient_id: "20" });

    const [sendUrl, sendInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(sendUrl).toBe(`${API_BASE_URL}/channels/700/messages`);
    expect(sendInit.method).toBe("POST");
    expect(JSON.parse(String(sendInit.body))).toMatchObject({
      nonce: discordNonce("priority-notification:one"),
      enforce_nonce: true,
      allowed_mentions: safeAllowedMentions(),
    });
  });

  it("rejects invalid DM recipients and empty delivery keys before fetching", async () => {
    await expect(
      client.sendDirectMessage("not-a-snowflake", { content: "private" }, "delivery"),
    ).rejects.toThrow("Discord snowflake");
    await expect(
      client.sendDirectMessage("20", { content: "private" }, "   "),
    ).rejects.toThrow("deliveryKey is required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("updates deferred interaction responses without exposing the interaction token", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: "900", channel_id: "200", content: "done" }),
    );

    await client.editOriginalInteractionResponse("100", "sensitive-token", {
      content: "done",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      API_BASE_URL + "/webhooks/100/sensitive-token/messages/@original",
    );
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body)).allowed_mentions).toEqual(
      safeAllowedMentions(),
    );
  });

  it("edits deferred interaction responses with a bounded multipart attachment", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: "900", channel_id: "200", content: "Export ready" }),
    );

    await client.editOriginalInteractionResponseWithFile(
      "100",
      "sensitive-token",
      {
        content: "@everyone Export ready",
        allowed_mentions: {
          parse: ["everyone"],
          roles: ["300"],
          users: ["400"],
          replied_user: true,
        } as never,
      },
      {
        filename: "weekly-tables.csv",
        content: "player,table\nChappy,1\n",
        contentType: "text/csv;charset=utf-8",
      },
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      API_BASE_URL + "/webhooks/100/sensitive-token/messages/@original",
    );
    expect(init.method).toBe("PATCH");
    expect(new Headers(init.headers).get("content-type")).toBeNull();
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(JSON.parse(String(form.get("payload_json")))).toEqual({
      content: "@everyone Export ready",
      allowed_mentions: safeAllowedMentions(["300"]),
      attachments: [{ id: 0, filename: "weekly-tables.csv" }],
    });
    const uploaded = form.get("files[0]") as File;
    expect(uploaded.name).toBe("weekly-tables.csv");
    expect(uploaded.type).toBe("text/csv;charset=utf-8");
    expect(await uploaded.text()).toBe("player,table\nChappy,1\n");
  });

  it("rejects unsafe or oversized attachments before fetching", () => {
    expect(() =>
      client.editOriginalInteractionResponseWithFile(
        "100",
        "sensitive-token",
        { content: "Export ready" },
        { filename: "../weekly.csv", content: "safe" },
      ),
    ).toThrow("path separators");
    expect(() =>
      client.editOriginalInteractionResponseWithFile(
        "100",
        "sensitive-token",
        { content: "Export ready" },
        { filename: "x".repeat(256), content: "safe" },
      ),
    ).toThrow("255 characters");
    expect(() =>
      client.editOriginalInteractionResponseWithFile(
        "100",
        "sensitive-token",
        { content: "Export ready" },
        { filename: "weekly.csv", content: "x".repeat(512 * 1024 + 1) },
      ),
    ).toThrow("524288 bytes");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates fresh multipart data for a Discord rate-limit retry", async () => {
    vi.useFakeTimers();
    try {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({ message: "Rate limited", retry_after: 0 }, 429),
        )
        .mockResolvedValueOnce(
          jsonResponse({ id: "900", channel_id: "200", content: "Export ready" }),
        );

      const pending = client.editOriginalInteractionResponseWithFile(
        "100",
        "sensitive-token",
        { content: "Export ready" },
        { filename: "weekly.csv", content: new Uint8Array([1, 2, 3]) },
      );
      await vi.runAllTimersAsync();
      await pending;

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const firstBody = (fetchMock.mock.calls[0]?.[1] as RequestInit).body as FormData;
      const secondBody = (fetchMock.mock.calls[1]?.[1] as RequestInit).body as FormData;
      expect(firstBody).toBeInstanceOf(FormData);
      expect(secondBody).toBeInstanceOf(FormData);
      expect(secondBody).not.toBe(firstBody);
      expect(await (firstBody.get("files[0]") as File).arrayBuffer()).toEqual(
        await (secondBody.get("files[0]") as File).arrayBuffer(),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("redacts interaction tokens from multipart response errors", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ message: "bad sensitive-token", code: 50_027 }, 401),
    );

    const error = await client
      .editOriginalInteractionResponseWithFile(
        "100",
        "sensitive-token",
        { content: "Export ready" },
        { filename: "weekly.csv", content: "player,table" },
      )
      .catch((caught: unknown) => caught);

    expect(String(error)).not.toContain("sensitive-token");
    expect(String(error)).toContain("[interaction-token]");
    expect((error as DiscordApiError).body).toMatchObject({
      message: "bad [REDACTED]",
    });
  });

  it("redacts interaction tokens from deferred-response errors", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { message: "bad sensitive-token", code: 50_027 },
        401,
      ),
    );

    const error = await client
      .editOriginalInteractionResponse("100", "sensitive-token", { content: "x" })
      .catch((caught: unknown) => caught);

    expect(String(error)).not.toContain("sensitive-token");
    expect(String(error)).toContain("[interaction-token]");
    expect((error as DiscordApiError).body).toMatchObject({
      message: "bad [REDACTED]",
    });
  });

  it("does not expose Discord member role mutation methods", () => {
    expect("addMemberRole" in client).toBe(false);
    expect("removeMemberRole" in client).toBe(false);
  });

  it("bounds Discord rate-limit retries at three attempts", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          jsonResponse(
            {
              message: "Rate limited",
              retry_after: 0,
            },
            429,
          ),
        ),
      );

      const pending = client
        .getGuildRoles("10")
        .catch((caught: unknown) => caught as DiscordApiError);
      await vi.runAllTimersAsync();
      const error = await pending;

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(error).toBeInstanceOf(DiscordApiError);
      expect(error).toMatchObject({
        status: 429,
        body: {
          message: "Rate limited",
          retry_after: 0,
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns a typed error with Discord status, code, and safe body", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          code: 50_013,
          message: `Missing Permissions ${BOT_TOKEN}`,
          errors: { authorization: BOT_TOKEN },
        },
        403,
      ),
    );

    const error = await client.getGuildRoles("10").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DiscordApiError);
    expect(error).toMatchObject({
      status: 403,
      code: 50_013,
      body: {
        code: 50_013,
        message: "Missing Permissions [REDACTED]",
        errors: { authorization: "[REDACTED]" },
      },
    });
    expect(String(error)).not.toContain(BOT_TOKEN);
  });

  it("redacts the token from network errors", async () => {
    fetchMock.mockRejectedValue(new Error(`connection failed for ${BOT_TOKEN}`));

    const error = await client.getGuildRoles("10").catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status: 0, body: "connection failed for [REDACTED]" });
    expect(String(error)).not.toContain(BOT_TOKEN);
  });

  it("rejects invalid IDs before making a request", async () => {
    expect(() => client.getGuildMember("../guild", "20")).toThrow(
      "guildId must be a Discord snowflake",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Discord message rendering", () => {
  const startsAt = "2026-08-08T18:00:00.000Z";

  it("renders an open signup with GM, player, and withdraw actions", () => {
    const message = renderSignupMessage({
      eventId: "event-1",
      title: "Saturday Games",
      startsAt,
      signupDeadline: "2026-08-07T18:00:00.000Z",
      description: "Choose your role for this week.",
      status: "open",
      gmNames: ["Brett"],
      playerNames: ["Chappy", "@everyone"],
    });

    expect(message.allowed_mentions).toEqual(safeAllowedMentions());
    expect(message.embeds?.[0]).toMatchObject({
      title: "🎲 Saturday Games",
      color: 0x57f287,
      fields: [
        { name: "Game Masters (1)", value: "• Brett" },
        { name: "Players (2)", value: "• Chappy\n• @everyone" },
      ],
    });
    expect(message.embeds?.[0].description).toContain("<t:1786212000:F>");
    expect(message.components?.[0]).toEqual({
      type: ComponentType.ActionRow,
      components: [
        expect.objectContaining({
          style: ButtonStyle.Primary,
          custom_id: "guild:signup:gm:event-1",
          disabled: false,
        }),
        expect.objectContaining({
          style: ButtonStyle.Success,
          custom_id: "guild:signup:player:event-1",
          disabled: false,
        }),
        expect.objectContaining({
          style: ButtonStyle.Secondary,
          custom_id: "guild:signup:withdraw:event-1",
          disabled: false,
        }),
      ],
    });
  });
  it("renders focused GM and player signup cards without broad mentions", () => {
    const gmCard = renderSignupMessage({
      eventId: "event-1",
      title: "Games",
      startsAt,
      status: "open",
      audience: "gm",
      playerSignupEnabled: false,
    });
    const playerCard = renderSignupMessage({
      eventId: "event-1",
      title: "Games",
      startsAt,
      status: "open",
      audience: "player",
      gmSignupEnabled: false,
    });

    expect(gmCard.components?.[0]?.components.map((button) => button.label)).toEqual([
      "Run a Game", "Withdraw",
    ]);
    expect(gmCard.embeds?.[0]?.fields?.map((field) => field.name)).toEqual([
      "Game Masters (0)",
    ]);
    expect(playerCard.components?.[0]?.components.map((button) => button.label)).toEqual([
      "Play", "Withdraw",
    ]);
    expect(playerCard.allowed_mentions).toEqual(safeAllowedMentions());
  });


  it("renders weekly tier snapshots with GM, backup, player, and withdrawal controls", () => {
    const message = renderSignupMessage({
      eventId: "event-tiered",
      title: "Tuesday Games",
      startsAt,
      status: "open",
      tierSignups: [
        { gameTier: 1, gmNames: ["GM One"], playerNames: ["Player One"] },
        { gameTier: 2, gmNames: [], playerNames: ["Player Two"] },
        { gameTier: 3, gmNames: [], playerNames: [] },
      ],
      backupGmNames: ["Backup One"],
    });

    expect(message.embeds?.[0].fields?.map((field) => field.name)).toEqual([
      "Tier 1 · Levels 3–4",
      "Tier 2 · Levels 5–7",
      "Tier 3 · Levels 8+",
      "Backup GMs (1)",
    ]);
    expect(message.components).toHaveLength(2);
    expect(message.components?.[0].components.map((button) => button.custom_id)).toEqual([
      "guild:signup:gm:1:event-tiered",
      "guild:signup:gm:2:event-tiered",
      "guild:signup:gm:3:event-tiered",
      "guild:signup:backup:event-tiered",
      "guild:signup:withdraw:event-tiered",
    ]);
    expect(message.components?.[1].components.map((button) => button.custom_id)).toEqual([
      "guild:signup:player:1:event-tiered",
      "guild:signup:player:2:event-tiered",
      "guild:signup:player:3:event-tiered",
    ]);
  });

  it("focuses tier fields and controls for separate GM and player posts", () => {
    const shared = {
      eventId: "event-tiered",
      title: "Tuesday Games",
      startsAt,
      status: "open" as const,
      tierSignups: [
        { gameTier: 1 as const, gmNames: ["GM One"], playerNames: ["Player One"] },
        { gameTier: 2 as const, gmNames: [], playerNames: ["Player Two"] },
        { gameTier: 3 as const, gmNames: [], playerNames: [] },
      ],
      backupGmNames: ["Backup One"],
    };

    const gmCard = renderSignupMessage({ ...shared, audience: "gm" });
    const playerCard = renderSignupMessage({ ...shared, audience: "player" });

    expect(gmCard.embeds?.[0]?.fields?.map((field) => field.name)).toEqual([
      "Tier 1 · Levels 3–4",
      "Tier 2 · Levels 5–7",
      "Tier 3 · Levels 8+",
      "Backup GMs (1)",
    ]);
    expect(gmCard.embeds?.[0]?.fields?.[0]?.value).toBe("**GMs (1):** GM One");
    expect(gmCard.components?.[0]?.components.map((button) => button.label)).toEqual([
      "Run T1", "Run T2", "Run T3", "Backup GM", "Withdraw",
    ]);

    expect(playerCard.embeds?.[0]?.fields?.map((field) => field.name)).toEqual([
      "Tier 1 · Levels 3–4",
      "Tier 2 · Levels 5–7",
      "Tier 3 · Levels 8+",
    ]);
    expect(playerCard.embeds?.[0]?.fields?.[0]?.value).toBe("**Players (1):** Player One");
    expect(playerCard.components?.[0]?.components.map((button) => button.label)).toEqual([
      "Play T1", "Play T2", "Play T3", "Withdraw",
    ]);
  });

  it("disables signup actions when locked and removes them when archived", () => {
    const locked = renderSignupMessage({
      eventId: "event-1",
      title: "Games",
      startsAt,
      status: "locked",
    });
    const archived = renderSignupMessage({
      eventId: "event-1",
      title: "Games",
      startsAt,
      status: "archived",
    });

    expect(locked.components?.[0].components.every((button) => button.disabled)).toBe(true);
    expect(archived.components).toEqual([]);
  });

  it("keeps only withdrawal available after signup choices lock", () => {
    const locked = renderSignupMessage({
      eventId: "event-1",
      title: "Games",
      startsAt,
      status: "locked",
      audience: "gm",
      gmSignupEnabled: false,
      withdrawEnabled: true,
      tierSignups: [
        { gameTier: 1, gmNames: ["GM One"], playerNames: [] },
        { gameTier: 2, gmNames: [], playerNames: [] },
        { gameTier: 3, gmNames: [], playerNames: [] },
      ],
    });

    expect(locked.components?.[0]?.components.map((button) => ({
      label: button.label,
      disabled: button.disabled,
    }))).toEqual([
      { label: "Run T1", disabled: true },
      { label: "Run T2", disabled: true },
      { label: "Run T3", disabled: true },
      { label: "Backup GM", disabled: true },
      { label: "Withdraw", disabled: false },
    ]);
    expect(locked.embeds?.[0]?.footer?.text).toContain("Withdraw only");
  });

  it("renders a plan preview with table balance, waitlist, and warnings", () => {
    const preview = renderPlanPreview({
      planId: "plan-1",
      eventTitle: "Saturday Games",
      startsAt,
      tables: [
        {
          id: "table-1",
          label: "Table 1",
          gmName: "Brett",
          capacity: 5,
          players: ["A", "B", "C", "D"],
          gameTitle: "The Sunless Citadel",
        },
      ],
      waitlist: ["E"],
      warnings: ["One open seat"],
    });

    expect(preview.allowed_mentions).toEqual(safeAllowedMentions());
    expect(preview.embeds?.[0].description).toContain("**Assigned players:** 4");
    expect(preview.embeds?.[0].description).toContain("⚠️ One open seat");
    expect(preview.embeds?.[0].fields).toEqual([
      expect.objectContaining({ name: "Table 1 — Brett" }),
      { name: "Waitlist (1)", value: "• E" },
    ]);
  });

  it("renders a safe, closed final manifest with waitlists and unassigned players", () => {
    const manifest = renderFinalManifest({
      planId: "plan-1",
      generation: 3,
      eventTitle: "**Saturday Games** @everyone",
      startsAt,
      tables: [
        {
          id: "table-1",
          label: "*Table One*",
          gmName: "_Brett_",
          capacity: 6,
          players: ["Chappy", "@everyone"],
          waitlist: ["Wait*One"],
        },
      ],
      unassigned: ["No_Table"],
    });

    expect(manifest.allowed_mentions).toEqual(safeAllowedMentions());
    expect(manifest.components).toEqual([]);
    expect(manifest.embeds).toHaveLength(1);
    expect(manifest.embeds?.[0].title).toBe(
      "📜 Final manifest — \\*\\*Saturday Games\\*\\* @everyone",
    );
    expect(manifest.embeds?.[0].description).toContain("**Plan revision:** 3");
    expect(manifest.embeds?.[0].description).toContain("table selection is closed");
    expect(manifest.embeds?.[0].fields?.[0]).toMatchObject({
      name: "\\*Table One\\* — \\_Brett\\_",
    });
    expect(manifest.embeds?.[0].fields?.[0]?.value).toContain("**Seats:** 2/6");
    expect(manifest.embeds?.[0].fields?.[0]?.value).toContain("**Waitlist (1)**");
    expect(manifest.embeds?.[0].fields?.[0]?.value).toContain("Wait\\*One");
    expect(manifest.embeds?.[0].fields?.[1]).toMatchObject({
      name: "Unassigned / overflow",
      value: expect.stringContaining("No\\_Table"),
    });
  });

  it("limits final manifests to 23 table fields plus one overflow field", () => {
    const manifest = renderFinalManifest({
      planId: "plan-25",
      generation: 1,
      eventTitle: "Large Guild Night",
      startsAt,
      tables: Array.from({ length: 25 }, (_, index) => ({
        id: `table-${index + 1}`,
        label: `Table ${index + 1}`,
        gmName: `GM ${index + 1}`,
        capacity: 6,
        players: [`Player ${index + 1}`],
      })),
      unassigned: ["Waiting Player"],
    });

    const fields = manifest.embeds?.[0].fields ?? [];
    expect(fields).toHaveLength(24);
    expect(fields.slice(0, 23).every((field) => field.name.startsWith("Table "))).toBe(true);
    expect(fields[23]).toMatchObject({
      name: "Unassigned / overflow",
      value: expect.stringContaining("**Additional tables:** 2"),
    });
    expect(fields[23]?.value).toContain("Waiting Player");
    expect(fields.every((field) => field.value.length <= 1024)).toBe(true);
  });

  it("keeps adversarial final manifests below Discord's aggregate embed budget", () => {
    const manifest = renderFinalManifest({
      planId: "plan-very-large",
      generation: 999,
      eventTitle: "X".repeat(1_000),
      startsAt,
      tables: Array.from({ length: 40 }, (_, tableIndex) => ({
        id: `table-${tableIndex}`,
        label: "Table " + "L".repeat(400),
        gmName: "G".repeat(400),
        capacity: 20,
        players: Array.from(
          { length: 20 },
          (_, playerIndex) => `Player ${tableIndex}-${playerIndex} ${"P".repeat(250)}`,
        ),
        waitlist: Array.from(
          { length: 20 },
          (_, playerIndex) => `Wait ${tableIndex}-${playerIndex} ${"W".repeat(250)}`,
        ),
      })),
      unassigned: Array.from(
        { length: 100 },
        (_, playerIndex) => `Unassigned ${playerIndex} ${"U".repeat(250)}`,
      ),
    });

    const embed = manifest.embeds?.[0];
    expect(embed).toBeDefined();
    const aggregateCharacters =
      (embed?.title?.length ?? 0) +
      (embed?.description?.length ?? 0) +
      (embed?.footer?.text.length ?? 0) +
      (embed?.fields ?? []).reduce(
        (total, field) => total + field.name.length + field.value.length,
        0,
      );
    expect(aggregateCharacters).toBeLessThanOrEqual(5_800);
    expect(embed?.fields?.length ?? 0).toBeLessThanOrEqual(25);
  });

  it("renders published table controls and exposes a waitlist path when full", () => {
    const table = renderPublishedTable({
      planId: "plan-1",
      id: "table-1",
      label: "Table 1",
      gmName: "Brett",
      capacity: 4,
      players: ["A", "B", "C", "D"],
      waitlist: ["E"],
      eventTitle: "Saturday Games",
      startsAt,
    });

    expect(table.embeds?.[0].description).toContain("**Seats:** 4/4 (full)");
    expect(table.components?.[0].components).toEqual([
      expect.objectContaining({
        label: "Join Waitlist",
        custom_id: "guild:table:join:plan-1:table-1",
        disabled: false,
      }),
      expect.objectContaining({
        label: "Use DM Priority",
        custom_id: "guild:priority:preview:plan-1:table-1",
        disabled: false,
      }),
      expect.objectContaining({
        label: "Leave Table",
        custom_id: "guild:table:leave:plan-1:table-1",
        disabled: false,
      }),
    ]);
    expect(table.embeds?.[0].fields).toContainEqual({
      name: "Waitlist (1)",
      value: "• E",
    });
    expect(renderPublishedTables([{
      planId: "plan-1",
      id: "table-1",
      gmName: "Brett",
      capacity: 4,
      players: [],
      eventTitle: "Saturday Games",
      startsAt,
    }])).toHaveLength(1);
  });

  it("renders role-pinging reminders without enabling users or everyone", () => {
    const reminder = renderReminderMessage({
      eventTitle: "Saturday Games",
      startsAt,
      heading: "GM signup closes soon",
      body: "Please respond, @everyone and <@999>.",
      roleIds: ["111", "222", "111"],
    });

    expect(reminder.content).toContain("<@&111> <@&222> <@&111>");
    expect(reminder.content).toContain("@everyone and <@999>");
    expect(reminder.allowed_mentions).toEqual({
      parse: [],
      roles: ["111", "222"],
      users: [],
      replied_user: false,
    });
  });

  it("formats timestamps and enforces Discord's component ID limit", () => {
    expect(discordTimestamp(1_786_212_000, "R")).toBe("<t:1786212000:R>");
    expect(discordTimestamp(new Date(startsAt))).toBe("<t:1786212000:F>");
    expect(signupCustomId("event-1", "gm")).toBe("guild:signup:gm:event-1");
    expect(tableCustomId("plan-1", "table-1", "join")).toBe(
      "guild:table:join:plan-1:table-1",
    );
    expect(() => signupCustomId("x".repeat(100), "gm")).toThrow("cannot exceed 100");
  });
});
