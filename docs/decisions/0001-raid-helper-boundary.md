# ADR 0001: Raid Helper coexistence and data boundary

- Status: Accepted
- Date: 2026-08-01
- Scope: Native weekly workflow

## Context

New Dawn already owns a lifetime Raid Helper subscription. Its gaming-interest poll and existing event/export workflow are useful, but the guild currently spends time turning GM and player intent into weekly tables and coaxing temporary roles into the correct state. Guild Assistant must remove that maintenance without making Raid Helper an undocumented runtime dependency.

Discord does not expose another application's button interactions or private state to this application. A message that visually contains Raid Helper signups is not a supported integration contract. Scraping its web UI, calling private endpoints, impersonating a user, or interpreting another bot's component identifiers would be fragile and unsafe.

## Decision

Guild Assistant's native Discord signup controls and D1 records are authoritative for every week managed by Guild Assistant. The bot reads its own interaction payloads and persists each GM/player choice in D1. Table planning, assignments, role reconciliation, reminders, and audit history derive only from that state.

Raid Helper remains supported alongside Guild Assistant:

| Capability | Owner during the MVP | Boundary |
| --- | --- | --- |
| Broad “who wants to game?” interest poll | Raid Helper may continue | Informational only; Guild Assistant does not scrape it. |
| GM and player intent used for automatic planning | Guild Assistant native signup | D1 is authoritative. Running a duplicate Raid Helper poll does not synchronize it. |
| Table sizing, GM rotation, draft, publication, and table choice | Guild Assistant | Derived from the locked native signup snapshot. |
| Weekly GM role and role-aware reminders | Guild Assistant | Only configured resources and roles leased by Guild Assistant are changed. |
| Portable roster snapshot | Guild Assistant `/week export` | Private, admin-only, formula-safe CSV for portability/backup; it is not a source of truth or a required weekly step. |
| External spreadsheets | Guild admins, optionally | Outside the core workflow. Guild Assistant requires no Google credentials and performs no automatic Sheet synchronization. |
| Other Raid Helper events/features | Raid Helper | No dependency or behavioral assumption is introduced. |

At this decision's acceptance date, no supported Raid Helper API, webhook, or machine-readable signup surface has been adopted. A future integration may consume a vendor-documented API or an administrator-supplied documented export, but it must be explicit, versioned, tenant-scoped, and optional. Native signup must continue to work when that integration is unavailable.

The representative input in `test/fixtures/sanitized-week.json` is fully synthetic. It models native signups and expected planning state; it contains no production guild or member identifiers.

## Weekly timeline

Times are evaluated in the configured IANA time zone. Defaults are shown; each guild may change them.

1. **Wednesday 17:00 — GM signup:** the scheduler creates the week and opens GM volunteering. Repeated Cron delivery uses the same event and operation keys.
2. **Thursday 17:00 — player interest:** the Play button opens. A later GM/player choice replaces the member's earlier active choice instead of creating a duplicate.
3. **Saturday 17:00 — tables:** signup order is snapshotted, deterministic GM priority and sizing create tables, and total capacity divides players into reserved and global-waitlist rosters. Review mode waits for `/week publish`; Autopilot publishes immediately.
4. **Saturday through Monday — reserved selection:** reserved players choose any table with room. Leaving a table clears only that choice. Withdrawing drops the player from the week; before open seating, the first global-waitlist player inherits the reservation and receives a durable private notification.
5. **Monday 17:00 — open seating:** signup-order protection ends. Any active player may claim remaining capacity first-come, first-served. A player who never chose a table is not penalized.
6. **Tuesday 18:00 — finalize:** table controls close and the scheduler posts the final manifest. Drops are accepted until this boundary.
7. **Tuesday 18:00–21:00 — play:** New Dawn's in-person games run for three hours; other guilds may configure another duration.
8. **After play — archive:** the week becomes read-only operational history and assistant-owned role leases are released. No CSV or spreadsheet handoff is required.

## Permissions and dependencies

Required platform dependencies are a Discord application/bot, a Cloudflare
Worker, D1, and a Cron Trigger. Required secrets are the Discord public key for
request verification and the bot token for Discord REST calls. Raid Helper and
Google credentials, cookies, tokens, service accounts, and administrative access
are neither required nor accepted.

Least privilege is feature-specific:

- Native signups and publication require View Channels, Send Messages, Embed Links, and Read Message History in the configured channels.
- Attach Files is optional and needed only in a channel where an admin invokes `/week export`.
- Weekly role automation requires Manage Roles and places the bot's highest role above every configured managed role. The bot does not require Administrator.
- A reminder can notify a role only when that role was explicitly configured and Discord permits the bot to mention it. `@everyone` and `@here` are always excluded.
- Setup, planning overrides, publication, export, repair, and sensitive status output require Discord Administrator or Manage Guild.

## Failure behavior

- If Raid Helper is unavailable, nothing in the native weekly flow or Guild Assistant's private CSV export is blocked.
- If Guild Assistant cannot reach Discord, D1 retains the intended transition and failed operation. An admin checks status before retrying; idempotency prevents a retry from creating a second transition or known message.
- If D1 is unavailable, the bot must not infer state by parsing Discord messages. It returns a recoverable error and performs no publication or role removal.
- Deleted channels/roles, missing permissions, and role-hierarchy failures are reported by `/guild doctor`; unrelated member roles remain untouched.
- A bad or missing interaction signature is rejected before any state change.
- Duplicate cron events and component retries reuse stable keys. They return or reconcile the existing result rather than append duplicate signups, plans, reminders, or role grants.

## Migration and rollback

Adoption is deliberately reversible:

1. **Configure and shadow:** install Guild Assistant in a test channel, run `/guild doctor`, and complete a synthetic week. Raid Helper remains unchanged.
2. **Pilot native intent:** for one real week, label Guild Assistant's GM/player signup as authoritative. Raid Helper's broad gaming-interest poll may continue, and a duplicate legacy event may be retained only for comparison.
3. **Validate:** compare locked counts, selected GMs, published tables, player choices, and the final manifest with D1 status. An optional private export can support offline review, but corrections happen only through audited admin actions.
4. **Expand:** after a successful cycle, stop publishing duplicate GM/player polls. Keep the lifetime Raid Helper subscription and any unrelated events.
5. **Optional later integration:** add only a documented API/export adapter behind the same D1 boundary. Imported rows must record their source and never bypass validation.

To roll back, select paused automation, disable reminders, archive or cancel the
open week, run a role-sync dry run and release only active Guild Assistant role
leases, then resume Raid Helper GM/player polls. Preserve the archived D1 week
until the guild confirms its attendance record or retention decision. No Raid
Helper configuration must be reconstructed because Guild Assistant never
mutates it.

## Consequences

The guild may temporarily have two capable products, but there is one source of
truth per managed workflow. The choice avoids brittle coupling and preserves the
value of the paid lifetime subscription. It also means automatic ingestion of
existing Raid Helper signups is intentionally out of scope until a supported
contract is available; admins must direct members to the native signup for a
Guild Assistant-managed week.

The private CSV snapshot is deliberately a portability boundary rather than a
spreadsheet integration. D1 and Discord ownership are recorded in
[ADR 0002](0002-export-boundary.md).
