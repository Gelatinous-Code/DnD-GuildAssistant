export const MEMBER_DATA_INVENTORY_SCHEMA_VERSION = "member-data-inventory.v1";
export const MEMBER_DATA_POLICY_VERSION = "member-data-lifecycle.v1";

export type MemberDataPreviewAction = "export" | "departure";

export interface MemberDataCounts {
  characters: number;
  characterEvents: number;
  journals: number;
  journalRevisions: number;
  seasonalBalances: number;
  progressionEntries: number;
  shopReceipts: number;
  officialRecaps: number;
  recapRevisions: number;
  weeklySignups: number;
  tableAssignments: number;
  sessionParticipationRecords: number;
  dmPriorityCredits: number;
}

export type MemberDataClassId =
  | "profile_references"
  | "characters"
  | "journals"
  | "official_recaps"
  | "progression"
  | "shop_receipts"
  | "priority_and_attendance";

export interface MemberDataClassPolicy {
  id: MemberDataClassId;
  label: string;
  countFields: readonly (keyof MemberDataCounts)[];
  exportTreatment: "include";
  departureTreatment:
    | "pseudonymize_presentation"
    | "archive_and_remove_personal_links"
    | "hide_then_tombstone_authored_content"
    | "preserve_shared_campaign_history"
    | "preserve_append_only_financial_history"
    | "close_entitlements_and_preserve_history";
  rationale: string;
}

export const MEMBER_DATA_CLASS_POLICIES: readonly MemberDataClassPolicy[] = [
  {
    id: "profile_references",
    label: "Weekly profile references",
    countFields: ["weeklySignups", "tableAssignments"],
    exportTreatment: "include",
    departureTreatment: "pseudonymize_presentation",
    rationale: "Remove optional display presentation while retaining table and waitlist history.",
  },
  {
    id: "characters",
    label: "Characters",
    countFields: ["characters", "characterEvents"],
    exportTreatment: "include",
    departureTreatment: "archive_and_remove_personal_links",
    rationale: "Archive play eligibility and remove sheet links without erasing campaign identity or audit history.",
  },
  {
    id: "journals",
    label: "Player-authored journals",
    countFields: ["journals", "journalRevisions"],
    exportTreatment: "include",
    departureTreatment: "hide_then_tombstone_authored_content",
    rationale: "Stop publication first; confirmed deletion replaces authored presentation without rewriting audit facts.",
  },
  {
    id: "official_recaps",
    label: "Official session recaps",
    countFields: ["officialRecaps", "recapRevisions"],
    exportTreatment: "include",
    departureTreatment: "preserve_shared_campaign_history",
    rationale: "Official recaps are shared guild history and remain subject to normal moderation and correction controls.",
  },
  {
    id: "progression",
    label: "Seasonal progression",
    countFields: ["seasonalBalances", "progressionEntries"],
    exportTreatment: "include",
    departureTreatment: "preserve_append_only_financial_history",
    rationale: "XP and in-game gold require immutable entries, reversals, and season provenance to remain explainable.",
  },
  {
    id: "shop_receipts",
    label: "In-game shop receipts",
    countFields: ["shopReceipts"],
    exportTreatment: "include",
    departureTreatment: "preserve_append_only_financial_history",
    rationale: "Receipts explain character gold changes and are corrected by reversal rather than deletion.",
  },
  {
    id: "priority_and_attendance",
    label: "Attendance and DM priority",
    countFields: ["sessionParticipationRecords", "dmPriorityCredits"],
    exportTreatment: "include",
    departureTreatment: "close_entitlements_and_preserve_history",
    rationale: "Future entitlements close while attendance, grants, redemption, and correction history remains auditable.",
  },
] as const;

export function totalForPolicy(
  policy: MemberDataClassPolicy,
  counts: MemberDataCounts,
): number {
  return policy.countFields.reduce((total, field) => total + counts[field], 0);
}
