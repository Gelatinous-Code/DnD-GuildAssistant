export type SessionCompletionResult = "completed" | "cancelled";
export type SessionParticipantRole = "dm" | "player";
export type SessionAttendanceOutcome =
  | "attended"
  | "no_show"
  | "substitute"
  | "walk_in";

export interface SessionParticipant {
  readonly userId: string;
  readonly role: SessionParticipantRole;
  readonly outcome: SessionAttendanceOutcome;
  readonly replacesUserId: string | null;
  readonly wasPlanned: boolean;
  readonly recordedByUserId: string;
  readonly reason: string | null;
}

export interface SessionAttendanceDeviation {
  readonly userId: string;
  readonly role: SessionParticipantRole;
  readonly outcome: SessionAttendanceOutcome;
  readonly replacesUserId?: string | null;
  readonly recordedByUserId: string;
  readonly reason?: string | null;
}

export interface ValidatedSessionCompletion {
  readonly result: SessionCompletionResult;
  readonly actualDmUserId: string | null;
  readonly participantCount: number;
  readonly attendedPlayerCount: number;
  readonly noShowCount: number;
  readonly substituteCount: number;
  readonly walkInCount: number;
}

function requireIdentifier(value: string, fieldName: string): void {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${fieldName} cannot be empty`);
  }
}

function participantKey(role: SessionParticipantRole, userId: string): string {
  return `${role}:${userId}`;
}

function activeParticipant(participant: SessionParticipant): boolean {
  return (
    participant.outcome === "attended" ||
    participant.outcome === "substitute" ||
    participant.outcome === "walk_in"
  );
}

export function validateSessionParticipants(
  participants: readonly SessionParticipant[],
): void {
  const keys = new Set<string>();
  const replacements = new Set<string>();
  for (const participant of participants) {
    requireIdentifier(participant.userId, "participant userId");
    requireIdentifier(participant.recordedByUserId, "recordedByUserId");
    const key = participantKey(participant.role, participant.userId);
    if (keys.has(key)) throw new TypeError(`Duplicate session participant ${key}`);
    keys.add(key);

    const replacement = participant.replacesUserId;
    if (participant.outcome === "substitute") {
      if (!replacement?.trim() || replacement === participant.userId) {
        throw new TypeError("A substitute must replace a different participant");
      }
      const replacementKey = participantKey(participant.role, replacement);
      if (replacements.has(replacementKey)) {
        throw new TypeError(`Participant ${replacementKey} has multiple substitutes`);
      }
      replacements.add(replacementKey);
    } else if (replacement !== null) {
      throw new TypeError("Only a substitute may have replacesUserId");
    }
  }

  for (const participant of participants) {
    if (participant.outcome !== "substitute") continue;
    const replaced = participants.find(
      (candidate) =>
        candidate.role === participant.role &&
        candidate.userId === participant.replacesUserId,
    );
    if (!replaced || replaced.outcome !== "no_show") {
      throw new TypeError("A substitute must reference a recorded no-show in the same role");
    }
  }
}

export function applySessionAttendanceDeviation(
  participants: readonly SessionParticipant[],
  deviation: SessionAttendanceDeviation,
): SessionParticipant[] {
  validateSessionParticipants(participants);
  requireIdentifier(deviation.userId, "userId");
  requireIdentifier(deviation.recordedByUserId, "recordedByUserId");
  const replacement = deviation.replacesUserId ?? null;
  if (deviation.outcome === "substitute") {
    if (!replacement?.trim() || replacement === deviation.userId) {
      throw new TypeError("A substitute must identify the different member being replaced");
    }
  } else if (replacement !== null) {
    throw new TypeError("replacesUserId is only valid for a substitute");
  }

  const next = new Map(
    participants.map((participant) => [
      participantKey(participant.role, participant.userId),
      participant,
    ]),
  );
  if (deviation.outcome === "substitute") {
    const replacedKey = participantKey(deviation.role, replacement!);
    const replaced = next.get(replacedKey);
    if (!replaced) {
      throw new TypeError("The substituted member is not in the current session roster");
    }
    next.set(replacedKey, {
      ...replaced,
      outcome: "no_show",
      replacesUserId: null,
      recordedByUserId: deviation.recordedByUserId,
      reason: deviation.reason?.trim() || null,
    });
  }

  const key = participantKey(deviation.role, deviation.userId);
  const existing = next.get(key);
  next.set(key, {
    userId: deviation.userId,
    role: deviation.role,
    outcome: deviation.outcome,
    replacesUserId: replacement,
    wasPlanned: existing?.wasPlanned ?? false,
    recordedByUserId: deviation.recordedByUserId,
    reason: deviation.reason?.trim() || null,
  });
  const result = [...next.values()].sort(
    (left, right) =>
      left.role.localeCompare(right.role) || left.userId.localeCompare(right.userId),
  );
  validateSessionParticipants(result);
  return result;
}

export function validateSessionCompletion(
  result: SessionCompletionResult,
  participants: readonly SessionParticipant[],
): ValidatedSessionCompletion {
  validateSessionParticipants(participants);
  if (participants.length === 0) {
    throw new TypeError("A session completion must retain its participant snapshot");
  }

  const actualDms = participants.filter(
    (participant) => participant.role === "dm" && activeParticipant(participant),
  );
  if (result === "completed" && actualDms.length !== 1) {
    throw new TypeError("A completed session requires exactly one recorded actual DM");
  }

  return {
    result,
    actualDmUserId: result === "completed" ? actualDms[0]!.userId : null,
    participantCount: participants.length,
    attendedPlayerCount: participants.filter(
      (participant) => participant.role === "player" && activeParticipant(participant),
    ).length,
    noShowCount: participants.filter((participant) => participant.outcome === "no_show").length,
    substituteCount: participants.filter(
      (participant) => participant.outcome === "substitute",
    ).length,
    walkInCount: participants.filter((participant) => participant.outcome === "walk_in").length,
  };
}
