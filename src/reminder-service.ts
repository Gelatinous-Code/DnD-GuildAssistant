import {
  DiscordApiError,
  discordNonce,
  discordTimestamp,
  renderReminderMessage,
  type DiscordRestClient,
} from "./discord-api";
import { renderReminderTemplate, validateReminderTemplate } from "./policy";
import type {
  GuildConfig,
  GuildRepository,
  ReminderDelivery,
  ReminderRule,
  SignupCounts,
  WeeklyEvent,
} from "./storage/repository";

const MINUTE_MS = 60_000;
const DEFAULT_BASE_RETRY_MS = MINUTE_MS;
const DEFAULT_MAX_RETRY_MS = 60 * MINUTE_MS;
const DEFAULT_MAX_ATTEMPTS = 5;
const MAX_MINUTES_BEFORE_LOCK = 30 * 24 * 60;

export type ReminderRepository = Pick<
  GuildRepository,
  | "saveReminderRule"
  | "listEnabledReminderRules"
  | "enqueueReminder"
  | "claimReminder"
  | "markReminderSent"
  | "markReminderFailed"
  | "getReminder"
  | "retryReminder"
  | "skipReminder"
  | "getWeeklyEvent"
  | "getGuildConfig"
  | "countActiveSignups"
>;

export type ReminderDiscordClient = Pick<DiscordRestClient, "sendChannelMessage">;

export interface ReminderLogEntry {
  readonly component: "reminder";
  readonly action: "configure" | "enqueue" | "deliver" | "manual-send" | "retry" | "skip";
  readonly status: "succeeded" | "skipped" | "failed";
  readonly guildId?: string;
  readonly eventId?: string;
  readonly ruleId?: string;
  readonly deliveryId?: string;
  readonly attempt?: number;
  readonly messageId?: string;
  readonly nextAttemptAt?: number | null;
  readonly errorKind?: string;
  readonly httpStatus?: number;
}

export type ReminderLogger = (entry: ReminderLogEntry) => void;

export interface ReminderServiceOptions {
  readonly now?: () => number;
  readonly uniqueId?: () => string;
  readonly logger?: ReminderLogger;
  readonly baseRetryMs?: number;
  readonly maxRetryMs?: number;
  readonly maxAttempts?: number;
}

export interface ConfigurePreLockReminderInput {
  readonly guildId: string;
  readonly channelId: string;
  readonly roleId?: string;
  readonly template: string;
  readonly minutesBeforeLock: number;
  readonly enabled: boolean;
}

export interface ReminderDeliveryResult {
  readonly status: "sent" | "skipped" | "failed" | "expired";
  readonly deliveryId: string;
  readonly messageId?: string;
  readonly nextAttemptAt?: number | null;
  readonly permanent?: boolean;
  readonly reason?: string;
}

export interface ManualReminderInput {
  readonly event: WeeklyEvent;
  /** A deliberate resend gets a new occurrence; false reuses the stable key. */
  readonly explicitResend?: boolean;
}

export class ReminderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReminderConfigurationError";
  }
}

class AmbiguousReminderDeliveryError extends Error {
  constructor() {
    super(
      "Discord accepted the reminder, but its delivery record could not be marked sent; " +
        "automatic retry is disabled to prevent a duplicate notification.",
    );
    this.name = "AmbiguousReminderDeliveryError";
  }
}

export function preLockReminderRuleId(guildId: string): string {
  if (!guildId.trim()) throw new TypeError("guildId is required");
  return `reminder:pre-lock:${guildId}`;
}

export function scheduledReminderKey(eventId: string, ruleId: string): string {
  return `reminder:scheduled:${eventId}:${ruleId}`;
}

export function manualReminderKey(eventId: string, ruleId: string): string {
  return `reminder:manual:${eventId}:${ruleId}`;
}

function assertSnowflake(value: string, label: string): void {
  if (!/^\d{1,20}$/.test(value)) {
    throw new ReminderConfigurationError(`${label} must be a Discord snowflake.`);
  }
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

export function reminderCapacitySummary(
  counts: SignupCounts,
  maxPlayersPerTable: number,
): { openSeats: number; atRisk: boolean; summary: string } {
  const capacity = counts.gms * maxPlayersPerTable;
  const openSeats = Math.max(0, capacity - counts.players);
  const shortfall = Math.max(0, counts.players - capacity);
  const attendance = `${plural(counts.players, "player")} and ${plural(counts.gms, "GM")}`;

  if (counts.players > 0 && counts.gms === 0) {
    return {
      openSeats,
      atRisk: true,
      summary: `Capacity risk: ${attendance}; at least one GM is needed.`,
    };
  }
  if (shortfall > 0) {
    return {
      openSeats,
      atRisk: true,
      summary:
        `Capacity risk: ${attendance}; ${plural(shortfall, "player")} ` +
        `${shortfall === 1 ? "exceeds" : "exceed"} current maximum table capacity.`,
    };
  }
  return {
    openSeats,
    atRisk: false,
    summary: `Current signups: ${attendance}; ${plural(openSeats, "maximum-capacity seat")} remain.`,
  };
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1000);
}

function defaultLogger(entry: ReminderLogEntry): void {
  console.info(entry);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
}

export class ReminderService {
  readonly #now: () => number;
  readonly #uniqueId: () => string;
  readonly #logger: ReminderLogger;
  readonly #baseRetryMs: number;
  readonly #maxRetryMs: number;
  readonly #maxAttempts: number;

  constructor(
    private readonly repository: ReminderRepository,
    private readonly discord: ReminderDiscordClient,
    options: ReminderServiceOptions = {},
  ) {
    this.#now = options.now ?? Date.now;
    this.#uniqueId = options.uniqueId ?? (() => crypto.randomUUID());
    this.#logger = options.logger ?? defaultLogger;
    this.#baseRetryMs = options.baseRetryMs ?? DEFAULT_BASE_RETRY_MS;
    this.#maxRetryMs = options.maxRetryMs ?? DEFAULT_MAX_RETRY_MS;
    this.#maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

    assertPositiveInteger(this.#baseRetryMs, "baseRetryMs");
    assertPositiveInteger(this.#maxRetryMs, "maxRetryMs");
    assertPositiveInteger(this.#maxAttempts, "maxAttempts");
    if (this.#baseRetryMs > this.#maxRetryMs) {
      throw new RangeError("baseRetryMs cannot exceed maxRetryMs.");
    }
  }

  async configurePreLockRule(
    input: ConfigurePreLockReminderInput,
  ): Promise<ReminderRule> {
    assertSnowflake(input.guildId, "guildId");
    assertSnowflake(input.channelId, "channelId");
    if (input.roleId !== undefined) assertSnowflake(input.roleId, "roleId");
    if (
      !Number.isInteger(input.minutesBeforeLock) ||
      input.minutesBeforeLock < 1 ||
      input.minutesBeforeLock > MAX_MINUTES_BEFORE_LOCK
    ) {
      throw new ReminderConfigurationError(
        `minutesBeforeLock must be an integer from 1 through ${MAX_MINUTES_BEFORE_LOCK}.`,
      );
    }

    const templateErrors = validateReminderTemplate(input.template);
    if (templateErrors.length > 0) {
      throw new ReminderConfigurationError(templateErrors.join("; "));
    }

    const ruleId = preLockReminderRuleId(input.guildId);
    const rule = await this.repository.saveReminderRule({
      ruleId,
      guildId: input.guildId,
      name: "pre-lock",
      triggerKind: "signup_lock",
      offsetMinutes: input.minutesBeforeLock,
      audienceKind: input.roleId ? "configured_role" : "channel",
      roleId: input.roleId,
      channelId: input.channelId,
      messageTemplate: input.template,
      mentionRole: input.roleId !== undefined,
      enabled: input.enabled,
    });
    this.#logger({
      component: "reminder",
      action: "configure",
      status: "succeeded",
      guildId: input.guildId,
      ruleId,
    });
    return rule;
  }

  async enqueuePreLockReminder(
    event: WeeklyEvent,
  ): Promise<{ enqueued: boolean; delivery: ReminderDelivery } | null> {
    const ruleId = preLockReminderRuleId(event.guildId);
    const rule = await this.#getEnabledRule(event.guildId);
    if (!rule) {
      this.#logger({
        component: "reminder",
        action: "enqueue",
        status: "skipped",
        guildId: event.guildId,
        eventId: event.eventId,
        ruleId,
        errorKind: "rule-not-enabled",
      });
      return null;
    }
    if (rule.guildId !== event.guildId || rule.triggerKind !== "signup_lock") {
      throw new ReminderConfigurationError("Pre-lock reminder rule does not match the event guild.");
    }
    if (!rule.channelId) {
      throw new ReminderConfigurationError("Pre-lock reminder requires a configured channel.");
    }
    if (rule.mentionRole && !rule.roleId) {
      throw new ReminderConfigurationError("Role mention is enabled without a configured role.");
    }

    const scheduledFor = event.signupLocksAt - rule.offsetMinutes * MINUTE_MS;
    if (!Number.isSafeInteger(scheduledFor) || scheduledFor < 0) {
      throw new ReminderConfigurationError(
        "Reminder offset produces an invalid time before the signup lock.",
      );
    }

    const idempotencyKey = scheduledReminderKey(event.eventId, rule.ruleId);
    const result = await this.repository.enqueueReminder({
      deliveryId: idempotencyKey,
      ruleId: rule.ruleId,
      eventId: event.eventId,
      channelId: rule.channelId,
      recipientKind: rule.mentionRole ? "role" : "channel",
      recipientId: rule.mentionRole ? rule.roleId ?? undefined : undefined,
      // Persist the validated template snapshot; counts are rendered at send time.
      content: rule.messageTemplate,
      scheduledFor,
      idempotencyKey,
    });
    this.#logger({
      component: "reminder",
      action: "enqueue",
      status: result.enqueued ? "succeeded" : "skipped",
      guildId: event.guildId,
      eventId: event.eventId,
      ruleId: rule.ruleId,
      deliveryId: result.delivery.deliveryId,
      errorKind: result.enqueued ? undefined : "already-enqueued",
    });
    return result;
  }

  async deliverReminder(delivery: ReminderDelivery): Promise<ReminderDeliveryResult> {
    const attempt = delivery.attemptCount + 1;
    const claimed = await this.repository.claimReminder(delivery.deliveryId);
    if (!claimed) {
      this.#logger({
        component: "reminder",
        action: "deliver",
        status: "skipped",
        eventId: delivery.eventId,
        ruleId: delivery.ruleId ?? undefined,
        deliveryId: delivery.deliveryId,
        attempt,
        errorKind: "not-claimable",
      });
      return {
        status: "skipped",
        deliveryId: delivery.deliveryId,
        reason: "Reminder was already claimed, sent, or is not due.",
      };
    }

    let event: WeeklyEvent | null = null;
    try {
      event = await this.repository.getWeeklyEvent(delivery.eventId);
      if (!event) throw new ReminderConfigurationError("Reminder event no longer exists.");
      if (this.#now() >= event.signupLocksAt) {
        const reason = "Pre-lock reminder expired when signups locked.";
        await this.repository.markReminderFailed(delivery.deliveryId, reason, null);
        this.#logger({
          component: "reminder",
          action: "deliver",
          status: "skipped",
          guildId: event.guildId,
          eventId: event.eventId,
          ruleId: delivery.ruleId ?? undefined,
          deliveryId: delivery.deliveryId,
          attempt,
          nextAttemptAt: null,
          errorKind: "expired",
        });
        return {
          status: "expired",
          deliveryId: delivery.deliveryId,
          nextAttemptAt: null,
          permanent: true,
          reason,
        };
      }

      if (!delivery.ruleId) {
        throw new ReminderConfigurationError("Reminder delivery is missing its configured rule.");
      }
      const [rules, config, counts] = await Promise.all([
        this.repository.listEnabledReminderRules(event.guildId),
        this.repository.getGuildConfig(event.guildId),
        this.repository.countActiveSignups(event.eventId),
      ]);
      const rule = rules.find((candidate) => candidate.ruleId === delivery.ruleId) ?? null;
      if (!rule || rule.guildId !== event.guildId) {
        throw new ReminderConfigurationError("Reminder rule is missing or belongs to another guild.");
      }
      if (!config) throw new ReminderConfigurationError("Guild configuration no longer exists.");
      if (rule.channelId !== delivery.channelId) {
        throw new ReminderConfigurationError(
          "Reminder channel changed after enqueue; configure or send a new occurrence.",
        );
      }
      assertSnowflake(delivery.channelId, "channelId");

      const capacity = reminderCapacitySummary(
        counts,
        config.tableMaxSize ?? config.maxPlayersPerTable ?? 6,
      );
      const roleIds = [
        ...this.#configuredRoleIds(rule, delivery),
        ...(capacity.atRisk && config.adminRoleId ? [config.adminRoleId] : []),
      ];
      for (const roleId of roleIds) assertSnowflake(roleId, "roleId");
      const rendered = this.#renderBody(delivery.content, event, config, counts);
      const payload = renderReminderMessage({
        eventTitle: event.title,
        startsAt: event.startsAt,
        body: rendered,
        roleIds,
        heading: "Signup reminder",
      });
      const message = await this.discord.sendChannelMessage(delivery.channelId, {
        ...payload,
        nonce: discordNonce("reminder:" + delivery.deliveryId),
        enforce_nonce: true,
      });
      const marked = await this.repository.markReminderSent(delivery.deliveryId, message.id);
      if (!marked) {
        throw new AmbiguousReminderDeliveryError();
      }

      this.#logger({
        component: "reminder",
        action: "deliver",
        status: "succeeded",
        guildId: event.guildId,
        eventId: event.eventId,
        ruleId: rule.ruleId,
        deliveryId: delivery.deliveryId,
        attempt,
        messageId: message.id,
      });
      return {
        status: "sent",
        deliveryId: delivery.deliveryId,
        messageId: message.id,
      };
    } catch (error) {
      return this.#recordDeliveryFailure(delivery, event, error, attempt);
    }
  }

  async retryScheduledReminder(deliveryId: string): Promise<ReminderDeliveryResult> {
    const delivery = await this.repository.getReminder(deliveryId);
    this.#assertScheduledDelivery(delivery);
    const event = await this.repository.getWeeklyEvent(delivery.eventId);
    if (!event || this.#now() >= event.signupLocksAt) {
      const reason = !event
        ? "Reminder event no longer exists."
        : "Pre-lock reminder expired when signups locked.";
      await this.repository.skipReminder(delivery.deliveryId, reason);
      this.#logger({
        component: "reminder",
        action: "retry",
        status: "skipped",
        eventId: delivery.eventId,
        ruleId: delivery.ruleId ?? undefined,
        deliveryId,
        errorKind: "expired",
      });
      return {
        status: "expired",
        deliveryId,
        permanent: true,
        nextAttemptAt: null,
        reason,
      };
    }
    if (delivery.status === "sent" || delivery.status === "cancelled") {
      return {
        status: "skipped",
        deliveryId,
        reason: `Reminder is already ${delivery.status}.`,
      };
    }
    const retried = await this.repository.retryReminder(deliveryId);
    if (!retried) {
      return {
        status: "skipped",
        deliveryId,
        reason: "Reminder is not failed or lease-expired.",
      };
    }
    this.#logger({
      component: "reminder",
      action: "retry",
      status: "succeeded",
      guildId: event.guildId,
      eventId: event.eventId,
      ruleId: delivery.ruleId ?? undefined,
      deliveryId,
    });
    return this.deliverReminder({
      ...delivery,
      status: "pending",
      nextAttemptAt: null,
      lastError: null,
    });
  }

  async skipScheduledReminder(
    deliveryId: string,
    reason = "Skipped by an administrator.",
  ): Promise<ReminderDeliveryResult> {
    const delivery = await this.repository.getReminder(deliveryId);
    this.#assertScheduledDelivery(delivery);
    const skipped = await this.repository.skipReminder(deliveryId, reason);
    this.#logger({
      component: "reminder",
      action: "skip",
      status: skipped ? "succeeded" : "skipped",
      eventId: delivery.eventId,
      ruleId: delivery.ruleId ?? undefined,
      deliveryId,
      errorKind: skipped ? undefined : "not-skippable",
    });
    return {
      status: "skipped",
      deliveryId,
      permanent: skipped,
      nextAttemptAt: null,
      reason: skipped ? reason : "Reminder is already sent, skipped, or actively claimed.",
    };
  }

  async sendManualReminder(input: ManualReminderInput): Promise<ReminderDeliveryResult> {
    const event = input.event;
    const rule = await this.#getEnabledRule(event.guildId);
    if (!rule || !rule.channelId) {
      throw new ReminderConfigurationError("An enabled pre-lock reminder must be configured first.");
    }

    const stableKey = manualReminderKey(event.eventId, rule.ruleId);
    const idempotencyKey = input.explicitResend
      ? `${stableKey}:resend:${this.#now()}:${this.#uniqueId()}`
      : stableKey;
    const result = await this.repository.enqueueReminder({
      deliveryId: idempotencyKey,
      ruleId: rule.ruleId,
      eventId: event.eventId,
      channelId: rule.channelId,
      recipientKind: rule.mentionRole ? "role" : "channel",
      recipientId: rule.mentionRole ? rule.roleId ?? undefined : undefined,
      content: rule.messageTemplate,
      scheduledFor: this.#now(),
      idempotencyKey,
    });
    this.#logger({
      component: "reminder",
      action: "manual-send",
      status: result.enqueued ? "succeeded" : "skipped",
      guildId: event.guildId,
      eventId: event.eventId,
      ruleId: rule.ruleId,
      deliveryId: result.delivery.deliveryId,
      errorKind: result.enqueued ? undefined : "already-enqueued",
    });
    return this.deliverReminder(result.delivery);
  }

  #assertScheduledDelivery(
    delivery: ReminderDelivery | null,
  ): asserts delivery is ReminderDelivery {
    if (!delivery) {
      throw new ReminderConfigurationError("Reminder delivery does not exist.");
    }
    if (
      !delivery.ruleId ||
      delivery.idempotencyKey !== scheduledReminderKey(delivery.eventId, delivery.ruleId)
    ) {
      throw new ReminderConfigurationError(
        "Only the original scheduled reminder occurrence can be retried or skipped.",
      );
    }
  }

  #configuredRoleIds(rule: ReminderRule, delivery: ReminderDelivery): string[] {
    if (!rule.mentionRole) return [];
    if (
      !rule.roleId ||
      delivery.recipientKind !== "role" ||
      delivery.recipientId !== rule.roleId
    ) {
      throw new ReminderConfigurationError(
        "Reminder role does not match the explicitly configured role.",
      );
    }
    assertSnowflake(rule.roleId, "roleId");
    return [rule.roleId];
  }

  async #getEnabledRule(guildId: string): Promise<ReminderRule | null> {
    const expectedRuleId = preLockReminderRuleId(guildId);
    const rules = await this.repository.listEnabledReminderRules(guildId);
    return rules.find((candidate) => candidate.ruleId === expectedRuleId) ?? null;
  }

  #renderBody(
    template: string,
    event: WeeklyEvent,
    config: GuildConfig,
    counts: SignupCounts,
  ): string {
    const maximum = config.tableMaxSize ?? config.maxPlayersPerTable ?? 6;
    const capacity = reminderCapacitySummary(counts, maximum);
    const body = renderReminderTemplate(template, {
      event: event.title,
      when: discordTimestamp(event.startsAt, "F"),
      players: counts.players,
      gms: counts.gms,
      openSeats: capacity.openSeats,
    });
    return (
      body +
      "\n" +
      (capacity.atRisk ? "Organizer escalation — " : "") +
      capacity.summary
    );
  }

  async #recordDeliveryFailure(
    delivery: ReminderDelivery,
    event: WeeklyEvent | null,
    error: unknown,
    attempt: number,
  ): Promise<ReminderDeliveryResult> {
    const now = this.#now();
    const discordError = error instanceof DiscordApiError ? error : null;
    const permanentHttpFailure =
      discordError !== null &&
      discordError.status >= 400 &&
      discordError.status < 500 &&
      discordError.status !== 429;
    const permanentConfigurationFailure = error instanceof ReminderConfigurationError;
    const ambiguousDelivery = error instanceof AmbiguousReminderDeliveryError;
    const attemptsExhausted = attempt >= this.#maxAttempts;
    let permanent =
      permanentHttpFailure || permanentConfigurationFailure || ambiguousDelivery || attemptsExhausted;
    let nextAttemptAt: number | null = null;

    if (!permanent) {
      const exponent = Math.min(Math.max(attempt - 1, 0), 30);
      const delay = Math.min(this.#baseRetryMs * 2 ** exponent, this.#maxRetryMs);
      const candidate = now + delay;
      if (event && candidate >= event.signupLocksAt) {
        permanent = true;
      } else {
        nextAttemptAt = candidate;
      }
    }

    const message = errorMessage(error);
    await this.repository.markReminderFailed(delivery.deliveryId, message, nextAttemptAt);
    this.#logger({
      component: "reminder",
      action: "deliver",
      status: "failed",
      guildId: event?.guildId,
      eventId: delivery.eventId,
      ruleId: delivery.ruleId ?? undefined,
      deliveryId: delivery.deliveryId,
      attempt,
      nextAttemptAt,
      errorKind: permanentConfigurationFailure
        ? "configuration"
        : ambiguousDelivery
          ? "delivery-uncertain"
          : attemptsExhausted
            ? "attempts-exhausted"
            : permanentHttpFailure
              ? "permanent-discord"
              : "transient",
      httpStatus: discordError?.status,
    });
    return {
      status: "failed",
      deliveryId: delivery.deliveryId,
      nextAttemptAt,
      permanent,
      reason: message,
    };
  }
}
