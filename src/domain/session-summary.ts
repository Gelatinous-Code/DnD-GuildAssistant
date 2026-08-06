export const SUMMARY_DUE_AFTER_MS = 72 * 60 * 60 * 1_000;
export const SUMMARY_REMINDER_AFTER_MS = 48 * 60 * 60 * 1_000;
export const SUMMARY_MIN_REMINDER_AFTER_PROMPT_MS = 24 * 60 * 60 * 1_000;
export const SUMMARY_EDIT_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;

export interface SessionSummaryFields {
  summaryText: string;
  area: string;
  importantEvents: string | null;
  bonusRewards: string | null;
  otherNotes: string | null;
}

function normalizeRequired(value: string, label: string, maximum: number): string {
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (!normalized) throw new TypeError(`${label} is required`);
  if (normalized.length > maximum) {
    throw new RangeError(`${label} cannot exceed ${maximum} characters`);
  }
  return normalized;
}

function normalizeOptional(value: string | null | undefined, label: string, maximum: number) {
  const normalized = value?.replace(/\r\n?/g, "\n").trim() ?? "";
  if (!normalized) return null;
  if (normalized.length > maximum) {
    throw new RangeError(`${label} cannot exceed ${maximum} characters`);
  }
  return normalized;
}

export function validateSessionSummaryFields(input: {
  summaryText: string;
  area: string;
  importantEvents?: string | null;
  bonusRewards?: string | null;
  otherNotes?: string | null;
}): SessionSummaryFields {
  return {
    summaryText: normalizeRequired(input.summaryText, "Summary", 2_000),
    area: normalizeRequired(input.area, "Area", 200),
    importantEvents: normalizeOptional(input.importantEvents, "Important events", 1_500),
    bonusRewards: normalizeOptional(input.bonusRewards, "Bonus gold or items", 1_000),
    otherNotes: normalizeOptional(input.otherNotes, "Other notes", 1_000),
  };
}

export function summarySchedule(sessionEndsAt: number) {
  if (!Number.isSafeInteger(sessionEndsAt) || sessionEndsAt < 0) {
    throw new RangeError("sessionEndsAt must be a non-negative timestamp");
  }
  return {
    reminderAt: sessionEndsAt + SUMMARY_REMINDER_AFTER_MS,
    dueAt: sessionEndsAt + SUMMARY_DUE_AFTER_MS,
  };
}
