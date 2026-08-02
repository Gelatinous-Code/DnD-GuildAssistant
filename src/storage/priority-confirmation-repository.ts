export interface PriorityConfirmationPreview {
  previewId: string;
  guildId: string;
  userId: string;
  eventId: string;
  planId: string;
  tableId: string;
  assignmentId: string;
  assignmentVersion: number;
  tableStateVersion: number;
  creditId: string;
  tableWasFull: boolean;
  expiresAt: number;
  createdAt: number;
  usedAt: number | null;
}

export interface CreatePriorityConfirmationPreviewInput {
  previewId: string;
  guildId: string;
  userId: string;
  eventId: string;
  planId: string;
  tableId: string;
  assignmentId: string;
  assignmentVersion: number;
  tableStateVersion: number;
  creditId: string;
  tableWasFull: boolean;
  expiresAt: number;
  createdAt: number;
}

type PreviewRow = {
  preview_id: string;
  guild_id: string;
  user_id: string;
  event_id: string;
  plan_id: string;
  table_id: string;
  assignment_id: string;
  assignment_version: number;
  table_state_version: number;
  credit_id: string;
  table_was_full: number;
  expires_at: number;
  created_at: number;
  used_at: number | null;
};

function fromRow(row: PreviewRow): PriorityConfirmationPreview {
  return {
    previewId: row.preview_id,
    guildId: row.guild_id,
    userId: row.user_id,
    eventId: row.event_id,
    planId: row.plan_id,
    tableId: row.table_id,
    assignmentId: row.assignment_id,
    assignmentVersion: row.assignment_version,
    tableStateVersion: row.table_state_version,
    creditId: row.credit_id,
    tableWasFull: row.table_was_full === 1,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    usedAt: row.used_at,
  };
}

function requireIdentifier(value: string, name: string): void {
  if (!value.trim()) throw new TypeError(`${name} cannot be empty`);
}

function requireTimestamp(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe-integer timestamp`);
  }
}

export class PriorityConfirmationRepository {
  constructor(private readonly db: D1Database) {}

  async create(
    input: CreatePriorityConfirmationPreviewInput,
  ): Promise<PriorityConfirmationPreview> {
    for (const key of [
      "previewId", "guildId", "userId", "eventId", "planId", "tableId",
      "assignmentId", "creditId",
    ] as const) requireIdentifier(input[key], key);
    if (
      !Number.isSafeInteger(input.assignmentVersion) || input.assignmentVersion < 0 ||
      !Number.isSafeInteger(input.tableStateVersion) || input.tableStateVersion < 0 ||
      input.expiresAt <= input.createdAt
    ) {
      throw new RangeError("The priority preview versions or expiry are invalid");
    }
    requireTimestamp(input.createdAt, "createdAt");
    requireTimestamp(input.expiresAt, "expiresAt");
    await this.db.prepare(
      `INSERT INTO priority_confirmation_previews (
         preview_id, guild_id, user_id, event_id, plan_id, table_id,
         assignment_id, assignment_version, table_state_version, credit_id,
         table_was_full, expires_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      input.previewId,
      input.guildId,
      input.userId,
      input.eventId,
      input.planId,
      input.tableId,
      input.assignmentId,
      input.assignmentVersion,
      input.tableStateVersion,
      input.creditId,
      Number(input.tableWasFull),
      input.expiresAt,
      input.createdAt,
    ).run();
    const preview = await this.get(input.guildId, input.previewId, input.userId);
    if (!preview) throw new Error("The priority confirmation preview was not persisted");
    return preview;
  }

  async get(
    guildId: string,
    previewId: string,
    userId: string,
  ): Promise<PriorityConfirmationPreview | null> {
    const row = await this.db.prepare(
      `SELECT * FROM priority_confirmation_previews
       WHERE guild_id = ? AND preview_id = ? AND user_id = ?`,
    ).bind(guildId, previewId, userId).first<PreviewRow>();
    return row ? fromRow(row) : null;
  }

  async markUsed(
    guildId: string,
    previewId: string,
    userId: string,
    usedAt: number,
  ): Promise<boolean> {
    requireIdentifier(guildId, "guildId");
    requireIdentifier(previewId, "previewId");
    requireIdentifier(userId, "userId");
    requireTimestamp(usedAt, "usedAt");
    const result = await this.db.prepare(
      `UPDATE priority_confirmation_previews
       SET used_at = ?
       WHERE guild_id = ? AND preview_id = ? AND user_id = ?
         AND used_at IS NULL`,
    ).bind(usedAt, guildId, previewId, userId).run();
    return result.meta.changes === 1;
  }

  async deleteExpired(now: number, limit = 100): Promise<number> {
    requireTimestamp(now, "now");
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new RangeError("limit must be an integer from 1 through 500");
    }
    const result = await this.db.prepare(
      `DELETE FROM priority_confirmation_previews
       WHERE preview_id IN (
         SELECT preview_id FROM priority_confirmation_previews
         WHERE expires_at <= ? ORDER BY expires_at ASC LIMIT ?
       )`,
    ).bind(now, limit).run();
    return result.meta.changes;
  }
}
