import { describe, expect, it, vi } from "vitest";
import type { DiscordGuildMember, DiscordRole } from "../src/discord-api";
import {
  computeRoleReconciliation,
  createDiscordRoleCallbacks,
  diagnoseDiscordRole,
  diagnoseRoleConfiguration,
  reconcileRoles,
  type RoleReconciliationCallbacks,
} from "../src/role-reconciler";

const GUILD_ID = "100";
const TARGET_ROLE_ID = "200";
const BOT_ROLE_ID = "300";
const MANAGE_ROLES = String(1 << 28);

function role(
  id: string,
  name: string,
  position: number,
  overrides: Partial<DiscordRole> = {},
): DiscordRole {
  return {
    id,
    name,
    color: 0,
    position,
    permissions: "0",
    managed: false,
    mentionable: true,
    ...overrides,
  };
}

function botMember(roleIds: string[] = [BOT_ROLE_ID]): DiscordGuildMember {
  return { roles: roleIds, user: { id: "400", username: "Guild Assistant", bot: true } };
}

function healthyRoles(targetOverrides: Partial<DiscordRole> = {}): DiscordRole[] {
  return [
    role(GUILD_ID, "@everyone", 0),
    role(TARGET_ROLE_ID, "Selected GM", 5, targetOverrides),
    role(BOT_ROLE_ID, "Guild Assistant", 10, { permissions: MANAGE_ROLES }),
  ];
}

function callbacks(overrides: Partial<RoleReconciliationCallbacks> = {}): RoleReconciliationCallbacks {
  return {
    addRole: vi.fn().mockResolvedValue(undefined),
    removeRole: vi.fn().mockResolvedValue(undefined),
    acquireLease: vi.fn().mockResolvedValue(undefined),
    releaseLease: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("computeRoleReconciliation", () => {
  it("computes minimal deterministic changes while preserving manual roles", () => {
    expect(
      computeRoleReconciliation({
        desiredUserIds: ["6", "1", "3", "3"],
        leasedUserIds: ["4", "2", "1"],
        roleHolderIds: ["6", "5", "2", "1"],
      }),
    ).toEqual({
      desiredUserIds: ["1", "3", "6"],
      leasedUserIds: ["1", "2", "4"],
      roleHolderIds: ["1", "2", "5", "6"],
      addRoleUserIds: ["3"],
      removeRoleUserIds: ["2"],
      acquireLeaseUserIds: ["3"],
      releaseLeaseUserIds: ["2", "4"],
      retainedLeaseUserIds: ["1"],
      manualRoleUserIds: ["6"],
      ignoredManualRoleUserIds: ["5"],
    });
  });

  it("repairs a leased desired role that is absent without acquiring another lease", () => {
    expect(
      computeRoleReconciliation({
        desiredUserIds: ["1"],
        leasedUserIds: ["1"],
        roleHolderIds: [],
      }),
    ).toMatchObject({
      addRoleUserIds: ["1"],
      acquireLeaseUserIds: [],
      removeRoleUserIds: [],
      releaseLeaseUserIds: [],
    });
  });

  it("releases a stale lease without issuing an unnecessary role removal", () => {
    expect(
      computeRoleReconciliation({
        desiredUserIds: [],
        leasedUserIds: ["1"],
        roleHolderIds: [],
      }),
    ).toMatchObject({
      removeRoleUserIds: [],
      releaseLeaseUserIds: ["1"],
    });
  });

  it("sorts snowflakes numerically and rejects malformed IDs", () => {
    expect(
      computeRoleReconciliation({
        desiredUserIds: ["10", "2", "100"],
        leasedUserIds: [],
        roleHolderIds: [],
      }).addRoleUserIds,
    ).toEqual(["2", "10", "100"]);

    expect(() =>
      computeRoleReconciliation({
        desiredUserIds: ["not-an-id"],
        leasedUserIds: [],
        roleHolderIds: [],
      }),
    ).toThrow("Discord snowflake");
  });
});

describe("reconcileRoles", () => {
  it("applies leases and roles in retry-safe order and reports every result", async () => {
    const calls: string[] = [];
    const report = await reconcileRoles({
      desiredUserIds: ["6", "1", "3"],
      leasedUserIds: ["4", "2", "1"],
      roleHolderIds: ["6", "5", "2", "1"],
      callbacks: {
        acquireLease: async (userId) => void calls.push(`acquire:${userId}`),
        addRole: async (userId) => void calls.push(`add:${userId}`),
        removeRole: async (userId) => void calls.push(`remove:${userId}`),
        releaseLease: async (userId) => void calls.push(`release:${userId}`),
      },
    });

    expect(calls).toEqual([
      "acquire:3",
      "add:3",
      "remove:2",
      "release:2",
      "release:4",
    ]);
    expect(report.ok).toBe(true);
    expect(report.outcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: "3", action: "acquire-lease", status: "succeeded" }),
        expect.objectContaining({ userId: "3", action: "add-role", status: "succeeded" }),
        expect.objectContaining({ userId: "2", action: "remove-role", status: "succeeded" }),
        expect.objectContaining({ userId: "4", action: "release-lease", status: "succeeded" }),
        expect.objectContaining({ userId: "6", action: "preserve-manual-role", status: "skipped" }),
        expect.objectContaining({ userId: "5", action: "preserve-manual-role", status: "skipped" }),
        expect.objectContaining({ userId: "1", action: "retain-role", status: "skipped" }),
      ]),
    );
  });

  it("does not execute callbacks during a dry run", async () => {
    const actions = callbacks();
    const report = await reconcileRoles({
      desiredUserIds: ["1"],
      leasedUserIds: ["2"],
      roleHolderIds: ["2"],
      callbacks: actions,
      dryRun: true,
    });

    expect(actions.acquireLease).not.toHaveBeenCalled();
    expect(actions.addRole).not.toHaveBeenCalled();
    expect(actions.removeRole).not.toHaveBeenCalled();
    expect(actions.releaseLease).not.toHaveBeenCalled();
    expect(report.dryRun).toBe(true);
    expect(report.ok).toBe(true);
    expect(report.outcomes.map((item) => item.status)).toEqual([
      "planned",
      "planned",
      "planned",
      "planned",
    ]);
  });

  it("does not add a role when lease acquisition fails", async () => {
    const actions = callbacks({
      acquireLease: vi.fn().mockRejectedValue(new Error("database unavailable")),
    });
    const report = await reconcileRoles({
      desiredUserIds: ["1"],
      leasedUserIds: [],
      roleHolderIds: [],
      callbacks: actions,
    });

    expect(actions.addRole).not.toHaveBeenCalled();
    expect(report.ok).toBe(false);
    expect(report.outcomes).toEqual([
      expect.objectContaining({
        action: "acquire-lease",
        status: "failed",
        error: "database unavailable",
      }),
      expect.objectContaining({ action: "add-role", status: "skipped" }),
    ]);
  });

  it("retains an acquired lease when role addition fails so a retry repairs it", async () => {
    const leases = new Set<string>();
    const holders = new Set<string>();
    let firstAttempt = true;
    const actions: RoleReconciliationCallbacks = {
      acquireLease: vi.fn(async (userId) => void leases.add(userId)),
      addRole: vi.fn(async (userId) => {
        if (firstAttempt) {
          firstAttempt = false;
          throw new Error("Discord temporarily unavailable");
        }
        holders.add(userId);
      }),
      removeRole: vi.fn(),
      releaseLease: vi.fn(),
    };

    const first = await reconcileRoles({
      desiredUserIds: ["1"],
      leasedUserIds: [...leases],
      roleHolderIds: [...holders],
      callbacks: actions,
    });
    const second = await reconcileRoles({
      desiredUserIds: ["1"],
      leasedUserIds: [...leases],
      roleHolderIds: [...holders],
      callbacks: actions,
    });

    expect(first.ok).toBe(false);
    expect(second.ok).toBe(true);
    expect(leases).toEqual(new Set(["1"]));
    expect(holders).toEqual(new Set(["1"]));
    expect(actions.acquireLease).toHaveBeenCalledTimes(1);
    expect(actions.addRole).toHaveBeenCalledTimes(2);
  });

  it("retries only lease cleanup after a successful role removal", async () => {
    const leases = new Set(["1"]);
    const holders = new Set(["1"]);
    let firstRelease = true;
    const actions: RoleReconciliationCallbacks = {
      acquireLease: vi.fn(),
      addRole: vi.fn(),
      removeRole: vi.fn(async (userId) => void holders.delete(userId)),
      releaseLease: vi.fn(async (userId) => {
        if (firstRelease) {
          firstRelease = false;
          throw new Error("write conflict");
        }
        leases.delete(userId);
      }),
    };

    const first = await reconcileRoles({
      desiredUserIds: [],
      leasedUserIds: [...leases],
      roleHolderIds: [...holders],
      callbacks: actions,
    });
    const second = await reconcileRoles({
      desiredUserIds: [],
      leasedUserIds: [...leases],
      roleHolderIds: [...holders],
      callbacks: actions,
    });

    expect(first.ok).toBe(false);
    expect(second.ok).toBe(true);
    expect(actions.removeRole).toHaveBeenCalledTimes(1);
    expect(actions.releaseLease).toHaveBeenCalledTimes(2);
    expect(leases.size).toBe(0);
  });

  it("keeps the lease when Discord role removal fails", async () => {
    const actions = callbacks({
      removeRole: vi.fn().mockRejectedValue(new Error("Missing Permissions")),
    });
    const report = await reconcileRoles({
      desiredUserIds: [],
      leasedUserIds: ["1"],
      roleHolderIds: ["1"],
      callbacks: actions,
    });

    expect(actions.releaseLease).not.toHaveBeenCalled();
    expect(report.ok).toBe(false);
    expect(report.outcomes).toEqual([
      expect.objectContaining({ action: "remove-role", status: "failed" }),
      expect.objectContaining({ action: "release-lease", status: "skipped" }),
    ]);
  });

  it("never adopts or removes a manually assigned role", async () => {
    const actions = callbacks();
    const report = await reconcileRoles({
      desiredUserIds: ["1"],
      leasedUserIds: [],
      roleHolderIds: ["1", "2"],
      callbacks: actions,
    });

    expect(actions.acquireLease).not.toHaveBeenCalled();
    expect(actions.addRole).not.toHaveBeenCalled();
    expect(actions.removeRole).not.toHaveBeenCalled();
    expect(actions.releaseLease).not.toHaveBeenCalled();
    expect(report.outcomes).toEqual([
      expect.objectContaining({ userId: "1", action: "preserve-manual-role" }),
      expect.objectContaining({ userId: "2", action: "preserve-manual-role" }),
    ]);
  });

  it("adapts Discord client methods and lease storage callbacks", async () => {
    const client = {
      addMemberRole: vi.fn().mockResolvedValue(undefined),
      removeMemberRole: vi.fn().mockResolvedValue(undefined),
    };
    const leases = {
      acquireLease: vi.fn().mockResolvedValue(undefined),
      releaseLease: vi.fn().mockResolvedValue(undefined),
    };
    const actions = createDiscordRoleCallbacks(
      client,
      GUILD_ID,
      TARGET_ROLE_ID,
      leases,
      "Weekly plan 42",
    );

    await actions.acquireLease("1");
    await actions.addRole("1");
    await actions.removeRole("1");
    await actions.releaseLease("1");

    expect(client.addMemberRole).toHaveBeenCalledWith(
      GUILD_ID,
      "1",
      TARGET_ROLE_ID,
      "Weekly plan 42: assign",
    );
    expect(client.removeMemberRole).toHaveBeenCalledWith(
      GUILD_ID,
      "1",
      TARGET_ROLE_ID,
      "Weekly plan 42: unassign",
    );
    expect(leases.acquireLease).toHaveBeenCalledWith("1");
    expect(leases.releaseLease).toHaveBeenCalledWith("1");
  });
});

describe("role configuration diagnostics", () => {
  it("passes when role permissions and hierarchy are correctly configured", () => {
    const report = diagnoseRoleConfiguration({
      guildId: GUILD_ID,
      targetRoleId: TARGET_ROLE_ID,
      roles: healthyRoles(),
      botMember: botMember(),
    });

    expect(report.ready).toBe(true);
    expect(report.targetRole?.id).toBe(TARGET_ROLE_ID);
    expect(report.botHighestRole?.id).toBe(BOT_ROLE_ID);
    expect(report.items).toHaveLength(6);
    expect(report.items.every((item) => item.status === "pass")).toBe(true);
  });

  it("warns without failing readiness when the target role is not mentionable", () => {
    const report = diagnoseRoleConfiguration({
      guildId: GUILD_ID,
      targetRoleId: TARGET_ROLE_ID,
      roles: healthyRoles({ mentionable: false }),
      botMember: botMember(),
    });

    expect(report.ready).toBe(true);
    expect(report.items.find((item) => item.id === "target-mentionable")).toMatchObject({
      status: "warn",
      remediation: expect.stringContaining("Allow anyone"),
    });
  });

  it("fails with remediation when the target role is missing", () => {
    const report = diagnoseRoleConfiguration({
      guildId: GUILD_ID,
      targetRoleId: TARGET_ROLE_ID,
      roles: healthyRoles().filter((item) => item.id !== TARGET_ROLE_ID),
      botMember: botMember(),
    });

    expect(report.ready).toBe(false);
    expect(report.items.find((item) => item.id === "target-exists")).toMatchObject({
      status: "fail",
      remediation: expect.stringContaining("/guild setup"),
    });
  });

  it("fails when the target role is managed by another integration", () => {
    const report = diagnoseRoleConfiguration({
      guildId: GUILD_ID,
      targetRoleId: TARGET_ROLE_ID,
      roles: healthyRoles({ managed: true }),
      botMember: botMember(),
    });

    expect(report.ready).toBe(false);
    expect(report.items.find((item) => item.id === "target-assignable")).toMatchObject({
      status: "fail",
      remediation: expect.stringContaining("normal server role"),
    });
  });

  it("fails when the bot's highest role is not above the target", () => {
    const roles = healthyRoles();
    const botRole = roles.find((item) => item.id === BOT_ROLE_ID)!;
    botRole.position = 5;
    const report = diagnoseRoleConfiguration({
      guildId: GUILD_ID,
      targetRoleId: TARGET_ROLE_ID,
      roles,
      botMember: botMember(),
    });

    expect(report.ready).toBe(false);
    expect(report.items.find((item) => item.id === "role-hierarchy")).toMatchObject({
      status: "fail",
      remediation: expect.stringContaining("drag the bot's integration role"),
    });
  });

  it("fails without Manage Roles but recognizes Administrator", () => {
    const noPermissionRoles = healthyRoles();
    noPermissionRoles.find((item) => item.id === BOT_ROLE_ID)!.permissions = "0";
    const failed = diagnoseRoleConfiguration({
      guildId: GUILD_ID,
      targetRoleId: TARGET_ROLE_ID,
      roles: noPermissionRoles,
      botMember: botMember(),
    });

    const administratorRoles = healthyRoles();
    administratorRoles.find((item) => item.id === BOT_ROLE_ID)!.permissions = "8";
    const passed = diagnoseRoleConfiguration({
      guildId: GUILD_ID,
      targetRoleId: TARGET_ROLE_ID,
      roles: administratorRoles,
      botMember: botMember(),
    });

    expect(failed.items.find((item) => item.id === "manage-roles")?.status).toBe("fail");
    expect(passed.items.find((item) => item.id === "manage-roles")).toMatchObject({
      status: "pass",
      detail: expect.stringContaining("Administrator"),
    });
  });

  it("fails safely when a bot role cannot be resolved or permissions are malformed", () => {
    const unresolved = diagnoseRoleConfiguration({
      guildId: GUILD_ID,
      targetRoleId: TARGET_ROLE_ID,
      roles: healthyRoles(),
      botMember: botMember([BOT_ROLE_ID, "999"]),
    });
    const malformedRoles = healthyRoles();
    malformedRoles.find((item) => item.id === BOT_ROLE_ID)!.permissions = "not-a-number";
    const malformed = diagnoseRoleConfiguration({
      guildId: GUILD_ID,
      targetRoleId: TARGET_ROLE_ID,
      roles: malformedRoles,
      botMember: botMember(),
    });

    expect(unresolved.ready).toBe(false);
    expect(unresolved.items.find((item) => item.id === "bot-role-resolution")?.status).toBe(
      "fail",
    );
    expect(malformed.ready).toBe(false);
    expect(malformed.items.find((item) => item.id === "manage-roles")?.status).toBe("fail");
  });

  it("loads Discord state concurrently for diagnostics", async () => {
    const client = {
      getGuildRoles: vi.fn().mockResolvedValue(healthyRoles()),
      getCurrentBotGuildMember: vi.fn().mockResolvedValue(botMember()),
    };

    const report = await diagnoseDiscordRole(client, GUILD_ID, TARGET_ROLE_ID);

    expect(report.ready).toBe(true);
    expect(client.getGuildRoles).toHaveBeenCalledWith(GUILD_ID);
    expect(client.getCurrentBotGuildMember).toHaveBeenCalledWith(GUILD_ID);
  });
});
