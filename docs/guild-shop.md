# Guild shop and gold purchases

The guild shop is a versioned, guild-scoped catalog backed by the same append-only
gold ledger used for session awards and admin corrections. It does not handle
real money, inventory, or physical fulfillment.

## Player flow

1. `/shop browse` searches active items by text, category, tag, or free/paid status.
2. `/shop characters` privately lists the player's approved, active character IDs.
3. `/shop buy item_id:<id> character_id:<id> quantity:<n>` creates a ten-minute,
   server-side preview. No client-supplied price is trusted.
4. **Seal the bargain** rechecks ownership, character status, catalog/item revisions,
   eligibility, repeat rules, quantity, live gold, and the character's ledger revision.
5. A successful confirmation returns an immutable receipt. Repeated clicks and
   Discord retries replay the same receipt without charging twice.

Free items receive zero-cost receipts and no zero-value ledger entry. Paid items
append a negative-gold entry to the shared progression ledger. A session award or
admin correction between preview and confirmation makes the preview stale and
requires a fresh preview; this prevents concurrent overspending.

Artificer-only items require an admin to record the character's eligibility with
`/shop-admin eligibility`. Frozen, pending, revoked, and archived characters cannot
purchase. Once-per-character items cannot be bought again while the original
receipt remains completed.

## Admin controls

| Command | Result |
| --- | --- |
| `/shop-admin item` | Create or replace an item and append an immutable revision. |
| `/shop-admin active` | Deactivate or restore an item without deleting history. |
| `/shop-admin eligibility` | Record Artificer eligibility for one approved character. |
| `/shop-admin reverse` | Reverse a receipt and, when paid, append a compensating ledger entry. |
| `/shop-admin configure` | Change the shopkeeper voice or enable maintenance mode. |
| `/shop-admin status` | Show the catalog revision and loaded/active counts. |

All corrections require a reason. Never edit receipts or progression ledger rows
directly. A reversal preserves the original receipt and records a separate event.

## Bulk import and reconciliation

The dependency-free importer accepts a JSON array or a UTF-8 CSV exported from the
source workbook. It records the original filename, SHA-256 checksum, mapping
revision, import batch, row count, deactivation count, and resulting catalog
revision. Stable item IDs make rerunning the same checksum and mapping revision
idempotent. Items absent from a later replacement import are deactivated, not
deleted.

Validate the source before touching D1:

```text
npm run shop:import -- catalog.csv --guild <guild-id> --actor <admin-id> --expected-count 471
```

The initial production source is expected to reconcile to 471 rows: 168 free,
296 with numeric gold prices, and 7 Artificer-only. The importer reports normalized
free, paid, and restricted counts before applying. Investigate any mismatch before
continuing.

Apply to local D1 first, then remote D1:

```text
npm run shop:import -- catalog.csv --guild <guild-id> --actor <admin-id> --expected-count 471 --apply --local
npm run shop:import -- catalog.csv --guild <guild-id> --actor <admin-id> --expected-count 471 --apply --remote
```

Supported headers include `item_id`, `name`, `source`, `category`, `description`,
`rarity`, `requires_attunement`, `damage`, `properties`, `mastery`, `tags`,
`price_gold`, `free`, `eligibility`, `repeat_rule`, `max_quantity`, `level_tier`,
`minimum_level`, `maximum_level`, `contract_consumable`, and `active`.
Common aliases such as `item`, `gold`, `cost`, `book`, and `type` are normalized.
Ambiguous prices fail closed. Export XLSX worksheets to CSV so the mapping remains
explicit and reviewable.

Export the complete current catalog, including inactive items and item/catalog
revisions, for review or backup:

```text
npm run shop:export -- --guild <guild-id> --out catalog-export.json --remote
```

The deterministic four-item test source is
[`fixtures/shop-catalog.sample.json`](../fixtures/shop-catalog.sample.json).

## Public website contract

The public, anonymous endpoint is:

```text
GET /api/v1/guilds/{guild_id}/shop-catalog
```

Optional query parameters are `query`, `category`, `tag`, `eligibility`, `free`,
`limit` (1–100), and opaque `cursor`. Responses use contract
`shop-catalog.v1`, include catalog/item revisions and a Discord command handoff,
and support `ETag`/`If-None-Match`. Public caching is enabled for 60 seconds with
stale revalidation. Requests are bounded per hashed client address; raw addresses
are not stored. Maintenance mode returns `503` with `Retry-After`.

The endpoint never returns Discord identity, character ownership, balances,
purchase previews, receipts, or ledger entries. The deterministic website fixture
is [`test/fixtures/public-shop-catalog.v1.json`](../test/fixtures/public-shop-catalog.v1.json).

## Deployment and recovery

1. Back up the D1 database.
2. Apply migration `0025_guild_shop.sql`.
3. Register the updated Discord commands.
4. Validate the source import locally and reconcile its counts.
5. Import remotely and run `/shop-admin status`.
6. Smoke-test a free receipt, a paid receipt, an Artificer rejection/grant, a
   stale preview, a repeated confirmation, and an admin reversal.
7. Verify the public endpoint, a `304` response, pagination, and maintenance mode.
8. Record pilot sign-off that the shop performs **no real-money commerce**, has
   **no stock tracking**, and creates **no fulfillment or approval workflow**;
   character-sheet updates remain honor-system player actions.

If an import is wrong, enable maintenance mode, correct the source, and import a
new mapping revision. If a purchase is wrong, use `/shop-admin reverse`; do not
delete rows. Database recovery should restore the catalog, receipts, and shared
ledger together from the same backup point.
