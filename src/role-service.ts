import { DiscordApiError, DiscordRestClient } from "./discord-api";
import {
  createDiscordRoleCallbacks,
  diagnoseDiscordRole,
  reconcileRoles,
  type RoleDiagnosticReport,
  type RoleReconciliationPlan,
  type RoleReconciliationReport,
} from "./role-reconciler";
import {
  GuildRepository,
  type PlanBundle,
  type RoleLease,
} from "./storage/repository";
import { UserFacingError } from "./interaction-utils";

type RoleRepository = Pick<
  GuildRepository,
  | "getGuildConfig"
  | "getCurrentPublishedEvent"
  | "getCurrentPlan"
  | "getPlanBundle"
  | "listActiveRoleLeases"
  | "acquireRoleLease"
  | "releaseRoleLease"
  | "appendAudit"
>;

type RoleDiscordClient = Pick<
  DiscordRestClient,
  | "getGuildMember"
  | "getGuildRoles"
  | "getCurrentBotGuildMember"
  | "addMemberRole"
  | "removeMemberRole"
>;

function combineReports(
  reports: readonly RoleReconciliationReport[],
  dryRun: boolean,
): RoleReconciliationReport {
  const combined = (field: keyof RoleReconciliationPlan): string[] =>
    reports.flatMap((report) => report.plan[field]);
  const plan: RoleReconciliationPlan = {
    desiredUserIds: combined("desiredUserIds"),
    leasedUserIds: combined("leasedUserIds"),
    roleHolderIds: combined("roleHolderIds"),
    addRoleUserIds: combined("addRoleUserIds"),
    removeRoleUserIds: combined("removeRoleUserIds"),
    acquireLeaseUserIds: combined("acquireLeaseUserIds"),
    releaseLeaseUserIds: combined("releaseLeaseUserIds"),
    retainedLeaseUserIds: combined("retainedLeaseUserIds"),
    manualRoleUserIds: combined("manualRoleUserIds"),
    ignoredManualRoleUserIds: combined("ignoredManualRoleUserIds"),
  };
  return {
    dryRun,
    ok: reports.every((report) => report.ok),
    plan,
    outcomes: reports.flatMap((report) => report.outcomes),
  };
}

export class RoleService {
  constructor(
    private readonly repository: RoleRepository,
    private readonly discord: RoleDiscordClient,
    private readonly id: () => string = () => crypto.randomUUID(),
  ) {}

  async diagnose(guildId: string): Promise<RoleDiagnosticReport> {
    const config = await this.repository.getGuildConfig(guildId);
    if (!config?.gmRoleId) {
      throw new UserFacingError(
        "No weekly GM role is configured. Run /guild setup with gm_role first.",
      );
    }
    return diagnoseDiscordRole(this.discord, guildId, config.gmRoleId);
  }

  async sync(guildId: string, dryRun = false): Promise<RoleReconciliationReport> {
    const config = await this.repository.getGuildConfig(guildId);
    if (!config?.gmRoleId) {
      throw new UserFacingError(
        "No weekly GM role is configured. Run /guild setup with gm_role first.",
      );
    }
    if (!config.roleSyncEnabled && !dryRun) {
      throw new UserFacingError(
        "Weekly role sync is disabled. Re-run /guild setup to enable it.",
      );
    }

    const event = await this.repository.getCurrentPublishedEvent(guildId);
    let bundle: PlanBundle | null = null;
    if (event?.status === "published") {
      const plan = await this.repository.getCurrentPlan(event.eventId);
      if (plan?.status === "published") {
        bundle = await this.repository.getPlanBundle(plan.planId);
      }
    }
    const desiredUserIds = bundle?.tables.map((table) => table.gmUserId) ?? [];
    const allLeases = await this.repository.listActiveRoleLeases(guildId);
    const historicalRoleIds = [...new Set(
      allLeases
        .map((lease) => lease.roleId)
        .filter((roleId) => roleId !== config.gmRoleId),
    )].sort();
    // Reconcile the replacement role first so selected GMs receive it before
    // any assistant-owned historical role is removed.
    const roleIds = [config.gmRoleId, ...historicalRoleIds];
    const reports: RoleReconciliationReport[] = [];
    const roleDetails: Array<{
      roleId: string;
      adds: string[];
      removes: string[];
      preservedManual: string[];
    }> = [];

    for (const roleId of roleIds) {
      const roleLeases = allLeases.filter((lease) => lease.roleId === roleId);
      const desiredForRole = roleId === config.gmRoleId ? desiredUserIds : [];
      const leasedUserIds = roleLeases.map((lease) => lease.userId);
      const candidateIds = [...new Set([...desiredForRole, ...leasedUserIds])];
      const roleHolderIds = (
        await Promise.all(
          candidateIds.map(async (userId) => {
            try {
              const member = await this.discord.getGuildMember(guildId, userId);
              return member.roles.includes(roleId) ? userId : null;
            } catch (error) {
              if (error instanceof DiscordApiError && error.status === 404) return null;
              throw error;
            }
          }),
        )
      ).filter((userId): userId is string => userId !== null);
      const leasesByUser = new Map<string, RoleLease>(
        roleLeases.map((lease) => [lease.userId, lease]),
      );

      const roleReport = await reconcileRoles({
        desiredUserIds: desiredForRole,
        leasedUserIds,
        roleHolderIds,
        dryRun,
        callbacks: createDiscordRoleCallbacks(
          this.discord,
          guildId,
          roleId,
          {
            acquireLease: async (userId) => {
              await this.repository.acquireRoleLease({
                leaseId: this.id(),
                guildId,
                eventId: event?.eventId,
                userId,
                roleId,
                reason: "Selected as a weekly GM",
              });
            },
            releaseLease: async (userId) => {
              const lease =
                leasesByUser.get(userId) ??
                (await this.repository.listActiveRoleLeases(guildId, roleId)).find(
                  (candidate) => candidate.userId === userId,
                );
              if (lease) {
                await this.repository.releaseRoleLease(
                  lease.leaseId,
                  roleId === config.gmRoleId && event?.status === "archived"
                    ? "Weekly event archived"
                    : roleId === config.gmRoleId
                      ? "GM no longer selected"
                      : "Configured weekly GM role replaced",
                );
              }
            },
          },
        ),
      });
      reports.push(roleReport);
      roleDetails.push({
        roleId,
        adds: roleReport.plan.addRoleUserIds,
        removes: roleReport.plan.removeRoleUserIds,
        preservedManual: [
          ...roleReport.plan.manualRoleUserIds,
          ...roleReport.plan.ignoredManualRoleUserIds,
        ],
      });
    }

    const report = combineReports(reports, dryRun);

    await this.repository.appendAudit({
      guildId,
      eventId: event?.eventId,
      action: dryRun ? "roles.previewed" : "roles.reconciled",
      entityType: "role",
      entityId: config.gmRoleId,
      details: {
        ok: report.ok,
        adds: report.plan.addRoleUserIds,
        removes: report.plan.removeRoleUserIds,
        preservedManual: [
          ...report.plan.manualRoleUserIds,
          ...report.plan.ignoredManualRoleUserIds,
        ],
        roles: roleDetails,
      },
    });
    return report;
  }
}

export function formatRoleReport(report: RoleReconciliationReport): string {
  const lines = [
    report.ok ? "✅ Role reconciliation ready." : "⚠️ Role reconciliation had failures.",
    "**Mode:** " + (report.dryRun ? "dry run" : "applied"),
    "**Add:** " + report.plan.addRoleUserIds.length,
    "**Remove:** " + report.plan.removeRoleUserIds.length,
    "**Manual roles preserved:** " +
      (report.plan.manualRoleUserIds.length + report.plan.ignoredManualRoleUserIds.length),
  ];
  const failures = report.outcomes.filter((outcome) => outcome.status === "failed");
  if (failures.length) {
    lines.push(
      "",
      "**Failures:**",
      ...failures.slice(0, 10).map(
        (failure) =>
          "• <@" +
          failure.userId +
          "> — " +
          failure.detail +
          (failure.error ? " (" + failure.error + ")" : ""),
      ),
    );
  }
  return lines.join("\n");
}

export function formatRoleDiagnostics(report: RoleDiagnosticReport): string {
  const icon = { pass: "✅", warn: "⚠️", fail: "❌" } as const;
  return [
    report.ready
      ? "## Guild Assistant doctor — ready"
      : "## Guild Assistant doctor — action required",
    ...report.items.map(
      (item) =>
        icon[item.status] +
        " **" +
        item.title +
        "** — " +
        item.detail +
        (item.remediation ? "\n   Fix: " + item.remediation : ""),
    ),
  ].join("\n");
}
