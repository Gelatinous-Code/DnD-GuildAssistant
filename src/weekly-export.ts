import type {
  Assignment,
  PlanBundle,
  PlanTable,
  Signup,
  WeeklyEvent,
} from "./storage/repository";
import {
  WEEKLY_ROSTER_MAX_BYTES,
  WEEKLY_ROSTER_MAX_ROWS,
  WeeklyExportLimitError,
} from "./weekly-export-contract";

export {
  WEEKLY_ROSTER_MAX_ASSIGNMENTS,
  WEEKLY_ROSTER_MAX_BYTES,
  WEEKLY_ROSTER_MAX_ROWS,
  WEEKLY_ROSTER_MAX_TABLES,
  WeeklyExportLimitError,
  type WeeklyExportLimit,
} from "./weekly-export-contract";

export const WEEKLY_ROSTER_SCHEMA_VERSION = "weekly-roster-v2" as const;
export const WEEKLY_ROSTER_CONTENT_TYPE = "text/csv; charset=utf-8" as const;

export const WEEKLY_ROSTER_COLUMNS = [
  "schema_version",
  "guild_id",
  "event_id",
  "event_title",
  "event_starts_at",
  "event_ends_at",
  "event_status",
  "plan_id",
  "plan_generation",
  "plan_status",
  "algorithm_version",
  "user_id",
  "display_name",
  "signup_kind",
  "game_tier",
  "gm_commitment",
  "signup_status",
  "signup_source",
  "signed_up_at",
  "withdrawn_at",
  "signup_updated_at",
  "gm_selection_status",
  "assignment_status",
  "table_id",
  "desired_table_id",
  "table_number",
  "table_title",
  "table_capacity",
  "table_gm_user_id",
  "table_gm_display_name",
  "waitlist_position",
  "assigned_at",
  "assignment_updated_at",
] as const;

export type WeeklyRosterColumn = (typeof WEEKLY_ROSTER_COLUMNS)[number];

export interface WeeklyRosterSnapshot {
  event: WeeklyEvent;
  signups: readonly Signup[];
  planBundle: PlanBundle | null;
}

export interface WeeklyRosterCsvExport {
  schemaVersion: typeof WEEKLY_ROSTER_SCHEMA_VERSION;
  filename: string;
  contentType: typeof WEEKLY_ROSTER_CONTENT_TYPE;
  rowCount: number;
  byteLength: number;
  text: string;
  bytes: Uint8Array;
}

type GmSelectionStatus = "selected" | "unselected" | "not_planned" | "";

interface RosterRecord {
  signup: Signup;
  assignment: Assignment | null;
  table: PlanTable | null;
  gmSelectionStatus: GmSelectionStatus;
}

type WeeklyRosterRow = Record<WeeklyRosterColumn, string>;

const FORMULA_PREFIX_AFTER_IGNORABLES =
  /^[\p{White_Space}\p{Cc}\p{Cf}]*[=+\-@]/u;

/**
 * Prefix fields that spreadsheet applications could interpret as formulas.
 * Detection deliberately looks through leading whitespace and control/format
 * characters, which are commonly used to bypass a simple first-character test.
 */
export function neutralizeSpreadsheetFormula(value: string): string {
  return FORMULA_PREFIX_AFTER_IGNORABLES.test(value) ? `'${value}` : value;
}

function csvCell(value: string): string {
  const safe = neutralizeSpreadsheetFormula(value);
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function csvRecord(values: readonly string[]): string {
  return values.map(csvCell).join(",");
}

function timestamp(value: number | null): string {
  if (value === null) return "";
  return new Date(value).toISOString();
}

function numberCell(value: number | null): string {
  return value === null ? "" : String(value);
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function assignmentRank(record: RosterRecord): number {
  if (record.signup.signupKind === "gm") {
    if (record.gmSelectionStatus === "selected") return 0;
    if (record.gmSelectionStatus === "unselected") return 1;
    return 2;
  }

  switch (record.assignment?.status) {
    case "assigned":
      return 0;
    case "waitlisted":
      return 1;
    case "unassigned":
      return 2;
    case "withdrawn":
      return 3;
    default:
      return record.signup.status === "withdrawn" ? 3 : 2;
  }
}

function compareRecords(left: RosterRecord, right: RosterRecord): number {
  const kind =
    Number(left.signup.signupKind === "player") -
    Number(right.signup.signupKind === "player");
  if (kind !== 0) return kind;

  const signupStatus =
    Number(left.signup.status === "withdrawn") -
    Number(right.signup.status === "withdrawn");
  if (signupStatus !== 0) return signupStatus;

  const rank = assignmentRank(left) - assignmentRank(right);
  if (rank !== 0) return rank;

  const tableNumber =
    (left.table?.tableNumber ?? Number.MAX_SAFE_INTEGER) -
    (right.table?.tableNumber ?? Number.MAX_SAFE_INTEGER);
  if (tableNumber !== 0) return tableNumber;

  const waitlistPosition =
    (left.assignment?.waitlistPosition ?? Number.MAX_SAFE_INTEGER) -
    (right.assignment?.waitlistPosition ?? Number.MAX_SAFE_INTEGER);
  if (waitlistPosition !== 0) return waitlistPosition;

  const displayName = compareText(left.signup.displayName, right.signup.displayName);
  if (displayName !== 0) return displayName;

  return compareText(left.signup.userId, right.signup.userId);
}

function indexUnique<T>(
  values: readonly T[],
  key: (value: T) => string,
  label: string,
): Map<string, T> {
  const indexed = new Map<string, T>();
  for (const value of values) {
    const id = key(value);
    if (indexed.has(id)) {
      throw new Error(`Weekly roster snapshot contains duplicate ${label} ${id}.`);
    }
    indexed.set(id, value);
  }
  return indexed;
}

function rosterRecords(snapshot: WeeklyRosterSnapshot): RosterRecord[] {
  const { event, signups, planBundle } = snapshot;
  if (signups.length > WEEKLY_ROSTER_MAX_ROWS) {
    throw new WeeklyExportLimitError(
      "rows",
      WEEKLY_ROSTER_MAX_ROWS,
      signups.length,
    );
  }

  const signupsByUser = indexUnique(signups, (signup) => signup.userId, "signup for user");
  for (const signup of signupsByUser.values()) {
    if (signup.eventId !== event.eventId) {
      throw new Error(
        `Signup for user ${signup.userId} belongs to a different weekly event.`,
      );
    }
  }

  if (!planBundle) {
    return [...signupsByUser.values()]
      .map((signup) => ({
        signup,
        assignment: null,
        table: null,
        gmSelectionStatus:
          signup.signupKind === "gm" ? ("not_planned" as const) : ("" as const),
      }))
      .sort(compareRecords);
  }

  if (planBundle.plan.eventId !== event.eventId) {
    throw new Error("The plan bundle belongs to a different weekly event.");
  }

  const tablesById = indexUnique(planBundle.tables, (table) => table.tableId, "table");
  const assignmentsByUser = indexUnique(
    planBundle.assignments,
    (assignment) => assignment.userId,
    "assignment for user",
  );
  const selectedTableByGm = indexUnique(
    planBundle.tables,
    (table) => table.gmUserId,
    "selected GM",
  );

  for (const table of tablesById.values()) {
    if (table.planId !== planBundle.plan.planId) {
      throw new Error(`Table ${table.tableId} belongs to a different plan.`);
    }
  }
  for (const assignment of assignmentsByUser.values()) {
    if (assignment.planId !== planBundle.plan.planId) {
      throw new Error(`Assignment ${assignment.assignmentId} belongs to a different plan.`);
    }
    for (const tableId of [assignment.tableId, assignment.desiredTableId]) {
      if (tableId !== null && !tablesById.has(tableId)) {
        throw new Error(
          `Assignment ${assignment.assignmentId} references missing table ${tableId}.`,
        );
      }
    }
  }

  return [...signupsByUser.values()]
    .map((signup): RosterRecord => {
      if (signup.signupKind === "gm") {
        const table = selectedTableByGm.get(signup.userId) ?? null;
        return {
          signup,
          assignment: null,
          table,
          gmSelectionStatus: table ? "selected" : "unselected",
        };
      }

      const assignment = assignmentsByUser.get(signup.userId) ?? null;
      const associatedTableId = assignment?.tableId ?? assignment?.desiredTableId;
      return {
        signup,
        assignment,
        table: associatedTableId ? (tablesById.get(associatedTableId) ?? null) : null,
        gmSelectionStatus: "",
      };
    })
    .sort(compareRecords);
}

function rowFor(snapshot: WeeklyRosterSnapshot, record: RosterRecord): WeeklyRosterRow {
  const { event, planBundle } = snapshot;
  const { signup, assignment, table } = record;
  const assignmentStatus =
    signup.signupKind === "player"
      ? (assignment?.status ?? (signup.status === "withdrawn" ? "withdrawn" : "unassigned"))
      : "";

  return {
    schema_version: WEEKLY_ROSTER_SCHEMA_VERSION,
    guild_id: event.guildId,
    event_id: event.eventId,
    event_title: event.title,
    event_starts_at: timestamp(event.startsAt),
    event_ends_at: timestamp(event.endsAt),
    event_status: event.status,
    plan_id: planBundle?.plan.planId ?? "",
    plan_generation: planBundle ? String(planBundle.plan.generation) : "",
    plan_status: planBundle?.plan.status ?? "",
    algorithm_version: planBundle?.plan.algorithmVersion ?? "",
    user_id: signup.userId,
    display_name: signup.displayName,
    signup_kind: signup.signupKind,
    game_tier: signup.gameTier === null ? "" : String(signup.gameTier),
    gm_commitment: signup.gmCommitment ?? "",
    signup_status: signup.status,
    signup_source: signup.source,
    signed_up_at: timestamp(signup.signedUpAt),
    withdrawn_at: timestamp(signup.withdrawnAt),
    signup_updated_at: timestamp(signup.updatedAt),
    gm_selection_status: record.gmSelectionStatus,
    assignment_status: assignmentStatus,
    table_id:
      signup.signupKind === "gm" ? (table?.tableId ?? "") : (assignment?.tableId ?? ""),
    desired_table_id:
      signup.signupKind === "player" ? (assignment?.desiredTableId ?? "") : "",
    table_number: numberCell(table?.tableNumber ?? null),
    table_title: table?.title ?? "",
    table_capacity: numberCell(table?.capacity ?? null),
    table_gm_user_id: table?.gmUserId ?? "",
    table_gm_display_name: table?.gmDisplayName ?? "",
    waitlist_position: numberCell(assignment?.waitlistPosition ?? null),
    assigned_at: timestamp(assignment?.assignedAt ?? null),
    assignment_updated_at: timestamp(assignment?.updatedAt ?? null),
  };
}

function safeFilenameSegment(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "event"
  );
}

export function weeklyRosterFilename(event: WeeklyEvent): string {
  const date = new Date(event.startsAt).toISOString().slice(0, 10);
  return `weekly-roster-${date}-${safeFilenameSegment(event.eventId)}.csv`;
}

/** Generate a bounded RFC 4180 CSV snapshot without storing or uploading it. */
export function generateWeeklyRosterCsv(
  snapshot: WeeklyRosterSnapshot,
): WeeklyRosterCsvExport {
  const records = rosterRecords(snapshot);
  const lines = [
    csvRecord(WEEKLY_ROSTER_COLUMNS),
    ...records.map((record) => {
      const row = rowFor(snapshot, record);
      return csvRecord(WEEKLY_ROSTER_COLUMNS.map((column) => row[column]));
    }),
  ];
  const text = `${lines.join("\r\n")}\r\n`;
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > WEEKLY_ROSTER_MAX_BYTES) {
    throw new WeeklyExportLimitError(
      "bytes",
      WEEKLY_ROSTER_MAX_BYTES,
      bytes.byteLength,
    );
  }

  return {
    schemaVersion: WEEKLY_ROSTER_SCHEMA_VERSION,
    filename: weeklyRosterFilename(snapshot.event),
    contentType: WEEKLY_ROSTER_CONTENT_TYPE,
    rowCount: records.length,
    byteLength: bytes.byteLength,
    text,
    bytes,
  };
}
