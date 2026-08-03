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

  it("replaces a deferred command response when an async command handler fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ id: "302", channel_id: "400", content: "done" }),
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
        id: "502",
        application_id: "1533171671886725293",
        token: "interaction-token",
        type: 2,
        guild_id: "1533181439376494642",
        member: {
          permissions: "32",
          user: { id: "1533183019031199946", username: "Chappy" },
        },
        data: {
          name: "guild",
          options: [{ type: 1, name: "setup", options: [] }],
        },
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
      content:
        "⚠️ An unexpected error stopped `/guild setup`. Retry once. If it fails again, give an administrator reference `502`; `/guild doctor` checks setup only and may still be green.",
      allowed_mentions: { parse: [] },
    });
  });

  it("refuses a legacy roles command without attempting a role mutation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ id: "303", channel_id: "400", content: "done" }),
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
        id: "503",
        application_id: "1533171671886725293",
        token: "interaction-token",
        type: 2,
        guild_id: "1533181439376494642",
        data: {
          name: "roles",
          options: [{ type: 1, name: "sync", options: [] }],
        },
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
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      content:
        "This command has been retired. Ask a server admin if you need a role change.",
      allowed_mentions: { parse: [] },
    });
  });

  it("rejects an unconfirmed week cancellation before reading or changing data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ id: "304", channel_id: "400", content: "done" }),
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
        id: "504",
        application_id: "1533171671886725293",
        token: "interaction-token",
        type: 2,
        guild_id: "1533181439376494642",
        member: {
          permissions: "32",
          user: { id: "1533183019031199946", username: "Chappy" },
        },
        data: {
          name: "week",
          options: [{
            type: 1,
            name: "cancel",
            options: [
              {
                type: 3,
                name: "reason",
                value: "Accidental cancellation test",
              },
              {
                type: 5,
                name: "confirm",
                value: false,
              },
            ],
          }],
        },
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
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      content:
        "⚠️ Cancellation was not confirmed, so nothing changed. Set confirm to True only when you intend to stop the active week. You can later redo an unfinished cancelled week with `/week restart confirm:True`.",
      allowed_mentions: { parse: [] },
    });
  });
});
