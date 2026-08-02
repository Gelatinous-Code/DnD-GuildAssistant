# Guild Assistant operations guide

This guide is the administrator and maintainer runbook for the native weekly
workflow. D1 is the source of truth; Discord messages are projections of that
state. Never repair state by editing a bot message or by asking members to click
controls in a magic sequence.

## Service ownership and dependencies

Keep the GitHub organization, Discord application, and Cloudflare account under
guild/organization control with at least two maintainers. Do not make a personal
machine part of normal operation. The Cloudflare Worker, D1 database, and Cron
Trigger are the runtime. Raid Helper and Google Sheets are optional external
tools; Guild Assistant has no runtime connection to them and requires no
credentials for either one.

Production secrets are managed by Cloudflare and GitHub Actions, never committed to the repository or pasted into support output:

- `DISCORD_PUBLIC_KEY` verifies incoming interactions.
- `DISCORD_BOT_TOKEN` authorizes Discord REST operations.
- `DISCORD_APPLICATION_ID` is configuration, not a secret.

Use separate Discord guild/channel resources and a separate D1 database for testing when possible. A deployment must apply versioned migrations before code that depends on them.

## Least-privilege Discord setup

Install the application for the guild with `applications.commands` and `bot`. Grant only the features in use:

| Permission | Required for |
| --- | --- |
| View Channels | Every configured event, table, and reminder channel |
| Send Messages | Signup posts, table posts, status notices, and reminders |
| Embed Links | Structured signup/table posts |
| Read Message History | Reconcile an existing bot-owned post after retry |
| Manage Roles | Optional weekly GM-role reconciliation |
| Mention configured role | Optional role-aware reminders; still restricted by explicit allowed mentions |
| Attach Files | Private `/week export` attachments in the channel where an admin invokes the command |

Do not grant Administrator. Place the bot's highest role above each role it is expected to grant or remove. Guild Assistant records leases only for roles it granted and never removes unrelated or manually assigned roles.

Only a member with Manage Guild or Administrator may run setup, lifecycle
mutations, publication, export, role repair, or reminder configuration.
Sensitive responses are ephemeral. The configured organizer role is a reminder
audience, not an authorization shortcut. Member signup/table controls remain
available to ordinary members in the configured channels.

## Command surface

Discord supplies the option form after a subcommand is selected.

| Command | Purpose |
| --- | --- |
| `/guild setup` | Show guided setup or update only the supplied channel, role, IANA time-zone, weekly schedule, or table-policy settings. |
| `/guild automation` | Explicitly select paused, review, or autopilot mode and independently enable/disable role sync and reminders. |
| `/guild status` | Show sanitized effective configuration and setup completeness. |
| `/guild doctor` | Check configured resources, channel access, send/embed/history permissions, role mention behavior, Manage Roles, and hierarchy. |
| `/week open` | Create/open the next or specified native signup week idempotently. |
| `/week status` | Show current phase, counts, plan revision, publication IDs, due/failed operations, and capacity risk. |
| `/week lock` | Freeze the active signup snapshot for planning. |
| `/week signup` | Record an audited late GM/player signup, cancellation, or admin correction. |
| `/week plan` | Generate or regenerate the deterministic draft and return the admin preview. |
| `/week override` | Change a draft table name, capacity, or active signed-up GM before publication. |
| `/week publish` | Explicitly publish the reviewed draft; repeated delivery returns the existing result. |
| `/week export` | Download an admin-only private, formula-safe CSV snapshot of the active/latest or specified event. |
| `/week archive` | Close a completed published week to normal mutation. |
| `/week retry` | Retry one failed `publish`, `open`, `lock`, `remind`, `finalize`, or `roles` step using its stable operation key. |
| `/week skip` | Confirm an audited skip of one `open`, `lock`, `remind`, `publish`, `finalize`, or `archive` occurrence. |
| `/week cancel` | Explicitly cancel a week that should not continue; requires an audit reason. |
| `/roles sync` | Preview with `dry_run: true`; apply the same desired-vs-leased reconciliation with `dry_run: false`. |
| `/reminder configure` | Validate and show an ephemeral preview of channel, schedule, roles, and rendered text. Set `enabled: false` to disable/skip future occurrences. |
| `/reminder send` | Send an authorized reminder now. Intentional resend requires the explicit resend/confirmation option. |
| `/session status`, `attendance`, `confirm` | Privately review actual attendance, record deviations, and confirm/correct an archived table outcome. |
| `/priority status`, `use`, `release` | Privately inspect, explicitly reserve, or release the invoking member's token. |
| `/priority-admin diagnose` | Return an aliased tenant-scoped completion, token, seating, and notification trace. |
| `/priority-admin correct`, `refund` | Append a confirmed, reasoned grant correction or exceptional token refund. |
| `/priority-admin configure` | Set this guild's pre-expiration DM lead; `0` disables it. |

Configure is the reminder preview. `/week skip` skips one persisted occurrence;
`enabled: false` pauses creation of future reminder occurrences. An ordinary
retry is not an intentional resend and must not create a second successful
message.

The [DM priority operations runbook](dm-priority-operations.md) is the
authoritative organizer path for post-game confirmation, displacement disputes,
blocked/uncertain DMs, correction, and the required live test-guild pilot.

## First-time activation

1. Apply D1 migrations to the intended database and deploy the Worker with its D1 binding and Cron Trigger.
2. Configure the Discord interaction endpoint and install the bot in a non-production/test guild first.
3. Run `/guild setup` without options to see the resumable setup dashboard. Save the event channel first, then update only settings that differ from the safe defaults. Setup starts in paused mode. Use an IANA time zone such as `America/Denver`, not a fixed UTC offset, so daylight-saving changes are handled.
4. Run `/guild status`, then `/guild doctor`. Resolve every required failure before enabling scheduling. Warnings for unused optional features are acceptable.
5. If reminders are wanted, configure them and confirm the ephemeral preview contains the intended channel and only explicitly configured role mentions. Templates containing `@everyone`, `@here`, or an unapproved dynamic mention must be rejected.
6. If role sync is wanted, run `/roles sync dry_run: true`. Verify that the bot role is above the managed role and that only expected Guild Assistant leases would change.
7. Select review mode with `/guild automation mode:review confirm:true`, enabling reminders or role sync only when their checks pass.
8. Run one complete synthetic week from open through archive. In review mode the scheduler stops at the planned revision until an admin runs `/week publish`; finalization and archive resume automatically afterward. `test/fixtures/sanitized-week.json` is safe representative data; never copy production member lists into an issue or test.
9. After the synthetic cycle and duplicate/retry checks succeed, remain in review mode or explicitly select autopilot with `/guild automation mode:autopilot confirm:true`.

## Automation modes

| Mode | Scheduled behavior | Intended use |
| --- | --- | --- |
| Paused | Scheduled lifecycle transitions are disabled and role sync is forced off. Admin lifecycle commands remain available. | Initial setup, maintenance, or incident containment. |
| Review | The scheduler creates/opens, reminds, locks, and plans. An admin reviews and publishes; selection finalization and archive then continue automatically. | Human approval before tables become member-facing. |
| Autopilot | The scheduler creates/opens, reminds when configured, locks, plans, publishes, finalizes at game time, reconciles optional roles, and archives after the event. | Normal zero-touch operation after a successful pilot. |

Changing away from paused mode requires explicit confirmation and a passing
`/guild doctor` result for the enabled features. Reminders and role sync remain
optional in both review and autopilot modes.

## Normal weekly lifecycle

The default schedule opens signups seven days before play and locks them 24
hours before play. The scheduler evaluates the configured local time and
persists idempotency records before performing a transition.

| Phase/time | Normal action | Admin check |
| --- | --- | --- |
| `draft` | The scheduler creates the next event and opens it at the configured time. | Correct title, start time, channel, and local time zone. |
| `open` | Members show GM/player intent or withdraw using native controls. Configured reminders are claimed and delivered idempotently. | `/week status` counts and aggregate capacity risk; never publish a non-responder list. |
| `locked` / `planned` | The scheduler locks the snapshot and creates the deterministic GM/table plan. Review mode waits here; autopilot publishes it. | In review mode, inspect selected/unselected rationale, capacities, and overrides, then run `/week publish`. |
| `published`, before game time | Players select, change, or leave a table. Full tables use deterministic waitlists and promotions. Optional GM roles are reconciled. | Capacity risk, promotions, and role-delivery status. |
| `published`, at game time | Table controls close and the bot posts a closed final manifest containing tables, GMs, players, waitlists, and any unassigned players. | The final manifest message ID and finalized state are recorded in D1. |
| `archived`, after the event | The scheduler archives the week and releases only assistant-owned role leases. | Final status and manifest agree with D1; no spreadsheet handoff is required. |

Only valid forward transitions are accepted. A command delivered twice is a
retry, not a request for a second event, plan, message, reminder, manifest, or
role mutation.

An authorized late correction through `/week signup` is audited and regenerates
or supersedes the plan. Existing player table choices are carried forward when
the same table remains available and has capacity; otherwise the player is
placed deterministically on its waitlist or left unassigned for review. In
autopilot the corrected revision is republished automatically. In review mode
the organizer reviews the new revision and runs `/week publish`.

### Role reconciliation

The desired weekly membership is derived from the current event and published plan. Reconciliation compares that set with active `role_leases`:

- add a configured role only when the desired member lacks an active lease;
- remove it only when Guild Assistant has an active lease that is no longer desired;
- mark successful adds/removals in D1; and
- leave every other member role untouched.

Always run a dry run after changing role configuration, repairing a cancelled/replaced GM, or moving the bot's Discord role. If one member fails hierarchy checks, the error should name that member and remediation while preserving successful/known state for later retry.

### Reminders and nudges

Each scheduled occurrence has a stable idempotency key, status, attempt count, next-attempt time, and final Discord message ID. The scheduler atomically claims a due occurrence before sending it. Transient failures can retry the same occurrence; a successful occurrence is never sent again unless an admin explicitly confirms an intentional resend.

Public reminders target one configured opt-in Discord role and describe the
action/deadline without listing who has or has not responded. The stable
scheduled occurrence permits at most one successful public nudge per event;
membership in that optional Discord role is the member opt-in/opt-out mechanism.
The preview shows the role-member audience count without names. When player
demand exceeds projected GM capacity, the same aggregate message also mentions
the separately configured organizer role and explains the shortfall. The MVP
does not send private or per-person attendance nudges.

Allowed mentions are constructed from configured role/user IDs. Parsing is never left open, and `@everyone`/`@here` remain disabled even if hostile text reaches a template.

### CSV portability and backup

`/week export` is an admin-only convenience boundary, not a weekly workflow
stage. It returns a private Discord attachment for the active/latest event, or
for a specified event ID belonging to the same guild. The versioned CSV is
generated in memory and capped at 2,000 rows and 512 KiB. It is attached only to
the private Discord response; Guild Assistant does not persist a copy in D1 or
send it to Google or another storage integration.

Cells whose first meaningful character could be interpreted as a spreadsheet
formula are neutralized before export. The command records only audit metadata
such as schema version, row count, and byte count. It requires Attach Files in
the channel where the admin invokes it.

Use the file for portability, an offline snapshot, migration, or guild-directed
analysis. D1 remains authoritative and the final Discord manifest is the
operational handoff. Importing the CSV into Google Sheets is optional and needs
no Google API credential, service account, OAuth grant, or bot integration. A
downloaded CSV or Sheet is an external copy and does not update Guild Assistant.

## Failure and recovery runbook

Start every recovery with `/week status` and `/guild doctor`. Record the event ID, operation kind/key, phase, and Discord message ID; do not record tokens or private message content.

| Symptom | Likely cause | Safe recovery |
| --- | --- | --- |
| Interaction endpoint rejects every command | Public key or endpoint mismatch | Confirm the Discord application's endpoint and Cloudflare `DISCORD_PUBLIC_KEY`; redeploy/rotate configuration, then retry a harmless `/guild status`. Invalid signatures must never be bypassed. |
| Health route works but Discord returns no command response | Bot token, REST permission, or Worker exception | Check structured Worker logs and `/guild doctor`; rotate/fix the token or permission. The interaction state remains in D1. |
| Setup/status says a channel or role is missing | Resource deleted or wrong guild ID | Re-run `/guild setup` with the replacement resource, then `/guild doctor`. Never reuse an ID from another guild. |
| Scheduled open, lock, or finalization was missed | Cron disabled/delayed or configuration incomplete | Fix Cron/configuration, inspect `/week status`, then `/week retry` for `open`, `lock`, or `finalize`. Do not create a second event or manifest manually. |
| Unsure whether publish succeeded | Discord response timed out after send | Check `/week status` for the operation and stored message ID, and inspect the target channel. Retry `/week publish`; idempotency should return/reconcile the existing result. |
| Reminder is `failed` | Transient 429/5xx or permanent channel/permission error | Correct permanent errors first; retry the same occurrence with `/week retry` step `remind`. Use `/reminder send` resend confirmation only when a deliberate duplicate notification is wanted. |
| Reminder should not fire | Rule obsolete or event exception | Use `/week skip step: remind` for this occurrence, or `/reminder configure` with `enabled: false` to pause future occurrences. Preserve prior delivery history. |
| Duplicate public reminder is suspected | Intentional resend or operation-key defect | Stop further sends by disabling the rule, capture both message IDs and correlation keys, and investigate before deleting anything. Do not “test” with another send. |
| Role sync reports 403/hierarchy failure | Missing Manage Roles or bot role below target | Correct role permission/order, run `/roles sync dry_run: true`, then apply and/or `/week retry` step `roles`. Never manually clear `role_leases` first. |
| Member changes after publication | Published plan no longer matches availability | Record the audited correction with `/week signup`. Regenerate/supersede through the authorized planning flow and verify carried-forward table choices, waitlists, and roles. Historical selection follows the GM policy. |
| Final manifest is missing at game time | Finalization operation failed or the channel lost Send Messages/Embed Links | Restore the permission, inspect `/week status`, then retry only `finalize`. Repeated finalization must reconcile the stored message rather than create a duplicate. |
| D1 operation fails | Binding, migration, quota, or transient service problem | Do not infer state from Discord. Verify binding/migration, restore service, inspect the operation record, and retry the exact step. Take a D1 backup before manual repair. |
| Raid Helper is unavailable | Independent vendor/service issue | Continue the native Guild Assistant week, including its own private export if one is wanted. No lifecycle step or retry depends on Raid Helper. |

### Recovery sequence for partial operations

1. Stop automatic repetition if it could notify people: disable the affected reminder or select `/guild automation mode:paused confirm:true`.
2. Capture sanitized `/week status`, `/guild doctor`, and structured log identifiers.
3. Identify the last successful D1 phase/operation and whether a Discord message ID exists.
4. Correct configuration, permission, hierarchy, or service availability.
5. Retry exactly one supported step. Check status and Discord before another retry.
6. For role work, dry-run before applying. For reminders, distinguish retry from intentional resend.
7. Use manual D1 repair only as a last resort after a backup and peer review. Record the reason and before/after identifiers in the audit log.

An archived week should not be reopened by database editing. If correction is essential, implement/use an explicit audited reopen/supersede flow; otherwise create the next week and document the exception.

## Backup, deployment, and credential recovery

- Take a D1 export before destructive repair, retention purge, or migration. Test restore against a non-production database.
- Deploy migrations and Worker code from the organization repository. Verify typecheck/tests, migration status, command registration, health, and `/guild doctor`.
- Configure a GitHub environment named `discord-command-registration` with required maintainer review and store `DISCORD_BOT_TOKEN` as its environment secret. The command-registration workflow cannot access that token until the environment protection rules pass.
- Rotate a compromised Discord token immediately in the Developer Portal, update Cloudflare/GitHub secrets, redeploy if required, and invalidate any local copy. Never paste the old/new token into logs or issues.
- A public-key rotation requires updating the Discord application and Cloudflare secret together; test endpoint validation afterward.
- Maintain at least two owners for the Discord app, Cloudflare account, GitHub organization, and recovery-factor storage.

## Data retention and deletion

Guild IDs, user IDs, display names, attendance intent, assignments, and reminder recipients are member-identifying operational data. Use them only for the weekly workflow, rotation explanation, recovery, and guild-requested export.

The operational policy is:

| Data | Retention target after event | Reason |
| --- | ---: | --- |
| Signups, plans, assignments, and GM selection history | 13 months | One rolling year of weekly recovery and explainable GM rotation |
| Audit metadata and published revision identifiers | 13 months | Resolve disputes and retries without retaining message bodies |
| Reminder delivery content and failure text | 30 days | Short-term retry/incident diagnosis |
| Session attendance/completion, reward grants, credits, and seating decisions | 13 months | Resolve reward and displacement disputes without rewriting history |
| DM priority outbox content and sanitized failure state | 30 days | Short-term delivery recovery; token state does not depend on message retention |
| Completed operation request/result payloads | 90 days | Idempotency and operational recovery |
| Released role leases | 90 days | Prove role ownership during repair |
| Cloudflare logs | Shortest practical operator setting, at most 30 days for MVP | Diagnose service failures; never intentionally log secrets or full member content |

Guild configuration remains while the bot is installed and for a documented
recovery window after removal. Files downloaded with `/week export`, Raid
Helper exports, and any external spreadsheets are controlled by guild admins
outside this database. Minimize copies, restrict their access, and delete them
according to guild policy when their portability/backup purpose ends.

These limits are not yet enforced by a self-service purge/deletion command.
Until automated retention lands, the service maintainer must review retention
at least quarterly and use a tested, tenant-scoped procedure. Do not run ad hoc
broad SQL against production.

For a guild deletion request:

1. authenticate an authorized guild owner/admin through a second channel;
2. disable scheduling/reminders for that guild;
3. offer the private `/week export` where appropriate and state what D1 backups contain;
4. verify the exact guild ID and take a recovery backup;
5. delete the one `guild_config` tenant root in a transaction so foreign-key cascades remove its events and operational rows;
6. verify queries for that guild return no rows, record non-identifying completion evidence, and allow backups to expire on schedule.

For an individual member request, use a reviewed transaction scoped by both guild ID and user ID. Remove or pseudonymize signup, assignment, GM-selection, role-lease, and actor identifiers as policy permits; explain that deletion resets the information available to GM rotation. Never target a user ID globally without confirming every guild scope.

## Maintainer handoff checklist

- Transfer organization-owned access for Discord, Cloudflare, GitHub, and recovery factors.
- Review current guild configuration, D1 database/binding, Cron Trigger, command manifest, required secrets, and last successful weekly cycle.
- Demonstrate backup/restore in non-production, token rotation, `/guild doctor`, one retry, reminder disablement, and role dry run.
- Hand over the retention calendar and any pending failed operations without exporting unnecessary member data.
- Confirm the successor can pause automation and, if desired, return to Raid Helper using the ADR rollback path without assuming personal hosting costs or a Google integration.
