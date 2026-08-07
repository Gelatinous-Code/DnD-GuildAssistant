import { describe, expect, it } from "vitest";

// @ts-expect-error runtime JavaScript command payload
import { shopCommands } from "../scripts/shop-commands.mjs";

describe("guild shop command registration", () => {
  it("registers player browse, confirmation, history, and character discovery", () => {
    const shop = shopCommands.find((command: { name: string }) => command.name === "shop");
    expect(shop).toBeDefined();
    expect(shop.options.map((entry: { name: string }) => entry.name)).toEqual([
      "browse", "buy", "history", "characters",
    ]);
    const buy = shop.options.find((entry: { name: string }) => entry.name === "buy");
    expect(buy.options.filter((entry: { required?: boolean }) => entry.required)
      .map((entry: { name: string }) => entry.name)).toEqual(["item_id", "character_id"]);
    expect(buy.options.filter((entry: { autocomplete?: boolean }) => entry.autocomplete)
      .map((entry: { name: string }) => entry.name)).toEqual([
        "item_id", "character_id", "item_id_2",
      ]);
    const history = shop.options.find((entry: { name: string }) => entry.name === "history");
    expect(history.options[0]).toMatchObject({ name: "character_id", autocomplete: true });
  });

  it("keeps all mutation and correction controls admin-only", () => {
    const admin = shopCommands.find((command: { name: string }) => command.name === "shop-admin");
    expect(admin.default_member_permissions).toBe("32");
    expect(admin.options.map((entry: { name: string }) => entry.name)).toEqual([
      "item", "active", "eligibility", "reverse", "configure", "status",
    ]);
    for (const subcommandName of ["item", "active", "eligibility"]) {
      const subcommand = admin.options.find(
        (entry: { name: string }) => entry.name === subcommandName,
      );
      expect(subcommand.options[0].autocomplete).toBe(true);
    }
  });
});
