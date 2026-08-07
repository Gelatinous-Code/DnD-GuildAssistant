import type {
  CharacterProgressionState,
  CharacterStatus,
} from "../domain/character";

export interface GuildCharacter {
  characterId: string;
  guildId: string;
  ownerUserId: string;
  name: string;
  sheetUrl: string | null;
  season: string | null;
  status: CharacterStatus;
  progressionState: CharacterProgressionState;
  isMain: boolean;
  openingXp: number;
  openingGold: number;
  version: number;
  createdAt: number;
  createdByUserId: string;
  updatedAt: number;
  approvedAt: number | null;
  approvedByUserId: string | null;
  revokedAt: number | null;
  revokedByUserId: string | null;
  archivedAt: number | null;
  archivedByUserId: string | null;
}

export type CharacterEventAction =
  | "created"
  | "approved"
  | "main_changed"
  | "frozen"
  | "unfrozen"
  | "revoked"
  | "archived";

type CharacterRow = {
  character_id: string;
  guild_id: string;
  owner_user_id: string;
  name: string;
  sheet_url: string | null;
  season: string | null;
  status: CharacterStatus;
  progression_state: CharacterProgressionState;
  is_main: number;
  opening_xp: number;
  opening_gold: number;
  version: number;
  created_at: number;
  created_by_user_id: string;
  updated_at: number;
  approved_at: number | null;
  approved_by_user_id: string | null;
  revoked_at: number | null;
  revoked_by_user_id: string | null;
  archived_at: number | null;
  archived_by_user_id: string | null;
};

function fromRow(row: CharacterRow): GuildCharacter {
  return {
    characterId: row.character_id,
    guildId: row.guild_id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    sheetUrl: row.sheet_url,
    season: row.season,
    status: row.status,
    progressionState: row.progression_state,
    isMain: row.is_main === 1,
    openingXp: row.opening_xp,
    openingGold: row.opening_gold,
    version: row.version,
    createdAt: row.created_at,
    createdByUserId: row.created_by_user_id,
    updatedAt: row.updated_at,
    approvedAt: row.approved_at,
    approvedByUserId: row.approved_by_user_id,
    revokedAt: row.revoked_at,
    revokedByUserId: row.revoked_by_user_id,
    archivedAt: row.archived_at,
    archivedByUserId: row.archived_by_user_id,
  };
}

export interface CreateCharacterRecordInput {
  characterId: string;
  characterEventId: string;
  guildId: string;
  ownerUserId: string;
  name: string;
  sheetUrl: string | null;
  season: string | null;
  actorUserId: string;
  occurredAt: number;
  idempotencyKey: string;
}

export interface ApproveCharacterRecordInput {
  characterEventId: string;
  guildId: string;
  characterId: string;
  actorUserId: string;
  openingXp: number;
  openingGold: number;
  makeMain: boolean;
  reason: string;
  occurredAt: number;
  idempotencyKey: string;
}

export interface ChangeCharacterStateInput {
  characterEventId: string;
  guildId: string;
  characterId: string;
  actorUserId: string;
  action: "frozen" | "unfrozen" | "revoked" | "archived";
  reason: string | null;
  occurredAt: number;
  idempotencyKey: string;
}

export interface SetMainCharacterInput {
  guildId: string;
  ownerUserId: string;
  characterId: string;
  actorUserId: string;
  previousCharacterId: string | null;
  targetEventId: string;
  previousEventId: string | null;
  occurredAt: number;
  idempotencyKey: string;
}

export class CharacterRepository {
  constructor(private readonly db: D1Database) {}

  async get(guildId: string, characterId: string): Promise<GuildCharacter | null> {
    const row = await this.db
      .prepare("SELECT * FROM characters WHERE guild_id = ? AND character_id = ?")
      .bind(guildId, characterId)
      .first<CharacterRow>();
    return row ? fromRow(row) : null;
  }

  async listForOwner(guildId: string, ownerUserId: string): Promise<GuildCharacter[]> {
    const result = await this.db
      .prepare(
        `SELECT * FROM characters
         WHERE guild_id = ? AND owner_user_id = ?
         ORDER BY CASE status WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
                  is_main DESC, created_at, character_id`,
      )
      .bind(guildId, ownerUserId)
      .all<CharacterRow>();
    return result.results.map(fromRow);
  }

  async listPending(guildId: string, limit = 25): Promise<GuildCharacter[]> {
    const result = await this.db
      .prepare(
        `SELECT * FROM characters WHERE guild_id = ? AND status = 'pending'
         ORDER BY created_at, character_id LIMIT ?`,
      )
      .bind(guildId, limit)
      .all<CharacterRow>();
    return result.results.map(fromRow);
  }

  async create(input: CreateCharacterRecordInput): Promise<GuildCharacter> {
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO characters (
             character_id, guild_id, owner_user_id, name, sheet_url, season,
             created_at, created_by_user_id, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.characterId,
          input.guildId,
          input.ownerUserId,
          input.name,
          input.sheetUrl,
          input.season,
          input.occurredAt,
          input.actorUserId,
          input.occurredAt,
        ),
      this.eventStatement({
        eventId: input.characterEventId,
        guildId: input.guildId,
        characterId: input.characterId,
        idempotencyKey: input.idempotencyKey,
        action: "created",
        version: 1,
        actorUserId: input.actorUserId,
        reason: null,
        details: null,
        occurredAt: input.occurredAt,
      }),
    ]);
    return (await this.get(input.guildId, input.characterId))!;
  }

  async approve(input: ApproveCharacterRecordInput): Promise<GuildCharacter | null> {
    const current = await this.get(input.guildId, input.characterId);
    if (!current || current.status !== "pending") return null;
    const version = current.version + 1;
    const results = await this.db.batch([
      this.db
        .prepare(
          `INSERT OR IGNORE INTO progression_seasons (
             guild_id, season_id, name, status, starts_at,
             created_by_user_id, created_at, updated_at
           )
           SELECT ?, 'legacy', 'Legacy / opening balances', 'current', 0, ?, ?, ?
           WHERE NOT EXISTS (
             SELECT 1 FROM progression_seasons
             WHERE guild_id = ? AND status = 'current'
           )`,
        )
        .bind(
          input.guildId,
          input.actorUserId,
          input.occurredAt,
          input.occurredAt,
          input.guildId,
        ),
      this.db
        .prepare(
          `UPDATE characters SET status = 'approved', progression_state = 'active',
             is_main = ?, opening_xp = ?, opening_gold = ?, version = ?,
             approved_at = ?, approved_by_user_id = ?, updated_at = ?
           WHERE guild_id = ? AND character_id = ? AND status = 'pending' AND version = ?`,
        )
        .bind(
          input.makeMain ? 1 : 0,
          input.openingXp,
          input.openingGold,
          version,
          input.occurredAt,
          input.actorUserId,
          input.occurredAt,
          input.guildId,
          input.characterId,
          current.version,
        ),
      this.db
        .prepare(
          `INSERT INTO character_season_openings (
             opening_id, guild_id, season_id, character_id, opening_xp,
             opening_gold, policy_version, source_kind, actor_user_id,
             reason, idempotency_key, created_at
           )
           SELECT ?, ?, season_id, ?, ?, ?, 'progression-season-v1',
                  'approval', ?, ?, ?, ?
           FROM progression_seasons
           WHERE guild_id = ? AND status = 'current'
             AND EXISTS (
               SELECT 1 FROM characters
               WHERE guild_id = ? AND character_id = ? AND status = 'approved'
             )`,
        )
        .bind(
          `season-opening:approval:${input.characterId}`,
          input.guildId,
          input.characterId,
          input.openingXp,
          input.openingGold,
          input.actorUserId,
          input.reason,
          `${input.idempotencyKey}:season-opening`,
          input.occurredAt,
          input.guildId,
          input.guildId,
          input.characterId,
        ),
      this.eventStatement({
        eventId: input.characterEventId,
        guildId: input.guildId,
        characterId: input.characterId,
        idempotencyKey: input.idempotencyKey,
        action: "approved",
        version,
        actorUserId: input.actorUserId,
        reason: input.reason,
        details: {
          openingXp: input.openingXp,
          openingGold: input.openingGold,
          madeMain: input.makeMain,
        },
        occurredAt: input.occurredAt,
      }),
    ]);
    if (results[1]?.meta.changes !== 1) return null;
    return this.get(input.guildId, input.characterId);
  }

  async setMain(input: SetMainCharacterInput): Promise<GuildCharacter | null> {
    const target = await this.get(input.guildId, input.characterId);
    if (!target) return null;
    const statements: D1PreparedStatement[] = [];
    if (input.previousCharacterId) {
      const previous = await this.get(input.guildId, input.previousCharacterId);
      if (!previous) return null;
      statements.push(
        this.db
          .prepare(
            `UPDATE characters SET is_main = 0, version = version + 1, updated_at = ?
             WHERE guild_id = ? AND character_id = ? AND owner_user_id = ?
               AND status = 'approved' AND is_main = 1`,
          )
          .bind(
            input.occurredAt,
            input.guildId,
            input.previousCharacterId,
            input.ownerUserId,
          ),
        this.eventStatement({
          eventId: input.previousEventId!,
          guildId: input.guildId,
          characterId: input.previousCharacterId,
          idempotencyKey: `${input.idempotencyKey}:previous`,
          action: "main_changed",
          version: previous.version + 1,
          actorUserId: input.actorUserId,
          reason: null,
          details: { isMain: false, newMainCharacterId: input.characterId },
          occurredAt: input.occurredAt,
        }),
      );
    }
    statements.push(
      this.db
        .prepare(
          `UPDATE characters SET is_main = 1, version = version + 1, updated_at = ?
           WHERE guild_id = ? AND character_id = ? AND owner_user_id = ?
             AND status = 'approved' AND progression_state = 'active' AND is_main = 0`,
        )
        .bind(input.occurredAt, input.guildId, input.characterId, input.ownerUserId),
      this.eventStatement({
        eventId: input.targetEventId,
        guildId: input.guildId,
        characterId: input.characterId,
        idempotencyKey: input.idempotencyKey,
        action: "main_changed",
        version: target.version + 1,
        actorUserId: input.actorUserId,
        reason: null,
        details: { isMain: true, previousMainCharacterId: input.previousCharacterId },
        occurredAt: input.occurredAt,
      }),
    );
    const results = await this.db.batch(statements);
    const targetUpdateIndex = input.previousCharacterId ? 2 : 0;
    if (results[targetUpdateIndex]?.meta.changes !== 1) return null;
    return this.get(input.guildId, input.characterId);
  }

  async changeState(input: ChangeCharacterStateInput): Promise<GuildCharacter | null> {
    const current = await this.get(input.guildId, input.characterId);
    if (!current) return null;
    const version = current.version + 1;
    let setClause: string;
    if (input.action === "frozen") {
      setClause = "progression_state = 'frozen'";
    } else if (input.action === "unfrozen") {
      setClause = "progression_state = 'active'";
    } else if (input.action === "revoked") {
      setClause = `status = 'revoked', progression_state = 'active', is_main = 0,
        revoked_at = ?, revoked_by_user_id = ?`;
    } else {
      setClause = `status = 'archived', progression_state = 'active', is_main = 0,
        archived_at = ?, archived_by_user_id = ?`;
    }
    const terminal = input.action === "revoked" || input.action === "archived";
    const bindings: unknown[] = [];
    if (terminal) bindings.push(input.occurredAt, input.actorUserId);
    bindings.push(version, input.occurredAt, input.guildId, input.characterId, current.version);
    const results = await this.db.batch([
      this.db
        .prepare(
          `UPDATE characters SET ${setClause}, version = ?, updated_at = ?
           WHERE guild_id = ? AND character_id = ? AND version = ?`,
        )
        .bind(...bindings),
      this.eventStatement({
        eventId: input.characterEventId,
        guildId: input.guildId,
        characterId: input.characterId,
        idempotencyKey: input.idempotencyKey,
        action: input.action,
        version,
        actorUserId: input.actorUserId,
        reason: input.reason,
        details: null,
        occurredAt: input.occurredAt,
      }),
    ]);
    if (results[0]?.meta.changes !== 1) return null;
    return this.get(input.guildId, input.characterId);
  }

  private eventStatement(input: {
    eventId: string;
    guildId: string;
    characterId: string;
    idempotencyKey: string;
    action: CharacterEventAction;
    version: number;
    actorUserId: string;
    reason: string | null;
    details: Record<string, unknown> | null;
    occurredAt: number;
  }): D1PreparedStatement {
    return this.db
      .prepare(
        `INSERT INTO character_events (
           character_event_id, guild_id, character_id, idempotency_key, action,
           character_version, actor_user_id, reason, details_json, occurred_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.eventId,
        input.guildId,
        input.characterId,
        input.idempotencyKey,
        input.action,
        input.version,
        input.actorUserId,
        input.reason,
        input.details ? JSON.stringify(input.details) : null,
        input.occurredAt,
      );
  }
}
