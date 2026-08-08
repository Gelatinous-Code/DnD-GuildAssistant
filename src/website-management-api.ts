import managementContractJson from "../contracts/website-management.v1.json";
import {
  DiscordRestClient,
  type DiscordChannel,
  type DiscordGuildMember,
  type DiscordRole,
} from "./discord-api";
import {
  configurationRevision,
  effectiveGuildConfiguration,
  opaqueResourceReference,
} from "./guild-configuration";
import {
  diagnoseChannelPermissions,
  effectiveChannelPermissions,
  validateGuildSchedule,
  validateTablePolicy,
} from "./policy";
import { GuildRepository, type GuildConfig, type ReminderRule } from "./storage/repository";
import { WebsiteManagementRepository } from "./storage/website-management-repository";
import { currentDiscordGuildMember } from "./website-read-security";

const CONTRACT_VERSION = "website-management.v1";
const MAX_REQUEST_BYTES = 65_536;
const MAX_TOKEN_LENGTH = 4_096;
const REQUEST_KEYS = new Set(["contractVersion", "guildId", "discordAccessToken", "correlationId"]);
const METHOD_LIMITS = {
  describeManagementContract: 30,
  getEffectiveConfiguration: 60,
  getDiagnostics: 30,
} as const;

type ManagementMethod = keyof typeof METHOD_LIMITS;
type StableErrorCode =
  | "unsupported_contract_version"
  | "invalid_request_envelope"
  | "discord_oauth_required"
  | "guild_not_found"
  | "website_role_not_configured"
  | "membership_verification_unavailable"
  | "not_a_current_guild_member"
  | "administrator_role_required"
  | "rate_limited"
  | "configuration_unavailable"
  | "diagnostics_unavailable";

interface ManagementRequest {
  contractVersion: string;
  guildId: string;
  discordAccessToken: string;
  correlationId: string;
}

interface VerifiedMember {
  userId: string;
  roles: string[];
  pending: boolean;
}

interface DiscordState {
  channels: DiscordChannel[];
  roles: DiscordRole[];
  botMember: DiscordGuildMember;
}

export interface WebsiteManagementDependencies {
  getConfig(guildId: string): Promise<GuildConfig | null>;
  getCurrentMember(guildId: string, token: string): Promise<VerifiedMember | null>;
  consumeRateLimit(input: {
    guildId: string;
    userId: string;
    method: ManagementMethod;
    limit: number;
    now: number;
  }): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  getDiscordState(guildId: string): Promise<DiscordState>;
  listEnabledReminderRules(guildId: string): Promise<ReminderRule[]>;
  now(): number;
}

interface DiagnosticCheck {
  checkId: string;
  section: string;
  level: "pass" | "warning" | "failure" | "unavailable";
  summary: string;
  resolution: string | null;
  fieldIds: string[];
}

type ManagementResult = Record<string, unknown> & {
  ok: boolean;
  correlationId: string | null;
  cachePolicy: { visibility: "private"; maxAgeSeconds: 0 };
};

type ManagementContractManifest = {
  methods: Record<string, { version: string }>;
  configurationFields: Array<Record<string, unknown> & { id: string }>;
  fieldHelp: Record<string, string>;
  unavailableSettings: Array<Record<string, unknown>>;
  diagnostics: Record<string, unknown>;
};

const managementContract = managementContractJson as ManagementContractManifest;

function cachePolicy() {
  return { visibility: "private" as const, maxAgeSeconds: 0 as const };
}

function failure(
  code: StableErrorCode,
  correlationId: string | null,
  retryAfterSeconds?: number,
): ManagementResult {
  return {
    ok: false,
    correlationId,
    cachePolicy: cachePolicy(),
    error: {
      code,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    },
  };
}

function parseRequest(value: unknown): ManagementRequest | StableErrorCode {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "invalid_request_envelope";
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return "invalid_request_envelope";
  }
  if (new TextEncoder().encode(serialized).byteLength > MAX_REQUEST_BYTES) {
    return "invalid_request_envelope";
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !REQUEST_KEYS.has(key)) || Object.keys(record).length !== 4) {
    return "invalid_request_envelope";
  }
  if (record.contractVersion !== CONTRACT_VERSION) return "unsupported_contract_version";
  if (typeof record.guildId !== "string" || !/^\d{17,20}$/.test(record.guildId)) {
    return "invalid_request_envelope";
  }
  if (
    typeof record.discordAccessToken !== "string"
    || record.discordAccessToken.length === 0
    || record.discordAccessToken.length > MAX_TOKEN_LENGTH
    || /\s/.test(record.discordAccessToken)
  ) {
    return record.discordAccessToken === "" ? "discord_oauth_required" : "invalid_request_envelope";
  }
  if (
    typeof record.correlationId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.correlationId)
  ) {
    return "invalid_request_envelope";
  }
  return record as unknown as ManagementRequest;
}

function requestContext(value: unknown) {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    guildId: typeof record.guildId === "string" && /^\d{17,20}$/.test(record.guildId)
      ? record.guildId
      : null,
    contractVersion: typeof record.contractVersion === "string"
      ? record.contractVersion.slice(0, 80)
      : null,
    correlationId: typeof record.correlationId === "string"
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.correlationId)
      ? record.correlationId
      : null,
  };
}

function telemetry(input: {
  method: ManagementMethod;
  guildId: string | null;
  contractVersion: string | null;
  outcome: string;
  correlationId: string | null;
  startedAt: number;
  finishedAt: number;
}) {
  console.log(JSON.stringify({
    kind: "guild-assistant.website-management-read",
    guild: input.guildId,
    method: input.method,
    contractVersion: input.contractVersion,
    outcome: input.outcome,
    latencyMs: Math.max(0, input.finishedAt - input.startedAt),
    correlationId: input.correlationId,
  }));
}

function diagnosticStatus(checks: readonly DiagnosticCheck[]) {
  if (checks.some((check) => check.level === "unavailable")) return "unavailable";
  if (checks.some((check) => check.level === "failure")) return "blocked";
  if (checks.some((check) => check.level === "warning")) return "warning";
  return "healthy";
}

function resourceFields(config: GuildConfig) {
  const effective = effectiveGuildConfiguration(config);
  return [
    ["player-signup", effective.channels.playerSignup, ["channels.player_signup_and_tables"]],
    ["gm-signup", effective.channels.gmSignup, ["channels.gm_signup"]],
    ["tables", effective.channels.tables, ["channels.player_signup_and_tables"]],
    ["reminders", effective.channels.reminders, ["channels.player_signup_and_tables"]],
  ] as const;
}

function buildDiagnostics(
  config: GuildConfig,
  discordState: DiscordState,
  reminderRules: readonly ReminderRule[],
): DiagnosticCheck[] {
  const effective = effectiveGuildConfiguration(config);
  const checks: DiagnosticCheck[] = [];
  const scheduleProblems = validateGuildSchedule({
    timezone: effective.schedule.timezone,
    weeklyDay: effective.schedule.game.weekday,
    weeklyTime: effective.schedule.game.time,
    signupOpenLeadDays: config.signupOpenLeadDays,
    signupLockLeadHours: config.signupLockLeadHours,
  });
  checks.push({
    checkId: "schedule.valid",
    section: "schedule",
    level: scheduleProblems.length ? "failure" : "pass",
    summary: scheduleProblems.length ? "The weekly schedule is invalid." : "The weekly schedule is valid.",
    resolution: scheduleProblems.length ? "Review the configured timezone, weekday, time, and signup window." : null,
    fieldIds: ["schedule.timezone", "schedule.game.weekday", "schedule.game.time"],
  });
  const tableProblems = validateTablePolicy(effective.tables);
  checks.push({
    checkId: "tables.valid",
    section: "tables",
    level: tableProblems.length ? "failure" : "pass",
    summary: tableProblems.length ? "The table-size policy is invalid." : "The table-size policy is valid.",
    resolution: tableProblems.length ? "Set minimum, preferred, and maximum sizes in ascending order from 1 through 20." : null,
    fieldIds: ["tables.minimum", "tables.preferred", "tables.maximum"],
  });

  const channelsById = new Map(discordState.channels.map((channel) => [channel.id, channel]));
  const seenChannels = new Set<string>();
  for (const [purpose, channelId, fieldIds] of resourceFields(config)) {
    if (!channelId) {
      checks.push({
        checkId: `channel.${purpose}.configured`,
        section: "channels",
        level: purpose === "player-signup" ? "failure" : "warning",
        summary: `${purpose} channel is not configured.`,
        resolution: "Select a guild text or announcement channel.",
        fieldIds: [...fieldIds],
      });
      continue;
    }
    if (seenChannels.has(channelId)) continue;
    seenChannels.add(channelId);
    const channel = channelsById.get(channelId);
    if (!channel || (channel.guild_id && channel.guild_id !== config.guildId)) {
      checks.push({
        checkId: `channel.${purpose}.available`,
        section: "channels",
        level: "failure",
        summary: `${purpose} channel is missing or unavailable to the assistant.`,
        resolution: "Select the channel again and confirm the assistant can view it.",
        fieldIds: [...fieldIds],
      });
      continue;
    }
    if (![0, 5].includes(channel.type)) {
      checks.push({
        checkId: `channel.${purpose}.type`,
        section: "channels",
        level: "failure",
        summary: `${channel.name ?? purpose} is not a text or announcement channel.`,
        resolution: "Select a normal guild text or announcement channel.",
        fieldIds: [...fieldIds],
      });
      continue;
    }
    for (const permission of diagnoseChannelPermissions(effectiveChannelPermissions({
      guildId: config.guildId,
      channel,
      roles: discordState.roles,
      botMember: discordState.botMember,
    }))) {
      checks.push({
        checkId: `channel.${purpose}.permission.${permission.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        section: "channels",
        level: permission.level,
        summary: `${channel.name ?? purpose}: ${permission.name} ${permission.level === "pass" ? "is granted" : "needs attention"}.`,
        resolution: permission.level === "pass" ? null : permission.detail,
        fieldIds: [...fieldIds],
      });
    }
  }

  const roleChecks = [
    ["administrator", effective.roles.administrator, true, false, "roles.administrator"],
    ["guild-player", effective.roles.guildPlayer, false, true, "roles.guild_player"],
    ["gm-notifications", effective.roles.gmNotifications, false, true, "roles.gm_notifications"],
  ] as const;
  for (const [name, roleId, required, requiresMention, fieldId] of roleChecks) {
    if (!roleId) {
      checks.push({
        checkId: `role.${name}.configured`,
        section: "roles",
        level: required ? "failure" : "warning",
        summary: `${name} role is not configured.`,
        resolution: required ? "Configure the administrator role in Discord before using website management." : "Configure this optional role to enable targeted notifications.",
        fieldIds: [fieldId],
      });
      continue;
    }
    const role = discordState.roles.find((candidate) => candidate.id === roleId);
    const valid = Boolean(role) && (!requiresMention || role?.mentionable === true);
    checks.push({
      checkId: `role.${name}.available`,
      section: "roles",
      level: valid ? "pass" : "failure",
      summary: valid ? `${role?.name ?? name} is available.` : `${name} role is missing or cannot be mentioned.`,
      resolution: valid ? null : "Select an existing role and enable role mentions when notifications use it.",
      fieldIds: [fieldId],
    });
  }

  const preLockEnabled = reminderRules.some((rule) => rule.triggerKind === "signup_lock");
  checks.push({
    checkId: "reminders.pre-lock",
    section: "reminders",
    level: preLockEnabled ? "pass" : "warning",
    summary: preLockEnabled ? "The pre-lock reminder is enabled." : "The pre-lock reminder is disabled.",
    resolution: preLockEnabled ? null : "Enable the pre-lock reminder if players should be notified before signup closes.",
    fieldIds: ["reminders.pre_lock.enabled"],
  });
  checks.push({
    checkId: "automation.mode",
    section: "automation",
    level: effective.automation.mode === "paused" ? "warning" : "pass",
    summary: `Automation is ${effective.automation.mode}.`,
    resolution: effective.automation.mode === "paused" ? "Keep automation paused until required diagnostics pass, then choose review or autopilot." : null,
    fieldIds: ["automation.mode"],
  });
  return checks;
}

async function resourceReference(
  guildId: string,
  kind: "channel" | "role",
  resourceId: string | null,
  displayName: string | null,
  mentionable?: boolean,
) {
  return {
    configured: resourceId !== null,
    displayName,
    opaqueReference: await opaqueResourceReference(guildId, kind, resourceId),
    ...(mentionable === undefined ? {} : { mentionable }),
  };
}

async function effectiveConfigurationPayload(
  config: GuildConfig,
  state: DiscordState,
  reminderRules: readonly ReminderRule[],
  generatedAt: string,
) {
  const effective = effectiveGuildConfiguration(config);
  const channels = new Map(state.channels.map((channel) => [channel.id, channel]));
  const roles = new Map(state.roles.map((role) => [role.id, role]));
  const diagnostics = buildDiagnostics(config, state, reminderRules);
  const blockingFields = [...new Set(diagnostics
    .filter((check) => check.level === "failure" || check.level === "unavailable")
    .flatMap((check) => check.fieldIds))];
  const configuredChannel = async (id: string | null) => resourceReference(
    config.guildId,
    "channel",
    id,
    id ? channels.get(id)?.name ?? null : null,
  );
  const configuredRole = async (id: string | null, includeMentionable = false) => {
    const role = id ? roles.get(id) : undefined;
    return resourceReference(
      config.guildId,
      "role",
      id,
      role?.name ?? null,
      includeMentionable ? role?.mentionable ?? false : undefined,
    );
  };
  return {
    schemaVersion: "effective-configuration.v1",
    guild: { id: config.guildId },
    viewer: { roles: ["administrator"], capabilities: { configureGuildAssistant: true, readDiagnostics: true } },
    generatedAt,
    configurationRevision: await configurationRevision(config),
    setupCompleteness: {
      status: blockingFields.length ? "incomplete" : "complete",
      blockingFieldIds: blockingFields,
    },
    sections: {
      channels: {
        playerSignup: await configuredChannel(effective.channels.playerSignup),
        gmSignup: await configuredChannel(effective.channels.gmSignup),
        tables: await configuredChannel(effective.channels.tables),
        reminders: await configuredChannel(effective.channels.reminders),
      },
      roles: {
        guildPlayer: await configuredRole(effective.roles.guildPlayer, true),
        gmNotifications: await configuredRole(effective.roles.gmNotifications, true),
        administrator: await configuredRole(effective.roles.administrator),
      },
      schedule: effective.schedule,
      tables: effective.tables,
      automation: effective.automation,
      reminders: {
        preLock: { enabled: reminderRules.some((rule) => rule.triggerKind === "signup_lock") },
      },
    },
    warnings: diagnostics
      .filter((check) => check.level === "warning")
      .map((check) => ({ checkId: check.checkId, summary: check.summary, fieldIds: check.fieldIds })),
  };
}

function capabilitiesPayload(generatedAt: string) {
  return {
    schemaVersion: "management-capabilities.v1",
    generatedAt,
    supportedVersions: Object.fromEntries(
      Object.entries(managementContract.methods).map(([method, metadata]) => [method, metadata.version]),
    ),
    fieldMetadata: managementContract.configurationFields.map(({ source: _source, ...field }) => ({
      ...field,
      help: managementContract.fieldHelp[field.id],
    })),
    diagnosticMetadata: managementContract.diagnostics,
    unavailableSettings: managementContract.unavailableSettings,
  };
}

export function createWebsiteManagementDependencies(
  env: Env,
  options: { fetch?: typeof fetch; now?: () => number } = {},
): WebsiteManagementDependencies {
  const repository = new GuildRepository(env.DB);
  const limiter = new WebsiteManagementRepository(env.DB);
  const discord = new DiscordRestClient(env.DISCORD_BOT_TOKEN);
  return {
    getConfig: (guildId) => repository.getGuildConfig(guildId),
    getCurrentMember: (guildId, token) => currentDiscordGuildMember(guildId, token, options.fetch ?? fetch),
    consumeRateLimit: (input) => limiter.consumeRateLimit(input),
    getDiscordState: async (guildId) => {
      const [channels, roles, botMember] = await Promise.all([
        discord.getGuildChannels(guildId),
        discord.getGuildRoles(guildId),
        discord.getCurrentBotGuildMember(guildId),
      ]);
      return { channels, roles, botMember };
    },
    listEnabledReminderRules: (guildId) => repository.listEnabledReminderRules(guildId),
    now: options.now ?? Date.now,
  };
}

export async function executeWebsiteManagementRead(
  method: ManagementMethod,
  input: unknown,
  dependencies: WebsiteManagementDependencies,
): Promise<ManagementResult> {
  const startedAt = dependencies.now();
  const context = requestContext(input);
  const parsed = parseRequest(input);
  const request = typeof parsed === "string" ? null : parsed;
  let outcome = typeof parsed === "string" ? parsed : "internal_error";
  try {
    if (typeof parsed === "string") return failure(parsed, context.correlationId);
    const config = await dependencies.getConfig(parsed.guildId);
    if (!config) {
      outcome = "guild_not_found";
      return failure("guild_not_found", parsed.correlationId);
    }
    if (!config.adminRoleId) {
      outcome = "website_role_not_configured";
      return failure("website_role_not_configured", parsed.correlationId);
    }
    let member: VerifiedMember | null;
    try {
      member = await dependencies.getCurrentMember(parsed.guildId, parsed.discordAccessToken);
    } catch {
      outcome = "membership_verification_unavailable";
      return failure("membership_verification_unavailable", parsed.correlationId);
    }
    if (!member) {
      outcome = "not_a_current_guild_member";
      return failure("not_a_current_guild_member", parsed.correlationId);
    }
    if (member.pending || !member.roles.includes(config.adminRoleId)) {
      outcome = "administrator_role_required";
      return failure("administrator_role_required", parsed.correlationId);
    }
    const rate = await dependencies.consumeRateLimit({
      guildId: parsed.guildId,
      userId: member.userId,
      method,
      limit: METHOD_LIMITS[method],
      now: startedAt,
    });
    if (!rate.allowed) {
      outcome = "rate_limited";
      return failure("rate_limited", parsed.correlationId, rate.retryAfterSeconds);
    }
    const generatedAt = new Date(startedAt).toISOString();
    if (method === "describeManagementContract") {
      outcome = "success";
      return { ok: true, correlationId: parsed.correlationId, cachePolicy: cachePolicy(), ...capabilitiesPayload(generatedAt) };
    }
    let state: DiscordState;
    let reminderRules: ReminderRule[];
    try {
      [state, reminderRules] = await Promise.all([
        dependencies.getDiscordState(parsed.guildId),
        dependencies.listEnabledReminderRules(parsed.guildId),
      ]);
    } catch {
      const availabilityError: StableErrorCode = method === "getDiagnostics"
        ? "diagnostics_unavailable"
        : "configuration_unavailable";
      outcome = availabilityError;
      return failure(availabilityError, parsed.correlationId);
    }
    if (method === "getEffectiveConfiguration") {
      outcome = "success";
      return {
        ok: true,
        correlationId: parsed.correlationId,
        cachePolicy: cachePolicy(),
        ...await effectiveConfigurationPayload(config, state, reminderRules, generatedAt),
      };
    }
    const checks = buildDiagnostics(config, state, reminderRules);
    outcome = "success";
    return {
      ok: true,
      correlationId: parsed.correlationId,
      cachePolicy: cachePolicy(),
      schemaVersion: "management-diagnostics.v1",
      guild: { id: parsed.guildId },
      viewer: { roles: ["administrator"], capabilities: { readDiagnostics: true } },
      generatedAt,
      configurationRevision: await configurationRevision(config),
      status: diagnosticStatus(checks),
      checks,
    };
  } catch {
    const availabilityError: StableErrorCode = method === "getDiagnostics"
      ? "diagnostics_unavailable"
      : "configuration_unavailable";
    outcome = availabilityError;
    return failure(availabilityError, request?.correlationId ?? context.correlationId);
  } finally {
    telemetry({
      method,
      guildId: request?.guildId ?? context.guildId,
      contractVersion: request?.contractVersion ?? context.contractVersion,
      outcome,
      correlationId: request?.correlationId ?? context.correlationId,
      startedAt,
      finishedAt: dependencies.now(),
    });
  }
}
