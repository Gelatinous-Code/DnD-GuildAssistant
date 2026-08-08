import { NEW_DAWN_CADENCE } from "./schedule";
import type { GuildConfig } from "./storage/repository";

export type AutomationMode = "paused" | "review" | "autopilot";

export function automationMode(
  config: Pick<GuildConfig, "schedulingEnabled" | "autoPublishEnabled">,
): AutomationMode {
  if (!config.schedulingEnabled) return "paused";
  return config.autoPublishEnabled ? "autopilot" : "review";
}

export function automationModeLabel(
  config: Pick<GuildConfig, "schedulingEnabled" | "autoPublishEnabled">,
): string {
  return automationMode(config) === "review" ? "review before publish" : automationMode(config);
}

export function effectiveGuildConfiguration(config: GuildConfig) {
  return {
    channels: {
      playerSignup: config.eventChannelId,
      gmSignup: config.gmSignupChannelId ?? config.eventChannelId,
      tables: config.tableChannelId ?? config.eventChannelId,
      reminders: config.reminderChannelId ?? config.eventChannelId,
    },
    roles: {
      guildPlayer: config.reminderRoleId,
      gmNotifications: config.gmNotificationRoleId,
      administrator: config.adminRoleId,
    },
    schedule: {
      timezone: config.timezone,
      game: {
        weekday: config.weeklyDay,
        time: config.weeklyTime,
        durationMinutes: config.eventDurationMinutes,
      },
      gmSignup: {
        weekday: config.gmSignupDay ?? NEW_DAWN_CADENCE.gmSignup.weekday,
        time: config.gmSignupTime ?? NEW_DAWN_CADENCE.gmSignup.time,
      },
      playerSignup: {
        weekday: config.playerSignupDay ?? NEW_DAWN_CADENCE.playerSignup.weekday,
        time: config.playerSignupTime ?? NEW_DAWN_CADENCE.playerSignup.time,
      },
      tablePublish: {
        weekday: config.tablePublishDay ?? NEW_DAWN_CADENCE.tablePublish.weekday,
        time: config.tablePublishTime ?? NEW_DAWN_CADENCE.tablePublish.time,
      },
      openSeating: {
        weekday: config.openSeatingDay ?? NEW_DAWN_CADENCE.openSeating.weekday,
        time: config.openSeatingTime ?? NEW_DAWN_CADENCE.openSeating.time,
      },
    },
    tables: {
      minimum: config.tableMinSize,
      preferred: config.tablePreferredSize,
      maximum: config.tableMaxSize,
    },
    automation: { mode: automationMode(config) },
  } as const;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function base64UrlSha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function opaqueResourceReference(
  guildId: string,
  kind: "channel" | "role",
  resourceId: string | null,
): Promise<string | null> {
  if (!resourceId) return null;
  return `${kind}_${await base64UrlSha256(`${guildId}\0${kind}\0${resourceId}`)}`;
}

export async function configurationRevision(config: GuildConfig): Promise<string> {
  const effective = effectiveGuildConfiguration(config);
  const safeProjection = {
    channels: {
      playerSignup: await opaqueResourceReference(config.guildId, "channel", effective.channels.playerSignup),
      gmSignup: await opaqueResourceReference(config.guildId, "channel", effective.channels.gmSignup),
      tables: await opaqueResourceReference(config.guildId, "channel", effective.channels.tables),
      reminders: await opaqueResourceReference(config.guildId, "channel", effective.channels.reminders),
    },
    roles: {
      guildPlayer: await opaqueResourceReference(config.guildId, "role", effective.roles.guildPlayer),
      gmNotifications: await opaqueResourceReference(config.guildId, "role", effective.roles.gmNotifications),
      administrator: await opaqueResourceReference(config.guildId, "role", effective.roles.administrator),
    },
    schedule: effective.schedule,
    tables: effective.tables,
    automation: effective.automation,
  };
  return base64UrlSha256(canonicalJson(safeProjection));
}
