import {
  MEMBER_DATA_EXPORT_MAX_ROWS_PER_COLLECTION,
  MemberDataExportLimitError,
  type MemberDataExportCollections,
  type MemberDataRecord,
  type MemberDataSnapshot,
} from "../member-data-export";

const COLLECTION_NAMES = [
  "characters", "characterEvents", "journals", "journalRevisions",
  "seasonalBalances", "seasonOpenings", "progressionEntries", "shopReceipts",
  "shopReceiptItems", "shopReceiptEvents", "officialRecaps", "recapRevisions",
  "weeklySignups", "tableAssignments", "sessionParticipationRecords",
  "dmPriorityGrants", "dmPriorityCredits", "dmPriorityCreditEvents",
] as const satisfies readonly (keyof MemberDataExportCollections)[];

function sqlStatements(db: D1Database, guildId: string, userId: string): D1PreparedStatement[] {
  const limit = MEMBER_DATA_EXPORT_MAX_ROWS_PER_COLLECTION + 1;
  const member = (sql: string) => db.prepare(sql).bind(guildId, userId, limit);
  return [
    member(`SELECT character_id AS characterId, name, sheet_url AS sheetUrl, season,
      status, progression_state AS progressionState, is_main AS isMain,
      opening_xp AS openingXp, opening_gold AS openingGold, version,
      created_at AS createdAt, updated_at AS updatedAt, approved_at AS approvedAt,
      revoked_at AS revokedAt, archived_at AS archivedAt
      FROM characters WHERE guild_id = ?1 AND owner_user_id = ?2
      ORDER BY created_at, character_id LIMIT ?3`),
    member(`SELECT event.character_event_id AS characterEventId, event.character_id AS characterId,
      event.action, event.character_version AS characterVersion, event.actor_user_id AS actorUserId,
      event.reason, event.details_json AS detailsJson, event.occurred_at AS occurredAt
      FROM character_events event JOIN characters character
        ON character.guild_id = event.guild_id AND character.character_id = event.character_id
      WHERE event.guild_id = ?1 AND character.owner_user_id = ?2
      ORDER BY event.occurred_at, event.character_event_id LIMIT ?3`),
    member(`SELECT journal_id AS journalId, session_id AS sessionId,
      completion_revision_id AS completionRevisionId, summary_id AS summaryId,
      character_id AS characterId, status, title, journal_text AS journalText,
      first_submitted_at AS firstSubmittedAt, edit_expires_at AS editExpiresAt,
      last_submitted_at AS lastSubmittedAt, publication_status AS publicationStatus,
      hidden_at AS hiddenAt, hidden_reason AS hiddenReason, version,
      created_at AS createdAt, updated_at AS updatedAt
      FROM player_journals WHERE guild_id = ?1 AND author_user_id = ?2
      ORDER BY created_at, journal_id LIMIT ?3`),
    member(`SELECT revision.journal_revision_id AS journalRevisionId,
      revision.journal_id AS journalId, revision.revision_number AS revisionNumber,
      revision.title, revision.journal_text AS journalText,
      revision.submitted_at AS submittedAt, revision.is_current AS isCurrent,
      revision.created_at AS createdAt
      FROM player_journal_revisions revision JOIN player_journals journal
        ON journal.guild_id = revision.guild_id AND journal.journal_id = revision.journal_id
      WHERE journal.guild_id = ?1 AND journal.author_user_id = ?2
      ORDER BY revision.journal_id, revision.revision_number LIMIT ?3`),
    member(`SELECT season_id AS seasonId, season_name AS seasonName,
      season_status AS seasonStatus, character_id AS characterId, xp, gold
      FROM character_progression_by_season WHERE guild_id = ?1 AND owner_user_id = ?2
      ORDER BY season_id, character_id LIMIT ?3`),
    member(`SELECT opening.opening_id AS openingId, opening.season_id AS seasonId,
      opening.character_id AS characterId, opening.opening_xp AS openingXp,
      opening.opening_gold AS openingGold, opening.policy_version AS policyVersion,
      opening.source_kind AS sourceKind, opening.reason, opening.created_at AS createdAt
      FROM character_season_openings opening JOIN characters character
        ON character.guild_id = opening.guild_id AND character.character_id = opening.character_id
      WHERE opening.guild_id = ?1 AND character.owner_user_id = ?2
      ORDER BY opening.created_at, opening.opening_id LIMIT ?3`),
    member(`SELECT entry.entry_id AS entryId, entry.character_id AS characterId,
      entry.season_id AS seasonId, entry.entry_kind AS entryKind,
      entry.xp_delta AS xpDelta, entry.gold_delta AS goldDelta,
      entry.source_session_id AS sourceSessionId, entry.participant_role AS participantRole,
      entry.policy_version AS policyVersion, entry.pre_award_xp AS preAwardXp,
      entry.pre_award_gold AS preAwardGold, entry.pre_award_level AS preAwardLevel,
      entry.reverses_entry_id AS reversesEntryId, entry.reason,
      entry.occurred_at AS occurredAt
      FROM progression_ledger_entries entry JOIN characters character
        ON character.guild_id = entry.guild_id AND character.character_id = entry.character_id
      WHERE entry.guild_id = ?1 AND character.owner_user_id = ?2
      ORDER BY entry.occurred_at, entry.entry_id LIMIT ?3`),
    member(`SELECT receipt.receipt_id AS receiptId, receipt.character_id AS characterId,
      receipt.season_id AS seasonId, receipt.item_id AS itemId, receipt.quantity,
      receipt.item_name AS itemName, receipt.unit_price_gold AS unitPriceGold,
      receipt.total_gold AS totalGold, receipt.catalog_revision AS catalogRevision,
      receipt.item_revision AS itemRevision, receipt.ledger_entry_id AS ledgerEntryId,
      receipt.status, receipt.purchased_at AS purchasedAt, receipt.reversed_at AS reversedAt,
      receipt.reversal_ledger_entry_id AS reversalLedgerEntryId,
      receipt.reversal_reason AS reversalReason
      FROM shop_purchase_receipts receipt WHERE receipt.guild_id = ?1 AND
        (receipt.user_id = ?2 OR EXISTS (SELECT 1 FROM characters character
          WHERE character.guild_id = receipt.guild_id AND character.character_id = receipt.character_id
            AND character.owner_user_id = ?2))
      ORDER BY receipt.purchased_at, receipt.receipt_id LIMIT ?3`),
    member(`SELECT item.receipt_id AS receiptId, item.line_number AS lineNumber,
      item.item_id AS itemId, item.quantity, item.item_name AS itemName,
      item.unit_price_gold AS unitPriceGold, item.line_total_gold AS lineTotalGold,
      item.catalog_revision AS catalogRevision, item.item_revision AS itemRevision
      FROM shop_purchase_receipt_items item JOIN shop_purchase_receipts receipt
        ON receipt.receipt_id = item.receipt_id WHERE receipt.guild_id = ?1 AND
        (receipt.user_id = ?2 OR EXISTS (SELECT 1 FROM characters character
          WHERE character.guild_id = receipt.guild_id AND character.character_id = receipt.character_id
            AND character.owner_user_id = ?2))
      ORDER BY item.receipt_id, item.line_number LIMIT ?3`),
    member(`SELECT event.event_id AS eventId, event.receipt_id AS receiptId,
      event.action, event.reason, event.occurred_at AS occurredAt
      FROM shop_purchase_events event JOIN shop_purchase_receipts receipt
        ON receipt.receipt_id = event.receipt_id WHERE event.guild_id = ?1 AND
        (receipt.user_id = ?2 OR EXISTS (SELECT 1 FROM characters character
          WHERE character.guild_id = receipt.guild_id AND character.character_id = receipt.character_id
            AND character.owner_user_id = ?2))
      ORDER BY event.occurred_at, event.event_id LIMIT ?3`),
    member(`SELECT summary_id AS summaryId, session_id AS sessionId,
      completion_revision_id AS completionRevisionId, session_ends_at AS sessionEndsAt,
      due_at AS dueAt, status, summary_text AS summaryText, area,
      important_events AS importantEvents, bonus_rewards AS bonusRewards,
      other_notes AS otherNotes, first_submitted_at AS firstSubmittedAt,
      edit_expires_at AS editExpiresAt, last_submitted_at AS lastSubmittedAt,
      publication_status AS publicationStatus, version,
      created_at AS createdAt, updated_at AS updatedAt
      FROM session_summaries WHERE guild_id = ?1 AND dm_user_id = ?2
      ORDER BY created_at, summary_id LIMIT ?3`),
    member(`SELECT revision.summary_revision_id AS summaryRevisionId,
      revision.summary_id AS summaryId, revision.revision_number AS revisionNumber,
      revision.summary_text AS summaryText, revision.area,
      revision.important_events AS importantEvents, revision.bonus_rewards AS bonusRewards,
      revision.other_notes AS otherNotes, revision.submitted_at AS submittedAt,
      revision.is_current AS isCurrent, revision.created_at AS createdAt
      FROM session_summary_revisions revision JOIN session_summaries summary
        ON summary.guild_id = revision.guild_id AND summary.summary_id = revision.summary_id
      WHERE summary.guild_id = ?1 AND summary.dm_user_id = ?2
      ORDER BY revision.summary_id, revision.revision_number LIMIT ?3`),
    member(`SELECT signup.event_id AS eventId, event.title AS eventTitle,
      event.starts_at AS eventStartsAt, event.status AS eventStatus,
      signup.display_name AS displayName, signup.signup_kind AS signupKind,
      signup.status, signup.source, signup.signed_up_at AS signedUpAt,
      signup.withdrawn_at AS withdrawnAt, signup.updated_at AS updatedAt
      FROM signups signup JOIN weekly_events event ON event.event_id = signup.event_id
      WHERE event.guild_id = ?1 AND signup.user_id = ?2
      ORDER BY event.starts_at, signup.event_id LIMIT ?3`),
    member(`SELECT assignment.assignment_id AS assignmentId, plan.event_id AS eventId,
      assignment.plan_id AS planId, plan.generation AS planGeneration,
      assignment.table_id AS tableId, assignment.desired_table_id AS desiredTableId,
      assignment.display_name AS displayName, assignment.status,
      assignment.waitlist_position AS waitlistPosition,
      assignment.assigned_at AS assignedAt, assignment.updated_at AS updatedAt
      FROM assignments assignment JOIN plans plan ON plan.plan_id = assignment.plan_id
      JOIN weekly_events event ON event.event_id = plan.event_id
      WHERE event.guild_id = ?1 AND assignment.user_id = ?2
      ORDER BY event.starts_at, assignment.assignment_id LIMIT ?3`),
    member(`SELECT completion_revision_id AS completionRevisionId, session_id AS sessionId,
      user_id AS userId, participant_role AS participantRole,
      attendance_outcome AS attendanceOutcome, replaces_user_id AS replacesUserId,
      was_planned AS wasPlanned, reason, recorded_at AS recordedAt
      FROM session_completion_participants WHERE guild_id = ?1
        AND (user_id = ?2 OR replaces_user_id = ?2)
      ORDER BY recorded_at, session_id LIMIT ?3`),
    member(`SELECT grant_id AS grantId, completion_revision_id AS completionRevisionId,
      source_event_id AS sourceEventId, source_table_id AS sourceTableId,
      policy_version AS policyVersion, earned_at AS earnedAt, expires_at AS expiresAt,
      status, corrected_at AS correctedAt, correction_reason AS correctionReason,
      created_at AS createdAt, updated_at AS updatedAt
      FROM dm_priority_grants WHERE guild_id = ?1 AND dm_user_id = ?2
      ORDER BY earned_at, grant_id LIMIT ?3`),
    member(`SELECT credit_id AS creditId, grant_id AS grantId, ordinal, earned_at AS earnedAt,
      expires_at AS expiresAt, status, target_event_id AS targetEventId,
      target_assignment_id AS targetAssignmentId, reserved_at AS reservedAt,
      redeemed_at AS redeemedAt, version, created_at AS createdAt, updated_at AS updatedAt
      FROM dm_priority_credits WHERE guild_id = ?1 AND user_id = ?2
      ORDER BY earned_at, credit_id LIMIT ?3`),
    member(`SELECT event.credit_event_id AS creditEventId, event.credit_id AS creditId,
      event.action, event.from_status AS fromStatus, event.to_status AS toStatus,
      event.credit_version AS creditVersion, event.target_event_id AS targetEventId,
      event.target_assignment_id AS targetAssignmentId, event.reason,
      event.occurred_at AS occurredAt
      FROM dm_priority_credit_events event JOIN dm_priority_credits credit
        ON credit.guild_id = event.guild_id AND credit.credit_id = event.credit_id
      WHERE event.guild_id = ?1 AND credit.user_id = ?2
      ORDER BY event.occurred_at, event.credit_event_id LIMIT ?3`),
  ];
}

export class MemberDataExportRepository {
  constructor(private readonly db: D1Database) {}

  async snapshot(guildId: string, userId: string): Promise<MemberDataSnapshot> {
    const results = await this.db.batch(sqlStatements(this.db, guildId, userId));
    const collections = {} as MemberDataExportCollections;
    COLLECTION_NAMES.forEach((name, index) => {
      const rows = (results[index]?.results ?? []) as MemberDataRecord[];
      if (rows.length > MEMBER_DATA_EXPORT_MAX_ROWS_PER_COLLECTION) {
        throw new MemberDataExportLimitError(
          "rows", MEMBER_DATA_EXPORT_MAX_ROWS_PER_COLLECTION, rows.length, name,
        );
      }
      collections[name] = rows;
    });
    const counts = {
      characters: collections.characters.length,
      characterEvents: collections.characterEvents.length,
      journals: collections.journals.length,
      journalRevisions: collections.journalRevisions.length,
      seasonalBalances: collections.seasonalBalances.length,
      progressionEntries: collections.progressionEntries.length,
      shopReceipts: collections.shopReceipts.length,
      officialRecaps: collections.officialRecaps.length,
      recapRevisions: collections.recapRevisions.length,
      weeklySignups: collections.weeklySignups.length,
      tableAssignments: collections.tableAssignments.length,
      sessionParticipationRecords: collections.sessionParticipationRecords.length,
      dmPriorityCredits: collections.dmPriorityCredits.length,
    };
    return { guildId, subjectUserId: userId, counts, collections };
  }
}
