import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ButtonStyle,
  ComponentType,
  DiscordApiError,
  DiscordRestClient,
  discordNonce,
  discordTimestamp,
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
      .mockResolvedValueOnce(jsonResponse({ roles: ["40"], user: { id: "10", username: "Bot" } }))
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
      `${API_BASE_URL}/users/@me/guilds/10/member`,
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

  it("adds and removes roles and URL-encodes the audit log reason", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await client.addMemberRole("10", "20", "30", "Weekly GM — table 1");
    await client.removeMemberRole("10", "20", "30", "Weekly GM ended");

    const [addUrl, addInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [removeUrl, removeInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(addUrl).toBe(`${API_BASE_URL}/guilds/10/members/20/roles/30`);
    expect(addInit.method).toBe("PUT");
    expect(new Headers(addInit.headers).get("x-audit-log-reason")).toBe(
      "Weekly%20GM%20%E2%80%94%20table%201",
    );
    expect(removeUrl).toBe(`${API_BASE_URL}/guilds/10/members/20/roles/30`);
    expect(removeInit.method).toBe("DELETE");
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
