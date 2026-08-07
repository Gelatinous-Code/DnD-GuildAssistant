import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";

function usage(message) {
  if (message) console.error(message);
  console.error("Usage: npm run shop:export -- --guild <guild-id> --out catalog.json --remote|--local");
  process.exit(message ? 1 : 0);
}

const args = {};
for (let index = 0; index < process.argv.slice(2).length; index += 1) {
  const values = process.argv.slice(2);
  const value = values[index];
  if (value === "--remote" || value === "--local") args.scope = value;
  else if (value === "--guild") args.guild = values[++index];
  else if (value === "--out") args.out = values[++index];
  else if (value === "--help") usage();
  else usage(`Unknown argument: ${value}`);
}
if (!args.guild || !args.out || !args.scope) usage("--guild, --out, and one database scope are required.");
const quotedGuild = `'${args.guild.replaceAll("'", "''")}'`;
const query = `SELECT json_object(
  'contract','shop-catalog-export.v1','guildId',config.guild_id,
  'catalogRevision',config.catalog_revision,'exportedAt',unixepoch()*1000,
  'shopkeeper',json_object('name',config.shopkeeper_name,
    'welcomeMessage',config.welcome_message,'maintenanceMode',json(config.maintenance_mode)),
  'items',COALESCE((SELECT json_group_array(json(item_json)) FROM (
    SELECT json_object('itemId',item_id,'name',name,'source',source,'category',category,
      'description',description,'rarity',rarity,'requiresAttunement',json(requires_attunement),
      'damage',damage,'properties',properties,'mastery',mastery,'tags',json(tags_json),
      'priceGold',price_gold,'free',json(price_gold=0),'eligibility',eligibility,
      'repeatRule',repeat_rule,'maxQuantity',max_quantity,'minimumLevel',minimum_level,
      'maximumLevel',maximum_level,'contractConsumable',json(contract_consumable),'active',json(active),
      'itemRevision',item_revision,'catalogRevision',catalog_revision,
      'importBatchId',import_batch_id,'updatedAt',updated_at) AS item_json
    FROM shop_catalog_items WHERE guild_id=config.guild_id ORDER BY item_id
  )),json('[]'))
) AS export_json FROM shop_catalog_config config WHERE config.guild_id=${quotedGuild};`;
const executable = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(executable, [
  "wrangler", "d1", "execute", "DB", args.scope, "--command", query, "--json",
], { encoding: "utf8" });
if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout);
  process.exit(result.status ?? 1);
}
let payload;
try {
  const commandResult = JSON.parse(result.stdout);
  const rows = Array.isArray(commandResult) ? commandResult[0]?.results : commandResult?.results;
  if (!rows?.[0]?.export_json) throw new Error("Guild shop is not configured");
  payload = JSON.parse(rows[0].export_json);
} catch (error) {
  console.error(`Could not parse Wrangler export: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
await writeFile(args.out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`Exported ${payload.items.length} items at catalog revision ${payload.catalogRevision} to ${args.out}.`);
