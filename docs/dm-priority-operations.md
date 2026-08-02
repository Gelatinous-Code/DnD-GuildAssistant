# DM priority operations

This runbook covers the M6 reward and priority-seat workflow. D1 is
authoritative; Discord messages are private projections of its append-only
completion, token, seating, and notification records.

## Deployment order

1. Back up the target D1 database.
2. Apply migrations `0006_session_completions.sql`,
   `0007_priority_seating.sql`, and `0008_priority_notifications.sql`.
3. Deploy the Worker.
4. Replace the test-guild command definitions with
   `npm run commands:register`.
5. Run `/guild doctor`, then follow the
   [test-guild pilot](test-guild-pilot.md). Do not enable a real-guild week
   until that live click-through is recorded.

The 15-minute Cron Trigger reconciles incomplete reward grants, expires due
tokens, repairs notification outbox entries, and delivers private DMs. Those
tasks continue while weekly automation is paused; pausing table automation must
not strand a token lifecycle.

## Organizer workflow after a game

Publishing, finalizing, or archiving a roster never awards tokens.

1. Archive the finalized week.
2. Run `/session status table_number:<n>` to review the immutable planned
   source and private actual-attendance draft.
3. Record only deviations with `/session attendance`: a no-show, substitute,
   walk-in, or changed actual role. Give every non-attendance deviation a short
   reason. A substitute identifies the planned member replaced.
4. Run `/session confirm result:Completed confirm:True`. A completed table must
   have exactly one actual attending DM. Use `Cancelled` plus a reason when the
   game did not run.
5. Re-run `/session status`. A successful completed result shows reward sync;
   exactly two tokens are attached to the confirmed revision. A saved result
   with failed reward sync is safe: Cron retries the same revision and original
   confirmation timestamp.

See [session completion](session-completion.md) for correction semantics and
privacy rules.

## Member workflow

- `/priority status` privately lists the available count and each token's
  usable-through date in the guild time zone. Viewing it changes nothing.
- `/priority use table_number:<n>` and **Use DM Priority** on a published table
  card only create a private preview; neither path reserves a token.
- A member must have an active player signup. On a published table card, **Use
  DM Priority** opens a private preview showing the selected table, earliest
  expiry, balance, and a full-table displacement warning.
- **Confirm priority** performs one atomic D1 operation: reserve the earliest
  eligible token, record the table request, rerank, displace at most one
  standard seat when required, and append decision events.
- The short-lived confirmation button is scoped to the guild and member and is
  bound to the exact assignment version, table-state version, and token shown.
  If any of them changes, the click is rejected before seating changes and the
  member must open a fresh preview.
- Repeated confirmation of the same active request is a replay and does not
  reserve another token. To make an ordinary request while priority is active,
  first use `/priority release confirm:True`.
- At roster finalization, an assigned reservation is redeemed and an unseated
  reservation is released. Event cancellation refunds both reserved and
  redeemed tokens without moving their original expiration boundary.

Displaced and promoted members receive only their own private outcome. They are
not told who exercised a token or shown anyone else's reward history.

## Notifications

The durable outbox covers award, reservation, redemption, refund, correction,
expiration, pre-expiration, displacement, and promotion. Each event and
template/config revision has a stable idempotency boundary.

`/priority-admin configure reminder_hours:<0-720> confirm:True` changes the
guild-scoped pre-expiration lead. `0` disables future pre-expiration DMs and
cancels pending ones. The default is 72 hours.

The scheduler claims and attempts one outbox message at a time and drains at
most 10 per tick by default. That bounds crash ambiguity and leaves headroom
under the [Cloudflare Workers Free external-subrequest limit](https://developers.cloudflare.com/workers/platform/limits/);
the next 15-minute tick continues the durable queue.

When Discord returns code `50007`, the outbox marks delivery `blocked` and
token state remains valid. An ambiguous failure after a send attempt becomes
`uncertain` and is not automatically retried, preventing a duplicate DM. Use
private diagnostics and Discord evidence before any manual follow-up.

## Private diagnostics and corrections

`/priority-admin diagnose` returns a sanitized guild health summary.
Optionally scope it to `member` or `event_id`. The report aliases identifiers,
allowlists state/error codes, omits message content, display names, reasons,
idempotency keys, and another member's identity, while retaining policy,
revision, operation, and config correlations.

- Use `/priority-admin correct grant_id:<id> reason:<reason> confirm:True` only
  when the confirmed reward itself is wrong. It appends a correction and never
  deletes prior grants, credits, redemptions, or seating decisions.
- Use `/priority-admin refund credit_id:<id> reason:<reason> confirm:True` for a
  documented exceptional refund of a reserved or redeemed token. Expiration is
  never extended.
- Prefer correcting the underlying `/session` result when the actual DM or
  completed/cancelled outcome was recorded incorrectly. Same-DM corrections
  preserve the original reward boundary; a changed DM reverses the old active
  grant and awards exactly two tokens to the corrected DM.

Do not edit D1 directly to change a balance, assignment, waitlist position, or
notification status.

## Redacted dispute-resolution example

An organizer receives: “I used priority but was waitlisted.” They run private
member- and event-scoped diagnostics and record only this redacted evidence:

```text
Scope: member self, event evt-2
Policy: dm-priority-v1
Credit cr-1: available -> reserved, operation op-4
Seat op-4: priority request, table alias tbl-1, assigned
Seat op-7: displaced external member count 1
Closure op-9: reserved -> redeemed
Notification nt-3: seat displacement sent; nt-4: redemption sent
Conclusion: capacity remained 6/6; priority was honored exactly once.
```

The support record excludes Discord IDs, names, free-form reasons, message
content, token idempotency keys, and the displaced member's identity. If the
trace instead shows an unseated closure, the reservation should have returned
to available/expired automatically. If it did not, preserve the report and
Worker correlation data, pause table automation, and open a release-blocking
defect before attempting repair.

## Incident checks

| Symptom | Safe action |
| --- | --- |
| Confirmation saved, reward sync failed | Do not confirm again with changed data. Let Cron reconcile or inspect `/session status`; the revision is idempotent. |
| Member has no token after a grant | Run member diagnostics and verify grant, two credit rows, correction state, and expiry boundary. |
| Priority confirmation says state changed | Reopen `/priority status` and the latest table card. Do not repeatedly click an old component. |
| Token remains reserved after closure | Retry finalization; settlement uses a stable event/plan key. Inspect diagnostics before refunding. |
| Event cancellation failed part-way | Pause automation, inspect the event/plan cancellation operation and credit events, then retry the authorized cancellation path. |
| DM was blocked | Treat `blocked` as terminal delivery only. The token remains usable and `/priority status` is the fallback. |
| Delivery is uncertain | Check the member's DM/message evidence. Never reset it to pending merely to “see if it works.” |

All support output is private. Attach only the redacted pilot/evidence template
to GitHub issues; never attach a raw D1 export or production Discord member
list.
