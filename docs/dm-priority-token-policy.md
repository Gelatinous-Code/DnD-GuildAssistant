# DM priority token policy

**Policy version:** `dm-priority-v1`

This policy rewards members who run games without changing the separate GM
selection rotation. Member-facing text uses **DM priority token**: one token is
one guaranteed-priority player seat for one weekly game. Internal code and D1
records may call it a credit and may map a DM to the existing `gm` terminology.

The guarantee is precedence over standard table requests, not permission to
overfill a table or create a table without a DM. When valid token demand alone
exceeds a table's capacity, the deterministic priority ordering below decides
who is seated; an unseated member does not spend a token.

## Earning tokens

One organizer-confirmed completed table session awards exactly **two tokens**
to its one recorded actual DM.

- Publication, finalization, archive, scheduled duration, Discord presence, and
  voice-channel presence never award tokens by themselves.
- Completion is an explicit confirmed action by a member with Discord Manage
  Server or Administrator permission.
- The organizer records either `completed`, with one actual DM, or `cancelled`,
  with no reward. Player attendance does not affect the reward after the
  organizer confirms that the session ran.
- A planned DM who cancels or does not attend earns nothing. If a substitute
  actually runs the game, that substitute earns the tokens.
- Version 1 supports one reward-earning primary DM per table session. Supporting
  co-DMs requires a later policy version.
- The actual DM does not need to have been the original `gm` signup. To use a
  token later, the member must have an active `player` signup for that event.
- The first successful completion confirmation is authoritative. Its persisted
  server timestamp is `earned_at`. Retrying the same completion uses the same
  idempotency key and cannot award four tokens.

## Time zone and expiration

Timestamps are stored as UTC Unix epoch milliseconds. At grant time, the bot
also captures the guild's configured IANA time zone and the policy version.
Changing guild configuration later never moves an existing token's boundary.

A token is valid through the constrained same-numbered local calendar date in
the following month:

1. Convert `earned_at` to the captured guild time zone.
2. Add one calendar month with month-end overflow constrained.
3. Treat that resulting local date as the final eligible date.
4. Persist `expires_at` as 00:00 at the start of the next local day, using
   Temporal-compatible daylight-saving disambiguation.

`expires_at` is exclusive. At `now >= expires_at`, the token is unavailable.
The selected game's `starts_at` must also be strictly earlier than `expires_at`.
A reservation never pauses or extends expiration.

Examples:

- Confirmation on August 18 in `America/Denver` produces tokens usable through
  September 18; they expire September 19 at 00:00 local.
- Confirmation on January 31 produces tokens usable through February 28 in a
  non-leap year, or February 29 in a leap year.
- A game beginning exactly at `expires_at` is not eligible.
- Leaving and rejoining the guild neither pauses nor resets the window.

## Using a token

A token is guild-scoped, non-transferable, and has this normal lifecycle:

`available` → `reserved` → `redeemed`

Audited transitions may instead make it `expired` or `corrected`, or return it
to `available` after a release or refund. `corrected` is the terminal storage
status for a token revoked by an admin correction.

1. The member first creates an active `player` signup. Viewing token status or
   signing up never consumes or reserves a token.
2. The member explicitly confirms token use for one selected table. At most one
   token may be reserved or redeemed for the same member and weekly event.
3. Confirmation atomically reserves a token and records the priority request.
4. At table-selection closure, a seated request redeems its token. An unseated
   priority request releases its reservation, leaving the token available or
   expired according to its original boundary.

When several tokens belonging to one member are eligible, reserve them in this
order:

1. earliest `expires_at`;
2. earliest `earned_at`; then
3. token ID in ascending lexical order.

A token is redeemed when it protects an assigned seat even if the table never
fills and no displacement was ultimately necessary. Repeated confirmation for
the same member, event, table, and token is idempotent.

## Seating, waitlists, and ties

The bot recalculates a table from its persisted current requests. Valid priority
requests form the first tier and standard requests form the second tier.

Priority requests sort by:

1. earliest `priority_requested_at`; then
2. Discord user ID in ascending lexical order.

Standard requests sort by:

1. earliest `table_requested_at`; then
2. Discord user ID in ascending lexical order.

The first `capacity` requests are assigned. Every remaining request is
waitlisted in that same order. Consequently:

- priority always ranks ahead of standard requests;
- applying priority to a full standard table displaces exactly the
  lowest-ranked assigned standard request;
- the displaced member retains the original `table_requested_at` and therefore
  the standard waitlist position that request naturally earns;
- when a seat opens, the first currently eligible request under the same order
  is promoted; and
- two equal timestamps always resolve by user ID, never randomly.

An identical retry preserves request timestamps. Selecting a different table
creates new table and priority request timestamps for that target. If a member
releases priority but retains the table choice, the member is reranked as a
standard request using the original table request time.

### Displacement example

A six-seat table has six standard players. Their table-request times range from
10:01 through 10:06. At 10:10, a seventh player confirms a valid DM priority
token. The priority player is assigned and the 10:06 standard request moves to
the head of the standard portion of the waitlist. The earlier standard signup
may therefore be displaced even though it predates the priority request.

If two priority requests both have 10:10 timestamps, the lexically smaller
Discord user ID ranks first. If priority demand exceeds all six seats, later
priority requests waitlist ahead of every standard request and release their
tokens if still unseated when selection closes.

## Withdrawal, cancellation, and no-show behavior

- **Member withdraws or stops using priority before selection closes:** release
  the reservation, rerank the table, and promote the next request.
- **Member changes tables:** release the old-table claim and promote there. The
  token remains reserved for the event, while the new table receives a new
  priority-request timestamp.
- **Member withdraws or does not attend after selection closes:** the token
  remains redeemed because the scarce seat was held. There is no automatic
  refund.
- **Organizer cancels the table or event:** release an unredeemed reservation or
  refund a redeemed token because the guaranteed game did not occur.
- **Excused late member cancellation:** an authorized organizer may make an
  explicit, reasoned refund; the bot never infers one.

A refund preserves the token's original `expires_at`. If that instant has
passed, the refunded token is immediately expired. Extending it requires a
separate explicit replacement grant with an audit reason.

## Republished plans

A superseding plan for the same event carries a priority request forward only
when the old table maps to a new table with the same active GM, matching the
existing assignment carry-forward rule. Preserve both request timestamps in
that case.

If no compatible table remains, release the reservation and require explicit
confirmation for a new target. A replacement event with a new `event_id` never
inherits a reservation. Any priority seating change increments table state so
an older final manifest becomes stale and can be regenerated safely.

## Corrections and audit

Corrections append history; they never delete or rewrite grants, token events,
or historical seating. Every completion, grant, reservation, redemption,
displacement, release, expiration, refund, and correction records
the relevant guild, event, plan, table, member, actor, policy version,
authoritative timestamp, and idempotency key. An admin correction also requires
a concise reason.

Correcting a completion outcome or actual DM:

- grants two tokens to a newly eligible DM with the correction confirmation as
  `earned_at`;
- marks incorrectly granted available or reserved tokens `corrected` (revoked
  by correction) and reranks any affected pre-closure table; and
- leaves an already redeemed seat historical. Version 1 creates no negative
  token debt, but the correction records that the erroneous token was already
  used.

An organizer may issue a separate compensating grant or refund with an explicit
reason. Member output exposes only that member's token information. A displaced
member may be told that DM priority affected the seat, but never receives
another member's private reward history.
