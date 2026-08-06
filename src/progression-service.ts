import {
  PROGRESSION_POLICY_VERSION,
  sessionXpForRole,
} from "./domain/progression";
import { CharacterRuleError } from "./character-service";
import type { SessionParticipant } from "./domain/session-completion";
import type { CharacterRepository } from "./storage/character-repository";
import type {
  CharacterProgressionBalance,
  ProgressionLedgerEntry,
  ProgressionRepository,
  SessionRewardTarget,
} from "./storage/progression-repository";

export type ProgressionServiceRepository = Pick<
  ProgressionRepository,
  | "getBalance"
  | "listBalancesForOwner"
  | "listHistory"
  | "getTarget"
  | "setTarget"
  | "appendEntry"
  | "appendSessionAward"
  | "listEffectiveSessionAwards"
>;

export type ProgressionCharacterRepository = Pick<
  CharacterRepository,
  "get" | "listForOwner"
>;

export interface ProgressionServiceOptions {
  now?: () => number;
  id?: () => string;
}

export interface SessionProgressionInput {
  guildId: string;
  sessionId: string;
  sourceEventId: string;
  sourceTableId: string;
  completionRevisionId: string;
  result: "completed" | "cancelled";
  participants: readonly SessionParticipant[];
  actorUserId: string;
  reason?: string | null;
  occurredAt: number;
}

export interface SessionProgressionResult {
  awards: ProgressionLedgerEntry[];
  reversals: ProgressionLedgerEntry[];
}

function defaultId(): string {
  return crypto.randomUUID();
}

function requireIdentifier(value: string, fieldName: string): void {
  if (!value.trim()) throw new TypeError(`${fieldName} cannot be empty`);
}

function cleanReason(value: string): string {
  const reason = value.replace(/[\r\n]+/g, " ").trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new RangeError("Reason must be between 3 and 500 characters");
  }
  return reason;
}

function activeParticipant(participant: SessionParticipant): boolean {
  return participant.outcome === "attended" ||
    participant.outcome === "substitute" ||
    participant.outcome === "walk_in";
}

export class ProgressionService {
  private readonly now: () => number;
  private readonly id: () => string;

  constructor(
    private readonly progression: ProgressionServiceRepository,
    private readonly characterRepository: ProgressionCharacterRepository,
    options: ProgressionServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.id = options.id ?? defaultId;
  }

  getBalance(guildId: string, characterId: string): Promise<CharacterProgressionBalance | null> {
    requireIdentifier(guildId, "guildId");
    requireIdentifier(characterId, "characterId");
    return this.progression.getBalance(guildId, characterId);
  }

  listBalancesForOwner(
    guildId: string,
    ownerUserId: string,
  ): Promise<CharacterProgressionBalance[]> {
    requireIdentifier(guildId, "guildId");
    requireIdentifier(ownerUserId, "ownerUserId");
    return this.progression.listBalancesForOwner(guildId, ownerUserId);
  }

  listHistory(
    guildId: string,
    characterId: string,
    limit = 20,
  ): Promise<ProgressionLedgerEntry[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError("History limit must be between 1 and 100");
    }
    return this.progression.listHistory(guildId, characterId, limit);
  }

  async selectSessionCharacter(input: {
    guildId: string;
    sourceEventId: string;
    sourceTableId: string;
    ownerUserId: string;
    characterId: string;
    actorUserId: string;
    reason?: string | null;
    operationKey: string;
  }): Promise<SessionRewardTarget> {
    const owned = await this.characterRepository.listForOwner(input.guildId, input.ownerUserId);
    const selected = owned.find((candidate) => candidate.characterId === input.characterId);
    if (!selected || selected.status !== "approved") {
      throw new CharacterRuleError("Select an approved character you own.");
    }
    // Frozen characters are intentionally selectable for play. Their eventual
    // player reward routes to the main character; DM reconciliation rejects them.
    return this.progression.setTarget({
      targetEventId: this.id(),
      guildId: input.guildId,
      sourceEventId: input.sourceEventId,
      sourceTableId: input.sourceTableId,
      userId: input.ownerUserId,
      characterId: input.characterId,
      actorUserId: input.actorUserId,
      reason: input.reason ?? null,
      idempotencyKey: input.operationKey,
      occurredAt: this.now(),
    });
  }

  async adjust(input: {
    guildId: string;
    characterId: string;
    xpDelta: number;
    goldDelta: number;
    actorUserId: string;
    reason: string;
    operationKey: string;
  }): Promise<ProgressionLedgerEntry> {
    if (!Number.isSafeInteger(input.xpDelta) || !Number.isSafeInteger(input.goldDelta)) {
      throw new RangeError("XP and gold adjustments must be whole numbers");
    }
    if (input.xpDelta === 0 && input.goldDelta === 0) {
      throw new RangeError("At least one adjustment must be non-zero");
    }
    const balance = await this.progression.getBalance(input.guildId, input.characterId);
    if (!balance) throw new CharacterRuleError("Character not found in this guild.");
    if (balance.xp + input.xpDelta < 0 || balance.gold + input.goldDelta < 0) {
      throw new CharacterRuleError("An adjustment cannot make XP or gold negative.");
    }
    return this.progression.appendEntry({
      entryId: this.id(),
      guildId: input.guildId,
      characterId: input.characterId,
      entryKind: "admin_adjustment",
      xpDelta: input.xpDelta,
      goldDelta: input.goldDelta,
      actorUserId: input.actorUserId,
      reason: cleanReason(input.reason),
      idempotencyKey: input.operationKey,
      occurredAt: this.now(),
    });
  }

  private async resolveRewardCharacter(input: {
    guildId: string;
    ownerUserId: string;
    role: "player" | "dm";
    playedCharacterId: string | null;
    selectedCharacterId: string | null;
  }) {
    const approved = (await this.characterRepository.listForOwner(
      input.guildId,
      input.ownerUserId,
    )).filter((character) => character.status === "approved");
    const main = approved.find((character) => character.isMain);
    const requestedId = input.role === "dm"
      ? input.selectedCharacterId
      : input.playedCharacterId;
    const requested = requestedId
      ? approved.find((character) => character.characterId === requestedId)
      : undefined;
    if (requestedId && !requested) {
      throw new CharacterRuleError("The selected character is not an approved character you own.");
    }
    if (input.role === "player" && requested?.progressionState === "frozen") {
      if (!main) throw new CharacterRuleError("A frozen character needs an approved main reward target.");
      return main;
    }
    const resolved = requested ?? main;
    if (!resolved) throw new CharacterRuleError("No approved reward character is available.");
    if (resolved.progressionState !== "active") {
      throw new CharacterRuleError("DM rewards can only be assigned to an active character.");
    }
    return resolved;
  }
  async reconcileSession(input: SessionProgressionInput): Promise<SessionProgressionResult> {
    const current = await this.progression.listEffectiveSessionAwards(
      input.guildId,
      input.sessionId,
    );
    const reversals: ProgressionLedgerEntry[] = [];
    for (const award of current) {
      if (
        input.result === "completed" &&
        award.sourceCompletionRevisionId === input.completionRevisionId
      ) {
        continue;
      }
      reversals.push(await this.progression.appendEntry({
        entryId: this.id(),
        guildId: input.guildId,
        characterId: award.characterId,
        entryKind: "reversal",
        xpDelta: -award.xpDelta,
        goldDelta: -award.goldDelta,
        reversesEntryId: award.entryId,
        actorUserId: input.actorUserId,
        reason: cleanReason(
          input.reason ?? `Session outcome superseded by revision ${input.completionRevisionId}`,
        ),
        idempotencyKey: `progression:reverse:${award.entryId}`,
        occurredAt: input.occurredAt,
      }));
    }
    if (input.result === "cancelled") return { awards: [], reversals };

    const existing = (await this.progression.listEffectiveSessionAwards(
      input.guildId,
      input.sessionId,
    )).filter((entry) => entry.sourceCompletionRevisionId === input.completionRevisionId);
    const existingKeys = new Set(
      existing.map((entry) => `${entry.participantRole}:${entry.sourceUserId}`),
    );
    const awards = [...existing];
    for (const participant of input.participants.filter(activeParticipant)) {
      const participantKey = `${participant.role}:${participant.userId}`;
      if (existingKeys.has(participantKey)) continue;
      const target = await this.progression.getTarget(
        input.guildId,
        input.sourceEventId,
        input.sourceTableId,
        participant.userId,
      );
      const character = await this.resolveRewardCharacter({
        guildId: input.guildId,
        ownerUserId: participant.userId,
        role: participant.role,
        playedCharacterId: participant.role === "player" ? target?.characterId ?? null : null,
        selectedCharacterId: participant.role === "dm" ? target?.characterId ?? null : null,
      });
      const xpDelta = sessionXpForRole(participant.role);
      awards.push(await this.progression.appendSessionAward({
        entryId: this.id(),
        guildId: input.guildId,
        characterId: character.characterId,
        xpDelta,
        sourceSessionId: input.sessionId,
        sourceCompletionRevisionId: input.completionRevisionId,
        sourceUserId: participant.userId,
        participantRole: participant.role,
        policyVersion: PROGRESSION_POLICY_VERSION,
        actorUserId: input.actorUserId,
        idempotencyKey:
          `progression:session:${input.completionRevisionId}:` +
          `${participant.role}:${participant.userId}`,
        occurredAt: input.occurredAt,
      }));
      existingKeys.add(participantKey);
    }
    return { awards, reversals };
  }
}
