import { describe, expect, it, vi } from "vitest";
import { DiscordApiError } from "../src/discord-api";
import { SessionSummaryService } from "../src/session-summary-service";
import type { SessionSummaryRepository } from "../src/storage/session-summary-repository";

describe("session recap delivery recovery", () => {
  it("records a blocked DM as an observable bounded error", async () => {
    const markDeliveryFailed = vi.fn().mockResolvedValue(true);
    const repository = {
      listAutoCompletionDue: vi.fn().mockResolvedValue([]),
      listSummaryCreationDue: vi.fn().mockResolvedValue([]),
      listDueDeliveries: vi.fn().mockResolvedValue([{
        deliveryId: "delivery-1",
        summaryId: "summary-1",
        guildId: "guild-1",
        deliveryKind: "prompt",
        recipientUserId: "100000000000000001",
        scheduledFor: 1_000,
        status: "pending",
        attemptCount: 0,
        nextAttemptAt: null,
        discordChannelId: null,
        discordMessageId: null,
        lastErrorKind: null,
        idempotencyKey: "session-summary:prompt:summary-1",
        createdAt: 1_000,
        updatedAt: 1_000,
      }]),
      get: vi.fn().mockResolvedValue({
        summaryId: "summary-1",
        guildId: "guild-1",
        sessionId: "session-1",
        completionRevisionId: "completion-1",
        dmUserId: "100000000000000001",
        sessionEndsAt: 500,
        dueAt: 3_000,
        status: "pending",
        summaryText: "",
        area: "",
        importantEvents: null,
        bonusRewards: null,
        otherNotes: null,
        firstSubmittedAt: null,
        editExpiresAt: null,
        lastSubmittedAt: null,
        publicationStatus: "visible",
        hiddenAt: null,
        hiddenByUserId: null,
        hiddenReason: null,
        rewardPolicyVersion: "test-reward-v1",
        authorEditStatus: "open",
        editLockedAt: null,
        editLockedByUserId: null,
        editLockReason: null,
        version: 1,
        createdAt: 1_000,
        updatedAt: 1_000,
      }),
      markDeliveryFailed,
    } as unknown as SessionSummaryRepository;
    const service = new SessionSummaryService(
      repository,
      { confirmSession: vi.fn() },
      {
        sendDirectMessage: vi.fn().mockRejectedValue(
          new DiscordApiError("POST", "/channels/1/messages", 403, {
            code: 50_007,
            message: "Cannot send messages to this user",
          }),
        ),
      },
      {
        now: () => 2_000,
        recapsEnabled: true,
        rewardPolicyVersion: "test-reward-v1",
      },
    );

    await service.runScheduled();

    expect(markDeliveryFailed).toHaveBeenCalledWith(expect.objectContaining({
      guildId: "guild-1",
      deliveryId: "delivery-1",
      errorKind: "discord_dm_blocked",
    }));
  });
});
