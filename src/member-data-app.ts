import type { DiscordInteraction } from "./discord";
import { DiscordRestClient } from "./discord-api";
import {
  ephemeral,
  isGuildAdmin,
  parseCommand,
  requireGuild,
  stringOption,
  UserFacingError,
} from "./interaction-utils";
import {
  MEMBER_DATA_EXPORT_SCHEMA_VERSION,
  MemberDataExportLimitError,
  type MemberDataExportArtifact,
} from "./member-data-export";
import {
  MemberDataRevisionConflictError,
  MemberDataService,
  type MemberDataPreview,
} from "./member-data-service";
import { diagnoseInteractionPermissions } from "./policy";
import { MemberDataExportRepository } from "./storage/member-data-export-repository";
import { GuildRepository, type OperationRecord } from "./storage/repository";

const EXPORT_OPERATION_KIND = "member-data-export.v1";

interface MemberVerifier {
  getGuildMember(guildId: string, userId: string): Promise<unknown>;
}

interface ExportOperationRequest {
  schemaVersion: typeof MEMBER_DATA_EXPORT_SCHEMA_VERSION;
  actorUserId: string;
  subjectUserId: string;
  expectedRevision: string;
}

const TREATMENT_LABELS: Readonly<Record<string, string>> = {
  include: "include in export",
  pseudonymize_presentation: "pseudonymize optional presentation",
  archive_and_remove_personal_links: "archive and remove personal links",
  hide_then_tombstone_authored_content: "hide, then tombstone authored content",
  preserve_shared_campaign_history: "preserve shared campaign history",
  preserve_append_only_financial_history: "preserve append-only balance history",
  close_entitlements_and_preserve_history: "close entitlements; preserve history",
};

function formatPreview(preview: MemberDataPreview): string {
  const lines = preview.classes.map((item) =>
    `• **${item.label}:** ${item.recordCount} · ${TREATMENT_LABELS[item.treatment] ?? item.treatment}`
  );
  const actionLabel = preview.action === "export" ? "member export" : "member departure";
  return [
    `🔎 **Read-only ${actionLabel} preview** for <@${preview.subjectUserId}>`,
    `Policy: \`${preview.policyVersion}\` · generated <t:${Math.floor(preview.generatedAt / 1_000)}:R>`,
    "",
    ...lines,
    "",
    `Revision: \`${preview.revision}\``,
    preview.action === "export"
      ? "Use that complete revision with `/member-data export`. It becomes invalid if this member's exportable data changes."
      : "No data changed. Departure execution is not enabled yet.",
    "No data changed. This preview does not create an export, revoke access, archive a character, or start deletion.",
  ].join("\n");
}

function parseExportRequest(operation: OperationRecord): ExportOperationRequest {
  const request = operation.request as Partial<ExportOperationRequest> | null;
  if (
    !request || request.schemaVersion !== MEMBER_DATA_EXPORT_SCHEMA_VERSION ||
    typeof request.actorUserId !== "string" || typeof request.subjectUserId !== "string" ||
    typeof request.expectedRevision !== "string"
  ) {
    throw new UserFacingError("That export operation has invalid stored request metadata.");
  }
  return request as ExportOperationRequest;
}

function formatOperation(operation: OperationRecord): string {
  const request = parseExportRequest(operation);
  const completion = operation.completedAt
    ? ` · completed <t:${Math.floor(operation.completedAt / 1_000)}:R>`
    : "";
  return [
    `**Member export operation** \`${operation.operationKey}\``,
    `Subject: <@${request.subjectUserId}> · status: **${operation.status}**${completion}`,
    `Snapshot revision: \`${request.expectedRevision}\``,
    operation.status === "failed"
      ? "Use `/member-data retry` with this operation ID. A changed revision requires a fresh preview and export."
      : "The status response never includes exported content.",
  ].join("\n");
}

function attachmentResponse(
  guildId: string,
  actorUserId: string,
  subjectUserId: string,
  operationKey: string,
  artifact: MemberDataExportArtifact,
): Response {
  return Response.json({
    type: 4,
    data: {
      content: `✅ Private member export ready: **${artifact.filename}** (${artifact.recordCount} records).\nOperation: \`${operationKey}\``,
      flags: 64,
      allowed_mentions: { parse: [] },
    },
    attachment: {
      filename: artifact.filename,
      contentType: artifact.contentType,
      content: artifact.text,
      audit: {
        guildId,
        actorUserId,
        action: "member-data.export-delivered",
        failureAction: "member-data.export-delivery-failed",
        entityType: "discord_member",
        entityId: subjectUserId,
        operationKey,
        failureMessage:
          `⚠️ The member export was generated, but Discord did not receive the file. Check Attach Files, then run /member-data retry with operation \`${operationKey}\`.`,
        details: {
          schemaVersion: artifact.schemaVersion,
          policyVersion: artifact.policyVersion,
          subjectUserId,
          revision: artifact.revision,
          recordCount: artifact.recordCount,
          byteLength: artifact.byteLength,
          filename: artifact.filename,
        },
      },
    },
  });
}

async function verifyMember(verifier: MemberVerifier, guildId: string, userId: string) {
  try {
    await verifier.getGuildMember(guildId, userId);
  } catch {
    throw new UserFacingError("That member could not be verified in this server.");
  }
}

function requireAttachFiles(interaction: DiscordInteraction): void {
  const attachFiles = diagnoseInteractionPermissions(interaction.app_permissions)
    .find((check) => check.name === "Attach Files");
  if (attachFiles?.level !== "pass") {
    throw new UserFacingError(
      "This channel does not grant the bot Attach Files. Allow that permission, then retry the export.",
    );
  }
}

export async function handleMemberDataCommand(
  interaction: DiscordInteraction,
  env: Env,
  verifier: MemberVerifier = new DiscordRestClient(env.DISCORD_BOT_TOKEN),
): Promise<Response | null> {
  const invocation = parseCommand(interaction);
  if (invocation.command !== "member-data") return null;
  if (!isGuildAdmin(interaction)) {
    throw new UserFacingError("This command requires Manage Server permission.");
  }
  const guildId = requireGuild(interaction);
  const actorUserId = interaction.member?.user?.id;
  if (!actorUserId) throw new UserFacingError("The administrator identity is missing.");
  const service = new MemberDataService(new MemberDataExportRepository(env.DB));
  const operations = new GuildRepository(env.DB);

  try {
    if (invocation.subcommand === "preview") {
      const subjectUserId = stringOption(invocation, "member");
      const action = stringOption(invocation, "action");
      if (!subjectUserId) throw new UserFacingError("Choose a member.");
      if (action !== "export" && action !== "departure") {
        throw new UserFacingError("Choose export or departure.");
      }
      await verifyMember(verifier, guildId, subjectUserId);
      return ephemeral(formatPreview(await service.preview({ guildId, subjectUserId, action })));
    }

    if (invocation.subcommand === "export") {
      requireAttachFiles(interaction);
      const subjectUserId = stringOption(invocation, "member");
      const expectedRevision = stringOption(invocation, "revision");
      if (!subjectUserId || !expectedRevision) {
        throw new UserFacingError("Choose a member and paste the revision from preview.");
      }
      await verifyMember(verifier, guildId, subjectUserId);
      const artifact = await service.export({ guildId, subjectUserId, expectedRevision });
      const operationKey = `member-export:${interaction.id ?? crypto.randomUUID()}`;
      const begun = await operations.beginOperation({
        operationKey,
        guildId,
        operationKind: EXPORT_OPERATION_KIND,
        request: {
          schemaVersion: artifact.schemaVersion,
          actorUserId,
          subjectUserId,
          expectedRevision: artifact.revision,
        } satisfies ExportOperationRequest,
      });
      if (!begun.claimed) {
        if (begun.operation.guildId !== guildId || begun.operation.operationKind !== EXPORT_OPERATION_KIND) {
          throw new UserFacingError("The export request ID conflicts with another operation.");
        }
        return ephemeral(formatOperation(begun.operation));
      }
      return attachmentResponse(guildId, actorUserId, subjectUserId, operationKey, artifact);
    }

    if (invocation.subcommand === "status" || invocation.subcommand === "retry") {
      const operationKey = stringOption(invocation, "operation");
      if (!operationKey) throw new UserFacingError("Provide the member export operation ID.");
      const operation = await operations.getOperation(operationKey);
      if (!operation || operation.guildId !== guildId || operation.operationKind !== EXPORT_OPERATION_KIND) {
        throw new UserFacingError("That member export operation was not found in this server.");
      }
      if (invocation.subcommand === "status") return ephemeral(formatOperation(operation));
      if (operation.status === "succeeded") return ephemeral(formatOperation(operation));
      const request = parseExportRequest(operation);
      await verifyMember(verifier, guildId, request.subjectUserId);
      requireAttachFiles(interaction);
      if (!(await operations.retryOperation(operationKey))) {
        const current = await operations.getOperation(operationKey);
        return ephemeral(formatOperation(current ?? operation));
      }
      try {
        const artifact = await service.export({
          guildId,
          subjectUserId: request.subjectUserId,
          expectedRevision: request.expectedRevision,
        });
        return attachmentResponse(
          guildId, actorUserId, request.subjectUserId, operationKey, artifact,
        );
      } catch (error) {
        await operations.finishOperation(operationKey, {
          status: "failed",
          error: error instanceof MemberDataRevisionConflictError
            ? "revision_conflict"
            : `export_generation_failed:${error instanceof Error ? error.name : typeof error}`,
        });
        throw error;
      }
    }

    throw new UserFacingError("Choose member-data preview, export, status, or retry.");
  } catch (error) {
    if (error instanceof MemberDataRevisionConflictError) {
      await operations.appendAudit({
        guildId,
        actorUserId,
        action: "member-data.export-rejected",
        entityType: "discord_member",
        entityId: stringOption(invocation, "member"),
        details: { reason: "revision_conflict" },
      });
      throw new UserFacingError(error.message);
    }
    if (error instanceof MemberDataExportLimitError) {
      throw new UserFacingError(
        error.limit === "bytes"
          ? `The member export is too large for a safe Discord attachment (${error.actual} bytes; limit ${error.maximum}).`
          : `The member export has too many ${error.collection} records (limit ${error.maximum}).`,
      );
    }
    if (error instanceof TypeError || error instanceof RangeError) {
      throw new UserFacingError(error.message);
    }
    throw error;
  }
}
