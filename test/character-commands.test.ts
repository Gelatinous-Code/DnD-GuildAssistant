import { describe, expect, it } from "vitest";

// @ts-expect-error runtime JavaScript command payload
import { characterCommands } from "../scripts/character-commands.mjs";

describe("character command registration", () => {
  it("exposes member lifecycle commands and protects destructive actions", () => {
    const character = characterCommands.find((command: { name: string }) =>
      command.name === "character"
    );
    expect(character.options.map((option: { name: string }) => option.name)).toEqual([
      "create",
      "list",
      "main",
      "freeze",
      "unfreeze",
      "archive",
    ]);
    expect(character.options.find((option: { name: string }) => option.name === "archive")
      .options).toContainEqual(expect.objectContaining({ name: "confirm", required: true }));
  });

  it("restricts approval workflows to Manage Server by default", () => {
    const admin = characterCommands.find((command: { name: string }) =>
      command.name === "character-admin"
    );
    expect(admin.default_member_permissions).toBe("32");
    expect(admin.options.find((option: { name: string }) => option.name === "approve")
      .options).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "opening_xp", min_value: 0 }),
        expect.objectContaining({ name: "opening_gold", min_value: 0 }),
        expect.objectContaining({ name: "reason", required: true }),
        expect.objectContaining({ name: "confirm", required: true }),
      ]));
  });
});
