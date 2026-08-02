import { Temporal } from "@js-temporal/polyfill";

export const DM_PRIORITY_POLICY_VERSION = "dm-priority-v1";
export const DM_PRIORITY_TOKENS_PER_COMPLETED_SESSION = 2;

export interface DmPriorityExpiration {
  /** Exclusive UTC Unix epoch-millisecond boundary. */
  readonly expiresAt: number;
  /** Final eligible calendar date in the captured guild time zone. */
  readonly lastEligibleLocalDate: string;
  readonly timeZone: string;
}

export interface DmPriorityCreditCandidate {
  readonly creditId: string;
  readonly earnedAt: number;
  readonly expiresAt: number;
}

export interface DmPrioritySeatRequest {
  readonly userId: string;
  /** First successful request for the member's current table. */
  readonly tableRequestedAt: number;
  /** First successful confirmed token use for the current table, when present. */
  readonly priorityRequestedAt?: number | null;
}

export interface DmPrioritySeatAllocation<T extends DmPrioritySeatRequest> {
  readonly assigned: readonly T[];
  readonly waitlisted: readonly T[];
}

function compareNumbers(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertIdentifier(value: string, fieldName: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${fieldName} cannot be empty.`);
  }
}

function assertEpochMilliseconds(value: number, fieldName: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${fieldName} must be a non-negative safe-integer timestamp.`);
  }
  try {
    Temporal.Instant.fromEpochMilliseconds(value);
  } catch {
    throw new RangeError(`${fieldName} is outside the supported Temporal range.`);
  }
}

function assertIanaTimeZone(timeZone: string): void {
  if (
    typeof timeZone !== "string" ||
    timeZone.length === 0 ||
    timeZone.trim() !== timeZone ||
    /^[+-]\d{2}(?::?\d{2})/.test(timeZone)
  ) {
    throw new RangeError(`timeZone '${String(timeZone)}' is not a valid IANA time zone.`);
  }
  try {
    Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(timeZone);
  } catch {
    throw new RangeError(`timeZone '${timeZone}' is not a valid IANA time zone.`);
  }
}

/**
 * Calculates the v1 one-calendar-month token window.
 *
 * A token remains eligible through the constrained same-numbered local date in
 * the following month. The returned instant is midnight immediately after that
 * date and is therefore exclusive. The caller must persist both this instant
 * and the supplied guild time zone; later configuration changes cannot move it.
 */
export function calculateDmPriorityExpiration(
  earnedAt: number,
  timeZone: string,
): DmPriorityExpiration {
  assertEpochMilliseconds(earnedAt, "earnedAt");
  assertIanaTimeZone(timeZone);

  const earned = Temporal.Instant.fromEpochMilliseconds(earnedAt).toZonedDateTimeISO(timeZone);
  const lastEligibleDate = earned.toPlainDate().add({ months: 1 }, { overflow: "constrain" });
  const boundaryDate = lastEligibleDate.add({ days: 1 });
  const boundary = Temporal.ZonedDateTime.from(
    {
      timeZone,
      year: boundaryDate.year,
      month: boundaryDate.month,
      day: boundaryDate.day,
      hour: 0,
      minute: 0,
      second: 0,
      millisecond: 0,
    },
    { disambiguation: "compatible" },
  );

  return {
    expiresAt: boundary.epochMilliseconds,
    lastEligibleLocalDate: lastEligibleDate.toString(),
    timeZone,
  };
}

function validateCredit(credit: DmPriorityCreditCandidate): void {
  assertIdentifier(credit.creditId, "creditId");
  assertEpochMilliseconds(credit.earnedAt, `Credit ${credit.creditId} earnedAt`);
  assertEpochMilliseconds(credit.expiresAt, `Credit ${credit.creditId} expiresAt`);
  if (credit.expiresAt <= credit.earnedAt) {
    throw new RangeError(`Credit ${credit.creditId} expiresAt must be after earnedAt.`);
  }
}

function compareCreditsUnchecked(
  left: DmPriorityCreditCandidate,
  right: DmPriorityCreditCandidate,
): number {
  const byExpiry = compareNumbers(left.expiresAt, right.expiresAt);
  if (byExpiry !== 0) return byExpiry;
  const byEarned = compareNumbers(left.earnedAt, right.earnedAt);
  if (byEarned !== 0) return byEarned;
  return compareStrings(left.creditId, right.creditId);
}

/** Orders token candidates for earliest-expiry-first redemption. */
export function compareDmPriorityCredits(
  left: DmPriorityCreditCandidate,
  right: DmPriorityCreditCandidate,
): number {
  validateCredit(left);
  validateCredit(right);
  return compareCreditsUnchecked(left, right);
}

/**
 * A token is available from its earned instant until its exclusive expiry.
 * A use request must concern a game that has not started and that starts before
 * the same expiry boundary. Event phase and player-signup checks remain service
 * responsibilities.
 */
export function isDmPriorityCreditEligibleForGame(
  credit: DmPriorityCreditCandidate,
  now: number,
  targetGameStartsAt: number,
): boolean {
  validateCredit(credit);
  assertEpochMilliseconds(now, "now");
  assertEpochMilliseconds(targetGameStartsAt, "targetGameStartsAt");
  return (
    now >= credit.earnedAt &&
    now < credit.expiresAt &&
    targetGameStartsAt >= now &&
    targetGameStartsAt < credit.expiresAt
  );
}

/**
 * Returns the deterministic token to reserve, or null when none can cover the
 * target game. The input is validated and never mutated.
 */
export function selectEarliestExpiringDmPriorityCredit<
  T extends DmPriorityCreditCandidate,
>(
  credits: readonly T[],
  now: number,
  targetGameStartsAt: number,
): T | null {
  assertEpochMilliseconds(now, "now");
  assertEpochMilliseconds(targetGameStartsAt, "targetGameStartsAt");
  const ids = new Set<string>();
  for (const credit of credits) {
    validateCredit(credit);
    if (ids.has(credit.creditId)) {
      throw new TypeError(`Duplicate creditId: ${credit.creditId}`);
    }
    ids.add(credit.creditId);
  }

  return (
    credits
      .filter((credit) =>
        isDmPriorityCreditEligibleForGame(credit, now, targetGameStartsAt),
      )
      .sort(compareCreditsUnchecked)[0] ?? null
  );
}

function validateSeatRequest(request: DmPrioritySeatRequest): void {
  assertIdentifier(request.userId, "userId");
  assertEpochMilliseconds(
    request.tableRequestedAt,
    `Seat request ${request.userId} tableRequestedAt`,
  );
  if (request.priorityRequestedAt !== undefined && request.priorityRequestedAt !== null) {
    assertEpochMilliseconds(
      request.priorityRequestedAt,
      `Seat request ${request.userId} priorityRequestedAt`,
    );
  }
}

function compareSeatRequestsUnchecked(
  left: DmPrioritySeatRequest,
  right: DmPrioritySeatRequest,
): number {
  const leftPriority = left.priorityRequestedAt ?? null;
  const rightPriority = right.priorityRequestedAt ?? null;
  if (leftPriority !== null && rightPriority === null) return -1;
  if (leftPriority === null && rightPriority !== null) return 1;
  if (leftPriority !== null && rightPriority !== null) {
    const byPriorityRequest = compareNumbers(leftPriority, rightPriority);
    if (byPriorityRequest !== 0) return byPriorityRequest;
    return compareStrings(left.userId, right.userId);
  }

  const byTableRequest = compareNumbers(left.tableRequestedAt, right.tableRequestedAt);
  if (byTableRequest !== 0) return byTableRequest;
  return compareStrings(left.userId, right.userId);
}

/**
 * Priority requests rank before every standard request. Within each tier the
 * persisted request time wins and Discord user ID removes timestamp ties.
 */
export function compareDmPrioritySeatRequests(
  left: DmPrioritySeatRequest,
  right: DmPrioritySeatRequest,
): number {
  validateSeatRequest(left);
  validateSeatRequest(right);
  return compareSeatRequestsUnchecked(left, right);
}

export function rankDmPrioritySeatRequests<T extends DmPrioritySeatRequest>(
  requests: readonly T[],
): T[] {
  const userIds = new Set<string>();
  for (const request of requests) {
    validateSeatRequest(request);
    if (userIds.has(request.userId)) {
      throw new TypeError(`Duplicate seat request userId: ${request.userId}`);
    }
    userIds.add(request.userId);
  }
  return [...requests].sort(compareSeatRequestsUnchecked);
}

/**
 * Applies the policy ordering to one table without mutating the request list.
 * A newly confirmed priority request can therefore displace the lowest-ranked
 * assigned standard request while preserving one capacity-safe ordering.
 */
export function allocateDmPrioritySeats<T extends DmPrioritySeatRequest>(
  requests: readonly T[],
  capacity: number,
): DmPrioritySeatAllocation<T> {
  if (!Number.isSafeInteger(capacity) || capacity < 0) {
    throw new RangeError("capacity must be a non-negative safe integer.");
  }
  const ranked = rankDmPrioritySeatRequests(requests);
  return {
    assigned: ranked.slice(0, capacity),
    waitlisted: ranked.slice(capacity),
  };
}
