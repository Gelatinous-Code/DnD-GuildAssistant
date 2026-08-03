import { describe, expect, it } from "vitest";

// The production registration script is JavaScript and intentionally has no
// TypeScript declaration file.
// @ts-expect-error importing the runtime command payload for regression coverage
import { commands } from "../scripts/commands.mjs";

describe("Discord command safety boundary", () => {
  it("does not expose member-role management commands or options", () => {
    expect(commands.some((command: { name: string }) => command.name === "roles")).toBe(false);

    const guild = commands.find((command: { name: string }) => command.name === "guild");
    const setup = guild?.options?.find((option: { name: string }) => option.name === "setup");
    const automation = guild?.options?.find(
      (option: { name: string }) => option.name === "automation",
    );

    expect(setup?.options?.map((option: { name: string }) => option.name)).not.toContain(
      "gm_role",
    );
    expect(setup?.options?.map((option: { name: string }) => option.name)).not.toContain(
      "clear_gm_role",
    );
    expect(
      automation?.options?.map((option: { name: string }) => option.name),
    ).not.toContain("role_sync");
  });
});
