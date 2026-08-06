export interface HistoricalImportInput {
  csvText: string;
  identityMapping?: { version?: string; mappings?: Record<string, string> } | Record<string, string>;
  guildId: string;
  seasonLabel: string;
  sourceUrl: string;
  worksheetGid: string | number;
  retrievedAt: number;
  actorUserId: string;
  createdAt: number;
  contentChecksum?: string;
  mappingChecksum?: string;
  expectations?: { rows?: number; dates?: number; journalLinks?: number };
}

export interface HistoricalImportRecord {
  sourceRowNumber: number;
  sourceRowKey: string;
  gameDate: string;
  gmOriginal: string;
  gmNormalized: string;
  gmUserId: string | null;
  gameLocation: string;
  gameInfluence: string | null;
  officialSummary: string;
  playersOriginal: string | null;
  playerSummaryStatus: string | null;
  playerSummaryDate: string | null;
  playerSummaryUrl: string | null;
  identityStatus: "matched" | "unmatched";
  sourceValues: string[];
  rowChecksum: string;
  historicalRecordId: string;
}

export interface HistoricalImportReport {
  batchId: string;
  contentChecksum: string;
  mappingChecksum: string;
  sourceRows: number;
  distinctDates: number;
  journalLinkCount: number;
  unmatchedIdentityCount: number;
  normalizedGmCount: number;
  gmVariants: Record<string, string[]>;
  errors: Array<{ rowNumber: number | null; field: string; message: string }>;
  warnings: Array<{ rowNumber: number | null; field: string; message: string }>;
  valid: boolean;
}

export interface HistoricalImportPlan {
  batch: {
    batchId: string;
    guildId: string;
    seasonLabel: string;
    sourceUrl: string;
    worksheetGid: string;
    retrievedAt: number;
    contentChecksum: string;
    mappingVersion: string;
    mappingChecksum: string;
    status: "staged";
    createdByUserId: string;
    createdAt: number;
  };
  records: HistoricalImportRecord[];
  report: HistoricalImportReport;
}

export function sha256(value: string): string;
export function parseCsv(text: string): string[][];
export function normalizeIdentity(value: string): string;
export function buildHistoricalImport(input: HistoricalImportInput): HistoricalImportPlan;
export function historicalImportSql(plan: HistoricalImportPlan): string;
export function historicalImportLifecycleSql(input: {
  action: "publish" | "rollback" | "recover";
  guildId: string;
  batchId: string;
  actorUserId: string;
  reason: string;
  occurredAt: number;
}): string;
