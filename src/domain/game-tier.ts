export const GAME_TIERS = [1, 2, 3] as const;

export type GameTier = (typeof GAME_TIERS)[number];

export function isGameTier(value: unknown): value is GameTier {
  return value === 1 || value === 2 || value === 3;
}

export interface GameTierDefinition {
  tier: GameTier;
  label: string;
  levelRange: string;
}

export const GAME_TIER_DEFINITIONS: readonly GameTierDefinition[] = [
  { tier: 1, label: "Tier 1", levelRange: "Levels 3–4" },
  { tier: 2, label: "Tier 2", levelRange: "Levels 5–7" },
  { tier: 3, label: "Tier 3", levelRange: "Levels 8+" },
];

export function gameTierDefinition(tier: GameTier): GameTierDefinition {
  return GAME_TIER_DEFINITIONS[tier - 1];
}

export function gameTierLabel(tier: GameTier | null | undefined): string {
  if (!isGameTier(tier)) return "Unclassified tier";
  const definition = gameTierDefinition(tier);
  return `${definition.label} · ${definition.levelRange}`;
}
