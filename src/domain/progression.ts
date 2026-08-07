export const PROGRESSION_POLICY_VERSION = "new-dawn-progression-v1";

export interface LevelBand {
  level: number;
  minimumXp: number;
  maximumXp: number | null;
  goldPerGame: number;
}

export interface LevelProgress {
  currentLevelMinimumXp: number;
  nextLevel: number | null;
  nextLevelMinimumXp: number | null;
  xpIntoLevel: number;
  xpRequiredForNextLevel: number | null;
  xpRemaining: number | null;
  isLevelCap: boolean;
}

export const LEVEL_BANDS: readonly LevelBand[] = [
  { level: 3, minimumXp: 0, maximumXp: 2, goldPerGame: 50 },
  { level: 4, minimumXp: 3, maximumXp: 6, goldPerGame: 100 },
  { level: 5, minimumXp: 7, maximumXp: 11, goldPerGame: 200 },
  { level: 6, minimumXp: 12, maximumXp: 17, goldPerGame: 300 },
  { level: 7, minimumXp: 18, maximumXp: 24, goldPerGame: 400 },
  { level: 8, minimumXp: 25, maximumXp: 32, goldPerGame: 600 },
  { level: 9, minimumXp: 33, maximumXp: 41, goldPerGame: 800 },
  { level: 10, minimumXp: 42, maximumXp: null, goldPerGame: 1_000 },
] as const;

export function levelForXp(xp: number): number {
  if (!Number.isSafeInteger(xp) || xp < 0) {
    throw new RangeError("XP must be a non-negative whole number");
  }
  return [...LEVEL_BANDS].reverse().find((band) => xp >= band.minimumXp)!.level;
}

export function levelProgressForXp(xp: number): LevelProgress {
  const level = levelForXp(xp);
  const bandIndex = LEVEL_BANDS.findIndex((band) => band.level === level);
  const band = LEVEL_BANDS[bandIndex]!;
  const nextBand = LEVEL_BANDS[bandIndex + 1] ?? null;
  const xpIntoLevel = xp - band.minimumXp;
  const xpRequiredForNextLevel = nextBand === null
    ? null
    : nextBand.minimumXp - band.minimumXp;
  return {
    currentLevelMinimumXp: band.minimumXp,
    nextLevel: nextBand?.level ?? null,
    nextLevelMinimumXp: nextBand?.minimumXp ?? null,
    xpIntoLevel,
    xpRequiredForNextLevel,
    xpRemaining: nextBand === null ? null : nextBand.minimumXp - xp,
    isLevelCap: nextBand === null,
  };
}

export function goldForXp(xp: number): number {
  const level = levelForXp(xp);
  return LEVEL_BANDS.find((band) => band.level === level)!.goldPerGame;
}

export function sessionXpForRole(role: "player" | "dm"): number {
  return role === "dm" ? 2 : 1;
}
