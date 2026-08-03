# ADR 0002: Export and external spreadsheet boundary

- Status: Accepted
- Date: 2026-08-01
- Scope: Native lifecycle, portability, and backup

## Context

The guild historically downloaded a weekly CSV and imported it into Google
Sheets to manage players at tables. That handoff was useful when a separate bot
did not own the complete workflow, but it also added weekly maintenance and
created an external copy of member-identifying data.

Guild Assistant now owns the operational path from native GM/player intent
through deterministic planning, publication, player table choice and waitlists,
game-time finalization, a final Discord manifest, and archive. Requiring a
spreadsheet or Google integration for that path would add
credentials, ownership, failure modes, and succession burden without improving
the authoritative state.

## Decision

D1 is the authoritative state for every Guild Assistant-managed week. Discord
messages and controls are member-facing projections of that state. The core
lifecycle neither reads nor writes Google Sheets and requires no Google API
credential, service account, OAuth grant, Drive permission, or guild-owned
spreadsheet.

`/week export` is an optional administrative boundary:

- only a member with Manage Guild or Administrator can invoke it;
- the response and attachment are private to that admin;
- the active/latest event is used by default, or the admin may select an event
  ID belonging to the same guild;
- formula-like cell values are neutralized before serialization;
- the CSV has a versioned schema and is capped at 2,000 rows and 512 KiB;
- it is generated in memory and attached only to the private Discord response;
  Guild Assistant does not persist a copy in D1 or send it to Google or another
  storage integration; and
- the audit record contains export metadata, not a second authoritative roster.

The export is for portability, an offline snapshot, migration, or
guild-directed ad hoc analysis. A downloaded CSV or a spreadsheet created from
it is a copy. Editing that copy does not update D1, and the core workflow never
waits for a spreadsheet handoff.

## Security, privacy, and retention

Discord tenant authorization and the requested event's guild ID are checked
before generating the attachment. Attach Files is required only in the channel
where the command is invoked. The attachment must not be reposted to a public
channel.

Exported rows can contain Discord IDs, display names, attendance intent, table
assignments, and waitlist state. Guild admins control downloaded files and any
external Sheets. They should minimize copies, restrict access, and delete each
copy when its portability or backup purpose ends. The service-side retention and
deletion rules remain those in the [operations guide](../operations.md).

A CSV snapshot is not a substitute for a D1 backup. Maintainers take and test D1
exports before destructive repair, migration, or tenant deletion because only
D1 contains the full workflow, operation, and audit state.

## Consequences

The normal weekly process has no Google cost, account, credential, or successor
ownership requirement. It also has no live spreadsheet synchronization or
spreadsheet-to-D1 import; admins make operational corrections through audited
Discord commands so the source of truth remains unambiguous.

A future external adapter is possible only as an explicit, documented,
versioned, tenant-scoped, and optional integration. It must not become a
dependency of native signups, planning, table choice, finalization, role
reconciliation, archive, or export.

Raid Helper may coexist during a pilot or continue to own unrelated events, as
described in [ADR 0001](0001-raid-helper-boundary.md). Neither Raid Helper nor
Google Sheets is required for Guild Assistant's CSV export or native lifecycle.
