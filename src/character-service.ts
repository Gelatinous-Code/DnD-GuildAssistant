import {
  normalizeCharacterName,
  normalizeOptionalCharacterText,
  validateCharacterSheetUrl,
  validateOpeningBalance,
} from "./domain/character";
import type {
  CharacterRepository,
  GuildCharacter,
} from "./storage/character-repository";

export type CharacterServiceRepository = Pick<
  CharacterRepository,
  "get" | "listForOwner" | "listPending" | "create" | "approve" | "setMain" | "changeState"
>;

export class CharacterRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CharacterRuleError";
  }
}

export interface CharacterServiceOptions {
  now?: () => number;
  id?: () => string;
}

function defaultId(): string {
  return crypto.randomUUID();
}

function requireIdentifier(value: string, fieldName: string): void {
  if (!value.trim()) throw new TypeError(`${fieldName} cannot be empty`);
}

export class CharacterService {
  private readonly now: () => number;
  private readonly id: () => string;

  constructor(
    private readonly repository: CharacterServiceRepository,
    options: CharacterServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.id = options.id ?? defaultId;
  }

  async register(input: {
    guildId: string;
    ownerUserId: string;
    name: string;
    sheetUrl?: string | null;
    season?: string | null;
    operationKey: string;
  }): Promise<GuildCharacter> {
    requireIdentifier(input.guildId, "guildId");
    requireIdentifier(input.ownerUserId, "ownerUserId");
    requireIdentifier(input.operationKey, "operationKey");
    const occurredAt = this.now();
    return this.repository.create({
      characterId: this.id(),
      characterEventId: this.id(),
      guildId: input.guildId,
      ownerUserId: input.ownerUserId,
      name: normalizeCharacterName(input.name),
      sheetUrl: validateCharacterSheetUrl(input.sheetUrl),
      season: normalizeOptionalCharacterText(input.season, "Season", 80),
      actorUserId: input.ownerUserId,
      occurredAt,
      idempotencyKey: input.operationKey,
    });
  }

  listForOwner(guildId: string, ownerUserId: string): Promise<GuildCharacter[]> {
    requireIdentifier(guildId, "guildId");
    requireIdentifier(ownerUserId, "ownerUserId");
    return this.repository.listForOwner(guildId, ownerUserId);
  }

  listPending(guildId: string): Promise<GuildCharacter[]> {
    requireIdentifier(guildId, "guildId");
    return this.repository.listPending(guildId);
  }

  async approve(input: {
    guildId: string;
    characterId: string;
    actorUserId: string;
    openingXp?: number;
    openingGold?: number;
    reason: string;
    operationKey: string;
  }): Promise<GuildCharacter> {
    const character = await this.requireCharacter(input.guildId, input.characterId);
    if (character.status !== "pending") {
      throw new CharacterRuleError("Only a pending character can be approved.");
    }
    const ownerCharacters = await this.repository.listForOwner(
      input.guildId,
      character.ownerUserId,
    );
    const makeMain = !ownerCharacters.some(
      (candidate) => candidate.status === "approved" && candidate.isMain,
    );
    const approved = await this.repository.approve({
      characterEventId: this.id(),
      guildId: input.guildId,
      characterId: input.characterId,
      actorUserId: input.actorUserId,
      openingXp: validateOpeningBalance(input.openingXp ?? 0, "Opening XP"),
      openingGold: validateOpeningBalance(input.openingGold ?? 0, "Opening gold"),
      makeMain,
      reason: this.requireReason(input.reason),
      occurredAt: this.now(),
      idempotencyKey: input.operationKey,
    });
    if (!approved) throw new CharacterRuleError("That character changed; please retry.");
    return approved;
  }

  async setMain(input: {
    guildId: string;
    ownerUserId: string;
    characterId: string;
    actorUserId: string;
    operationKey: string;
  }): Promise<GuildCharacter> {
    const target = await this.requireOwnedCharacter(
      input.guildId,
      input.characterId,
      input.ownerUserId,
    );
    if (target.status !== "approved" || target.progressionState !== "active") {
      throw new CharacterRuleError("Your main character must be approved and active.");
    }
    if (target.isMain) return target;
    const characters = await this.repository.listForOwner(input.guildId, input.ownerUserId);
    const previous = characters.find(
      (candidate) => candidate.status === "approved" && candidate.isMain,
    );
    const updated = await this.repository.setMain({
      guildId: input.guildId,
      ownerUserId: input.ownerUserId,
      characterId: input.characterId,
      actorUserId: input.actorUserId,
      previousCharacterId: previous?.characterId ?? null,
      targetEventId: this.id(),
      previousEventId: previous ? this.id() : null,
      occurredAt: this.now(),
      idempotencyKey: input.operationKey,
    });
    if (!updated) throw new CharacterRuleError("That character changed; please retry.");
    return updated;
  }

  async setFrozen(input: {
    guildId: string;
    ownerUserId: string;
    characterId: string;
    frozen: boolean;
    actorUserId: string;
    operationKey: string;
  }): Promise<GuildCharacter> {
    const character = await this.requireOwnedCharacter(
      input.guildId,
      input.characterId,
      input.ownerUserId,
    );
    if (character.status !== "approved") {
      throw new CharacterRuleError("Only an approved character can be frozen or unfrozen.");
    }
    if (character.isMain && input.frozen) {
      throw new CharacterRuleError("Set another active character as main before freezing this one.");
    }
    const desired = input.frozen ? "frozen" : "active";
    if (character.progressionState === desired) return character;
    const updated = await this.repository.changeState({
      characterEventId: this.id(),
      guildId: input.guildId,
      characterId: input.characterId,
      actorUserId: input.actorUserId,
      action: input.frozen ? "frozen" : "unfrozen",
      reason: null,
      occurredAt: this.now(),
      idempotencyKey: input.operationKey,
    });
    if (!updated) throw new CharacterRuleError("That character changed; please retry.");
    return updated;
  }

  async archive(input: {
    guildId: string;
    ownerUserId: string;
    characterId: string;
    actorUserId: string;
    operationKey: string;
  }): Promise<GuildCharacter> {
    const character = await this.requireOwnedCharacter(
      input.guildId,
      input.characterId,
      input.ownerUserId,
    );
    if (character.status === "archived" || character.status === "revoked") {
      throw new CharacterRuleError("That character is already closed.");
    }
    await this.requireSafeMainRemoval(character);
    const updated = await this.repository.changeState({
      characterEventId: this.id(),
      guildId: input.guildId,
      characterId: input.characterId,
      actorUserId: input.actorUserId,
      action: "archived",
      reason: null,
      occurredAt: this.now(),
      idempotencyKey: input.operationKey,
    });
    if (!updated) throw new CharacterRuleError("That character changed; please retry.");
    return updated;
  }

  async revoke(input: {
    guildId: string;
    characterId: string;
    actorUserId: string;
    reason: string;
    operationKey: string;
  }): Promise<GuildCharacter> {
    const character = await this.requireCharacter(input.guildId, input.characterId);
    if (character.status !== "pending" && character.status !== "approved") {
      throw new CharacterRuleError("Only a pending or approved character can be revoked.");
    }
    await this.requireSafeMainRemoval(character);
    const updated = await this.repository.changeState({
      characterEventId: this.id(),
      guildId: input.guildId,
      characterId: input.characterId,
      actorUserId: input.actorUserId,
      action: "revoked",
      reason: this.requireReason(input.reason),
      occurredAt: this.now(),
      idempotencyKey: input.operationKey,
    });
    if (!updated) throw new CharacterRuleError("That character changed; please retry.");
    return updated;
  }

  async resolveRewardCharacter(input: {
    guildId: string;
    ownerUserId: string;
    role: "player" | "dm";
    playedCharacterId?: string | null;
    selectedCharacterId?: string | null;
  }): Promise<GuildCharacter> {
    const characters = (await this.repository.listForOwner(input.guildId, input.ownerUserId)).filter(
      (character) => character.status === "approved",
    );
    const main = characters.find((character) => character.isMain);
    const requestedId = input.role === "dm" ? input.selectedCharacterId : input.playedCharacterId;
    const requested = requestedId
      ? characters.find((character) => character.characterId === requestedId)
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

  private async requireCharacter(guildId: string, characterId: string): Promise<GuildCharacter> {
    requireIdentifier(guildId, "guildId");
    requireIdentifier(characterId, "characterId");
    const character = await this.repository.get(guildId, characterId);
    if (!character) throw new CharacterRuleError("Character not found in this guild.");
    return character;
  }

  private async requireOwnedCharacter(
    guildId: string,
    characterId: string,
    ownerUserId: string,
  ): Promise<GuildCharacter> {
    const character = await this.requireCharacter(guildId, characterId);
    if (character.ownerUserId !== ownerUserId) {
      throw new CharacterRuleError("You can only manage your own characters.");
    }
    return character;
  }

  private async requireSafeMainRemoval(character: GuildCharacter): Promise<void> {
    if (!character.isMain) return;
    const alternatives = (await this.repository.listForOwner(
      character.guildId,
      character.ownerUserId,
    )).filter(
      (candidate) =>
        candidate.characterId !== character.characterId &&
        candidate.status === "approved" &&
        candidate.progressionState === "active",
    );
    if (alternatives.length > 0) {
      throw new CharacterRuleError("Set another active character as main before closing this one.");
    }
  }

  private requireReason(reason: string): string {
    const normalized = reason.trim();
    if (normalized.length < 3 || normalized.length > 500) {
      throw new CharacterRuleError("Reason must be between 3 and 500 characters.");
    }
    return normalized;
  }
}
