import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MEMBER_DATA_CLASS_POLICIES,
  MEMBER_DATA_INVENTORY_SCHEMA_VERSION,
  MEMBER_DATA_POLICY_VERSION,
} from "../src/domain/member-data-policy";

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));

describe("member data inventory contract", () => {
  it("matches the runtime policy and exposes counts rather than record contents", () => {
    const contract = JSON.parse(readFileSync(resolve(
      TEST_DIRECTORY,
      "../contracts/member-data-inventory.v1.json",
    ), "utf8")) as {
      schemaVersion: string;
      policyVersion: string;
      mutatesData: boolean;
      countFields: string[];
      classes: Array<{ id: string; departureTreatment: string }>;
      forbiddenPreviewFields: string[];
    };

    expect(contract.schemaVersion).toBe(MEMBER_DATA_INVENTORY_SCHEMA_VERSION);
    expect(contract.policyVersion).toBe(MEMBER_DATA_POLICY_VERSION);
    expect(contract.mutatesData).toBe(false);
    expect(contract.classes).toEqual(MEMBER_DATA_CLASS_POLICIES.map((policy) => ({
      id: policy.id,
      departureTreatment: policy.departureTreatment,
    })));
    expect(contract.countFields).toHaveLength(13);
    expect(contract.forbiddenPreviewFields).toEqual(expect.arrayContaining([
      "discordAccessToken",
      "rawSql",
      "journalText",
      "recapText",
      "sheetUrl",
    ]));
  });
});
