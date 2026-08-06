import { describe, expect, it, vi } from "vitest";
import { SessionSummaryService } from "../src/session-summary-service";
import type { SessionSummaryRepository } from "../src/storage/session-summary-repository";

describe("session recap launch gate", () => {
  it("still records completed sessions but does not create or deliver recaps while disabled", async () => {
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
    const confirmSession = vi.fn().mockResolvedValue(undefined);
    const sendDirectMessage = vi.fn();
    const service = new SessionSummaryService(
      repository,
      { confirmSession },
      { sendDirectMessage },
      { now: () => 1_000, recapsEnabled: false },
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
