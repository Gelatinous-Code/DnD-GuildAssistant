import { describe, expect, it, vi } from "vitest";
import {
  DM_PRIORITY_POLICY_VERSION,
  calculateDmPriorityExpiration,
} from "../src/domain/dm-priority-policy";
import {
  PriorityService,
  type PriorityServiceRepository,
} from "../src/priority-service";
import type { DmPriorityCredit } from "../src/storage/priority-repository";

function repositoryFixture(): PriorityServiceRepository {
  return {
    grantCompletedSessionReward: vi.fn(),
    listAvailableCredits: vi.fn(async () => []),
    reserveNextCredit: vi.fn(async () => null),
    redeemReservedCredit: vi.fn(async () => null),
    refundCredit: vi.fn(async () => null),
    listDueCredits: vi.fn(async () => []),
    expireCredit: vi.fn(async () => null),
    correctGrant: vi.fn(async () => null),
  };
}

function credit(overrides: Partial<DmPriorityCredit> = {}): DmPriorityCredit {
  return {
    creditId: "credit-1",
    grantId: "grant-1",
    guildId: "guild-1",
    userId: "dm-1",
    ordinal: 1,
    earnedAt: 1_000,
    expiresAt: 2_000,
    status: "available",
    targetEventId: null,
    targetAssignmentId: null,
    reservedAt: null,
    redeemedAt: null,
    lastOperationKey: null,
    version: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

describe("PriorityService", () => {
  it("awards exactly two IDs with the captured guild-zone expiry", async () => {
    const repository = repositoryFixture();
    vi.mocked(repository.grantCompletedSessionReward).mockImplementation(async (input) => ({
      created: true,
      grant: {
        grantId: input.grantId,
        guildId: input.guildId,
        completionRevisionId: input.completionRevisionId,
        sourceEventId: input.sourceEventId,
        sourcePlanId: input.sourcePlanId,
        sourceTableId: input.sourceTableId,
        dmUserId: input.dmUserId,
        policyVersion: input.policyVersion,
        earnedTimeZone: input.earnedTimeZone,
        earnedAt: input.earnedAt,
        expiresAt: input.expiresAt,
        grantedByUserId: input.grantedByUserId,
        idempotencyKey: input.idempotencyKey,
        status: "active",
        correctedAt: null,
        correctedByUserId: null,
        correctionReason: null,
        correctionKey: null,
        createdAt: input.earnedAt,
        updatedAt: input.earnedAt,
      },
      credits: [
        credit({ creditId: input.creditIds[0], earnedAt: input.earnedAt, expiresAt: input.expiresAt }),
        credit({
          creditId: input.creditIds[1],
          ordinal: 2,
          earnedAt: input.earnedAt,
          expiresAt: input.expiresAt,
        }),
      ],
    }));
    const earnedAt = Date.parse("2026-08-18T18:00:00Z");
    const ids = ["grant-id", "credit-one", "credit-two"];
    const service = new PriorityService(repository, {
      now: () => earnedAt,
      id: () => ids.shift() ?? "unexpected",
    });

    const result = await service.grantCompletedSessionReward({
      guildId: "guild-1",
      completionRevisionId: "completion-rev-1",
      sourceEventId: "event-1",
      sourcePlanId: "plan-1",
      sourceTableId: "table-1",
      dmUserId: "dm-1",
      grantedByUserId: "admin-1",
      earnedTimeZone: "America/Denver",
      earnedAt,
      idempotencyKey: "grant:completion-rev-1",
    });

    expect(result.credits.map(({ creditId }) => creditId)).toEqual([
      "credit-one",
      "credit-two",
    ]);
    expect(repository.grantCompletedSessionReward).toHaveBeenCalledWith(
      expect.objectContaining({
        policyVersion: DM_PRIORITY_POLICY_VERSION,
        earnedAt,
        expiresAt: calculateDmPriorityExpiration(earnedAt, "America/Denver").expiresAt,
        creditIds: ["credit-one", "credit-two"],
      }),
    );
  });

  it("uses one captured timestamp and transition ID for an atomic reservation", async () => {
    const repository = repositoryFixture();
    const service = new PriorityService(repository, {
      now: () => 1_500,
      id: () => "transition-1",
    });

    await service.reserveNextCredit({
      guildId: "guild-1",
      userId: "dm-1",
      targetEventId: "event-2",
      idempotencyKey: "reserve:event-2:dm-1",
    });

    expect(repository.reserveNextCredit).toHaveBeenCalledWith({
      creditEventId: "transition-1",
      guildId: "guild-1",
      userId: "dm-1",
      targetEventId: "event-2",
      reservedAt: 1_500,
      actorUserId: "dm-1",
      idempotencyKey: "reserve:event-2:dm-1",
    });
  });

  it("expires a due batch with stable per-credit replay keys", async () => {
    const repository = repositoryFixture();
    vi.mocked(repository.listDueCredits).mockResolvedValue([
      credit({ creditId: "credit-a", expiresAt: 1_400 }),
      credit({
        creditId: "credit-b",
        ordinal: 2,
        expiresAt: 1_450,
        status: "reserved",
        targetEventId: "event-2",
        reservedAt: 1_300,
      }),
    ]);
    const service = new PriorityService(repository, {
      now: () => 1_500,
      id: (() => {
        let next = 0;
        return () => `transition-${++next}`;
      })(),
    });

    await service.expireDueCredits("guild-1", 25);

    expect(repository.listDueCredits).toHaveBeenCalledWith("guild-1", 1_500, 25);
    expect(repository.expireCredit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        creditId: "credit-a",
        idempotencyKey: "dm-priority:expire:credit-a:1400",
      }),
    );
    expect(repository.expireCredit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        creditId: "credit-b",
        targetEventId: "event-2",
        idempotencyKey: "dm-priority:expire:credit-b:1450",
      }),
    );
  });
});
