import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("discord-interactions", () => ({
  verifyKey: vi.fn(),
}));

import { verifyKey } from "discord-interactions";
import { handleRequest } from "../src/index";
// @ts-expect-error The production Discord command manifest is intentionally plain ESM.
import { commands } from "../scripts/commands.mjs";

const mockedVerifyKey = vi.mocked(verifyKey);
const env = {
  DB: {} as D1Database,
  DISCORD_PUBLIC_KEY: "test-public-key",
  DISCORD_BOT_TOKEN: "test-bot-token",
  DISCORD_APPLICATION_ID: "1533171671886725293",
  DISCORD_TEST_GUILD_ID: "1533181439376494642",
  SESSION_RECAP_WORKFLOW_ENABLED: "false",
  SESSION_RECAP_REWARD_POLICY_VERSION: "",
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

describe("plain-language Discord help", () => {
  beforeEach(() => {
    mockedVerifyKey.mockClear();
    mockedVerifyKey.mockResolvedValue(true);
  });

  it("registers a public help command with role-focused topics", () => {
    const help = (commands as Array<Record<string, unknown>>).find(
      (command) => command.name === "help",
    );

    expect(help).toMatchObject({
      name: "help",
      type: 1,
      options: [
        {
          name: "topic",
          choices: [
            { value: "player" },
            { value: "gm" },
            { value: "priority" },
            { value: "organizer" },
          ],
        },
      ],
    });
    expect(help).not.toHaveProperty("default_member_permissions");
  });

  it("shows the private player guide by default", async () => {
    const response = await handleRequest(
      discordRequest({
        type: 2,
        data: { name: "help" },
        member: { user: { id: "1533183019031199946" } },
      }),
      env,
    );
    const body = (await response.json()) as {
      type: number;
      data: { content: string; flags: number; allowed_mentions: unknown };
    };

    expect(body.type).toBe(4);
    expect(body.data.flags).toBe(64);
    expect(body.data.allowed_mentions).toEqual({ parse: [] });
    expect(body.data.content).toContain("Playing this week");
    expect(body.data.content).toContain("Leave Table");
    expect(body.data.content).toContain("Withdraw");
  });

  it("shows organizer guidance only when that topic is selected", async () => {
    const response = await handleRequest(
      discordRequest({
        type: 2,
        data: {
          name: "help",
          options: [{ type: 3, name: "topic", value: "organizer" }],
        },
        member: {
          permissions: "32",
          user: { id: "1533183019031199946" },
        },
      }),
      env,
    );
    const body = (await response.json()) as { data: { content: string } };

    expect(body.data.content).toContain("Organizing the server");
    expect(body.data.content).toContain("/guild doctor");
    expect(body.data.content).toContain("/session confirm");
  });
});
