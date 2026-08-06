import { describe, expect, it, vi } from "vitest";
import { DiscordRestClient, safeAllowedMentions } from "../src/discord-api";

describe("DiscordRestClient thread endpoints", () => {
  it("uses Discord API v10 thread creation, recovery, and archive routes", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ id: "200", type: 11, parent_id: "100" }))
      .mockResolvedValueOnce(Response.json({ id: "201", type: 11, parent_id: "101" }))
      .mockResolvedValueOnce(Response.json({ threads: [] }))
      .mockResolvedValueOnce(Response.json({ id: "200", type: 11, archived: true }));
    const client = new DiscordRestClient("test-token", {
      apiBaseUrl: "https://discord.test/api/v10",
      fetch: fetchMock as typeof fetch,
    });

    await client.startThreadFromMessage("100", "200", {
      name: "Aug 11 • T2 Table 1 • FrankB",
      auto_archive_duration: 10080,
    });
    await client.startForumThread("101", {
      name: "Aug 11 • T2 Table 2 • New DM",
      auto_archive_duration: 10080,
      message: {
        content: "The DM will post the introduction here.",
        allowed_mentions: safeAllowedMentions(),
      },
    });
    await client.listActiveGuildThreads("300");
    await client.editChannel("200", { archived: true, locked: true });

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ["https://discord.test/api/v10/channels/100/messages/200/threads", "POST"],
      ["https://discord.test/api/v10/channels/101/threads", "POST"],
      ["https://discord.test/api/v10/guilds/300/threads/active", "GET"],
      ["https://discord.test/api/v10/channels/200", "PATCH"],
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1].body))).toMatchObject({
      name: "Aug 11 • T2 Table 2 • New DM",
      message: { allowed_mentions: { parse: [], roles: [], users: [] } },
    });
    expect(JSON.parse(String(fetchMock.mock.calls[3]![1].body))).toEqual({
      archived: true,
      locked: true,
    });
  });
});
