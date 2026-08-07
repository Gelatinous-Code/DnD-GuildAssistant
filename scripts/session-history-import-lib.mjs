import { createHash } from "node:crypto";

const COLUMN = Object.freeze({
  sourceKey: 0,
  month: 1,
  day: 2,
  year: 3,
  gameDate: 4,
  gmName: 5,
  location: 6,
  influence: 7,
  summary: 8,
  players: 9,
  playerSummaryStatus: 10,
  playerSummaryDate: 11,
  playerSummaryUrl: 12,
});

const EXPECTED_HEADERS = new Map([
  [COLUMN.sourceKey, "Put Together"],
  [COLUMN.gameDate, "Game Date"],
  [COLUMN.gmName, "GM Name"],
  [COLUMN.location, "Game Location"],
  [COLUMN.influence, "Game Influence"],
  [COLUMN.summary, "Game Summary and Shoutouts"],
  [COLUMN.players, "Players"],
  [COLUMN.playerSummaryStatus, "Player Summaries Exist?"],
  [COLUMN.playerSummaryDate, "Game Date"],
  [COLUMN.playerSummaryUrl, "Player Summary URL"],
]);

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.endsWith("\r") ? field.slice(0, -1) : field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("CSV ended inside a quoted field");
  if (field.length || row.length) {
    row.push(field.endsWith("\r") ? field.slice(0, -1) : field);
    rows.push(row);
  }
  return rows;
}

export function normalizeIdentity(value) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
}

function normalizeDate(value, rowNumber, errors) {
  const match = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(value);
  if (!match) {
    errors.push({ rowNumber, field: "game_date", message: `Invalid date: ${value || "(blank)"}` });
    return null;
  }
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    errors.push({ rowNumber, field: "game_date", message: `Invalid date: ${value}` });
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-` +
    String(day).padStart(2, "0");
}

function optional(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}

function stableRowValues(row) {
  return Array.from({ length: 13 }, (_, index) => String(row[index] ?? ""));
}

function validateHeaders(header, errors) {
  for (const [index, expected] of EXPECTED_HEADERS) {
    const actual = String(header[index] ?? "").trim();
    if (actual !== expected) {
      errors.push({
        rowNumber: 1,
        field: `column_${index + 1}`,
        message: `Expected header ${JSON.stringify(expected)} at column ${index + 1}; found ${JSON.stringify(actual)}`,
      });
    }
  }
}

function normalizeMapping(mappingDocument) {
  const source = mappingDocument?.mappings ?? mappingDocument ?? {};
  return new Map(Object.entries(source).map(([name, userId]) => [
    normalizeIdentity(name),
    String(userId).trim(),
  ]));
}

export function buildHistoricalImport(input) {
  const errors = [];
  const warnings = [];
  const csvRows = parseCsv(input.csvText);
  if (!csvRows.length) throw new Error("The source CSV is empty");
  validateHeaders(csvRows[0], errors);
  const mapping = normalizeMapping(input.identityMapping);
  const gmVariants = new Map();
  const records = [];
  for (let index = 1; index < csvRows.length; index += 1) {
    const raw = stableRowValues(csvRows[index]);
    if (raw.every((value) => !value.trim())) continue;
    const rowNumber = index + 1;
    const gameDate = normalizeDate(raw[COLUMN.gameDate], rowNumber, errors);
    const gmOriginal = raw[COLUMN.gmName].trim();
    const gmNormalized = normalizeIdentity(gmOriginal);
    const summary = raw[COLUMN.summary].trim();
    const sourceKey = raw[COLUMN.sourceKey].trim() || `row-${rowNumber}`;
    if (!gmOriginal) errors.push({ rowNumber, field: "gm_name", message: "GM name is blank" });
    if (!summary) errors.push({ rowNumber, field: "official_summary", message: "Official summary is blank" });
    if (!raw[COLUMN.location].trim()) {
      warnings.push({ rowNumber, field: "game_location", message: "Game location is blank" });
    }
    const playerSummaryUrl = optional(raw[COLUMN.playerSummaryUrl]);
    if (playerSummaryUrl && !/^https?:\/\//i.test(playerSummaryUrl)) {
      errors.push({
        rowNumber,
        field: "player_summary_url",
        message: "Player summary URL is not an http(s) URL",
      });
    }
    if (gmOriginal) {
      const variants = gmVariants.get(gmNormalized) ?? new Set();
      variants.add(gmOriginal);
      gmVariants.set(gmNormalized, variants);
    }
    const gmUserId = mapping.get(gmNormalized) || null;
    const recordSource = {
      sourceRowNumber: rowNumber,
      sourceRowKey: sourceKey,
      gameDate,
      gmOriginal,
      gmNormalized,
      gmUserId,
      gameLocation: raw[COLUMN.location].trim(),
      gameInfluence: optional(raw[COLUMN.influence]),
      officialSummary: summary,
      playersOriginal: optional(raw[COLUMN.players]),
      playerSummaryStatus: optional(raw[COLUMN.playerSummaryStatus]),
      playerSummaryDate: optional(raw[COLUMN.playerSummaryDate]),
      playerSummaryUrl,
      identityStatus: gmUserId ? "matched" : "unmatched",
      sourceValues: raw,
    };
    const rowChecksum = sha256(JSON.stringify(recordSource.sourceValues));
    records.push({
      ...recordSource,
      rowChecksum,
      historicalRecordId: `history-record:${sha256(`${input.guildId}\n${input.seasonLabel}\n${rowNumber}\n${rowChecksum}`).slice(0, 40)}`,
    });
  }

  const contentChecksum = input.contentChecksum ?? sha256(input.csvText);
  const mappingChecksum = input.mappingChecksum ?? sha256(JSON.stringify(input.identityMapping ?? {}));
  const batchId = `history-import:${sha256(`${input.guildId}\n${input.seasonLabel}\n${contentChecksum}`).slice(0, 40)}`;
  const dates = new Set(records.map((record) => record.gameDate).filter(Boolean));
  const journalLinkCount = records.filter((record) => record.playerSummaryUrl).length;
  const unmatchedIdentityCount = records.filter((record) => !record.gmUserId).length;
  const expectations = input.expectations ?? {};
  for (const [name, actual, expected] of [
    ["rows", records.length, expectations.rows],
    ["dates", dates.size, expectations.dates],
    ["journal links", journalLinkCount, expectations.journalLinks],
  ]) {
    if (expected !== undefined && actual !== expected) {
      errors.push({
        rowNumber: null,
        field: "reconciliation",
        message: `Expected ${expected} ${name}; found ${actual}`,
      });
    }
  }
  const variants = Object.fromEntries(
    [...gmVariants.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, values]) => [
      name,
      [...values].sort(),
    ]),
  );
  const report = {
    batchId,
    contentChecksum,
    mappingChecksum,
    sourceRows: records.length,
    distinctDates: dates.size,
    journalLinkCount,
    unmatchedIdentityCount,
    normalizedGmCount: gmVariants.size,
    gmVariants: variants,
    errors,
    warnings,
    valid: errors.length === 0,
  };
  return {
    batch: {
      batchId,
      guildId: input.guildId,
      seasonLabel: input.seasonLabel,
      sourceUrl: input.sourceUrl,
      worksheetGid: String(input.worksheetGid),
      retrievedAt: input.retrievedAt,
      contentChecksum,
      mappingVersion: String(input.identityMapping?.version ?? "unversioned"),
      mappingChecksum,
      status: "staged",
      createdByUserId: input.actorUserId,
      createdAt: input.createdAt,
    },
    records,
    report,
  };
}

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError(`Unsafe SQL integer: ${value}`);
    return String(value);
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function historicalImportSql(plan) {
  if (!plan.report.valid) throw new Error("Cannot prepare SQL for an invalid import plan");
  const { batch, report } = plan;
  const statements = [
    `INSERT OR IGNORE INTO historical_summary_import_batches (` +
      `batch_id, guild_id, season_label, source_url, worksheet_gid, retrieved_at, ` +
      `content_checksum, mapping_version, mapping_checksum, status, source_row_count, ` +
      `imported_summary_count, journal_link_count, unmatched_identity_count, ` +
      `validation_report_json, created_by_user_id, created_at` +
      `) VALUES (` + [
        batch.batchId,
        batch.guildId,
        batch.seasonLabel,
        batch.sourceUrl,
        batch.worksheetGid,
        batch.retrievedAt,
        batch.contentChecksum,
        batch.mappingVersion,
        batch.mappingChecksum,
        "staged",
        report.sourceRows,
        report.sourceRows,
        report.journalLinkCount,
        report.unmatchedIdentityCount,
        JSON.stringify(report),
        batch.createdByUserId,
        batch.createdAt,
      ].map(sqlValue).join(", ") + `);`,
  ];
  for (const record of plan.records) {
    statements.push(
      `INSERT OR IGNORE INTO historical_session_records (` +
        `historical_record_id, batch_id, guild_id, source_row_number, source_row_key, ` +
        `row_checksum, season_label, game_date, gm_original, gm_normalized, gm_user_id, ` +
        `game_location, game_influence, official_summary, players_original, ` +
        `player_summary_status, player_summary_date, player_summary_url, identity_status, ` +
        `source_values_json, created_at` +
        `) VALUES (` + [
          record.historicalRecordId,
          batch.batchId,
          batch.guildId,
          record.sourceRowNumber,
          record.sourceRowKey,
          record.rowChecksum,
          batch.seasonLabel,
          record.gameDate,
          record.gmOriginal,
          record.gmNormalized,
          record.gmUserId,
          record.gameLocation,
          record.gameInfluence,
          record.officialSummary,
          record.playersOriginal,
          record.playerSummaryStatus,
          record.playerSummaryDate,
          record.playerSummaryUrl,
          record.identityStatus,
          JSON.stringify(record.sourceValues),
          batch.createdAt,
        ].map(sqlValue).join(", ") + `);`,
    );
  }
  statements.push(
    `INSERT OR IGNORE INTO historical_import_events (` +
      `import_event_id, batch_id, guild_id, action, actor_user_id, reason, ` +
      `idempotency_key, details_json, created_at` +
      `) VALUES (` + [
        `history-event:staged:${batch.batchId}`,
        batch.batchId,
        batch.guildId,
        "staged",
        batch.createdByUserId,
        "Validated source batch staged for review",
        `history-import:staged:${batch.batchId}`,
        JSON.stringify({ contentChecksum: batch.contentChecksum, report }),
        batch.createdAt,
      ].map(sqlValue).join(", ") + `);`,
    "",
  );
  return statements.join("\n");
}

export function historicalImportLifecycleSql(input) {
  const reason = String(input.reason ?? "").replace(/[\r\n]+/g, " ").trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new RangeError("Lifecycle reason must be between 3 and 500 characters");
  }
  if (!['publish', 'rollback', 'recover'].includes(input.action)) {
    throw new TypeError("Lifecycle action must be publish, rollback, or recover");
  }
  const status = input.action === "rollback" ? "rolled_back" : "published";
  const eventAction = input.action === "recover" ? "recovered" :
    input.action === "rollback" ? "rolled_back" : "published";
  const allowedFrom = input.action === "rollback" ? "published" :
    input.action === "recover" ? "rolled_back" : "staged";
  const now = input.occurredAt;
  const assignments = status === "rolled_back"
    ? `status = 'rolled_back', rolled_back_at = ${sqlValue(now)}, ` +
      `rolled_back_by_user_id = ${sqlValue(input.actorUserId)}, ` +
      `rollback_reason = ${sqlValue(reason)}`
    : `status = 'published', published_at = ${sqlValue(now)}, ` +
      `rolled_back_at = NULL, rolled_back_by_user_id = NULL, rollback_reason = NULL`;
  return [
    `UPDATE historical_summary_import_batches SET ${assignments} ` +
      `WHERE guild_id = ${sqlValue(input.guildId)} AND batch_id = ${sqlValue(input.batchId)} ` +
      `AND status = ${sqlValue(allowedFrom)};`,
    `INSERT OR IGNORE INTO historical_import_events (` +
      `import_event_id, batch_id, guild_id, action, actor_user_id, reason, ` +
      `idempotency_key, details_json, created_at` +
      `) SELECT ` + [
        `history-event:${eventAction}:${input.batchId}`,
        input.batchId,
        input.guildId,
        eventAction,
        input.actorUserId,
        reason,
        `history-import:${eventAction}:${input.batchId}`,
        JSON.stringify({ previousStatus: allowedFrom, nextStatus: status }),
        now,
      ].map(sqlValue).join(", ") +
      ` WHERE EXISTS (` +
      `SELECT 1 FROM historical_summary_import_batches ` +
      `WHERE guild_id = ${sqlValue(input.guildId)} ` +
      `AND batch_id = ${sqlValue(input.batchId)} ` +
      `AND status = ${sqlValue(status)}` +
      `);`,
    "",
  ].join("\n");
}
