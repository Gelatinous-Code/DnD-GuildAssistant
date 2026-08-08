import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscordChannel, DiscordGuildMember, DiscordRole } from "../src/discord-api";
import { configurationRevision } from "../src/guild-configuration";
import type { GuildConfig } from "../src/storage/repository";
import {
  executeWebsiteManagementRead,
  type WebsiteManagementDependencies,
} from "../src/website-management-api";

const NOW = Date.parse("2026-08-08T18:00:00Z");
const GUILD_ID = "1533181439376494642";
const ADMIN_ROLE_ID = "1533181439376494643";
const PLAYER_ROLE_ID = "1533181439376494644";
const GM_ROLE_ID = "1533181439376494645";
const BOT_ROLE_ID = "1533181439376494646";
const PLAYER_CHANNEL_ID = "1533181439376494650";
const TABLE_CHANNEL_ID = "1533181439376494651";
const REMINDER_CHANNEL_ID = "1533181439376494652";
const ADMIN_USER_ID = "1533181439376494670";
const TOKEN = "oauth-token-that-must-never-be-returned";
const CORRELATION_ID = "2bf597aa-8317-4fb4-bbc1-27ce88b6304a";

function config(overrides: Partial<GuildConfig> = {}): GuildConfig {
  return {
    guildId: GUILD_ID,
    announcementChannelId: null,
    eventChannelId: PLAYER_CHANNEL_ID,
    gmSignupChannelId: PLAYER_CHANNEL_ID,
    tableChannelId: TABLE_CHANNEL_ID,
    reminderChannelId: REMINDER_CHANNEL_ID,
    adminRoleId: ADMIN_ROLE_ID,
    gmRoleId: GM_ROLE_ID,
    gmNotificationRoleId: GM_ROLE_ID,
    reminderRoleId: PLAYER_ROLE_ID,
    timezone: "America/Denver",
    weeklyDay: 2,
    weeklyTime: "18:00",
    gmSignupDay: 4,
    gmSignupTime: "17:00",
    playerSignupDay: 4,
    playerSignupTime: "17:00",
    tablePublishDay: 6,
    tablePublishTime: "17:00",
    openSeatingDay: 1,
    openSeatingTime: "17:00",
    eventDurationMinutes: 180,
    signupOpenLeadDays: 5,
    signupLockLeadHours: 24,
    tableMinSize: 4,
    tablePreferredSize: 6,
    tableMaxSize: 6,
    schedulingEnabled: true,
    autoPublishEnabled: false,
    roleSyncEnabled: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const roles: DiscordRole[] = [
  { id: GUILD_ID, name: "@everyone", color: 0, position: 0, permissions: "0", managed: false, mentionable: false },
  { id: BOT_ROLE_ID, name: "Guild Assistant", color: 0, position: 3, permissions: "8", managed: true, mentionable: false },
  { id: ADMIN_ROLE_ID, name: "Administrator", color: 0, position: 4, permissions: "32", managed: false, mentionable: false },
  { id: PLAYER_ROLE_ID, name: "Guild Player", color: 0, position: 2, permissions: "0", managed: false, mentionable: true },
  { id: GM_ROLE_ID, name: "Game Master", color: 0, position: 2, permissions: "0", managed: false, mentionable: true },
];

const channels: DiscordChannel[] = [
  { id: PLAYER_CHANNEL_ID, type: 0, guild_id: GUILD_ID, name: "game-sign-ups" },
  { id: TABLE_CHANNEL_ID, type: 0, guild_id: GUILD_ID, name: "table-picks" },
  { id: REMINDER_CHANNEL_ID, type: 0, guild_id: GUILD_ID, name: "town-crier" },
];

const botMember: DiscordGuildMember = {
  user: { id: "1533181439376494699", username: "Guild Assistant", bot: true },
  roles: [BOT_ROLE_ID],
};

function request(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: "website-management.v1",
    guildId: GUILD_ID,
    discordAccessToken: TOKEN,
    correlationId: CORRELATION_ID,
    ...overrides,
  };
}

function dependencies(overrides: Partial<WebsiteManagementDependencies> = {}): WebsiteManagementDependencies {
  return {
    getConfig: async () => config(),
    getCurrentMember: async () => ({ userId: ADMIN_USER_ID, roles: [ADMIN_ROLE_ID], pending: false }),
    consumeRateLimit: async () => ({ allowed: true, retryAfterSeconds: 60 }),
    getDiscordState: async () => ({ channels, roles, botMember }),
    listEnabledReminderRules: async () => [],
    now: () => NOW,
    ...overrides,
  };
}

function errorCode(result: Record<string, unknown>): unknown {
  return (result.error as Record<string, unknown> | undefined)?.code;
}

beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => undefined));
afterEach(() => vi.restoreAllMocks());

describe("website management read API", () => {
  it("reauthorizes anonymous, member, GM, stale admin, removed admin, and valid admin callers", async () => {
    const anonymous = await executeWebsiteManagementRead(
      "describeManagementContract",
      request({ discordAccessToken: "" }),
      dependencies(),
    );
    expect(errorCode(anonymous)).toBe("discord_oauth_required");
    expect(anonymous.correlationId).toBe(CORRELATION_ID);

    for (const callerRoles of [[PLAYER_ROLE_ID], [GM_ROLE_ID], ["1533181439376494799"]]) {
      const result = await executeWebsiteManagementRead(
        "describeManagementContract",
        request(),
        dependencies({
          getCurrentMember: async () => ({ userId: ADMIN_USER_ID, roles: callerRoles, pending: false }),
        }),
      );
      expect(errorCode(result)).toBe("administrator_role_required");
    }

    const removed = await executeWebsiteManagementRead(
      "describeManagementContract",
      request(),
      dependencies({ getCurrentMember: async () => null }),
    );
    expect(errorCode(removed)).toBe("not_a_current_guild_member");

    const valid = await executeWebsiteManagementRead(
      "describeManagementContract",
      request(),
      dependencies(),
    );
    expect(valid).toMatchObject({
      ok: true,
      schemaVersion: "management-capabilities.v1",
      correlationId: CORRELATION_ID,
      cachePolicy: { visibility: "private", maxAgeSeconds: 0 },
    });
  });

  it("fails closed when Discord cannot verify current membership", async () => {
    const result = await executeWebsiteManagementRead(
      "getDiagnostics",
      request(),
      dependencies({ getCurrentMember: async () => { throw new Error("Discord outage"); } }),
    );
    expect(errorCode(result)).toBe("membership_verification_unavailable");
  });

  it("rejects unknown fields and unsupported contract versions", async () => {
    const unknown = await executeWebsiteManagementRead(
      "describeManagementContract",
      request({ actorUserId: ADMIN_USER_ID }),
      dependencies(),
    );
    expect(errorCode(unknown)).toBe("invalid_request_envelope");

    const unsupported = await executeWebsiteManagementRead(
      "describeManagementContract",
      request({ contractVersion: "website-management.v2" }),
      dependencies(),
    );
    expect(errorCode(unsupported)).toBe("unsupported_contract_version");
  });

  it("applies independent per-method rate limits after successful authorization", async () => {
    const consumeRateLimit = vi.fn(async () => ({ allowed: false, retryAfterSeconds: 17 }));
    const result = await executeWebsiteManagementRead(
      "getDiagnostics",
      request(),
      dependencies({ consumeRateLimit }),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "rate_limited", retryAfterSeconds: 17 },
    });
    expect(consumeRateLimit).toHaveBeenCalledWith(expect.objectContaining({
      guildId: GUILD_ID,
      userId: ADMIN_USER_ID,
      method: "getDiagnostics",
      limit: 30,
    }));
  });

  it("returns matching revisions and redacts raw resource IDs, credentials, and member history", async () => {
    const deps = dependencies();
    const effective = await executeWebsiteManagementRead("getEffectiveConfiguration", request(), deps);
    const diagnostics = await executeWebsiteManagementRead("getDiagnostics", request(), deps);

    expect(effective).toMatchObject({
      ok: true,
      schemaVersion: "effective-configuration.v1",
      sections: {
        schedule: { timezone: "America/Denver", game: { weekday: 2, time: "18:00" } },
        tables: { minimum: 4, preferred: 6, maximum: 6 },
        automation: { mode: "review" },
      },
    });
    expect(diagnostics).toMatchObject({
      ok: true,
      schemaVersion: "management-diagnostics.v1",
      status: "warning",
    });
    expect(effective.configurationRevision).toBe(diagnostics.configurationRevision);

    const serialized = JSON.stringify({ effective, diagnostics });
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain(PLAYER_CHANNEL_ID);
    expect(serialized).not.toContain(TABLE_CHANNEL_ID);
    expect(serialized).not.toContain(REMINDER_CHANNEL_ID);
    expect(serialized).not.toContain(ADMIN_ROLE_ID);
    expect(serialized).not.toContain(PLAYER_ROLE_ID);
    expect(serialized).not.toContain(ADMIN_USER_ID);
    expect(serialized).not.toMatch(/discordAccessToken|botToken|oauthClientSecret|memberHistory|stack/i);
    expect(serialized).toContain("channel_");
    expect(serialized).toContain("game-sign-ups");
  });

  it("derives revisions only from the supported effective configuration", async () => {
    const original = config();
    expect(await configurationRevision(original)).toBe(
      await configurationRevision({ ...original, updatedAt: original.updatedAt + 1 }),
    );
    expect(await configurationRevision(original)).not.toBe(
      await configurationRevision({ ...original, tableMaxSize: 7 }),
    );
  });
});
