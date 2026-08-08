import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { WebsiteManagementRepository } from "../../src/storage/website-management-repository";

describe("website management rate limiting integration", () => {
  it("scopes fixed windows by guild, verified user, and management method", async () => {
    const seed = crypto.randomUUID().replace(/\D/g, "").padEnd(18, "0").slice(0, 18);
    const guildId = seed;
    const userId = `${seed}:admin`;
    const now = Date.parse("2026-08-08T18:00:00Z");
    await env.DB.prepare("INSERT INTO guild_config (guild_id) VALUES (?)").bind(guildId).run();
    const repository = new WebsiteManagementRepository(env.DB);

    expect(await repository.consumeRateLimit({
      guildId,
      userId,
      method: "getDiagnostics",
      limit: 1,
      now,
    })).toMatchObject({ allowed: true });
    expect(await repository.consumeRateLimit({
      guildId,
      userId,
      method: "getDiagnostics",
      limit: 1,
      now,
    })).toMatchObject({ allowed: false, retryAfterSeconds: 60 });
    expect(await repository.consumeRateLimit({
      guildId,
      userId,
      method: "getEffectiveConfiguration",
      limit: 1,
      now,
    })).toMatchObject({ allowed: true });
  });
});
