import { describe, expect, it, vi } from "vitest";
import { SessionSummaryService } from "../src/session-summary-service";
import type { SessionSummaryRepository } from "../src/storage/session-summary-repository";

function gatedRepository() {
  const listSummaryCreationDue = vi.fn(() => {
    throw new Error("recap creation must stay gated");
  });
  const repository = {
    listAutoCompletionDue: vi.fn().mockResolvedValue([{
      guildId: "100",
      eventId: "event-1",
      tableNumber: 2,
    }]),
    listSummaryCreationDue,
  } as unknown as SessionSummaryRepository;
  return { repository, listSummaryCreationDue };
}

describe("session recap launch gate", () => {
  it.each([
    { recapsEnabled: false, rewardPolicyVersion: null, label: "disabled" },
    { recapsEnabled: true, rewardPolicyVersion: null, label: "missing a reward policy" },
  ])("still records sessions but creates no recaps when $label", async (options) => {
    const { repository, listSummaryCreationDue } = gatedRepository();
    const confirmSession = vi.fn().mockResolvedValue(undefined);
    const sendDirectMessage = vi.fn();
    const service = new SessionSummaryService(
      repository,
      { confirmSession },
      { sendDirectMessage },
      { now: () => 1_000, ...options },
    );

    await service.runScheduled();

    expect(confirmSession).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "event-1",
      tableNumber: 2,
      result: "completed",
    }));
    expect(listSummaryCreationDue).not.toHaveBeenCalled();
    expect(sendDirectMessage).not.toHaveBeenCalled();
  });
});