import {
  SUMMARY_EDIT_WINDOW_MS,
  SUMMARY_MIN_REMINDER_AFTER_PROMPT_MS,
  summarySchedule,
  validateSessionSummaryFields,
  type SessionSummaryFields,
} from "./domain/session-summary";
import {
  ButtonStyle,
  ComponentType,
  DiscordRestClient,
  discordTimestamp,
  safeAllowedMentions,
} from "./discord-api";
import type { SessionService } from "./session-service";
import type {
  SessionSummary,
  SessionSummaryDelivery,
  SessionSummaryRepository,
} from "./storage/session-summary-repository";

const AUTO_COMPLETION_ACTOR = "system:auto-session-completion";

export type SummarySessionService = Pick<SessionService, "confirmSession">;

export interface SessionSummaryServiceOptions {
  now?: () => number;
  id?: () => string;
  recapsEnabled?: boolean;
}

function defaultId(): string {
  return crypto.randomUUID();
}

function errorKind(error: unknown): string {
  return error instanceof Error ? error.name.slice(0, 200) : typeof error;
}

function retryDelay(attemptCount: number): number {
  return Math.min(15 * 60_000 * 2 ** Math.min(attemptCount, 5), 6 * 60 * 60_000);
}

export function summaryOpenCustomId(summaryId: string): string {
  const customId = `guild:summary:open:${summaryId}`;
  if (customId.length > 100) throw new RangeError("Summary button ID exceeds Discord's limit");
  return customId;
}

export function summarySubmitCustomId(summaryId: string): string {
  const customId = `guild:summary:submit:${summaryId}`;
  if (customId.length > 100) throw new RangeError("Summary modal ID exceeds Discord's limit");
  return customId;
}

export function parseSummaryCustomId(
  customId: string | undefined,
): { action: "open" | "submit"; summaryId: string } | null {
  const match = /^guild:summary:(open|submit):([^:]{1,72})$/.exec(customId ?? "");
  return match ? { action: match[1] as "open" | "submit", summaryId: match[2]! } : null;
}

export class SummaryAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SummaryAccessError";
  }
}

export class SessionSummaryService {
  private readonly now: () => number;
  private readonly id: () => string;
  private readonly recapsEnabled: boolean;

  constructor(
    private readonly repository: SessionSummaryRepository,
    private readonly sessions: SummarySessionService,
    private readonly discord: Pick<DiscordRestClient, "sendDirectMessage">,
    options: SessionSummaryServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.id = options.id ?? defaultId;
    this.recapsEnabled = options.recapsEnabled ?? false;
  }

  async runScheduled(limit = 50): Promise<void> {
    const now = this.now();
    const dueTables = await this.repository.listAutoCompletionDue(now, limit);
    for (const table of dueTables) {
      try {
        await this.sessions.confirmSession({
          guildId: table.guildId,
          eventId: table.eventId,
          tableNumber: table.tableNumber,
          result: "completed",
          confirmedByUserId: AUTO_COMPLETION_ACTOR,
          idempotencyKey: `auto-session:${table.eventId}:${table.tableNumber}`,
        });
      } catch (error) {
        console.error(JSON.stringify({
          kind: "guild-assistant.auto-session-failed",
          guildId: table.guildId,
          eventId: table.eventId,
          tableNumber: table.tableNumber,
          errorKind: errorKind(error),
        }));
      }
    }

    if (!this.recapsEnabled) return;

    const creationTargets = await this.repository.listSummaryCreationDue(limit);
    for (const target of creationTargets) {
      const schedule = summarySchedule(target.sessionEndsAt);
      await this.repository.ensure({
        summaryId: this.id(),
        promptDeliveryId: this.id(),
        reminderDeliveryId: this.id(),
        guildId: target.guildId,
        sessionId: target.sessionId,
        completionRevisionId: target.completionRevisionId,
        dmUserId: target.dmUserId,
        sessionEndsAt: target.sessionEndsAt,
        dueAt: schedule.dueAt,
        reminderAt: Math.max(
          schedule.reminderAt,
          now + SUMMARY_MIN_REMINDER_AFTER_PROMPT_MS,
        ),
        createdAt: now,
      });
    }

    const deliveries = await this.repository.listDueDeliveries(now, limit);
    for (const delivery of deliveries) {
      await this.deliver(delivery);
    }
  }

  async getForDm(summaryId: string, userId: string): Promise<SessionSummary> {
    const summary = await this.repository.getById(summaryId);
    if (!summary) throw new SummaryAccessError("That session summary no longer exists.");
    if (summary.dmUserId !== userId) {
      throw new SummaryAccessError("Only the DM recorded for this session may edit its summary.");
    }
    if (
      summary.status === "submitted" &&
      summary.editExpiresAt !== null &&
      this.now() > summary.editExpiresAt
    ) {
      throw new SummaryAccessError("The seven-day summary edit window has closed.");
    }
    return summary;
  }

  async submit(input: {
    summaryId: string;
    userId: string;
    fields: SessionSummaryFields;
  }): Promise<{ summary: SessionSummary; onTime: boolean }> {
    const existing = await this.getForDm(input.summaryId, input.userId);
    const fields = validateSessionSummaryFields(input.fields);
    if (
      existing.status === "submitted" &&
      existing.summaryText === fields.summaryText &&
      existing.area === fields.area &&
      existing.importantEvents === fields.importantEvents &&
      existing.bonusRewards === fields.bonusRewards &&
      existing.otherNotes === fields.otherNotes
    ) {
      return { summary: existing, onTime: existing.firstSubmittedAt! <= existing.dueAt };
    }
    const submittedAt = this.now();
    const firstSubmittedAt = existing.firstSubmittedAt ?? submittedAt;
    const editExpiresAt = existing.editExpiresAt ?? firstSubmittedAt + SUMMARY_EDIT_WINDOW_MS;
    const summary = await this.repository.submit({
      summaryRevisionId: this.id(),
      guildId: existing.guildId,
      summaryId: existing.summaryId,
      expectedVersion: existing.version,
      fields,
      submittedByUserId: input.userId,
      submittedAt,
      firstSubmittedAt,
      editExpiresAt,
    });
    if (!summary) throw new SummaryAccessError("The summary changed; reopen it and retry.");
    return { summary, onTime: firstSubmittedAt <= existing.dueAt };
  }

  private async deliver(delivery: SessionSummaryDelivery): Promise<void> {
    const summary = await this.repository.get(delivery.guildId, delivery.summaryId);
    if (!summary || summary.status === "submitted") return;
    const now = this.now();
    try {
      const reminder = delivery.deliveryKind === "reminder";
      const message = await this.discord.sendDirectMessage(
        delivery.recipientUserId,
        {
          content: reminder
            ? `⏰ Your session summary is still waiting. The on-time deadline is ${discordTimestamp(summary.dueAt)}. You can edit for seven days after your first submission.`
            : `Thanks for running a guild session! Please submit the public session notes by ${discordTimestamp(summary.dueAt)}. Include the summary, area, important events, bonus gold or items, and anything else players should know.`,
          components: [{
            type: ComponentType.ActionRow,
            components: [{
              type: ComponentType.Button,
              style: ButtonStyle.Primary,
              custom_id: summaryOpenCustomId(summary.summaryId),
              label: "Write session summary",
            }],
          }],
          allowed_mentions: safeAllowedMentions(),
        },
        delivery.idempotencyKey,
      );
      await this.repository.markDeliverySent({
        guildId: delivery.guildId,
        deliveryId: delivery.deliveryId,
        channelId: message.channel_id,
        messageId: message.id,
        sentAt: now,
      });
    } catch (error) {
      await this.repository.markDeliveryFailed({
        guildId: delivery.guildId,
        deliveryId: delivery.deliveryId,
        errorKind: errorKind(error),
        nextAttemptAt: now + retryDelay(delivery.attemptCount),
        failedAt: now,
      });
    }
  }
}
