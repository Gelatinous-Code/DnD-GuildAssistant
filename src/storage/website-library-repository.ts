import { levelForXp } from "../domain/progression";

export const WEBSITE_LIBRARY_CONTRACTS = {
  "player-journals": "player-journals.v1",
  "historical-summaries": "historical-summaries.v1",
  "progression-seasons": "progression-seasons.v1",
} as const;

export type WebsiteLibraryResource = keyof typeof WEBSITE_LIBRARY_CONTRACTS;

type JournalRow = {
  journal_id: string;
  summary_id: string;
  session_id: string;
  event_title: string;
  session_ends_at: number;
  character_id: string;
  character_name: string;
  title: string;
  journal_text: string;
  first_submitted_at: number;
  last_submitted_at: number;
  version: number;
};

type HistoricalRow = {
  historical_record_id: string;
  season_label: string;
  game_date: string;
  gm_original: string;
  game_location: string;
  game_influence: string | null;
  official_summary: string;
  players_original: string | null;
  player_summary_status: string | null;
  player_summary_date: string | null;
  player_summary_url: string | null;
  batch_id: string;
  source_row_number: number;
};

type SeasonRow = {
  season_id: string;
  name: string;
  status: "current" | "closed";
  starts_at: number;
  ended_at: number | null;
  version: number;
};

type BalanceRow = {
  season_id: string;
  season_name: string;
  season_status: "current" | "closed";
  character_id: string;
  character_name: string;
  character_status: string;
  xp: number;
  gold: number;
};

export class WebsiteLibraryRepository {
  constructor(private readonly db: D1Database) {}

  async listPlayerJournals(guildId: string, limit: number) {
    const result = await this.db.prepare(
      `SELECT journal.journal_id, journal.summary_id, journal.session_id,
              event.title AS event_title, event.ends_at AS session_ends_at,
              character.character_id, character.name AS character_name,
              journal.title, journal.journal_text, journal.first_submitted_at,
              journal.last_submitted_at, journal.version
       FROM player_journals journal
       JOIN characters character
         ON character.guild_id = journal.guild_id
        AND character.character_id = journal.character_id
       JOIN session_completions session
         ON session.guild_id = journal.guild_id AND session.session_id = journal.session_id
       JOIN session_completion_revisions revision
         ON revision.guild_id = journal.guild_id
        AND revision.session_id = journal.session_id
        AND revision.completion_revision_id = journal.completion_revision_id
        AND revision.is_current = 1 AND revision.result = 'completed'
       JOIN weekly_events event
         ON event.guild_id = session.guild_id AND event.event_id = session.source_event_id
       WHERE journal.guild_id = ? AND journal.status = 'submitted'
         AND journal.publication_status = 'visible'
       ORDER BY journal.last_submitted_at DESC, journal.journal_id DESC
       LIMIT ?`,
    ).bind(guildId, limit).all<JournalRow>();
    return result.results.map((row) => ({
      journalId: row.journal_id,
      officialSummaryId: row.summary_id,
      sessionId: row.session_id,
      eventTitle: row.event_title,
      sessionEndsAt: row.session_ends_at,
      characterId: row.character_id,
      characterName: row.character_name,
      title: row.title,
      journal: row.journal_text,
      firstSubmittedAt: row.first_submitted_at,
      lastSubmittedAt: row.last_submitted_at,
      revision: row.version - 1,
    }));
  }

  async listHistoricalSummaries(guildId: string, limit: number) {
    const result = await this.db.prepare(
      `SELECT record.historical_record_id, record.season_label, record.game_date,
              record.gm_original, record.game_location, record.game_influence,
              record.official_summary, record.players_original,
              record.player_summary_status, record.player_summary_date,
              record.player_summary_url, record.batch_id, record.source_row_number
       FROM historical_session_records record
       JOIN historical_summary_import_batches batch
         ON batch.batch_id = record.batch_id AND batch.guild_id = record.guild_id
       WHERE record.guild_id = ? AND batch.status = 'published'
       ORDER BY record.game_date DESC, record.historical_record_id DESC
       LIMIT ?`,
    ).bind(guildId, limit).all<HistoricalRow>();
    return result.results.map((row) => ({
      historicalRecordId: row.historical_record_id,
      season: row.season_label,
      gameDate: row.game_date,
      gmName: row.gm_original,
      location: row.game_location,
      influence: row.game_influence,
      summary: row.official_summary,
      players: row.players_original,
      playerJournalStatus: row.player_summary_status,
      playerJournalDate: row.player_summary_date,
      playerJournalUrl: row.player_summary_url,
      provenance: { batchId: row.batch_id, sourceRowNumber: row.source_row_number },
    }));
  }

  async listProgressionSeasons(guildId: string) {
    const result = await this.db.prepare(
      `SELECT season_id, name, status, starts_at, ended_at, version
       FROM progression_seasons WHERE guild_id = ?
       ORDER BY starts_at DESC, season_id DESC`,
    ).bind(guildId).all<SeasonRow>();
    return result.results.map((row) => ({
      seasonId: row.season_id,
      name: row.name,
      status: row.status,
      startsAt: row.starts_at,
      endedAt: row.ended_at,
      revision: row.version - 1,
    }));
  }

  async listProgressionBalances(guildId: string, seasonId: string | null) {
    const result = await this.db.prepare(
      `SELECT balance.season_id, balance.season_name, balance.season_status,
              balance.character_id, character.name AS character_name,
              character.status AS character_status, balance.xp, balance.gold
       FROM character_progression_by_season balance
       JOIN characters character
         ON character.guild_id = balance.guild_id
        AND character.character_id = balance.character_id
       WHERE balance.guild_id = ?
         AND (? IS NULL OR balance.season_id = ?)
       ORDER BY balance.season_status DESC, balance.season_name DESC,
                character.name, balance.character_id`,
    ).bind(guildId, seasonId, seasonId).all<BalanceRow>();
    return result.results.map((row) => ({
      seasonId: row.season_id,
      seasonName: row.season_name,
      seasonStatus: row.season_status,
      characterId: row.character_id,
      characterName: row.character_name,
      characterStatus: row.character_status,
      xp: row.xp,
      gold: row.gold,
      level: levelForXp(row.xp),
    }));
  }
}
