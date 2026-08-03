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
    expect(setup?.options?.map((option: { name: string }) => option.name)).toContain(
      "gm_notification_role",
    );
    expect(setup?.options?.map((option: { name: string }) => option.name)).toContain(
      "clear_gm_notification_role",
    );
    expect(
      automation?.options?.map((option: { name: string }) => option.name),
    ).not.toContain("role_sync");
  });
  it("registers a confirmed cancelled-week restart", () => {
    const week = commands.find((command: { name: string }) => command.name === "week");
    const restart = week?.options?.find(
      (option: { name: string }) => option.name === "restart",
    );

    expect(restart?.description).toContain("cancelled occurrence");
    expect(restart?.options).toEqual([
      expect.objectContaining({
        name: "confirm",
        type: 5,
        required: true,
      }),
      expect.objectContaining({
        name: "starts_at",
        type: 3,
      }),
    ]);
  });
});
