import { validateWeeklySchedule } from "./schedule";
import type {
  DiscordChannel,
  DiscordGuildMember,
  DiscordRole,
} from "./discord-api";

export interface TablePolicy {
  minimum: number;
  preferred: number;
  maximum: number;
}

export function validateTablePolicy(policy: TablePolicy): string[] {
  const errors: string[] = [];
  for (const [name, value] of Object.entries(policy)) {
    if (!Number.isInteger(value) || value < 1 || value > 20) {
      errors.push(name + " table size must be an integer from 1 through 20");
    }
  }
  if (
    Number.isInteger(policy.minimum) &&
    Number.isInteger(policy.preferred) &&
    policy.minimum > policy.preferred
  ) {
    errors.push("minimum table size cannot exceed preferred table size");
  }
  if (
    Number.isInteger(policy.preferred) &&
    Number.isInteger(policy.maximum) &&
    policy.preferred > policy.maximum
  ) {
    errors.push("preferred table size cannot exceed maximum table size");
  }
  return errors;
}

export function validateGuildSchedule(input: {
  timezone: string;
  weeklyDay: number;
  weeklyTime: string;
  signupOpenLeadDays: number;
  signupLockLeadHours: number;
}): string[] {
  const errors = validateWeeklySchedule({
    weekday: input.weeklyDay,
    time: input.weeklyTime,
    timeZone: input.timezone,
  });
  if (
    !Number.isInteger(input.signupOpenLeadDays) ||
    input.signupOpenLeadDays < 1 ||
    input.signupOpenLeadDays > 7
  ) {
    errors.push(
      "signup lead must be an integer from 1 through 7 days in the weekly MVP scheduler",
    );
  }
  if (
    !Number.isInteger(input.signupLockLeadHours) ||
    input.signupLockLeadHours < 1 ||
    input.signupLockLeadHours > input.signupOpenLeadDays * 24
  ) {
    errors.push("lock lead must be positive and no longer than the signup window");
  }
  return errors;
}

const UNSAFE_MENTION = /@everyone|@here|<@!?\d+>|<@&\d+>/i;
const TEMPLATE_TOKEN = /\{([^{}]+)\}/g;
const ALLOWED_TEMPLATE_TOKENS = new Set(["event", "when", "players", "gms", "open_seats"]);

export function validateReminderTemplate(template: string): string[] {
  const errors: string[] = [];
  if (!template.trim()) errors.push("reminder message cannot be empty");
  if (template.length > 1000) errors.push("reminder message cannot exceed 1000 characters");
  if (UNSAFE_MENTION.test(template)) {
    errors.push(
      "reminder text cannot contain @everyone, @here, or raw user/role mentions; choose the configured role option instead",
    );
  }
  for (const match of template.matchAll(TEMPLATE_TOKEN)) {
    if (!ALLOWED_TEMPLATE_TOKENS.has(match[1])) {
      errors.push("unsupported reminder token {" + match[1] + "}");
    }
  }
  return [...new Set(errors)];
}

export function renderReminderTemplate(
  template: string,
  values: {
    event: string;
    when: string;
    players: number;
    gms: number;
    openSeats: number;
  },
): string {
  const errors = validateReminderTemplate(template);
  if (errors.length > 0) throw new Error(errors.join("; "));
  const replacements: Record<string, string> = {
    event: values.event,
    when: values.when,
    players: String(values.players),
    gms: String(values.gms),
    open_seats: String(values.openSeats),
  };
  return template.replace(TEMPLATE_TOKEN, (_, token: string) => replacements[token] ?? "");
}

export type DiagnosticLevel = "pass" | "warning" | "failure";

export interface PermissionDiagnostic {
  name: string;
  level: DiagnosticLevel;
  detail: string;
}

const DISCORD_PERMISSIONS = [
  {
    name: "View Channels",
    bit: 1n << 10n,
    required: true,
    fix: "Allow the assistant role to view the configured channel.",
  },
  {
    name: "Send Messages",
    bit: 1n << 11n,
    required: true,
    fix: "Allow the assistant role to send messages in the configured channel.",
  },
  {
    name: "Embed Links",
    bit: 1n << 14n,
    required: true,
    fix: "Allow Embed Links so signup and table cards render.",
  },
  {
    name: "Read Message History",
    bit: 1n << 16n,
    required: true,
    fix: "Allow Read Message History so published cards can be updated.",
  },
  {
    name: "Manage Roles",
    bit: 1n << 28n,
    required: true,
    fix: "Grant Manage Roles and place the assistant role above the weekly GM role.",
  },
  {
    name: "Attach Files",
    bit: 1n << 15n,
    required: false,
    fix: "Allow Attach Files before enabling CSV exports.",
  },
] as const;

function parsePermissions(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

/** Resolve Discord channel overwrites in Discord's documented order. */
export function effectiveChannelPermissions(input: {
  guildId: string;
  channel: DiscordChannel;
  roles: readonly DiscordRole[];
  botMember: DiscordGuildMember;
}): bigint {
  const rolesById = new Map(input.roles.map((role) => [role.id, role]));
  const memberRoleIds = new Set([input.guildId, ...input.botMember.roles]);
  let permissions = 0n;
  for (const roleId of memberRoleIds) {
    const role = rolesById.get(roleId);
    if (role) permissions |= parsePermissions(role.permissions);
  }
  if ((permissions & (1n << 3n)) !== 0n) return (1n << 63n) - 1n;

  const overwrites = input.channel.permission_overwrites ?? [];
  const apply = (deny: bigint, allow: bigint): void => {
    permissions = (permissions & ~deny) | allow;
  };
  const everyone = overwrites.find(
    (overwrite) => overwrite.type === 0 && overwrite.id === input.guildId,
  );
  if (everyone) apply(parsePermissions(everyone.deny), parsePermissions(everyone.allow));

  let roleDeny = 0n;
  let roleAllow = 0n;
  for (const overwrite of overwrites) {
    if (overwrite.type === 0 && memberRoleIds.has(overwrite.id) && overwrite.id !== input.guildId) {
      roleDeny |= parsePermissions(overwrite.deny);
      roleAllow |= parsePermissions(overwrite.allow);
    }
  }
  apply(roleDeny, roleAllow);

  const botUserId = input.botMember.user?.id;
  const member = botUserId
    ? overwrites.find(
        (overwrite) => overwrite.type === 1 && overwrite.id === botUserId,
      )
    : undefined;
  if (member) apply(parsePermissions(member.deny), parsePermissions(member.allow));
  return permissions;
}

export function diagnoseChannelPermissions(
  permissions: bigint,
): PermissionDiagnostic[] {
  return DISCORD_PERMISSIONS.filter(
    (permission) => permission.name !== "Manage Roles",
  ).map((permission) => {
    const granted = (permissions & permission.bit) !== 0n;
    return {
      name: permission.name,
      level: granted ? "pass" : permission.required ? "failure" : "warning",
      detail: granted ? "Granted." : permission.fix,
    };
  });
}

export function diagnoseInteractionPermissions(
  permissionString: string | undefined,
  options: { roleSyncEnabled?: boolean } = {},
): PermissionDiagnostic[] {
  let permissions = 0n;
  try {
    permissions = BigInt(permissionString ?? "0");
  } catch {
    return [
      {
        name: "Discord permissions",
        level: "failure",
        detail: "Discord did not provide a valid app-permissions bitfield.",
      },
    ];
  }

  return DISCORD_PERMISSIONS.map((permission) => {
    const granted = (permissions & permission.bit) !== 0n;
    const required =
      permission.name === "Manage Roles"
        ? Boolean(options.roleSyncEnabled)
        : permission.required;
    return {
      name: permission.name,
      level: granted ? "pass" : required ? "failure" : "warning",
      detail: granted ? "Granted." : permission.fix,
    };
  });
}
