# GM eligibility and priority policy

This policy makes weekly GM selection reproducible, explainable, and independent of deregister/re-register rituals. The same persisted inputs and policy version always produce the same ranking; there is no lottery or hidden random seed.

## Eligibility snapshot

A GM is eligible when all of the following are true at the planning snapshot:

- they have one active `gm` signup for the weekly event;
- the event is locked (or an admin is intentionally previewing a draft);
- they have not withdrawn or been removed by an audited admin correction; and
- the current plan does not already assign them to another table.

An active GM signup is availability for that week, not a permanent claim on the weekly role. Guild membership and configured role requirements are validated separately when roles are reconciled. Draft regeneration uses the current eligible snapshot and never requires a GM to withdraw and sign up again.

The number selected is the largest viable number of GMs for the active player demand while meeting the configured minimum table size. With the defaults, tables prefer six players and may reduce to five or four. If fewer than four players exist, one explicitly underfilled draft may be shown for admin judgment; it is not silently published.

## Deterministic ranking

Eligible GMs are sorted by these keys, in order:

1. **Fewest historical published selections.** Only a GM recorded on a published weekly plan counts. Regenerated or abandoned drafts do not.
2. **Oldest last selection.** A GM who has never been selected ranks before one with a selection at the same count; otherwise the earliest `selected_at` ranks first.
3. **Earliest active signup timestamp for this event.** This is only a late tie-breaker, not the rotation mechanism.
4. **Discord user ID in ascending lexical order.** This final stable key removes nondeterminism when timestamps tie.

An admin preview should expose the relevant explanation, for example: “selected: 0 prior selections; never selected,” or “not selected: two viable tables; ranked third after selection count and last-selected tie-breaks.” Private history is shown only in authorized output.

### Example

| GM | Published selections | Last selected | Signed up | Result |
| --- | ---: | --- | --- | --- |
| Ada | 0 | Never | 10:05 | Rank 1 |
| Borin | 1 | Three weeks ago | 10:03 | Rank 2 |
| Cyra | 1 | Last week | 09:58 | Rank 3 |

With enough players for two viable tables, Ada and Borin are selected. Cyra's earlier signup cannot outrank Borin's older last selection because signup time is evaluated later.

## Edge cases

### New GMs

New GMs normally have zero published selections and no last-selection timestamp,
so they receive high rotation priority. Multiple new GMs are ordered by signup
time and then user ID. An admin may withdraw a new GM signup for a guild-specific
reason and regenerate the plan; the correction is audited rather than encoded as
an invisible priority penalty.

### Late signups and corrections

A signup received after lock is recorded as a late change but does not silently mutate the locked snapshot, draft, or publication. An admin may reopen/correct the week and regenerate, or add a documented manual override. Regeneration ranks the current active records normally. Withdrawing and signing up again never improves selection count or last-selected history; it only produces a later signup tie-break timestamp.

### Cancellation before publication

A GM who withdraws before publication is removed from eligibility and receives no historical selection. Regenerate the draft so the next ranked viable GM can be selected. If the withdrawal reduces the number of viable tables, players are rebalanced or waitlisted deterministically.

### Cancellation after publication

The published selection remains in history because the scarce weekly slot was allocated and announced. The admin repairs the current table through a superseding revision or explicit override. For an excused cancellation, the admin may compensate in a later week with a reasoned override; history is not silently rewritten.

### No-show

A no-show does not automatically delete the published selection or modify future arithmetic. Admins may exclude the person from a future eligibility snapshot or apply a documented override according to guild policy. Attendance discipline is an administrative concern; the planning algorithm does not infer blame from Discord presence.

### Too many or too few GMs

Surplus GMs remain unselected in ranked order; they are not penalized with a
historical selection. Too few GMs produces a projected capacity shortfall in
the admin preview. Every active player begins unassigned; after published tables
fill, later selectors enter deterministic per-table waitlists. An underfilled
table is clearly flagged for admin review.

### Ties

All ties resolve through the four ranking keys. Discord user ID is intentionally used only as a final stable key. If the guild later wants a lottery, that is a policy-version change and must persist the seed and explanation; the MVP has no random selection.

## Manual overrides

Only an authorized admin may replace a computed table GM with another active GM
signup. An override must include a concise reason, reference the plan revision,
and be written to the audit log. Removing eligibility uses the audited
`/week signup ... withdraw` correction followed by regeneration. Preview
distinguishes computed selections from overrides. Publishing remains the point
at which selected GMs receive one historical selection for the event.

Overrides do not alter prior weeks, selection counts, or timestamps. Repeating publish/retry for the same plan is idempotent and cannot create an additional historical selection. A superseding plan preserves the previous revision and its audit context.

## Data minimization

The ranking needs only Discord user ID, current signup timestamp/status, count of published selections, and last published selection timestamp. Display names are presentation data and never a priority key. Message contents, Raid Helper state, voice presence, and unrelated Discord roles do not influence ranking.
