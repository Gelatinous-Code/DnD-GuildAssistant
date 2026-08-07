import { describe, expect, it } from "vitest";

// @ts-expect-error runtime JavaScript command payload
import { progressionCommands } from "../scripts/progression-commands.mjs";

describe("progression command registration", () => {
  it("provides private member balance and character selection workflows", () => {
    const progression = progressionCommands.find((command: { name: string }) =>
      command.name === "progression"
    );
    expect(progression.options.map((option: { name: string }) => option.name)).toEqual([
      "balance",
      "select",
    ]);
  });

  it("protects adjustments and override workflows with Manage Server", () => {
    const admin = progressionCommands.find((command: { name: string }) =>
      command.name === "progression-admin"
    );
    expect(admin.default_member_permissions).toBe("32");
    const adjust = admin.options.find((option: { name: string }) => option.name === "adjust");
    expect(adjust.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "reason", required: true }),
      expect.objectContaining({ name: "season_id" }),
      expect.objectContaining({ name: "confirm", required: true }),
    ]));
    expect(admin.options.map((option: { name: string }) => option.name)).toEqual([
      "adjust",
      "season-preview",
      "season-rollover",
      "history",
      "target",
    ]);
    const rollover = admin.options.find((option: { name: string }) => option.name === "season-rollover");
    expect(rollover.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "reason", required: true }),
      expect.objectContaining({ name: "confirm", required: true }),
    ]));
  });
});
