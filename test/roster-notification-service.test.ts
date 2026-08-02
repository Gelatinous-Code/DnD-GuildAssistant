import { describe, expect, it, vi } from "vitest";
import {
  DiscordApiError,
  type DiscordRestClient,
} from "../src/discord-api";
import { RosterNotificationService } from "../src/roster-notification-service";
import type {
  GuildRepository,
  RosterPromotionNotification,
} from "../src/storage/repository";

const NOW = Date.parse("2026-08-09T18:00:00Z");

function notification(
  overrides: Partial<RosterPromotionNotification> = {},
): RosterPromotionNotification {
  return {
    assignmentId: "assignment-1",
    guildId: "1533181439376494642",
    eventId: "event-1",
    planId: "plan-1",
    recipientUserId: "123456789012345678",
    displayName: "Chappy",
    eventTitle: "Weekly Games",
    openSeatingAt: Date.parse("2026-08-10T23:00:00Z"),
    eventStartsAt: Date.parse("2026-08-12T00:00:00Z"),
    attemptCount: 0,
    ...overrides,
  };
}

function setup(sendResult: unknown) {
  const item = notification();
  const repository = {
    listDueRosterPromotionNotifications: vi.fn().mockResolvedValue([item]),
    claimRosterPromotionNotification: vi.fn().mockResolvedValue(true),
    markRosterPromotionNotificationSent: vi.fn().mockResolvedValue(true),
    markRosterPromotionNotificationFailure: vi.fn().mockResolvedValue(true),
    appendAudit: vi.fn().mockResolvedValue(undefined),
  };
  const discord = {
    sendDirectMessage: vi.fn(),
  };
  if (sendResult instanceof Error) {
    discord.sendDirectMessage.mockRejectedValue(sendResult);
  } else {
    discord.sendDirectMessage.mockResolvedValue(sendResult);
  }
  return {
    item,
    repository,
    discord,
    service: new RosterNotificationService(
      repository as unknown as GuildRepository,
      discord as unknown as DiscordRestClient,
    ),
  };
}

describe("RosterNotificationService", () => {
  it("privately notifies the promoted player with an idempotent delivery key", async () => {
    const test = setup({
      id: "987654321098765432",
      channel_id: "876543210987654321",
      content: "",
    });

    const report = await test.service.deliverDue(NOW);

    expect(report).toMatchObject({ claimed: 1, sent: 1, retried: 0, blocked: 0 });
    expect(test.discord.sendDirectMessage).toHaveBeenCalledWith(
      test.item.recipientUserId,
      expect.objectContaining({
        content: expect.stringContaining("first on the global waitlist"),
        allowed_mentions: {
          parse: [],
          roles: [],
          users: [],
          replied_user: false,
        },
      }),
      "roster-promotion:assignment-1",
    );
    expect(test.repository.markRosterPromotionNotificationSent).toHaveBeenCalledWith(
      "assignment-1",
      "876543210987654321",
      "987654321098765432",
      NOW,
    );
  });

  it("marks a Discord cannot-message-user response as blocked", async () => {
    const test = setup(
      new DiscordApiError("POST", "/channels/x/messages", 403, {
        code: 50007,
        message: "Cannot send messages to this user",
      }),
    );

    const report = await test.service.deliverDue(NOW);

    expect(report.blocked).toBe(1);
    expect(test.repository.markRosterPromotionNotificationFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        assignmentId: "assignment-1",
        status: "blocked",
        nextAttemptAt: null,
      }),
      NOW,
    );
  });

  it("retries transient failures and stops after the maximum attempt", async () => {
    const transient = setup(new DiscordApiError("POST", "/channels/x/messages", 500, {}));
    const retryReport = await transient.service.deliverDue(NOW);
    expect(retryReport.retried).toBe(1);
    expect(transient.repository.markRosterPromotionNotificationFailure).toHaveBeenCalledWith(
      expect.objectContaining({ status: "retry", nextAttemptAt: NOW + 15 * 60_000 }),
      NOW,
    );

    const terminal = setup(new Error("network unavailable"));
    terminal.item.attemptCount = 4;
    const terminalReport = await terminal.service.deliverDue(NOW);
    expect(terminalReport.failed).toBe(1);
    expect(terminal.repository.markRosterPromotionNotificationFailure).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", nextAttemptAt: null }),
      NOW,
    );
  });

  it("does not send a stale promotion after games have begun", async () => {
    const test = setup({ id: "unused", channel_id: "unused", content: "" });
    test.item.eventStartsAt = NOW;

    const report = await test.service.deliverDue(NOW);

    expect(report.failed).toBe(1);
    expect(test.discord.sendDirectMessage).not.toHaveBeenCalled();
  });
});
