export type CharacterStatus = "pending" | "approved" | "revoked" | "archived";
export type CharacterProgressionState = "active" | "frozen";

export function normalizeCharacterName(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 80) {
    throw new TypeError("Character name must be between 1 and 80 characters");
  }
  return normalized;
}

export function normalizeOptionalCharacterText(
  value: string | null | undefined,
  fieldName: string,
  maxLength: number,
): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw new TypeError(`${fieldName} must be ${maxLength} characters or fewer`);
  }
  return normalized;
}

export function validateCharacterSheetUrl(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalCharacterText(value, "Character sheet URL", 500);
  if (normalized === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new TypeError("Character sheet URL must be a valid https:// URL");
  }
  if (parsed.protocol !== "https:") {
    throw new TypeError("Character sheet URL must be a valid https:// URL");
  }
  return parsed.toString();
}

export function validateOpeningBalance(value: number, fieldName: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${fieldName} must be a non-negative whole number`);
  }
  return value;
}
