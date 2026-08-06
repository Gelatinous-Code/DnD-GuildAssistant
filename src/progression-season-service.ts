export const PROGRESSION_SEASON_POLICY_VERSION = "progression-season-v1";

export interface ProgressionSeason {
  guildId: string;
  seasonId: string;
  name: string;
  status: "current" | "closed";
  version: number;
  startsAt: number;
  endedAt: number | null;
  createdByUserId: string;
  createdAt: number;
  updatedAt: number;
}

export interface SeasonBalance {
  guildId: string;
  seasonId: string;
  seasonName: string;
  seasonStatus: "current" | "closed";
  characterId: string;
  ownerUserId: string;
  xp: number;
  gold: number;
}

export interface SeasonRolloverPreview {
  currentSeason: ProgressionSeason;
  nextSeasonId: string;
  nextSeasonName: string;
  continuingCharacterCount: number;
  nonzeroBalanceCount: number;
  totalXp: number;
  totalGold: number;
}

export interface SeasonRolloverResult extends SeasonRolloverPreview {
  season: ProgressionSeason;
  replayed: boolean;
}

type SeasonRow = {
  guild_id: string;
  season_id: string;
  name: string;
  status: "current" | "closed";
  version: number;
  starts_at: number;
  ended_at: number | null;
  created_by_user_id: string;
  created_at: number;
  updated_at: number;
};

type BalanceRow = {
  guild_id: string;
  season_id: string;
  season_name: string;
  season_status: "current" | "closed";
  character_id: string;
  owner_user_id: string;
  xp: number;
  gold: number;
};

type AggregateRow = {
  character_count: number;
  nonzero_count: number;
  total_xp: number;
  total_gold: number;
};

type SeasonEventRow = {
  to_season_id: string;
};

function fromSeasonRow(row: SeasonRow): ProgressionSeason {
  return {
    guildId: row.guild_id,
    seasonId: row.season_id,
    name: row.name,
    status: row.status,
    version: row.version,
    startsAt: row.starts_at,
    endedAt: row.ended_at,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fromBalanceRow(row: BalanceRow): SeasonBalance {
  return {
    guildId: row.guild_id,
    seasonId: row.season_id,
    seasonName: row.season_name,
    seasonStatus: row.season_status,
    characterId: row.character_id,
    ownerUserId: row.owner_user_id,
    xp: row.xp,
    gold: row.gold,
  };
}

function cleanText(value: string, label: string, max = 80): string {
  const cleaned = value.replace(/[\r\n]+/g, " ").trim();
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

export class ProgressionSeasonRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProgressionSeasonRuleError";
  }
}

export class ProgressionSeasonService {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => number = Date.now,
    private readonly id: () => string = () => crypto.randomUUID(),
  ) {}

  async ensureCurrentSeason(
    guildId: string,
    actorUserId = "system:progression-season",
  ): Promise<ProgressionSeason> {
    const now = this.now();
    await this.db.prepare(
      `INSERT OR IGNORE INTO progression_seasons (
         guild_id, season_id, name, status, starts_at,
         created_by_user_id, created_at, updated_at
       )
       SELECT ?, 'legacy', 'Legacy / opening balances', 'current', 0, ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM progression_seasons WHERE guild_id = ? AND status = 'current'
       )`,
    ).bind(guildId, actorUserId, now, now, guildId).run();
    const current = await this.getCurrentSeason(guildId);
    if (!current) throw new Error("Current progression season was not persisted");
    return current;
  }

  async getCurrentSeason(guildId: string): Promise<ProgressionSeason | null> {
    const row = await this.db.prepare(
      "SELECT * FROM progression_seasons WHERE guild_id = ? AND status = 'current'",
    ).bind(guildId).first<SeasonRow>();
    return row ? fromSeasonRow(row) : null;
  }

  async listSeasons(guildId: string): Promise<ProgressionSeason[]> {
    const result = await this.db.prepare(
      `SELECT * FROM progression_seasons WHERE guild_id = ?
       ORDER BY starts_at DESC, season_id DESC`,
    ).bind(guildId).all<SeasonRow>();
    return result.results.map(fromSeasonRow);
  }

  async listBalances(guildId: string, seasonId: string): Promise<SeasonBalance[]> {
    const result = await this.db.prepare(
      `SELECT * FROM character_progression_by_season
       WHERE guild_id = ? AND season_id = ?
       ORDER BY owner_user_id, character_id`,
    ).bind(guildId, seasonId).all<BalanceRow>();
    return result.results.map(fromBalanceRow);
  }

  async previewRollover(input: {
    guildId: string;
    nextSeasonId: string;
    nextSeasonName: string;
  }): Promise<SeasonRolloverPreview> {
    const nextSeasonId = cleanText(input.nextSeasonId, "Season ID");
    const nextSeasonName = cleanText(input.nextSeasonName, "Season name");
    const currentSeason = await this.ensureCurrentSeason(input.guildId);
    if (currentSeason.seasonId === nextSeasonId) {
      throw new ProgressionSeasonRuleError("The new season ID must differ from the current season.");
    }
    const existing = await this.db.prepare(
      "SELECT 1 AS found FROM progression_seasons WHERE guild_id = ? AND season_id = ?",
    ).bind(input.guildId, nextSeasonId).first<number>("found");
    if (existing) {
      throw new ProgressionSeasonRuleError("That season ID already exists in this guild.");
    }
    const aggregate = await this.db.prepare(
      `SELECT
         count(*) AS character_count,
         COALESCE(sum(CASE WHEN balance.xp <> 0 OR balance.gold <> 0 THEN 1 ELSE 0 END), 0)
           AS nonzero_count,
         COALESCE(sum(balance.xp), 0) AS total_xp,
         COALESCE(sum(balance.gold), 0) AS total_gold
       FROM character_progression_balances balance
       JOIN characters character
         ON character.guild_id = balance.guild_id
        AND character.character_id = balance.character_id
       WHERE balance.guild_id = ? AND character.status = 'approved'`,
    ).bind(input.guildId).first<AggregateRow>();
    return {
      currentSeason,
      nextSeasonId,
      nextSeasonName,
      continuingCharacterCount: aggregate?.character_count ?? 0,
      nonzeroBalanceCount: aggregate?.nonzero_count ?? 0,
      totalXp: aggregate?.total_xp ?? 0,
      totalGold: aggregate?.total_gold ?? 0,
    };
  }

  async rollover(input: {
    guildId: string;
    nextSeasonId: string;
    nextSeasonName: string;
    actorUserId: string;
    reason: string;
    operationKey: string;
  }): Promise<SeasonRolloverResult> {
    const reason = cleanReason(input.reason);
    const existingEvent = await this.db.prepare(
      `SELECT to_season_id FROM progression_season_events
       WHERE guild_id = ? AND idempotency_key = ?`,
    ).bind(input.guildId, input.operationKey).first<SeasonEventRow>();
    if (existingEvent) {
      if (existingEvent.to_season_id !== input.nextSeasonId.trim()) {
        throw new ProgressionSeasonRuleError(
          "That operation key is already associated with another season rollover.",
        );
      }
      const season = await this.getCurrentSeason(input.guildId);
      if (!season || season.seasonId !== existingEvent.to_season_id) {
        throw new Error("The replayed season rollover no longer matches current state");
      }
      const balances = await this.listBalances(input.guildId, season.seasonId);
      return {
        currentSeason: season,
        nextSeasonId: season.seasonId,
        nextSeasonName: season.name,
        continuingCharacterCount: balances.length,
        nonzeroBalanceCount: balances.filter((row) => row.xp !== 0 || row.gold !== 0).length,
        totalXp: balances.reduce((sum, row) => sum + row.xp, 0),
        totalGold: balances.reduce((sum, row) => sum + row.gold, 0),
        season,
        replayed: true,
      };
    }
    const preview = await this.previewRollover(input);
    const occurredAt = this.now();
    await this.db.batch([
      this.db.prepare(
        `UPDATE progression_seasons
         SET status = 'closed', ended_at = ?, version = version + 1, updated_at = ?
         WHERE guild_id = ? AND season_id = ? AND status = 'current' AND version = ?`,
      ).bind(
        occurredAt,
        occurredAt,
        input.guildId,
        preview.currentSeason.seasonId,
        preview.currentSeason.version,
      ),
      this.db.prepare(
        `INSERT INTO progression_seasons (
           guild_id, season_id, name, status, starts_at,
           created_by_user_id, created_at, updated_at
         ) VALUES (?, ?, ?, 'current', ?, ?, ?, ?)`,
      ).bind(
        input.guildId,
        preview.nextSeasonId,
        preview.nextSeasonName,
        occurredAt,
        input.actorUserId,
        occurredAt,
        occurredAt,
      ),
      this.db.prepare(
        `INSERT INTO character_season_openings (
           opening_id, guild_id, season_id, character_id, opening_xp,
           opening_gold, policy_version, source_kind, actor_user_id,
           reason, idempotency_key, created_at
         )
         SELECT 'season-opening:' || ? || ':' || character_id,
                guild_id, ?, character_id, 0, 0, ?, 'rollover', ?, ?,
                'season-opening:' || ? || ':' || character_id, ?
         FROM characters
         WHERE guild_id = ? AND status = 'approved'`,
      ).bind(
        preview.nextSeasonId,
        preview.nextSeasonId,
        PROGRESSION_SEASON_POLICY_VERSION,
        input.actorUserId,
        reason,
        preview.nextSeasonId,
        occurredAt,
        input.guildId,
      ),
      this.db.prepare(
        `INSERT INTO progression_season_events (
           season_event_id, guild_id, from_season_id, to_season_id, action,
           policy_version, actor_user_id, reason, character_count,
           idempotency_key, occurred_at, details_json
         ) VALUES (?, ?, ?, ?, 'rollover', ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        this.id(),
        input.guildId,
        preview.currentSeason.seasonId,
        preview.nextSeasonId,
        PROGRESSION_SEASON_POLICY_VERSION,
        input.actorUserId,
        reason,
        preview.continuingCharacterCount,
        input.operationKey,
        occurredAt,
        JSON.stringify({
          resetXp: preview.totalXp,
          resetGold: preview.totalGold,
          nonzeroBalanceCount: preview.nonzeroBalanceCount,
        }),
      ),
    ]);
    const season = await this.getCurrentSeason(input.guildId);
    if (!season || season.seasonId !== preview.nextSeasonId) {
      throw new Error("Season rollover did not reach the requested current season");
    }
    return { ...preview, season, replayed: false };
  }
}
