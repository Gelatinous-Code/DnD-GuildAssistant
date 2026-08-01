import { describe, expect, it } from "vitest";

import type {
  Assignment,
  Plan,
  PlanBundle,
  PlanTable,
  Signup,
  WeeklyEvent,
} from "../src/storage/repository";
import {
  generateWeeklyRosterCsv,
  neutralizeSpreadsheetFormula,
  WEEKLY_ROSTER_COLUMNS,
  WEEKLY_ROSTER_MAX_BYTES,
  WEEKLY_ROSTER_MAX_ROWS,
  WEEKLY_ROSTER_SCHEMA_VERSION,
  WeeklyExportLimitError,
  weeklyRosterFilename,
  type WeeklyRosterSnapshot,
} from "../src/weekly-export";

const START = Date.UTC(2026, 7, 9, 1, 0, 0);
const NOW = Date.UTC(2026, 7, 1, 12, 0, 0);

function event(overrides: Partial<WeeklyEvent> = {}): WeeklyEvent {
  return {
    eventId: "event/weekly:42",
    guildId: "guild-1",
    title: "New Dawn weekly games",
    startsAt: START,
    endsAt: START + 4 * 60 * 60_000,
    signupOpensAt: START - 7 * 24 * 60 * 60_000,
    signupLocksAt: START - 24 * 60 * 60_000,
    tableSelectionClosesAt: START,
    reminderAt: null,
    status: "published",
    source: "native",
    sourceExternalId: null,
    signupChannelId: "channel-signups",
    signupMessageId: "message-signups",
    tableChannelId: "channel-tables",
    tableMessageId: "message-table-1",
    finalManifestChannelId: null,
    finalManifestMessageId: null,
    tableStateVersion: 0,
    finalizedPlanId: null,
    finalizedTableStateVersion: null,
    tablesFinalizedAt: null,
    createdByUserId: "admin-1",
    createdAt: NOW,
    updatedAt: NOW,
    publishedAt: NOW,
    archivedAt: null,
    ...overrides,
  };
}

function signup(
  userId: string,
  displayName: string,
  signupKind: "gm" | "player",
  overrides: Partial<Signup> = {},
): Signup {
  return {
    eventId: "event/weekly:42",
    userId,
    displayName,
    signupKind,
    status: "active",
    source: "native",
    sourceExternalId: null,
    signedUpAt: NOW,
    withdrawnAt: null,
    updatedAt: NOW,
    ...overrides,
  };
}

function plan(): Plan {
  return {
    planId: "plan-2",
    eventId: "event/weekly:42",
    generation: 2,
    status: "published",
    algorithmVersion: "deterministic-v1",
    minTableSize: 4,
    preferredTableSize: 6,
    maxTableSize: 6,
    playerCount: 4,
    gmSignupCount: 3,
    selectedGmCount: 2,
    waitlistCount: 1,
    createdByUserId: "admin-1",
    createdAt: NOW,
    publishedAt: NOW,
  };
}

function table(
  tableId: string,
  tableNumber: number,
  gmUserId: string,
  gmDisplayName: string,
  title: string,
): PlanTable {
  return {
    tableId,
    planId: "plan-2",
    tableNumber,
    title,
    capacity: 4,
    gmUserId,
    gmDisplayName,
    channelId: "channel-tables",
    messageId: `message-${tableNumber}`,
    createdAt: NOW,
  };
}

function assignment(
  userId: string,
  displayName: string,
  status: Assignment["status"],
  overrides: Partial<Assignment> = {},
): Assignment {
  return {
    assignmentId: `assignment-${userId}`,
    planId: "plan-2",
    tableId: null,
    desiredTableId: null,
    userId,
    displayName,
    status,
    waitlistPosition: null,
    assignedAt: null,
    updatedAt: NOW,
    ...overrides,
  };
}

function snapshot(): WeeklyRosterSnapshot {
  const signups = [
    signup("player-withdrawn", "Wren", "player", {
      status: "withdrawn",
      withdrawnAt: NOW + 5,
    }),
    signup("gm-unselected", "Cyra", "gm"),
    signup("player-waitlisted", "Yara", "player"),
    signup("gm-2", "Borin", "gm"),
    signup("player-unassigned", "Uma", "player"),
    signup("gm-1", "Ada", "gm"),
    signup("player-assigned", "Pax", "player"),
  ];
  const tables = [
    table("table-2", 2, "gm-2", "Borin", "Mystery"),
    table("table-1", 1, "gm-1", "Ada", "Adventure"),
  ];
  const assignments = [
    assignment("player-waitlisted", "Yara", "waitlisted", {
      desiredTableId: "table-2",
      waitlistPosition: 1,
    }),
    assignment("player-withdrawn", "Wren", "withdrawn"),
    assignment("player-assigned", "Pax", "assigned", {
      tableId: "table-1",
      desiredTableId: "table-1",
      assignedAt: NOW + 1,
    }),
    assignment("player-unassigned", "Uma", "unassigned"),
  ];

  return {
    event: event(),
    signups,
    planBundle: { plan: plan(), tables, assignments },
  };
}

function simpleRows(csv: string): string[][] {
  return csv
    .slice(0, -2)
    .split("\r\n")
    .map((line) => line.split(","));
}

describe("weekly roster CSV", () => {
  it("exports one deterministic row per signup with GM and player state", () => {
    const input = snapshot();
    const first = generateWeeklyRosterCsv(input);
    const reversed = generateWeeklyRosterCsv({
      ...input,
      signups: [...input.signups].reverse(),
      planBundle: {
        ...input.planBundle!,
        tables: [...input.planBundle!.tables].reverse(),
        assignments: [...input.planBundle!.assignments].reverse(),
      },
    });

    expect(first.schemaVersion).toBe(WEEKLY_ROSTER_SCHEMA_VERSION);
    expect(first.rowCount).toBe(input.signups.length);
    expect(first.text).toBe(reversed.text);
    expect([...first.bytes]).toEqual([...new TextEncoder().encode(first.text)]);
    expect(first.byteLength).toBe(first.bytes.byteLength);
    expect(first.text.endsWith("\r\n")).toBe(true);
    expect(first.text.replaceAll("\r\n", "")).not.toContain("\n");

    const [header, ...rows] = simpleRows(first.text);
    expect(header).toEqual(WEEKLY_ROSTER_COLUMNS);
    const columns = new Map(header.map((name, index) => [name, index]));
    const value = (row: string[], name: string) => row[columns.get(name)!];
    const byUser = new Map(rows.map((row) => [value(row, "user_id"), row]));

    expect(value(byUser.get("gm-1")!, "gm_selection_status")).toBe("selected");
    expect(value(byUser.get("gm-1")!, "table_id")).toBe("table-1");
    expect(value(byUser.get("gm-unselected")!, "gm_selection_status")).toBe(
      "unselected",
    );
    expect(value(byUser.get("player-assigned")!, "assignment_status")).toBe(
      "assigned",
    );
    expect(value(byUser.get("player-assigned")!, "table_title")).toBe("Adventure");
    expect(value(byUser.get("player-waitlisted")!, "assignment_status")).toBe(
      "waitlisted",
    );
    expect(value(byUser.get("player-waitlisted")!, "table_id")).toBe("");
    expect(value(byUser.get("player-waitlisted")!, "desired_table_id")).toBe(
      "table-2",
    );
    expect(value(byUser.get("player-waitlisted")!, "waitlist_position")).toBe("1");
    expect(value(byUser.get("player-unassigned")!, "assignment_status")).toBe(
      "unassigned",
    );
    expect(value(byUser.get("player-withdrawn")!, "assignment_status")).toBe(
      "withdrawn",
    );
  });

  it("represents an unplanned snapshot without inventing GM selections", () => {
    const result = generateWeeklyRosterCsv({
      event: event({ status: "open" }),
      signups: [signup("gm-1", "Ada", "gm"), signup("player-1", "Pax", "player")],
      planBundle: null,
    });

    expect(result.text).toContain(",gm,active,native,");
    expect(result.text).toContain(",not_planned,,");
    expect(result.text).toContain(",,unassigned,");
  });

  it("quotes RFC 4180 fields and neutralizes formulas after ignorable prefixes", () => {
    expect(neutralizeSpreadsheetFormula("=1+1")).toBe("'=1+1");
    expect(neutralizeSpreadsheetFormula(" \t@SUM(A1:A2)")).toBe("' \t@SUM(A1:A2)");
    expect(neutralizeSpreadsheetFormula("\u200b-2+3")).toBe("'\u200b-2+3");
    expect(neutralizeSpreadsheetFormula("ordinary")).toBe("ordinary");

    const result = generateWeeklyRosterCsv({
      event: event({ title: " \t=HYPERLINK(\"bad\"), weekly" }),
      signups: [signup("player-1", "Zoë, \"Z\"\r\n@danger", "player")],
      planBundle: null,
    });

    expect(result.text).toContain('"\' \t=HYPERLINK(""bad""), weekly"');
    expect(result.text).toContain('"Zoë, ""Z""\r\n@danger"');
    expect(new TextDecoder().decode(result.bytes)).toBe(result.text);
  });

  it("rejects row and encoded-byte limits", () => {
    const tooMany = Array.from({ length: WEEKLY_ROSTER_MAX_ROWS + 1 }, (_, index) =>
      signup(`player-${index}`, `Player ${index}`, "player"),
    );
    expect(() =>
      generateWeeklyRosterCsv({ event: event(), signups: tooMany, planBundle: null }),
    ).toThrowError(
      expect.objectContaining<Partial<WeeklyExportLimitError>>({
        limit: "rows",
        maximum: WEEKLY_ROSTER_MAX_ROWS,
      }),
    );

    expect(() =>
      generateWeeklyRosterCsv({
        event: event(),
        signups: [signup("player-1", "x".repeat(WEEKLY_ROSTER_MAX_BYTES), "player")],
        planBundle: null,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<WeeklyExportLimitError>>({
        limit: "bytes",
        maximum: WEEKLY_ROSTER_MAX_BYTES,
      }),
    );
  });

  it("rejects cross-event and internally inconsistent snapshots", () => {
    expect(() =>
      generateWeeklyRosterCsv({
        event: event(),
        signups: [signup("player-1", "Pax", "player", { eventId: "other-event" })],
        planBundle: null,
      }),
    ).toThrow("belongs to a different weekly event");

    const input = snapshot();
    const inconsistentBundle: PlanBundle = {
      ...input.planBundle!,
      plan: { ...input.planBundle!.plan, eventId: "other-event" },
    };
    expect(() =>
      generateWeeklyRosterCsv({ ...input, planBundle: inconsistentBundle }),
    ).toThrow("plan bundle belongs to a different weekly event");
  });

  it("creates a stable, filesystem-safe filename", () => {
    expect(weeklyRosterFilename(event())).toBe(
      "weekly-roster-2026-08-09-event-weekly-42.csv",
    );
  });
});
