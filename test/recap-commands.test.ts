import { describe, expect, it } from "vitest";

// @ts-expect-error runtime JavaScript command payload
import { recapCommands } from "../scripts/recap-commands.mjs";

describe("recap command registration", () => {
  it("provides a private pending-recap fallback for DMs", () => {
    const recap = recapCommands.find((command: { name: string }) => command.name === "recap");
    expect(recap.options).toEqual([
      expect.objectContaining({ name: "pending", type: 1 }),
    ]);
  });

  it("requires admin permission, a reason, and confirmation for controls", () => {
    const admin = recapCommands.find(
      (command: { name: string }) => command.name === "recap-admin",
    );
    expect(admin.default_member_permissions).toBe("32");
    const manage = admin.options.find((option: { name: string }) => option.name === "manage");
    expect(manage.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "reason", required: true }),
      expect.objectContaining({ name: "confirm", required: true }),
      expect.objectContaining({ name: "correction", max_length: 1_000 }),
    ]));
    const action = manage.options.find((option: { name: string }) => option.name === "action");
    expect(action.choices.map((choice: { value: string }) => choice.value)).toEqual([
      "retry_delivery",
      "lock",
      "reopen",
      "hide",
      "unhide",
      "correction",
    ]);
  });
});
