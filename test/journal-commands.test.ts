import { describe, expect, it } from "vitest";

// @ts-expect-error runtime JavaScript command payload
import { journalCommands } from "../scripts/journal-commands.mjs";

describe("journal command registration", () => {
  it("provides player write/list and protected administrator controls", () => {
    const journal = journalCommands.find((command: { name: string }) =>
      command.name === "journal"
    );
    expect(journal.options.map((option: { name: string }) => option.name)).toEqual([
      "write",
      "list",
    ]);
    const write = journal.options.find((option: { name: string }) => option.name === "write");
    expect(write.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "character_id", required: true }),
      expect.objectContaining({ name: "session_id" }),
    ]));

    const admin = journalCommands.find((command: { name: string }) =>
      command.name === "journal-admin"
    );
    expect(admin.default_member_permissions).toBe("32");
    expect(admin.options.map((option: { name: string }) => option.name)).toEqual([
      "configure",
      "status",
      "manage",
    ]);
    const manage = admin.options.find((option: { name: string }) => option.name === "manage");
    expect(manage.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "reason", required: true }),
      expect.objectContaining({ name: "confirm", required: true }),
    ]));
  });
});
