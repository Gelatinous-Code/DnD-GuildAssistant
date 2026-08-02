export type PriorityDiagnosticsScope =
  | { kind: "guild"; guildId: string }
  | { kind: "event"; guildId: string; eventId: string }
  | { kind: "member"; guildId: string; memberUserId: string };

export type SessionRewardSyncStatus = "none" | "pending" | "synced" | "failed";
export type DiagnosticGrantStatus = "active" | "corrected";
export type DiagnosticCreditStatus =
  | "available"
  | "reserved"
  | "redeemed"
  | "expired"
  | "corrected";
export type DiagnosticCreditAction =
  | "granted"
  | "reserved"
  | "redeemed"
  | "refunded"
  | "expired"
  | "corrected";
export type DiagnosticSeatingAction =
  | "requested"
  | "priority_requested"
  | "displaced"
  | "promoted"
  | "reranked"
  | "priority_released"
  | "priority_redeemed"
  | "left"
  | "withdrawn"
  | "cancelled"
  | "carried_forward"
  | "expired";
export type DiagnosticNotificationStatus =
  | "pending"
  | "sending"
  | "retry"
  | "sent"
  | "blocked"
  | "failed"
  | "uncertain"
  | "cancelled";

export interface PriorityDiagnosticCounts {
  guildExists: boolean;
  sessions: {
    total: number;
    revisions: number;
    events: number;
    rewardSync: Record<SessionRewardSyncStatus, number>;
  };
  grants: {
    total: number;
    byStatus: Record<DiagnosticGrantStatus, number>;
  };
  credits: {
    total: number;
    byStatus: Record<DiagnosticCreditStatus, number>;
  };
  creditEvents: {
    total: number;
    byAction: Record<DiagnosticCreditAction, number>;
  };
  seating: {
    operations: number;
    events: number;
    byAction: Record<DiagnosticSeatingAction, number>;
  };
  notifications: {
    total: number;
    byStatus: Record<DiagnosticNotificationStatus, number>;
  };
}

export type PriorityDiagnosticArea =
  | "session"
  | "grant"
  | "credit"
  | "seating"
  | "notification";

export interface PriorityDiagnosticTrace {
  occurredAt: number;
  area: PriorityDiagnosticArea;
  action: string;
  status: string | null;
  entityRef: string;
  correlations: string[];
  actor: string;
  subject: string | null;
  policyRevision: string | null;
  revision: number | null;
  operationRevision: number | null;
  configRevision: number | null;
  detailCode: string | null;
  errorCode: number | null;
}

export interface PriorityDiagnosticLedgerReferences {
  correctGrantIds: string[];
  refundCreditIds: string[];
  truncated: boolean;
}

export interface PriorityDiagnosticsReport {
  scope: PriorityDiagnosticsScope["kind"];
  generatedAt: number;
  counts: PriorityDiagnosticCounts;
  ledgerReferences: PriorityDiagnosticLedgerReferences;
  trace: PriorityDiagnosticTrace[];
  traceTruncated: boolean;
}

interface LedgerReferenceRow {
  action_kind: "correct" | "refund";
  entity_id: string;
}

type BindValue = string | number | null;
type QueryArea =
  | "session"
  | "grant"
  | "credit"
  | "credit-event"
  | "seating-operation"
  | "seating-event"
  | "notification";

interface QueryFilter {
  sql: string;
  values: BindValue[];
}

interface MetricRow {
  metric: string;
  value: number;
}

interface TraceRow {
  occurred_at: number;
  area: string;
  action: string;
  status: string | null;
  entity_kind: string;
  entity_id: string;
  parent_kind: string | null;
  parent_id: string | null;
  related_kind: string | null;
  related_id: string | null;
  actor_user_id: string | null;
  subject_user_id: string | null;
  policy_revision: string | null;
  revision_number: number | null;
  operation_revision: number | null;
  config_revision: number | null;
  detail_code: string | null;
  error_code: number | null;
}

const REWARD_STATUSES = ["none", "pending", "synced", "failed"] as const;
const GRANT_STATUSES = ["active", "corrected"] as const;
const CREDIT_STATUSES = [
  "available", "reserved", "redeemed", "expired", "corrected",
] as const;
const CREDIT_ACTIONS = [
  "granted", "reserved", "redeemed", "refunded", "expired", "corrected",
] as const;
const SEATING_ACTIONS = [
  "requested", "priority_requested", "displaced", "promoted", "reranked",
  "priority_released", "priority_redeemed", "left", "withdrawn", "cancelled",
  "carried_forward", "expired",
] as const;
const NOTIFICATION_STATUSES = [
  "pending", "sending", "retry", "sent", "blocked", "failed", "uncertain",
  "cancelled",
] as const;

const ACTIONS = new Set<string>([
  ...CREDIT_ACTIONS,
  ...SEATING_ACTIONS,
  "completed", "cancelled", "draft_created", "correction_draft_created",
  "attendance_recorded", "confirmed", "corrected", "reward_synced",
  "reward_failed", "select_standard", "select_priority", "release_priority",
  "leave", "withdraw", "settle", "cancel", "carry_forward", "expire",
  "grant_awarded", "credit_reserved", "credit_redeemed", "credit_refunded",
  "credit_expired", "grant_corrected", "credit_expiring", "seat_displaced",
  "seat_promoted",
]);
const STATUSES = new Set<string>([
  ...REWARD_STATUSES, ...GRANT_STATUSES, ...CREDIT_STATUSES,
  ...NOTIFICATION_STATUSES, "complete", "incomplete",
]);
const DETAIL_CODES = new Set<string>([
  "member_priority_request", "explicit_priority_release",
  "dm_priority_displacement", "seat_opened", "select_standard", "leave",
  "withdraw", "selection_closed_assigned", "credit_expired_before_settlement",
  "selection_closed_unseated", "event_cancelled", "same_active_gm",
  "discord_dm_blocked", "discord_before_send_transient",
  "discord_before_send_permanent", "discord_rate_limited_before_acceptance",
  "discord_send_outcome_uncertain", "discord_send_rejected",
  "unknown_after_send_attempt", "unexpected_before_send",
]);
const AREAS = new Set<string>([
  "session", "grant", "credit", "seating", "notification",
]);
const REFERENCE_KINDS = new Set<string>([
  "session", "session-event", "completion-revision", "grant", "credit",
  "credit-event", "seating-operation", "seating-event", "notification",
  "event", "assignment", "member",
]);

function zeroRecord<T extends readonly string[]>(
  keys: T,
): Record<T[number], number> {
  return Object.fromEntries(
    keys.map((key) => [key, 0]),
  ) as Record<T[number], number>;
}

function emptyCounts(): PriorityDiagnosticCounts {
  return {
    guildExists: false,
    sessions: {
      total: 0,
      revisions: 0,
      events: 0,
      rewardSync: zeroRecord(REWARD_STATUSES),
    },
    grants: { total: 0, byStatus: zeroRecord(GRANT_STATUSES) },
    credits: { total: 0, byStatus: zeroRecord(CREDIT_STATUSES) },
    creditEvents: { total: 0, byAction: zeroRecord(CREDIT_ACTIONS) },
    seating: {
      operations: 0,
      events: 0,
      byAction: zeroRecord(SEATING_ACTIONS),
    },
    notifications: {
      total: 0,
      byStatus: zeroRecord(NOTIFICATION_STATUSES),
    },
  };
}

function requireIdentifier(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(fieldName + " cannot be empty");
  if (normalized.length > 200) {
    throw new RangeError(fieldName + " cannot exceed 200 characters");
  }
  return normalized;
}

function assertLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError("limit must be an integer from 1 through 100");
  }
}

function filterFor(
  scope: PriorityDiagnosticsScope,
  area: QueryArea,
): QueryFilter {
  if (scope.kind === "guild") {
    const alias =
      area === "session" ? "session" :
      area === "grant" ? "grant_row" :
      area === "credit" || area === "credit-event" ? "credit" :
      area === "seating-operation" ? "operation" :
      area === "seating-event" ? "decision" : "notification";
    return { sql: alias + ".guild_id = ?", values: [scope.guildId] };
  }
  if (scope.kind === "event") {
    switch (area) {
      case "session":
        return {
          sql: "session.guild_id = ? AND session.source_event_id = ?",
          values: [scope.guildId, scope.eventId],
        };
      case "grant":
        return {
          sql:
            "grant_row.guild_id = ? AND (grant_row.source_event_id = ? OR " +
            "EXISTS (SELECT 1 FROM dm_priority_credits scoped_credit " +
            "WHERE scoped_credit.grant_id = grant_row.grant_id " +
            "AND scoped_credit.target_event_id = ?))",
          values: [scope.guildId, scope.eventId, scope.eventId],
        };
      case "credit":
        return {
          sql:
            "credit.guild_id = ? AND (grant_row.source_event_id = ? OR " +
            "credit.target_event_id = ? OR EXISTS (SELECT 1 FROM " +
            "dm_priority_credit_events scoped_event WHERE " +
            "scoped_event.guild_id = credit.guild_id AND " +
            "scoped_event.credit_id = credit.credit_id AND " +
            "scoped_event.target_event_id = ?))",
          values: [
            scope.guildId, scope.eventId, scope.eventId, scope.eventId,
          ],
        };
      case "credit-event":
        return {
          sql:
            "credit.guild_id = ? AND (grant_row.source_event_id = ? OR " +
            "credit_event.target_event_id = ?)",
          values: [scope.guildId, scope.eventId, scope.eventId],
        };
      case "seating-operation":
        return {
          sql: "operation.guild_id = ? AND operation.event_id = ?",
          values: [scope.guildId, scope.eventId],
        };
      case "seating-event":
        return {
          sql: "decision.guild_id = ? AND decision.event_id = ?",
          values: [scope.guildId, scope.eventId],
        };
      case "notification":
        return {
          sql:
            "notification.guild_id = ? AND (notification.event_id = ? OR " +
            "EXISTS (SELECT 1 FROM dm_priority_grants scoped_grant WHERE " +
            "scoped_grant.guild_id = notification.guild_id AND " +
            "scoped_grant.grant_id = notification.grant_id AND " +
            "scoped_grant.source_event_id = ?))",
          values: [scope.guildId, scope.eventId, scope.eventId],
        };
    }
  }

  switch (area) {
    case "session":
      return {
        sql:
          "session.guild_id = ? AND (" +
          "EXISTS (SELECT 1 FROM plan_tables source_table WHERE " +
          "source_table.table_id = session.source_table_id AND " +
          "source_table.gm_user_id = ?) OR EXISTS (SELECT 1 FROM " +
          "session_completion_revisions scoped_revision WHERE " +
          "scoped_revision.session_id = session.session_id AND " +
          "scoped_revision.actual_dm_user_id = ?) OR EXISTS (SELECT 1 FROM " +
          "session_completion_draft_participants scoped_draft WHERE " +
          "scoped_draft.session_id = session.session_id AND " +
          "scoped_draft.user_id = ?) OR EXISTS (SELECT 1 FROM " +
          "session_completion_participants scoped_participant WHERE " +
          "scoped_participant.session_id = session.session_id AND " +
          "scoped_participant.user_id = ?))",
        values: [
          scope.guildId, scope.memberUserId, scope.memberUserId,
          scope.memberUserId, scope.memberUserId,
        ],
      };
    case "grant":
      return {
        sql: "grant_row.guild_id = ? AND grant_row.dm_user_id = ?",
        values: [scope.guildId, scope.memberUserId],
      };
    case "credit":
    case "credit-event":
      return {
        sql: "credit.guild_id = ? AND credit.user_id = ?",
        values: [scope.guildId, scope.memberUserId],
      };
    case "seating-operation":
      return {
        sql:
          "operation.guild_id = ? AND (operation.user_id = ? OR EXISTS (" +
          "SELECT 1 FROM priority_seating_operation_members scoped_member " +
          "WHERE scoped_member.guild_id = operation.guild_id AND " +
          "scoped_member.operation_key = operation.operation_key AND " +
          "scoped_member.user_id = ?) OR EXISTS (SELECT 1 FROM " +
          "priority_seating_events scoped_decision WHERE " +
          "scoped_decision.guild_id = operation.guild_id AND " +
          "scoped_decision.operation_key = operation.operation_key AND " +
          "scoped_decision.user_id = ?))",
        values: [
          scope.guildId, scope.memberUserId, scope.memberUserId,
          scope.memberUserId,
        ],
      };
    case "seating-event":
      return {
        sql: "decision.guild_id = ? AND decision.user_id = ?",
        values: [scope.guildId, scope.memberUserId],
      };
    case "notification":
      return {
        sql:
          "notification.guild_id = ? AND notification.recipient_user_id = ?",
        values: [scope.guildId, scope.memberUserId],
      };
  }
}

function safeCode(
  value: string | null,
  allowed?: ReadonlySet<string>,
): string | null {
  if (value === null) return null;
  if (allowed) return allowed.has(value) ? value : "other";
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(value)
    ? value
    : "redacted";
}

function safeInteger(value: number | null): number | null {
  return value !== null && Number.isSafeInteger(value) ? value : null;
}

function safeLedgerId(value: string): string | null {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)
    ? value
    : null;
}

function ledgerReferencesFromRows(
  rows: readonly LedgerReferenceRow[],
  limit: number,
): PriorityDiagnosticLedgerReferences {
  const correctGrantIds: string[] = [];
  const refundCreditIds: string[] = [];
  const seen = new Set<string>();
  let truncated = false;
  for (const row of rows) {
    if (row.action_kind !== "correct" && row.action_kind !== "refund") {
      truncated = true;
      continue;
    }
    const id = safeLedgerId(row.entity_id);
    if (!id) {
      truncated = true;
      continue;
    }
    const key = row.action_kind + ":" + id;
    if (seen.has(key)) continue;
    seen.add(key);
    const selected = row.action_kind === "correct"
      ? correctGrantIds
      : refundCreditIds;
    if (selected.length >= limit) {
      truncated = true;
      continue;
    }
    selected.push(id);
  }
  return { correctGrantIds, refundCreditIds, truncated };
}

class AliasBook {
  private readonly aliases = new Map<string, string>();
  private readonly counters = new Map<string, number>();

  reference(kind: string | null, id: string | null): string | null {
    if (!kind || !id) return null;
    const safeKind = REFERENCE_KINDS.has(kind) ? kind : "record";
    const key = safeKind + ":" + id;
    const existing = this.aliases.get(key);
    if (existing) return existing;
    const next = (this.counters.get(safeKind) ?? 0) + 1;
    this.counters.set(safeKind, next);
    const alias = safeKind + "-" + next;
    this.aliases.set(key, alias);
    return alias;
  }
}

function countMetrics(rows: readonly MetricRow[]): PriorityDiagnosticCounts {
  const counts = emptyCounts();
  for (const row of rows) {
    const value =
      Number.isSafeInteger(row.value) && row.value >= 0 ? row.value : 0;
    if (row.metric === "guild.exists") {
      counts.guildExists = value === 1;
      continue;
    }
    if (row.metric === "session.revisions") {
      counts.sessions.revisions = value;
      continue;
    }
    if (row.metric === "session.events") {
      counts.sessions.events = value;
      continue;
    }
    if (row.metric === "seating.operations") {
      counts.seating.operations = value;
      continue;
    }
    const [entity, grouping, key] = row.metric.split(".");
    if (
      entity === "session" && grouping === "reward" && key &&
      key in counts.sessions.rewardSync
    ) {
      counts.sessions.rewardSync[key as SessionRewardSyncStatus] = value;
      counts.sessions.total += value;
    } else if (
      entity === "grant" && grouping === "status" && key &&
      key in counts.grants.byStatus
    ) {
      counts.grants.byStatus[key as DiagnosticGrantStatus] = value;
      counts.grants.total += value;
    } else if (
      entity === "credit" && grouping === "status" && key &&
      key in counts.credits.byStatus
    ) {
      counts.credits.byStatus[key as DiagnosticCreditStatus] = value;
      counts.credits.total += value;
    } else if (
      entity === "credit-event" && grouping === "action" && key &&
      key in counts.creditEvents.byAction
    ) {
      counts.creditEvents.byAction[key as DiagnosticCreditAction] = value;
      counts.creditEvents.total += value;
    } else if (
      entity === "seating" && grouping === "action" && key &&
      key in counts.seating.byAction
    ) {
      counts.seating.byAction[key as DiagnosticSeatingAction] = value;
      counts.seating.events += value;
    } else if (
      entity === "notification" && grouping === "status" && key &&
      key in counts.notifications.byStatus
    ) {
      counts.notifications.byStatus[key as DiagnosticNotificationStatus] =
        value;
      counts.notifications.total += value;
    }
  }
  return counts;
}

function traceFromRows(
  scope: PriorityDiagnosticsScope,
  rows: readonly TraceRow[],
  limit: number,
): { trace: PriorityDiagnosticTrace[]; truncated: boolean } {
  const aliases = new AliasBook();
  const transformed = rows
    .filter(
      (row) => AREAS.has(row.area) && Number.isSafeInteger(row.occurred_at),
    )
    .map((row): PriorityDiagnosticTrace => {
      const entityRef =
        aliases.reference(row.entity_kind, row.entity_id) ?? "record-unknown";
      const correlations = [
        aliases.reference(row.parent_kind, row.parent_id),
        aliases.reference(row.related_kind, row.related_id),
      ].filter(
        (value): value is string => value !== null && value !== entityRef,
      );
      const memberScope =
        scope.kind === "member" ? scope.memberUserId : null;
      const actor =
        row.actor_user_id === null
          ? "system"
          : memberScope
            ? row.actor_user_id === memberScope ? "self" : "external"
            : aliases.reference("member", row.actor_user_id) ?? "external";
      const subject =
        row.subject_user_id === null
          ? null
          : memberScope
            ? row.subject_user_id === memberScope ? "self" : null
            : aliases.reference("member", row.subject_user_id);
      return {
        occurredAt: row.occurred_at,
        area: row.area as PriorityDiagnosticArea,
        action: safeCode(row.action, ACTIONS) ?? "other",
        status: safeCode(row.status, STATUSES),
        entityRef,
        correlations,
        actor,
        subject,
        policyRevision: safeCode(row.policy_revision),
        revision: safeInteger(row.revision_number),
        operationRevision: safeInteger(row.operation_revision),
        configRevision: safeInteger(row.config_revision),
        detailCode: safeCode(row.detail_code, DETAIL_CODES),
        errorCode: safeInteger(row.error_code),
      };
    })
    .sort(
      (left, right) =>
        right.occurredAt - left.occurredAt ||
        left.area.localeCompare(right.area) ||
        left.entityRef.localeCompare(right.entityRef),
    );
  return {
    trace: transformed.slice(0, limit),
    truncated: transformed.length > limit,
  };
}

function compactStatus(
  values: Record<string, number>,
  labels: Record<string, string>,
): string {
  return Object.entries(labels)
    .map(([key, label]) => label + (values[key] ?? 0))
    .join("/");
}

function renderToken(value: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(value)
    ? value
    : "redacted";
}

function renderLedgerIds(
  values: readonly string[],
  budget = 300,
): { text: string; omitted: number } {
  const safe = [...new Set(values.map(safeLedgerId).filter(
    (value): value is string => value !== null,
  ))];
  const rendered: string[] = [];
  let length = 0;
  for (const id of safe) {
    const token = "`" + id + "`";
    const added = (rendered.length === 0 ? 0 : 2) + token.length;
    if (length + added > budget) break;
    rendered.push(token);
    length += added;
  }
  return {
    text: rendered.length > 0 ? rendered.join(", ") : "none",
    omitted: values.length - rendered.length,
  };
}

export function renderPriorityDiagnostics(
  report: PriorityDiagnosticsReport,
  maxLength = 1_900,
): string {
  if (!Number.isInteger(maxLength) || maxLength < 500 || maxLength > 2_000) {
    throw new RangeError(
      "maxLength must be an integer from 500 through 2000",
    );
  }
  const c = report.counts;
  const correctRefs = renderLedgerIds(
    report.ledgerReferences.correctGrantIds,
  );
  const refundRefs = renderLedgerIds(
    report.ledgerReferences.refundCreditIds,
  );
  const referencesOmitted =
    report.ledgerReferences.truncated ||
    correctRefs.omitted > 0 ||
    refundRefs.omitted > 0;
  const lines = [
    "**DM priority diagnostics — " + report.scope + "**",
    c.guildExists
      ? "Private, tenant-scoped view. Raw Discord IDs and free-form text are omitted."
      : "No configured guild matched this tenant scope.",
    "**Admin-only ledger references**",
    "Correct active grants — grant_id: " + correctRefs.text,
    "Refund reserved/redeemed credits — credit_id: " + refundRefs.text,
    referencesOmitted
      ? "… additional ledger references omitted; narrow diagnose by member or event."
      : null,
    "Sessions " + c.sessions.total + " (rev " + c.sessions.revisions +
      ", events " + c.sessions.events + "; sync " +
      compactStatus(c.sessions.rewardSync, {
        pending: "P", synced: "S", failed: "F",
      }) + ")",
    "Grants " + c.grants.total + " (" +
      compactStatus(c.grants.byStatus, { active: "A", corrected: "C" }) +
      "); credits " + c.credits.total + " (" +
      compactStatus(c.credits.byStatus, {
        available: "A", reserved: "Rv", redeemed: "Rd", expired: "E",
        corrected: "C",
      }) + ")",
    "Credit events " + c.creditEvents.total + " (" +
      compactStatus(c.creditEvents.byAction, {
        redeemed: "used ", refunded: "refund ", expired: "expiry ",
        corrected: "correction ",
      }) + ")",
    "Seating ops " + c.seating.operations + ", decisions " +
      c.seating.events + " (displaced " + c.seating.byAction.displaced +
      ", promoted " + c.seating.byAction.promoted + "); notifications " +
      c.notifications.total + " (" +
      compactStatus(c.notifications.byStatus, {
        pending: "P", retry: "R", sent: "S", blocked: "B", failed: "F",
        uncertain: "U",
      }) + ")",
    "**Recent trace**",
  ].filter((value): value is string => value !== null);

  let omitted = report.traceTruncated ? 1 : 0;
  for (const item of report.trace) {
    const attributes = [
      item.status ? "status:" + renderToken(item.status) : null,
      item.revision === null ? null : "rev:" + item.revision,
      item.operationRevision === null
        ? null
        : "op-rev:" + item.operationRevision,
      item.policyRevision
        ? "policy:" + renderToken(item.policyRevision)
        : null,
      item.configRevision === null ? null : "cfg:" + item.configRevision,
      item.detailCode ? "code:" + renderToken(item.detailCode) : null,
      item.errorCode === null ? null : "error:" + item.errorCode,
      "actor:" + renderToken(item.actor),
      item.subject ? "subject:" + renderToken(item.subject) : null,
    ].filter((value): value is string => value !== null);
    const correlations = item.correlations
      .map(renderToken)
      .filter((value) => value !== "redacted");
    const suffix =
      correlations.length > 0 ? " -> " + correlations.join(",") : "";
    const line =
      "<t:" + Math.floor(item.occurredAt / 1_000) + ":f> " +
      renderToken(item.area) + "." + renderToken(item.action) + " [" +
      renderToken(item.entityRef) + suffix + "] " + attributes.join(" ");
    if ([...lines, line].join("\n").length > maxLength - 40) {
      omitted += 1;
    } else {
      lines.push(line);
    }
  }
  if (omitted > 0) {
    const suffix = "… additional trace rows omitted (" + omitted + "+)";
    if ([...lines, suffix].join("\n").length <= maxLength) {
      lines.push(suffix);
    }
  }
  return lines.join("\n").slice(0, maxLength);
}

export class PriorityDiagnosticsService {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => number = Date.now,
  ) {}

  async guild(
    guildId: string,
    limit = 40,
  ): Promise<PriorityDiagnosticsReport> {
    return this.getReport({ kind: "guild", guildId }, limit);
  }

  async event(
    guildId: string,
    eventId: string,
    limit = 40,
  ): Promise<PriorityDiagnosticsReport> {
    return this.getReport({ kind: "event", guildId, eventId }, limit);
  }

  async member(
    guildId: string,
    memberUserId: string,
    limit = 40,
  ): Promise<PriorityDiagnosticsReport> {
    return this.getReport({ kind: "member", guildId, memberUserId }, limit);
  }

  async getReport(
    requestedScope: PriorityDiagnosticsScope,
    limit = 40,
  ): Promise<PriorityDiagnosticsReport> {
    assertLimit(limit);
    const scope: PriorityDiagnosticsScope =
      requestedScope.kind === "guild"
        ? {
            kind: "guild",
            guildId: requireIdentifier(requestedScope.guildId, "guildId"),
          }
        : requestedScope.kind === "event"
          ? {
              kind: "event",
              guildId: requireIdentifier(requestedScope.guildId, "guildId"),
              eventId: requireIdentifier(requestedScope.eventId, "eventId"),
            }
          : {
              kind: "member",
              guildId: requireIdentifier(requestedScope.guildId, "guildId"),
              memberUserId: requireIdentifier(
                requestedScope.memberUserId,
                "memberUserId",
              ),
            };

    const metricResults = await this.db.batch<MetricRow>(
      this.metricStatements(scope),
    );
    const traceResults = await this.db.batch<TraceRow>(
      this.traceStatements(scope, limit + 1),
    );
    const referenceLimit = Math.min(limit, 20);
    const referenceResults = await this.db.batch<LedgerReferenceRow>(
      this.ledgerReferenceStatements(scope, referenceLimit + 1),
    );
    const transformed = traceFromRows(
      scope,
      traceResults.flatMap((result) => result.results),
      limit,
    );
    return {
      scope: scope.kind,
      generatedAt: this.now(),
      counts: countMetrics(
        metricResults.flatMap((result) => result.results),
      ),
      ledgerReferences: ledgerReferencesFromRows(
        referenceResults.flatMap((result) => result.results),
        referenceLimit,
      ),
      trace: transformed.trace,
      traceTruncated: transformed.truncated,
    };
  }

  render(report: PriorityDiagnosticsReport, maxLength = 1_900): string {
    return renderPriorityDiagnostics(report, maxLength);
  }

  private ledgerReferenceStatements(
    scope: PriorityDiagnosticsScope,
    queryLimit: number,
  ): D1PreparedStatement[] {
    const grant = filterFor(scope, "grant");
    const credit = filterFor(scope, "credit");
    return [
      this.db.prepare(
        "SELECT 'correct' AS action_kind, grant_row.grant_id AS entity_id " +
        "FROM dm_priority_grants grant_row WHERE (" + grant.sql + ") " +
        "AND grant_row.status = 'active' ORDER BY grant_row.earned_at DESC, " +
        "grant_row.grant_id ASC LIMIT ?",
      ).bind(...grant.values, queryLimit),
      this.db.prepare(
        "SELECT 'refund' AS action_kind, credit.credit_id AS entity_id " +
        "FROM dm_priority_credits credit JOIN dm_priority_grants grant_row " +
        "ON grant_row.guild_id = credit.guild_id AND grant_row.grant_id = " +
        "credit.grant_id WHERE (" + credit.sql + ") AND credit.status IN " +
        "('reserved', 'redeemed') ORDER BY credit.updated_at DESC, " +
        "credit.credit_id ASC LIMIT ?",
      ).bind(...credit.values, queryLimit),
    ];
  }

  private metricStatements(
    scope: PriorityDiagnosticsScope,
  ): D1PreparedStatement[] {
    const session = filterFor(scope, "session");
    const grant = filterFor(scope, "grant");
    const credit = filterFor(scope, "credit");
    const creditEvent = filterFor(scope, "credit-event");
    const seatingOperation = filterFor(scope, "seating-operation");
    const seatingEvent = filterFor(scope, "seating-event");
    const notification = filterFor(scope, "notification");
    return [
      this.db.prepare(
        "SELECT 'guild.exists' AS metric, COUNT(*) AS value " +
        "FROM guild_config WHERE guild_id = ?",
      ).bind(scope.guildId),
      this.db.prepare(
        "SELECT 'session.reward.' || session.reward_sync_status AS metric, " +
        "COUNT(*) AS value FROM session_completions session WHERE " +
        session.sql + " GROUP BY session.reward_sync_status",
      ).bind(...session.values),
      this.db.prepare(
        "SELECT 'session.revisions' AS metric, COUNT(*) AS value FROM " +
        "session_completion_revisions revision JOIN session_completions " +
        "session ON session.guild_id = revision.guild_id AND " +
        "session.session_id = revision.session_id WHERE " + session.sql,
      ).bind(...session.values),
      this.db.prepare(
        "SELECT 'session.events' AS metric, COUNT(*) AS value FROM " +
        "session_completion_events session_event JOIN session_completions " +
        "session ON session.guild_id = session_event.guild_id AND " +
        "session.session_id = session_event.session_id WHERE " + session.sql,
      ).bind(...session.values),
      this.db.prepare(
        "SELECT 'grant.status.' || grant_row.status AS metric, COUNT(*) AS " +
        "value FROM dm_priority_grants grant_row WHERE " + grant.sql +
        " GROUP BY grant_row.status",
      ).bind(...grant.values),
      this.db.prepare(
        "SELECT 'credit.status.' || credit.status AS metric, COUNT(*) AS " +
        "value FROM dm_priority_credits credit JOIN dm_priority_grants " +
        "grant_row ON grant_row.grant_id = credit.grant_id WHERE " +
        credit.sql + " GROUP BY credit.status",
      ).bind(...credit.values),
      this.db.prepare(
        "SELECT 'credit-event.action.' || credit_event.action AS metric, " +
        "COUNT(*) AS value FROM dm_priority_credit_events credit_event JOIN " +
        "dm_priority_credits credit ON credit.credit_id = " +
        "credit_event.credit_id JOIN dm_priority_grants grant_row ON " +
        "grant_row.grant_id = credit.grant_id WHERE " + creditEvent.sql +
        " GROUP BY credit_event.action",
      ).bind(...creditEvent.values),
      this.db.prepare(
        "SELECT 'seating.operations' AS metric, COUNT(*) AS value FROM " +
        "priority_seating_operations operation WHERE " +
        seatingOperation.sql,
      ).bind(...seatingOperation.values),
      this.db.prepare(
        "SELECT 'seating.action.' || decision.action AS metric, COUNT(*) AS " +
        "value FROM priority_seating_events decision WHERE " +
        seatingEvent.sql + " GROUP BY decision.action",
      ).bind(...seatingEvent.values),
      this.db.prepare(
        "SELECT 'notification.status.' || notification.status AS metric, " +
        "COUNT(*) AS value FROM priority_notification_outbox notification " +
        "WHERE " + notification.sql + " GROUP BY notification.status",
      ).bind(...notification.values),
    ];
  }

  private traceStatements(
    scope: PriorityDiagnosticsScope,
    queryLimit: number,
  ): D1PreparedStatement[] {
    const session = filterFor(scope, "session");
    const grant = filterFor(scope, "grant");
    const creditEvent = filterFor(scope, "credit-event");
    const seatingOperation = filterFor(scope, "seating-operation");
    const seatingEvent = filterFor(scope, "seating-event");
    const notification = filterFor(scope, "notification");
    return [
      this.db.prepare(
        "SELECT revision.confirmed_at AS occurred_at, 'session' AS area, " +
        "revision.result AS action, session.reward_sync_status AS status, " +
        "'completion-revision' AS entity_kind, " +
        "revision.completion_revision_id AS entity_id, 'session' AS " +
        "parent_kind, session.session_id AS parent_id, CASE WHEN " +
        "session.reward_sync_revision_id IS NULL THEN NULL ELSE " +
        "'completion-revision' END AS related_kind, " +
        "session.reward_sync_revision_id AS related_id, " +
        "revision.confirmed_by_user_id AS actor_user_id, " +
        "revision.actual_dm_user_id AS subject_user_id, NULL AS " +
        "policy_revision, revision.revision_number AS revision_number, NULL " +
        "AS operation_revision, NULL AS config_revision, " +
        "session.reward_sync_error_kind AS detail_code, NULL AS error_code " +
        "FROM session_completion_revisions revision JOIN " +
        "session_completions session ON session.guild_id = revision.guild_id " +
        "AND session.session_id = revision.session_id WHERE " + session.sql +
        " ORDER BY revision.confirmed_at DESC LIMIT ?",
      ).bind(...session.values, queryLimit),
      this.db.prepare(
        "SELECT session_event.occurred_at, 'session' AS area, " +
        "session_event.action, session.reward_sync_status AS status, " +
        "'session-event' AS entity_kind, session_event.session_event_id AS " +
        "entity_id, 'session' AS parent_kind, session.session_id AS " +
        "parent_id, CASE WHEN session_event.completion_revision_id IS NULL " +
        "THEN NULL ELSE 'completion-revision' END AS related_kind, " +
        "session_event.completion_revision_id AS related_id, " +
        "session_event.actor_user_id, session_event.subject_user_id, NULL AS " +
        "policy_revision, revision.revision_number, NULL AS " +
        "operation_revision, NULL AS config_revision, " +
        "session.reward_sync_error_kind AS detail_code, NULL AS error_code " +
        "FROM session_completion_events session_event JOIN " +
        "session_completions session ON session.guild_id = " +
        "session_event.guild_id AND session.session_id = " +
        "session_event.session_id LEFT JOIN session_completion_revisions " +
        "revision ON revision.completion_revision_id = " +
        "session_event.completion_revision_id WHERE " + session.sql +
        " ORDER BY session_event.occurred_at DESC LIMIT ?",
      ).bind(...session.values, queryLimit),
      this.db.prepare(
        "SELECT COALESCE(grant_row.corrected_at, grant_row.earned_at) AS " +
        "occurred_at, 'grant' AS area, CASE WHEN grant_row.status = " +
        "'corrected' THEN 'corrected' ELSE 'granted' END AS action, " +
        "grant_row.status, 'grant' AS entity_kind, grant_row.grant_id AS " +
        "entity_id, 'completion-revision' AS parent_kind, " +
        "grant_row.completion_revision_id AS parent_id, 'event' AS " +
        "related_kind, grant_row.source_event_id AS related_id, " +
        "COALESCE(grant_row.corrected_by_user_id, " +
        "grant_row.granted_by_user_id) AS actor_user_id, grant_row.dm_user_id " +
        "AS subject_user_id, grant_row.policy_version AS policy_revision, " +
        "revision.revision_number, NULL AS operation_revision, NULL AS " +
        "config_revision, NULL AS detail_code, NULL AS error_code FROM " +
        "dm_priority_grants grant_row LEFT JOIN " +
        "session_completion_revisions revision ON revision.guild_id = " +
        "grant_row.guild_id AND revision.completion_revision_id = " +
        "grant_row.completion_revision_id WHERE " + grant.sql +
        " ORDER BY occurred_at DESC LIMIT ?",
      ).bind(...grant.values, queryLimit),
      this.db.prepare(
        "SELECT credit_event.occurred_at, 'credit' AS area, " +
        "credit_event.action, credit_event.to_status AS status, " +
        "'credit-event' AS entity_kind, credit_event.credit_event_id AS " +
        "entity_id, 'credit' AS parent_kind, credit.credit_id AS parent_id, " +
        "CASE WHEN credit_event.target_event_id IS NULL THEN NULL ELSE " +
        "'event' END AS related_kind, credit_event.target_event_id AS " +
        "related_id, credit_event.actor_user_id, credit.user_id AS " +
        "subject_user_id, grant_row.policy_version AS policy_revision, " +
        "credit_event.credit_version AS revision_number, NULL AS " +
        "operation_revision, NULL AS config_revision, NULL AS detail_code, " +
        "NULL AS error_code FROM dm_priority_credit_events credit_event JOIN " +
        "dm_priority_credits credit ON credit.credit_id = " +
        "credit_event.credit_id AND credit.guild_id = credit_event.guild_id " +
        "JOIN dm_priority_grants grant_row ON grant_row.grant_id = " +
        "credit.grant_id WHERE " + creditEvent.sql +
        " ORDER BY credit_event.occurred_at DESC LIMIT ?",
      ).bind(...creditEvent.values, queryLimit),
      this.db.prepare(
        "SELECT operation.occurred_at, 'seating' AS area, " +
        "operation.operation_kind AS action, CASE WHEN " +
        "operation.completed_at IS NULL THEN 'incomplete' ELSE 'complete' " +
        "END AS status, 'seating-operation' AS entity_kind, " +
        "operation.operation_key AS entity_id, 'event' AS parent_kind, " +
        "operation.event_id AS parent_id, CASE WHEN " +
        "operation.selected_credit_id IS NULL THEN NULL ELSE 'credit' END AS " +
        "related_kind, operation.selected_credit_id AS related_id, " +
        "operation.actor_user_id, operation.user_id AS subject_user_id, NULL " +
        "AS policy_revision, NULL AS revision_number, COALESCE(" +
        "operation.previous_seat_request_version, (SELECT MAX(" +
        "member.seat_request_version) FROM " +
        "priority_seating_operation_members member WHERE member.guild_id = " +
        "operation.guild_id AND member.operation_key = " +
        "operation.operation_key)) AS operation_revision, NULL AS " +
        "config_revision, NULL AS detail_code, NULL AS error_code FROM " +
        "priority_seating_operations operation WHERE " + seatingOperation.sql +
        " ORDER BY operation.occurred_at DESC LIMIT ?",
      ).bind(...seatingOperation.values, queryLimit),
      this.db.prepare(
        "SELECT decision.occurred_at, 'seating' AS area, decision.action, " +
        "decision.to_status AS status, 'seating-event' AS entity_kind, " +
        "decision.seating_event_id AS entity_id, 'seating-operation' AS " +
        "parent_kind, decision.operation_key AS parent_id, CASE WHEN " +
        "decision.priority_credit_id IS NULL THEN 'assignment' ELSE 'credit' " +
        "END AS related_kind, COALESCE(decision.priority_credit_id, " +
        "decision.assignment_id) AS related_id, decision.actor_user_id, " +
        "decision.user_id AS subject_user_id, NULL AS policy_revision, NULL " +
        "AS revision_number, member.seat_request_version AS " +
        "operation_revision, NULL AS config_revision, decision.reason_code " +
        "AS detail_code, NULL AS error_code FROM priority_seating_events " +
        "decision LEFT JOIN priority_seating_operation_members member ON " +
        "member.guild_id = decision.guild_id AND member.operation_key = " +
        "decision.operation_key AND member.assignment_id = " +
        "decision.assignment_id WHERE " + seatingEvent.sql +
        " ORDER BY decision.occurred_at DESC LIMIT ?",
      ).bind(...seatingEvent.values, queryLimit),
      this.db.prepare(
        "SELECT COALESCE(notification.sent_at, notification.terminal_at, " +
        "notification.updated_at) AS occurred_at, 'notification' AS area, " +
        "notification.notification_kind AS action, notification.status, " +
        "'notification' AS entity_kind, notification.notification_id AS " +
        "entity_id, CASE notification.source_kind WHEN 'grant' THEN 'grant' " +
        "WHEN 'credit_event' THEN 'credit-event' WHEN 'credit' THEN 'credit' " +
        "WHEN 'seating_event' THEN 'seating-event' ELSE NULL END AS " +
        "parent_kind, notification.source_id AS parent_id, CASE WHEN " +
        "notification.event_id IS NULL THEN NULL ELSE 'event' END AS " +
        "related_kind, notification.event_id AS related_id, NULL AS " +
        "actor_user_id, notification.recipient_user_id AS subject_user_id, " +
        "notification.template_revision AS policy_revision, NULL AS " +
        "revision_number, NULL AS operation_revision, " +
        "notification.config_revision, notification.last_error_kind AS " +
        "detail_code, notification.last_error_code AS error_code FROM " +
        "priority_notification_outbox notification WHERE " + notification.sql +
        " ORDER BY occurred_at DESC LIMIT ?",
      ).bind(...notification.values, queryLimit),
    ];
  }
}
