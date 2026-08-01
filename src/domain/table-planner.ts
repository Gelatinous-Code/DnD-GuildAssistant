export interface PlayerCandidate {
  readonly userId: string;
  readonly signedUpAt: number;
  readonly displayName?: string;
}

export interface GmCandidate extends PlayerCandidate {
  readonly selectionCount: number;
  readonly lastSelectedAt?: number | null;
}

export interface TableConstraints {
  readonly minPlayersPerTable: number;
  readonly preferredPlayersPerTable: number;
  readonly maxPlayersPerTable: number;
}

export interface TablePlanningInput {
  readonly players: readonly PlayerCandidate[];
  readonly gms: readonly GmCandidate[];
  readonly constraints?: Partial<TableConstraints>;
}

export interface PlannedTable {
  readonly tableNumber: number;
  readonly gm: GmCandidate;
  /** The number of player seats this plan publishes for the table. */
  readonly capacity: number;
  readonly players: readonly PlayerCandidate[];
  readonly isUnderfilled: boolean;
  readonly isBelowPreferred: boolean;
}

export interface TablePlan {
  readonly constraints: TableConstraints;
  readonly tables: readonly PlannedTable[];
  readonly selectedGms: readonly GmCandidate[];
  readonly unselectedGms: readonly GmCandidate[];
  readonly waitlist: readonly PlayerCandidate[];
  readonly rationale: string;
}

export const DEFAULT_TABLE_CONSTRAINTS: TableConstraints = {
  minPlayersPerTable: 4,
  preferredPlayersPerTable: 6,
  maxPlayersPerTable: 6,
};

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareNumbers(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Orders GMs from highest to lowest priority.
 *
 * Priority is deliberately deterministic: fewest previous selections, longest
 * since last selected (never selected first), earliest signup, then Discord ID.
 */
export function compareGmPriority(left: GmCandidate, right: GmCandidate): number {
  const bySelectionCount = compareNumbers(left.selectionCount, right.selectionCount);
  if (bySelectionCount !== 0) return bySelectionCount;

  const leftLastSelected = left.lastSelectedAt ?? Number.NEGATIVE_INFINITY;
  const rightLastSelected = right.lastSelectedAt ?? Number.NEGATIVE_INFINITY;
  const byLastSelected = compareNumbers(leftLastSelected, rightLastSelected);
  if (byLastSelected !== 0) return byLastSelected;

  const bySignup = compareNumbers(left.signedUpAt, right.signedUpAt);
  if (bySignup !== 0) return bySignup;

  return compareStrings(left.userId, right.userId);
}

export function rankGmCandidates(gms: readonly GmCandidate[]): GmCandidate[] {
  return [...gms].sort(compareGmPriority);
}

function comparePlayerSignup(left: PlayerCandidate, right: PlayerCandidate): number {
  const bySignup = compareNumbers(left.signedUpAt, right.signedUpAt);
  if (bySignup !== 0) return bySignup;
  return compareStrings(left.userId, right.userId);
}

function assertPositiveInteger(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${fieldName} must be a positive integer.`);
  }
}

function assertTimestamp(value: number, fieldName: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${fieldName} must be a non-negative finite timestamp.`);
  }
}

function resolveConstraints(overrides?: Partial<TableConstraints>): TableConstraints {
  const constraints: TableConstraints = {
    ...DEFAULT_TABLE_CONSTRAINTS,
    ...overrides,
  };

  assertPositiveInteger(constraints.minPlayersPerTable, "minPlayersPerTable");
  assertPositiveInteger(constraints.preferredPlayersPerTable, "preferredPlayersPerTable");
  assertPositiveInteger(constraints.maxPlayersPerTable, "maxPlayersPerTable");

  if (constraints.minPlayersPerTable > constraints.preferredPlayersPerTable) {
    throw new RangeError("minPlayersPerTable cannot exceed preferredPlayersPerTable.");
  }
  if (constraints.preferredPlayersPerTable > constraints.maxPlayersPerTable) {
    throw new RangeError("preferredPlayersPerTable cannot exceed maxPlayersPerTable.");
  }

  return constraints;
}

function validateCandidates(
  players: readonly PlayerCandidate[],
  gms: readonly GmCandidate[],
): void {
  const playerIds = new Set<string>();
  for (const player of players) {
    if (player.userId.length === 0) throw new TypeError("Player userId cannot be empty.");
    if (playerIds.has(player.userId)) {
      throw new TypeError(`Duplicate player userId: ${player.userId}`);
    }
    playerIds.add(player.userId);
    assertTimestamp(player.signedUpAt, `Player ${player.userId} signedUpAt`);
  }

  const gmIds = new Set<string>();
  for (const gm of gms) {
    if (gm.userId.length === 0) throw new TypeError("GM userId cannot be empty.");
    if (gmIds.has(gm.userId)) throw new TypeError(`Duplicate GM userId: ${gm.userId}`);
    gmIds.add(gm.userId);
    assertTimestamp(gm.signedUpAt, `GM ${gm.userId} signedUpAt`);
    if (!Number.isInteger(gm.selectionCount) || gm.selectionCount < 0) {
      throw new RangeError(`GM ${gm.userId} selectionCount must be a non-negative integer.`);
    }
    if (gm.lastSelectedAt !== undefined && gm.lastSelectedAt !== null) {
      assertTimestamp(gm.lastSelectedAt, `GM ${gm.userId} lastSelectedAt`);
    }
  }
}

function determineTableCount(
  playerCount: number,
  gmCount: number,
  minPlayersPerTable: number,
): number {
  if (playerCount === 0 || gmCount === 0) return 0;

  // One underfilled draft is still useful to an admin; additional tables are
  // only viable when every table can meet the configured minimum.
  if (playerCount < minPlayersPerTable) return 1;

  return Math.min(gmCount, Math.floor(playerCount / minPlayersPerTable));
}

function balancedPlayerCounts(
  assignablePlayerCount: number,
  tableCount: number,
): number[] {
  if (tableCount === 0) return [];

  const baseSize = Math.floor(assignablePlayerCount / tableCount);
  const remainder = assignablePlayerCount % tableCount;
  return Array.from({ length: tableCount }, (_, index) =>
    baseSize + (index < remainder ? 1 : 0),
  );
}

/**
 * Creates a deterministic weekly table plan without mutating the supplied
 * signup arrays. Players are assigned in signup order across tables, while
 * overflow remains in the same order on the waitlist.
 */
export function planTables(input: TablePlanningInput): TablePlan {
  const constraints = resolveConstraints(input.constraints);
  validateCandidates(input.players, input.gms);

  const rankedGms = rankGmCandidates(input.gms);
  const rankedPlayers = [...input.players].sort(comparePlayerSignup);
  const tableCount = determineTableCount(
    rankedPlayers.length,
    rankedGms.length,
    constraints.minPlayersPerTable,
  );
  const assignablePlayerCount = Math.min(
    rankedPlayers.length,
    tableCount * constraints.maxPlayersPerTable,
  );
  const selectedGms = rankedGms.slice(0, tableCount);
  const unselectedGms = rankedGms.slice(tableCount);
  const assignedPlayers = rankedPlayers.slice(0, assignablePlayerCount);
  const waitlist = rankedPlayers.slice(assignablePlayerCount);
  const targetCounts = balancedPlayerCounts(assignablePlayerCount, tableCount);
  const playersByTable = targetCounts.map(() => [] as PlayerCandidate[]);

  // Round-robin assignment spreads early signups evenly while targetCounts
  // ensures earlier tables receive at most one additional player.
  for (let playerIndex = 0; playerIndex < assignedPlayers.length; playerIndex += 1) {
    const tableIndex = playerIndex % tableCount;
    playersByTable[tableIndex].push(assignedPlayers[playerIndex]);
  }

  const tables = selectedGms.map((gm, index): PlannedTable => {
    const players = playersByTable[index];
    const capacity = targetCounts[index];
    return {
      tableNumber: index + 1,
      gm,
      capacity,
      players,
      isUnderfilled: capacity < constraints.minPlayersPerTable,
      isBelowPreferred: capacity < constraints.preferredPlayersPerTable,
    };
  });

  const rationale =
    tableCount === 0
      ? rankedPlayers.length === 0
        ? "No tables were created because no players signed up."
        : "No tables were created because no GMs signed up; all players remain waitlisted."
      : "Selected " +
        tableCount +
        " of " +
        rankedGms.length +
        " available GMs for " +
        rankedPlayers.length +
        " players. Planned capacities are " +
        targetCounts.join(", ") +
        (waitlist.length
          ? "; " + waitlist.length + " players exceed available capacity."
          : "; every player fits within available capacity.");

  return {
    constraints,
    tables,
    selectedGms,
    unselectedGms,
    waitlist,
    rationale,
  };
}
