import {
  DiscordApiError,
  DiscordRestClient,
  discordNonce,
  safeAllowedMentions,
} from "./discord-api";
import type {
  PlayerJournal,
  PlayerJournalConfig,
  PlayerJournalRepository,
} from "./storage/player-journal-repository";

export const PLAYER_JOURNAL_EDIT_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;

export type JournalCustomAction = "open" | "submit";

export function journalOpenCustomId(journalId: string): string {
  return `journal:open:${journalId}`;
}

export function journalSubmitCustomId(journalId: string): string {
  return `journal:submit:${journalId}`;
}

export function parseJournalCustomId(
  value: string | undefined,
): { action: JournalCustomAction; journalId: string } | null {
  const match = /^journal:(open|submit):(.+)$/.exec(value ?? "");
  if (!match) return null;
  return { action: match[1] as JournalCustomAction, journalId: match[2]! };
}

function cleanText(value: string, label: string, max: number): string {
  const cleaned = value.replace(/\r\n?/g, "\n").trim();
  if (cleaned.length < 1 || cleaned.length > max) {
    throw new RangeError(`${label} must be between 1 and ${max} characters`);
  }
  return cleaned;
}

function cleanReason(value: string): string {
  const cleaned = value.replace(/[\r\n]+/g, " ").trim();
  if (cleaned.length < 3 || cleaned.length > 500) {
    throw new RangeError("Reason must be between 3 and 500 characters");
  }
  return cleaned;
}

function retryDelay(attemptCount: number): number {
  return Math.min(60 * 60_000, 30_000 * 2 ** Math.min(attemptCount, 7));
}

function errorKind(error: unknown): string {
  if (error instanceof DiscordApiError) return `discord_${error.status}`;
  return error instanceof Error ? error.name.slice(0, 200) : "unknown_error";
}

export class PlayerJournalAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlayerJournalAccessError";
  }
}

export class PlayerJournalService {
  constructor(
    private readonly repository: PlayerJournalRepository,
    private readonly discord: DiscordRestClient,
    private readonly now: () => number = Date.now,
    private readonly id: () => string = () => crypto.randomUUID(),
  ) {}

  async configure(input: {
    guildId: string;
    threadId: string;
    actorUserId: string;
  }): Promise<PlayerJournalConfig> {
    return this.repository.saveConfig({
      ...input,
      occurredAt: this.now(),
    });
  }

  getConfig(guildId: string): Promise<PlayerJournalConfig | null> {
    return this.repository.getConfig(guildId);
  }

  async prepareDraft(input: {
    guildId: string;
    authorUserId: string;
    characterId: string;
    sessionId?: string | null;
    operationKey: string;
  }): Promise<PlayerJournal> {
    const eligible = await this.repository.resolveEligibleSession(input);
    if (!eligible) {
      throw new PlayerJournalAccessError(
        "No completed session matches that approved character. You must have attended as a player.",
      );
    }
    return this.repository.ensureDraft({
      journalId: this.id(),
      journalEventId: this.id(),
      eligible,
      authorUserId: input.authorUserId,
      idempotencyKey: input.operationKey,
      createdAt: this.now(),
    });
  }

  async getForAuthor(journalId: string, authorUserId: string): Promise<PlayerJournal> {
    const journal = await this.repository.getForAuthor(journalId, authorUserId);
    if (!journal) {
      throw new PlayerJournalAccessError(
        "That journal is unavailable or the session is no longer a completed session you attended.",
      );
    }
    if (
      journal.status === "submitted" &&
      journal.editExpiresAt !== null &&
      this.now() > journal.editExpiresAt
    ) {
      throw new PlayerJournalAccessError("The seven-day journal editing window has closed.");
    }
    return journal;
  }

  async submit(input: {
    journalId: string;
    authorUserId: string;
    title: string;
    journalText: string;
    operationKey: string;
  }): Promise<PlayerJournal> {
    const replay = await this.repository.getSubmissionReplay(
      input.journalId, input.authorUserId, input.operationKey,
    );
    if (replay) {
      if (replay.deliveryStatus === "pending" || replay.deliveryStatus === "failed") {
        await this.publish(replay.journalId);
      }
      return (await this.repository.get(replay.guildId, replay.journalId)) ?? replay;
    }
    const journal = await this.getForAuthor(input.journalId, input.authorUserId);
    const now = this.now();
    const firstSubmittedAt = journal.firstSubmittedAt ?? now;
    const editExpiresAt = journal.editExpiresAt ??
      firstSubmittedAt + PLAYER_JOURNAL_EDIT_WINDOW_MS;
    if (now > editExpiresAt) {
      throw new PlayerJournalAccessError("The seven-day journal editing window has closed.");
    }
    const updated = await this.repository.submit({
      journalRevisionId: this.id(),
      journalEventId: this.id(),
      journal,
      title: cleanText(input.title, "Journal title", 100),
      journalText: cleanText(input.journalText, "Journal", 3_000),
      submittedByUserId: input.authorUserId,
      submittedAt: now,
      firstSubmittedAt,
      editExpiresAt,
      idempotencyKey: input.operationKey,
    });
    if (!updated) {
      throw new PlayerJournalAccessError(
        "The journal changed while the form was open. Reopen it and try again.",
      );
    }
    await this.publish(updated.journalId);
    return (await this.repository.get(updated.guildId, updated.journalId)) ?? updated;
  }

  listForAuthor(guildId: string, authorUserId: string): Promise<PlayerJournal[]> {
    return this.repository.listForAuthor(guildId, authorUserId, 10);
  }

  async publish(journalId: string): Promise<void> {
    const context = await this.repository.getPublicationContext(journalId);
    if (!context || context.journal.status !== "submitted" ||
      context.journal.publicationStatus !== "visible") return;
    const { journal } = context;
    const now = this.now();
    if (!context.threadId) {
      await this.repository.markPublicationFailed({
        journal,
        errorKind: "journal_thread_not_configured",
        nextAttemptAt: null,
        actorUserId: "system:journal-publication",
        eventId: this.id(),
        failedAt: now,
      });
      return;
    }
    const payload = {
      content: `Character journal for **${context.eventTitle}** · <t:${Math.floor(context.sessionEndsAt / 1_000)}:D>`,
      embeds: [{
        title: `${journal.title} — ${context.characterName}`,
        description: journal.journalText,
        color: 0x5865f2,
        footer: { text: `Author: ${journal.authorUserId} · Journal ${journal.journalId}` },
        timestamp: new Date(journal.lastSubmittedAt ?? now).toISOString(),
      }],
      allowed_mentions: safeAllowedMentions(),
    };
    try {
      const message = journal.discordMessageId && journal.discordThreadId === context.threadId
        ? await this.discord.editChannelMessage(
          context.threadId,
          journal.discordMessageId,
          payload,
        )
        : await this.discord.sendChannelMessage(context.threadId, {
          ...payload,
          nonce: discordNonce(`player-journal:${journal.journalId}`),
          enforce_nonce: true,
        });
      await this.repository.markPublished({
        journal,
        threadId: context.threadId,
        messageId: message.id,
        actorUserId: "system:journal-publication",
        eventId: this.id(),
        publishedAt: now,
      });
    } catch (error) {
      await this.repository.markPublicationFailed({
        journal,
        errorKind: errorKind(error),
        nextAttemptAt: now + retryDelay(journal.deliveryAttemptCount),
        actorUserId: "system:journal-publication",
        eventId: this.id(),
        failedAt: now,
      });
    }
  }

  async deliverDue(limit = 50): Promise<void> {
    for (const journalId of await this.repository.listDuePublications(this.now(), limit)) {
      await this.publish(journalId);
    }
  }

  async moderate(input: {
    guildId: string;
    journalId: string;
    action: "hide" | "unhide" | "retry";
    actorUserId: string;
    reason: string;
    operationKey: string;
  }): Promise<PlayerJournal> {
    const journal = await this.repository.get(input.guildId, input.journalId);
    if (!journal) throw new PlayerJournalAccessError("Player journal not found in this guild.");
    if (input.action === "hide" && journal.publicationStatus === "hidden") return journal;
    if (input.action === "unhide" && journal.publicationStatus === "visible") return journal;
    const updated = await this.repository.moderate({
      journal,
      action: input.action,
      actorUserId: input.actorUserId,
      reason: cleanReason(input.reason),
      eventId: this.id(),
      idempotencyKey: input.operationKey,
      occurredAt: this.now(),
    });
    if (input.action === "hide") {
      if (journal.discordThreadId && journal.discordMessageId) {
        try {
          await this.discord.editChannelMessage(journal.discordThreadId, journal.discordMessageId, {
            content: "This player journal has been hidden by a guild administrator.",
            embeds: [],
            allowed_mentions: safeAllowedMentions(),
          });
        } catch (error) {
          console.error(JSON.stringify({
            kind: "guild-assistant.journal-hide-publication-error",
            guildId: input.guildId,
            journalId: input.journalId,
            errorKind: errorKind(error),
          }));
        }
      }
    } else {
      await this.publish(updated.journalId);
    }
    return (await this.repository.get(input.guildId, input.journalId)) ?? updated;
  }
}
