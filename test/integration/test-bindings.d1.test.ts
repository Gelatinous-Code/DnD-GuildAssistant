import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

it("overrides local Discord secrets with inert integration-test values", () => {
  expect(env.DISCORD_PUBLIC_KEY).toBe("integration-test-public-key");
  expect(env.DISCORD_BOT_TOKEN).toBe("integration-test-bot-token");
});
