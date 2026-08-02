import { describe, expect, it, vi } from "vitest";
import {
  RoleService,
  formatRoleDiagnostics,
  formatRoleReport,
  requireSuccessfulRoleReconciliation,
} from "../src/role-service";
import type { DiscordGuildMember } from "../src/discord-api";
import type {
  GuildConfig,
  Plan,
  PlanBundle,
  RoleLease,
  WeeklyEvent,
} from "../src/storage/repository";

describe("role service formatting", () => {
  it("summarizes a dry-run without exposing unrelated role state", () => {
    expect(
      formatRoleReport({
        dryRun: true,
        ok: true,
        plan: {
          desiredUserIds: ["1"],
          leasedUserIds: [],
          roleHolderIds: [],
          addRoleUserIds: ["1"],
          removeRoleUserIds: [],
          acquireLeaseUserIds: ["1"],
          releaseLeaseUserIds: [],
          retainedLeaseUserIds: [],
          manualRoleUserIds: [],
          ignoredManualRoleUserIds: ["2"],
        },
        outcomes: [],
      }),
    ).toContain("**Manual roles preserved:** 1");
  });

  it("formats actionable doctor failures", () => {
    const text = formatRoleDiagnostics({
      ready: false,
      items: [
        {
          id: "manage-roles",
          status: "fail",
          title: "Bot lacks Manage Roles",
          detail: "None of the bot roles grant it.",
          remediation: "Grant Manage Roles.",
        },
      ],
    });
    expect(text).toContain("❌ **Bot lacks Manage Roles**");
    expect(text).toContain("Fix: Grant Manage Roles.");
  });
});

describe("role service replacement cleanup", () => {
  it("moves selected GMs to the replacement role, removes only old leased roles, and reruns idempotently", async () => {
    const guildId = "100000000000000001";
    const oldRoleId = "200000000000000001";
    const newRoleId = "200000000000000002";
    const leasedUserId = "300000000000000001";
    const manualUserId = "300000000000000002";
    const now = 1_800_000_000_000;
    const config: GuildConfig = {
      guildId,
      eventChannelId: "400000000000000001",
      tableChannelId: "400000000000000001",
      reminderChannelId: "400000000000000001",
      adminRoleId: null,
      gmRoleId: newRoleId,
      reminderRoleId: null,
      timezone: "America/Denver",
      weeklyDay: 6,
      weeklyTime: "18:30",
      eventDurationMinutes: 240,
      signupOpenLeadDays: 7,
      signupLockLeadHours: 24,
      tableMinSize: 4,
      tablePreferredSize: 6,
      tableMaxSize: 6,
      schedulingEnabled: true,
      roleSyncEnabled: true,
      autoPublishEnabled: false,
      createdAt: now,
      updatedAt: now,
    };
    const event: WeeklyEvent = {
      eventId: "event-1",
      guildId,
      title: "Weekly Games",
      startsAt: now + 86_400_000,
      endsAt: now + 90_000_000,
      signupOpensAt: now - 86_400_000,
      signupLocksAt: now,
      tableSelectionClosesAt: now + 86_400_000,
      status: "published",
      source: "native",
      sourceExternalId: null,
      signupChannelId: null,
      signupMessageId: null,
      tableChannelId: null,
      tableMessageId: null,
      finalManifestChannelId: null,
      finalManifestMessageId: null,
      tableStateVersion: 0,
      finalizedPlanId: null,
      finalizedTableStateVersion: null,
      tablesFinalizedAt: null,
      createdByUserId: null,
      createdAt: now,
      updatedAt: now,
      publishedAt: now,
      archivedAt: null,
    };
    const plan: Plan = {
      planId: "plan-1",
      eventId: event.eventId,
      generation: 1,
      status: "published",
      algorithmVersion: "test",
      minTableSize: 4,
      preferredTableSize: 6,
      maxTableSize: 6,
      playerCount: 8,
      gmSignupCount: 2,
      selectedGmCount: 2,
      waitlistCount: 0,
      createdByUserId: null,
      createdAt: now,
      publishedAt: now,
    };
    const bundle: PlanBundle = {
      plan,
      tables: [
        {
          tableId: "table-1",
          planId: plan.planId,
          tableNumber: 1,
          title: "Table 1",
          capacity: 4,
          gmUserId: leasedUserId,
          gmDisplayName: "Leased GM",
          channelId: null,
          messageId: null,
          createdAt: now,
        },
        {
          tableId: "table-2",
          planId: plan.planId,
          tableNumber: 2,
          title: "Table 2",
          capacity: 4,
          gmUserId: manualUserId,
          gmDisplayName: "Manual GM",
          channelId: null,
          messageId: null,
          createdAt: now,
        },
      ],
      assignments: [],
    };
    let leases: RoleLease[] = [
      {
        leaseId: "lease-old",
        guildId,
        eventId: event.eventId,
        userId: leasedUserId,
        roleId: oldRoleId,
        reason: "Selected as a weekly GM",
        grantedAt: now - 1_000,
        lastVerifiedAt: null,
        releasedAt: null,
        releaseReason: null,
      },
    ];
    const memberRoles = new Map<string, Set<string>>([
      [leasedUserId, new Set([oldRoleId])],
      // This old role has no lease and must remain manually owned.
      [manualUserId, new Set([oldRoleId])],
    ]);
    let nextLease = 1;
    const repository = {
      getGuildConfig: vi.fn(async () => config),
      getCurrentWeeklyEvent: vi.fn(async () => event),
      getCurrentPublishedEvent: vi.fn(async () => event),
      getCurrentPlan: vi.fn(async () => plan),
      getPlanBundle: vi.fn(async () => bundle),
      listActiveRoleLeases: vi.fn(async (_guildId: string, roleId?: string) =>
        leases.filter(
          (lease) =>
            lease.releasedAt === null &&
            (roleId === undefined || lease.roleId === roleId),
        ),
      ),
      acquireRoleLease: vi.fn(async (input: {
        leaseId: string;
        guildId: string;
        eventId?: string;
        userId: string;
        roleId: string;
        reason: string;
      }) => {
        const existing = leases.find(
          (lease) =>
            lease.releasedAt === null &&
            lease.guildId === input.guildId &&
            lease.userId === input.userId &&
            lease.roleId === input.roleId,
        );
        if (existing) return { acquired: false, lease: existing };
        const lease: RoleLease = {
          leaseId: input.leaseId,
          guildId: input.guildId,
          eventId: input.eventId ?? null,
          userId: input.userId,
          roleId: input.roleId,
          reason: input.reason,
          grantedAt: now,
          lastVerifiedAt: null,
          releasedAt: null,
          releaseReason: null,
        };
        leases.push(lease);
        return { acquired: true, lease };
      }),
      releaseRoleLease: vi.fn(async (leaseId: string, reason: string) => {
        const index = leases.findIndex(
          (lease) => lease.leaseId === leaseId && lease.releasedAt === null,
        );
        if (index < 0) return false;
        leases[index] = {
          ...leases[index],
          releasedAt: now,
          releaseReason: reason,
        };
        return true;
      }),
      appendAudit: vi.fn(async () => 1),
    };
    const mutations: string[] = [];
    const discord = {
      getGuildMember: vi.fn(async (_guildId: string, userId: string) => ({
        user: { id: userId, username: userId },
        roles: [...(memberRoles.get(userId) ?? new Set<string>())],
      }) satisfies DiscordGuildMember),
      getGuildRoles: vi.fn(async () => []),
      getCurrentBotGuildMember: vi.fn(async () => ({ roles: [] })),
      addMemberRole: vi.fn(
        async (_guildId: string, userId: string, roleId: string) => {
          mutations.push("add:" + userId + ":" + roleId);
          const roles = memberRoles.get(userId) ?? new Set<string>();
          roles.add(roleId);
          memberRoles.set(userId, roles);
        },
      ),
      removeMemberRole: vi.fn(
        async (_guildId: string, userId: string, roleId: string) => {
          mutations.push("remove:" + userId + ":" + roleId);
          memberRoles.get(userId)?.delete(roleId);
        },
      ),
    };
    const service = new RoleService(
      repository,
      discord,
      () => "lease-new-" + nextLease++,
    );

    const first = await service.sync(guildId);

    expect(first.ok).toBe(true);
    expect(first.plan.addRoleUserIds).toEqual([leasedUserId, manualUserId]);
    expect(first.plan.removeRoleUserIds).toEqual([leasedUserId]);
    expect(memberRoles.get(leasedUserId)).toEqual(new Set([newRoleId]));
    expect(memberRoles.get(manualUserId)).toEqual(
      new Set([oldRoleId, newRoleId]),
    );
    expect(repository.releaseRoleLease).toHaveBeenCalledWith(
      "lease-old",
      "Configured weekly GM role replaced",
    );
    expect(
      mutations.indexOf("add:" + leasedUserId + ":" + newRoleId),
    ).toBeLessThan(
      mutations.indexOf("remove:" + leasedUserId + ":" + oldRoleId),
    );

    const mutationCount = mutations.length;
    const leaseAcquireCount = repository.acquireRoleLease.mock.calls.length;
    const leaseReleaseCount = repository.releaseRoleLease.mock.calls.length;
    const second = await service.sync(guildId);

    expect(second.ok).toBe(true);
    expect(second.plan.addRoleUserIds).toEqual([]);
    expect(second.plan.removeRoleUserIds).toEqual([]);
    expect(mutations).toHaveLength(mutationCount);
    expect(repository.acquireRoleLease).toHaveBeenCalledTimes(leaseAcquireCount);
    expect(repository.releaseRoleLease).toHaveBeenCalledTimes(leaseReleaseCount);
    expect(
      leases.filter((lease) => lease.releasedAt === null && lease.roleId === oldRoleId),
    ).toEqual([]);
  });
});

function cleanupHarness(failingRoleId?: string) {
  const guildId = "100000000000000010";
  const currentRoleId = "200000000000000010";
  const historicalRoleId = "200000000000000011";
  const currentLeaseUserId = "300000000000000010";
  const historicalLeaseUserId = "300000000000000011";
  const manualUserId = "300000000000000012";
  const now = 1_800_000_000_000;
  const config: GuildConfig = {
    guildId,
    eventChannelId: "400000000000000010",
    tableChannelId: "400000000000000010",
    reminderChannelId: "400000000000000010",
    adminRoleId: null,
    gmRoleId: currentRoleId,
    reminderRoleId: null,
    timezone: "America/Denver",
    weeklyDay: 6,
    weeklyTime: "18:30",
    eventDurationMinutes: 240,
    signupOpenLeadDays: 7,
    signupLockLeadHours: 24,
    tableMinSize: 4,
    tablePreferredSize: 6,
    tableMaxSize: 6,
    schedulingEnabled: true,
    roleSyncEnabled: false,
    autoPublishEnabled: false,
    createdAt: now,
    updatedAt: now,
  };
  let leases: RoleLease[] = [
    {
      leaseId: "lease-current",
      guildId,
      eventId: null,
      userId: currentLeaseUserId,
      roleId: currentRoleId,
      reason: "Selected as a weekly GM",
      grantedAt: now,
      lastVerifiedAt: null,
      releasedAt: null,
      releaseReason: null,
    },
    {
      leaseId: "lease-historical",
      guildId,
      eventId: null,
      userId: historicalLeaseUserId,
      roleId: historicalRoleId,
      reason: "Selected as a weekly GM",
      grantedAt: now,
      lastVerifiedAt: null,
      releasedAt: null,
      releaseReason: null,
    },
  ];
  const memberRoles = new Map<string, Set<string>>([
    [currentLeaseUserId, new Set([currentRoleId])],
    [historicalLeaseUserId, new Set([historicalRoleId])],
    [manualUserId, new Set([currentRoleId, historicalRoleId])],
  ]);
  const repository = {
    getGuildConfig: vi.fn(async () => config),
    getCurrentPublishedEvent: vi.fn(async () => null),
    getCurrentPlan: vi.fn(async () => null),
    getPlanBundle: vi.fn(async () => null),
    listActiveRoleLeases: vi.fn(async (_guildId: string, roleId?: string) =>
      leases.filter(
        (lease) =>
          lease.releasedAt === null &&
          (roleId === undefined || lease.roleId === roleId),
      ),
    ),
    acquireRoleLease: vi.fn(async () => {
      throw new Error("cleanup must not acquire leases");
    }),
    releaseRoleLease: vi.fn(async (leaseId: string, reason: string) => {
      const index = leases.findIndex(
        (lease) => lease.leaseId === leaseId && lease.releasedAt === null,
      );
      if (index < 0) return false;
      leases[index] = { ...leases[index], releasedAt: now, releaseReason: reason };
      return true;
    }),
    appendAudit: vi.fn(async () => 1),
  };
  const discord = {
    getGuildMember: vi.fn(async (_guildId: string, userId: string) => ({
      user: { id: userId, username: userId },
      roles: [...(memberRoles.get(userId) ?? new Set<string>())],
    }) satisfies DiscordGuildMember),
    getGuildRoles: vi.fn(async () => []),
    getCurrentBotGuildMember: vi.fn(async () => ({ roles: [] })),
    addMemberRole: vi.fn(async () => undefined),
    removeMemberRole: vi.fn(
      async (_guildId: string, userId: string, roleId: string) => {
        if (roleId === failingRoleId) throw new Error("Discord missing permissions");
        memberRoles.get(userId)?.delete(roleId);
      },
    ),
  };

  return {
    guildId,
    currentRoleId,
    historicalRoleId,
    currentLeaseUserId,
    historicalLeaseUserId,
    manualUserId,
    config,
    repository,
    discord,
    memberRoles,
    activeLeases: () => leases.filter((lease) => lease.releasedAt === null),
    service: new RoleService(repository, discord),
  };
}

describe("role service release-all cleanup", () => {
  it("bypasses paused sync, removes current and historical leased roles, and preserves manual roles", async () => {
    const fixture = cleanupHarness();

    const report = await fixture.service.cleanupAllLeasedRoles(fixture.guildId);

    expect(report.ok).toBe(true);
    expect(report.plan.removeRoleUserIds).toEqual([
      fixture.currentLeaseUserId,
      fixture.historicalLeaseUserId,
    ]);
    expect(fixture.activeLeases()).toEqual([]);
    expect(fixture.memberRoles.get(fixture.currentLeaseUserId)).toEqual(new Set());
    expect(fixture.memberRoles.get(fixture.historicalLeaseUserId)).toEqual(new Set());
    expect(fixture.memberRoles.get(fixture.manualUserId)).toEqual(
      new Set([fixture.currentRoleId, fixture.historicalRoleId]),
    );
    expect(fixture.discord.getGuildMember).not.toHaveBeenCalledWith(
      fixture.guildId,
      fixture.manualUserId,
    );
    expect(fixture.repository.acquireRoleLease).not.toHaveBeenCalled();
    expect(fixture.repository.releaseRoleLease).toHaveBeenCalledWith(
      "lease-current",
      "Weekly GM role configuration cleared",
    );
    expect(fixture.repository.releaseRoleLease).toHaveBeenCalledWith(
      "lease-historical",
      "Weekly GM role configuration cleared",
    );
    expect(fixture.repository.appendAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "roles.cleaned-up" }),
    );
  });

  it("supports a dry-run without mutating roles or releasing leases", async () => {
    const fixture = cleanupHarness();

    const report = await fixture.service.cleanupAllLeasedRoles(fixture.guildId, true);

    expect(report.ok).toBe(true);
    expect(report.dryRun).toBe(true);
    expect(report.plan.removeRoleUserIds).toEqual([
      fixture.currentLeaseUserId,
      fixture.historicalLeaseUserId,
    ]);
    expect(fixture.discord.removeMemberRole).not.toHaveBeenCalled();
    expect(fixture.repository.releaseRoleLease).not.toHaveBeenCalled();
    expect(fixture.activeLeases()).toHaveLength(2);
    expect(fixture.repository.appendAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "roles.cleanup-previewed" }),
    );
  });

  it("retains failed leases and converts a partial report into a retryable error", async () => {
    const fixture = cleanupHarness("200000000000000011");

    const report = await fixture.service.cleanupAllLeasedRoles(fixture.guildId);

    expect(report.ok).toBe(false);
    expect(fixture.activeLeases()).toEqual([
      expect.objectContaining({ leaseId: "lease-historical" }),
    ]);
    expect(() =>
      requireSuccessfulRoleReconciliation(report, "Weekly GM role cleanup"),
    ).toThrow(/Weekly GM role cleanup failed.*Discord missing permissions/);
  });

  it("requires the currently configured GM role even when leases remain", async () => {
    const fixture = cleanupHarness();
    fixture.config.gmRoleId = null;

    await expect(
      fixture.service.cleanupAllLeasedRoles(fixture.guildId),
    ).rejects.toThrow("No weekly GM role is configured");
    expect(fixture.discord.removeMemberRole).not.toHaveBeenCalled();
  });
});
