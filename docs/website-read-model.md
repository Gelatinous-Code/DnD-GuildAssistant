# Website session-summary read model

The guild website can read submitted session notes from the Worker without
making the Google Sheet a second source of truth. The API exposes only current,
visible revisions from completed sessions.

## Authentication and authorization

The website must complete Discord OAuth for the visitor and request the
`guilds.members.read` scope. Its server sends the visitor's short-lived Discord
access token as `Authorization: Bearer …`; the token is never stored in D1.

For every request, the Worker asks Discord for that account's current member
record in the requested guild. Access requires all of the following:

- the account is still a guild member and is not membership-screening pending;
- the account currently has the configured Guild Player/reminder role or the
  configured administrator role; and
- the request is within the per-member rate limit.

Removing a member or role therefore takes effect on the next request. The
endpoint is not an anonymous public API even though the old Google Sheet was
public.

## Contract

`GET /api/v1/guilds/{guild_id}/session-summaries`

Required headers:

- `Authorization: Bearer {discord_oauth_access_token}`
- `X-Guild-Contract-Version: session-summaries.v1`

Optional query parameters:

- `limit`: 1–50, default 20
- `cursor`: opaque cursor returned by the preceding page
- `tier`: 1, 2, or 3
- `area`: case-insensitive substring, at most 100 characters

The response contains event and table labels, dates, tier, area, summary,
important events, bonus gold/items, other notes, append-only administrator correction notes, and revision metadata. It does
not expose OAuth tokens, delivery state, internal audit rows, or hidden/stale
revisions.

Responses are `private, no-store`, include an ETag, and vary by Authorization.
The Worker reauthorizes the visitor before returning `304 Not Modified`.

## Errors and limits

Errors are JSON with stable machine-readable names. Authentication failures do
not reveal another member's data. Discord membership outages return `503`;
exhausting 120 requests in a fixed 60-second member/guild window returns `429`
with `Retry-After`.
