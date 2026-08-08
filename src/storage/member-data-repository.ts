import type { MemberDataCounts } from "../domain/member-data-policy";

type CountRow = {
  characters: number;
  character_events: number;
  journals: number;
  journal_revisions: number;
  seasonal_balances: number;
  progression_entries: number;
  shop_receipts: number;
  official_recaps: number;
  recap_revisions: number;
  weekly_signups: number;
  table_assignments: number;
  session_participation_records: number;
  dm_priority_credits: number;
};

function count(value: number | null | undefined): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

export interface MemberDataReader {
  inventory(guildId: string, userId: string): Promise<MemberDataCounts>;
}

export class MemberDataRepository implements MemberDataReader {
  constructor(private readonly db: D1Database) {}

  async inventory(guildId: string, userId: string): Promise<MemberDataCounts> {
    const row = await this.db.prepare(
      `SELECT
        (SELECT COUNT(*) FROM characters
          WHERE guild_id = ?1 AND owner_user_id = ?2) AS characters,
        (SELECT COUNT(*) FROM character_events event
          JOIN characters character
            ON character.guild_id = event.guild_id
           AND character.character_id = event.character_id
          WHERE event.guild_id = ?1 AND character.owner_user_id = ?2) AS character_events,
        (SELECT COUNT(*) FROM player_journals
          WHERE guild_id = ?1 AND author_user_id = ?2) AS journals,
        (SELECT COUNT(*) FROM player_journal_revisions revision
          JOIN player_journals journal
            ON journal.guild_id = revision.guild_id
           AND journal.journal_id = revision.journal_id
          WHERE journal.guild_id = ?1 AND journal.author_user_id = ?2) AS journal_revisions,
        (SELECT COUNT(*) FROM character_progression_by_season
          WHERE guild_id = ?1 AND owner_user_id = ?2) AS seasonal_balances,
        (SELECT COUNT(*) FROM progression_ledger_entries entry
          JOIN characters character
            ON character.guild_id = entry.guild_id
           AND character.character_id = entry.character_id
          WHERE entry.guild_id = ?1 AND character.owner_user_id = ?2) AS progression_entries,
        (SELECT COUNT(*) FROM shop_purchase_receipts receipt
          WHERE receipt.guild_id = ?1
            AND (
              receipt.user_id = ?2
              OR EXISTS (
                SELECT 1 FROM characters character
                WHERE character.guild_id = receipt.guild_id
                  AND character.character_id = receipt.character_id
                  AND character.owner_user_id = ?2
              )
            )) AS shop_receipts,
        (SELECT COUNT(*) FROM session_summaries
          WHERE guild_id = ?1 AND dm_user_id = ?2) AS official_recaps,
        (SELECT COUNT(*) FROM session_summary_revisions revision
          JOIN session_summaries summary
            ON summary.guild_id = revision.guild_id
           AND summary.summary_id = revision.summary_id
          WHERE summary.guild_id = ?1 AND summary.dm_user_id = ?2) AS recap_revisions,
        (SELECT COUNT(*) FROM signups signup
          JOIN weekly_events event ON event.event_id = signup.event_id
          WHERE event.guild_id = ?1 AND signup.user_id = ?2) AS weekly_signups,
        (SELECT COUNT(*) FROM assignments assignment
          JOIN plans plan ON plan.plan_id = assignment.plan_id
          JOIN weekly_events event ON event.event_id = plan.event_id
          WHERE event.guild_id = ?1 AND assignment.user_id = ?2) AS table_assignments,
        (SELECT COUNT(*) FROM session_completion_participants participant
          WHERE participant.guild_id = ?1
            AND (participant.user_id = ?2 OR participant.replaces_user_id = ?2)
        ) AS session_participation_records,
        (SELECT COUNT(*) FROM dm_priority_credits
          WHERE guild_id = ?1 AND user_id = ?2) AS dm_priority_credits`,
    ).bind(guildId, userId).first<CountRow>();

    return {
      characters: count(row?.characters),
      characterEvents: count(row?.character_events),
      journals: count(row?.journals),
      journalRevisions: count(row?.journal_revisions),
      seasonalBalances: count(row?.seasonal_balances),
      progressionEntries: count(row?.progression_entries),
      shopReceipts: count(row?.shop_receipts),
      officialRecaps: count(row?.official_recaps),
      recapRevisions: count(row?.recap_revisions),
      weeklySignups: count(row?.weekly_signups),
      tableAssignments: count(row?.table_assignments),
      sessionParticipationRecords: count(row?.session_participation_records),
      dmPriorityCredits: count(row?.dm_priority_credits),
    };
  }
}
