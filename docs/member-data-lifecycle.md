# Member data export and departure lifecycle

Guild Assistant is authoritative for member characters, player-authored
journals, official recaps, progression, in-game shop receipts, attendance, and
DM priority history. Routine privacy work uses Discord administrator tools; the
website and operators never receive raw D1 access.

## Available administrator export

All `/member-data` responses and attachments are private and require Discord
**Manage Server** permission. The Worker also verifies that the selected user is
a current member of the interaction's guild.

1. Run `/member-data preview member:... action:Export`.
2. Review the per-class record counts and copy the complete 64-character
   revision.
3. Run `/member-data export member:... revision:...` in a channel where the bot
   has **Attach Files**.
4. Download the JSON attachment. Record the operation ID shown with it.
5. If Discord rejects the attachment, correct **Attach Files** and run
   `/member-data retry operation:...`. Use `/member-data status operation:...`
   to check a prior attempt without revealing its content.

The revision is SHA-256 over the bounded, guild-and-member-scoped snapshot. Any
change after preview rejects the export; create a fresh preview instead of
overriding the guard. Each command interaction claims one operation key. A
duplicate interaction does not generate a second delivery, while a failed
delivery can reclaim the original operation and revision exactly once.

The attachment uses `member-data-export.v1`, is limited to 500 rows per
collection and 512 KiB total, and contains no bot token, cookie, raw SQL, or raw
database dump. Audit rows record actor, subject, schema/policy version, revision,
record count, byte length, filename, result, and an error *kind*. They never
record attachment content, journal or recap text, sheet URLs, or exception
messages.

This workflow requires no new D1 tables: it uses the existing operation lease
and audit log. That keeps automatic Discord command registration on merge from
depending on a separately deployed migration.

## Version 1 treatment

| Data class | Export | Confirmed departure or deletion |
| --- | --- | --- |
| Weekly signup and table presentation | Include the member's records | Pseudonymize optional display presentation while preserving table history |
| Characters and character events | Include current state and history | Archive characters and remove personal sheet links; preserve campaign identity and audit history |
| Player-authored journals | Include current content and revision history | Hide immediately, then replace authored presentation with a deletion tombstone after explicit confirmation; retain the minimum audit facts |
| Official GM recaps | Include recaps authored by the member | Preserve shared guild campaign history; use existing moderation and correction controls |
| Seasonal XP and in-game gold | Include balances, openings, entries, reversals, and provenance | Preserve append-only entries and season history; never fabricate or silently delete a balance explanation |
| In-game shop receipts | Include receipts, line items, and reversal state | Preserve receipts and corrections because they explain character gold; this is not real-money commerce |
| Attendance and DM priority | Include participation, grants, tokens, and token events | Close future entitlements while preserving grants, redemption, attendance, and correction history |

Machine-readable boundaries:

- [`member-data-inventory.v1`](../contracts/member-data-inventory.v1.json)
- [`member-data-export.v1`](../contracts/member-data-export.v1.json)
- [`member-data-operation-status.v1`](../contracts/member-data-operation-status.v1.json)

Changing a treatment requires a new policy version and an explicit migration or
correction policy; it cannot silently reinterpret earlier completed operations.

## Website boundary

The future authenticated website integration may receive only the safe status
contract: operation ID, schema/policy version, subject ID, revision, counts,
timestamps, result, and failure kind. It may not receive attachment content,
URLs, authored text, reasons, request JSON, exception messages, or D1 access.
The website transport remains deferred until the M8 service-authentication and
administrator-authorization boundary is available.

## Departure remains deferred

`/member-data preview action:Departure` remains a dry run. It inventories the
same snapshot and shows the conservative treatment, but does not revoke access,
archive a character, hide content, pseudonymize presentation, or start deletion.

The next destructive slice must add local access denial, character archive,
entitlement closure, presentation pseudonymization, and journal tombstones. It
must not register an execution command until preview, reason, explicit
confirmation, expected revision, partial-failure recovery, retry, and
audit-redaction tests pass.
