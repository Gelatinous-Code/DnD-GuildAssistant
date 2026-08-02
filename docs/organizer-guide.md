# Weekly organizer guide

This guide is for the people who run game night. Every command on this page is
entered in Discord. You do not need Node.js, npm, Cloudflare, or access to the
source code.

If the bot has never answered `/ping`, stop here and contact the deployer. If it
answers but the server has not been configured, use
[Discord server setup](guild-setup.md) first.

## The normal week

In Review mode, most of the week is automatic and one decision remains yours:

1. The bot opens GM signup, then player signup.
2. At table-planning time, it locks the signup snapshot and prepares a private
   draft.
3. Run `/week status`. Check the selected GMs, table sizes, reserved players,
   and global waitlist.
4. If the draft is sound, run `/week publish`.
5. The bot handles table choices, open seating, the final roster, and archive.

In Autopilot, step 4 is automatic too. Keep the guild in Review until the
organizers trust a complete live week.

## Your three regular checks

| Discord command | Question it answers |
| --- | --- |
| `/guild status` | Is the server configured, and which automation mode is active? |
| `/week status` | Where is this week's event, and does anything need attention? |
| `/guild doctor` | Can the bot still see its channel and use the enabled permissions and roles? |

These responses are private. Run `/week status` before manually changing a week;
it is safer than guessing from an old Discord message.

## Before publishing tables

Review the draft for:

- enough GMs for the player count;
- sensible table capacities;
- the expected GM rotation result;
- players marked reserved versus global-waitlist; and
- any warning or failed operation.

If one table needs a different name, capacity, or eligible GM, use
`/week override` and include a short reason. Run `/week status` again, then
publish. Repeating `/week publish` after a timeout is safe; the bot reconciles
the stored publication instead of treating the retry as a new set of tables.

## After game night

For each table:

1. Run `/session status`.
2. Record only differences from the published roster with
   `/session attendance`—for example a no-show, substitute, or walk-in.
3. Run `/session status` again and review the private draft.
4. Run `/session confirm` and choose **Completed** or **Cancelled**.

A completed eligible DM session awards exactly two priority tokens. Publication
or archive alone does not award them. Use the
[DM priority operations runbook](dm-priority-operations.md) for corrections,
blocked DMs, disputes, or exceptional refunds.

## When plans change

- Member changes before publication: ask the member to use the newest signup
  post, or use `/week signup` for an audited correction.
- Member changes after publication: use `/week signup`, then review the new plan
  and table choices before republishing.
- The entire event will not happen: use `/week cancel` with a clear reason.
- A single scheduled action should not happen: use `/week skip` for that
  occurrence.

Do not edit bot messages or database records to repair the roster.

## Stop automation safely

If timing, permissions, or messages look wrong, run:

```text
/guild automation mode:Paused confirm:True
```

Paused mode stops scheduled phase changes but leaves organizer commands
available. Then run `/week status` and `/guild doctor`. If the fix needs
Cloudflare, logs, secrets, or a database, hand the incident to the service
maintainer with the event ID and error wording—never with private tokens or
member message contents.

## Optional features

Reminders and the temporary Weekly GM role are not required for the weekly
workflow. Add them only after the basic week works:

- `/reminder configure` saves a reminder and privately previews it.
- `/roles sync dry_run:True` previews role changes without applying them.

Use [Discord server setup](guild-setup.md) for permissions and role order. Use
the [Discord command reference](discord-command-reference.md) when you need an
advanced lifecycle or recovery command.
