# Session completion and attendance policy

Publishing, finalizing, or archiving a weekly roster proves what the guild
planned. None of those actions prove that a game actually ran, and none award a
DM priority token. Rewards begin only when authorized guild staff explicitly
confirm an archived table's actual outcome through `/session`.

## Source boundary

A completion is accepted only when all of these records belong to the invoking
guild:

- an archived weekly event whose scheduled end has passed;
- its published and finalized plan revision;
- a table from that plan; and
- the final table-state revision captured by the archived manifest.

The final plan, table, assignment, and manifest rows remain immutable. Actual
attendance is stored as a separate append-only outcome linked to that source.
The archive scheduler never calls the reward service.

## Organizer workflow

1. Run `/session status table_number:…` to seed or inspect a private working
   draft. The planned DM and assigned players initially default to `attended`.
2. Record only deviations with `/session attendance`: no-shows, substitutes,
   walk-ins, or an explicitly attended replacement DM/player. A substitute must
   identify the planned member they replace.
3. Review status. Attendance is never posted to the public operations or table
   channel.
4. Run `/session confirm result:Completed confirm:True` or
   `/session confirm result:Cancelled confirm:True`.

A completed table must contain exactly one actual attending DM. Player
attendance does not affect reward eligibility. A cancelled table or a planned DM
who did not run the game earns nothing; an explicitly recorded substitute DM
earns the reward.

One eligible confirmed session awards exactly two DM priority tokens under
`dm-priority-v1`. The persisted confirmation time—not a retry time—determines
the tokens' earned and expiration boundaries.

## Retries and corrections

Confirmation uses the session and draft revision as its idempotency boundary.
Repeating an unchanged confirmation returns the same revision and cannot award
four tokens. If reward delivery is interrupted after the completion revision is
saved, scheduled reconciliation uses that same revision and timestamp to finish
the grant exactly once.

Editing a confirmed outcome creates a new draft from the current immutable
revision. A correction requires a concise reason and appends a new revision:

- attendance-only correction with the same actual DM retains the original
  grant and expiration;
- changing the actual DM corrects the old grant and awards exactly two new
  tokens to the replacement DM at the correction confirmation time; and
- correcting a table to cancelled or DM no-show corrects the active grant and
  creates no replacement.

Corrected credits and any historical redemption remain in the audit trail. The
assistant does not create negative token debt or silently rewrite a past seat.

## Privacy and retention

Session drafts, participant outcomes, actor IDs, reasons, and reward-sync state
are guild-scoped operational data. They are visible only in ephemeral authorized
commands and sanitized administrator diagnostics. Public rosters and ordinary
weekly exports contain the planned/final roster, not actual attendance or a
member's lifetime reward history.

Store Discord user IDs, role/outcome codes, replacement links, bounded audit
reasons, and timestamps. Do not store free-form player notes. Session outcome
data is retained for reward disputes while the guild remains configured and is
removed through the same tenant-cascade/deletion procedure documented in the
operations guide.
