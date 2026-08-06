import { describe, expect, it } from "vitest";
import { handleDiscordInteraction } from "../src/app";
import { InteractionResponseType, InteractionType } from "../src/discord";
import { summaryOpenCustomId } from "../src/session-summary-service";

describe("session summary interaction routing", () => {
  it("answers the DM button synchronously with a modal instead of deferring it", async () => {
    const row = {
      summary_id: "summary-1",
      guild_id: "guild-1",
      session_id: "session-1",
      completion_revision_id: "completion-1",
      dm_user_id: "1533183019031199946",
      session_ends_at: 1_000,
      due_at: 2_000,
      status: "pending",
      summary_text: null,
      area: null,
      important_events: null,
      bonus_rewards: null,
      other_notes: null,
      first_submitted_at: null,
      edit_expires_at: null,
      last_submitted_at: null,
      publication_status: "visible",
      hidden_at: null,
      hidden_by_user_id: null,
      hidden_reason: null,
      version: 1,
      created_at: 1_100,
      updated_at: 1_100,
    };
    const statement = {
      bind() { return this; },
      async first() { return row; },
    };
    const env = {
      DB: { prepare: () => statement } as unknown as D1Database,
      DISCORD_PUBLIC_KEY: "public",
      DISCORD_BOT_TOKEN: "bot-secret",
      DISCORD_APPLICATION_ID: "1533171671886725293",
      DISCORD_TEST_GUILD_ID: "1533181439376494642",
  SESSION_RECAP_WORKFLOW_ENABLED: "false",
  SESSION_RECAP_REWARD_POLICY_VERSION: "",
    } satisfies Env;
    let deferred = false;
    const context = {
      waitUntil() { deferred = true; },
    } as unknown as ExecutionContext;

    const response = await handleDiscordInteraction({
      id: "interaction-1",
      application_id: env.DISCORD_APPLICATION_ID,
      token: "interaction-token",
      type: InteractionType.MessageComponent,
      user: { id: row.dm_user_id },
      data: { custom_id: summaryOpenCustomId(row.summary_id) },
    }, env, context);
    const body = await response.json() as { type: number; data: { custom_id: string } };

    expect(deferred).toBe(false);
    expect(body.type).toBe(InteractionResponseType.Modal);
    expect(body.data.custom_id).toContain("guild:summary:submit:");
  });
});
