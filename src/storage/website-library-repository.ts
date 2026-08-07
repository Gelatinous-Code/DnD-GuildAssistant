import { levelForXp, levelProgressForXp } from "../domain/progression";

export const WEBSITE_LIBRARY_CONTRACTS = {
  "player-journals": "player-journals.v1",
  "historical-summaries": "historical-summaries.v1",
  "progression-seasons": "progression-seasons.v1",
} as const;

export type WebsiteLibraryResource = keyof typeof WEBSITE_LIBRARY_CONTRACTS;

export interface WebsiteLibraryCursor {
  sortValue: number | string;
  id: string;
}

type JournalRow = {
  journal_id: string;
  summary_id: string;
  session_id: string;
  completion_revision_id: string;
  event_id: string;
  event_title: string;
  session_ends_at: number;
  character_id: string;
  character_name: string;
  title: string;
  journal_text: string;
  first_submitted_at: number;
  last_submitted_at: number;
  publication_status: "visible" | "hidden";
  hidden_at: number | null;
  hidden_reason: string | null;
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

type CharacterRow = {
  character_id: string;
  name: string;
  sheet_url: string | null;
  season: string | null;
  status: "pending" | "approved" | "revoked" | "archived";
  progression_state: "active" | "frozen";
  is_main: number;
  version: number;
  created_at: number;
  updated_at: number;
};

type BalanceRow = {
  season_id: string;
  season_name: string;
  season_status: "current" | "closed";
  character_id: string;
  xp: number;
  gold: number;
};

type HistoryRow = {
  entry_id: string;
  character_id: string;
  character_name: string;
  season_id: string;
  entry_kind: "session_award" | "admin_adjustment" | "reversal";
  xp_delta: number;
  gold_delta: number;
  source_session_id: string | null;
  source_completion_revision_id: string | null;
  participant_role: "dm" | "player" | null;
  policy_version: string | null;
  pre_award_xp: number | null;
  pre_award_gold: number | null;
  pre_award_level: number | null;
  reverses_entry_id: string | null;
  reason: string | null;
  occurred_at: number;
  event_id: string | null;
  event_title: string | null;
  table_number: number | null;
  selected_character_id: string | null;
  selection_version: number | null;
  selection_occurred_at: number | null;
  reversed_by_entry_id: string | null;
  reversed_at: number | null;
  reversal_reason: string | null;
};

export class WebsiteLibraryRepository {
  constructor(private readonly db: D1Database) {}

  async listPlayerJournals(input: {
    guildId: string;
    limit: number;
    cursor: WebsiteLibraryCursor | null;
    characterId: string | null;
    eventId: string | null;
    includeHidden: boolean;
  }) {
    const result = await this.db.prepare(
      `SELECT journal.journal_id, journal.summary_id, journal.session_id,
              journal.completion_revision_id, event.event_id,
              event.title AS event_title, event.ends_at AS session_ends_at,
              character.character_id, character.name AS character_name,
              journal.title, journal.journal_text, journal.first_submitted_at,
              journal.last_submitted_at, journal.publication_status,
              journal.hidden_at, journal.hidden_reason, journal.version
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
         AND (? = 1 OR journal.publication_status = 'visible')
         AND (? IS NULL OR journal.character_id = ?)
         AND (? IS NULL OR event.event_id = ?)
         AND (
           ? IS NULL OR journal.last_submitted_at < ? OR
           (journal.last_submitted_at = ? AND journal.journal_id < ?)
         )
       ORDER BY journal.last_submitted_at DESC, journal.journal_id DESC
       LIMIT ?`,
    ).bind(
      input.guildId,
      input.includeHidden ? 1 : 0,
      input.characterId,
      input.characterId,
      input.eventId,
      input.eventId,
      input.cursor?.sortValue ?? null,
      input.cursor?.sortValue ?? null,
      input.cursor?.sortValue ?? null,
      input.cursor?.id ?? null,
      input.limit + 1,
    ).all<JournalRow>();
    const rows = result.results.slice(0, input.limit);
    const last = rows.at(-1);
    return {
      items: rows.map((row) => ({
        journalId: row.journal_id,
        officialSummaryId: row.summary_id,
        sessionId: row.session_id,
        eventId: row.event_id,
        eventTitle: row.event_title,
        sessionEndsAt: row.session_ends_at,
        characterId: row.character_id,
        characterName: row.character_name,
        title: row.title,
        journal: row.journal_text,
        spoilers: { scope: "session" as const, eventId: row.event_id,
          availableAfter: row.session_ends_at },
        source: { completionRevisionId: row.completion_revision_id },
        publicationStatus: row.publication_status,
        moderation: row.publication_status === "hidden" && row.hidden_at !== null
          && row.hidden_reason !== null
          ? { hiddenAt: row.hidden_at, reason: row.hidden_reason }
          : null,
        firstSubmittedAt: row.first_submitted_at,
        lastSubmittedAt: row.last_submitted_at,
        revision: row.version - 1,
      })),
      nextCursor: result.results.length > input.limit && last
        ? { sortValue: last.last_submitted_at, id: last.journal_id }
        : null,
    };
  }

  async listHistoricalSummaries(input: {
    guildId: string;
    limit: number;
    cursor: WebsiteLibraryCursor | null;
    season: string | null;
  }) {
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
         AND (? IS NULL OR record.season_label = ?)
         AND (
           ? IS NULL OR record.game_date < ? OR
           (record.game_date = ? AND record.historical_record_id < ?)
         )
       ORDER BY record.game_date DESC, record.historical_record_id DESC
       LIMIT ?`,
    ).bind(
      input.guildId,
      input.season,
      input.season,
      input.cursor?.sortValue ?? null,
      input.cursor?.sortValue ?? null,
      input.cursor?.sortValue ?? null,
      input.cursor?.id ?? null,
      input.limit + 1,
    ).all<HistoricalRow>();
    const rows = result.results.slice(0, input.limit);
    const last = rows.at(-1);
    return {
      items: rows.map((row) => ({
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
        spoilers: { scope: "historical_session" as const, gameDate: row.game_date },
        provenance: { batchId: row.batch_id, sourceRowNumber: row.source_row_number },
      })),
      nextCursor: result.results.length > input.limit && last
        ? { sortValue: last.game_date, id: last.historical_record_id }
        : null,
    };
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

  async listMemberCharacters(guildId: string, ownerUserId: string) {
    const result = await this.db.prepare(
      `SELECT character_id, name, sheet_url, season, status, progression_state,
              is_main, version, created_at, updated_at
       FROM characters
       WHERE guild_id = ? AND owner_user_id = ?
       ORDER BY CASE status WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
                is_main DESC, created_at, character_id`,
    ).bind(guildId, ownerUserId).all<CharacterRow>();
    return result.results.map((row) => ({
      characterId: row.character_id,
      name: row.name,
      sheetUrl: row.sheet_url,
      legacySeasonLabel: row.season,
      status: row.status,
      progressionState: row.progression_state,
      isMain: row.is_main === 1,
      revision: row.version - 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async listProgressionBalances(input: {
    guildId: string;
    ownerUserId: string;
    seasonId: string | null;
    characterId: string | null;
  }) {
    const result = await this.db.prepare(
      `SELECT balance.season_id, balance.season_name, balance.season_status,
              balance.character_id, balance.xp, balance.gold
       FROM character_progression_by_season balance
       WHERE balance.guild_id = ? AND balance.owner_user_id = ?
         AND (? IS NULL OR balance.season_id = ?)
         AND (? IS NULL OR balance.character_id = ?)
       ORDER BY balance.season_status DESC, balance.season_name DESC,
                balance.character_id`,
    ).bind(
      input.guildId,
      input.ownerUserId,
      input.seasonId,
      input.seasonId,
      input.characterId,
      input.characterId,
    ).all<BalanceRow>();
    return result.results.map((row) => ({
      seasonId: row.season_id,
      seasonName: row.season_name,
      seasonStatus: row.season_status,
      characterId: row.character_id,
      xp: row.xp,
      gold: row.gold,
      level: levelForXp(row.xp),
      levelProgress: levelProgressForXp(row.xp),
    }));
  }

  async listProgressionHistory(input: {
    guildId: string;
    ownerUserId: string;
    limit: number;
    cursor: WebsiteLibraryCursor | null;
    seasonId: string | null;
    characterId: string | null;
  }) {
    const result = await this.db.prepare(
      `SELECT entry.entry_id, entry.character_id, character.name AS character_name,
              entry.season_id, entry.entry_kind, entry.xp_delta, entry.gold_delta,
              entry.source_session_id, entry.source_completion_revision_id,
              entry.participant_role, entry.policy_version, entry.pre_award_xp,
              entry.pre_award_gold, entry.pre_award_level, entry.reverses_entry_id,
              entry.reason, entry.occurred_at, event.event_id,
              event.title AS event_title, table_row.table_number,
              selection.character_id AS selected_character_id,
              selection.target_version AS selection_version,
              selection.occurred_at AS selection_occurred_at,
              reversal.entry_id AS reversed_by_entry_id,
              reversal.occurred_at AS reversed_at,
              reversal.reason AS reversal_reason
       FROM progression_ledger_entries entry
       JOIN characters character
         ON character.guild_id = entry.guild_id
        AND character.character_id = entry.character_id
        AND character.owner_user_id = ?
       LEFT JOIN session_completions session
         ON session.guild_id = entry.guild_id
        AND session.session_id = entry.source_session_id
       LEFT JOIN weekly_events event
         ON event.guild_id = session.guild_id AND event.event_id = session.source_event_id
       LEFT JOIN plan_tables table_row ON table_row.table_id = session.source_table_id
       LEFT JOIN session_reward_target_events selection
         ON selection.target_event_id = (
           SELECT candidate.target_event_id
           FROM session_reward_target_events candidate
           WHERE candidate.guild_id = entry.guild_id
             AND candidate.source_event_id = session.source_event_id
             AND candidate.source_table_id = session.source_table_id
             AND candidate.user_id = entry.source_user_id
             AND candidate.occurred_at <= entry.occurred_at
           ORDER BY candidate.target_version DESC, candidate.occurred_at DESC,
                    candidate.target_event_id DESC
           LIMIT 1
         )
       LEFT JOIN progression_ledger_entries reversal
         ON reversal.guild_id = entry.guild_id
        AND reversal.reverses_entry_id = entry.entry_id
       WHERE entry.guild_id = ?
         AND (? IS NULL OR entry.season_id = ?)
         AND (? IS NULL OR entry.character_id = ?)
         AND (
           ? IS NULL OR entry.occurred_at < ? OR
           (entry.occurred_at = ? AND entry.entry_id < ?)
         )
       ORDER BY entry.occurred_at DESC, entry.entry_id DESC
       LIMIT ?`,
    ).bind(
      input.ownerUserId,
      input.guildId,
      input.seasonId,
      input.seasonId,
      input.characterId,
      input.characterId,
      input.cursor?.sortValue ?? null,
      input.cursor?.sortValue ?? null,
      input.cursor?.sortValue ?? null,
      input.cursor?.id ?? null,
      input.limit + 1,
    ).all<HistoryRow>();
    const rows = result.results.slice(0, input.limit);
    const last = rows.at(-1);
    return {
      items: rows.map((row) => ({
        entryId: row.entry_id,
        characterId: row.character_id,
        characterName: row.character_name,
        rewardCharacterId: row.character_id,
        seasonId: row.season_id,
        kind: row.entry_kind,
        xpDelta: row.xp_delta,
        goldDelta: row.gold_delta,
        source: row.source_session_id === null ? null : {
          sessionId: row.source_session_id,
          completionRevisionId: row.source_completion_revision_id,
          eventId: row.event_id,
          eventTitle: row.event_title,
          tableNumber: row.table_number,
          participantRole: row.participant_role,
          characterSelection: row.selected_character_id === null ? null : {
            characterId: row.selected_character_id,
            purpose: row.participant_role === "player" ? "played" : "reward",
            revision: row.selection_version === null ? null : row.selection_version - 1,
            selectedAt: row.selection_occurred_at,
          },
          rewardCharacterId: row.character_id,
        },
        policyVersion: row.policy_version,
        preAward: row.pre_award_xp === null ? null : {
          xp: row.pre_award_xp,
          gold: row.pre_award_gold,
          level: row.pre_award_level,
        },
        reversesEntryId: row.reverses_entry_id,
        reason: row.reason,
        effective: row.reversed_by_entry_id === null,
        reversal: row.reversed_by_entry_id === null ? null : {
          entryId: row.reversed_by_entry_id,
          occurredAt: row.reversed_at,
          reason: row.reversal_reason,
        },
        occurredAt: row.occurred_at,
      })),
      nextCursor: result.results.length > input.limit && last
        ? { sortValue: last.occurred_at, id: last.entry_id }
        : null,
    };
  }

  async getAdminDiagnostics(guildId: string) {
    const row = await this.db.prepare(
      `SELECT
         (SELECT count(*) FROM session_summaries
          WHERE guild_id = ? AND status = 'pending') AS pending_recaps,
         (SELECT count(*) FROM session_summaries
          WHERE guild_id = ? AND status = 'submitted'
            AND publication_status = 'hidden') AS hidden_recaps,
         (SELECT count(*) FROM player_journals
          WHERE guild_id = ? AND status = 'draft') AS draft_journals,
         (SELECT count(*) FROM player_journals
          WHERE guild_id = ? AND status = 'submitted'
            AND publication_status = 'hidden') AS hidden_journals`,
    ).bind(guildId, guildId, guildId, guildId).first<{
      pending_recaps: number;
      hidden_recaps: number;
      draft_journals: number;
      hidden_journals: number;
    }>();
    return {
      pendingRecaps: row?.pending_recaps ?? 0,
      hiddenRecaps: row?.hidden_recaps ?? 0,
      draftJournals: row?.draft_journals ?? 0,
      hiddenJournals: row?.hidden_journals ?? 0,
    };
  }
}
