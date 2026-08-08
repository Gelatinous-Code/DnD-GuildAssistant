import { describe, expect, it } from "vitest";

// @ts-expect-error command payloads are runtime JavaScript by design
import { memberDataCommands } from "../scripts/member-data-commands.mjs";

describe("member data command contract", () => {
  it("registers revisioned administrator preview, export, status, and retry actions", () => {
    const command = memberDataCommands[0];
    expect(command).toMatchObject({
      name: "member-data",
      default_member_permissions: "32",
    });
    expect(command.options.map((option: { name: string }) => option.name)).toEqual([
      "preview", "export", "status", "retry",
    ]);
    expect(command.options[0]).toMatchObject({
      name: "preview",
      options: [
        { name: "member", type: 6, required: true, description: expect.any(String) },
        { name: "action", required: true, description: expect.any(String), choices: [
          { name: "Export", value: "export" },
          { name: "Departure", value: "departure" },
        ] },
      ],
    });
    expect(command.options[1]).toMatchObject({
      name: "export",
      options: [
        expect.objectContaining({ name: "member", type: 6, required: true }),
        expect.objectContaining({ name: "revision", min_length: 64, max_length: 64 }),
      ],
    });
    expect(JSON.stringify(memberDataCommands)).not.toMatch(/delete|apply|execute|confirm/);
  });
});
