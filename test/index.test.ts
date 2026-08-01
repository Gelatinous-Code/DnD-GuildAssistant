import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("discord-interactions", () => ({
  verifyKey: vi.fn(),
}));

import { verifyKey } from "discord-interactions";
import { handleRequest } from "../src/index";

const mockedVerifyKey = vi.mocked(verifyKey);
const env = {
  DB: {} as D1Database,
  DISCORD_PUBLIC_KEY: "test-public-key",
  DISCORD_BOT_TOKEN: "test-bot-token",
  DISCORD_APPLICATION_ID: "1533171671886725293",
  DISCORD_TEST_GUILD_ID: "1533181439376494642",
} satisfies Env;

function discordRequest(body: unknown): Request {
  return new Request("https://example.test/interactions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": "test-signature",
      "x-signature-timestamp": "1234567890",
    },
    body: JSON.stringify(body),
  });
}

describe("Discord interaction endpoint", () => {
  beforeEach(() => {
    mockedVerifyKey.mockClear();
    mockedVerifyKey.mockResolvedValue(true);
  });

  it("reports health on GET", async () => {
    const response = await handleRequest(new Request("https://example.test"), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      name: "DnD New Dawn Guild Assistant",
      status: "ready",
    });
  });

  it("rejects unsigned requests", async () => {
    const response = await handleRequest(
      new Request("https://example.test", { method: "POST", body: "{}" }),
      env,
    );
    expect(response.status).toBe(401);
  });

  it("rejects oversized interaction payloads", async () => {
    const response = await handleRequest(
      discordRequest({ content: "x".repeat(1024 * 1024) }),
      env,
    );
    expect(response.status).toBe(413);
    expect(mockedVerifyKey).not.toHaveBeenCalled();
  });

  it("answers Discord's endpoint validation ping", async () => {
    const response = await handleRequest(discordRequest({ type: 1 }), env);
    expect(await response.json()).toEqual({ type: 1 });
  });

  it("answers /ping privately", async () => {
    const response = await handleRequest(
      discordRequest({
        type: 2,
        data: { name: "ping" },
        member: { user: { global_name: "Daren", username: "daren" } },
      }),
      env,
    );

    expect(await response.json()).toEqual({
      type: 4,
      data: {
        content: "🎲 Pong! The guild assistant is awake, Daren.",
        flags: 64,
        allowed_mentions: { parse: [] },
      },
    });
  });
});
