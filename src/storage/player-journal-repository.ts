export interface PlayerJournalConfig {
  guildId: string;
  threadId: string;
  configuredByUserId: string;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface PlayerJournal {
  journalId: string;
  guildId: string;
  sessionId: string;
  completionRevisionId: string;
  summaryId: string;
  characterId: string;
  authorUserId: string;
  status: "draft" | "submitted";
  title: string;
  journalText: string;
  firstSubmittedAt: number | null;
  editExpiresAt: number | null;
  lastSubmittedAt: number | null;
  publicationStatus: "visible" | "hidden";
  hiddenAt: number | null;
  hiddenByUserId: string | null;
  hiddenReason: string | null;
  deliveryStatus: "pending" | "sent" | "failed" | "not_configured" | "hidden";
  deliveryAttemptCount: number;
  nextDeliveryAttemptAt: number | null;
  lastDeliveryErrorKind: string | null;
  discordThreadId: string | null;
  discordMessageId: string | null;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface EligibleJournalSession {
  guildId: string;
  sessionId: string;
  completionRevisionId: string;
  summaryId: string;
  characterId: string;
  characterName: string;
  eventTitle: string;
  sessionEndsAt: number;
}

export interface JournalPublicationContext {
  journal: PlayerJournal;
  characterName: string;
  eventTitle: string;
  sessionEndsAt: number;
  threadId: string | null;
}

type ConfigRow = {
  guild_id: string;
  thread_id: string;
  configured_by_user_id: string;
  version: number;
  created_at: number;
  updated_at: number;
};

type JournalRow = {
  journal_id: string;
  guild_id: string;
  session_id: string;
  completion_revision_id: string;
  summary_id: string;
  character_id: string;
  author_user_id: string;
  status: "draft" | "submitted";
  title: string | null;
  journal_text: string | null;
  first_submitted_at: number | null;
  edit_expires_at: number | null;
  last_submitted_at: number | null;
  publication_status: "visible" | "hidden";
  hidden_at: number | null;
  hidden_by_user_id: string | null;
  hidden_reason: string | null;
  delivery_status: "pending" | "sent" | "failed" | "not_configured" | "hidden";
  delivery_attempt_count: number;
  next_delivery_attempt_at: number | null;
  last_delivery_error_kind: string | null;
  discord_thread_id: string | null;
  discord_message_id: string | null;
  version: number;
  created_at: number;
  updated_at: number;
};

type EligibleRow = {
  guild_id: string;
  session_id: string;
  completion_revision_id: string;
  summary_id: string;
  character_id: string;
  character_name: string;
  event_title: string;
  session_ends_at: number;
};

type PublicationRow = JournalRow & {
  character_name: string;
  event_title: string;
  session_ends_at: number;
  thread_id: string | null;
};

function configFromRow(row: ConfigRow): PlayerJournalConfig {
  return {
    guildId: row.guild_id,
    threadId: row.thread_id,
    configuredByUserId: row.configured_by_user_id,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function journalFromRow(row: JournalRow): PlayerJournal {
  return {
    journalId: row.journal_id,
    guildId: row.guild_id,
    sessionId: row.session_id,
    completionRevisionId: row.completion_revision_id,
    summaryId: row.summary_id,
    characterId: row.character_id,
    authorUserId: row.author_user_id,
    status: row.status,
    title: row.title ?? "",
    journalText: row.journal_text ?? "",
    firstSubmittedAt: row.first_submitted_at,
    editExpiresAt: row.edit_expires_at,
    lastSubmittedAt: row.last_submitted_at,
    publicationStatus: row.publication_status,
    hiddenAt: row.hidden_at,
    hiddenByUserId: row.hidden_by_user_id,
    hiddenReason: row.hidden_reason,
    deliveryStatus: row.delivery_status,
    deliveryAttemptCount: row.delivery_attempt_count,
    nextDeliveryAttemptAt: row.next_delivery_attempt_at,
    lastDeliveryErrorKind: row.last_delivery_error_kind,
    discordThreadId: row.discord_thread_id,
    discordMessageId: row.discord_message_id,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function eligibleFromRow(row: EligibleRow): EligibleJournalSession {
  return {
    guildId: row.guild_id,
    sessionId: row.session_id,
    completionRevisionId: row.completion_revision_id,
    summaryId: row.summary_id,
    characterId: row.character_id,
    characterName: row.character_name,
    eventTitle: row.event_title,
    sessionEndsAt: row.session_ends_at,
  };
}

export class PlayerJournalRepository {
  constructor(private readonly db: D1Database) {}

  async getConfig(guildId: string): Promise<PlayerJournalConfig | null> {
    const row = await this.db.prepare(
      "SELECT * FROM player_journal_config WHERE guild_id = ?",
    ).bind(guildId).first<ConfigRow>();
    return row ? configFromRow(row) : null;
  }

  async saveConfig(input: {
    guildId: string;
    threadId: string;
    actorUserId: string;
    occurredAt: number;
  }): Promise<PlayerJournalConfig> {
    await this.db.prepare(
      `INSERT INTO player_journal_config (
         guild_id, thread_id, configured_by_user_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(guild_id) DO UPDATE SET
         thread_id = excluded.thread_id,
         configured_by_user_id = excluded.configured_by_user_id,
         version = player_journal_config.version + 1,
         updated_at = excluded.updated_at`,
    ).bind(
      input.guildId,
      input.threadId,
      input.actorUserId,
      input.occurredAt,
      input.occurredAt,
    ).run();
    const config = await this.getConfig(input.guildId);
    if (!config) throw new Error("Player journal configuration was not persisted");
    await this.db.prepare(
      `UPDATE player_journals SET delivery_status = 'pending',
         next_delivery_attempt_at = NULL, last_delivery_error_kind = NULL,
         updated_at = ?
       WHERE guild_id = ? AND status = 'submitted'
         AND publication_status = 'visible' AND delivery_status = 'not_configured'`,
    ).bind(input.occurredAt, input.guildId).run();
    return config;
  }

  async resolveEligibleSession(input: {
    guildId: string;
    authorUserId: string;
    characterId: string;
    sessionId?: string | null;
  }): Promise<EligibleJournalSession | null> {
    const row = await this.db.prepare(
      `SELECT revision.guild_id, revision.session_id,
              revision.completion_revision_id, summary.summary_id,
              character.character_id, character.name AS character_name,
              event.title AS event_title, event.ends_at AS session_ends_at
       FROM session_completion_revisions revision
       JOIN session_completions session
         ON session.session_id = revision.session_id
        AND session.guild_id = revision.guild_id
       JOIN session_completion_participants participant
         ON participant.completion_revision_id = revision.completion_revision_id
        AND participant.session_id = revision.session_id
        AND participant.guild_id = revision.guild_id
       JOIN characters character
         ON character.guild_id = revision.guild_id
        AND character.character_id = ?
        AND character.owner_user_id = participant.user_id
        AND character.status = 'approved'
       JOIN weekly_events event
         ON event.guild_id = session.guild_id AND event.event_id = session.source_event_id
       JOIN session_summaries summary
         ON summary.guild_id = revision.guild_id
        AND summary.completion_revision_id = revision.completion_revision_id
       WHERE revision.guild_id = ? AND revision.is_current = 1
         AND revision.result = 'completed'
         AND participant.user_id = ? AND participant.participant_role = 'player'
         AND participant.attendance_outcome IN ('attended', 'substitute', 'walk_in')
         AND (? IS NULL OR revision.session_id = ?)
       ORDER BY revision.confirmed_at DESC, revision.session_id DESC LIMIT 1`,
    ).bind(
      input.characterId,
      input.guildId,
      input.authorUserId,
      input.sessionId ?? null,
      input.sessionId ?? null,
    ).first<EligibleRow>();
    return row ? eligibleFromRow(row) : null;
  }

  async get(guildId: string, journalId: string): Promise<PlayerJournal | null> {
    const row = await this.db.prepare(
      "SELECT * FROM player_journals WHERE guild_id = ? AND journal_id = ?",
    ).bind(guildId, journalId).first<JournalRow>();
    return row ? journalFromRow(row) : null;
  }

  async getById(journalId: string): Promise<PlayerJournal | null> {
    const row = await this.db.prepare(
      "SELECT * FROM player_journals WHERE journal_id = ?",
    ).bind(journalId).first<JournalRow>();
    return row ? journalFromRow(row) : null;
  }

  async getForAuthor(journalId: string, authorUserId: string): Promise<PlayerJournal | null> {
    const row = await this.db.prepare(
      `SELECT journal.* FROM player_journals journal
       JOIN session_completion_revisions revision
         ON revision.guild_id = journal.guild_id
        AND revision.session_id = journal.session_id
        AND revision.completion_revision_id = journal.completion_revision_id
        AND revision.is_current = 1 AND revision.result = 'completed'
       JOIN session_completion_participants participant
         ON participant.completion_revision_id = revision.completion_revision_id
        AND participant.session_id = revision.session_id
        AND participant.guild_id = revision.guild_id
        AND participant.user_id = journal.author_user_id
        AND participant.participant_role = 'player'
        AND participant.attendance_outcome IN ('attended', 'substitute', 'walk_in')
       WHERE journal.journal_id = ? AND journal.author_user_id = ?`,
    ).bind(journalId, authorUserId).first<JournalRow>();
    return row ? journalFromRow(row) : null;
  }

  async getSubmissionReplay(
    journalId: string,
    authorUserId: string,
    idempotencyKey: string,
  ): Promise<PlayerJournal | null> {
    const row = await this.db.prepare(
      `SELECT journal.* FROM player_journal_events event
       JOIN player_journals journal
         ON journal.guild_id = event.guild_id AND journal.journal_id = event.journal_id
       WHERE event.journal_id = ? AND event.actor_user_id = ? AND event.idempotency_key = ?
         AND event.event_kind IN ('submitted', 'edited')`,
    ).bind(journalId, authorUserId, idempotencyKey).first<JournalRow>();
    return row ? journalFromRow(row) : null;
  }

  async ensureDraft(input: {
    journalId: string;
    journalEventId: string;
    eligible: EligibleJournalSession;
    authorUserId: string;
    idempotencyKey: string;
    createdAt: number;
  }): Promise<PlayerJournal> {
    await this.db.batch([
      this.db.prepare(
        `INSERT OR IGNORE INTO player_journals (
           journal_id, guild_id, session_id, completion_revision_id, summary_id,
           character_id, author_user_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        input.journalId,
        input.eligible.guildId,
        input.eligible.sessionId,
        input.eligible.completionRevisionId,
        input.eligible.summaryId,
        input.eligible.characterId,
        input.authorUserId,
        input.createdAt,
        input.createdAt,
      ),
      this.db.prepare(
        `INSERT OR IGNORE INTO player_journal_events (
           journal_event_id, journal_id, guild_id, event_kind, actor_user_id,
           journal_version, idempotency_key, details_json, created_at
         )
         SELECT ?, journal_id, guild_id, 'draft_created', ?, version, ?, ?, ?
         FROM player_journals
         WHERE guild_id = ? AND session_id = ?
           AND author_user_id = ? AND character_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM player_journal_events existing
             WHERE existing.journal_id = player_journals.journal_id
               AND existing.event_kind = 'draft_created'
           )`,
      ).bind(
        input.journalEventId,
        input.authorUserId,
        input.idempotencyKey,
        JSON.stringify({ completionRevisionId: input.eligible.completionRevisionId }),
        input.createdAt,
        input.eligible.guildId,
        input.eligible.sessionId,
        input.authorUserId,
        input.eligible.characterId,
      ),
    ]);
    const row = await this.db.prepare(
      `SELECT * FROM player_journals
       WHERE guild_id = ? AND session_id = ? AND author_user_id = ? AND character_id = ?`,
    ).bind(
      input.eligible.guildId,
      input.eligible.sessionId,
      input.authorUserId,
      input.eligible.characterId,
    ).first<JournalRow>();
    if (!row) throw new Error("Player journal draft was not persisted");
    return journalFromRow(row);
  }

  async submit(input: {
    journalRevisionId: string;
    journalEventId: string;
    journal: PlayerJournal;
    title: string;
    journalText: string;
    submittedByUserId: string;
    submittedAt: number;
    firstSubmittedAt: number;
    editExpiresAt: number;
    idempotencyKey: string;
  }): Promise<PlayerJournal | null> {
    const nextVersion = input.journal.version + 1;
    const eventKind = input.journal.status === "draft" ? "submitted" : "edited";
    const results = await this.db.batch([
      this.db.prepare(
        `UPDATE player_journals SET status = 'submitted', title = ?, journal_text = ?,
           first_submitted_at = ?, edit_expires_at = ?, last_submitted_at = ?,
           delivery_status = CASE WHEN publication_status = 'hidden' THEN 'hidden' ELSE 'pending' END,
           next_delivery_attempt_at = NULL, last_delivery_error_kind = NULL,
           version = ?, updated_at = ?
         WHERE guild_id = ? AND journal_id = ? AND version = ?`,
      ).bind(
        input.title,
        input.journalText,
        input.firstSubmittedAt,
        input.editExpiresAt,
        input.submittedAt,
        nextVersion,
        input.submittedAt,
        input.journal.guildId,
        input.journal.journalId,
        input.journal.version,
      ),
      this.db.prepare(
        `UPDATE player_journal_revisions SET is_current = 0
         WHERE journal_id = ? AND guild_id = ? AND is_current = 1`,
      ).bind(input.journal.journalId, input.journal.guildId),
      this.db.prepare(
        `INSERT INTO player_journal_revisions (
           journal_revision_id, journal_id, guild_id, revision_number,
           title, journal_text, submitted_by_user_id, submitted_at,
           is_current, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      ).bind(
        input.journalRevisionId,
        input.journal.journalId,
        input.journal.guildId,
        input.journal.version,
        input.title,
        input.journalText,
        input.submittedByUserId,
        input.submittedAt,
        input.submittedAt,
      ),
      this.db.prepare(
        `INSERT INTO player_journal_events (
           journal_event_id, journal_id, guild_id, event_kind, actor_user_id,
           journal_version, idempotency_key, details_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        input.journalEventId,
        input.journal.journalId,
        input.journal.guildId,
        eventKind,
        input.submittedByUserId,
        nextVersion,
        input.idempotencyKey,
        JSON.stringify({ revisionNumber: input.journal.version }),
        input.submittedAt,
      ),
    ]);
    if (results[0]?.meta.changes !== 1) return null;
    return this.get(input.journal.guildId, input.journal.journalId);
  }

  async getPublicationContext(journalId: string): Promise<JournalPublicationContext | null> {
    const row = await this.db.prepare(
      `SELECT journal.*, character.name AS character_name,
              event.title AS event_title, event.ends_at AS session_ends_at,
              config.thread_id
       FROM player_journals journal
       JOIN characters character
         ON character.guild_id = journal.guild_id
        AND character.character_id = journal.character_id
       JOIN session_completions session
         ON session.guild_id = journal.guild_id AND session.session_id = journal.session_id
       JOIN session_completion_revisions revision
         ON revision.guild_id = session.guild_id AND revision.session_id = session.session_id
        AND revision.completion_revision_id = journal.completion_revision_id
        AND revision.is_current = 1 AND revision.result = 'completed'
       JOIN weekly_events event
         ON event.guild_id = session.guild_id AND event.event_id = session.source_event_id
       LEFT JOIN player_journal_config config ON config.guild_id = journal.guild_id
       WHERE journal.journal_id = ?`,
    ).bind(journalId).first<PublicationRow>();
    return row ? {
      journal: journalFromRow(row),
      characterName: row.character_name,
      eventTitle: row.event_title,
      sessionEndsAt: row.session_ends_at,
      threadId: row.thread_id,
    } : null;
  }

  async listDuePublications(now: number, limit = 50): Promise<string[]> {
    const result = await this.db.prepare(
      `SELECT journal_id FROM player_journals
       WHERE status = 'submitted' AND publication_status = 'visible'
         AND (delivery_status = 'pending'
           OR (delivery_status = 'failed' AND next_delivery_attempt_at <= ?))
       ORDER BY COALESCE(next_delivery_attempt_at, updated_at), journal_id LIMIT ?`,
    ).bind(now, limit).all<{ journal_id: string }>();
    return result.results.map((row) => row.journal_id);
  }

  async markPublished(input: {
    journal: PlayerJournal;
    threadId: string;
    messageId: string;
    actorUserId: string;
    eventId: string;
    publishedAt: number;
  }): Promise<void> {
    await this.db.batch([
      this.db.prepare(
        `UPDATE player_journals SET delivery_status = 'sent',
           delivery_attempt_count = delivery_attempt_count + 1,
           next_delivery_attempt_at = NULL, last_delivery_error_kind = NULL,
           discord_thread_id = ?, discord_message_id = ?, updated_at = ?
         WHERE journal_id = ? AND guild_id = ? AND publication_status = 'visible'`,
      ).bind(
        input.threadId,
        input.messageId,
        input.publishedAt,
        input.journal.journalId,
        input.journal.guildId,
      ),
      this.db.prepare(
        `INSERT OR IGNORE INTO player_journal_events (
           journal_event_id, journal_id, guild_id, event_kind, actor_user_id,
           journal_version, idempotency_key, details_json, created_at
         ) VALUES (?, ?, ?, 'published', ?, ?, ?, ?, ?)`,
      ).bind(
        input.eventId,
        input.journal.journalId,
        input.journal.guildId,
        input.actorUserId,
        input.journal.version,
        `journal:published:${input.journal.journalId}:v${input.journal.version}`,
        JSON.stringify({ threadId: input.threadId, messageId: input.messageId }),
        input.publishedAt,
      ),
    ]);
  }

  async markPublicationFailed(input: {
    journal: PlayerJournal;
    errorKind: string;
    nextAttemptAt: number | null;
    actorUserId: string;
    eventId: string;
    failedAt: number;
  }): Promise<void> {
    const notConfigured = input.nextAttemptAt === null;
    await this.db.batch([
      this.db.prepare(
        `UPDATE player_journals SET delivery_status = ?,
           delivery_attempt_count = delivery_attempt_count + 1,
           next_delivery_attempt_at = ?, last_delivery_error_kind = ?, updated_at = ?
         WHERE journal_id = ? AND guild_id = ? AND publication_status = 'visible'`,
      ).bind(
        notConfigured ? "not_configured" : "failed",
        input.nextAttemptAt,
        input.errorKind.slice(0, 200),
        input.failedAt,
        input.journal.journalId,
        input.journal.guildId,
      ),
      this.db.prepare(
        `INSERT OR IGNORE INTO player_journal_events (
           journal_event_id, journal_id, guild_id, event_kind, actor_user_id,
           journal_version, idempotency_key, details_json, created_at
         ) VALUES (?, ?, ?, 'publication_failed', ?, ?, ?, ?, ?)`,
      ).bind(
        input.eventId,
        input.journal.journalId,
        input.journal.guildId,
        input.actorUserId,
        input.journal.version,
        `journal:publish-failed:${input.journal.journalId}:v${input.journal.version}:` +
          input.journal.deliveryAttemptCount,
        JSON.stringify({ errorKind: input.errorKind }),
        input.failedAt,
      ),
    ]);
  }

  async moderate(input: {
    journal: PlayerJournal;
    action: "hide" | "unhide" | "retry";
    actorUserId: string;
    reason: string;
    eventId: string;
    idempotencyKey: string;
    occurredAt: number;
  }): Promise<PlayerJournal> {
    const nextVersion = input.journal.version + 1;
    let update: D1PreparedStatement;
    if (input.action === "hide") {
      update = this.db.prepare(
        `UPDATE player_journals SET publication_status = 'hidden', hidden_at = ?,
           hidden_by_user_id = ?, hidden_reason = ?, delivery_status = 'hidden',
           next_delivery_attempt_at = NULL, last_delivery_error_kind = NULL,
           version = ?, updated_at = ?
         WHERE guild_id = ? AND journal_id = ? AND version = ?`,
      ).bind(
        input.occurredAt,
        input.actorUserId,
        input.reason,
        nextVersion,
        input.occurredAt,
        input.journal.guildId,
        input.journal.journalId,
        input.journal.version,
      );
    } else if (input.action === "unhide") {
      update = this.db.prepare(
        `UPDATE player_journals SET publication_status = 'visible', hidden_at = NULL,
           hidden_by_user_id = NULL, hidden_reason = NULL, delivery_status = 'pending',
           next_delivery_attempt_at = NULL, last_delivery_error_kind = NULL,
           version = ?, updated_at = ?
         WHERE guild_id = ? AND journal_id = ? AND version = ?`,
      ).bind(
        nextVersion,
        input.occurredAt,
        input.journal.guildId,
        input.journal.journalId,
        input.journal.version,
      );
    } else {
      update = this.db.prepare(
        `UPDATE player_journals SET delivery_status = 'pending',
           next_delivery_attempt_at = NULL, last_delivery_error_kind = NULL,
           version = ?, updated_at = ?
         WHERE guild_id = ? AND journal_id = ? AND version = ?
           AND status = 'submitted' AND publication_status = 'visible'`,
      ).bind(
        nextVersion,
        input.occurredAt,
        input.journal.guildId,
        input.journal.journalId,
        input.journal.version,
      );
    }
    const results = await this.db.batch([
      update,
      this.db.prepare(
        `INSERT INTO player_journal_events (
           journal_event_id, journal_id, guild_id, event_kind, actor_user_id,
           reason, journal_version, idempotency_key, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        input.eventId,
        input.journal.journalId,
        input.journal.guildId,
        input.action === "retry" ? "publication_retried" :
          input.action === "hide" ? "hidden" : "unhidden",
        input.actorUserId,
        input.reason,
        nextVersion,
        input.idempotencyKey,
        input.occurredAt,
      ),
    ]);
    if (results[0]?.meta.changes !== 1) {
      throw new Error("Player journal changed before the moderation action completed");
    }
    const journal = await this.get(input.journal.guildId, input.journal.journalId);
    if (!journal) throw new Error("Player journal disappeared after moderation");
    return journal;
  }

  async listForAuthor(guildId: string, authorUserId: string, limit = 10): Promise<PlayerJournal[]> {
    const result = await this.db.prepare(
      `SELECT * FROM player_journals WHERE guild_id = ? AND author_user_id = ?
       ORDER BY COALESCE(last_submitted_at, created_at) DESC, journal_id DESC LIMIT ?`,
    ).bind(guildId, authorUserId, limit).all<JournalRow>();
    return result.results.map(journalFromRow);
  }
}
