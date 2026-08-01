import { afterEach, describe, expect, it, vi } from "vitest";
import { handleDiscordInteraction } from "../src/app";

const env = {
  DB: {} as D1Database,
  DISCORD_PUBLIC_KEY: "public",
  DISCORD_BOT_TOKEN: "bot-secret",
  DISCORD_APPLICATION_ID: "1533171671886725293",
  DISCORD_TEST_GUILD_ID: "1533181439376494642",
} satisfies Env;

describe("deferred Discord interactions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("acknowledges a command immediately and edits the private response in waitUntil", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ id: "300", channel_id: "400", content: "done" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    let background: Promise<unknown> | undefined;
    const context = {
      waitUntil(promise: Promise<unknown>) {
        background = promise;
      },
    } as ExecutionContext;

    const response = await handleDiscordInteraction(
      {
        id: "500",
        application_id: "1533171671886725293",
        token: "interaction-token",
        type: 2,
        data: { name: "unknown" },
      },
      env,
      context,
    );

    expect(await response.json()).toEqual({
      type: 5,
      data: { flags: 64 },
    });
    expect(background).toBeDefined();
    await background;
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://discord.com/api/v10/webhooks/1533171671886725293/interaction-token/messages/@original",
    );
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toMatchObject({
      content: "I don't recognize that command yet.",
      allowed_mentions: { parse: [] },
    });
    expect(JSON.parse(String(init.body))).not.toHaveProperty("flags");
  });

  it("acknowledges a component immediately and sends validation feedback privately", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ id: "301", channel_id: "400", content: "done" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    let background: Promise<unknown> | undefined;
    const context = {
      waitUntil(promise: Promise<unknown>) {
        background = promise;
      },
    } as ExecutionContext;

    const response = await handleDiscordInteraction(
      {
        id: "501",
        application_id: "1533171671886725293",
        token: "interaction-token",
        type: 3,
        guild_id: "1533181439376494642",
        member: { user: { id: "1533183019031199946" } },
        data: { custom_id: "obsolete-control" },
      },
      env,
      context,
    );

    expect(await response.json()).toEqual({ type: 6 });
    expect(background).toBeDefined();
    await background;
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://discord.com/api/v10/webhooks/1533171671886725293/interaction-token",
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({
      content: "⚠️ This control is no longer recognized.",
      flags: 64,
      allowed_mentions: { parse: [] },
    });
  });
});
