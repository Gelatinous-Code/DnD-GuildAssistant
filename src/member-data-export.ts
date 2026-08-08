import { MEMBER_DATA_POLICY_VERSION, type MemberDataCounts } from "./domain/member-data-policy";

export const MEMBER_DATA_EXPORT_SCHEMA_VERSION = "member-data-export.v1" as const;
export const MEMBER_DATA_EXPORT_CONTENT_TYPE = "application/json; charset=utf-8" as const;
export const MEMBER_DATA_EXPORT_MAX_BYTES = 512 * 1024;
export const MEMBER_DATA_EXPORT_MAX_ROWS_PER_COLLECTION = 500;

export type MemberDataRecord = Record<string, unknown>;

export interface MemberDataExportCollections {
  characters: MemberDataRecord[];
  characterEvents: MemberDataRecord[];
  journals: MemberDataRecord[];
  journalRevisions: MemberDataRecord[];
  seasonalBalances: MemberDataRecord[];
  seasonOpenings: MemberDataRecord[];
  progressionEntries: MemberDataRecord[];
  shopReceipts: MemberDataRecord[];
  shopReceiptItems: MemberDataRecord[];
  shopReceiptEvents: MemberDataRecord[];
  officialRecaps: MemberDataRecord[];
  recapRevisions: MemberDataRecord[];
  weeklySignups: MemberDataRecord[];
  tableAssignments: MemberDataRecord[];
  sessionParticipationRecords: MemberDataRecord[];
  dmPriorityGrants: MemberDataRecord[];
  dmPriorityCredits: MemberDataRecord[];
  dmPriorityCreditEvents: MemberDataRecord[];
}

export interface MemberDataSnapshot {
  guildId: string;
  subjectUserId: string;
  counts: MemberDataCounts;
  collections: MemberDataExportCollections;
}

export interface MemberDataExportArtifact {
  schemaVersion: typeof MEMBER_DATA_EXPORT_SCHEMA_VERSION;
  policyVersion: typeof MEMBER_DATA_POLICY_VERSION;
  revision: string;
  filename: string;
  contentType: typeof MEMBER_DATA_EXPORT_CONTENT_TYPE;
  byteLength: number;
  recordCount: number;
  text: string;
}

export class MemberDataExportLimitError extends Error {
  constructor(
    readonly limit: "rows" | "bytes",
    readonly maximum: number,
    readonly actual: number,
    readonly collection?: string,
  ) {
    super(
      limit === "rows"
        ? `Member export collection ${collection ?? "unknown"} exceeds ${maximum} rows.`
        : `Member export exceeds ${maximum} bytes (${actual}).`,
    );
    this.name = "MemberDataExportLimitError";
  }
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function stableSnapshot(snapshot: MemberDataSnapshot): string {
  return JSON.stringify({
    guildId: snapshot.guildId,
    subjectUserId: snapshot.subjectUserId,
    counts: snapshot.counts,
    collections: snapshot.collections,
  });
}

export async function memberDataRevision(snapshot: MemberDataSnapshot): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(stableSnapshot(snapshot)),
  );
  return hex(digest);
}

export async function generateMemberDataExport(
  snapshot: MemberDataSnapshot,
  generatedAt: number,
): Promise<MemberDataExportArtifact> {
  const revision = await memberDataRevision(snapshot);
  const recordCount = Object.values(snapshot.collections)
    .reduce((total, rows) => total + rows.length, 0);
  const envelope = {
    schemaVersion: MEMBER_DATA_EXPORT_SCHEMA_VERSION,
    policyVersion: MEMBER_DATA_POLICY_VERSION,
    revision,
    generatedAt,
    guildId: snapshot.guildId,
    subjectUserId: snapshot.subjectUserId,
    notice: "Guild XP and gold are in-game values, not real money. Seasonal balances reset while ledger history is preserved.",
    counts: snapshot.counts,
    data: snapshot.collections,
  };
  const text = `${JSON.stringify(envelope, null, 2)}\n`;
  const byteLength = new TextEncoder().encode(text).byteLength;
  if (byteLength > MEMBER_DATA_EXPORT_MAX_BYTES) {
    throw new MemberDataExportLimitError(
      "bytes",
      MEMBER_DATA_EXPORT_MAX_BYTES,
      byteLength,
    );
  }
  return {
    schemaVersion: MEMBER_DATA_EXPORT_SCHEMA_VERSION,
    policyVersion: MEMBER_DATA_POLICY_VERSION,
    revision,
    filename: `member-data-${snapshot.subjectUserId}-${revision.slice(0, 12)}.json`,
    contentType: MEMBER_DATA_EXPORT_CONTENT_TYPE,
    byteLength,
    recordCount,
    text,
  };
}
