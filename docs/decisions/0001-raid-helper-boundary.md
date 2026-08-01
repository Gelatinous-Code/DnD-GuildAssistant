# ADR 0001: Raid Helper coexistence and data boundary

- Status: Accepted
- Date: 2026-08-01
- Scope: M1–M3 MVP

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
| Existing spreadsheet handoff | Raid Helper's documented CSV export may remain a manual fallback | The MVP neither scrapes nor automatically imports it. One-click Guild Assistant export and Sheet sync belong to M4. |
| Other Raid Helper events/features | Raid Helper | No dependency or behavioral assumption is introduced. |

At this decision's acceptance date, no supported Raid Helper API, webhook, or machine-readable signup surface has been adopted. A future integration may consume a vendor-documented API or an administrator-supplied documented export, but it must be explicit, versioned, tenant-scoped, and optional. Native signup must continue to work when that integration is unavailable.

The representative input in `test/fixtures/sanitized-week.json` is fully synthetic. It models native signups and expected planning state; it contains no production guild or member identifiers.

## Weekly timeline

Times are evaluated in the configured IANA time zone. Defaults are shown; each guild may change them.

1. **T-7 days — create/open:** the scheduler creates the weekly event and publishes Guild Assistant's native GM/player signup controls. Repeated cron delivery uses the same event/operation key and must not duplicate the event or message.
2. **While open — collect:** members choose GM, player, or withdraw. A later choice replaces that member's earlier active choice instead of creating a duplicate. Configured reminders may mention only explicitly allowed roles.
3. **T-24 hours — lock:** the scheduler locks the signup snapshot. Late changes require an administrator decision; they do not silently change a draft or published plan.
4. **After lock — plan/review:** deterministic GM priority and table sizing produce a persisted draft. An authorized admin previews, regenerates after an intentional correction, or records a manual override.
5. **Publish:** an explicit admin action publishes one revision. Players may select, change, or leave a table; capacity and waitlist order remain authoritative in D1.
6. **Before play — reconcile/remind:** weekly roles are reconciled from current event state, and due reminders are claimed idempotently before Discord delivery.
7. **After play — archive:** the week becomes read-only operational history. Raid Helper CSV remains available as the manual spreadsheet fallback until Guild Assistant's M4 export is complete.

## Permissions and dependencies

Required platform dependencies are a Discord application/bot, a Cloudflare Worker, D1, and a Cron Trigger. Required secrets are the Discord public key for request verification and the bot token for Discord REST calls. Raid Helper credentials, cookies, tokens, and administrative access are neither required nor accepted.

Least privilege is feature-specific:

- Native signups and publication require View Channels, Send Messages, Embed Links, and Read Message History in the configured channels.
- Attach Files is optional until a Guild Assistant export is enabled.
- Weekly role automation requires Manage Roles and places the bot's highest role above every configured managed role. The bot does not require Administrator.
- A reminder can notify a role only when that role was explicitly configured and Discord permits the bot to mention it. `@everyone` and `@here` are always excluded.
- Setup, planning overrides, publication, repair, and sensitive status output require Discord Administrator/Manage Guild or the configured admin role.

## Failure behavior

- If Raid Helper is unavailable, nothing in the native weekly flow is blocked. Its manual CSV fallback is simply unavailable until Raid Helper recovers.
- If Guild Assistant cannot reach Discord, D1 retains the intended transition and failed operation. An admin checks status before retrying; idempotency prevents a retry from creating a second transition or known message.
- If D1 is unavailable, the bot must not infer state by parsing Discord messages. It returns a recoverable error and performs no publication or role removal.
- Deleted channels/roles, missing permissions, and role-hierarchy failures are reported by `/guild doctor`; unrelated member roles remain untouched.
- A bad or missing interaction signature is rejected before any state change.
- Duplicate cron events and component retries reuse stable keys. They return or reconcile the existing result rather than append duplicate signups, plans, reminders, or role grants.

## Migration and rollback

Adoption is deliberately reversible:

1. **Configure and shadow:** install Guild Assistant in a test channel, run `/guild doctor`, and complete a synthetic week. Raid Helper remains unchanged.
2. **Pilot native intent:** for one real week, label Guild Assistant's GM/player signup as authoritative. Raid Helper's gaming-interest poll and CSV process continue.
3. **Validate:** compare locked counts, selected GMs, published tables, and the manual spreadsheet record. Correct only through audited admin actions.
4. **Expand:** after a successful cycle, stop publishing duplicate GM/player polls. Keep the lifetime Raid Helper subscription and any unrelated events.
5. **Optional later integration:** add only a documented API/export adapter behind the same D1 boundary. Imported rows must record their source and never bypass validation.

To roll back, disable Guild Assistant scheduling and reminders, archive or cancel its open week, run a role-sync dry run and release only active Guild Assistant role leases, then resume Raid Helper GM/player polls. Preserve the archived D1 week until the guild confirms its spreadsheet and attendance record. No Raid Helper configuration must be reconstructed because Guild Assistant never mutates it.

## Consequences

The guild temporarily has two capable products, but there is one source of truth per managed workflow. The choice avoids brittle coupling and preserves the value of the paid lifetime subscription. It also means automatic ingestion of existing Raid Helper signups is intentionally out of scope until a supported contract is available; admins must direct members to the native signup for a Guild Assistant-managed week.
