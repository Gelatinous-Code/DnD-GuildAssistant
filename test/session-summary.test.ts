import { describe, expect, it } from "vitest";
import {
  SUMMARY_DUE_AFTER_MS,
  SUMMARY_EDIT_WINDOW_MS,
  SUMMARY_REMINDER_AFTER_MS,
  summarySchedule,
  validateSessionSummaryFields,
} from "../src/domain/session-summary";
import { InteractionResponseType } from "../src/discord";
import { renderSessionSummaryModal } from "../src/session-summary-app";
import {
  parseSummaryCustomId,
  summaryDidNotRunCustomId,
  summaryOpenCustomId,
  summarySubmitCustomId,
} from "../src/session-summary-service";
import type { SessionSummary } from "../src/storage/session-summary-repository";

function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    summaryId: "summary-1",
    guildId: "guild-1",
    sessionId: "session-1",
    completionRevisionId: "completion-1",
    dmUserId: "dm-1",
    sessionEndsAt: 1_000,
    dueAt: 1_000 + SUMMARY_DUE_AFTER_MS,
    status: "pending",
    summaryText: "",
    area: "",
    importantEvents: null,
    bonusRewards: null,
    otherNotes: null,
    firstSubmittedAt: null,
    editExpiresAt: null,
    lastSubmittedAt: null,
    publicationStatus: "visible",
    hiddenAt: null,
    hiddenByUserId: null,
    hiddenReason: null,
    rewardPolicyVersion: "test-reward-v1",
    authorEditStatus: "open",
    editLockedAt: null,
    editLockedByUserId: null,
    editLockReason: null,
    version: 1,
    createdAt: 2_000,
    updatedAt: 2_000,
    ...overrides,
  };
}

describe("session summary policy", () => {
  it("schedules a reminder at 48 hours and the on-time deadline at 72 hours", () => {
    expect(summarySchedule(10_000)).toEqual({
      reminderAt: 10_000 + SUMMARY_REMINDER_AFTER_MS,
      dueAt: 10_000 + SUMMARY_DUE_AFTER_MS,
    });
    expect(SUMMARY_EDIT_WINDOW_MS).toBe(7 * 24 * 60 * 60 * 1_000);
  });

  it("normalizes the public fields and enforces required summary and area", () => {
    expect(validateSessionSummaryFields({
      summaryText: "  The party stopped the ritual.  ",
      area: "  Bloom  ",
      importantEvents: "",
      bonusRewards: "  Moon key  ",
    })).toEqual({
      summaryText: "The party stopped the ritual.",
      area: "Bloom",
      importantEvents: null,
      bonusRewards: "Moon key",
      otherNotes: null,
    });
    expect(() => validateSessionSummaryFields({ summaryText: "", area: "Bloom" }))
      .toThrow("Summary is required");
    expect(() => validateSessionSummaryFields({ summaryText: "Done", area: "" }))
      .toThrow("Area is required");
  });

  it("round-trips button and modal custom IDs", () => {
    expect(parseSummaryCustomId(summaryOpenCustomId("summary-1"))).toEqual({
      action: "open",
      summaryId: "summary-1",
    });
    expect(parseSummaryCustomId(summarySubmitCustomId("summary-1"))).toEqual({
      action: "submit",
      summaryId: "summary-1",
    });
    expect(parseSummaryCustomId(summaryDidNotRunCustomId("summary-1"))).toEqual({
      action: "not_run",
      summaryId: "summary-1",
    });
    expect(parseSummaryCustomId(summaryDidNotRunCustomId("summary-1", true))).toEqual({
      action: "not_run_confirm",
      summaryId: "summary-1",
    });
    expect(parseSummaryCustomId("guild:summary:delete:summary-1")).toBeNull();
  });

  it("renders a prefilled five-field Discord modal", async () => {
    const response = renderSessionSummaryModal(summary({
      status: "submitted",
      summaryText: "The cult fled.",
      area: "Bloom",
      importantEvents: "The bell cracked.",
      firstSubmittedAt: 3_000,
      editExpiresAt: 3_000 + SUMMARY_EDIT_WINDOW_MS,
      lastSubmittedAt: 3_000,
      version: 2,
    }));
    const body = await response.json() as {
      type: number;
      data: { custom_id: string; title: string; components: unknown[] };
    };
    expect(body.type).toBe(InteractionResponseType.Modal);
    expect(body.data.custom_id).toBe(summarySubmitCustomId("summary-1"));
    expect(body.data.title).toBe("Edit session summary");
    expect(body.data.components).toHaveLength(5);
    expect(JSON.stringify(body.data.components)).toContain("The cult fled.");
  });
});
