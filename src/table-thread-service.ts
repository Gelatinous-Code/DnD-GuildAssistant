import {
  ButtonStyle,
  ComponentType,
  DiscordApiError,
  DiscordRestClient,
  discordTimestamp,
  safeAllowedMentions,
} from "./discord-api";
import {
  TableThreadRepository,
  type TableThreadDelivery,
  type TableThreadTarget,
  type TableThreadWorkflow,
} from "./storage/table-thread-repository";

const GUILD_TEXT = 0;
const GUILD_ANNOUNCEMENT = 5;
const GUILD_FORUM = 15;
const GUILD_MEDIA = 16;

export type TableThreadDiscord = Pick<
  DiscordRestClient,
  | "getChannel"
  | "startThreadFromMessage"
  | "startForumThread"
  | "listActiveGuildThreads"
  | "editChannel"
  | "sendChannelMessage"
  | "sendDirectMessage"
>;

export interface TableThreadServiceOptions {
  now?: () => number;
  id?: () => string;
}

function defaultId(): string {
  return crypto.randomUUID();
}

function retryDelay(attemptCount: number): number {
  return Math.min(15 * 60_000 * 2 ** Math.min(attemptCount, 5), 6 * 60 * 60_000);
}

function errorKind(error: unknown): string {
  if (error instanceof DiscordApiError && error.status === 403) return "DiscordForbidden";
  if (error instanceof DiscordApiError && error.status === 404) return "DiscordNotFound";
  return error instanceof Error ? error.name : typeof error;
}

function cleanName(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
}

export function tableThreadName(target: TableThreadTarget, generation = 1): string {
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: target.timezone,
    month: "short",
    day: "numeric",
  }).format(new Date(target.startsAt));
  const base = `${date} • T${target.gameTier} Table ${target.tableNumber} • ${cleanName(target.gmDisplayName)}`;
  const suffix = generation > 1 ? ` • r${generation}` : "";
  return (base + suffix).slice(0, 100);
}

export function tableThreadUrl(guildId: string, threadId: string): string {
  return `https://discord.com/channels/${guildId}/${threadId}`;
}

export class TableThreadUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TableThreadUserError";
  }
}

export class TableThreadService {
  private readonly now: () => number;
  private readonly id: () => string;

  constructor(
    private readonly repository: TableThreadRepository,
    private readonly discord: TableThreadDiscord,
    options: TableThreadServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.id = options.id ?? defaultId;
  }

  async runScheduled(limit = 50): Promise<void> {
    const now = this.now();
    const targets = await this.repository.listPublishedTargets(now, limit);
    for (const target of targets) {
      await this.repository.ensureTarget({
        workflowId: this.id(),
        target,
        threadName: tableThreadName(target),
        now,
      });
    }

    const creations = await this.repository.listCreationDue(now, limit);
    for (const workflow of creations) await this.createThread(workflow);

    for (const target of targets) {
      const workflow = await this.repository.getByTable(
        target.guildId,
        target.eventId,
        target.tableNumber,
      );
      if (workflow?.status === "current") {
        await this.repository.ensureDelivery({ deliveryId: this.id(), workflow, now });
      }
    }

    const deliveries = await this.repository.listDeliveriesDue(now, limit);
    for (const delivery of deliveries) await this.deliver(delivery);
  }

  private async createThread(workflow: TableThreadWorkflow): Promise<void> {
    const now = this.now();
    try {
      const parent = await this.discord.getChannel(workflow.parentChannelId);
      let threadId: string;
      if (parent.type === GUILD_TEXT || parent.type === GUILD_ANNOUNCEMENT) {
        if (!workflow.sourceMessageId) {
          throw new TableThreadUserError("A text-channel table thread requires its published table message.");
        }
        threadId = workflow.sourceMessageId;
        if (!await this.repository.markCreating(workflow.workflowId, threadId, now)) return;
        let existing = null;
        try {
          existing = await this.discord.getChannel(threadId);
        } catch (error) {
          if (!(error instanceof DiscordApiError) || error.status !== 404) throw error;
        }
        if (existing) {
          if (existing.parent_id !== workflow.parentChannelId) {
            throw new Error("Recovered thread belongs to a different parent channel");
          }
        } else {
          await this.discord.startThreadFromMessage(
            workflow.parentChannelId,
            workflow.sourceMessageId,
            { name: workflow.threadName, auto_archive_duration: 10080 },
          );
        }
      } else if (parent.type === GUILD_FORUM || parent.type === GUILD_MEDIA) {
        if (!await this.repository.markCreating(workflow.workflowId, null, now)) return;
        const active = await this.discord.listActiveGuildThreads(workflow.guildId);
        const recovered = active.threads.find(
          (thread) => thread.parent_id === workflow.parentChannelId && thread.name === workflow.threadName,
        );
        if (recovered) {
          threadId = recovered.id;
        } else {
          const created = await this.discord.startForumThread(workflow.parentChannelId, {
            name: workflow.threadName,
            auto_archive_duration: 10080,
            message: {
              content:
                "The assigned DM will post the adventure introduction here when it is ready. Players are not added or mentioned automatically.",
              allowed_mentions: safeAllowedMentions(),
            },
          });
          threadId = created.id;
        }
      } else {
        throw new TableThreadUserError(
          "The configured table-thread channel must be a text, announcement, forum, or media channel.",
        );
      }
      await this.repository.markCurrent(workflow.workflowId, threadId, now);
    } catch (error) {
      await this.repository.markFailed(
        workflow.workflowId,
        errorKind(error),
        now + retryDelay(workflow.attemptCount),
        now,
      );
      console.error(JSON.stringify({
        kind: "guild-assistant.table-thread-create-failed",
        workflowId: workflow.workflowId,
        guildId: workflow.guildId,
        errorKind: errorKind(error),
      }));
    }
  }

  private async deliver(delivery: TableThreadDelivery): Promise<void> {
    const workflow = await this.repository.get(delivery.workflowId);
    if (!workflow?.threadId || workflow.status !== "current") return;
    const target = await this.repository.getPublishedTarget({
      guildId: workflow.guildId,
      tableNumber: workflow.tableNumber,
    });
    if (!target || target.gmUserId !== delivery.gmUserId) return;
    const now = this.now();
    try {
      const message = await this.discord.sendDirectMessage(
        delivery.gmUserId,
        {
          content: [
            `Your table thread for **${target.tableTitle}** is ready: ${discordTimestamp(target.startsAt)}.`,
            `Players finish choosing tables ${discordTimestamp(target.tableSelectionClosesAt)}.`,
            "",
            "Starter checklist:",
            "• Choose an adventure title and write the hook/description in your own words.",
            "• Ask for any character details you want, such as level, HP, passive Perception, or something adventure-specific.",
            "• Add or tag the current players only after you are happy with the introduction.",
            "",
            "The bot will not add players or standardize your questions.",
          ].join("\n"),
          components: [{
            type: ComponentType.ActionRow,
            components: [{
              type: ComponentType.Button,
              style: ButtonStyle.Link,
              label: "Open thread",
              url: tableThreadUrl(workflow.guildId, workflow.threadId),
            }],
          }],
          allowed_mentions: safeAllowedMentions(),
        },
        delivery.idempotencyKey,
      );
      await this.repository.markDeliverySent({
        deliveryId: delivery.deliveryId,
        channelId: message.channel_id,
        messageId: message.id,
        now,
      });
    } catch (error) {
      await this.repository.markDeliveryFailed({
        deliveryId: delivery.deliveryId,
        errorKind: errorKind(error),
        retryAt: now + retryDelay(delivery.attemptCount),
        now,
      });
    }
  }

  async status(input: {
    guildId: string;
    eventId?: string;
    tableNumber: number;
  }): Promise<{ workflow: TableThreadWorkflow | null; target: TableThreadTarget | null }> {
    const target = await this.repository.getPublishedTarget(input);
    if (!target) return { workflow: null, target: null };
    return {
      target,
      workflow: await this.repository.getByTable(
        target.guildId,
        target.eventId,
        target.tableNumber,
      ),
    };
  }

  async manage(input: {
    guildId: string;
    eventId?: string;
    tableNumber: number;
    action: "retry" | "recreate" | "cancel";
    parentChannelId?: string;
    actorUserId: string;
    reason: string;
  }): Promise<TableThreadWorkflow> {
    const reason = input.reason.trim();
    if (reason.length < 3 || reason.length > 500) {
      throw new TableThreadUserError("A reason between 3 and 500 characters is required.");
    }
    const target = await this.repository.getPublishedTarget(input);
    if (!target) throw new TableThreadUserError("No current published table matches that request.");
    let workflow = await this.repository.ensureTarget({
      workflowId: this.id(),
      target,
      threadName: tableThreadName(target),
      now: this.now(),
    });

    if (input.action === "cancel") {
      await this.repository.cancel({
        workflowId: workflow.workflowId,
        actorUserId: input.actorUserId,
        reason,
        now: this.now(),
        auditId: this.id(),
      });
      if (workflow.threadId) {
        try {
          await this.discord.editChannel(workflow.threadId, { archived: true, locked: true });
        } catch (error) {
          console.error(JSON.stringify({
            kind: "guild-assistant.table-thread-archive-failed",
            workflowId: workflow.workflowId,
            errorKind: errorKind(error),
          }));
        }
      }
    } else if (input.action === "retry") {
      if (workflow.status === "cancelled") {
        throw new TableThreadUserError("A cancelled workflow must be recreated, not retried.");
      }
      await this.repository.retry({
        workflowId: workflow.workflowId,
        actorUserId: input.actorUserId,
        reason,
        auditId: this.id(),
        now: this.now(),
      });
      await this.runScheduled();
    } else {
      const parentChannelId = input.parentChannelId ?? workflow.parentChannelId;
      const parent = await this.discord.getChannel(parentChannelId);
      let sourceMessageId: string | null = null;
      if (parent.type === GUILD_TEXT || parent.type === GUILD_ANNOUNCEMENT) {
        const anchor = await this.discord.sendChannelMessage(parentChannelId, {
          content: `Replacement thread anchor for ${target.tableTitle}.`,
          nonce: `table-thread-anchor:${workflow.workflowId}:${workflow.threadGeneration + 1}`,
          enforce_nonce: true,
          allowed_mentions: safeAllowedMentions(),
        });
        sourceMessageId = anchor.id;
      } else if (parent.type !== GUILD_FORUM && parent.type !== GUILD_MEDIA) {
        throw new TableThreadUserError(
          "The replacement channel must be a text, announcement, forum, or media channel.",
        );
      }
      if (workflow.threadId) {
        try {
          await this.discord.editChannel(workflow.threadId, { archived: true, locked: true });
        } catch (error) {
          console.error(JSON.stringify({
            kind: "guild-assistant.table-thread-archive-failed",
            workflowId: workflow.workflowId,
            errorKind: errorKind(error),
          }));
        }
      }
      await this.repository.recreate({
        workflowId: workflow.workflowId,
        actorUserId: input.actorUserId,
        reason,
        parentChannelId,
        sourceMessageId,
        threadName: tableThreadName(target, workflow.threadGeneration + 1),
        auditId: this.id(),
        now: this.now(),
      });
      await this.runScheduled();
    }
    workflow = await this.repository.get(workflow.workflowId) ?? workflow;
    return workflow;
  }
}
