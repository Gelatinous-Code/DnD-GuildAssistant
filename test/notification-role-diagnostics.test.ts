import { describe, expect, it } from "vitest";
import { diagnoseNotificationRoles } from "../src/app";
import type { DiscordRole } from "../src/discord-api";

function role(id: string, name: string, mentionable: boolean): DiscordRole {
  return {
    id,
    name,
    color: 0,
    position: 1,
    permissions: "0",
    managed: false,
    mentionable,
  };
}

describe("notification role diagnostics", () => {
  it("checks GM, player, and organizer notification audiences independently", () => {
    const results = diagnoseNotificationRoles(
      {
        gmNotificationRoleId: "101",
        reminderRoleId: "102",
        adminRoleId: "103",
      },
      [
        role("101", "GM", false),
        role("102", "Guild Player", true),
      ],
    );

    expect(results).toEqual([
      "❌ **GM signup notification role** — @GM exists but cannot notify members. Enable “Allow anyone to @mention this role”.",
      "✅ **Player reminder role** — @Guild Player exists and is mentionable.",
      "❌ **Organizer escalation role** — configured role 103 is missing. Re-run /guild setup.",
    ]);
  });

  it("marks omitted notification roles as optional", () => {
    expect(diagnoseNotificationRoles({
      gmNotificationRoleId: null,
      reminderRoleId: null,
      adminRoleId: null,
    }, [])).toEqual([
      "➖ **GM signup notification role** — optional and not configured.",
      "➖ **Player reminder role** — optional and not configured.",
      "➖ **Organizer escalation role** — optional and not configured.",
    ]);
  });
});
