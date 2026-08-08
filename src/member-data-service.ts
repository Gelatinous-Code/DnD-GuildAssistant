import {
  MEMBER_DATA_CLASS_POLICIES,
  MEMBER_DATA_INVENTORY_SCHEMA_VERSION,
  MEMBER_DATA_POLICY_VERSION,
  totalForPolicy,
  type MemberDataClassId,
  type MemberDataCounts,
  type MemberDataPreviewAction,
} from "./domain/member-data-policy";
import {
  generateMemberDataExport,
  memberDataRevision,
  type MemberDataExportArtifact,
  type MemberDataSnapshot,
} from "./member-data-export";

export interface MemberDataSnapshotReader {
  snapshot(guildId: string, userId: string): Promise<MemberDataSnapshot>;
}

export interface MemberDataPreview {
  schemaVersion: typeof MEMBER_DATA_INVENTORY_SCHEMA_VERSION;
  policyVersion: typeof MEMBER_DATA_POLICY_VERSION;
  action: MemberDataPreviewAction;
  guildId: string;
  subjectUserId: string;
  generatedAt: number;
  revision: string;
  counts: MemberDataCounts;
  classes: Array<{
    id: MemberDataClassId;
    label: string;
    recordCount: number;
    treatment: string;
    rationale: string;
  }>;
  mutatesData: false;
}

function boundedIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 100) throw new TypeError(`${label} is invalid`);
  return normalized;
}

function requireRevision(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new TypeError("Revision must be the 64-character value from /member-data preview");
  }
  return normalized;
}

export class MemberDataRevisionConflictError extends Error {
  constructor(readonly expectedRevision: string, readonly actualRevision: string) {
    super("Member data changed after preview; create a fresh preview before exporting.");
    this.name = "MemberDataRevisionConflictError";
  }
}

export class MemberDataService {
  constructor(
    private readonly repository: MemberDataSnapshotReader,
    private readonly now: () => number = Date.now,
  ) {}

  private async readSnapshot(guildId: string, subjectUserId: string) {
    return this.repository.snapshot(
      boundedIdentifier(guildId, "Guild ID"),
      boundedIdentifier(subjectUserId, "Member ID"),
    );
  }

  async preview(input: {
    guildId: string;
    subjectUserId: string;
    action: MemberDataPreviewAction;
  }): Promise<MemberDataPreview> {
    if (input.action !== "export" && input.action !== "departure") {
      throw new TypeError("Preview action must be export or departure");
    }
    const snapshot = await this.readSnapshot(input.guildId, input.subjectUserId);
    const revision = await memberDataRevision(snapshot);
    return {
      schemaVersion: MEMBER_DATA_INVENTORY_SCHEMA_VERSION,
      policyVersion: MEMBER_DATA_POLICY_VERSION,
      action: input.action,
      guildId: snapshot.guildId,
      subjectUserId: snapshot.subjectUserId,
      generatedAt: this.now(),
      revision,
      counts: snapshot.counts,
      classes: MEMBER_DATA_CLASS_POLICIES.map((policy) => ({
        id: policy.id,
        label: policy.label,
        recordCount: totalForPolicy(policy, snapshot.counts),
        treatment: input.action === "export" ? policy.exportTreatment : policy.departureTreatment,
        rationale: policy.rationale,
      })),
      mutatesData: false,
    };
  }

  async export(input: {
    guildId: string;
    subjectUserId: string;
    expectedRevision: string;
  }): Promise<MemberDataExportArtifact> {
    const expectedRevision = requireRevision(input.expectedRevision);
    const snapshot = await this.readSnapshot(input.guildId, input.subjectUserId);
    const artifact = await generateMemberDataExport(snapshot, this.now());
    if (artifact.revision !== expectedRevision) {
      throw new MemberDataRevisionConflictError(expectedRevision, artifact.revision);
    }
    return artifact;
  }
}
