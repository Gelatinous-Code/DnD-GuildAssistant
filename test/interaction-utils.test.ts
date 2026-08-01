import { describe, expect, it } from "vitest";
import {
  booleanOption,
  invokingDisplayName,
  isGuildAdmin,
  numberOption,
  parseCommand,
  parseComponentId,
  stringOption,
} from "../src/interaction-utils";

describe("interaction utilities", () => {
  it("parses nested subcommand values", () => {
    const invocation = parseCommand({
      type: 2,
      data: {
        name: "guild",
        options: [
          {
            type: 1,
            name: "setup",
            options: [
              { type: 3, name: "timezone", value: "America/Denver" },
              { type: 4, name: "minimum", value: 4 },
              { type: 5, name: "enabled", value: true },
            ],
          },
        ],
      },
    });

    expect(invocation.command).toBe("guild");
    expect(invocation.subcommand).toBe("setup");
    expect(stringOption(invocation, "timezone")).toBe("America/Denver");
    expect(numberOption(invocation, "minimum")).toBe(4);
    expect(booleanOption(invocation, "enabled")).toBe(true);
  });

  it("recognizes either Discord administrator permission", () => {
    expect(isGuildAdmin({ type: 2, member: { permissions: "8" } })).toBe(true);
    expect(isGuildAdmin({ type: 2, member: { permissions: "32" } })).toBe(true);
    expect(isGuildAdmin({ type: 2, member: { permissions: "2048" } })).toBe(false);
    expect(isGuildAdmin({ type: 2, member: { permissions: "garbage" } })).toBe(false);
  });

  it("prefers a member nickname for responses", () => {
    expect(
      invokingDisplayName({
        type: 2,
        member: {
          nick: "Chappy",
          user: { global_name: "Daren", username: "daren" },
        },
      }),
    ).toBe("Chappy");
  });

  it("parses strict component identifiers", () => {
    expect(parseComponentId("guild:signup:gm:event-id")).toEqual({
      kind: "signup",
      eventId: "event-id",
      action: "gm",
    });
    expect(parseComponentId("guild:table:join:plan-id:table-id")).toEqual({
      kind: "table",
      planId: "plan-id",
      tableId: "table-id",
      action: "join",
    });
    expect(parseComponentId("guild:signup:gm:event-id:extra")).toBeUndefined();
  });
});
