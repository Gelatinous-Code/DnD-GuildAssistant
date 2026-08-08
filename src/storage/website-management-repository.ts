export const WEBSITE_MANAGEMENT_WINDOW_MS = 60_000;

export class WebsiteManagementRepository {
  constructor(private readonly db: D1Database) {}

  async consumeRateLimit(input: {
    guildId: string;
    userId: string;
    method: string;
    limit: number;
    now: number;
  }): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const bucketStartedAt = input.now - (input.now % WEBSITE_MANAGEMENT_WINDOW_MS);
    const count = await this.db.prepare(
      `INSERT INTO website_management_rate_limits (
         guild_id, user_id, method, bucket_started_at, request_count, updated_at
       ) VALUES (?, ?, ?, ?, 1, ?)
       ON CONFLICT (guild_id, user_id, method, bucket_started_at) DO UPDATE SET
         request_count = request_count + 1,
         updated_at = excluded.updated_at
       RETURNING request_count`,
    ).bind(input.guildId, input.userId, input.method, bucketStartedAt, input.now)
      .first<number>("request_count");
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucketStartedAt + WEBSITE_MANAGEMENT_WINDOW_MS - input.now) / 1_000),
    );
    return {
      allowed: (count ?? input.limit + 1) <= input.limit,
      retryAfterSeconds,
    };
  }

  async deleteExpiredRateLimits(now: number, limit = 1_000): Promise<number> {
    const result = await this.db.prepare(
      `DELETE FROM website_management_rate_limits
       WHERE rowid IN (
         SELECT rowid FROM website_management_rate_limits
         WHERE updated_at < ? ORDER BY updated_at LIMIT ?
       )`,
    ).bind(now - 24 * 60 * 60 * 1_000, limit).run();
    return result.meta.changes;
  }
}
