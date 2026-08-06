export const WEBSITE_SUMMARY_CONTRACT_VERSION = "session-summaries.v1";
export const WEBSITE_READ_WINDOW_MS = 60_000;
export const WEBSITE_READ_LIMIT_PER_WINDOW = 120;

export interface WebsiteSummaryCursor {
  sessionEndsAt: number;
  summaryId: string;
}

export interface WebsiteSummaryItem {
  summaryId: string;
  sessionId: string;
  eventId: string;
  eventTitle: string;
  sessionStartsAt: number;
  sessionEndsAt: number;
  tableNumber: number;
  tableTitle: string;
  gameTier: number;
  area: string;
  summary: string;
  importantEvents: string | null;
  bonusRewards: string | null;
  otherNotes: string | null;
  firstSubmittedAt: number;
  lastSubmittedAt: number;
  revision: number;
}

type WebsiteSummaryRow = {
  summary_id: string;
  session_id: string;
  event_id: string;
  event_title: string;
  starts_at: number;
  session_ends_at: number;
  table_number: number;
  table_title: string;
  game_tier: number;
  area: string;
  summary_text: string;
  important_events: string | null;
  bonus_rewards: string | null;
  other_notes: string | null;
  first_submitted_at: number;
  last_submitted_at: number;
  version: number;
};

function itemFromRow(row: WebsiteSummaryRow): WebsiteSummaryItem {
  return {
    summaryId: row.summary_id,
    sessionId: row.session_id,
    eventId: row.event_id,
    eventTitle: row.event_title,
    sessionStartsAt: row.starts_at,
    sessionEndsAt: row.session_ends_at,
    tableNumber: row.table_number,
    tableTitle: row.table_title,
    gameTier: row.game_tier,
    area: row.area,
    summary: row.summary_text,
    importantEvents: row.important_events,
    bonusRewards: row.bonus_rewards,
    otherNotes: row.other_notes,
    firstSubmittedAt: row.first_submitted_at,
    lastSubmittedAt: row.last_submitted_at,
    revision: row.version - 1,
  };
}

export class WebsiteReadRepository {
  constructor(private readonly db: D1Database) {}

  async consumeRateLimit(input: {
    guildId: string;
    userId: string;
    now: number;
  }): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const bucketStartedAt = input.now - (input.now % WEBSITE_READ_WINDOW_MS);
    const count = await this.db
      .prepare(
        `INSERT INTO website_read_rate_limits (
           guild_id, user_id, bucket_started_at, request_count, updated_at
         ) VALUES (?, ?, ?, 1, ?)
         ON CONFLICT (guild_id, user_id, bucket_started_at) DO UPDATE SET
           request_count = request_count + 1,
           updated_at = excluded.updated_at
         RETURNING request_count`,
      )
      .bind(input.guildId, input.userId, bucketStartedAt, input.now)
      .first<number>("request_count");
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucketStartedAt + WEBSITE_READ_WINDOW_MS - input.now) / 1_000),
    );
    return {
      allowed: (count ?? WEBSITE_READ_LIMIT_PER_WINDOW + 1) <= WEBSITE_READ_LIMIT_PER_WINDOW,
      retryAfterSeconds,
    };
  }

  async deleteExpiredRateLimits(now: number, limit = 1_000): Promise<number> {
    const result = await this.db
      .prepare(
        `DELETE FROM website_read_rate_limits
         WHERE rowid IN (
           SELECT rowid FROM website_read_rate_limits
           WHERE updated_at < ? ORDER BY updated_at LIMIT ?
         )`,
      )
      .bind(now - 24 * 60 * 60 * 1_000, limit)
      .run();
    return result.meta.changes;
  }

  async listSessionSummaries(input: {
    guildId: string;
    limit: number;
    cursor: WebsiteSummaryCursor | null;
    gameTier: number | null;
    area: string | null;
  }): Promise<{ items: WebsiteSummaryItem[]; nextCursor: WebsiteSummaryCursor | null }> {
    const result = await this.db
      .prepare(
        `SELECT summary.summary_id, summary.session_id,
                event.event_id, event.title AS event_title,
                event.starts_at, summary.session_ends_at,
                table_row.table_number, table_row.title AS table_title,
                table_row.game_tier, summary.area, summary.summary_text,
                summary.important_events, summary.bonus_rewards,
                summary.other_notes, summary.first_submitted_at,
                summary.last_submitted_at, summary.version
         FROM session_summaries summary
         JOIN session_completions session
           ON session.session_id = summary.session_id AND session.guild_id = summary.guild_id
         JOIN session_completion_revisions completion
           ON completion.completion_revision_id = summary.completion_revision_id
          AND completion.session_id = summary.session_id
          AND completion.guild_id = summary.guild_id
          AND completion.is_current = 1 AND completion.result = 'completed'
         JOIN weekly_events event
           ON event.event_id = session.source_event_id AND event.guild_id = session.guild_id
         JOIN plan_tables table_row
           ON table_row.table_id = session.source_table_id
         WHERE summary.guild_id = ?
           AND summary.status = 'submitted' AND summary.publication_status = 'visible'
           AND (? IS NULL OR table_row.game_tier = ?)
           AND (? IS NULL OR instr(lower(summary.area), lower(?)) > 0)
           AND (
             ? IS NULL OR summary.session_ends_at < ? OR
             (summary.session_ends_at = ? AND summary.summary_id < ?)
           )
         ORDER BY summary.session_ends_at DESC, summary.summary_id DESC
         LIMIT ?`,
      )
      .bind(
        input.guildId,
        input.gameTier,
        input.gameTier,
        input.area,
        input.area,
        input.cursor?.sessionEndsAt ?? null,
        input.cursor?.sessionEndsAt ?? null,
        input.cursor?.sessionEndsAt ?? null,
        input.cursor?.summaryId ?? null,
        input.limit + 1,
      )
      .all<WebsiteSummaryRow>();
    const pageRows = result.results.slice(0, input.limit);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map(itemFromRow),
      nextCursor: result.results.length > input.limit && last
        ? { sessionEndsAt: last.session_ends_at, summaryId: last.summary_id }
        : null,
    };
  }
}
