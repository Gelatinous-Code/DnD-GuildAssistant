import type {
  DiscordGuildMember,
  DiscordRestClient,
  DiscordRole,
  Snowflake,
} from "./discord-api";

const MANAGE_ROLES = 1n << 28n;
const ADMINISTRATOR = 1n << 3n;

function requireSnowflake(value: string, label: string): Snowflake {
  if (!/^\d{1,20}$/.test(value)) {
    throw new TypeError(`${label} must be a Discord snowflake`);
  }
  return value;
}

function compareSnowflakes(left: Snowflake, right: Snowflake): number {
  if (left.length !== right.length) {
    return left.length - right.length;
  }
  return left.localeCompare(right);
}

function sortedIds(values: readonly Snowflake[], label: string): Snowflake[] {
  return [...new Set(values.map((value) => requireSnowflake(value, label)))].sort(
    compareSnowflakes,
  );
}

export interface RoleReconciliationState {
  /** Users who should have the selected-GM role after reconciliation. */
  desiredUserIds: readonly Snowflake[];
  /** Users whose target role was explicitly granted by this bot. */
  leasedUserIds: readonly Snowflake[];
  /** Users who currently have the target role, regardless of who granted it. */
  roleHolderIds: readonly Snowflake[];
}

export interface RoleReconciliationPlan {
  desiredUserIds: Snowflake[];
  leasedUserIds: Snowflake[];
  roleHolderIds: Snowflake[];
  addRoleUserIds: Snowflake[];
  removeRoleUserIds: Snowflake[];
  acquireLeaseUserIds: Snowflake[];
  releaseLeaseUserIds: Snowflake[];
  retainedLeaseUserIds: Snowflake[];
  manualRoleUserIds: Snowflake[];
  ignoredManualRoleUserIds: Snowflake[];
}

/**
 * Computes the smallest safe set of role changes.
 *
 * A role is removed only when the bot owns a lease for that user. Existing
 * unleased roles are classified as manual and are never adopted or removed.
 */
export function computeRoleReconciliation(
  state: RoleReconciliationState,
): RoleReconciliationPlan {
  const desiredUserIds = sortedIds(state.desiredUserIds, "desiredUserId");
  const leasedUserIds = sortedIds(state.leasedUserIds, "leasedUserId");
  const roleHolderIds = sortedIds(state.roleHolderIds, "roleHolderId");
  const desired = new Set(desiredUserIds);
  const leased = new Set(leasedUserIds);
  const holders = new Set(roleHolderIds);
  const allUsers = sortedIds(
    [...desiredUserIds, ...leasedUserIds, ...roleHolderIds],
    "userId",
  );

  const addRoleUserIds: Snowflake[] = [];
  const removeRoleUserIds: Snowflake[] = [];
  const acquireLeaseUserIds: Snowflake[] = [];
  const releaseLeaseUserIds: Snowflake[] = [];
  const retainedLeaseUserIds: Snowflake[] = [];
  const manualRoleUserIds: Snowflake[] = [];
  const ignoredManualRoleUserIds: Snowflake[] = [];

  for (const userId of allUsers) {
    const shouldHaveRole = desired.has(userId);
    const botOwnsRole = leased.has(userId);
    const hasRole = holders.has(userId);

    if (shouldHaveRole) {
      if (hasRole && !botOwnsRole) {
        manualRoleUserIds.push(userId);
      } else if (hasRole && botOwnsRole) {
        retainedLeaseUserIds.push(userId);
      } else {
        addRoleUserIds.push(userId);
        if (!botOwnsRole) {
          acquireLeaseUserIds.push(userId);
        }
      }
      continue;
    }

    if (botOwnsRole) {
      releaseLeaseUserIds.push(userId);
      if (hasRole) {
        removeRoleUserIds.push(userId);
      }
    } else if (hasRole) {
      ignoredManualRoleUserIds.push(userId);
    }
  }

  return {
    desiredUserIds,
    leasedUserIds,
    roleHolderIds,
    addRoleUserIds,
    removeRoleUserIds,
    acquireLeaseUserIds,
    releaseLeaseUserIds,
    retainedLeaseUserIds,
    manualRoleUserIds,
    ignoredManualRoleUserIds,
  };
}

export interface RoleReconciliationCallbacks {
  addRole(userId: Snowflake): Promise<void>;
  removeRole(userId: Snowflake): Promise<void>;
  acquireLease(userId: Snowflake): Promise<void>;
  releaseLease(userId: Snowflake): Promise<void>;
}

export type RoleReconciliationAction =
  | "acquire-lease"
  | "add-role"
  | "remove-role"
  | "release-lease"
  | "preserve-manual-role"
  | "retain-role";

export type RoleReconciliationOutcomeStatus =
  | "planned"
  | "succeeded"
  | "failed"
  | "skipped";

export interface RoleReconciliationOutcome {
  userId: Snowflake;
  action: RoleReconciliationAction;
  status: RoleReconciliationOutcomeStatus;
  detail: string;
  error?: string;
}

export interface ReconcileRoleOptions extends RoleReconciliationState {
  callbacks: RoleReconciliationCallbacks;
  dryRun?: boolean;
}

export interface RoleReconciliationReport {
  dryRun: boolean;
  ok: boolean;
  plan: RoleReconciliationPlan;
  outcomes: RoleReconciliationOutcome[];
}

function errorSummary(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return value.length <= 500 ? value : `${value.slice(0, 499)}…`;
}

function outcome(
  userId: Snowflake,
  action: RoleReconciliationAction,
  status: RoleReconciliationOutcomeStatus,
  detail: string,
  error?: unknown,
): RoleReconciliationOutcome {
  return {
    userId,
    action,
    status,
    detail,
    ...(error === undefined ? {} : { error: errorSummary(error) }),
  };
}

/**
 * Applies a plan in an order that makes interrupted runs safe to retry:
 * acquire lease -> add role, and remove role -> release lease.
 */
export async function reconcileRoles(
  options: ReconcileRoleOptions,
): Promise<RoleReconciliationReport> {
  const plan = computeRoleReconciliation(options);
  const outcomes: RoleReconciliationOutcome[] = [];
  const acquireLeaseUsers = new Set(plan.acquireLeaseUserIds);
  const removedRoleUsers = new Set(plan.removeRoleUserIds);

  for (const userId of plan.addRoleUserIds) {
    if (acquireLeaseUsers.has(userId)) {
      if (options.dryRun) {
        outcomes.push(
          outcome(userId, "acquire-lease", "planned", "Would record a bot-owned role lease."),
        );
      } else {
        try {
          await options.callbacks.acquireLease(userId);
          outcomes.push(
            outcome(userId, "acquire-lease", "succeeded", "Recorded a bot-owned role lease."),
          );
        } catch (error) {
          outcomes.push(
            outcome(
              userId,
              "acquire-lease",
              "failed",
              "Could not record the role lease; the role was not added.",
              error,
            ),
            outcome(
              userId,
              "add-role",
              "skipped",
              "Skipped role addition because its ownership lease was not recorded.",
            ),
          );
          continue;
        }
      }
    }

    if (options.dryRun) {
      outcomes.push(outcome(userId, "add-role", "planned", "Would add the selected-GM role."));
      continue;
    }

    try {
      await options.callbacks.addRole(userId);
      outcomes.push(outcome(userId, "add-role", "succeeded", "Added the selected-GM role."));
    } catch (error) {
      outcomes.push(
        outcome(
          userId,
          "add-role",
          "failed",
          "Could not add the selected-GM role. The lease is retained for a safe retry.",
          error,
        ),
      );
    }
  }

  for (const userId of plan.removeRoleUserIds) {
    if (options.dryRun) {
      outcomes.push(
        outcome(userId, "remove-role", "planned", "Would remove the bot-owned selected-GM role."),
        outcome(userId, "release-lease", "planned", "Would release the bot-owned role lease."),
      );
      continue;
    }

    try {
      await options.callbacks.removeRole(userId);
      outcomes.push(
        outcome(userId, "remove-role", "succeeded", "Removed the bot-owned selected-GM role."),
      );
    } catch (error) {
      outcomes.push(
        outcome(
          userId,
          "remove-role",
          "failed",
          "Could not remove the selected-GM role. The lease is retained for a safe retry.",
          error,
        ),
        outcome(
          userId,
          "release-lease",
          "skipped",
          "Skipped lease release because role removal failed.",
        ),
      );
      continue;
    }

    try {
      await options.callbacks.releaseLease(userId);
      outcomes.push(
        outcome(userId, "release-lease", "succeeded", "Released the bot-owned role lease."),
      );
    } catch (error) {
      outcomes.push(
        outcome(
          userId,
          "release-lease",
          "failed",
          "Role removal succeeded, but lease cleanup must be retried.",
          error,
        ),
      );
    }
  }

  for (const userId of plan.releaseLeaseUserIds) {
    if (removedRoleUsers.has(userId)) {
      continue;
    }
    if (options.dryRun) {
      outcomes.push(
        outcome(userId, "release-lease", "planned", "Would release a stale role lease."),
      );
      continue;
    }
    try {
      await options.callbacks.releaseLease(userId);
      outcomes.push(
        outcome(userId, "release-lease", "succeeded", "Released a stale role lease."),
      );
    } catch (error) {
      outcomes.push(
        outcome(
          userId,
          "release-lease",
          "failed",
          "Could not release the stale role lease; it can be retried safely.",
          error,
        ),
      );
    }
  }

  for (const userId of plan.manualRoleUserIds) {
    outcomes.push(
      outcome(
        userId,
        "preserve-manual-role",
        "skipped",
        "The desired role already exists without a bot lease; it remains manually owned.",
      ),
    );
  }
  for (const userId of plan.ignoredManualRoleUserIds) {
    outcomes.push(
      outcome(
        userId,
        "preserve-manual-role",
        "skipped",
        "The undesired role has no bot lease and was deliberately left untouched.",
      ),
    );
  }
  for (const userId of plan.retainedLeaseUserIds) {
    outcomes.push(
      outcome(
        userId,
        "retain-role",
        "skipped",
        "The bot-owned role already matches the desired state.",
      ),
    );
  }

  return {
    dryRun: Boolean(options.dryRun),
    ok: outcomes.every((item) => item.status !== "failed"),
    plan,
    outcomes,
  };
}

export interface LeaseCallbacks {
  acquireLease(userId: Snowflake): Promise<void>;
  releaseLease(userId: Snowflake): Promise<void>;
}

export interface DiscordRoleMutationClient {
  addMemberRole(
    guildId: Snowflake,
    userId: Snowflake,
    roleId: Snowflake,
    auditLogReason?: string,
  ): Promise<void>;
  removeMemberRole(
    guildId: Snowflake,
    userId: Snowflake,
    roleId: Snowflake,
    auditLogReason?: string,
  ): Promise<void>;
}

/** Adapts DiscordRestClient role methods to the generic reconciliation callbacks. */
export function createDiscordRoleCallbacks(
  client: DiscordRoleMutationClient,
  guildId: Snowflake,
  roleId: Snowflake,
  leases: LeaseCallbacks,
  auditLogReason = "DnD Guild Assistant weekly GM reconciliation",
): RoleReconciliationCallbacks {
  requireSnowflake(guildId, "guildId");
  requireSnowflake(roleId, "roleId");
  return {
    addRole: (userId) =>
      client.addMemberRole(guildId, userId, roleId, `${auditLogReason}: assign`),
    removeRole: (userId) =>
      client.removeMemberRole(guildId, userId, roleId, `${auditLogReason}: unassign`),
    acquireLease: (userId) => leases.acquireLease(userId),
    releaseLease: (userId) => leases.releaseLease(userId),
  };
}

export type RoleDiagnosticStatus = "pass" | "warn" | "fail";

export interface RoleDiagnosticItem {
  id:
    | "target-exists"
    | "target-assignable"
    | "bot-role-resolution"
    | "manage-roles"
    | "role-hierarchy"
    | "target-mentionable";
  status: RoleDiagnosticStatus;
  title: string;
  detail: string;
  remediation?: string;
}

export interface RoleDiagnosticInput {
  guildId: Snowflake;
  targetRoleId: Snowflake;
  roles: readonly DiscordRole[];
  botMember: DiscordGuildMember;
}

export interface RoleDiagnosticReport {
  ready: boolean;
  targetRole?: DiscordRole;
  botHighestRole?: DiscordRole;
  items: RoleDiagnosticItem[];
}

function diagnostic(
  id: RoleDiagnosticItem["id"],
  status: RoleDiagnosticStatus,
  title: string,
  detail: string,
  remediation?: string,
): RoleDiagnosticItem {
  return { id, status, title, detail, ...(remediation ? { remediation } : {}) };
}

function permissionsForRoles(roles: readonly DiscordRole[]): bigint | null {
  try {
    return roles.reduce((permissions, role) => permissions | BigInt(role.permissions), 0n);
  } catch {
    return null;
  }
}

/** Produces actionable setup diagnostics without changing Discord state. */
export function diagnoseRoleConfiguration(input: RoleDiagnosticInput): RoleDiagnosticReport {
  const guildId = requireSnowflake(input.guildId, "guildId");
  const targetRoleId = requireSnowflake(input.targetRoleId, "targetRoleId");
  const rolesById = new Map(input.roles.map((role) => [role.id, role]));
  const targetRole = rolesById.get(targetRoleId);
  const botRoleIds = sortedIds([...input.botMember.roles, guildId], "botRoleId");
  const unresolvedBotRoleIds = botRoleIds.filter((roleId) => !rolesById.has(roleId));
  const botRoles = botRoleIds
    .map((roleId) => rolesById.get(roleId))
    .filter((role): role is DiscordRole => role !== undefined);
  const botHighestRole = botRoles.reduce<DiscordRole | undefined>(
    (highest, role) => (!highest || role.position > highest.position ? role : highest),
    undefined,
  );
  const items: RoleDiagnosticItem[] = [];

  items.push(
    targetRole
      ? diagnostic(
          "target-exists",
          "pass",
          "Selected-GM role exists",
          `Found @${targetRole.name} (${targetRole.id}).`,
        )
      : diagnostic(
          "target-exists",
          "fail",
          "Selected-GM role is missing",
          `Discord did not return role ${targetRoleId}.`,
          "Choose an existing role in /guild setup or create the role and run /guild doctor again.",
        ),
  );

  items.push(
    !targetRole
      ? diagnostic(
          "target-assignable",
          "fail",
          "Role assignability cannot be checked",
          "The configured role does not exist.",
          "Fix the selected-GM role ID first.",
        )
      : targetRole.managed
        ? diagnostic(
            "target-assignable",
            "fail",
            "Selected-GM role is integration-managed",
            `@${targetRole.name} is controlled by Discord or another integration and cannot be assigned manually.`,
            "Create a normal server role for weekly GMs and select that role instead.",
          )
        : diagnostic(
            "target-assignable",
            "pass",
            "Selected-GM role is assignable",
            `@${targetRole.name} is not managed by another integration.`,
          ),
  );

  items.push(
    unresolvedBotRoleIds.length
      ? diagnostic(
          "bot-role-resolution",
          "fail",
          "Bot roles could not be fully resolved",
          `Missing role data for: ${unresolvedBotRoleIds.join(", ")}.`,
          "Reinstall the bot or restore its roles, then retry /guild doctor.",
        )
      : diagnostic(
          "bot-role-resolution",
          "pass",
          "Bot roles resolved",
          `Resolved ${botRoles.length} bot role(s), including @everyone.`,
        ),
  );

  const permissions = permissionsForRoles(botRoles);
  const administrator = permissions !== null && (permissions & ADMINISTRATOR) === ADMINISTRATOR;
  const canManageRoles =
    permissions !== null && ((permissions & MANAGE_ROLES) === MANAGE_ROLES || administrator);
  items.push(
    unresolvedBotRoleIds.length || permissions === null
      ? diagnostic(
          "manage-roles",
          "fail",
          "Manage Roles permission cannot be verified",
          "One or more bot role permission values could not be evaluated.",
          "Restore the bot's roles and grant its integration role Manage Roles.",
        )
      : canManageRoles
        ? diagnostic(
            "manage-roles",
            "pass",
            "Bot can manage roles",
            administrator
              ? "The bot has Administrator, which includes Manage Roles."
              : "The bot has the Manage Roles permission.",
          )
        : diagnostic(
            "manage-roles",
            "fail",
            "Bot lacks Manage Roles",
            "None of the bot's roles grant Manage Roles.",
            "In Server Settings → Roles, grant the bot's integration role Manage Roles.",
          ),
  );

  const hierarchyReady =
    targetRole !== undefined &&
    botHighestRole !== undefined &&
    botHighestRole.position > targetRole.position;
  items.push(
    hierarchyReady
      ? diagnostic(
          "role-hierarchy",
          "pass",
          "Bot role is above the selected-GM role",
          `@${botHighestRole.name} is above @${targetRole.name}.`,
        )
      : diagnostic(
          "role-hierarchy",
          "fail",
          "Bot role is not above the selected-GM role",
          targetRole && botHighestRole
            ? `@${botHighestRole.name} (position ${botHighestRole.position}) must be above @${targetRole.name} (position ${targetRole.position}).`
            : "The role hierarchy cannot be evaluated until both roles resolve.",
          "In Server Settings → Roles, drag the bot's integration role clearly above the selected-GM role.",
        ),
  );

  items.push(
    !targetRole
      ? diagnostic(
          "target-mentionable",
          "fail",
          "Role mentionability cannot be checked",
          "The configured role does not exist.",
          "Fix the selected-GM role ID first.",
        )
      : targetRole.mentionable
        ? diagnostic(
            "target-mentionable",
            "pass",
            "Selected-GM role can be mentioned",
            `Reminder messages can notify @${targetRole.name}.`,
          )
        : diagnostic(
            "target-mentionable",
            "warn",
            "Selected-GM role is not mentionable",
            `Discord may show @${targetRole.name} in reminders without notifying its members.`,
            "Enable “Allow anyone to @mention this role” or grant the bot permission to mention all roles if notifications are required.",
          ),
  );

  return {
    ready: items.every((item) => item.status !== "fail"),
    targetRole,
    botHighestRole,
    items,
  };
}

export interface DiscordRoleDiagnosticClient {
  getGuildRoles(guildId: Snowflake): Promise<DiscordRole[]>;
  getCurrentBotGuildMember(guildId: Snowflake): Promise<DiscordGuildMember>;
}

export async function diagnoseDiscordRole(
  client: DiscordRoleDiagnosticClient | Pick<DiscordRestClient, "getGuildRoles" | "getCurrentBotGuildMember">,
  guildId: Snowflake,
  targetRoleId: Snowflake,
): Promise<RoleDiagnosticReport> {
  const [roles, botMember] = await Promise.all([
    client.getGuildRoles(guildId),
    client.getCurrentBotGuildMember(guildId),
  ]);
  return diagnoseRoleConfiguration({ guildId, targetRoleId, roles, botMember });
}
