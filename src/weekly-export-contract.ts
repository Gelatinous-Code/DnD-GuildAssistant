export const WEEKLY_ROSTER_MAX_ROWS = 2_000;
export const WEEKLY_ROSTER_MAX_ASSIGNMENTS = 2_000;
export const WEEKLY_ROSTER_MAX_TABLES = 25;
export const WEEKLY_ROSTER_MAX_BYTES = 512 * 1_024;

export type WeeklyExportLimit = "rows" | "assignments" | "tables" | "bytes";

export class WeeklyExportLimitError extends Error {
  constructor(
    readonly limit: WeeklyExportLimit,
    readonly maximum: number,
    readonly actual: number,
  ) {
    super(
      `Weekly roster export exceeds the ${limit} limit (${actual} > ${maximum}).`,
    );
    this.name = "WeeklyExportLimitError";
  }
}
