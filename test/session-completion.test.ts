import { describe, expect, it, vi } from "vitest";
import {
  applySessionAttendanceDeviation,
  validateSessionCompletion,
  type SessionParticipant,
} from "../src/domain/session-completion";
import {
  SessionService,
  SessionSourceUnavailableError,
  type SessionPriorityRepository,
  type SessionPriorityService,
  type SessionServiceRepository,
} from "../src/session-service";
import type { DmPriorityGrant } from "../src/storage/priority-repository";
import type {
  FinalizedSessionSource,
  SessionCompletion,
  SessionCompletionRevision,
} from "../src/storage/session-repository";

const CONFIRMED_AT = Date.parse("2026-08-18T18:00:00Z");

function participant(
  overrides: Partial<SessionParticipant> = {},
): SessionParticipant {
  return {
    userId: "dm-1",
    role: "dm",
    outcome: "attended",
    replacesUserId: null,
    wasPlanned: true,
    recordedByUserId: "admin-1",
    reason: null,
    ...overrides,
  };
}

function source(): FinalizedSessionSource {
  return {
    sessionGuildId: "guild-1",
    eventId: "event-1",
    planId: "plan-1",
    tableId: "table-1",
    tableNumber: 1,
    plannedDmUserId: "dm-1",
    timezone: "America/Denver",
    endsAt: CONFIRMED_AT - 1,
  };
}

function session(overrides: Partial<SessionCompletion> = {}): SessionCompletion {
  return {
    sessionId: "session-1",
    guildId: "guild-1",
    sourceEventId: "event-1",
    sourcePlanId: "plan-1",
    sourceTableId: "table-1",
    draftOpen: false,
    draftVersion: 1,
    draftBaseRevisionId: null,
    draftOperationKey: "draft-key",
    rewardSyncRevisionId: "revision-1",
    rewardSyncStatus: "pending",
    rewardSyncErrorKind: null,
    createdAt: CONFIRMED_AT,
    updatedAt: CONFIRMED_AT,
    ...overrides,
  };
}

function revision(
  overrides: Partial<SessionCompletionRevision> = {},
): SessionCompletionRevision {
  return {
    completionRevisionId: "revision-1",
    sessionId: "session-1",
    guildId: "guild-1",
    revisionNumber: 1,
    result: "completed",
    actualDmUserId: "dm-1",
    earnedTimezone: "America/Denver",
    confirmedByUserId: "admin-1",
    confirmedAt: CONFIRMED_AT,
    reason: null,
    supersedesRevisionId: null,
    isCurrent: true,
    createdAt: CONFIRMED_AT,
    ...overrides,
  };
}

function grant(dmUserId = "dm-1", grantId = "grant-1"): DmPriorityGrant {
  return {
    grantId,
    guildId: "guild-1",
    completionRevisionId: "revision-1",
    sourceEventId: "event-1",
    sourcePlanId: "plan-1",
    sourceTableId: "table-1",
    dmUserId,
    policyVersion: "dm-priority-v1",
    earnedTimeZone: "America/Denver",
    earnedAt: CONFIRMED_AT,
    expiresAt: CONFIRMED_AT + 1_000_000,
    grantedByUserId: "admin-1",
    idempotencyKey: "dm-priority:grant:revision-1",
    status: "active",
    correctedAt: null,
    correctedByUserId: null,
    correctionReason: null,
    correctionKey: null,
    createdAt: CONFIRMED_AT,
    updatedAt: CONFIRMED_AT,
  };
}

function sessionRepository(
  overrides: Partial<SessionServiceRepository> = {},
): SessionServiceRepository {
  return {
    resolveFinalizedSource: vi.fn(async () => source()),
    getSessionBySource: vi.fn(async () => session()),
    getSession: vi.fn(async () => session()),
    getCurrentRevision: vi.fn(async () => revision()),
    listDraftParticipants: vi.fn(async () => [participant()]),
    listRevisionParticipants: vi.fn(async () => [participant()]),
    ensureDraft: vi.fn(async () => session({ draftOpen: true })),
    saveDraftParticipants: vi.fn(async () => session({ draftOpen: true, draftVersion: 2 })),
    confirmDraft: vi.fn(async () => ({
      created: true,
      replayed: false,
      session: session(),
      revision: revision(),
      participants: [participant()],
    })),
    listRewardSyncDue: vi.fn(async () => []),
    markRewardSynced: vi.fn(async () => true),
    markRewardFailed: vi.fn(async () => true),
    ...overrides,
  };
}

function priorityRepository(
  activeGrant: DmPriorityGrant | null = null,
): SessionPriorityRepository {
  return {
    getActiveGrantForSourceTable: vi.fn(async () => activeGrant),
  };
}

function priorityService(
  awarded = grant(),
): SessionPriorityService {
  return {
    grantCompletedSessionReward: vi.fn(async () => ({
      created: true,
      grant: awarded,
      credits: [] as never,
    })),
    correctGrant: vi.fn(async () => null),
  };
}

describe("session completion policy", () => {
  it("records a substitute DM, marks the planned DM absent, and identifies one actual DM", () => {
    const next = applySessionAttendanceDeviation([participant()], {
      userId: "dm-2",
      role: "dm",
      outcome: "substitute",
      replacesUserId: "dm-1",
      recordedByUserId: "admin-1",
      reason: "The planned DM was ill",
    });

    expect(next).toEqual([
      expect.objectContaining({ userId: "dm-1", outcome: "no_show" }),
      expect.objectContaining({
        userId: "dm-2",
        outcome: "substitute",
        replacesUserId: "dm-1",
      }),
    ]);
    expect(validateSessionCompletion("completed", next).actualDmUserId).toBe("dm-2");
  });

  it("rejects completed sessions without exactly one actual DM", () => {
    expect(() =>
      validateSessionCompletion("completed", [participant({ outcome: "no_show" })]),
    ).toThrow("exactly one");
    expect(() =>
      validateSessionCompletion("completed", [
        participant(),
        participant({ userId: "dm-2", outcome: "walk_in", wasPlanned: false }),
      ]),
    ).toThrow("exactly one");
    expect(validateSessionCompletion("cancelled", [participant()]).actualDmUserId).toBeNull();
  });
});

describe("SessionService", () => {
  it("requires an ended, archived, finalized source table", async () => {
    const sessions = sessionRepository({ resolveFinalizedSource: vi.fn(async () => null) });
    const service = new SessionService(sessions, priorityRepository(), priorityService());

    await expect(service.status("guild-1", "event-1", 1)).rejects.toBeInstanceOf(
      SessionSourceUnavailableError,
    );
  });

  it("uses the persisted confirmation time when granting exactly one reward batch", async () => {
    const draft = session({ draftOpen: true, rewardSyncRevisionId: null, rewardSyncStatus: "none" });
    const sessions = sessionRepository({
      getSessionBySource: vi.fn(async () => draft),
      ensureDraft: vi.fn(async () => draft),
      getSession: vi.fn(async () => session()),
    });
    const priority = priorityService();
    const ids = [
      "unused-session-id",
      "unused-draft-event-id",
      "revision-1",
      "confirm-event",
      "sync-event",
    ];
    const service = new SessionService(sessions, priorityRepository(), priority, {
      now: () => CONFIRMED_AT,
      id: () => ids.shift() ?? "extra-id",
    });

    const result = await service.confirmSession({
      guildId: "guild-1",
      eventId: "event-1",
      tableNumber: 1,
      result: "completed",
      confirmedByUserId: "admin-1",
      idempotencyKey: "interaction-1",
    });

    expect(result.reward.status).toBe("synced");
    expect(priority.grantCompletedSessionReward).toHaveBeenCalledWith(
      expect.objectContaining({
        completionRevisionId: "revision-1",
        earnedAt: CONFIRMED_AT,
        dmUserId: "dm-1",
        idempotencyKey: "dm-priority:grant:revision-1",
      }),
    );
  });

  it("retains an active grant when an attendance-only correction keeps the same DM", async () => {
    const sessions = sessionRepository();
    const priority = priorityService();
    const active = grant("dm-1");
    const service = new SessionService(sessions, priorityRepository(active), priority, {
      now: () => CONFIRMED_AT,
      id: () => "event-id",
    });

    const result = await service.reconcileReward("guild-1", "session-1");

    expect(result).toMatchObject({ status: "synced", activeGrant: active });
    expect(priority.correctGrant).not.toHaveBeenCalled();
    expect(priority.grantCompletedSessionReward).not.toHaveBeenCalled();
  });

  it("corrects the prior grant and awards the corrected actual DM", async () => {
    const correctedRevision = revision({
      completionRevisionId: "revision-2",
      revisionNumber: 2,
      actualDmUserId: "dm-2",
      confirmedAt: CONFIRMED_AT + 10,
      reason: "Wrong actual DM",
      supersedesRevisionId: "revision-1",
    });
    const sessions = sessionRepository({
      getCurrentRevision: vi.fn(async () => correctedRevision),
    });
    const oldGrant = grant("dm-1");
    const newGrant = grant("dm-2", "grant-2");
    const priority = priorityService(newGrant);
    const service = new SessionService(sessions, priorityRepository(oldGrant), priority, {
      now: () => CONFIRMED_AT + 10,
      id: () => "event-id",
    });

    const result = await service.reconcileReward("guild-1", "session-1");

    expect(priority.correctGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        grantId: "grant-1",
        idempotencyKey: "session:reward-correct:grant-1:revision-2",
      }),
    );
    expect(priority.grantCompletedSessionReward).toHaveBeenCalledWith(
      expect.objectContaining({ dmUserId: "dm-2", earnedAt: CONFIRMED_AT + 10 }),
    );
    expect(result).toMatchObject({ status: "synced", activeGrant: newGrant });
  });

  it("persists a failed reward sync and retries it from the due queue", async () => {
    const sessions = sessionRepository({
      listRewardSyncDue: vi.fn(async () => [
        session({ rewardSyncStatus: "failed", rewardSyncErrorKind: "Error" }),
      ]),
    });
    const grantReward = vi
      .fn<SessionPriorityService["grantCompletedSessionReward"]>()
      .mockRejectedValueOnce(new Error("D1 temporarily unavailable"))
      .mockResolvedValueOnce({
        created: true,
        grant: grant(),
        credits: [] as never,
      });
    const priority: SessionPriorityService = {
      grantCompletedSessionReward: grantReward,
      correctGrant: vi.fn(async () => null),
    };
    const service = new SessionService(sessions, priorityRepository(), priority, {
      now: () => CONFIRMED_AT,
      id: () => "event-id",
    });

    const failed = await service.reconcileReward("guild-1", "session-1");
    const retried = await service.reconcilePendingRewards();

    expect(failed).toMatchObject({ status: "failed", errorKind: "Error" });
    expect(sessions.markRewardFailed).toHaveBeenCalledWith(
      expect.objectContaining({ revisionId: "revision-1", errorKind: "Error" }),
    );
    expect(retried).toEqual([
      expect.objectContaining({ status: "synced", activeGrant: grant() }),
    ]);
    expect(grantReward).toHaveBeenCalledTimes(2);
    expect(grantReward).toHaveBeenLastCalledWith(
      expect.objectContaining({ earnedAt: CONFIRMED_AT }),
    );
  });

  it("corrects a grant without replacing it when the session is cancelled", async () => {
    const cancelled = revision({
      completionRevisionId: "revision-2",
      revisionNumber: 2,
      result: "cancelled",
      actualDmUserId: null,
      reason: "The table did not run",
      supersedesRevisionId: "revision-1",
    });
    const sessions = sessionRepository({ getCurrentRevision: vi.fn(async () => cancelled) });
    const priority = priorityService();
    const service = new SessionService(sessions, priorityRepository(grant()), priority, {
      now: () => CONFIRMED_AT,
      id: () => "event-id",
    });

    const result = await service.reconcileReward("guild-1", "session-1");

    expect(priority.correctGrant).toHaveBeenCalledOnce();
    expect(priority.grantCompletedSessionReward).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "synced", activeGrant: null });
  });
});
