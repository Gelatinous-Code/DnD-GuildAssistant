# Progression seasons and rollover

Every guild has one current progression season. A rollover closes it and creates
zero-XP, zero-gold opening records for each currently approved character. Closed
seasons, ledger entries, purchases, corrections, and receipts remain immutable
and readable.

## Preview and execute

Pause automation and take a verified D1 export before rollover. In Discord,
first run:

```text
/progression-admin season-preview season_id:<stable-id> name:<display name>
```

Compare the character count, nonzero balance count, total XP, and total gold
with an independent export. When correct, run:

```text
/progression-admin season-rollover season_id:<same-id> name:<same-name> reason:<reason> confirm:True
```

The D1 batch closes the old season, creates the new season and openings, and
records one audit event atomically. The Discord interaction ID is the
idempotency key, and opening IDs are deterministic. Retrying the same interaction
cannot reset twice. Archived and revoked characters keep historical balances but
receive no new opening; characters approved later receive an opening only in the
current season.

## Recovery and rollback policy

If the command reports failure, inspect the database before retrying. D1 batch
atomicity means the rollover either committed as a unit or did not commit.
Confirm the current season, audit event, expected opening count, and absence of
unexpected new-season ledger entries.

Do not manually delete a season or its openings. If a rollover was committed in
error and no later writes exist, restore the verified pre-rollover D1 backup
during a maintenance window. If later writes exist, preserve the season and
append documented corrections; destructive rollback would invalidate immutable
ledger references.

Late corrections use `/progression-admin adjust` with optional `season_id`. The
command checks that season's balance, refuses a negative result, and appends the
correction without changing the current balance. Omitting `season_id` targets the
current season.

## Website contract

```text
GET /api/v1/guilds/{guild_id}/progression-seasons?season=current
GET /api/v1/guilds/{guild_id}/progression-seasons?season=all
GET /api/v1/guilds/{guild_id}/progression-seasons?season=season-6
X-Guild-Contract-Version: progression-seasons.v1
Authorization: Bearer <Discord OAuth token>
```

The response is scoped to the verified Discord member and contains that
member's own characters (including main, frozen, pending, revoked, and archived
state), stored per-season balances, derived level, provider-authored next-level
threshold/progress, and append-only ledger history. Session awards include their completion revision, event/table source,
participant role, and policy version. Adjustments and reversals retain their
reason and effective/reversed state without exposing the administrator's
Discord ID or internal idempotency keys.

Each balance includes levelProgress, derived from the same authoritative policy
used for awards. It reports the current level minimum, the next level and
threshold, XP within the current level, XP required and remaining, and whether
the character is at the level cap. At level 10 the next-level and remaining
values are null; consumers must not copy level thresholds or invent a post-cap
target.

Use `limit` (1–50) and the opaque `cursor`/`nextCursor` pair for history.
`character_id` may narrow the response only to a character owned by the verified
member. Sending another member's character ID returns `character_not_found`.
