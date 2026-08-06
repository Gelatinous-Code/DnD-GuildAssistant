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
   per-tier reservations and waitlists.
4. If the draft is sound, run `/week publish`.
5. The bot creates each table thread, privately links its DM, then handles table choices, open seating, the final roster, and archive.

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
- the expected GM and player counts in each tier;
- sensible table capacities;
- the expected GM rotation result;
- players marked reserved versus waitlisted in each tier; and
- any warning or failed operation.

If one table needs a different name, capacity, or eligible GM, use
`/week override` and include a short reason. Run `/week status` again, then
publish. Repeating `/week publish` after a timeout is safe; the bot reconciles
the stored publication instead of treating the retry as a new set of tables.

## After game night

Finalized tables are completed automatically after the archived event ends. For exceptions and corrections:

1. Run `/session status` for the affected table.
2. Record differences from the published roster with `/session attendance`—for example a no-show, substitute, or walk-in.
3. Run `/session confirm` and choose **Completed** or **Cancelled**. A later confirmation appends a correction instead of rewriting history.

An automatically or manually completed eligible DM session awards exactly two priority tokens, 2 XP, and level-based gold. Players who attended receive 1 XP and level-based gold. After administrators approve an incentive and configure its version, the actual DM receives a private session-summary form; see [session summaries](session-summaries.md). Use `/recap-admin status` and the confirmed `/recap-admin manage` controls for delivery repair, edit locks, visibility, and public corrections. Use the
[DM priority operations runbook](dm-priority-operations.md) for corrections,
blocked DMs, disputes, or exceptional refunds.

## When plans change

- Member changes before publication: ask the member to use the newest signup
  post, or use `/week signup` for an audited correction.
- Member changes after publication: use `/week signup`, then review the new plan
  and table choices before republishing.
- The entire event will not happen: use `/week cancel reason:... confirm:True`. The confirmation is required because this stops the active week. If the cancellation was premature, `/week restart confirm:True` can clear its unfinished work and reopen fresh signup posts.
- A single scheduled action should not happen: use `/week skip` for that
  occurrence.

Use `/table-thread-admin status` and the confirmed manage action to retry, recreate/redirect, or cancel a broken table thread. Do not edit bot messages or database records to repair the roster.

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

Role-mention reminders are not required for the weekly workflow. Add them only
after the basic week works:

- `/reminder configure` saves a reminder and privately previews it.
- Member roles remain an admin task; the assistant never assigns or removes them.

Use [Discord server setup](guild-setup.md) for permissions. Use
the [Discord command reference](discord-command-reference.md) when you need an
advanced lifecycle or recovery command.
