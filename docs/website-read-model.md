# Website member-safe read models

The guild website reads authoritative session, journal, and progression data
from the Worker. It does not receive a D1 binding and does not duplicate ledger
calculations.

## Authentication and authorization

The website completes Discord OAuth for the visitor with the
`guilds.members.read` scope. Its server sends the visitor's short-lived access
token as `Authorization: Bearer …`; the token is never stored in D1.

On every request, the Worker asks Discord for that account's current member
record in the guild named by the route. Access requires a non-pending current
member with the configured Guild Player role or Administrator role. Removing a
member or role takes effect on the next request. The GM role is reported as a
capability marker when present but does not grant website access by itself.

Every successful response includes a `viewer` with the verified Discord user ID,
stable role names, and capabilities. Configured Discord role IDs are never
returned.

## Official session recaps

```text
GET /api/v1/guilds/{guild_id}/session-summaries
X-Guild-Contract-Version: session-summaries.v1
Authorization: Bearer <Discord OAuth token>
```

Optional filters are `limit` (1–50, default 20), opaque `cursor`, `tier` (1–3),
and a case-insensitive `area` substring of at most 100 characters. Members see
only current submitted, visible recaps for current completed session revisions.
Items contain event/table labels, spoiler metadata, source completion revision,
policy metadata, dates, area, summary, important events, bonus gold/items, other
notes, current author revision, and public corrections.

Administrators may request `visibility=all` to include hidden submitted recaps.
Those records include moderation status/reason, and correction entries add their
reasoned event provenance without exposing the administrator's Discord ID.

## Other contracts

All routes use the same authentication, rate limit, private caching, ETag, and
version rules.

| Route | Contract | Notes |
| --- | --- | --- |
| `/api/v1/guilds/{guild_id}/player-journals` | `player-journals.v1` | Visible current journals with spoiler/source metadata; filters: `character_id`, `event_id`; administrators may use `visibility=all`. |
| `/api/v1/guilds/{guild_id}/historical-summaries` | `historical-summaries.v1` | Published immutable imports only; optional exact `season` filter. |
| `/api/v1/guilds/{guild_id}/progression-seasons` | `progression-seasons.v1` | The verified member's characters, main/frozen/archived state, per-season balances and level, plus ledger history and reversal/source provenance. Filters: `season` and owned `character_id`. |

Every collection route accepts `limit` from 1–50 and returns an opaque
`nextCursor`. Clients must not inspect or construct cursors. The authoritative
machine-readable manifest is
[`contracts/website-read-models.v1.json`](../contracts/website-read-models.v1.json),
with a deterministic progression fixture under `test/fixtures`.

## Caching, errors, and limits

Responses are `private, no-store`, include a content-derived ETag, and vary by
Authorization. The Worker reauthorizes before returning `304 Not Modified`, so
cache validators cannot preserve access after role loss. A different user's
payload produces a different ETag.

Errors use stable JSON names. Authentication failures reveal no protected
records. Discord membership outages return `503`; exhausting 120 requests in a
fixed 60-second member/guild window returns `429` with `Retry-After`. Unsupported
contract versions return `406` with the supported version.

Detailed behavior is in [session summaries](session-summaries.md),
[player character journals](player-journals.md),
[historical summary import](historical-session-import.md), and
[progression seasons](progression-seasons.md).
