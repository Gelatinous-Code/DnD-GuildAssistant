# Test-guild go-live pilot

Run this checklist in a disposable Discord guild before enabling the assistant
for the real guild. The pilot intentionally uses small tables so two or three
test members can prove capacity, displacement, promotion, and privacy without a
large rehearsal group.

Do not paste bot tokens, interaction tokens, private attendance, or another
member's token history into this document or a GitHub issue. Record Discord and
D1 identifiers only in the redacted evidence block at the end.

## Deployment order

1. Merge the reviewed release PR.
2. Apply every pending D1 migration remotely.
3. Deploy the Worker.
4. Register the updated test-guild commands through the protected GitHub
   workflow and approve the environment when prompted.
5. Run `/guild doctor` and resolve every failure.
6. Keep automation in **Review before publish** for the first synthetic weeks.
7. Complete the review-mode acceptance below.
8. Enable **Autopilot**, prove one scheduled transition, then prove pause and
   recovery before considering the pilot complete.

## Reduced-capacity fixture

Configure one-seat or two-seat tables only in the disposable guild. Use at least
three test members:

- one organizer who can also run the source game as DM;
- one ordinary player who selects a target table first; and
- the eligible DM acting as a player in a later week.

Use synthetic dates far enough apart to make the lifecycle readable. The source
week must finish and be archived before its session is confirmed. The two earned
tokens are then available for later target events.

## Review-mode acceptance

### A. Setup and ordinary weekly workflow

- [ ] Run `/guild setup` with the disposable operations channel, local time
      zone, small table limits, and optional test roles.
- [ ] Run `/guild automation mode:Review before publish confirm:True`.
- [ ] Run `/guild doctor`; save only the aggregate pass/fail summary.
- [ ] Open a synthetic source week and exercise GM, player, and withdrawal
      controls, including one repeated click.
- [ ] Lock, plan, review, publish, select tables, waitlist, promote, finalize,
      export, and archive without a spreadsheet or manual roster assembly.
- [ ] Retry one already completed operation and verify no duplicate message or
      assignment is created.

### B. Confirm a completed source session

- [ ] Use `/session status` for the archived source table. Confirm the seeded
      draft matches the immutable final roster.
- [ ] Record a no-show, walk-in, or substitute with `/session attendance`, then
      inspect status again. Confirm no public message changes.
- [ ] Use `/session confirm result:Completed confirm:True`.
- [ ] Repeat the exact confirmation. Verify one completion revision, one grant,
      and exactly two available DM priority tokens.
- [ ] As the DM, run `/priority status`. Verify the response is private and
      shows both usable-through dates in the guild time zone.
- [ ] Confirm the award DM arrives once. If DMs are blocked, verify the token
      state is still correct and private admin diagnostics show a sanitized
      blocked delivery.

### C. Guaranteed seat, displacement, and promotion

- [ ] Open and publish target week A with a deliberately full table.
- [ ] The ordinary player selects the table first.
- [ ] The eligible DM signs up as a player, previews priority, reads the
      displacement warning, and explicitly confirms it.
- [ ] Verify the DM is assigned, exactly one ordinary player is waitlisted, the
      table is not over capacity, and both private outcomes are understandable.
- [ ] Repeat the priority confirmation; verify no second token is reserved.
- [ ] Open another priority preview, change the table roster before clicking its
      button, and verify the stale confirmation is rejected without changing a
      seat or token. Open a fresh preview before continuing.
- [ ] Release or move the priority request before selection closes. Verify the
      original standard request time is retained and the next eligible member
      is promoted deterministically.
- [ ] Confirm priority again, finalize target week A, and verify the seated
      request redeems exactly one token.

### D. Refund, correction, and expiry

- [ ] Open target week B and reserve the remaining token.
- [ ] Cancel the target event or use an authorized, reasoned refund. Verify the
      token returns with its original expiration date.
- [ ] Use `/priority-admin diagnose` to explain the grant, reservation, seating,
      refund, and notification outcomes without a direct D1 edit.
- [ ] Correct the source completion or grant with a concise reason, confirm the
      append-only history, then retry the correction.
- [ ] Advance a synthetic clock in automated acceptance or wait for a test token
      boundary. Verify pre-expiry and expiry notifications are each idempotent.

### E. Autopilot, failure, and rollback

- [ ] Enable `/guild automation mode:Autopilot confirm:True` only after sections
      A–D pass.
- [ ] Observe one scheduled transition and verify its operation record.
- [ ] Temporarily remove a harmless test-channel permission or block a test DM,
      exercise the failure path, restore it, and use the documented retry.
- [ ] Pause automation. Confirm no new scheduled weekly transition occurs while
      priority expiry/notification maintenance continues safely.
- [ ] Re-enable review mode and confirm `/guild doctor` returns ready.

## Evidence template

Attach a redacted copy to GitHub issue #39. Replace all member IDs and names with
stable labels such as `member-a`; never include notification bodies.

```text
Pilot date/time zone:
Release commit / Worker version:
D1 migration versions:
Test guild label:

Source event/table labels:
Target A / Target B labels:
Expected tables, seats, waitlist:
Actual tables, seats, waitlist:

Completion revisions: expected / actual
Reward grants: expected / actual
Credits by terminal state: available / reserved / redeemed / expired / corrected
Seating decisions: assigned / displaced / promoted / released
Notification outcomes: sent / blocked / uncertain / failed (counts only)

Retries and replays exercised:
Failure and rollback exercised:
Review-mode operator minutes:
Autopilot operator minutes:
Approximate Worker requests / D1 rows read and written:

Release-blocking defects:
Follow-up issue links:
Final result: PASS / FAIL
```

The pilot is complete only when the visible Discord roster, private diagnostics,
and D1-backed acceptance counts agree and every release-blocking defect has its
own issue.
