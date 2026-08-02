import { describe, expect, it, vi } from "vitest";
import { PrioritySeatingRepository } from "../src/storage/priority-seating-repository";

function repositoryWithoutDatabaseAccess(): {
  repository: PrioritySeatingRepository;
  prepare: ReturnType<typeof vi.fn>;
} {
  const prepare = vi.fn(() => {
    throw new Error("validation unexpectedly reached D1");
  });
  const database = { prepare } as unknown as D1Database;
  return {
    repository: new PrioritySeatingRepository(database, () => 1_000),
    prepare,
  };
}

describe("PrioritySeatingRepository input validation", () => {
  it("rejects an empty selection identifier before opening a D1 transaction", async () => {
    const { repository, prepare } = repositoryWithoutDatabaseAccess();

    await expect(repository.selectTableWithPriority({
      guildId: "guild",
      eventId: "event",
      planId: "plan",
      tableId: "table",
      userId: "   ",
      actorUserId: "member",
      operationKey: "select:member",
    })).rejects.toThrow(new TypeError("userId cannot be empty"));
    expect(prepare).not.toHaveBeenCalled();
  });

  it("validates optional stale-confirmation identities and versions before D1", async () => {
    const { repository, prepare } = repositoryWithoutDatabaseAccess();
    const input = {
      guildId: "guild",
      eventId: "event",
      planId: "plan",
      tableId: "table",
      userId: "member",
      actorUserId: "member",
      operationKey: "select:member",
    };

    await expect(repository.selectTableWithPriority({
      ...input,
      expectedAssignmentId: " ",
    })).rejects.toThrow(new TypeError("expectedAssignmentId cannot be empty"));
    await expect(repository.selectTableWithPriority({
      ...input,
      expectedCreditId: " ",
    })).rejects.toThrow(new TypeError("expectedCreditId cannot be empty"));
    await expect(repository.selectTableWithPriority({
      ...input,
      expectedSeatRequestVersion: -1,
    })).rejects.toThrow(
      new RangeError("expectedSeatRequestVersion must be a non-negative safe integer"),
    );
    await expect(repository.selectTableWithPriority({
      ...input,
      expectedTableStateVersion: 1.5,
    })).rejects.toThrow(
      new RangeError("expectedTableStateVersion must be a non-negative safe integer"),
    );
    expect(prepare).not.toHaveBeenCalled();
  });

  it("requires an auditable reason before releasing priority", async () => {
    const { repository, prepare } = repositoryWithoutDatabaseAccess();

    await expect(repository.releasePriority({
      guildId: "guild",
      eventId: "event",
      planId: "plan",
      userId: "member",
      actorUserId: "member",
      reason: " x ",
      operationKey: "release:member",
    })).rejects.toThrow(new RangeError("reason must contain 3 through 1000 characters"));
    expect(prepare).not.toHaveBeenCalled();
  });

  it("rejects oversized administrator correction reasons before D1 access", async () => {
    const { repository, prepare } = repositoryWithoutDatabaseAccess();

    await expect(repository.cancelEvent({
      guildId: "guild",
      eventId: "event",
      planId: "plan",
      actorUserId: "organizer",
      reason: "x".repeat(1_001),
      operationKey: "cancel:event",
    })).rejects.toThrow(new RangeError("reason must contain 3 through 1000 characters"));
    expect(prepare).not.toHaveBeenCalled();
  });
});
