import { describe, expect, it } from "vitest";
import type { MemberDataCounts } from "../src/domain/member-data-policy";
import type { MemberDataSnapshot } from "../src/member-data-export";
import {
  MemberDataRevisionConflictError,
  MemberDataService,
  type MemberDataSnapshotReader,
} from "../src/member-data-service";

const COUNTS: MemberDataCounts = {
  characters: 2,
  characterEvents: 3,
  journals: 5,
  journalRevisions: 7,
  seasonalBalances: 11,
  progressionEntries: 13,
  shopReceipts: 17,
  officialRecaps: 19,
  recapRevisions: 23,
  weeklySignups: 29,
  tableAssignments: 31,
  sessionParticipationRecords: 37,
  dmPriorityCredits: 41,
};

function snapshot(): MemberDataSnapshot {
  return {
    guildId: "guild-1",
    subjectUserId: "member-1",
    counts: COUNTS,
    collections: {
      characters: [{ characterId: "character-1", name: "Hero" }],
      characterEvents: [], journals: [], journalRevisions: [],
      seasonalBalances: [], seasonOpenings: [], progressionEntries: [],
      shopReceipts: [], shopReceiptItems: [], shopReceiptEvents: [],
      officialRecaps: [], recapRevisions: [], weeklySignups: [],
      tableAssignments: [], sessionParticipationRecords: [],
      dmPriorityGrants: [], dmPriorityCredits: [], dmPriorityCreditEvents: [],
    },
  };
}

class FakeReader implements MemberDataSnapshotReader {
  readonly calls: Array<{ guildId: string; userId: string }> = [];

  async snapshot(guildId: string, userId: string): Promise<MemberDataSnapshot> {
    this.calls.push({ guildId, userId });
    return { ...snapshot(), guildId, subjectUserId: userId };
  }
}

describe("member data service", () => {
  it("builds a versioned read-only export inventory", async () => {
    const reader = new FakeReader();
    const service = new MemberDataService(reader, () => 123_456);
    const preview = await service.preview({
      guildId: "guild-1",
      subjectUserId: "member-1",
      action: "export",
    });

    expect(reader.calls).toEqual([{ guildId: "guild-1", userId: "member-1" }]);
    expect(preview).toMatchObject({
      schemaVersion: "member-data-inventory.v1",
      policyVersion: "member-data-lifecycle.v1",
      action: "export",
      generatedAt: 123_456,
      counts: COUNTS,
      mutatesData: false,
    });
    expect(preview.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.classes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "characters", recordCount: 5, treatment: "include" }),
      expect.objectContaining({ id: "progression", recordCount: 24, treatment: "include" }),
    ]));
  });

  it("exports only the exact preview revision", async () => {
    const service = new MemberDataService(new FakeReader(), () => 123_456);
    const preview = await service.preview({
      guildId: "guild-1", subjectUserId: "member-1", action: "export",
    });
    const artifact = await service.export({
      guildId: "guild-1",
      subjectUserId: "member-1",
      expectedRevision: preview.revision,
    });
    expect(artifact.filename).toContain(preview.revision.slice(0, 12));
    expect(artifact.contentType).toBe("application/json; charset=utf-8");
    expect(JSON.parse(artifact.text)).toMatchObject({
      schemaVersion: "member-data-export.v1",
      revision: preview.revision,
      guildId: "guild-1",
      subjectUserId: "member-1",
      data: { characters: [{ characterId: "character-1", name: "Hero" }] },
    });
  });

  it("rejects a stale revision", async () => {
    const service = new MemberDataService(new FakeReader());
    await expect(service.export({
      guildId: "guild-1",
      subjectUserId: "member-1",
      expectedRevision: "0".repeat(64),
    })).rejects.toBeInstanceOf(MemberDataRevisionConflictError);
  });

  it("returns the conservative departure treatment without applying it", async () => {
    const preview = await new MemberDataService(new FakeReader()).preview({
      guildId: "guild-1", subjectUserId: "member-1", action: "departure",
    });
    expect(preview.mutatesData).toBe(false);
    expect(preview.classes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "journals", treatment: "hide_then_tombstone_authored_content" }),
      expect.objectContaining({ id: "official_recaps", treatment: "preserve_shared_campaign_history" }),
      expect.objectContaining({ id: "shop_receipts", treatment: "preserve_append_only_financial_history" }),
    ]));
  });

  it("rejects unbounded identifiers and unsupported actions before reading D1", async () => {
    const reader = new FakeReader();
    const service = new MemberDataService(reader);
    await expect(service.preview({
      guildId: " ", subjectUserId: "member-1", action: "export",
    })).rejects.toThrow("Guild ID is invalid");
    await expect(service.preview({
      guildId: "guild-1", subjectUserId: "x".repeat(101), action: "export",
    })).rejects.toThrow("Member ID is invalid");
    await expect(service.preview({
      guildId: "guild-1", subjectUserId: "member-1", action: "remove" as "export",
    })).rejects.toThrow("must be export or departure");
    expect(reader.calls).toEqual([]);
  });
});
