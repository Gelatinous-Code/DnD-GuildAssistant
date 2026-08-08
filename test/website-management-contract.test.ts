import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type Field = {
  id: string;
  source: string[];
  access: string;
  sensitivity: string;
  permission: string;
  valueShape?: string[];
};

type ManagementContract = {
  contractSetVersion: string;
  implementationStatus: string;
  transport: {
    kind: string;
    entrypoint: string;
    browserCallable: boolean;
    publicHttpRoute: string | null;
    sharedServiceSecretRequired: boolean;
  };
  authentication: Record<string, unknown>;
  requestEnvelope: { required: string[]; maximumSerializedBytes: number; unknownFields: string };
  methods: Record<string, { version: string; implementationIssue: number; sideEffects: boolean }>;
  revision: Record<string, unknown>;
  rateLimits: { methods: Record<string, number> };
  audit: { neverRecord: string[] } & Record<string, unknown>;
  configurationFields: Field[];
  fieldHelp: Record<string, string>;
  unavailableSettings: Array<{ id: string; reason: string }>;
  diagnostics: { forbiddenCheckFields: string[] };
  stableErrors: string[];
  excludedResponseData: string[];
  fallback: Record<string, unknown>;
};

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));

function contract(): ManagementContract {
  return JSON.parse(readFileSync(
    resolve(TEST_DIRECTORY, "../contracts/website-management.v1.json"),
    "utf8",
  )) as ManagementContract;
}

describe("website management API contract", () => {
  it("uses an internal named RPC entrypoint and independently authorizes every actor", () => {
    const manifest = contract();
    expect(manifest.contractSetVersion).toBe("website-management.v1");
    expect(manifest.implementationStatus).toBe("read_only");
    expect(manifest.transport).toMatchObject({
      kind: "cloudflare_service_binding_rpc",
      entrypoint: "WebsiteManagementApi",
      browserCallable: false,
      publicHttpRoute: null,
      sharedServiceSecretRequired: false,
    });
    expect(manifest.authentication).toMatchObject({
      endUserProof: "discord_oauth_bearer",
      reauthorizeEveryCall: true,
      requiredRole: "administrator",
      gmRoleAloneGrantsAccess: false,
      trustCallerSuppliedActor: false,
      serviceBindingIsCallerCapabilityNotUserAuthorization: true,
      failClosedWhenDiscordUnavailable: true,
    });
    expect(manifest.requestEnvelope.required).toEqual([
      "contractVersion", "guildId", "discordAccessToken", "correlationId",
    ]);
    expect(manifest.requestEnvelope.maximumSerializedBytes).toBeLessThanOrEqual(64 * 1024);
    expect(manifest.requestEnvelope.unknownFields).toBe("reject");
  });

  it("versions every planned capability and reserves writes for issue 60", () => {
    const manifest = contract();
    const expectedMethods = [
      "describeManagementContract",
      "getEffectiveConfiguration",
      "getDiagnostics",
      "previewConfiguration",
      "applyConfiguration",
    ];
    expect(Object.keys(manifest.methods)).toEqual(expectedMethods);
    for (const [name, method] of Object.entries(manifest.methods)) {
      expect(method.version).toMatch(/\.v1$/);
      expect([59, 60]).toContain(method.implementationIssue);
      expect(manifest.rateLimits.methods).toHaveProperty(name);
    }
    expect(manifest.methods.previewConfiguration.implementationIssue).toBe(60);
    expect(manifest.methods.applyConfiguration).toMatchObject({ implementationIssue: 60, sideEffects: true });
    expect(manifest.revision).toMatchObject({
      type: "opaque_sha256_base64url",
      expectedRevisionRequiredForPreviewAndApply: true,
      rawUpdatedAtIsNotConcurrencyControl: true,
    });
  });

  it("maps every supported field to one authority without exposing raw Discord IDs", () => {
    const manifest = contract();
    const ids = manifest.configurationFields.map((field) => field.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([
      "channels.player_signup_and_tables", "roles.guild_player", "roles.administrator",
      "schedule.timezone", "schedule.game.weekday", "schedule.game.time",
      "tables.minimum", "tables.preferred", "tables.maximum",
      "automation.mode", "reminders.pre_lock.enabled",
    ]));
    for (const field of manifest.configurationFields) {
      expect(field.source.length).toBeGreaterThan(0);
      expect(field.access).toBe("read_preview_apply");
      expect(field.sensitivity).not.toBe("");
      expect(["manage_guild", "administrator"]).toContain(field.permission);
      if (field.id.startsWith("channels.") || field.id.startsWith("roles.")) {
        expect(field.valueShape).toContain("opaqueReference");
        expect(field.valueShape).not.toContain("id");
      }
    }
    expect(Object.keys(manifest.fieldHelp).sort()).toEqual([...ids].sort());
  });

  it("fails closed around secrets, internal identifiers, and private history", () => {
    const manifest = contract();
    expect(manifest.stableErrors).toEqual(expect.arrayContaining([
      "administrator_role_required", "membership_verification_unavailable", "rate_limited",
      "revision_conflict", "confirmation_required",
    ]));
    expect(manifest.excludedResponseData).toEqual(expect.arrayContaining([
      "discord_access_token", "discord_bot_token", "oauth_client_secret", "raw_d1_row",
      "raw_discord_channel_id", "raw_discord_role_id", "private_member_history",
    ]));
    expect(manifest.diagnostics.forbiddenCheckFields).toEqual(expect.arrayContaining([
      "rawDiscordId", "memberHistory", "actorUserId", "exception", "token", "secret",
    ]));
    expect(manifest.unavailableSettings.map((setting) => setting.reason)).toEqual(
      expect.arrayContaining(["secret", "deployer_only", "provider_internal", "private_history"]),
    );
    expect(manifest.fallback).toMatchObject({
      operationalAuthority: "Discord commands",
      managementApiCanBeDisabledIndependently: true,
      scheduledWorkflowUnaffected: true,
      directD1EditsAllowed: false,
    });
    expect(manifest.audit).toMatchObject({
      correlationIdIsIdentityOrAuthorization: false,
      verifiedActorDerivedByProvider: true,
    });
    expect(manifest.audit.neverRecord).toEqual(expect.arrayContaining([
      "discordAccessToken", "botToken", "oauthClientSecret", "privateMemberHistory",
    ]));
  });
});
