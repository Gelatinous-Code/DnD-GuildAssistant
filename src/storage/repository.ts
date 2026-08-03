import {
  WEEKLY_ROSTER_MAX_ASSIGNMENTS,
  WEEKLY_ROSTER_MAX_ROWS,
  WEEKLY_ROSTER_MAX_TABLES,
  WeeklyExportLimitError,
} from "../weekly-export-contract";
import type { GameTier } from "../domain/game-tier";

export type EventStatus =
  | "draft"
  | "open"
  | "locked"
  | "planned"
  | "published"
  | "archived"
  | "cancelled";

export type SignupKind = "gm" | "player";
export type GmCommitment = "primary" | "backup";
export type SignupStatus = "active" | "withdrawn";
export type SignupSource = "native" | "raid_helper" | "import" | "admin";
export type PlanStatus = "draft" | "published" | "superseded";
export type AssignmentStatus = "unassigned" | "assigned" | "waitlisted" | "withdrawn";
export type RosterStatus = "reserved" | "bench";
export type RosterNotificationStatus = "pending" | "sending" | "retry" | "sent" | "blocked" | "failed";
export type ReminderTrigger = "signup_open" | "signup_lock" | "event_start";
export type ReminderAudience =
  | "configured_role"
  | "active_gms"
  | "active_players"
  | "unassigned_players"
  | "admins"
  | "channel";
export type DeliveryStatus = "pending" | "sending" | "sent" | "failed" | "cancelled";
export type OperationStatus = "started" | "succeeded" | "failed";

export const DEFAULT_REMINDER_LEASE_MS = 5 * 60_000;
export const DEFAULT_OPERATION_LEASE_MS = 10 * 60_000;

export interface GuildConfig {
  guildId: string;
  announcementChannelId?: string | null;
  eventChannelId: string | null;
  gmSignupChannelId?: string | null;
  tableChannelId: string | null;
  reminderChannelId: string | null;
  adminRoleId: string | null;
  gmRoleId: string | null;
  reminderRoleId: string | null;
  timezone: string;
  weeklyDay: number;
  weeklyWeekday?: number;
  weeklyTime: string;
  gmSignupDay?: number | null;
  gmSignupTime?: string | null;
  playerSignupDay?: number | null;
  playerSignupTime?: string | null;
  tablePublishDay?: number | null;
  tablePublishTime?: string | null;
  openSeatingDay?: number | null;
  openSeatingTime?: string | null;
  eventDurationMinutes: number;
  signupOpenLeadDays: number;
  signupLeadDays?: number;
  signupLockLeadHours: number;
  lockLeadHours?: number;
  tableMinSize: number;
  minPlayersPerTable?: number;
  tablePreferredSize: number;
  preferredPlayersPerTable?: number;
  tableMaxSize: number;
  maxPlayersPerTable?: number;
  schedulingEnabled: boolean;
  roleSyncEnabled: boolean;
  autoPublishEnabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface GuildConfigPatch {
  guildId: string;
  announcementChannelId?: string;
  eventChannelId?: string;
  gmSignupChannelId?: string | null;
  tableChannelId?: string;
  reminderChannelId?: string;
  adminRoleId?: string | null;
  gmRoleId?: string | null;
  reminderRoleId?: string | null;
  timezone?: string;
  weeklyDay?: number;
  weeklyWeekday?: number;
  weeklyTime?: string;
  gmSignupDay?: number;
  gmSignupTime?: string;
  playerSignupDay?: number;
  playerSignupTime?: string;
  tablePublishDay?: number;
  tablePublishTime?: string;
  openSeatingDay?: number;
  openSeatingTime?: string;
  eventDurationMinutes?: number;
  signupOpenLeadDays?: number;
  signupLeadDays?: number;
  signupLockLeadHours?: number;
  lockLeadHours?: number;
  tableMinSize?: number;
  minPlayersPerTable?: number;
  tablePreferredSize?: number;
  preferredPlayersPerTable?: number;
  tableMaxSize?: number;
  maxPlayersPerTable?: number;
  schedulingEnabled?: boolean;
  roleSyncEnabled?: boolean;
  autoPublishEnabled?: boolean;
}

export interface WeeklyEvent {
  eventId: string;
  guildId: string;
  title: string;
  startsAt: number;
  endsAt: number | null;
  signupOpensAt: number;
  playerSignupOpensAt?: number;
  signupLocksAt: number;
  openSeatingAt?: number;
  tableSelectionClosesAt: number;
  reminderAt?: number | null;
  status: EventStatus;
  source: SignupSource;
  sourceExternalId: string | null;
  signupChannelId: string | null;
  signupMessageId: string | null;
  gmSignupChannelId?: string | null;
  gmSignupMessageId?: string | null;
  tableChannelId: string | null;
  tableMessageId: string | null;
  finalManifestChannelId: string | null;
  finalManifestMessageId: string | null;
  tableStateVersion: number;
  finalizedPlanId: string | null;
  finalizedTableStateVersion: number | null;
  tablesFinalizedAt: number | null;
  createdByUserId: string | null;
  createdAt: number;
  updatedAt: number;
  publishedAt: number | null;
  archivedAt: number | null;
}

export interface CreateWeeklyEventInput {
  eventId: string;
  guildId: string;
  title: string;
  startsAt: number;
  endsAt?: number;
  signupOpensAt: number;
  playerSignupOpensAt?: number;
  signupLocksAt: number;
  openSeatingAt?: number;
  tableSelectionClosesAt?: number;
  reminderAt?: number;
  status?: EventStatus;
  source?: SignupSource;
  sourceExternalId?: string;
  createdByUserId?: string;
}

export interface Signup {
  eventId: string;
  userId: string;
  displayName: string;
  signupKind: SignupKind;
  gameTier: GameTier | null;
  gmCommitment: GmCommitment | null;
  status: SignupStatus;
  source: SignupSource;
  sourceExternalId: string | null;
  signedUpAt: number;
  withdrawnAt: number | null;
  updatedAt: number;
}

export interface SaveSignupInput {
  eventId: string;
  userId: string;
  displayName: string;
  signupKind: SignupKind;
  gameTier?: GameTier | null;
  gmCommitment?: GmCommitment | null;
  source?: SignupSource;
  sourceExternalId?: string;
  signedUpAt?: number;
}

export interface SignupCounts {
  players: number;
  gms: number;
  gmBackups: number;
}

export interface Plan {
  planId: string;
  eventId: string;
  generation: number;
  status: PlanStatus;
  algorithmVersion: string;
  minTableSize: number;
  preferredTableSize: number;
  maxTableSize: number;
  playerCount: number;
  gmSignupCount: number;
  selectedGmCount: number;
  waitlistCount: number;
  createdByUserId: string | null;
  createdAt: number;
  publishedAt: number | null;
}

export interface PlanTable {
  tableId: string;
  planId: string;
  tableNumber: number;
  gameTier: GameTier;
  title: string;
  capacity: number;
  gmUserId: string;
  gmDisplayName: string;
  channelId: string | null;
  messageId: string | null;
  createdAt: number;
}

export interface Assignment {
  assignmentId: string;
  planId: string;
  tableId: string | null;
  desiredTableId: string | null;
  userId: string;
  displayName: string;
  gameTier: GameTier;
  status: AssignmentStatus;
  waitlistPosition: number | null;
  assignedAt: number | null;
  updatedAt: number;
  rosterStatus?: RosterStatus | null;
  rosterRank?: number | null;
  rosterPromotedAt?: number | null;
}

export interface SaveDraftPlanInput {
  plan: Omit<Plan, "status" | "createdAt" | "publishedAt"> & { createdAt?: number };
  tables: Array<
    Omit<PlanTable, "planId" | "channelId" | "messageId" | "createdAt"> & {
      channelId?: string;
      messageId?: string;
    }
  >;
  assignments: Array<
    Omit<Assignment, "planId" | "assignedAt" | "updatedAt" | "desiredTableId"> & {
      desiredTableId?: string;
      assignedAt?: number;
    }
  >;
}

export interface PlanBundle {
  plan: Plan;
  tables: PlanTable[];
  assignments: Assignment[];
}

export interface WeeklyExportSnapshot {
  event: WeeklyEvent;
  signups: Signup[];
  planBundle: PlanBundle | null;
}

export interface JoinTableResult {
  outcome: "assigned" | "waitlisted";
  position: number | null;
  assignment: Assignment;
  promoted: Assignment | null;
}

export interface LeaveTableResult {
  left: boolean;
  assignment: Assignment | null;
  promoted: Assignment | null;
  rosterPromoted?: Assignment | null;
}

export interface RosterPromotionNotification {
  assignmentId: string;
  guildId: string;
  eventId: string;
  planId: string;
  recipientUserId: string;
  displayName: string;
  eventTitle: string;
  gameTier: GameTier;
  openSeatingAt: number;
  eventStartsAt: number;
  attemptCount: number;
}

export interface RosterNotificationDeliveryResult {
  assignmentId: string;
  status: "sent" | "retry" | "blocked" | "failed";
  nextAttemptAt?: number | null;
  error?: string;
}
export class TableSelectionUnavailableError extends Error {
  constructor() {
    super("Table selection is closed or the published plan changed");
    this.name = "TableSelectionUnavailableError";
  }
}

export interface GmSelectionStats {
  gmUserId: string;
  selectionCount: number;
  lastSelectedAt: number;
}

export interface RoleLease {
  leaseId: string;
  guildId: string;
  eventId: string | null;
  userId: string;
  roleId: string;
  reason: string;
  grantedAt: number;
  lastVerifiedAt: number | null;
  releasedAt: number | null;
  releaseReason: string | null;
}

export interface ReminderRule {
  ruleId: string;
  guildId: string;
  name: string;
  triggerKind: ReminderTrigger;
  offsetMinutes: number;
  audienceKind: ReminderAudience;
  roleId: string | null;
  channelId: string | null;
  messageTemplate: string;
  mentionRole: boolean;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SaveReminderRuleInput
  extends Omit<ReminderRule, "createdAt" | "updatedAt" | "roleId" | "channelId"> {
  roleId?: string;
  channelId?: string;
}

export interface ReminderDelivery {
  deliveryId: string;
  ruleId: string | null;
  eventId: string;
  channelId: string;
  recipientKind: "channel" | "role" | "user";
  recipientId: string | null;
  content: string;
  scheduledFor: number;
  status: DeliveryStatus;
  idempotencyKey: string;
  attemptCount: number;
  nextAttemptAt: number | null;
  lastError: string | null;
  sentMessageId: string | null;
  createdAt: number;
  updatedAt: number;
  sentAt: number | null;
}

export interface EnqueueReminderInput {
  deliveryId: string;
  ruleId?: string;
  eventId: string;
  channelId: string;
  recipientKind: "channel" | "role" | "user";
  recipientId?: string;
  content: string;
  scheduledFor: number;
  idempotencyKey: string;
}

export interface OperationRecord {
  operationKey: string;
  guildId: string;
  eventId: string | null;
  operationKind: string;
  status: OperationStatus;
  request: unknown | null;
  result: unknown | null;
  lastError: string | null;
  startedAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface BeginOperationResult {
  claimed: boolean;
  operation: OperationRecord;
}

export interface AuditEntry {
  auditId: number;
  guildId: string;
  eventId: string | null;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  details: unknown | null;
  createdAt: number;
}

type GuildConfigRow = {
  guild_id: string;
  event_channel_id: string | null;
  table_channel_id: string | null;
  gm_signup_channel_id: string | null;
  reminder_channel_id: string | null;
  admin_role_id: string | null;
  gm_role_id: string | null;
  reminder_role_id: string | null;
  timezone: string;
  weekly_day: number;
  weekly_time: string;
  event_duration_minutes: number;
  signup_open_lead_days: number;
  signup_lock_lead_hours: number;
  gm_signup_day: number | null;
  gm_signup_time: string | null;
  player_signup_day: number | null;
  player_signup_time: string | null;
  table_publish_day: number | null;
  table_publish_time: string | null;
  open_seating_day: number | null;
  open_seating_time: string | null;
  table_min_size: number;
  table_preferred_size: number;
  table_max_size: number;
  scheduling_enabled: number;
  role_sync_enabled: number;
  auto_publish_enabled: number;
  created_at: number;
  updated_at: number;
};

type WeeklyEventRow = {
  event_id: string;
  guild_id: string;
  title: string;
  starts_at: number;
  ends_at: number | null;
  signup_opens_at: number;
  player_signup_opens_at: number | null;
  signup_locks_at: number;
  open_seating_at: number | null;
  table_selection_closes_at: number | null;
  reminder_at: number | null;
  status: EventStatus;
  source: SignupSource;
  source_external_id: string | null;
  signup_channel_id: string | null;
  signup_message_id: string | null;
  table_channel_id: string | null;
  gm_signup_channel_id: string | null;
  gm_signup_message_id: string | null;
  table_message_id: string | null;
  final_manifest_channel_id: string | null;
  final_manifest_message_id: string | null;
  table_state_version: number;
  finalized_plan_id: string | null;
  finalized_table_state_version: number | null;
  tables_finalized_at: number | null;
  created_by_user_id: string | null;
  created_at: number;
  updated_at: number;
  published_at: number | null;
  archived_at: number | null;
};

type SignupRow = {
  event_id: string;
  user_id: string;
  display_name: string;
  signup_kind: SignupKind;
  game_tier: GameTier | null;
  gm_commitment: GmCommitment | null;
  status: SignupStatus;
  source: SignupSource;
  source_external_id: string | null;
  signed_up_at: number;
  withdrawn_at: number | null;
  updated_at: number;
};

type PlanRow = {
  plan_id: string;
  event_id: string;
  generation: number;
  status: PlanStatus;
  algorithm_version: string;
  min_table_size: number;
  preferred_table_size: number;
  max_table_size: number;
  player_count: number;
  gm_signup_count: number;
  selected_gm_count: number;
  waitlist_count: number;
  created_by_user_id: string | null;
  created_at: number;
  published_at: number | null;
};

type PlanTableRow = {
  table_id: string;
  plan_id: string;
  table_number: number;
  game_tier: GameTier;
  title: string;
  capacity: number;
  gm_user_id: string;
  gm_display_name: string;
  channel_id: string | null;
  message_id: string | null;
  created_at: number;
};

type AssignmentRow = {
  assignment_id: string;
  plan_id: string;
  table_id: string | null;
  desired_table_id: string | null;
  user_id: string;
  display_name: string;
  game_tier: GameTier;
  status: AssignmentStatus;
  waitlist_position: number | null;
  assigned_at: number | null;
  roster_status: RosterStatus | null;
  roster_rank: number | null;
  roster_promoted_at: number | null;
  roster_notification_status: RosterNotificationStatus | null;
  roster_notification_attempt_count: number;
  roster_notification_next_attempt_at: number | null;
  roster_notification_claimed_at: number | null;
  roster_notification_last_error: string | null;
  roster_notification_channel_id: string | null;
  roster_notification_message_id: string | null;
  roster_notification_sent_at: number | null;
  updated_at: number;
};

type RoleLeaseRow = {
  lease_id: string;
  guild_id: string;
  event_id: string | null;
  user_id: string;
  role_id: string;
  reason: string;
  granted_at: number;
  last_verified_at: number | null;
  released_at: number | null;
  release_reason: string | null;
};

type ReminderRuleRow = {
  rule_id: string;
  guild_id: string;
  name: string;
  trigger_kind: ReminderTrigger;
  offset_minutes: number;
  audience_kind: ReminderAudience;
  role_id: string | null;
  channel_id: string | null;
  message_template: string;
  mention_role: number;
  enabled: number;
  created_at: number;
  updated_at: number;
};

type ReminderDeliveryRow = {
  delivery_id: string;
  rule_id: string | null;
  event_id: string;
  channel_id: string;
  recipient_kind: "channel" | "role" | "user";
  recipient_id: string | null;
  content: string;
  scheduled_for: number;
  status: DeliveryStatus;
  idempotency_key: string;
  attempt_count: number;
  next_attempt_at: number | null;
  last_error: string | null;
  sent_message_id: string | null;
  created_at: number;
  updated_at: number;
  sent_at: number | null;
};

type OperationRow = {
  operation_key: string;
  guild_id: string;
  event_id: string | null;
  operation_kind: string;
  status: OperationStatus;
  request_json: string | null;
  result_json: string | null;
  last_error: string | null;
  started_at: number;
  updated_at: number;
  completed_at: number | null;
};

type AuditRow = {
  audit_id: number;
  guild_id: string;
  event_id: string | null;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details_json: string | null;
  created_at: number;
};

function asNullable<T>(value: T | undefined): T | null {
  return value ?? null;
}

function parseJson(value: string | null): unknown | null {
  if (value === null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function stringifyJson(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

function guildConfigFromRow(row: GuildConfigRow): GuildConfig {
  return {
    guildId: row.guild_id,
    announcementChannelId: row.event_channel_id,
    eventChannelId: row.event_channel_id,
    tableChannelId: row.table_channel_id,
    reminderChannelId: row.reminder_channel_id,
    gmSignupChannelId: row.gm_signup_channel_id,
    adminRoleId: row.admin_role_id,
    gmRoleId: null,
    reminderRoleId: row.reminder_role_id,
    timezone: row.timezone,
    weeklyDay: row.weekly_day,
    weeklyWeekday: row.weekly_day,
    weeklyTime: row.weekly_time,
    eventDurationMinutes: row.event_duration_minutes,
    signupOpenLeadDays: row.signup_open_lead_days,
    signupLeadDays: row.signup_open_lead_days,
    signupLockLeadHours: row.signup_lock_lead_hours,
    lockLeadHours: row.signup_lock_lead_hours,
    tableMinSize: row.table_min_size,
    minPlayersPerTable: row.table_min_size,
    tablePreferredSize: row.table_preferred_size,
    gmSignupDay: row.gm_signup_day,
    gmSignupTime: row.gm_signup_time,
    playerSignupDay: row.player_signup_day,
    playerSignupTime: row.player_signup_time,
    tablePublishDay: row.table_publish_day,
    tablePublishTime: row.table_publish_time,
    openSeatingDay: row.open_seating_day,
    openSeatingTime: row.open_seating_time,
    preferredPlayersPerTable: row.table_preferred_size,
    tableMaxSize: row.table_max_size,
    maxPlayersPerTable: row.table_max_size,
    schedulingEnabled: row.scheduling_enabled === 1,
    roleSyncEnabled: false,
    autoPublishEnabled: row.auto_publish_enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function eventFromRow(row: WeeklyEventRow): WeeklyEvent {
  return {
    eventId: row.event_id,
    guildId: row.guild_id,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    signupOpensAt: row.signup_opens_at,
    playerSignupOpensAt: row.player_signup_opens_at ?? row.signup_opens_at,
    signupLocksAt: row.signup_locks_at,
    openSeatingAt: row.open_seating_at ?? row.signup_locks_at,
    tableSelectionClosesAt: row.table_selection_closes_at ?? row.starts_at,
    reminderAt: row.reminder_at,
    status: row.status,
    source: row.source,
    sourceExternalId: row.source_external_id,
    signupChannelId: row.signup_channel_id,
    signupMessageId: row.signup_message_id,
    tableChannelId: row.table_channel_id,
    tableMessageId: row.table_message_id,
    gmSignupChannelId: row.gm_signup_channel_id,
    gmSignupMessageId: row.gm_signup_message_id,
    finalManifestChannelId: row.final_manifest_channel_id,
    finalManifestMessageId: row.final_manifest_message_id,
    tableStateVersion: row.table_state_version ?? 0,
    finalizedPlanId: row.finalized_plan_id ?? null,
    finalizedTableStateVersion: row.finalized_table_state_version ?? null,
    tablesFinalizedAt: row.tables_finalized_at ?? null,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    archivedAt: row.archived_at,
  };
}

function signupFromRow(row: SignupRow): Signup {
  return {
    eventId: row.event_id,
    userId: row.user_id,
    displayName: row.display_name,
    signupKind: row.signup_kind,
    gameTier: row.game_tier,
    gmCommitment: row.gm_commitment,
    status: row.status,
    source: row.source,
    sourceExternalId: row.source_external_id,
    signedUpAt: row.signed_up_at,
    withdrawnAt: row.withdrawn_at,
    updatedAt: row.updated_at,
  };
}

function planFromRow(row: PlanRow): Plan {
  return {
    planId: row.plan_id,
    eventId: row.event_id,
    generation: row.generation,
    status: row.status,
    algorithmVersion: row.algorithm_version,
    minTableSize: row.min_table_size,
    preferredTableSize: row.preferred_table_size,
    maxTableSize: row.max_table_size,
    playerCount: row.player_count,
    gmSignupCount: row.gm_signup_count,
    selectedGmCount: row.selected_gm_count,
    waitlistCount: row.waitlist_count,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    publishedAt: row.published_at,
  };
}

function tableFromRow(row: PlanTableRow): PlanTable {
  return {
    tableId: row.table_id,
    planId: row.plan_id,
    tableNumber: row.table_number,
    gameTier: row.game_tier,
    title: row.title,
    capacity: row.capacity,
    gmUserId: row.gm_user_id,
    gmDisplayName: row.gm_display_name,
    channelId: row.channel_id,
    messageId: row.message_id,
    createdAt: row.created_at,
  };
}

function assignmentFromRow(row: AssignmentRow): Assignment {
  return {
    assignmentId: row.assignment_id,
    planId: row.plan_id,
    tableId: row.table_id,
    desiredTableId: row.desired_table_id,
    userId: row.user_id,
    displayName: row.display_name,
    gameTier: row.game_tier,
    status: row.status,
    waitlistPosition: row.waitlist_position,
    assignedAt: row.assigned_at,
    rosterStatus: row.roster_status,
    rosterRank: row.roster_rank,
    rosterPromotedAt: row.roster_promoted_at,
    updatedAt: row.updated_at,
  };
}

function roleLeaseFromRow(row: RoleLeaseRow): RoleLease {
  return {
    leaseId: row.lease_id,
    guildId: row.guild_id,
    eventId: row.event_id,
    userId: row.user_id,
    roleId: row.role_id,
    reason: row.reason,
    grantedAt: row.granted_at,
    lastVerifiedAt: row.last_verified_at,
    releasedAt: row.released_at,
    releaseReason: row.release_reason,
  };
}

function reminderRuleFromRow(row: ReminderRuleRow): ReminderRule {
  return {
    ruleId: row.rule_id,
    guildId: row.guild_id,
    name: row.name,
    triggerKind: row.trigger_kind,
    offsetMinutes: row.offset_minutes,
    audienceKind: row.audience_kind,
    roleId: row.role_id,
    channelId: row.channel_id,
    messageTemplate: row.message_template,
    mentionRole: row.mention_role === 1,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function deliveryFromRow(row: ReminderDeliveryRow): ReminderDelivery {
  return {
    deliveryId: row.delivery_id,
    ruleId: row.rule_id,
    eventId: row.event_id,
    channelId: row.channel_id,
    recipientKind: row.recipient_kind,
    recipientId: row.recipient_id,
    content: row.content,
    scheduledFor: row.scheduled_for,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    sentMessageId: row.sent_message_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at,
  };
}

function operationFromRow(row: OperationRow): OperationRecord {
  return {
    operationKey: row.operation_key,
    guildId: row.guild_id,
    eventId: row.event_id,
    operationKind: row.operation_kind,
    status: row.status,
    request: parseJson(row.request_json),
    result: parseJson(row.result_json),
    lastError: row.last_error,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export class GuildRepository {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => number = Date.now,
  ) {}

  async getGuildConfig(guildId: string): Promise<GuildConfig | null> {
    const row = await this.db
      .prepare("SELECT * FROM guild_config WHERE guild_id = ?")
      .bind(guildId)
      .first<GuildConfigRow>();
    return row ? guildConfigFromRow(row) : null;
  }

  async listSchedulingGuilds(): Promise<GuildConfig[]> {
    const result = await this.db
      .prepare("SELECT * FROM guild_config WHERE scheduling_enabled = 1 ORDER BY guild_id ASC")
      .all<GuildConfigRow>();
    return result.results.map(guildConfigFromRow);
  }

  async saveGuildConfig(input: GuildConfigPatch): Promise<GuildConfig> {
    const now = this.now();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT OR IGNORE INTO guild_config (guild_id, created_at, updated_at)
           VALUES (?, ?, ?)`,
        )
        .bind(input.guildId, now, now),
      this.db
        .prepare(
          `UPDATE guild_config SET
             event_channel_id = COALESCE(?, event_channel_id),
             gm_signup_channel_id = CASE WHEN ? = 1 THEN ? ELSE gm_signup_channel_id END,
             table_channel_id = COALESCE(?, table_channel_id),
             reminder_channel_id = COALESCE(?, reminder_channel_id),
             admin_role_id = CASE WHEN ? = 1 THEN ? ELSE admin_role_id END,
             gm_role_id = CASE WHEN ? = 1 THEN ? ELSE gm_role_id END,
             reminder_role_id = CASE WHEN ? = 1 THEN ? ELSE reminder_role_id END,
             timezone = COALESCE(?, timezone),
             weekly_day = COALESCE(?, weekly_day),
             weekly_time = COALESCE(?, weekly_time),
             event_duration_minutes = COALESCE(?, event_duration_minutes),
             signup_open_lead_days = COALESCE(?, signup_open_lead_days),
             signup_lock_lead_hours = COALESCE(?, signup_lock_lead_hours),
             table_min_size = COALESCE(?, table_min_size),
             table_preferred_size = COALESCE(?, table_preferred_size),
             table_max_size = COALESCE(?, table_max_size),
             scheduling_enabled = COALESCE(?, scheduling_enabled),
             role_sync_enabled = COALESCE(?, role_sync_enabled),
             gm_signup_day = COALESCE(?, gm_signup_day),
             gm_signup_time = COALESCE(?, gm_signup_time),
             player_signup_day = COALESCE(?, player_signup_day),
             player_signup_time = COALESCE(?, player_signup_time),
             table_publish_day = COALESCE(?, table_publish_day),
             table_publish_time = COALESCE(?, table_publish_time),
             open_seating_day = COALESCE(?, open_seating_day),
             open_seating_time = COALESCE(?, open_seating_time),
             auto_publish_enabled = COALESCE(?, auto_publish_enabled),
             updated_at = ?
           WHERE guild_id = ?`,
        )
        .bind(
          asNullable(input.announcementChannelId ?? input.eventChannelId),
          Number(input.gmSignupChannelId !== undefined),
          asNullable(input.gmSignupChannelId),
          asNullable(input.tableChannelId),
          asNullable(input.reminderChannelId),
          Number(input.adminRoleId !== undefined),
          asNullable(input.adminRoleId),
          1,
          null,
          Number(input.reminderRoleId !== undefined),
          asNullable(input.reminderRoleId),
          asNullable(input.timezone),
          asNullable(input.weeklyWeekday ?? input.weeklyDay),
          asNullable(input.weeklyTime),
          asNullable(input.eventDurationMinutes),
          asNullable(input.signupLeadDays ?? input.signupOpenLeadDays),
          asNullable(input.lockLeadHours ?? input.signupLockLeadHours),
          asNullable(input.minPlayersPerTable ?? input.tableMinSize),
          asNullable(input.preferredPlayersPerTable ?? input.tablePreferredSize),
          asNullable(input.maxPlayersPerTable ?? input.tableMaxSize),
          input.schedulingEnabled === undefined ? null : Number(input.schedulingEnabled),
          0,
          asNullable(input.gmSignupDay),
          asNullable(input.gmSignupTime),
          asNullable(input.playerSignupDay),
          asNullable(input.playerSignupTime),
          asNullable(input.tablePublishDay),
          asNullable(input.tablePublishTime),
          asNullable(input.openSeatingDay),
          asNullable(input.openSeatingTime),
          input.autoPublishEnabled === undefined ? null : Number(input.autoPublishEnabled),
          now,
          input.guildId,
        ),
    ]);
    const saved = await this.getGuildConfig(input.guildId);
    if (!saved) throw new Error("Guild configuration was not saved");
    return saved;
  }

  async createWeeklyEvent(input: CreateWeeklyEventInput): Promise<WeeklyEvent> {
    const now = this.now();
    await this.db
      .prepare(
        `INSERT INTO weekly_events (
           event_id, guild_id, title, starts_at, ends_at, signup_opens_at,
           player_signup_opens_at, signup_locks_at, open_seating_at,
           table_selection_closes_at, reminder_at, status, source, source_external_id,
           created_by_user_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.eventId,
        input.guildId,
        input.title,
        input.startsAt,
        asNullable(input.endsAt),
        input.signupOpensAt,
        input.playerSignupOpensAt ?? input.signupOpensAt,
        input.signupLocksAt,
        input.openSeatingAt ?? input.signupLocksAt,
        input.tableSelectionClosesAt ?? input.startsAt,
        asNullable(input.reminderAt),
        input.status ?? "draft",
        input.source ?? "native",
        asNullable(input.sourceExternalId),
        asNullable(input.createdByUserId),
        now,
        now,
      )
      .run();
    const event = await this.getWeeklyEvent(input.eventId);
    if (!event) throw new Error("Weekly event was not created");
    return event;
  }

  async getWeeklyEvent(eventId: string): Promise<WeeklyEvent | null> {
    const row = await this.db
      .prepare("SELECT * FROM weekly_events WHERE event_id = ?")
      .bind(eventId)
      .first<WeeklyEventRow>();
    return row ? eventFromRow(row) : null;
  }

  async getLatestWeeklyEvent(guildId: string): Promise<WeeklyEvent | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM weekly_events
         WHERE guild_id = ?
         ORDER BY starts_at DESC
         LIMIT 1`,
      )
      .bind(guildId)
      .first<WeeklyEventRow>();
    return row ? eventFromRow(row) : null;
  }

  async findWeeklyEventByStart(guildId: string, startsAt: number): Promise<WeeklyEvent | null> {
    const row = await this.db
      .prepare("SELECT * FROM weekly_events WHERE guild_id = ? AND starts_at = ?")
      .bind(guildId, startsAt)
      .first<WeeklyEventRow>();
    return row ? eventFromRow(row) : null;
  }

  async getCurrentWeeklyEvent(guildId: string): Promise<WeeklyEvent | null> {
    const now = this.now();
    const row = await this.db
      .prepare(
        `SELECT * FROM weekly_events
         WHERE guild_id = ? AND status NOT IN ('archived', 'cancelled')
         ORDER BY
           CASE WHEN starts_at > ? THEN 0 ELSE 1 END ASC,
           CASE WHEN starts_at > ? THEN starts_at END ASC,
           CASE WHEN starts_at <= ? THEN starts_at END DESC
         LIMIT 1`,
      )
      .bind(guildId, now, now, now)
      .first<WeeklyEventRow>();
    return row ? eventFromRow(row) : null;
  }

  /**
   * Read one complete export view in a single D1 batch transaction. Each
   * statement repeats the same tenant-scoped event and authoritative-plan
   * selection so no application-side identifier from an earlier read is
   * needed to construct a later query.
   */
  async getWeeklyExportSnapshot(
    guildId: string,
    eventId?: string,
  ): Promise<WeeklyExportSnapshot | null> {
    const selectionValues: Array<string | number> = eventId
      ? [eventId, guildId]
      : [guildId, this.now()];
    const selectedEventSql = eventId
      ? `SELECT * FROM weekly_events
         WHERE event_id = ?1 AND guild_id = ?2
         LIMIT 1`
      : `SELECT * FROM weekly_events
         WHERE guild_id = ?1
         ORDER BY
           CASE WHEN status NOT IN ('archived', 'cancelled') THEN 0 ELSE 1 END ASC,
           CASE
             WHEN status NOT IN ('archived', 'cancelled') AND starts_at > ?2 THEN 0
             WHEN status NOT IN ('archived', 'cancelled') THEN 1
             ELSE 2
           END ASC,
           CASE
             WHEN status NOT IN ('archived', 'cancelled') AND starts_at > ?2
             THEN starts_at
           END ASC,
           CASE
             WHEN status NOT IN ('archived', 'cancelled') AND starts_at <= ?2
             THEN starts_at
           END DESC,
           CASE
             WHEN status IN ('archived', 'cancelled') THEN starts_at
           END DESC
         LIMIT 1`;
    const selectedEventCte = `selected_event AS (${selectedEventSql})`;
    const selectedPlanCte = `selected_plan AS (
      SELECT plans.*
      FROM plans
      INNER JOIN selected_event event ON event.event_id = plans.event_id
      WHERE plans.status IN ('draft', 'published')
      ORDER BY
        CASE plans.status WHEN 'published' THEN 0 ELSE 1 END,
        plans.generation DESC
      LIMIT 1
    )`;

    const results = await this.db.batch<
      WeeklyEventRow | SignupRow | PlanRow | PlanTableRow | AssignmentRow
    >([
      this.db
        .prepare(`WITH ${selectedEventCte} SELECT * FROM selected_event`)
        .bind(...selectionValues),
      this.db
        .prepare(
          `WITH ${selectedEventCte}
           SELECT signups.*
           FROM signups
           INNER JOIN selected_event event ON event.event_id = signups.event_id
           ORDER BY
             CASE WHEN signups.status = 'active' THEN 0 ELSE 1 END,
             signups.signup_kind ASC,
             signups.signed_up_at ASC,
             signups.user_id ASC
           LIMIT ?3`,
        )
        .bind(...selectionValues, WEEKLY_ROSTER_MAX_ROWS + 1),
      this.db
        .prepare(
          `WITH ${selectedEventCte}, ${selectedPlanCte}
           SELECT * FROM selected_plan`,
        )
        .bind(...selectionValues),
      this.db
        .prepare(
          `WITH ${selectedEventCte}, ${selectedPlanCte}
           SELECT plan_tables.*
           FROM plan_tables
           INNER JOIN selected_plan plan ON plan.plan_id = plan_tables.plan_id
           ORDER BY plan_tables.table_number ASC
           LIMIT ?3`,
        )
        .bind(...selectionValues, WEEKLY_ROSTER_MAX_TABLES + 1),
      this.db
        .prepare(
          `WITH ${selectedEventCte}, ${selectedPlanCte}
           SELECT assignments.*
           FROM assignments
           INNER JOIN selected_plan plan ON plan.plan_id = assignments.plan_id
           ORDER BY
             CASE assignments.status
               WHEN 'assigned' THEN 0
               WHEN 'unassigned' THEN 1
               WHEN 'waitlisted' THEN 2
               ELSE 3
             END,
             assignments.waitlist_position ASC,
             assignments.display_name ASC
           LIMIT ?3`,
        )
        .bind(...selectionValues, WEEKLY_ROSTER_MAX_ASSIGNMENTS + 1),
    ]);

    const eventRows = (results[0]?.results ?? []) as WeeklyEventRow[];
    const signupRows = (results[1]?.results ?? []) as SignupRow[];
    const planRows = (results[2]?.results ?? []) as PlanRow[];
    const tableRows = (results[3]?.results ?? []) as PlanTableRow[];
    const assignmentRows = (results[4]?.results ?? []) as AssignmentRow[];
    const eventRow = eventRows[0];
    if (!eventRow) return null;

    if (signupRows.length > WEEKLY_ROSTER_MAX_ROWS) {
      throw new WeeklyExportLimitError(
        "rows",
        WEEKLY_ROSTER_MAX_ROWS,
        signupRows.length,
      );
    }
    if (assignmentRows.length > WEEKLY_ROSTER_MAX_ASSIGNMENTS) {
      throw new WeeklyExportLimitError(
        "assignments",
        WEEKLY_ROSTER_MAX_ASSIGNMENTS,
        assignmentRows.length,
      );
    }
    if (tableRows.length > WEEKLY_ROSTER_MAX_TABLES) {
      throw new WeeklyExportLimitError(
        "tables",
        WEEKLY_ROSTER_MAX_TABLES,
        tableRows.length,
      );
    }

    const planRow = planRows[0];
    return {
      event: eventFromRow(eventRow),
      signups: signupRows.map(signupFromRow),
      planBundle: planRow
        ? {
            plan: planFromRow(planRow),
            tables: tableRows.map(tableFromRow),
            assignments: assignmentRows.map(assignmentFromRow),
          }
        : null,
    };
  }

  async getCurrentPublishedEvent(guildId: string): Promise<WeeklyEvent | null> {
    const now = this.now();
    const row = await this.db
      .prepare(
        `SELECT * FROM weekly_events
         WHERE guild_id = ? AND status = 'published'
         ORDER BY
           CASE WHEN starts_at <= ? THEN 0 ELSE 1 END ASC,
           CASE WHEN starts_at <= ? THEN starts_at END DESC,
           CASE WHEN starts_at > ? THEN starts_at END ASC
         LIMIT 1`,
      )
      .bind(guildId, now, now, now)
      .first<WeeklyEventRow>();
    return row ? eventFromRow(row) : null;
  }

  async listEventsForScheduler(through: number): Promise<WeeklyEvent[]> {
    const result = await this.db
      .prepare(
        `SELECT * FROM weekly_events
         WHERE (
           status NOT IN ('archived', 'cancelled')
           AND (
             signup_opens_at <= ? OR signup_locks_at <= ?
             OR COALESCE(table_selection_closes_at, starts_at) <= ? OR starts_at <= ?
           )
          ) OR (
            status = 'archived'
            AND (
              EXISTS (
                SELECT 1 FROM role_leases
                WHERE role_leases.guild_id = weekly_events.guild_id
                  AND role_leases.event_id = weekly_events.event_id
                  AND role_leases.released_at IS NULL
              ) OR EXISTS (
                SELECT 1 FROM operations
                WHERE operations.event_id = weekly_events.event_id
                  AND operations.operation_kind = 'scheduler-archive'
                  AND operations.status = 'failed'
              )
            )
          )
         ORDER BY starts_at ASC`,
      )
      .bind(through, through, through, through)
      .all<WeeklyEventRow>();
    return result.results.map(eventFromRow);
  }

  async transitionEventStatus(
    eventId: string,
    expectedStatus: EventStatus,
    nextStatus: EventStatus,
  ): Promise<boolean> {
    const now = this.now();
    const result = await this.db
      .prepare(
        `UPDATE weekly_events
         SET status = ?, updated_at = ?,
             archived_at = CASE WHEN ? = 'archived' THEN ? ELSE archived_at END
         WHERE event_id = ? AND status = ?`,
      )
      .bind(nextStatus, now, nextStatus, now, eventId, expectedStatus)
      .run();
    return result.meta.changes === 1;
  }

  async setEventMessages(
    eventId: string,
    messages: {
      signupChannelId?: string;
      signupMessageId?: string;
      gmSignupChannelId?: string;
      gmSignupMessageId?: string;
      tableChannelId?: string;
      tableMessageId?: string;
    },
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE weekly_events SET
           signup_channel_id = COALESCE(?, signup_channel_id),
           signup_message_id = COALESCE(?, signup_message_id),
           gm_signup_channel_id = COALESCE(?, gm_signup_channel_id),
           gm_signup_message_id = COALESCE(?, gm_signup_message_id),
           table_channel_id = COALESCE(?, table_channel_id),
           table_message_id = COALESCE(?, table_message_id),
           updated_at = ?
         WHERE event_id = ?`,
      )
      .bind(
        asNullable(messages.signupChannelId),
        asNullable(messages.signupMessageId),
        asNullable(messages.gmSignupChannelId),
        asNullable(messages.gmSignupMessageId),
        asNullable(messages.tableChannelId),
        asNullable(messages.tableMessageId),
        this.now(),
        eventId,
      )
      .run();
  }

  async setFinalManifest(
    eventId: string,
    channelId: string,
    messageId: string,
    planId: string,
    tableStateVersion: number,
    finalizedAt: number,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE weekly_events SET
           final_manifest_channel_id = ?,
           final_manifest_message_id = ?,
           finalized_plan_id = ?,
           finalized_table_state_version = ?,
           tables_finalized_at = ?,
           updated_at = ?
         WHERE event_id = ?
           AND status IN ('published', 'archived')
           AND table_state_version = ?
           AND EXISTS (
             SELECT 1 FROM plans
             WHERE plans.plan_id = ?
               AND plans.event_id = weekly_events.event_id
               AND plans.status = 'published'
           )
           AND (
             final_manifest_message_id IS NULL OR (
               final_manifest_channel_id = ? AND final_manifest_message_id = ?
             )
           )`,
      )
      .bind(
        channelId,
        messageId,
        planId,
        tableStateVersion,
        finalizedAt,
        this.now(),
        eventId,
        tableStateVersion,
        planId,
        channelId,
        messageId,
      )
      .run();
    return result.meta.changes === 1;
  }

  async saveSignup(input: SaveSignupInput): Promise<Signup> {
    const now = input.signedUpAt ?? this.now();
    await this.db
      .prepare(
        `INSERT INTO signups (
           event_id, user_id, display_name, signup_kind, status, source,
           source_external_id, signed_up_at, withdrawn_at, updated_at,
           game_tier, gm_commitment
         ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, NULL, ?, ?, ?)
         ON CONFLICT(event_id, user_id) DO UPDATE SET
           display_name = excluded.display_name,
           signup_kind = excluded.signup_kind,
           game_tier = excluded.game_tier,
           gm_commitment = excluded.gm_commitment,
           status = 'active',
           source = excluded.source,
           source_external_id = excluded.source_external_id,
           signed_up_at = excluded.signed_up_at,
           withdrawn_at = NULL,
           updated_at = excluded.updated_at`,
      )
      .bind(
        input.eventId,
        input.userId,
        input.displayName,
        input.signupKind,
        input.source ?? "native",
        asNullable(input.sourceExternalId),
        now,
        now,
        input.gameTier ?? null,
        input.gmCommitment ?? null,
      )
      .run();
    const signup = await this.getSignup(input.eventId, input.userId);
    if (!signup) throw new Error("Signup was not saved");
    return signup;
  }

  async withdrawSignup(eventId: string, userId: string): Promise<boolean> {
    const now = this.now();
    const result = await this.db
      .prepare(
        `UPDATE signups SET status = 'withdrawn', withdrawn_at = ?, updated_at = ?
         WHERE event_id = ? AND user_id = ? AND status = 'active'`,
      )
      .bind(now, now, eventId, userId)
      .run();
    return result.meta.changes === 1;
  }

  async getSignup(eventId: string, userId: string): Promise<Signup | null> {
    const row = await this.db
      .prepare("SELECT * FROM signups WHERE event_id = ? AND user_id = ?")
      .bind(eventId, userId)
      .first<SignupRow>();
    return row ? signupFromRow(row) : null;
  }

  async listActiveSignups(eventId: string, kind?: SignupKind): Promise<Signup[]> {
    const statement = kind
      ? this.db
          .prepare(
            `SELECT * FROM signups
             WHERE event_id = ? AND status = 'active' AND signup_kind = ?
             ORDER BY signed_up_at ASC, user_id ASC`,
          )
          .bind(eventId, kind)
      : this.db
          .prepare(
            `SELECT * FROM signups
             WHERE event_id = ? AND status = 'active'
             ORDER BY signed_up_at ASC, user_id ASC`,
          )
          .bind(eventId);
    const result = await statement.all<SignupRow>();
    return result.results.map(signupFromRow);
  }

  async listAllSignups(eventId: string): Promise<Signup[]> {
    const result = await this.db
      .prepare(
        `SELECT * FROM signups
         WHERE event_id = ?
         ORDER BY
           CASE WHEN status = 'active' THEN 0 ELSE 1 END,
           signup_kind ASC, signed_up_at ASC, user_id ASC`,
      )
      .bind(eventId)
      .all<SignupRow>();
    return result.results.map(signupFromRow);
  }

  async countActiveSignups(eventId: string): Promise<SignupCounts> {
    const row = await this.db
      .prepare(
         `SELECT
           SUM(CASE WHEN signup_kind = 'player' THEN 1 ELSE 0 END) AS players,
           SUM(CASE WHEN signup_kind = 'gm'
             AND COALESCE(gm_commitment, 'primary') = 'primary' THEN 1 ELSE 0 END) AS gms,
           SUM(CASE WHEN signup_kind = 'gm'
             AND gm_commitment = 'backup' THEN 1 ELSE 0 END) AS gm_backups
          FROM signups WHERE event_id = ? AND status = 'active'`,
      )
      .bind(eventId)
      .first<{ players: number | null; gms: number | null; gm_backups: number | null }>();
    return {
      players: row?.players ?? 0,
      gms: row?.gms ?? 0,
      gmBackups: row?.gm_backups ?? 0,
    };
  }

  async getNextPlanGeneration(eventId: string): Promise<number> {
    const value = await this.db
      .prepare("SELECT COALESCE(MAX(generation), 0) + 1 AS generation FROM plans WHERE event_id = ?")
      .bind(eventId)
      .first<number>("generation");
    return value ?? 1;
  }

  async saveDraftPlan(input: SaveDraftPlanInput): Promise<PlanBundle> {
    const now = input.plan.createdAt ?? this.now();
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare("UPDATE plans SET status = 'superseded' WHERE event_id = ? AND status = 'draft'")
        .bind(input.plan.eventId),
      this.db
        .prepare(
          `INSERT INTO plans (
             plan_id, event_id, generation, status, algorithm_version,
             min_table_size, preferred_table_size, max_table_size, player_count,
             gm_signup_count, selected_gm_count, waitlist_count,
             created_by_user_id, created_at
           ) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.plan.planId,
          input.plan.eventId,
          input.plan.generation,
          input.plan.algorithmVersion,
          input.plan.minTableSize,
          input.plan.preferredTableSize,
          input.plan.maxTableSize,
          input.plan.playerCount,
          input.plan.gmSignupCount,
          input.plan.selectedGmCount,
          input.plan.waitlistCount,
          input.plan.createdByUserId,
          now,
        ),
    ];

    if (input.tables.length > 0) {
      const tablesJson = JSON.stringify(
        input.tables.map((table) => ({
          tableId: table.tableId,
          tableNumber: table.tableNumber,
          gameTier: table.gameTier,
          title: table.title,
          capacity: table.capacity,
          gmUserId: table.gmUserId,
          gmDisplayName: table.gmDisplayName,
          channelId: table.channelId ?? null,
          messageId: table.messageId ?? null,
        })),
      );
      statements.push(
        this.db
          .prepare(
             `INSERT INTO plan_tables (
               table_id, plan_id, table_number, game_tier, title, capacity, gm_user_id,
               gm_display_name, channel_id, message_id, created_at
             )
             SELECT
                json_extract(value, '$.tableId'), ?,
                json_extract(value, '$.tableNumber'),
                json_extract(value, '$.gameTier'),
                json_extract(value, '$.title'),
               json_extract(value, '$.capacity'),
               json_extract(value, '$.gmUserId'),
               json_extract(value, '$.gmDisplayName'),
               json_extract(value, '$.channelId'),
               json_extract(value, '$.messageId'), ?
             FROM json_each(?)`,
          )
          .bind(input.plan.planId, now, tablesJson),
      );
    }

    if (input.assignments.length > 0) {
      const assignmentsJson = JSON.stringify(
        input.assignments.map((assignment) => ({
          assignmentId: assignment.assignmentId,
          tableId: assignment.tableId,
          desiredTableId: assignment.desiredTableId ?? assignment.tableId,
          userId: assignment.userId,
          displayName: assignment.displayName,
          gameTier: assignment.gameTier,
          status: assignment.status,
          waitlistPosition: assignment.waitlistPosition,
          rosterStatus: assignment.rosterStatus ?? null,
          rosterRank: assignment.rosterRank ?? null,
          assignedAt:
            assignment.status === "assigned" ? assignment.assignedAt ?? now : null,
        })),
      );
      statements.push(
        this.db
          .prepare(
             `INSERT INTO assignments (
               assignment_id, plan_id, table_id, desired_table_id, user_id,
               display_name, game_tier, status, waitlist_position, roster_status,
               roster_rank, assigned_at, updated_at
             )
             SELECT
               json_extract(value, '$.assignmentId'), ?,
               json_extract(value, '$.tableId'),
               json_extract(value, '$.desiredTableId'),
                json_extract(value, '$.userId'),
                json_extract(value, '$.displayName'),
                json_extract(value, '$.gameTier'),
                json_extract(value, '$.status'),
               json_extract(value, '$.waitlistPosition'),
               json_extract(value, '$.rosterStatus'),
               json_extract(value, '$.rosterRank'),
               json_extract(value, '$.assignedAt'), ?
             FROM json_each(?)`,
          )
          .bind(input.plan.planId, now, assignmentsJson),
      );
    }

    await this.db.batch(statements);
    const bundle = await this.getPlanBundle(input.plan.planId);
    if (!bundle) throw new Error("Draft plan was not saved");
    return bundle;
  }

  async getPlan(planId: string): Promise<Plan | null> {
    const row = await this.db
      .prepare("SELECT * FROM plans WHERE plan_id = ?")
      .bind(planId)
      .first<PlanRow>();
    return row ? planFromRow(row) : null;
  }

  async getCurrentPlan(eventId: string): Promise<Plan | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM plans WHERE event_id = ? AND status IN ('draft', 'published')
         ORDER BY CASE status WHEN 'published' THEN 0 ELSE 1 END, generation DESC LIMIT 1`,
      )
      .bind(eventId)
      .first<PlanRow>();
    return row ? planFromRow(row) : null;
  }

  async getLatestDraftPlan(eventId: string): Promise<Plan | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM plans WHERE event_id = ? AND status = 'draft'
         ORDER BY generation DESC LIMIT 1`,
      )
      .bind(eventId)
      .first<PlanRow>();
    return row ? planFromRow(row) : null;
  }

  async getLatestSupersededPlan(eventId: string): Promise<Plan | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM plans WHERE event_id = ? AND status = 'superseded'
         ORDER BY generation DESC LIMIT 1`,
      )
      .bind(eventId)
      .first<PlanRow>();
    return row ? planFromRow(row) : null;
  }

  async listPlanTables(planId: string): Promise<PlanTable[]> {
    const result = await this.db
      .prepare("SELECT * FROM plan_tables WHERE plan_id = ? ORDER BY table_number ASC")
      .bind(planId)
      .all<PlanTableRow>();
    return result.results.map(tableFromRow);
  }

  async setPlanTableMessage(
    tableId: string,
    channelId: string,
    messageId: string,
  ): Promise<boolean> {
    const result = await this.db
      .prepare("UPDATE plan_tables SET channel_id = ?, message_id = ? WHERE table_id = ?")
      .bind(channelId, messageId, tableId)
      .run();
    return result.meta.changes === 1;
  }

  async updateDraftTable(input: {
    planId: string;
    tableNumber: number;
    title?: string;
    capacity?: number;
    gmUserId?: string;
    gmDisplayName?: string;
  }): Promise<PlanTable | null> {
    const result = await this.db
      .prepare(
        `UPDATE plan_tables SET
           title = COALESCE(?, title),
           capacity = COALESCE(?, capacity),
           gm_user_id = COALESCE(?, gm_user_id),
           gm_display_name = COALESCE(?, gm_display_name)
         WHERE plan_id = ? AND table_number = ?
           AND EXISTS (
             SELECT 1 FROM plans
             WHERE plans.plan_id = plan_tables.plan_id AND plans.status = 'draft'
           )
           AND (
             ? IS NULL OR ? >= (
               SELECT COUNT(*) FROM assignments
               WHERE assignments.table_id = plan_tables.table_id
                 AND assignments.status = 'assigned'
             )
           )`,
      )
      .bind(
        asNullable(input.title),
        asNullable(input.capacity),
        asNullable(input.gmUserId),
        asNullable(input.gmDisplayName),
        input.planId,
        input.tableNumber,
        asNullable(input.capacity),
        asNullable(input.capacity),
      )
      .run();
    if (result.meta.changes !== 1) return null;
    const row = await this.db
      .prepare("SELECT * FROM plan_tables WHERE plan_id = ? AND table_number = ?")
      .bind(input.planId, input.tableNumber)
      .first<PlanTableRow>();
    return row ? tableFromRow(row) : null;
  }

  async listAssignments(planId: string): Promise<Assignment[]> {
    const result = await this.db
      .prepare(
        `SELECT * FROM assignments WHERE plan_id = ?
         ORDER BY CASE status WHEN 'assigned' THEN 0 WHEN 'unassigned' THEN 1
           WHEN 'waitlisted' THEN 2 ELSE 3 END,
           waitlist_position ASC, display_name ASC`,
      )
      .bind(planId)
      .all<AssignmentRow>();
    return result.results.map(assignmentFromRow);
  }

  async getPlanBundle(planId: string): Promise<PlanBundle | null> {
    const plan = await this.getPlan(planId);
    if (!plan) return null;
    const [tables, assignments] = await Promise.all([
      this.listPlanTables(planId),
      this.listAssignments(planId),
    ]);
    return { plan, tables, assignments };
  }

  async publishPlan(input: {
    planId: string;
    eventId: string;
    guildId: string;
  }): Promise<boolean> {
    const now = this.now();
    const results = await this.db.batch([
      this.db
        .prepare(
          `UPDATE plans SET status = 'superseded'
           WHERE event_id = ? AND status = 'published' AND plan_id <> ?
             AND EXISTS (
               SELECT 1 FROM plans target
               WHERE target.plan_id = ? AND target.event_id = ? AND target.status = 'draft'
             )`,
        )
        .bind(input.eventId, input.planId, input.planId, input.eventId),
      this.db
        .prepare(
          `UPDATE plans SET status = 'published', published_at = ?
           WHERE plan_id = ? AND event_id = ? AND status = 'draft'`,
        )
        .bind(now, input.planId, input.eventId),
      this.db
        .prepare(
          `UPDATE weekly_events SET
             status = 'published', published_at = ?, updated_at = ?,
             table_state_version = table_state_version + 1
           WHERE event_id = ? AND guild_id = ?
              AND status IN ('locked', 'planned', 'published')
              AND changes() = 1
              AND EXISTS (
               SELECT 1 FROM plans target
               WHERE target.plan_id = ? AND target.event_id = weekly_events.event_id
                 AND target.status = 'published'
             )`,
        )
        .bind(now, now, input.eventId, input.guildId, input.planId),
      this.db
        .prepare(
          `UPDATE gm_selections SET is_current = 0
           WHERE event_id = ? AND is_current = 1 AND EXISTS (
             SELECT 1 FROM plans target
             WHERE target.plan_id = ? AND target.event_id = ?
               AND target.status = 'published'
           )`,
        )
        .bind(input.eventId, input.planId, input.eventId),
      this.db
        .prepare(
          `INSERT INTO gm_selections (
             event_id, guild_id, plan_id, table_id, gm_user_id, selected_at, is_current
           )
           SELECT ?, ?, tables.plan_id, tables.table_id, tables.gm_user_id, ?, 1
           FROM plan_tables tables
           JOIN plans target ON target.plan_id = tables.plan_id
           WHERE tables.plan_id = ? AND target.status = 'published'
           ON CONFLICT(event_id, gm_user_id) DO UPDATE SET
             guild_id = excluded.guild_id,
             plan_id = excluded.plan_id,
             table_id = excluded.table_id,
             selected_at = excluded.selected_at,
             is_current = 1`,
        )
        .bind(input.eventId, input.guildId, now, input.planId),
    ]);
    return results[1]?.meta.changes === 1;
  }

  async listDueRosterPromotionNotifications(
    now: number,
    limit = 25,
  ): Promise<RosterPromotionNotification[]> {
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const staleBefore = now - DEFAULT_REMINDER_LEASE_MS;
    const result = await this.db
      .prepare(
         `SELECT assignment.assignment_id, event.guild_id, event.event_id,
            plan.plan_id, assignment.user_id, assignment.display_name,
            assignment.game_tier,
           event.title, COALESCE(event.open_seating_at, event.signup_locks_at)
             AS open_seating_at,
           event.starts_at, assignment.roster_notification_attempt_count
         FROM assignments assignment
         JOIN plans plan ON plan.plan_id = assignment.plan_id
         JOIN weekly_events event ON event.event_id = plan.event_id
         WHERE assignment.roster_status = 'reserved'
           AND assignment.roster_promoted_at IS NOT NULL
           AND assignment.status <> 'withdrawn'
           AND event.status = 'published'
           AND (
             assignment.roster_notification_status IN ('pending', 'retry')
             AND COALESCE(assignment.roster_notification_next_attempt_at, 0) <= ?
             OR assignment.roster_notification_status = 'sending'
             AND COALESCE(assignment.roster_notification_claimed_at, 0) <= ?
           )
         ORDER BY assignment.roster_promoted_at ASC, assignment.assignment_id ASC
         LIMIT ?`,
      )
      .bind(now, staleBefore, boundedLimit)
      .all<{
        assignment_id: string;
        guild_id: string;
        event_id: string;
        plan_id: string;
        user_id: string;
        display_name: string;
        game_tier: GameTier;
        title: string;
        open_seating_at: number;
        starts_at: number;
        roster_notification_attempt_count: number;
      }>();
    return result.results.map((row) => ({
      assignmentId: row.assignment_id,
      guildId: row.guild_id,
      eventId: row.event_id,
      planId: row.plan_id,
      recipientUserId: row.user_id,
      displayName: row.display_name,
      eventTitle: row.title,
      gameTier: row.game_tier,
      openSeatingAt: row.open_seating_at,
      eventStartsAt: row.starts_at,
      attemptCount: row.roster_notification_attempt_count,
    }));
  }

  async claimRosterPromotionNotification(
    assignmentId: string,
    now: number,
  ): Promise<boolean> {
    const staleBefore = now - DEFAULT_REMINDER_LEASE_MS;
    const result = await this.db
      .prepare(
        `UPDATE assignments SET
           roster_notification_status = 'sending',
           roster_notification_attempt_count = roster_notification_attempt_count + 1,
           roster_notification_claimed_at = ?, updated_at = ?
         WHERE assignment_id = ? AND (
           roster_notification_status IN ('pending', 'retry')
             AND COALESCE(roster_notification_next_attempt_at, 0) <= ?
           OR roster_notification_status = 'sending'
             AND COALESCE(roster_notification_claimed_at, 0) <= ?
         )`,
      )
      .bind(now, now, assignmentId, now, staleBefore)
      .run();
    return result.meta.changes === 1;
  }

  async markRosterPromotionNotificationSent(
    assignmentId: string,
    channelId: string,
    messageId: string,
    now: number,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE assignments SET
           roster_notification_status = 'sent',
           roster_notification_next_attempt_at = NULL,
           roster_notification_claimed_at = NULL,
           roster_notification_last_error = NULL,
           roster_notification_channel_id = ?,
           roster_notification_message_id = ?,
           roster_notification_sent_at = ?, updated_at = ?
         WHERE assignment_id = ? AND roster_notification_status = 'sending'`,
      )
      .bind(channelId, messageId, now, now, assignmentId)
      .run();
    return result.meta.changes === 1;
  }

  async markRosterPromotionNotificationFailure(
    result: RosterNotificationDeliveryResult,
    now: number,
  ): Promise<boolean> {
    if (result.status === "sent") {
      throw new TypeError("Use markRosterPromotionNotificationSent for sent delivery");
    }
    const update = await this.db
      .prepare(
        `UPDATE assignments SET
           roster_notification_status = ?,
           roster_notification_next_attempt_at = ?,
           roster_notification_claimed_at = NULL,
           roster_notification_last_error = ?, updated_at = ?
         WHERE assignment_id = ? AND roster_notification_status = 'sending'`,
      )
      .bind(
        result.status,
        result.nextAttemptAt ?? null,
        (result.error ?? "Roster promotion delivery failed").slice(0, 500),
        now,
        result.assignmentId,
      )
      .run();
    return update.meta.changes === 1;
  }

  async getAssignment(planId: string, userId: string): Promise<Assignment | null> {
    const row = await this.db
      .prepare("SELECT * FROM assignments WHERE plan_id = ? AND user_id = ?")
      .bind(planId, userId)
      .first<AssignmentRow>();
    return row ? assignmentFromRow(row) : null;
  }

  async ensureUnassignedAssignment(input: {
    assignmentId: string;
    planId: string;
    userId: string;
    displayName: string;
  }): Promise<Assignment> {
    const now = this.now();
    await this.db.batch([
      this.db
        .prepare(
           `INSERT OR IGNORE INTO assignments (
              assignment_id, plan_id, table_id, desired_table_id, user_id,
              display_name, game_tier, status, waitlist_position, roster_status, roster_rank,
              assigned_at, updated_at
            )
            SELECT ?, ?, NULL, NULL, ?, ?, signup.game_tier, 'unassigned', NULL,
              CASE WHEN (
                SELECT COUNT(*) FROM assignments reserved
                WHERE reserved.plan_id = ? AND reserved.roster_status = 'reserved'
                  AND reserved.status <> 'withdrawn'
                  AND COALESCE(reserved.game_tier, 0) =
                      COALESCE(signup.game_tier, 0)
              ) < COALESCE((SELECT SUM(capacity) FROM plan_tables
                WHERE plan_id = ? AND COALESCE(game_tier, 0) =
                  COALESCE(signup.game_tier, 0)), 0)
                THEN 'reserved' ELSE 'bench' END,
              COALESCE((SELECT MAX(roster_rank) FROM assignments
                WHERE plan_id = ? AND COALESCE(game_tier, 0) =
                  COALESCE(signup.game_tier, 0)), 0) + 1,
             NULL, ?
           FROM plans plan
           JOIN signups signup
             ON signup.event_id = plan.event_id AND signup.user_id = ?
            WHERE plan.plan_id = ? AND plan.status = 'published'
              AND signup.status = 'active' AND signup.signup_kind = 'player'`,
        )
        .bind(
          input.assignmentId,
          input.planId,
          input.userId,
          input.displayName,
          input.planId,
          input.planId,
          input.planId,
          now,
          input.userId,
          input.planId,
        ),
      this.db
        .prepare(
           `UPDATE assignments SET
              display_name = ?,
              game_tier = CASE WHEN status = 'withdrawn' THEN (
                SELECT signup.game_tier
                FROM plans plan
                JOIN signups signup
                  ON signup.event_id = plan.event_id
                 AND signup.user_id = assignments.user_id
                WHERE plan.plan_id = assignments.plan_id
              ) ELSE game_tier END,
              table_id = CASE WHEN status = 'withdrawn' THEN NULL ELSE table_id END,
             desired_table_id = CASE WHEN status = 'withdrawn' THEN NULL ELSE desired_table_id END,
             status = CASE WHEN status = 'withdrawn' THEN 'unassigned' ELSE status END,
             waitlist_position = CASE WHEN status = 'withdrawn' THEN NULL ELSE waitlist_position END,
             assigned_at = CASE WHEN status = 'withdrawn' THEN NULL ELSE assigned_at END,
             roster_status = CASE WHEN status = 'withdrawn' THEN
               CASE WHEN (
                 SELECT COUNT(*) FROM assignments reserved
                  WHERE reserved.plan_id = assignments.plan_id
                    AND reserved.roster_status = 'reserved'
                    AND reserved.status <> 'withdrawn'
                    AND COALESCE(reserved.game_tier, 0) =
                        COALESCE((
                          SELECT signup.game_tier
                          FROM plans plan
                          JOIN signups signup
                            ON signup.event_id = plan.event_id
                           AND signup.user_id = assignments.user_id
                          WHERE plan.plan_id = assignments.plan_id
                        ), 0)
                ) < COALESCE((SELECT SUM(capacity) FROM plan_tables
                  WHERE plan_id = assignments.plan_id
                    AND COALESCE(game_tier, 0) =
                        COALESCE((
                          SELECT signup.game_tier
                          FROM plans plan
                          JOIN signups signup
                            ON signup.event_id = plan.event_id
                           AND signup.user_id = assignments.user_id
                          WHERE plan.plan_id = assignments.plan_id
                        ), 0)), 0)
                 THEN 'reserved' ELSE 'bench' END
               ELSE roster_status END,
             roster_rank = CASE WHEN status = 'withdrawn' THEN
                COALESCE((SELECT MAX(candidate.roster_rank) FROM assignments candidate
                  WHERE candidate.plan_id = assignments.plan_id
                    AND COALESCE(candidate.game_tier, 0) =
                        COALESCE((
                          SELECT signup.game_tier
                          FROM plans plan
                          JOIN signups signup
                            ON signup.event_id = plan.event_id
                           AND signup.user_id = assignments.user_id
                          WHERE plan.plan_id = assignments.plan_id
                        ), 0)), 0) + 1
               ELSE roster_rank END,
             roster_promoted_at = CASE WHEN status = 'withdrawn' THEN NULL ELSE roster_promoted_at END,
             roster_notification_status = CASE WHEN status = 'withdrawn' THEN NULL ELSE roster_notification_status END,
             roster_notification_attempt_count = CASE WHEN status = 'withdrawn' THEN 0 ELSE roster_notification_attempt_count END,
             roster_notification_next_attempt_at = CASE WHEN status = 'withdrawn' THEN NULL ELSE roster_notification_next_attempt_at END,
             roster_notification_claimed_at = CASE WHEN status = 'withdrawn' THEN NULL ELSE roster_notification_claimed_at END,
             roster_notification_last_error = CASE WHEN status = 'withdrawn' THEN NULL ELSE roster_notification_last_error END,
             roster_notification_channel_id = CASE WHEN status = 'withdrawn' THEN NULL ELSE roster_notification_channel_id END,
             roster_notification_message_id = CASE WHEN status = 'withdrawn' THEN NULL ELSE roster_notification_message_id END,
             roster_notification_sent_at = CASE WHEN status = 'withdrawn' THEN NULL ELSE roster_notification_sent_at END,
             withdrawal_token = CASE WHEN status = 'withdrawn' THEN NULL ELSE withdrawal_token END,
             updated_at = ?
           WHERE plan_id = ? AND user_id = ? AND EXISTS (
             SELECT 1
             FROM plans plan
             JOIN signups signup
               ON signup.event_id = plan.event_id AND signup.user_id = assignments.user_id
             WHERE plan.plan_id = assignments.plan_id AND plan.status = 'published'
                AND signup.status = 'active' AND signup.signup_kind = 'player'
                AND (
                  assignments.status = 'withdrawn'
                  OR COALESCE(signup.game_tier, 0) =
                     COALESCE(assignments.game_tier, 0)
                )
            )`,
        )
        .bind(input.displayName, now, input.planId, input.userId),
      this.db
        .prepare(
          `UPDATE weekly_events SET
             table_state_version = table_state_version + 1,
             updated_at = ?
           WHERE event_id = (SELECT event_id FROM plans WHERE plan_id = ?)
             AND changes() = 1`,
        )
        .bind(now, input.planId),
    ]);

    const assignment = await this.getAssignment(input.planId, input.userId);
    if (!assignment) {
      throw new Error("An active player assignment could not be created or found");
    }
    return assignment;
  }

  private async getNextRosterBench(
    planId: string,
    gameTier: GameTier,
  ): Promise<Assignment | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM assignments
         WHERE plan_id = ? AND COALESCE(game_tier, 0) = COALESCE(?, 0)
           AND roster_status = 'bench' AND status <> 'withdrawn'
         ORDER BY roster_rank ASC, user_id ASC LIMIT 1`,
      )
      .bind(planId, gameTier)
      .first<AssignmentRow>();
    return row ? assignmentFromRow(row) : null;
  }

  private promoteNextRosterStatement(
    planId: string,
    now: number,
    enabled: boolean,
    withdrawalUserId: string,
    withdrawalToken: string,
    gameTier: GameTier,
  ): D1PreparedStatement {
    return this.db
      .prepare(
        `UPDATE assignments SET
           roster_status = 'reserved', roster_promoted_at = ?,
           roster_notification_status = 'pending',
           roster_notification_attempt_count = 0,
           roster_notification_next_attempt_at = ?,
           roster_notification_claimed_at = NULL,
           roster_notification_last_error = NULL,
           roster_notification_channel_id = NULL,
           roster_notification_message_id = NULL,
           roster_notification_sent_at = NULL,
           updated_at = ?
         WHERE ? = 1 AND EXISTS (
           SELECT 1 FROM assignments withdrawal
           WHERE withdrawal.plan_id = ? AND withdrawal.user_id = ?
             AND withdrawal.status = 'withdrawn'
             AND withdrawal.withdrawal_token = ?
         ) AND assignment_id = (
           SELECT candidate.assignment_id FROM assignments candidate
            WHERE candidate.plan_id = ?
              AND COALESCE(candidate.game_tier, 0) = COALESCE(?, 0)
              AND candidate.roster_status = 'bench'
             AND candidate.status <> 'withdrawn'
           ORDER BY candidate.roster_rank ASC, candidate.user_id ASC LIMIT 1
         )`,
      )
      .bind(
        now, now, now, Number(enabled),
         planId, withdrawalUserId, withdrawalToken, planId, gameTier,
      );
  }

  private async getNextWaitlisted(
    planId: string,
    tableId: string | null,
  ): Promise<Assignment | null> {
    if (!tableId) return null;
    const row = await this.db
      .prepare(
        `SELECT * FROM assignments
         WHERE plan_id = ? AND desired_table_id = ? AND status = 'waitlisted'
         ORDER BY waitlist_position ASC, updated_at ASC, user_id ASC LIMIT 1`,
      )
      .bind(planId, tableId)
      .first<AssignmentRow>();
    return row ? assignmentFromRow(row) : null;
  }

  private promoteNextStatement(
    planId: string,
    tableId: string | null,
    now: number,
    withdrawalGuard?: { userId: string; token: string },
  ): D1PreparedStatement {
    return this.db
      .prepare(
        `UPDATE assignments SET
           table_id = desired_table_id, status = 'assigned',
           waitlist_position = NULL, assigned_at = ?, updated_at = ?
         WHERE (? IS NULL OR EXISTS (
           SELECT 1 FROM assignments withdrawal
           WHERE withdrawal.plan_id = ? AND withdrawal.user_id = ?
             AND withdrawal.status = 'withdrawn'
             AND withdrawal.withdrawal_token = ?
         )) AND assignment_id = (
           SELECT candidate.assignment_id
           FROM assignments candidate
           JOIN plan_tables target ON target.table_id = candidate.desired_table_id
           WHERE candidate.plan_id = ? AND candidate.desired_table_id = ?
             AND candidate.status = 'waitlisted'
             AND (
               SELECT COUNT(*) FROM assignments occupied
               WHERE occupied.table_id = target.table_id AND occupied.status = 'assigned'
             ) < target.capacity
           ORDER BY candidate.waitlist_position ASC, candidate.updated_at ASC,
             candidate.user_id ASC
           LIMIT 1
         )`,
      )
      .bind(
        now,
        now,
        withdrawalGuard?.token ?? null,
        planId,
        withdrawalGuard?.userId ?? "",
        withdrawalGuard?.token ?? "",
        planId,
        tableId,
      );
  }

  async joinOrWaitlist(
    planId: string,
    userId: string,
    tableId: string,
  ): Promise<JoinTableResult> {
    const before = await this.getAssignment(planId, userId);
    if (!before || before.status === 'withdrawn') {
      throw new Error("Only an active player in this plan can select a table");
    }

    const vacatedTableId = before.tableId && before.tableId !== tableId ? before.tableId : null;
    const promotionCandidate = await this.getNextWaitlisted(planId, vacatedTableId);
    const now = this.now();
    const results = await this.db.batch([
      this.db
        .prepare(
          `WITH target AS (
             SELECT t.capacity,
               (
                 SELECT COUNT(*) FROM assignments occupied
                 WHERE occupied.table_id = t.table_id
                   AND occupied.status = 'assigned'
                   AND occupied.user_id <> ?
               ) AS occupied_count
              FROM plan_tables t
              JOIN plans p ON p.plan_id = t.plan_id
              JOIN weekly_events weekly ON weekly.event_id = p.event_id
               WHERE t.table_id = ? AND t.plan_id = ? AND p.status = 'published'
                 AND weekly.status = 'published'
                 AND COALESCE(t.game_tier, 0) = COALESCE((
                   SELECT eligible.game_tier FROM assignments eligible
                   WHERE eligible.plan_id = ? AND eligible.user_id = ?
                 ), 0)
                AND COALESCE(weekly.table_selection_closes_at, weekly.starts_at)
                  > CAST(strftime('%s', 'now') AS INTEGER) * 1000
           ), availability AS (
             SELECT CASE WHEN occupied_count < capacity THEN 1 ELSE 0 END AS has_space
             FROM target
           )
           UPDATE assignments SET
             desired_table_id = ?,
             table_id = CASE WHEN (SELECT has_space FROM availability) = 1 THEN ? ELSE NULL END,
             status = CASE WHEN (SELECT has_space FROM availability) = 1
               THEN 'assigned' ELSE 'waitlisted' END,
             waitlist_position = CASE
               WHEN (SELECT has_space FROM availability) = 1 THEN NULL
               WHEN desired_table_id = ? AND status = 'waitlisted' THEN waitlist_position
               ELSE (
                 SELECT COALESCE(MAX(queued.waitlist_position), 0) + 1
                 FROM assignments queued
                 WHERE queued.plan_id = ? AND queued.desired_table_id = ?
                   AND queued.status = 'waitlisted' AND queued.user_id <> ?
               )
             END,
             assigned_at = CASE WHEN (SELECT has_space FROM availability) = 1
               THEN ? ELSE NULL END,
             updated_at = ?
           WHERE plan_id = ? AND user_id = ? AND status <> 'withdrawn'
             AND EXISTS (SELECT 1 FROM target)`,
        )
        .bind(
          userId, tableId, planId, planId, userId,
          tableId, tableId, tableId, planId, tableId,
          userId, now, now, planId, userId,
        ),
      this.db
        .prepare(
          `UPDATE weekly_events SET
             table_state_version = table_state_version + 1,
             updated_at = ?
           WHERE event_id = (SELECT event_id FROM plans WHERE plan_id = ?)
             AND changes() = 1`,
        )
        .bind(now, planId),
      this.promoteNextStatement(planId, vacatedTableId, now),
    ]);

    if (results[0]?.meta.changes !== 1) {
      throw new TableSelectionUnavailableError();
    }
    const assignment = await this.getAssignment(planId, userId);
    if (!assignment || (assignment.status !== 'assigned' && assignment.status !== 'waitlisted')) {
      throw new Error("Table selection was not persisted");
    }
    const promoted = promotionCandidate
      ? await this.getAssignment(planId, promotionCandidate.userId)
      : null;
    return {
      outcome: assignment.status,
      position: assignment.waitlistPosition,
      assignment,
      promoted: promoted?.status === 'assigned' ? promoted : null,
    };
  }

  async leaveTableAndPromote(planId: string, userId: string): Promise<LeaveTableResult> {
    const before = await this.getAssignment(planId, userId);
    if (!before || (before.status !== 'assigned' && before.status !== 'waitlisted')) {
      return { left: false, assignment: before, promoted: null };
    }
    const vacatedTableId = before.status === 'assigned' ? before.tableId : null;
    const promotionCandidate = await this.getNextWaitlisted(planId, vacatedTableId);
    const now = this.now();
    const results = await this.db.batch([
      this.db
        .prepare(
          `UPDATE assignments SET
             table_id = NULL, desired_table_id = NULL, status = 'unassigned',
             waitlist_position = NULL,
             assigned_at = NULL, updated_at = ?
           WHERE plan_id = ? AND user_id = ? AND status IN ('assigned', 'waitlisted')
             AND EXISTS (
               SELECT 1 FROM plans
               JOIN weekly_events ON weekly_events.event_id = plans.event_id
               WHERE plans.plan_id = assignments.plan_id
                 AND plans.status = 'published'
                 AND weekly_events.status = 'published'
                 AND COALESCE(
                   weekly_events.table_selection_closes_at,
                   weekly_events.starts_at
                 ) > CAST(strftime('%s', 'now') AS INTEGER) * 1000
             )`,
        )
        .bind(now, planId, userId),
      this.db
        .prepare(
          `UPDATE weekly_events SET
             table_state_version = table_state_version + 1,
             updated_at = ?
           WHERE event_id = (SELECT event_id FROM plans WHERE plan_id = ?)
             AND changes() = 1`,
        )
        .bind(now, planId),
      this.promoteNextStatement(planId, vacatedTableId, now),
    ]);
    if (results[0]?.meta.changes !== 1) {
      throw new TableSelectionUnavailableError();
    }
    const assignment = await this.getAssignment(planId, userId);
    const promoted = promotionCandidate
      ? await this.getAssignment(planId, promotionCandidate.userId)
      : null;
    return {
      left: results[0]?.meta.changes === 1,
      assignment,
      promoted: promoted?.status === 'assigned' ? promoted : null,
    };
  }

  async withdrawAssignmentAndPromote(
    planId: string,
    userId: string,
    promoteRoster = true,
  ): Promise<LeaveTableResult> {
    const before = await this.getAssignment(planId, userId);
    if (!before || before.status === "withdrawn") {
      return { left: false, assignment: before, promoted: null };
    }
    const vacatedTableId = before.status === "assigned" ? before.tableId : null;
    const promotionCandidate = await this.getNextWaitlisted(planId, vacatedTableId);
    const shouldPromoteRoster = promoteRoster && before.rosterStatus === "reserved";
    const rosterPromotionCandidate = shouldPromoteRoster
      ? await this.getNextRosterBench(planId, before.gameTier)
      : null;
    const now = this.now();
    const withdrawalToken = crypto.randomUUID();
    const results = await this.db.batch([
      this.db
        .prepare(
          `UPDATE assignments SET
             table_id = NULL, desired_table_id = NULL, status = 'withdrawn',
             waitlist_position = NULL, assigned_at = NULL,
             withdrawal_token = ?, updated_at = ?
           WHERE plan_id = ? AND user_id = ? AND status <> 'withdrawn'`,
        )
        .bind(withdrawalToken, now, planId, userId),
      this.db
        .prepare(
          `UPDATE weekly_events SET
             table_state_version = table_state_version + 1,
             updated_at = ?
           WHERE event_id = (SELECT event_id FROM plans WHERE plan_id = ?)
             AND EXISTS (
               SELECT 1 FROM assignments withdrawal
               WHERE withdrawal.plan_id = ? AND withdrawal.user_id = ?
                 AND withdrawal.status = 'withdrawn'
                 AND withdrawal.withdrawal_token = ?
             )`,
        )
        .bind(now, planId, planId, userId, withdrawalToken),
      this.promoteNextStatement(planId, vacatedTableId, now, {
        userId,
        token: withdrawalToken,
      }),
      this.promoteNextRosterStatement(
        planId,
        now,
        shouldPromoteRoster,
        userId,
        withdrawalToken,
        before.gameTier,
      ),
    ]);
    const assignment = await this.getAssignment(planId, userId);
    const promoted = promotionCandidate
      ? await this.getAssignment(planId, promotionCandidate.userId)
      : null;
    const rosterPromoted = rosterPromotionCandidate
      ? await this.getAssignment(planId, rosterPromotionCandidate.userId)
      : null;
    return {
      left: results[0]?.meta.changes === 1,
      assignment,
      promoted:
        results[2]?.meta.changes === 1 && promoted?.status === "assigned"
          ? promoted
          : null,
      rosterPromoted:
        results[3]?.meta.changes === 1 &&
        rosterPromoted?.rosterStatus === "reserved" &&
        rosterPromoted.rosterPromotedAt === now
          ? rosterPromoted
          : null,
    };
  }

  async unassignPlayer(planId: string, userId: string): Promise<boolean> {
    const now = this.now();
    const results = await this.db.batch([
      this.db
        .prepare(
          `UPDATE assignments SET
             table_id = NULL, desired_table_id = NULL, status = 'unassigned',
             waitlist_position = NULL, assigned_at = NULL, updated_at = ?
           WHERE plan_id = ? AND user_id = ? AND status <> 'withdrawn'`,
        )
        .bind(now, planId, userId),
      this.db
        .prepare(
          `UPDATE weekly_events SET
             table_state_version = table_state_version + 1,
             updated_at = ?
           WHERE event_id = (SELECT event_id FROM plans WHERE plan_id = ?)
             AND changes() = 1`,
        )
        .bind(now, planId),
    ]);
    return results[0]?.meta.changes === 1;
  }

  async listGmSelectionStats(guildId: string): Promise<GmSelectionStats[]> {
    const result = await this.db
      .prepare(
        `SELECT gm_user_id, COUNT(*) AS selection_count, MAX(selected_at) AS last_selected_at
         FROM gm_selections WHERE guild_id = ? AND is_current = 1 GROUP BY gm_user_id
         ORDER BY selection_count ASC, last_selected_at ASC, gm_user_id ASC`,
      )
      .bind(guildId)
      .all<{ gm_user_id: string; selection_count: number; last_selected_at: number }>();
    return result.results.map((row) => ({
      gmUserId: row.gm_user_id,
      selectionCount: row.selection_count,
      lastSelectedAt: row.last_selected_at,
    }));
  }

  async acquireRoleLease(input: {
    leaseId: string;
    guildId: string;
    eventId?: string;
    userId: string;
    roleId: string;
    reason: string;
  }): Promise<{ acquired: boolean; lease: RoleLease }> {
    const now = this.now();
    const result = await this.db
      .prepare(
        `INSERT OR IGNORE INTO role_leases (
           lease_id, guild_id, event_id, user_id, role_id, reason, granted_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.leaseId,
        input.guildId,
        asNullable(input.eventId),
        input.userId,
        input.roleId,
        input.reason,
        now,
      )
      .run();
    const row = await this.db
      .prepare(
        `SELECT * FROM role_leases
         WHERE guild_id = ? AND user_id = ? AND role_id = ? AND released_at IS NULL`,
      )
      .bind(input.guildId, input.userId, input.roleId)
      .first<RoleLeaseRow>();
    if (!row) throw new Error("Role lease was not acquired or found");
    return { acquired: result.meta.changes === 1, lease: roleLeaseFromRow(row) };
  }

  async listActiveRoleLeases(guildId: string, roleId?: string): Promise<RoleLease[]> {
    const statement = roleId
      ? this.db
          .prepare(
            `SELECT * FROM role_leases
             WHERE guild_id = ? AND role_id = ? AND released_at IS NULL
             ORDER BY user_id ASC`,
          )
          .bind(guildId, roleId)
      : this.db
          .prepare(
            `SELECT * FROM role_leases
             WHERE guild_id = ? AND released_at IS NULL
             ORDER BY role_id ASC, user_id ASC`,
          )
          .bind(guildId);
    const result = await statement.all<RoleLeaseRow>();
    return result.results.map(roleLeaseFromRow);
  }

  async verifyRoleLease(leaseId: string): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE role_leases SET last_verified_at = ?
         WHERE lease_id = ? AND released_at IS NULL`,
      )
      .bind(this.now(), leaseId)
      .run();
    return result.meta.changes === 1;
  }

  async releaseRoleLease(leaseId: string, reason: string): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE role_leases SET released_at = ?, release_reason = ?
         WHERE lease_id = ? AND released_at IS NULL`,
      )
      .bind(this.now(), reason, leaseId)
      .run();
    return result.meta.changes === 1;
  }

  async saveReminderRule(input: SaveReminderRuleInput): Promise<ReminderRule> {
    const now = this.now();
    await this.db
      .prepare(
        `INSERT INTO reminder_rules (
           rule_id, guild_id, name, trigger_kind, offset_minutes, audience_kind,
           role_id, channel_id, message_template, mention_role, enabled,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(rule_id) DO UPDATE SET
           name = excluded.name,
           trigger_kind = excluded.trigger_kind,
           offset_minutes = excluded.offset_minutes,
           audience_kind = excluded.audience_kind,
           role_id = excluded.role_id,
           channel_id = excluded.channel_id,
           message_template = excluded.message_template,
           mention_role = excluded.mention_role,
           enabled = excluded.enabled,
           updated_at = excluded.updated_at
         WHERE reminder_rules.guild_id = excluded.guild_id`,
      )
      .bind(
        input.ruleId,
        input.guildId,
        input.name,
        input.triggerKind,
        input.offsetMinutes,
        input.audienceKind,
        asNullable(input.roleId),
        asNullable(input.channelId),
        input.messageTemplate,
        Number(input.mentionRole),
        Number(input.enabled),
        now,
        now,
      )
      .run();
    const row = await this.db
      .prepare("SELECT * FROM reminder_rules WHERE rule_id = ?")
      .bind(input.ruleId)
      .first<ReminderRuleRow>();
    if (!row) throw new Error("Reminder rule was not saved");
    return reminderRuleFromRow(row);
  }

  async saveEventReminderRule(input: {
    ruleId: string;
    guildId: string;
    name: string;
    body: string;
    channelId?: string;
    roleId?: string;
    hoursBefore: number;
    enabled: boolean;
  }): Promise<ReminderRule> {
    return this.saveReminderRule({
      ruleId: input.ruleId,
      guildId: input.guildId,
      name: input.name,
      triggerKind: "event_start",
      offsetMinutes: -Math.abs(input.hoursBefore * 60),
      audienceKind: input.roleId ? "configured_role" : "channel",
      roleId: input.roleId,
      channelId: input.channelId,
      messageTemplate: input.body,
      mentionRole: input.roleId !== undefined,
      enabled: input.enabled,
    });
  }

  async listEnabledReminderRules(guildId: string): Promise<ReminderRule[]> {
    const result = await this.db
      .prepare(
        `SELECT * FROM reminder_rules WHERE guild_id = ? AND enabled = 1
         ORDER BY trigger_kind ASC, offset_minutes ASC, name ASC`,
      )
      .bind(guildId)
      .all<ReminderRuleRow>();
    return result.results.map(reminderRuleFromRow);
  }

  async enqueueReminder(input: EnqueueReminderInput): Promise<{
    enqueued: boolean;
    delivery: ReminderDelivery;
  }> {
    const now = this.now();
    const result = await this.db
      .prepare(
        `INSERT OR IGNORE INTO reminder_deliveries (
           delivery_id, rule_id, event_id, channel_id, recipient_kind,
           recipient_id, content, scheduled_for, status, idempotency_key,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      )
      .bind(
        input.deliveryId,
        asNullable(input.ruleId),
        input.eventId,
        input.channelId,
        input.recipientKind,
        asNullable(input.recipientId),
        input.content,
        input.scheduledFor,
        input.idempotencyKey,
        now,
        now,
      )
      .run();
    const row = await this.db
      .prepare("SELECT * FROM reminder_deliveries WHERE idempotency_key = ?")
      .bind(input.idempotencyKey)
      .first<ReminderDeliveryRow>();
    if (!row) throw new Error("Reminder delivery was not enqueued or found");
    return { enqueued: result.meta.changes === 1, delivery: deliveryFromRow(row) };
  }

  async listDueReminders(now: number, limit = 25): Promise<ReminderDelivery[]> {
    return this.listDueRemindersWithLease(now, limit, DEFAULT_REMINDER_LEASE_MS);
  }

  async listDueRemindersWithLease(
    now: number,
    limit = 25,
    leaseTimeoutMs = DEFAULT_REMINDER_LEASE_MS,
  ): Promise<ReminderDelivery[]> {
    const staleBefore = now - leaseTimeoutMs;
    const result = await this.db
      .prepare(
        `SELECT deliveries.*
         FROM reminder_deliveries deliveries
         JOIN weekly_events events ON events.event_id = deliveries.event_id
         JOIN guild_config config ON config.guild_id = events.guild_id
         WHERE config.scheduling_enabled = 1 AND (
           (deliveries.status = 'pending' AND deliveries.scheduled_for <= ?)
           OR (deliveries.status = 'failed' AND deliveries.next_attempt_at IS NOT NULL
             AND deliveries.next_attempt_at <= ?)
           OR (deliveries.status = 'sending' AND deliveries.updated_at <= ?)
         )
         ORDER BY COALESCE(deliveries.next_attempt_at, deliveries.scheduled_for) ASC,
           deliveries.delivery_id ASC
         LIMIT ?`,
      )
      .bind(now, now, staleBefore, limit)
      .all<ReminderDeliveryRow>();
    return result.results.map(deliveryFromRow);
  }

  async getReminder(deliveryId: string): Promise<ReminderDelivery | null> {
    const row = await this.db
      .prepare("SELECT * FROM reminder_deliveries WHERE delivery_id = ?")
      .bind(deliveryId)
      .first<ReminderDeliveryRow>();
    return row ? deliveryFromRow(row) : null;
  }

  async listRecentReminders(guildId: string, limit = 20): Promise<ReminderDelivery[]> {
    const result = await this.db
      .prepare(
        `SELECT deliveries.*
         FROM reminder_deliveries deliveries
         JOIN weekly_events events ON events.event_id = deliveries.event_id
         WHERE events.guild_id = ?
         ORDER BY deliveries.updated_at DESC, deliveries.delivery_id DESC
         LIMIT ?`,
      )
      .bind(guildId, limit)
      .all<ReminderDeliveryRow>();
    return result.results.map(deliveryFromRow);
  }

  async claimReminder(
    deliveryId: string,
    leaseTimeoutMs = DEFAULT_REMINDER_LEASE_MS,
  ): Promise<boolean> {
    const now = this.now();
    const staleBefore = now - leaseTimeoutMs;
    const result = await this.db
      .prepare(
        `UPDATE reminder_deliveries SET
           status = 'sending', attempt_count = attempt_count + 1,
           next_attempt_at = NULL, updated_at = ?
         WHERE delivery_id = ? AND (
           (status = 'pending' AND scheduled_for <= ?)
           OR (status = 'failed' AND next_attempt_at IS NOT NULL AND next_attempt_at <= ?)
           OR (status = 'sending' AND updated_at <= ?)
         )`,
      )
      .bind(now, deliveryId, now, now, staleBefore)
      .run();
    return result.meta.changes === 1;
  }

  async retryReminder(
    deliveryId: string,
    leaseTimeoutMs = DEFAULT_REMINDER_LEASE_MS,
  ): Promise<boolean> {
    const now = this.now();
    const result = await this.db
      .prepare(
        `UPDATE reminder_deliveries SET
           status = 'pending', next_attempt_at = NULL, last_error = NULL, updated_at = ?
         WHERE delivery_id = ? AND (
           status = 'failed' OR (status = 'sending' AND updated_at <= ?)
         )`,
      )
      .bind(now, deliveryId, now - leaseTimeoutMs)
      .run();
    return result.meta.changes === 1;
  }

  async skipReminder(
    deliveryId: string,
    reason: string,
    leaseTimeoutMs = DEFAULT_REMINDER_LEASE_MS,
  ): Promise<boolean> {
    const now = this.now();
    const result = await this.db
      .prepare(
        `UPDATE reminder_deliveries SET
           status = 'cancelled', next_attempt_at = NULL, last_error = ?, updated_at = ?
         WHERE delivery_id = ? AND (
           status IN ('pending', 'failed')
           OR (status = 'sending' AND updated_at <= ?)
         )`,
      )
      .bind(reason.slice(0, 1000), now, deliveryId, now - leaseTimeoutMs)
      .run();
    return result.meta.changes === 1;
  }

  async markReminderSent(deliveryId: string, messageId: string): Promise<boolean> {
    const now = this.now();
    const result = await this.db
      .prepare(
        `UPDATE reminder_deliveries SET
           status = 'sent', sent_message_id = ?, sent_at = ?, updated_at = ?,
           last_error = NULL, next_attempt_at = NULL
         WHERE delivery_id = ? AND status = 'sending'`,
      )
      .bind(messageId, now, now, deliveryId)
      .run();
    return result.meta.changes === 1;
  }

  async markReminderFailed(
    deliveryId: string,
    error: string,
    nextAttemptAt: number | null,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE reminder_deliveries SET
           status = 'failed', last_error = ?, next_attempt_at = ?, updated_at = ?
         WHERE delivery_id = ? AND status = 'sending'`,
      )
      .bind(error.slice(0, 1000), nextAttemptAt, this.now(), deliveryId)
      .run();
    return result.meta.changes === 1;
  }

  async beginOperation(input: {
    operationKey: string;
    guildId: string;
    eventId?: string;
    operationKind: string;
    request?: unknown;
  }): Promise<BeginOperationResult> {
    const now = this.now();
    const inserted = await this.db
      .prepare(
        `INSERT OR IGNORE INTO operations (
           operation_key, guild_id, event_id, operation_kind, status,
           request_json, started_at, updated_at
         ) VALUES (?, ?, ?, ?, 'started', ?, ?, ?)`,
      )
      .bind(
        input.operationKey,
        input.guildId,
        asNullable(input.eventId),
        input.operationKind,
        stringifyJson(input.request),
        now,
        now,
      )
      .run();
    let claimed = inserted.meta.changes === 1;
    if (!claimed) {
      const reclaimed = await this.db
        .prepare(
          `UPDATE operations SET
             status = 'started', result_json = NULL, last_error = NULL,
             started_at = ?, updated_at = ?, completed_at = NULL
           WHERE operation_key = ? AND status = 'started' AND updated_at <= ?`,
        )
        .bind(now, now, input.operationKey, now - DEFAULT_OPERATION_LEASE_MS)
        .run();
      claimed = reclaimed.meta.changes === 1;
    }
    const operation = await this.getOperation(input.operationKey);
    if (!operation) throw new Error("Operation was not claimed or found");
    return { claimed, operation };
  }

  async getOperation(operationKey: string): Promise<OperationRecord | null> {
    const row = await this.db
      .prepare("SELECT * FROM operations WHERE operation_key = ?")
      .bind(operationKey)
      .first<OperationRow>();
    return row ? operationFromRow(row) : null;
  }

  async listRecentOperations(
    guildId: string,
    eventId?: string,
    limit = 20,
  ): Promise<OperationRecord[]> {
    const statement = eventId
      ? this.db
          .prepare(
            `SELECT * FROM operations
             WHERE guild_id = ? AND event_id = ?
             ORDER BY updated_at DESC, operation_key DESC LIMIT ?`,
          )
          .bind(guildId, eventId, limit)
      : this.db
          .prepare(
            `SELECT * FROM operations WHERE guild_id = ?
             ORDER BY updated_at DESC, operation_key DESC LIMIT ?`,
          )
          .bind(guildId, limit);
    const result = await statement.all<OperationRow>();
    return result.results.map(operationFromRow);
  }

  async reclaimOperation(
    operationKey: string,
    staleBefore: number,
  ): Promise<boolean> {
    const now = this.now();
    const result = await this.db
      .prepare(
        `UPDATE operations SET
           status = 'started', result_json = NULL, last_error = NULL,
           started_at = ?, updated_at = ?, completed_at = NULL
         WHERE operation_key = ? AND (
           status = 'failed' OR (status = 'started' AND updated_at <= ?)
         )`,
      )
      .bind(now, now, operationKey, staleBefore)
      .run();
    return result.meta.changes === 1;
  }

  async retryOperation(
    operationKey: string,
    leaseTimeoutMs = DEFAULT_OPERATION_LEASE_MS,
  ): Promise<boolean> {
    const now = this.now();
    const result = await this.db
      .prepare(
        `UPDATE operations SET
           status = 'started', result_json = NULL, last_error = NULL,
           started_at = ?, updated_at = ?, completed_at = NULL
         WHERE operation_key = ? AND (
           status = 'failed' OR (status = 'started' AND updated_at <= ?)
         )`,
      )
      .bind(now, now, operationKey, now - leaseTimeoutMs)
      .run();
    return result.meta.changes === 1;
  }

  async finishOperation(
    operationKey: string,
    outcome:
      | { status: "succeeded"; result?: unknown }
      | { status: "failed"; error: string },
  ): Promise<boolean> {
    const now = this.now();
    const result = await this.db
      .prepare(
        `UPDATE operations SET
           status = ?, result_json = ?, last_error = ?, completed_at = ?, updated_at = ?
         WHERE operation_key = ? AND status = 'started'`,
      )
      .bind(
        outcome.status,
        outcome.status === "succeeded" ? stringifyJson(outcome.result) : null,
        outcome.status === "failed" ? outcome.error.slice(0, 1000) : null,
        now,
        now,
        operationKey,
      )
      .run();
    return result.meta.changes === 1;
  }

  async appendAudit(input: {
    guildId: string;
    eventId?: string;
    actorUserId?: string;
    action: string;
    entityType: string;
    entityId?: string;
    details?: unknown;
  }): Promise<number> {
    const result = await this.db
      .prepare(
        `INSERT INTO audit_log (
           guild_id, event_id, actor_user_id, action, entity_type,
           entity_id, details_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.guildId,
        asNullable(input.eventId),
        asNullable(input.actorUserId),
        input.action,
        input.entityType,
        asNullable(input.entityId),
        stringifyJson(input.details),
        this.now(),
      )
      .run();
    return result.meta.last_row_id;
  }

  async listAudit(guildId: string, limit = 50): Promise<AuditEntry[]> {
    const result = await this.db
      .prepare(
        `SELECT * FROM audit_log WHERE guild_id = ?
         ORDER BY created_at DESC, audit_id DESC LIMIT ?`,
      )
      .bind(guildId, limit)
      .all<AuditRow>();
    return result.results.map((row) => ({
      auditId: row.audit_id,
      guildId: row.guild_id,
      eventId: row.event_id,
      actorUserId: row.actor_user_id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      details: parseJson(row.details_json),
      createdAt: row.created_at,
    }));
  }
}
