# Discord command reference

Every command on this page is entered in Discord. Discord shows the available
fields after you choose a command. Commands and responses that expose
configuration, attendance, or operational details are private.

## Everyone

| Command | Purpose |
| --- | --- |
| `/help` | Show a private plain-language guide for playing, GMing, priority tokens, or organizing. |
| `/ping` | Check whether the bot is responding. |
| `/recap pending` | Privately show fallback buttons for session recaps still awaiting you. |
| `/priority status` | Show your own available DM priority tokens. |
| `/priority use` | Preview and confirm priority at one published table. |
| `/priority release` | Stop using a reserved token while keeping your ordinary table request. |

Weekly signup and table selection use buttons on the bot's messages, not slash
commands.

## Server setup and health

These require **Manage Server**.

| Command | Purpose |
| --- | --- |
| `/guild setup preset:Second Dawn Guild` | Discover Second Dawn's existing GM/player channels and permanent audience roles in one step. |
| `/guild setup` | Show the setup dashboard or change only the fields supplied; other guilds retain the generic one-channel setup. |
| `/guild automation` | Choose Paused, Review, or Autopilot and optional reminders. |
| `/guild status` | Show saved settings, automation mode, and the current week. |
| `/guild doctor` | Show the Worker command-schema version and check every configured channel, permission, and notification role. |

## Weekly event

These require **Manage Server**.

| Command | Purpose |
| --- | --- |
| `/week status` | Show the active phase, signup counts, plan, waitlists, and recent operation results. |
| `/week open` | Manually open the next scheduled week or a specifically dated test event; if that occurrence was cancelled, the bot explains how to restart it. |
| `/week restart confirm:True` | Clear an unfinished cancelled occurrence and reopen fresh signup posts for the same game time. Weeks with finalized sessions or active priority-token history cannot be restarted. |
| `/week signup` | Record an audited late signup, withdrawal, or organizer correction. |
| `/week lock` | Manually close signup changes for planning. |
| `/week plan` | Generate or regenerate the deterministic private draft. |
| `/week override` | Change one draft table's name, capacity, or active eligible GM with a reason. |
| `/week publish` | Publish or safely reconcile the current reviewed draft. |
| `/week export` | Download a private CSV snapshot for portability or backup. |
| `/week retry` | Retry one failed open, lock, publish, reminder, or final-roster action. |
| `/week skip` | Record that one scheduled occurrence should be skipped. |
| `/week cancel reason:... confirm:True` | Stop and cancel the active week. Both an audit reason and explicit confirmation are required. An unfinished cancelled occurrence can later be redone with `/week restart confirm:True`. |
| `/week archive` | Close the completed week and finalize its audit history. |

For `/week signup`, **GM** and **Player** corrections require **Tier 1**, **Tier
2**, or **Tier 3**. **Backup GM** records emergency coverage without adding a
planned table; **Withdraw** removes the member from the week. See
[Weekly game tiers](game-tiers.md).
A member may be both a **Player** and a **Backup GM** for the same week. Adding
backup availability keeps the player's tier and original signup position.
The GM and player signup cards withdraw those commitments independently, so a
member can stop being a backup without losing their player signup, or stop
playing while remaining available as a backup. A **primary GM** cannot also be
a player; they must withdraw the conflicting commitment first. An organizer
can still make a direct audited correction with `/week signup`.


## Attendance and DM rewards

These require **Manage Server**.

| Command | Purpose |
| --- | --- |
| `/session status` | Review the private attendance draft and reward state for a table. |
| `/session attendance` | Record a no-show, substitute, walk-in, or other difference from the published roster. |
| `/session confirm` | Override or correct the automatic completed result with an audited completed/cancelled revision and reconcile rewards. |
| `/priority-admin diagnose` | Privately trace token, seating, completion, and message-delivery state. |
| `/priority-admin correct` | Append a confirmed correction to an incorrect reward grant. |
| `/priority-admin refund` | Make an exceptional confirmed token refund. |
| `/priority-admin configure` | Set or disable the private pre-expiration reminder. |
| `/table-thread-admin status` | Inspect one published table's thread, DM revision, retry, and error state. |
| `/table-thread-admin manage` | With confirmation and a reason, retry, recreate/redirect, or cancel a table-thread workflow. |
| `/recap-admin status` | Inspect recap delivery, qualification, visibility, edit-lock, and audit state. |
| `/recap-admin manage` | With confirmation and a reason, retry delivery, lock/reopen edits, hide/unhide, or append a public correction. |

## Optional notifications

These require **Manage Server**.

| Command | Purpose |
| --- | --- |
| `/guild setup gm_notification_role:@GM` | Mention the chosen role once when GM signup opens. |
| `/guild setup reminder_role:@Guild Player` | Choose the player audience used by signup reminders. |
| `/guild setup admin_role:@Administrator` | Choose the organizer audience for capacity-risk alerts. |
| `/reminder configure` | Save or disable the reminder rule and show a private preview. |
| `/reminder send` | Send the configured reminder now; a deliberate duplicate requires confirmation. |

For the ordinary operating sequence, use the [organizer guide](organizer-guide.md).
For recovery behavior and safe retry rules, use the
[operations guide](operations.md).
