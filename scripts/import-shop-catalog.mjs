import { createHash } from "node:crypto";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { basename, dirname, extname, join } from "node:path";
import { tmpdir } from "node:os";

function usage(message) {
  if (message) console.error(message);
  console.error(`Usage:
  node scripts/import-shop-catalog.mjs <catalog.csv|catalog.json>
    --guild <discord-guild-id> --actor <discord-user-id>
    [--expected-count 471] [--mapping-revision shop-v1]
    [--apply --remote|--local] [--out catalog-import.sql]
    [--normalized-out catalog.normalized.json]

Without --apply, the importer validates and previews the normalized catalog.
Export an XLSX worksheet to UTF-8 CSV first; the source checksum is preserved.`);
  process.exit(message ? 1 : 0);
}

function argumentsFrom(argv) {
  const result = { apply: false, remote: false, local: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--") && !result.input) result.input = value;
    else if (value === "--apply") result.apply = true;
    else if (value === "--remote") result.remote = true;
    else if (value === "--local") result.local = true;
    else if (["--guild", "--actor", "--expected-count", "--mapping-revision", "--out", "--normalized-out"].includes(value)) {
      result[value.slice(2).replaceAll("-", "_")] = argv[++index];
    } else if (value === "--help") usage();
    else usage(`Unknown argument: ${value}`);
  }
  return result;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/, ""));
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }
  if (quoted) throw new Error("CSV has an unterminated quoted field");
  row.push(cell.replace(/\r$/, ""));
  if (row.some((value) => value.trim())) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows.shift().map((value) => value.trim());
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function keyed(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""), value,
  ]));
}

function pick(row, ...names) {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

function truthy(value) {
  return /^(1|true|yes|y|x|required)$/i.test(String(value).trim());
}

function slug(value) {
  return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function normalize(raw, index) {
  const row = keyed(raw);
  const name = pick(row, "name", "item", "item_name");
  if (!name) throw new Error(`Row ${index + 2}: name is required`);
  const itemId = pick(row, "item_id", "identity", "id") || slug(name);
  if (!/^[a-z0-9][a-z0-9._-]{1,79}$/.test(itemId)) {
    throw new Error(`Row ${index + 2}: invalid item ID '${itemId}'`);
  }
  const freeValue = pick(row, "free", "is_free");
  const rawGold = pick(row, "price_gold", "gold", "gold_cost", "cost", "price");
  const sourcePriceClass = /artificer/i.test(rawGold) ? "artificer_only"
    : truthy(freeValue) || /free/i.test(rawGold) || /^0(?:\.0+)?$/.test(rawGold) ? "free" : "numeric_gold";
  const isFree = sourcePriceClass !== "numeric_gold";
  const numeric = rawGold.replaceAll(",", "").match(/\d+/)?.[0];
  const priceGold = isFree ? 0 : numeric ? Number(numeric) : NaN;
  if (!Number.isSafeInteger(priceGold) || priceGold < 0) {
    throw new Error(`Row ${index + 2}: gold price is required (use 0 or Free for free items)`);
  }
  const eligibilityText = `${pick(row, "eligibility", "restriction", "class")} ${rawGold}`;
  const eligibility = /artificer/i.test(eligibilityText) ? "artificer" : "all";
  const repeatText = pick(row, "repeat_rule", "repeat", "purchase_limit");
  const repeatRule = /once|one per character/i.test(repeatText) ? "once_per_character" : "repeatable";
  const quantityText = pick(row, "max_quantity", "quantity", "quantity_limit");
  const maxQuantity = quantityText ? Number(quantityText) : null;
  if (maxQuantity !== null && (!Number.isSafeInteger(maxQuantity) || maxQuantity < 1)) {
    throw new Error(`Row ${index + 2}: max quantity must be a positive whole number`);
  }
  const tags = [...new Set(
    pick(row, "tags", "tag").split(/[,;|]/)
      .map((tag) => tag.trim().toLowerCase())
      .filter((tag) => tag && !/^\d+$/.test(tag)),
  )];
  if (/item proficiency/i.test(rawGold)) tags.push("item proficiency required");
  const levelText = pick(row, "level_tier", "level", "tier", "level_range");
  const explicitMinimum = pick(row, "minimum_level", "min_level");
  const explicitMaximum = pick(row, "maximum_level", "max_level");
  const range = levelText.match(/(\d+)\D+(\d+)/);
  let minimumLevel = explicitMinimum ? Number(explicitMinimum) : range ? Number(range[1]) : null;
  let maximumLevel = explicitMaximum ? Number(explicitMaximum) : range ? Number(range[2]) : null;
  if (/\b(?:tier|t)\s*1\b/i.test(levelText)) { minimumLevel = 3; maximumLevel = 4; }
  if (/\b(?:tier|t)\s*2\b/i.test(levelText)) { minimumLevel = 5; maximumLevel = 7; }
  if (/\b(?:tier|t)\s*3\b/i.test(levelText)) { minimumLevel = 8; maximumLevel = 10; }
  if (!range && !/\b(?:tier|t)\s*[123]\b/i.test(levelText) && /\d+/.test(levelText)) {
    minimumLevel = Number(levelText.match(/\d+/)[0]);
    maximumLevel = /\+/.test(levelText) ? null : minimumLevel;
  }
  for (const [label, value] of [["minimum", minimumLevel], ["maximum", maximumLevel]]) {
    if (value !== null && (!Number.isSafeInteger(value) || value < 3 || value > 10)) {
      throw new Error(`Row ${index + 2}: ${label} level must be 3 through 10`);
    }
  }
  if (minimumLevel !== null && maximumLevel !== null && minimumLevel > maximumLevel) {
    throw new Error(`Row ${index + 2}: minimum level exceeds maximum level`);
  }
  const contractConsumable = truthy(pick(row, "contract_consumable", "contract_item")) ||
    /contract consumable/i.test(`${pick(row, "category", "type")} ${tags.join(" ")}`);
  const attunement = pick(row, "requires_attunement", "attunement");
  const rarity = pick(row, "rarity");
  return {
    itemId,
    name,
    source: pick(row, "source", "book", "source_book") || null,
    category: pick(row, "category", "type") || "Other",
    description: pick(row, "description", "summary", "notes", "text") || "No description supplied.",
    rarity: /^(none|n\/a)$/i.test(rarity) ? null : rarity || null,
    requiresAttunement: truthy(attunement) || /requires?\s+attunement/i.test(attunement),
    damage: pick(row, "damage") || null,
    properties: pick(row, "properties", "property") || null,
    mastery: pick(row, "mastery") || null,
    tags,
    priceGold,
    eligibility,
    sourcePriceClass,
    repeatRule,
    maxQuantity,
    minimumLevel,
    maximumLevel,
    contractConsumable,
    active: !/^(0|false|no|inactive)$/i.test(pick(row, "active") || "true"),
  };
}

function sql(value) {
  return value === null || value === undefined ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
}

function sqlList(values) {
  return values.map(sql).join(", ") || "''";
}

function buildSql({ items, guildId, actorId, sourceName, checksum, mappingRevision, importBatchId, now }) {
  const ids = items.map((item) => item.itemId);
  // D1 executes this SQL file as an atomic batch; explicit transaction statements
  // are rejected by the remote import API.
  const lines = [
    `INSERT OR IGNORE INTO shop_catalog_config (guild_id, updated_by_user_id, updated_at)
     VALUES (${sql(guildId)}, ${sql(actorId)}, ${now});`,
    `UPDATE shop_catalog_config SET catalog_revision=catalog_revision+1,
       updated_by_user_id=${sql(actorId)}, updated_at=${now}
     WHERE guild_id=${sql(guildId)} AND NOT EXISTS (
       SELECT 1 FROM shop_catalog_import_batches
       WHERE guild_id=${sql(guildId)} AND source_checksum=${sql(checksum)}
         AND mapping_revision=${sql(mappingRevision)});`,
    `INSERT OR IGNORE INTO shop_catalog_import_batches (
       import_batch_id, guild_id, source_name, source_checksum, mapping_revision,
       catalog_revision, imported_count, deactivated_count, actor_user_id, imported_at
     ) SELECT ${sql(importBatchId)}, config.guild_id, ${sql(sourceName)}, ${sql(checksum)},
       ${sql(mappingRevision)}, config.catalog_revision, ${items.length},
       (SELECT count(*) FROM shop_catalog_items old
        WHERE old.guild_id=config.guild_id AND old.import_batch_id IS NOT NULL
          AND old.active=1 AND old.item_id NOT IN (${sqlList(ids)})),
       ${sql(actorId)}, ${now}
     FROM shop_catalog_config config WHERE config.guild_id=${sql(guildId)};`,
  ];
  for (const item of items) {
    const values = [
      guildId, item.itemId, item.name, item.source, item.category, item.description,
      item.rarity, item.requiresAttunement ? 1 : 0, item.damage, item.properties,
      item.mastery, JSON.stringify(item.tags), item.priceGold, item.eligibility,
      item.repeatRule, item.maxQuantity, item.minimumLevel, item.maximumLevel,
      item.contractConsumable ? 1 : 0, item.active ? 1 : 0, importBatchId, now, now,
    ].map(sql).join(", ");
    lines.push(
      `INSERT INTO shop_catalog_items (
         guild_id,item_id,name,source,category,description,rarity,requires_attunement,
         damage,properties,mastery,tags_json,price_gold,eligibility,repeat_rule,
         max_quantity,minimum_level,maximum_level,contract_consumable,active,item_revision,catalog_revision,import_batch_id,created_at,updated_at)
       SELECT ${values.slice(0, -`${sql(importBatchId)}, ${sql(now)}, ${sql(now)}`.length)}
         COALESCE(existing.item_revision + 1, 1), batch.catalog_revision,
         ${sql(importBatchId)}, ${now}, ${now}
       FROM shop_catalog_import_batches batch
       LEFT JOIN shop_catalog_items existing ON existing.guild_id=batch.guild_id
         AND existing.item_id=${sql(item.itemId)}
       WHERE batch.import_batch_id=${sql(importBatchId)}
         AND (existing.item_id IS NULL OR existing.import_batch_id IS NOT ${sql(importBatchId)})
       ON CONFLICT(guild_id,item_id) DO UPDATE SET
         name=excluded.name,source=excluded.source,category=excluded.category,
         description=excluded.description,rarity=excluded.rarity,
         requires_attunement=excluded.requires_attunement,damage=excluded.damage,
         properties=excluded.properties,mastery=excluded.mastery,tags_json=excluded.tags_json,
         price_gold=excluded.price_gold,eligibility=excluded.eligibility,
         repeat_rule=excluded.repeat_rule,max_quantity=excluded.max_quantity,
         minimum_level=excluded.minimum_level,maximum_level=excluded.maximum_level,
         contract_consumable=excluded.contract_consumable,
         active=excluded.active,item_revision=excluded.item_revision,
         catalog_revision=excluded.catalog_revision,import_batch_id=excluded.import_batch_id,
         updated_at=excluded.updated_at;`,
      `INSERT OR IGNORE INTO shop_catalog_item_revisions (
         revision_id,guild_id,item_id,item_revision,catalog_revision,snapshot_json,
         action,actor_user_id,reason,occurred_at)
       SELECT 'shop-item-revision:' || guild_id || ':' || item_id || ':' || item_revision,
         guild_id,item_id,item_revision,catalog_revision,
         json_object('itemId',item_id,'name',name,'category',category,'description',description,
           'priceGold',price_gold,'eligibility',eligibility,'repeatRule',repeat_rule,
           'maxQuantity',max_quantity,'minimumLevel',minimum_level,'maximumLevel',maximum_level,
           'contractConsumable',json(contract_consumable),'tags',json(tags_json),
           'active',json(active)),
         'imported',${sql(actorId)},'Bulk catalog import',${now}
       FROM shop_catalog_items WHERE guild_id=${sql(guildId)} AND item_id=${sql(item.itemId)}
         AND import_batch_id=${sql(importBatchId)};`,
    );
  }
  lines.push(
    `INSERT OR IGNORE INTO shop_catalog_item_revisions (
       revision_id,guild_id,item_id,item_revision,catalog_revision,snapshot_json,
       action,actor_user_id,reason,occurred_at)
     SELECT 'shop-item-revision:' || item.guild_id || ':' || item.item_id || ':' || (item.item_revision+1),
       item.guild_id,item.item_id,item.item_revision+1,batch.catalog_revision,
       json_object('itemId',item.item_id,'name',item.name,'category',item.category,
         'description',item.description,'priceGold',item.price_gold,
         'eligibility',item.eligibility,'repeatRule',item.repeat_rule,
         'maxQuantity',item.max_quantity,'minimumLevel',item.minimum_level,
         'maximumLevel',item.maximum_level,'contractConsumable',json(item.contract_consumable),
         'tags',json(item.tags_json),'active',json(0)),
       'deactivated',${sql(actorId)},'Absent from replacement catalog import',${now}
     FROM shop_catalog_items item
     JOIN shop_catalog_import_batches batch ON batch.import_batch_id=${sql(importBatchId)}
     WHERE item.guild_id=${sql(guildId)} AND item.import_batch_id IS NOT NULL
       AND item.import_batch_id IS NOT ${sql(importBatchId)} AND item.active=1
       AND item.item_id NOT IN (${sqlList(ids)});`,
    `UPDATE shop_catalog_items SET active=0,item_revision=item_revision+1,
       catalog_revision=(SELECT catalog_revision FROM shop_catalog_import_batches
         WHERE import_batch_id=${sql(importBatchId)}),updated_at=${now}
     WHERE guild_id=${sql(guildId)} AND import_batch_id IS NOT NULL
       AND import_batch_id IS NOT ${sql(importBatchId)} AND active=1
       AND item_id NOT IN (${sqlList(ids)});`,
  );
  return lines.join("\n\n");
}

const args = argumentsFrom(process.argv.slice(2));
if (!args.input || !args.guild || !args.actor) usage("Input, --guild, and --actor are required.");
if (args.remote && args.local) usage("Choose only one of --remote or --local.");
if (extname(args.input).toLowerCase() === ".xlsx") {
  usage("Export the workbook worksheet as UTF-8 CSV first so the import mapping is explicit and reviewable.");
}
const bytes = await readFile(args.input);
const sourceText = bytes.toString("utf8").replace(/^\uFEFF/, "");
const rawRows = extname(args.input).toLowerCase() === ".json"
  ? JSON.parse(sourceText) : parseCsv(sourceText);
if (!Array.isArray(rawRows)) throw new Error("JSON input must be an array of item objects");
const items = rawRows.map(normalize);
const duplicate = items.find((item, index) => items.findIndex((other) => other.itemId === item.itemId) !== index);
if (duplicate) throw new Error(`Duplicate stable item ID: ${duplicate.itemId}`);
if (args.normalized_out) {
  await writeFile(args.normalized_out, `${JSON.stringify(items, null, 2)}\n`, "utf8");
}
const expected = args.expected_count === undefined ? null : Number(args.expected_count);
if (expected !== null && items.length !== expected) {
  throw new Error(`Expected ${expected} items but normalized ${items.length}`);
}
const checksum = createHash("sha256").update(bytes).digest("hex");
const mappingRevision = args.mapping_revision ?? "shop-catalog-v1";
const importBatchId = `shop-import:${checksum.slice(0, 20)}:${createHash("sha256").update(mappingRevision).digest("hex").slice(0, 8)}`;
const sqlText = buildSql({
  items, guildId: args.guild, actorId: args.actor, sourceName: basename(args.input),
  checksum, mappingRevision, importBatchId, now: Date.now(),
});
const free = items.filter((item) => item.priceGold === 0).length;
const restricted = items.filter((item) => item.eligibility !== "all").length;
const sourceFree = items.filter((item) => item.sourcePriceClass === "free").length;
const sourceNumericGold = items.filter((item) => item.sourcePriceClass === "numeric_gold").length;
const sourceArtificerOnly = items.filter((item) => item.sourcePriceClass === "artificer_only").length;
if (expected === 471 &&
    (sourceFree !== 168 || sourceNumericGold !== 296 || sourceArtificerOnly !== 7)) {
  throw new Error(
    `Expected source classes 168 free / 296 numeric gold / 7 Artificer-only; ` +
    `found ${sourceFree} / ${sourceNumericGold} / ${sourceArtificerOnly}`,
  );
}
console.log(JSON.stringify({
  source: basename(args.input), checksum, mappingRevision, importBatchId,
  total: items.length,
  sourceClasses: { free: sourceFree, numericGold: sourceNumericGold, artificerOnly: sourceArtificerOnly },
  storedClasses: { zeroGold: free, paid: items.length - free, restricted },
}, null, 2));
let sqlPath = args.out;
let temporary = false;
if (sqlPath) await writeFile(sqlPath, sqlText, "utf8");
if (!args.apply) {
  console.log(sqlPath ? `Validated; SQL written to ${sqlPath}.` : "Validated; use --apply with --remote or --local to import.");
  process.exit(0);
}
if (!args.remote && !args.local) usage("--apply requires --remote or --local.");
if (!sqlPath) {
  sqlPath = join(tmpdir(), `${importBatchId.replaceAll(":", "-")}.sql`);
  temporary = true;
  await writeFile(sqlPath, sqlText, "utf8");
}
const scope = args.remote ? "--remote" : "--local";
const executable = process.platform === "win32" ? process.execPath : "npx";
const executablePrefix = process.platform === "win32"
  ? [join(dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js")]
  : [];
const apply = spawnSync(executable, [...executablePrefix, "wrangler", "d1", "execute", "DB", scope, "--file", sqlPath], {
  stdio: "inherit",
});
if (temporary) await unlink(sqlPath).catch(() => {});
if (apply.status !== 0) process.exit(apply.status ?? 1);
const reconcile = `SELECT b.catalog_revision,b.imported_count,b.deactivated_count,
  (SELECT count(*) FROM shop_catalog_items i WHERE i.guild_id=b.guild_id) AS stored_count,
  (SELECT count(*) FROM shop_catalog_items i WHERE i.guild_id=b.guild_id AND i.active=1) AS active_count,
  (SELECT count(*) FROM shop_catalog_items i WHERE i.guild_id=b.guild_id AND i.price_gold=0 AND i.active=1) AS free_count,
  (SELECT count(*) FROM shop_catalog_items i WHERE i.guild_id=b.guild_id AND i.eligibility='artificer' AND i.active=1) AS restricted_count
  FROM shop_catalog_import_batches b WHERE b.import_batch_id=${sql(importBatchId)};`;
const reconcilePath = join(tmpdir(), `${importBatchId.replaceAll(":", "-")}-reconcile.sql`);
await writeFile(reconcilePath, reconcile, "utf8");
const check = spawnSync(executable, [...executablePrefix, "wrangler", "d1", "execute", "DB", scope, "--file", reconcilePath], {
  stdio: "inherit",
});
await unlink(reconcilePath).catch(() => {});
process.exit(check.status ?? 0);
