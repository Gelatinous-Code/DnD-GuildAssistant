import {
  DiscordApiError,
  DiscordRestClient,
  discordTimestamp,
  safeAllowedMentions,
} from "./discord-api";
import {
  GuildRepository,
  type RosterPromotionNotification,
} from "./storage/repository";

const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MINUTES = [15, 30, 60, 240] as const;

export interface RosterNotificationReport {
  startedAt: number;
  completedAt: number;
  claimed: number;
  sent: number;
  retried: number;
  blocked: number;
  failed: number;
}

function retryAt(now: number, attemptNumber: number): number {
  const index = Math.min(
    Math.max(attemptNumber - 1, 0),
    RETRY_DELAYS_MINUTES.length - 1,
  );
  return now + RETRY_DELAYS_MINUTES[index] * 60_000;
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function promotionMessage(
  notification: RosterPromotionNotification,
  now: number,
): string {
  const heading = `🎟️ **A player spot opened for ${notification.eventTitle}.**`;
  if (now < notification.openSeatingAt) {
    return [
      heading,
      "You are first on the global waitlist, so the open player reservation has moved to you.",
      "Choose any published table that still has a seat. Your signup-order reservation lasts until " +
        discordTimestamp(notification.openSeatingAt) +
        ".",
      "A seat is not assigned until you choose a table. If life got in the way, no action is required and there is no penalty.",
      `Games begin ${discordTimestamp(notification.eventStartsAt)}.`,
    ].join("\n");
  }
  return [
    heading,
    "Open seating is already active, so any active player may claim a remaining seat first-come, first-served.",
    "Choose a published table promptly if you still want to play. A seat is not guaranteed until the table accepts your choice.",
    "If life got in the way, no action is required and there is no penalty.",
    `Games begin ${discordTimestamp(notification.eventStartsAt)}.`,
  ].join("\n");
}

export class RosterNotificationService {
  constructor(
    private readonly repository: GuildRepository,
    private readonly discord: DiscordRestClient,
  ) {}

  async deliverDue(now = Date.now(), limit = 25): Promise<RosterNotificationReport> {
    const report: RosterNotificationReport = {
      startedAt: now,
      completedAt: now,
      claimed: 0,
      sent: 0,
      retried: 0,
      blocked: 0,
      failed: 0,
    };
    const notifications =
      await this.repository.listDueRosterPromotionNotifications(now, limit);

    for (const notification of notifications) {
      const claimed = await this.repository.claimRosterPromotionNotification(
        notification.assignmentId,
        now,
      );
      if (!claimed) continue;
      report.claimed += 1;
      const attemptNumber = notification.attemptCount + 1;

      if (now >= notification.eventStartsAt) {
        await this.repository.markRosterPromotionNotificationFailure(
          {
            assignmentId: notification.assignmentId,
            status: "failed",
            error: "The game started before the promotion message could be delivered.",
          },
          now,
        );
        report.failed += 1;
        continue;
      }

      try {
        const message = await this.discord.sendDirectMessage(
          notification.recipientUserId,
          {
            content: promotionMessage(notification, now),
            allowed_mentions: safeAllowedMentions(),
          },
          "roster-promotion:" + notification.assignmentId,
        );
        const persisted = await this.repository.markRosterPromotionNotificationSent(
          notification.assignmentId,
          message.channel_id,
          message.id,
          now,
        );
        if (!persisted) throw new Error("The successful roster promotion DM was not persisted");
        await this.repository.appendAudit({
          guildId: notification.guildId,
          eventId: notification.eventId,
          action: "roster.promotion-notified",
          entityType: "assignment",
          entityId: notification.assignmentId,
          details: { attemptNumber },
        });
        report.sent += 1;
      } catch (error) {
        const blocked =
          error instanceof DiscordApiError &&
          (error.code === 50007 || error.status === 403);
        const terminal = blocked || attemptNumber >= MAX_ATTEMPTS;
        await this.repository.markRosterPromotionNotificationFailure(
          {
            assignmentId: notification.assignmentId,
            status: blocked ? "blocked" : terminal ? "failed" : "retry",
            nextAttemptAt: terminal ? null : retryAt(now, attemptNumber),
            error: errorMessage(error),
          },
          now,
        );
        if (blocked) report.blocked += 1;
        else if (terminal) report.failed += 1;
        else report.retried += 1;
      }
    }

    report.completedAt = Date.now();
    console.log(JSON.stringify({ kind: "guild-assistant.roster-notifications", ...report }));
    return report;
  }
}
