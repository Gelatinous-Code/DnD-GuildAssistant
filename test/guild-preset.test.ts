import { describe, expect, it } from "vitest";
import type { DiscordChannel, DiscordRole } from "../src/discord-api";
import { resolveSecondDawnPreset } from "../src/guild-preset";
// @ts-expect-error The production Discord command manifest is intentionally plain ESM.
import { commands } from "../scripts/commands.mjs";

interface CommandEntry {
  name: string;
  choices?: Array<{ name: string; value: string }>;
  options?: CommandEntry[];
}

function role(id: string, name: string): DiscordRole {
  return {
    id,
    name,
    color: 0,
    position: 1,
    permissions: "0",
    managed: false,
    mentionable: false,
  };
}

describe("Second Dawn guild preset", () => {
  it("discovers the existing signup channels and permanent roles by name", () => {
    const channels: DiscordChannel[] = [
      { id: "100", type: 0, name: "game-sign-ups" },
      { id: "101", type: 0, name: "gm-sign-up" },
      { id: "102", type: 0, name: "admin-chat" },
    ];
    const roles = [
      role("200", "Administrator"),
      role("201", "GM"),
      role("202", "Guild Player"),
    ];

    expect(resolveSecondDawnPreset(channels, roles)).toEqual({
      gmSignupChannelId: "101",
      playerSignupChannelId: "100",
      playerReminderRoleId: "202",
      adminRoleId: "200",
      verifiedGmRoleId: "201",
    });
  });

  it("fails safely when a required resource is missing or duplicated", () => {
    const channels: DiscordChannel[] = [
      { id: "100", type: 0, name: "game-sign-ups" },
      { id: "101", type: 0, name: "gm-sign-up" },
      { id: "102", type: 0, name: "GM-SIGN-UP" },
    ];
    const roles = [role("200", "Administrator"), role("201", "GM")];

    expect(() => resolveSecondDawnPreset(channels, roles)).toThrow("More than one text channel");
    expect(() => resolveSecondDawnPreset(channels.slice(0, 2), roles)).toThrow(
      "Missing role named Guild Player",
    );
  });

  it("exposes the preset through /guild setup within Discord's option limit", () => {
    const guild = (commands as CommandEntry[]).find((command) => command.name === "guild");
    const setup = guild?.options?.find((option) => option.name === "setup");
    const preset = setup?.options?.find((option) => option.name === "preset");

    expect(preset?.choices).toEqual([
      { name: "Second Dawn Guild", value: "second_dawn" },
    ]);
    expect(setup?.options?.length).toBeLessThanOrEqual(25);
  });
});
