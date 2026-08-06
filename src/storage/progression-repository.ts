export type ProgressionEntryKind = "session_award" | "admin_adjustment" | "reversal";

export interface CharacterProgressionBalance {
  guildId: string;
  characterId: string;
  ownerUserId: string;
  xp: number;
  gold: number;
}

export interface ProgressionLedgerEntry {
  entryId: string;
  guildId: string;
  characterId: string;
  seasonId: string;
  entryKind: ProgressionEntryKind;
  xpDelta: number;
  goldDelta: number;
  sourceSessionId: string | null;
  sourceCompletionRevisionId: string | null;
  sourceUserId: string | null;
  participantRole: "dm" | "player" | null;
  policyVersion: string | null;
  preAwardXp: number | null;
  preAwardGold: number | null;
  preAwardLevel: number | null;
  reversesEntryId: string | null;
  actorUserId: string;
  reason: string | null;
  idempotencyKey: string;
  occurredAt: number;
  createdAt: number;
}

export interface SessionRewardTarget {
  guildId: string;
  sourceEventId: string;
  sourceTableId: string;
  userId: string;
  characterId: string;
  version: number;
  selectedByUserId: string;
  selectedAt: number;
  updatedAt: number;
}

type BalanceRow = {
  guild_id: string;
  character_id: string;
  owner_user_id: string;
  xp: number;
  gold: number;
};

type EntryRow = {
  entry_id: string;
  guild_id: string;
  character_id: string;
  season_id: string;
  entry_kind: ProgressionEntryKind;
  xp_delta: number;
  gold_delta: number;
  source_session_id: string | null;
  source_completion_revision_id: string | null;
  source_user_id: string | null;
  participant_role: "dm" | "player" | null;
  policy_version: string | null;
  pre_award_xp: number | null;
  pre_award_gold: number | null;
  pre_award_level: number | null;
  reverses_entry_id: string | null;
  actor_user_id: string;
  reason: string | null;
  idempotency_key: string;
  occurred_at: number;
  created_at: number;
};

type TargetRow = {
  guild_id: string;
  source_event_id: string;
  source_table_id: string;
  user_id: string;
  character_id: string;
  version: number;
  selected_by_user_id: string;
  selected_at: number;
  updated_at: number;
};

function balanceFromRow(row: BalanceRow): CharacterProgressionBalance {
  return {
    guildId: row.guild_id,
    characterId: row.character_id,
    ownerUserId: row.owner_user_id,
    xp: row.xp,
    gold: row.gold,
  };
}

function entryFromRow(row: EntryRow): ProgressionLedgerEntry {
  return {
    entryId: row.entry_id,
    guildId: row.guild_id,
    characterId: row.character_id,
    seasonId: row.season_id,
    entryKind: row.entry_kind,
    xpDelta: row.xp_delta,
    goldDelta: row.gold_delta,
    sourceSessionId: row.source_session_id,
    sourceCompletionRevisionId: row.source_completion_revision_id,
    sourceUserId: row.source_user_id,
    participantRole: row.participant_role,
    policyVersion: row.policy_version,
    preAwardXp: row.pre_award_xp,
    preAwardGold: row.pre_award_gold,
    preAwardLevel: row.pre_award_level,
    reversesEntryId: row.reverses_entry_id,
    actorUserId: row.actor_user_id,
    reason: row.reason,
    idempotencyKey: row.idempotency_key,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
  };
}

function targetFromRow(row: TargetRow): SessionRewardTarget {
  return {
    guildId: row.guild_id,
    sourceEventId: row.source_event_id,
    sourceTableId: row.source_table_id,
    userId: row.user_id,
    characterId: row.character_id,
    version: row.version,
    selectedByUserId: row.selected_by_user_id,
    selectedAt: row.selected_at,
    updatedAt: row.updated_at,
  };
}

export class ProgressionIdempotencyConflictError extends Error {
  constructor() {
    super("That operation key is already associated with different progression data.");
    this.name = "ProgressionIdempotencyConflictError";
  }
}

export interface AppendProgressionEntryInput {
  entryId: string;
  guildId: string;
  characterId: string;
  seasonId?: string | null;
  entryKind: ProgressionEntryKind;
  xpDelta: number;
  goldDelta: number;
  sourceSessionId?: string | null;
  sourceCompletionRevisionId?: string | null;
  sourceUserId?: string | null;
  participantRole?: "dm" | "player" | null;
  policyVersion?: string | null;
  preAwardXp?: number | null;
  preAwardGold?: number | null;
  preAwardLevel?: number | null;
  reversesEntryId?: string | null;
  actorUserId: string;
  reason?: string | null;
  idempotencyKey: string;
  occurredAt: number;
}

export class ProgressionRepository {
  constructor(private readonly db: D1Database) {}

  async getBalance(
    guildId: string,
    characterId: string,
  ): Promise<CharacterProgressionBalance | null> {
    const row = await this.db
      .prepare(
        `SELECT guild_id, character_id, owner_user_id, xp, gold
         FROM character_progression_balances
         WHERE guild_id = ? AND character_id = ?`,
      )
      .bind(guildId, characterId)
      .first<BalanceRow>();
    return row ? balanceFromRow(row) : null;
  }

  async getBalanceForSeason(
    guildId: string,
    characterId: string,
    seasonId: string,
  ): Promise<CharacterProgressionBalance | null> {
    const row = await this.db.prepare(
      `SELECT guild_id, character_id, owner_user_id, xp, gold
       FROM character_progression_by_season
       WHERE guild_id = ? AND character_id = ? AND season_id = ?`,
    ).bind(guildId, characterId, seasonId).first<BalanceRow>();
    return row ? balanceFromRow(row) : null;
  }

  async listBalancesForOwner(
    guildId: string,
    ownerUserId: string,
  ): Promise<CharacterProgressionBalance[]> {
    const result = await this.db
      .prepare(
        `SELECT guild_id, character_id, owner_user_id, xp, gold
         FROM character_progression_balances
         WHERE guild_id = ? AND owner_user_id = ?
         ORDER BY character_id`,
      )
      .bind(guildId, ownerUserId)
      .all<BalanceRow>();
    return result.results.map(balanceFromRow);
  }

  async listHistory(
    guildId: string,
    characterId: string,
    limit = 20,
  ): Promise<ProgressionLedgerEntry[]> {
    const result = await this.db
      .prepare(
        `SELECT * FROM progression_ledger_entries
         WHERE guild_id = ? AND character_id = ?
         ORDER BY occurred_at DESC, entry_id DESC LIMIT ?`,
      )
      .bind(guildId, characterId, limit)
      .all<EntryRow>();
    return result.results.map(entryFromRow);
  }

  async getTarget(
    guildId: string,
    sourceEventId: string,
    sourceTableId: string,
    userId: string,
  ): Promise<SessionRewardTarget | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM session_reward_targets
         WHERE guild_id = ? AND source_event_id = ? AND source_table_id = ? AND user_id = ?`,
      )
      .bind(guildId, sourceEventId, sourceTableId, userId)
      .first<TargetRow>();
    return row ? targetFromRow(row) : null;
  }

  async setTarget(input: {
    targetEventId: string;
    guildId: string;
    sourceEventId: string;
    sourceTableId: string;
    userId: string;
    characterId: string;
    actorUserId: string;
    reason?: string | null;
    idempotencyKey: string;
    occurredAt: number;
  }): Promise<SessionRewardTarget> {
    const existing = await this.getTarget(
      input.guildId,
      input.sourceEventId,
      input.sourceTableId,
      input.userId,
    );
    const version = (existing?.version ?? 0) + 1;
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO session_reward_targets (
             guild_id, source_event_id, source_table_id, user_id, character_id,
             version, selected_by_user_id, selected_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
           ON CONFLICT(guild_id, source_event_id, source_table_id, user_id)
           DO UPDATE SET character_id = excluded.character_id,
             version = session_reward_targets.version + 1,
             selected_by_user_id = excluded.selected_by_user_id,
             updated_at = excluded.updated_at
           WHERE session_reward_targets.version = ?`,
        )
        .bind(
          input.guildId,
          input.sourceEventId,
          input.sourceTableId,
          input.userId,
          input.characterId,
          input.actorUserId,
          input.occurredAt,
          input.occurredAt,
          existing?.version ?? 0,
        ),
      this.db
        .prepare(
          `INSERT INTO session_reward_target_events (
             target_event_id, guild_id, source_event_id, source_table_id, user_id,
             character_id, target_version, actor_user_id, reason,
             idempotency_key, occurred_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.targetEventId,
          input.guildId,
          input.sourceEventId,
          input.sourceTableId,
          input.userId,
          input.characterId,
          version,
          input.actorUserId,
          input.reason ?? null,
          input.idempotencyKey,
          input.occurredAt,
        ),
    ]);
    const target = await this.getTarget(
      input.guildId,
      input.sourceEventId,
      input.sourceTableId,
      input.userId,
    );
    if (!target) throw new Error("Reward target was not persisted");
    return target;
  }

  async appendSessionAward(input: {
    entryId: string;
    guildId: string;
    characterId: string;
    xpDelta: number;
    sourceSessionId: string;
    sourceCompletionRevisionId: string;
    sourceUserId: string;
    participantRole: "dm" | "player";
    policyVersion: string;
    actorUserId: string;
    idempotencyKey: string;
    occurredAt: number;
  }): Promise<ProgressionLedgerEntry> {
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO progression_ledger_entries (
          entry_id, guild_id, character_id, season_id, entry_kind, xp_delta, gold_delta,
          source_session_id, source_completion_revision_id, source_user_id,
          participant_role, policy_version, pre_award_xp, pre_award_gold,
          pre_award_level, reverses_entry_id, actor_user_id, reason,
          idempotency_key, occurred_at
        )
        SELECT ?, balance.guild_id, balance.character_id, balance.season_id, 'session_award', ?,
          CASE
            WHEN balance.xp >= 42 THEN 1000 WHEN balance.xp >= 33 THEN 800
            WHEN balance.xp >= 25 THEN 600 WHEN balance.xp >= 18 THEN 400
            WHEN balance.xp >= 12 THEN 300 WHEN balance.xp >= 7 THEN 200
            WHEN balance.xp >= 3 THEN 100 ELSE 50
          END,
          ?, ?, ?, ?, ?, balance.xp, balance.gold,
          CASE
            WHEN balance.xp >= 42 THEN 10 WHEN balance.xp >= 33 THEN 9
            WHEN balance.xp >= 25 THEN 8 WHEN balance.xp >= 18 THEN 7
            WHEN balance.xp >= 12 THEN 6 WHEN balance.xp >= 7 THEN 5
            WHEN balance.xp >= 3 THEN 4 ELSE 3
          END,
          NULL, ?, NULL, ?, ?
        FROM character_progression_balances balance
        WHERE balance.guild_id = ? AND balance.character_id = ?`,
      )
      .bind(
        input.entryId,
        input.xpDelta,
        input.sourceSessionId,
        input.sourceCompletionRevisionId,
        input.sourceUserId,
        input.participantRole,
        input.policyVersion,
        input.actorUserId,
        input.idempotencyKey,
        input.occurredAt,
        input.guildId,
        input.characterId,
      )
      .run();
    const row = await this.db
      .prepare("SELECT * FROM progression_ledger_entries WHERE guild_id = ? AND idempotency_key = ?")
      .bind(input.guildId, input.idempotencyKey)
      .first<EntryRow>();
    if (!row) throw new Error("Session progression award was not persisted");
    const entry = entryFromRow(row);
    if (
      entry.entryKind !== "session_award" ||
      entry.characterId !== input.characterId ||
      entry.xpDelta !== input.xpDelta ||
      entry.sourceSessionId !== input.sourceSessionId ||
      entry.sourceCompletionRevisionId !== input.sourceCompletionRevisionId ||
      entry.sourceUserId !== input.sourceUserId ||
      entry.participantRole !== input.participantRole
    ) {
      throw new ProgressionIdempotencyConflictError();
    }
    return entry;
  }
  async appendEntry(input: AppendProgressionEntryInput): Promise<ProgressionLedgerEntry> {
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO progression_ledger_entries (
           entry_id, guild_id, character_id, season_id, entry_kind, xp_delta, gold_delta,
           source_session_id, source_completion_revision_id, source_user_id,
           participant_role, policy_version, pre_award_xp, pre_award_gold,
           pre_award_level, reverses_entry_id, actor_user_id, reason,
           idempotency_key, occurred_at
         ) VALUES (?, ?, ?, COALESCE(?, (SELECT season_id FROM progression_seasons
           WHERE guild_id = ? AND status = 'current')), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.entryId,
        input.guildId,
        input.characterId,
        input.seasonId ?? null,
        input.guildId,
        input.entryKind,
        input.xpDelta,
        input.goldDelta,
        input.sourceSessionId ?? null,
        input.sourceCompletionRevisionId ?? null,
        input.sourceUserId ?? null,
        input.participantRole ?? null,
        input.policyVersion ?? null,
        input.preAwardXp ?? null,
        input.preAwardGold ?? null,
        input.preAwardLevel ?? null,
        input.reversesEntryId ?? null,
        input.actorUserId,
        input.reason ?? null,
        input.idempotencyKey,
        input.occurredAt,
      )
      .run();
    const row = await this.db
      .prepare("SELECT * FROM progression_ledger_entries WHERE guild_id = ? AND idempotency_key = ?")
      .bind(input.guildId, input.idempotencyKey)
      .first<EntryRow>();
    if (!row) throw new Error("Progression entry was not persisted");
    const entry = entryFromRow(row);
    if (
      entry.characterId !== input.characterId ||
      entry.entryKind !== input.entryKind ||
      (input.seasonId !== null && input.seasonId !== undefined && entry.seasonId !== input.seasonId) ||
      entry.xpDelta !== input.xpDelta ||
      entry.goldDelta !== input.goldDelta ||
      entry.reversesEntryId !== (input.reversesEntryId ?? null)
    ) {
      throw new ProgressionIdempotencyConflictError();
    }
    return entry;
  }

  async listEffectiveSessionAwards(
    guildId: string,
    sessionId: string,
  ): Promise<ProgressionLedgerEntry[]> {
    const result = await this.db
      .prepare(
        `SELECT award.*
         FROM progression_ledger_entries award
         LEFT JOIN progression_ledger_entries reversal
           ON reversal.guild_id = award.guild_id
          AND reversal.reverses_entry_id = award.entry_id
         WHERE award.guild_id = ? AND award.source_session_id = ?
           AND award.entry_kind = 'session_award' AND reversal.entry_id IS NULL
         ORDER BY award.occurred_at, award.entry_id`,
      )
      .bind(guildId, sessionId)
      .all<EntryRow>();
    return result.results.map(entryFromRow);
  }
}
