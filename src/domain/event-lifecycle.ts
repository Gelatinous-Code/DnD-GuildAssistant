export const EVENT_STATUSES = [
  "draft",
  "open",
  "locked",
  "planned",
  "published",
  "archived",
  "cancelled",
] as const;

export type EventStatus = (typeof EVENT_STATUSES)[number];

/**
 * Allowed state changes. Same-state retries are accepted separately as
 * idempotent operations and therefore are not repeated in this map.
 */
export const ALLOWED_EVENT_TRANSITIONS: Readonly<
  Record<EventStatus, readonly EventStatus[]>
> = {
  draft: ["open", "cancelled"],
  open: ["locked", "cancelled"],
  locked: ["planned", "cancelled"],
  planned: ["published", "archived", "cancelled"],
  published: ["archived", "cancelled"],
  archived: [],
  cancelled: [],
};

export interface TransitionAssertion {
  readonly from: EventStatus;
  readonly to: EventStatus;
  readonly alreadyApplied: boolean;
}

export class InvalidEventTransitionError extends Error {
  readonly from: EventStatus;
  readonly to: EventStatus;
  readonly allowedNextStates: readonly EventStatus[];

  constructor(from: EventStatus, to: EventStatus, allowedNextStates: readonly EventStatus[]) {
    const guidance = allowedNextStates.length > 0
      ? `Allowed state changes from "${from}": ${allowedNextStates.join(", ")}.`
      : `"${from}" is terminal; no further state changes are allowed.`;
    super(
      `Cannot transition weekly event from "${from}" to "${to}". ${guidance} ` +
        `Retrying "${from}" is idempotent and is treated as already applied.`,
    );
    this.name = "InvalidEventTransitionError";
    this.from = from;
    this.to = to;
    this.allowedNextStates = allowedNextStates;
  }
}

function isEventStatus(value: unknown): value is EventStatus {
  return typeof value === "string" && (EVENT_STATUSES as readonly string[]).includes(value);
}

export function getAllowedTransitions(status: EventStatus): readonly EventStatus[] {
  if (!isEventStatus(status)) return [];
  return ALLOWED_EVENT_TRANSITIONS[status];
}

/** Returns true for both an allowed state change and an idempotent retry. */
export function canTransition(from: EventStatus, to: EventStatus): boolean {
  if (!isEventStatus(from) || !isEventStatus(to)) return false;
  return from === to || ALLOWED_EVENT_TRANSITIONS[from].includes(to);
}

/**
 * Validates a requested transition and identifies same-state retries without
 * forcing callers to special-case them.
 */
export function assertTransition(from: EventStatus, to: EventStatus): TransitionAssertion {
  if (!isEventStatus(from)) {
    throw new TypeError(`Unknown current weekly event status: "${String(from)}".`);
  }
  if (!isEventStatus(to)) {
    throw new TypeError(`Unknown target weekly event status: "${String(to)}".`);
  }

  if (from === to) {
    return { from, to, alreadyApplied: true };
  }

  const allowedNextStates = ALLOWED_EVENT_TRANSITIONS[from];
  if (!allowedNextStates.includes(to)) {
    throw new InvalidEventTransitionError(from, to, allowedNextStates);
  }

  return { from, to, alreadyApplied: false };
}

export interface SchedulableEvent {
  readonly status: EventStatus;
  readonly signupOpensAt: number;
  readonly signupLocksAt: number;
  readonly startsAt: number;
  readonly endsAt?: number | null;
  /**
   * Used only when endsAt is absent. No implicit cleanup deadline is invented
   * when neither endsAt nor an explicit grace duration is represented.
   */
  readonly archiveGraceMs?: number | null;
}

export type ScheduledEventActionName = "open" | "lock" | "archive";

export interface ScheduledEventAction {
  readonly action: ScheduledEventActionName;
  readonly from: EventStatus;
  readonly to: EventStatus;
  readonly scheduledFor: number;
}

function assertTimestamp(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative finite Unix timestamp.`);
  }
}

function validateSchedule(event: SchedulableEvent, now: number): void {
  if (!isEventStatus(event.status)) {
    throw new TypeError(`Unknown weekly event status: "${String(event.status)}".`);
  }

  assertTimestamp(now, "now");
  assertTimestamp(event.signupOpensAt, "signupOpensAt");
  assertTimestamp(event.signupLocksAt, "signupLocksAt");
  assertTimestamp(event.startsAt, "startsAt");

  if (event.signupOpensAt > event.signupLocksAt) {
    throw new RangeError("signupOpensAt cannot be after signupLocksAt.");
  }
  if (event.signupLocksAt > event.startsAt) {
    throw new RangeError("signupLocksAt cannot be after startsAt.");
  }

  if (event.endsAt !== undefined && event.endsAt !== null) {
    assertTimestamp(event.endsAt, "endsAt");
    if (event.endsAt <= event.startsAt) {
      throw new RangeError("endsAt must be after startsAt.");
    }
  }

  if (event.archiveGraceMs !== undefined && event.archiveGraceMs !== null) {
    if (!Number.isFinite(event.archiveGraceMs) || event.archiveGraceMs < 0) {
      throw new RangeError("archiveGraceMs must be a non-negative finite duration.");
    }
  }
}

function dueAction(
  now: number,
  action: ScheduledEventActionName,
  from: EventStatus,
  to: EventStatus,
  scheduledFor: number,
): ScheduledEventAction | null {
  if (now < scheduledFor) return null;
  return { action, from, to, scheduledFor };
}

function archiveDeadline(event: SchedulableEvent): number | null {
  if (event.endsAt !== undefined && event.endsAt !== null) return event.endsAt;
  if (event.archiveGraceMs !== undefined && event.archiveGraceMs !== null) {
    const deadline = event.startsAt + event.archiveGraceMs;
    if (!Number.isSafeInteger(deadline)) {
      throw new RangeError("startsAt + archiveGraceMs exceeds the safe timestamp range.");
    }
    return deadline;
  }
  return null;
}

/**
 * Returns one due scheduler transition for the event's current state.
 *
 * A late draft still opens first; the following pass can lock it. Planned
 * events are never auto-published because publication requires admin review.
 */
export function nextScheduledAction(
  event: SchedulableEvent,
  now: number,
): ScheduledEventAction | null {
  validateSchedule(event, now);

  switch (event.status) {
    case "draft":
      return dueAction(now, "open", "draft", "open", event.signupOpensAt);
    case "open":
      return dueAction(now, "lock", "open", "locked", event.signupLocksAt);
    case "planned":
    case "published": {
      const deadline = archiveDeadline(event);
      if (deadline === null) return null;
      return dueAction(now, "archive", event.status, "archived", deadline);
    }
    case "locked":
    case "archived":
    case "cancelled":
      return null;
  }
}
