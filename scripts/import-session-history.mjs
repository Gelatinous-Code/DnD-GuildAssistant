import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  buildHistoricalImport,
  historicalImportLifecycleSql,
  historicalImportSql,
  sha256,
} from "./session-history-import-lib.mjs";

function usage() {
  return `Usage:
  node scripts/import-session-history.mjs dry-run --source <csv> --guild <id> --season <label> [options]
  node scripts/import-session-history.mjs prepare --source <csv> --guild <id> --season <label> --out <sql> [options]
  node scripts/import-session-history.mjs publish|rollback|recover --guild <id> --batch <id> --actor <id> --reason <text> --out <sql>

Import options:
  --source-url <url>       Original Google Sheet URL
  --worksheet-gid <gid>   Source worksheet gid (default: 0)
  --retrieved-at <iso>    Export retrieval time (defaults to source file mtime)
  --mapping <json>        Reviewable { version, mappings: { "GM name": "Discord ID" } }
  --actor <id>            Operator/audit actor (default: operator:unassigned)
  --expect-rows <n>       Fail reconciliation if row count differs
  --expect-dates <n>      Fail reconciliation if distinct date count differs
  --expect-links <n>      Fail reconciliation if journal-link count differs
  --report <json>         Write the validation report to this path
`;
}

function parseArgs(argv) {
  const [mode, ...rest] = argv;
  if (!mode || mode === "--help" || mode === "-h") return { mode: "help", values: {} };
  const values = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const name = token.slice(2);
    const value = rest[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${name}`);
    }
    values[name] = value;
    index += 1;
  }
  return { mode, values };
}

function required(values, name) {
  const value = values[name];
  if (!value?.trim()) throw new Error(`--${name} is required`);
  return value.trim();
}

function optionalInteger(values, name) {
  if (values[name] === undefined) return undefined;
  const value = Number(values[name]);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`--${name} must be a non-negative whole number`);
  }
  return value;
}

async function writeOutput(filename, content) {
  await writeFile(path.resolve(filename), content, "utf8");
}

async function importPlan(values) {
  const sourcePath = path.resolve(required(values, "source"));
  const csvText = await readFile(sourcePath, "utf8");
  const sourceStat = await stat(sourcePath);
  const mappingText = values.mapping
    ? await readFile(path.resolve(values.mapping), "utf8")
    : JSON.stringify({ version: "unmapped", mappings: {} });
  const identityMapping = JSON.parse(mappingText);
  const retrievedAt = values["retrieved-at"]
    ? Date.parse(values["retrieved-at"])
    : Math.trunc(sourceStat.mtimeMs);
  if (!Number.isSafeInteger(retrievedAt)) throw new Error("--retrieved-at must be a valid ISO date");
  return buildHistoricalImport({
    csvText,
    contentChecksum: sha256(csvText),
    mappingChecksum: sha256(mappingText),
    identityMapping,
    guildId: required(values, "guild"),
    seasonLabel: required(values, "season"),
    sourceUrl: values["source-url"] ??
      "https://docs.google.com/spreadsheets/d/1eJRjLd9NdRB3ntrjwn9E482cJvVOdtB4YTLcH-0ag7s/edit?gid=0#gid=0",
    worksheetGid: values["worksheet-gid"] ?? "0",
    retrievedAt,
    actorUserId: values.actor ?? "operator:unassigned",
    createdAt: Date.now(),
    expectations: {
      rows: optionalInteger(values, "expect-rows"),
      dates: optionalInteger(values, "expect-dates"),
      journalLinks: optionalInteger(values, "expect-links"),
    },
  });
}

async function main() {
  const { mode, values } = parseArgs(process.argv.slice(2));
  if (mode === "help") {
    process.stdout.write(usage());
    return;
  }
  if (mode === "dry-run" || mode === "prepare") {
    const plan = await importPlan(values);
    const report = JSON.stringify(plan.report, null, 2) + "\n";
    process.stdout.write(report);
    if (values.report) await writeOutput(values.report, report);
    if (!plan.report.valid) process.exitCode = 1;
    if (mode === "prepare") {
      if (!plan.report.valid) throw new Error("Refusing to prepare SQL for an invalid import");
      await writeOutput(required(values, "out"), historicalImportSql(plan));
    }
    return;
  }
  if (mode === "publish" || mode === "rollback" || mode === "recover") {
    const occurredAt = Date.now();
    const sql = historicalImportLifecycleSql({
      action: mode,
      guildId: required(values, "guild"),
      batchId: required(values, "batch"),
      actorUserId: required(values, "actor"),
      reason: required(values, "reason"),
      occurredAt,
    });
    await writeOutput(required(values, "out"), sql);
    process.stdout.write(JSON.stringify({
      action: mode,
      batchId: values.batch,
      occurredAt,
      sql: path.resolve(values.out),
    }, null, 2) + "\n");
    return;
  }
  throw new Error(`Unknown mode: ${mode}\n\n${usage()}`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
