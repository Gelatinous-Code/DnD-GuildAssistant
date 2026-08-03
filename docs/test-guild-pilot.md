# Test-guild go-live pilot

**Audience: release testers with Discord, repository, and Cloudflare access.**
This is not a player guide or a normal weekly organizer checklist. Players use
the [player and GM guide](player-guide.md); organizers use the
[organizer guide](organizer-guide.md).

This is an acceptance checklist, not a deployment guide. Begin only after the
release candidate has been migrated and deployed, the Discord endpoint is
verified, and `/ping` works in a disposable server. Use the
[first-deployment guide](first-deployment.md) when any of those are missing.

Exploratory testing may use an unmerged branch, but a formal **PASS** must use an
exact commit that is already on `main`. Merge the reviewed release first, check
out the resulting `main` commit, then migrate, deploy, and pilot that exact SHA.
This rule also covers squash and rebase merges, which create a new commit SHA.
Merging changes source control only; it does not migrate D1 or deploy the Worker.

## Time and people required

This is not a 10-minute smoke test. The manual M6 token path needs one completed
source event and two target events. The scheduled-mode checks add two more test
events. Use `duration_minutes:60` for disposable pilot events unless a test says
otherwise. The source DM cannot receive priority tokens until the source event
has ended. Expect about 60–90 minutes of hands-on work spread over several
elapsed hours. It is reasonable to split the pilot
across a day or several test sessions.

One **pilot lead** needs the repository checkout, Cloudflare access, Wrangler
authentication, and Manage Server. That lead can act as Member A. Members B and
C need only ordinary Discord accounts in the test server. The deployer may
provide the Worker/D1 start-gate evidence to the pilot lead.

Use three distinct test members throughout:

| Label | Source event | Target events |
| --- | --- | --- |
| **Member A** | GM; earns two priority tokens | Player; uses priority |
| **Member B** | Player | Ordinary player who is displaced and promoted |
| **Member C** | Player | GM who supplies the target table |

Do not paste bot tokens, interaction tokens, private attendance, or another
member's token history into this document or a GitHub issue. Record Discord and
D1 identifiers only in the redacted evidence block at the end.

## Start gate

Stop and repair the installation if any required check fails:

- [ ] Record the full tested commit from `git rev-parse HEAD`, and confirm that
      exact commit is on `main` with `git merge-base --is-ancestor HEAD main`.
- [ ] Confirm the Worker health URL returns `status: ready`.
- [ ] Run `npx wrangler deployments list` and record the latest deployment ID
      whose time matches the tested deploy.
- [ ] Confirm `npx wrangler d1 migrations list DB --remote`
      reports no pending migrations.
- [ ] Record the applied migration level as the highest numbered `.sql` file in
      `migrations/`. The empty pending list proves that checkout's files have
      been applied.
- [ ] Run `/ping` in the disposable server.
- [ ] Run `/guild setup` with no options and confirm the intended test channel,
      five-stage schedule and table policy.
- [ ] Explicitly pause scheduled lifecycle work:

      `/guild automation mode:Paused confirm:True`

- [ ] Run `/guild status`, then `/guild doctor`. Fix every ❌. For this pilot,
      **Attach Files is required** because section 1 exercises `/week export`.

## Reduced-capacity fixture

Use this exact table policy so three people can prove capacity and waitlist
behavior:

```text
/guild setup minimum:1 preferred:1 maximum:1 duration_minutes:60
```

Run `/guild setup` again and verify the saved values. Never use this reduced
policy in the real guild.

The first three events are manual while automation is Paused. This prevents a
15-minute Cron run from locking an event while testers are still clicking.
Sections 5 and 6 turn scheduling back on at controlled times.

## Create a safe near-future start time

Before each manual `/week open`, run this in PowerShell. The first value is 20
minutes from now; the second is the configured one-hour pilot event end:

```powershell
$pilotEventStart = (Get-Date).ToUniversalTime().AddMinutes(20)
$pilotEventStart.ToString("yyyy-MM-ddTHH:mm:ssZ")
$pilotEventStart.AddHours(1).ToString("yyyy-MM-ddTHH:mm:ssZ")
```

Use the first value as `starts_at`. Keep the second value so you know when
source-session confirmation becomes available. If the checklist takes longer
than expected before `/week open`, generate fresh values.

## Manual M6 acceptance (automation Paused)

### 1. Run and finish the source event

- [ ] Generate a fresh start time with the PowerShell helper, then open the
      source event:

      `/week open starts_at:<first-helper-value> title:Pilot source event`

- [ ] Member A clicks **Run T1**. Members B and C click **Play T1**. Have Member
      C withdraw and click **Play T1** again; have Member A repeat **Run T1**.
      Run `/week status` and verify one GM and two players, with no duplicates.
- [ ] Run these commands in order:

      `/week lock`

      `/week plan`

      Confirm the private draft has one table, Member A as GM, and capacity 1.
- [ ] Run `/week publish`, then immediately run `/week publish` again. Verify the
      second call reconciles the same table message instead of creating another.
- [ ] Member B selects table 1 and becomes seated. Member C selects table 1 and
      becomes waitlisted. Member B leaves the table; verify Member C is promoted.
      Member B selects it again and becomes waitlisted. At every point, exactly
      one player is seated.
- [ ] At or after the saved start time, run this twice:

      `/week retry step:Finalize table manifest`

      Confirm there is one final manifest, not two.
- [ ] Run `/week export` and verify a private CSV attachment downloads. Then run
      `/week archive`. The CSV is only a portability check; do not use a
      spreadsheet to repair the roster.

### 2. Confirm the source session and award Member A

- [ ] Wait until the second PowerShell helper value—the source event's configured
      end. `/session` intentionally refuses an event that has not ended.
- [ ] Run `/session status table_number:1`. Confirm it identifies the expected
      source event, plan, and table and says there are no attendance deviations
      or confirmed snapshot yet. Compare the public final manifest separately.
- [ ] Exercise a private attendance deviation, for example:

      `/session attendance table_number:1 member:@MemberC role:Player outcome:No-show reason:Pilot no-show`

      Member C is the seated source player. Run `/session status table_number:1`
      again, verify the private draft now contains the deviation, and verify no
      public message changed.
- [ ] Run this command twice:

      `/session confirm table_number:1 result:Completed confirm:True`

      Verify one completion revision, one reward grant, and exactly two tokens.
- [ ] As Member A, run `/priority status`. Confirm the response is private and
      shows two available tokens and their guild-local usable-through dates.
- [ ] Allow one Cron interval (up to 15 minutes) for the queued award DM. Confirm
      it arrives once. Run `/priority-admin diagnose member:@MemberA` to
      distinguish pending, sent, and blocked delivery. If testing blocked DMs,
      Member A must block them before confirmation; the token state must still be
      correct. Wait longer only when diagnostics show a retryable delivery.

### 3. Use one token in target event A

- [ ] Generate a fresh start time and run
      `/week open starts_at:<first-helper-value> title:Pilot target A`.
- [ ] Member C clicks **Run T1**. Members A and B click **Play T1**. Run
      `/week lock`, `/week plan`, and `/week publish` in that order. Confirm one
      table with Member C as GM and capacity 1.
- [ ] Member B selects table 1 first. Member A selects it second and becomes
      waitlisted.
- [ ] As Member A, run `/priority use table_number:1` but do not click the
      confirmation button yet. Member B leaves and reselects table 1. Click the
      old confirmation; verify it is rejected as stale with no token change.
- [ ] Restore the displacement setup: Member A leaves table 1, Member B is
      promoted, and Member A selects table 1 again and becomes waitlisted.
- [ ] Member A runs `/priority use table_number:1` again and confirms its bound
      button. Verify Member A is seated, Member B is waitlisted, and the table is
      not over capacity. Click the same confirmation again and verify no second
      token is reserved.
- [ ] Member A runs `/priority release confirm:True`. Verify Member B is promoted
      and Member A retains the ordinary waitlisted request.
- [ ] Member A opens a fresh `/priority use table_number:1` preview and confirms
      it. Verify the same deterministic displacement result.
- [ ] At or after target A's start time, run
      `/week retry step:Finalize table manifest`. Member A then runs
      `/priority status` and verifies one token remains available. The organizer
      runs `/priority-admin diagnose member:@MemberA` and verifies the other is
      redeemed. Run `/week archive` before opening target B.

### 4. Refund the second token in target event B

- [ ] Generate a fresh start time and run
      `/week open starts_at:<first-helper-value> title:Pilot target B`.
- [ ] Member C clicks **Run T1**. Members A and B click **Play T1**. Run
      `/week lock`, `/week plan`, and `/week publish` in that order.
- [ ] Member A selects table 1, runs `/priority use table_number:1`, and confirms
      the bound button. Run `/priority-admin diagnose member:@MemberA` and record
      the admin-only grant and credit identifiers privately.
- [ ] Cancel before the start time:

      `/week cancel reason:Pilot cancellation refund`

      Member A runs `/priority status` and verifies the token is available again
      with its original expiration date. Diagnostics must show the reservation,
      seating, cancellation, and refund without any direct D1 edit.
- [ ] At the end of the priority-token portion, use the private `grant_id` from diagnostics
      to exercise one append-only correction:

      `/priority-admin correct grant_id:<private-grant-id> reason:Pilot correction confirm:True`

      Verify diagnostics show one correction. Exact duplicate-delivery replay is
      covered by automated tests because a new slash command has a new request ID.

## Scheduled-mode acceptance

### 5. Prove Review before publish

- [ ] Confirm no event is active. Choose one local weekday and five future times
      on that day, each at least one 15-minute Cron interval apart, in this
      order: GM signup, player signup, tables, open seating, game. Leave at
      least 45 minutes between tables and open seating so the per-tier waitlist
      checks below can be completed. Keep the game two to three hours away.
      Save the accelerated sequence:

      ```text
      /guild setup
        timezone:<IANA-zone>
        gm_day:<day> gm_time:<first-HH:mm>
        player_day:<day> player_time:<second-HH:mm>
        tables_day:<day> tables_time:<third-HH:mm>
        open_seating_day:<day> open_seating_time:<fourth-HH:mm>
        weekday:<day> time:<game-HH:mm>
        duration_minutes:60
      ```

      Discord submits this as one command; the lines above are for readability.
      `/guild setup` must display the five stages in the same order before you
      continue.

- [ ] Enable Review without changing any custom reminder rule:

      `/guild automation mode:Review before publish confirm:True`

- [ ] Allow up to two Cron intervals (30 minutes) for the scheduled event to be
      created and opened. Members A and B click **Play T1** and Member C clicks
      **Run T1** as soon as the signup message appears.
- [ ] After the configured `tables_time`, allow up to one more Cron interval.
      Run `/week status`. Verify the phase is planned, recent operations show
      `lock-plan`, and no table publication exists. This is Review's approval
      stop.
- [ ] Run `/week publish`, verify one public table, then clear this synthetic event
      only after completing these player-capacity checks:

      1. The draft identifies one player as reserved and the later signup on the
         Tier 1 weekly waitlist. The reserved player chooses the table successfully.
      2. Before `open_seating_time`, the Tier 1 waitlisted player tries **Join** and
         receives a private explanation that signup-order capacity is still
         reserved. The table must not change.
      3. The reserved player presses **Withdraw** on the weekly signup card. This
         is a drop from the week, not merely **Leave Table**.
      4. Verify the first Tier 1 waitlisted player receives one private promotion
         message, may now choose the table, and no duplicate DM arrives after an
         additional Cron interval.
      5. Have that promoted player use **Leave Table**. Verify their weekly
         reservation remains active; leaving a table must not withdraw them.

      Then run `/week cancel reason:Pilot review-mode complete`.
- [ ] Immediately return to `/guild automation mode:Paused confirm:True` before
      changing the schedule for the next check.

### 6. Prove Autopilot, pause, and recovery

- [ ] While Paused, choose another local game time about two hours in the future
      and update only `weekday` and `time` with `/guild setup`.
- [ ] Enable Autopilot without changing reminders:

      `/guild automation mode:Autopilot confirm:True`

- [ ] Allow up to two Cron intervals for the event to be created/opened. Run
      `/week status` and verify the recent operation record. This is the required
       scheduled Autopilot open transition. Members A and B immediately click
       **Play T1** and Member C clicks **Run T1**.
- [ ] Immediately run `/guild automation mode:Paused confirm:True`. Wait until
      the one-hour lock deadline has passed plus one Cron interval; `/week status`
      must still show the open phase.
- [ ] While still Paused, temporarily deny **Send Messages** to the bot in the
      test channel. `/guild doctor` must show a ❌, and an attempt to enable Review
      must be refused. Restore Send Messages and require `/guild doctor` to pass.
- [ ] Enable Review again:

      `/guild automation mode:Review before publish confirm:True`

      Because the lock deadline is now past, allow one Cron interval and verify
      `/week status` shows the recovered `lock-plan` operation and a planned
      draft.
- [ ] Switch that planned event back to Autopilot with
      `/guild automation mode:Autopilot confirm:True`. Allow one
      Cron interval and verify `/week status` shows one successful publish
      operation and exactly one public table message. Allow one additional Cron
      interval and verify no duplicate appears. Finish with
      `/week cancel reason:Pilot autopilot publication complete`.
- [ ] Return the disposable guild to a safe state with
      `/guild automation mode:Paused confirm:True`, then verify `/guild status`
      reports **Paused**. Do not leave the reduced-capacity pilot schedule in
      Review or Autopilot.

## Checks covered by automation

Do not wait for a real token-expiration boundary, edit D1 timestamps, or try to
advance the deployed Worker's clock. `npm run check` covers pre-expiry delivery,
expiry, retry, stale confirmation, and skipped-generation recovery with a
controlled test clock. Record the green CI/test run in the evidence below.

The human pilot proves the Discord-facing workflow, permissions, privacy,
delivery behavior, and recovery controls. Automated tests prove long-duration
time boundaries that are impractical to reproduce safely by hand.

## Evidence template

Attach a redacted copy to GitHub issue #39. Replace all member IDs and names with
stable labels such as `member-a`; never include notification bodies.

```text
Pilot date/time zone:
Full release commit / Worker deployment ID:
D1 migration level (highest applied file):
Test guild label:

Source event/table labels:
Target A / Target B labels:
Expected tables, seats, waitlist:
Actual tables, seats, waitlist:

Completion revisions: expected / actual
Reward grants: expected / actual
Credits observed: available / reserved / redeemed / refunded / corrected
Seating decisions: assigned / displaced / promoted / released
Notification outcomes: sent / blocked / uncertain / failed (counts only)

Retries and replays exercised:
Failure and rollback exercised:
Review-mode operator minutes:
Autopilot operator minutes:

Release-blocking defects:
Follow-up issue links:
Final result: PASS / FAIL
```

The pilot is complete only when the visible Discord roster, private diagnostics,
and D1-backed acceptance counts agree and every release-blocking defect has its
own issue.

After a PASS, continue with
[Promote the tested bot to the real guild](real-guild-go-live.md). A passing test
guild does not register commands or save configuration in the real guild.
