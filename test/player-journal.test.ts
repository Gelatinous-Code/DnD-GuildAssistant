import { describe, expect, it } from "vitest";
import {
  journalOpenCustomId,
  journalSubmitCustomId,
  parseJournalCustomId,
} from "../src/player-journal-service";

describe("player journal component identifiers", () => {
  it("round-trips open and submit actions", () => {
    expect(parseJournalCustomId(journalOpenCustomId("journal-123"))).toEqual({
      action: "open",
      journalId: "journal-123",
    });
    expect(parseJournalCustomId(journalSubmitCustomId("journal-123"))).toEqual({
      action: "submit",
      journalId: "journal-123",
    });
    expect(parseJournalCustomId("recap:open:journal-123")).toBeNull();
  });
});
