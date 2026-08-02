# Discord command reference

Every command on this page is entered in Discord. Discord shows the available
fields after you choose a command. Commands and responses that expose
configuration, attendance, or operational details are private.

## Everyone

| Command | Purpose |
| --- | --- |
| `/help` | Show a private plain-language guide for playing, GMing, priority tokens, or organizing. |
| `/ping` | Check whether the bot is responding. |
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
| `/guild automation` | Choose Paused, Review, or Autopilot and optional reminders or role sync. |
| `/guild status` | Show saved settings, automation mode, and the current week. |
| `/guild doctor` | Check every configured channel, permissions, notification role, and managed-role order. |

## Weekly event

These require **Manage Server**.

| Command | Purpose |
| --- | --- |
| `/week status` | Show the active phase, signup counts, plan, waitlists, and recent operation results. |
| `/week open` | Manually open the next scheduled week or a specifically dated test event. |
| `/week signup` | Record an audited late signup, withdrawal, or organizer correction. |
| `/week lock` | Manually close signup changes for planning. |
| `/week plan` | Generate or regenerate the deterministic private draft. |
| `/week override` | Change one draft table's name, capacity, or active eligible GM with a reason. |
| `/week publish` | Publish or safely reconcile the current reviewed draft. |
| `/week export` | Download a private CSV snapshot for portability or backup. |
| `/week retry` | Retry one failed open, lock, publish, reminder, role, or final-roster action. |
| `/week skip` | Record that one scheduled occurrence should be skipped. |
| `/week cancel` | Cancel a week with an audit reason. |
| `/week archive` | Close the completed week and reconcile bot-owned roles. |

For `/week signup`, **GM** and **Player** corrections require **Tier 1**, **Tier
2**, or **Tier 3**. **Backup GM** records emergency coverage without adding a
planned table; **Withdraw** removes the member from the week. See
[Weekly game tiers](game-tiers.md).

## Attendance and DM rewards

These require **Manage Server**.

| Command | Purpose |
| --- | --- |
| `/session status` | Review the private attendance draft and reward state for a table. |
| `/session attendance` | Record a no-show, substitute, walk-in, or other difference from the published roster. |
| `/session confirm` | Freeze the result of a completed or cancelled table and reconcile the DM reward once. |
| `/priority-admin diagnose` | Privately trace token, seating, completion, and message-delivery state. |
| `/priority-admin correct` | Append a confirmed correction to an incorrect reward grant. |
| `/priority-admin refund` | Make an exceptional confirmed token refund. |
| `/priority-admin configure` | Set or disable the private pre-expiration reminder. |

## Optional reminders and roles

These require **Manage Server**.

| Command | Purpose |
| --- | --- |
| `/reminder configure` | Save or disable the reminder rule and show a private preview. |
| `/reminder send` | Send the configured reminder now; a deliberate duplicate requires confirmation. |
| `/roles sync` | Preview or apply changes to the optional Weekly GM role. |

For the ordinary operating sequence, use the [organizer guide](organizer-guide.md).
For recovery behavior and safe retry rules, use the
[operations guide](operations.md).
