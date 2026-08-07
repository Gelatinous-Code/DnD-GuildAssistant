# Character progression ledger

Progression is tracked per approved character. Opening XP and gold from character approval form the immutable starting balance; every later change is an append-only ledger entry.

## Session policy

Gold is calculated from the reward character's level immediately before the award:

| Level | XP | Gold per game |
| --- | --- | ---: |
| 3 | 0–2 | 50 |
| 4 | 3–6 | 100 |
| 5 | 7–11 | 200 |
| 6 | 12–17 | 300 |
| 7 | 18–24 | 400 |
| 8 | 25–32 | 600 |
| 9 | 33–41 | 800 |
| 10 | 42+ | 1,000 |

- Every active player—including substitutes and walk-ins—receives 1 XP and the level-based gold award.
- The actual DM receives 2 XP and the normal level-based gold award. A substitute DM is the actual DM and receives the same double XP.
- No-shows and cancelled tables receive no progression.
- A player's selected frozen character routes its award to their main character.
- A DM defaults to their main character and may select another approved, active character they own. A frozen character cannot receive a DM award.

Award insertion calculates the pre-award balance, level, and gold within one D1 statement. The completion revision, participant role, policy version, and pre-award values are retained for auditability.

## Member commands

- `/progression balance` privately shows every approved character's current level, XP, and gold.
- `/progression select` records the character used for an ended, archived table before its rewards synchronize. The latest archived event is used unless an event ID is supplied.

If no selection is recorded, the member's main character is used. This preserves the simple path for members who have one character.

## Administrator commands

- `/progression-admin target` records a member's pre-synchronization character selection with a required reason.
- `/progression-admin adjust` appends a signed XP and/or gold correction. The command requires a reason and confirmation and refuses to make the selected balance negative. Supply `season_id` only for a documented late correction to a historical season.
- `/progression-admin history` privately displays recent awards, reversals, and adjustments.

Correcting a completed session to cancelled—or replacing it with a new completion revision—automatically appends exact reversals for the prior revision. Retrying reconciliation cannot duplicate an award or reversal.

Season reset policy, backup, recovery, and historical reads are documented in [progression seasons and rollover](progression-seasons.md).
