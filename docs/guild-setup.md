# Discord server setup

This guide is for the Discord server owner or another member with **Manage
Server**. Everything on this page happens inside Discord. There are no computer,
npm, or Cloudflare commands here.

Use this guide only after `/ping` answers. If `/ping` is missing or silent, the
hosting setup is not complete; send the [first-deployment guide](first-deployment.md)
to the deployer.

## Before you begin

Decide these things with the people who run game night:

- the channel where weekly signup and table posts belong;
- the guild's local time zone;
- when GM signup, player signup, tables, open seating, and game time happen; and
- the smallest, preferred, and largest number of players at one table.

Optional reminder and Weekly GM roles can wait. The basic workflow does not need
them.

## Second Dawn: one-command setup

The Second Dawn server can reuse its existing structure. Give the bot **View
Channel**, **Send Messages**, **Embed Links**, and **Read Message History** in
both `#gm-sign-up` and `#game-sign-ups`, then run:

```text
/guild setup preset:Second Dawn Guild
```

The preset discovers these exact resources:

- channels: `gm-sign-up` and `game-sign-ups`;
- permanent roles: `GM`, `Guild Player`, and `Administrator`.

GM signup opens in `#gm-sign-up`. When the player stage opens, a player-only
card is created in `#game-sign-ups`; tables and built-in reminders also use
that player channel. Neither card permits `@everyone`, `@here`, or user
mentions.

Discord channel visibility remains the signup boundary. The bot verifies that
the permanent `GM` role exists, but it does not inspect that role when a button
is clicked and never adds or removes it. `Guild Player` becomes the optional
reminder audience, and `Administrator` becomes the capacity-escalation role.
Those roles are pinged only if the corresponding notification feature is later
enabled. Automation remains Paused after setup.

If any required name is missing or duplicated, nothing is saved. Correct the
server resource and run the same command again.

## Generic one-channel setup

### 1. Make one channel

Create a normal text channel, such as `#guild-games`. Give the bot these channel
permissions:

- View Channel
- Send Messages
- Embed Links
- Read Message History

Do not give the bot Administrator.

### 2. Save the channel

Run this in Discord and choose the channel from Discord's picker:

```text
/guild setup channel:#guild-games
```

The first save creates the rest of the settings with the built-in starting
values. It does not publish a week, and automation remains Paused.

### 3. Read the setup dashboard

Run `/guild setup` again without adding options. The private response shows the
whole weekly flow in order:

1. GM signup opens.
2. Player signup opens.
3. Tables are planned or published.
4. Unclaimed places become first-come, first-served.
5. Games begin.

The built-in starting values are for New Dawn: Wednesday 17:00, Thursday 17:00,
Saturday 17:00, Monday 17:00, then Tuesday 18:00 for a three-hour game, all in
`America/Denver`. Treat these as examples. Change anything that does not match
your guild.

### 4. Change one setting at a time

You do not have to build one enormous command. `/guild setup` changes only the
fields you provide and keeps every other saved value.

For example, this changes only game time:

```text
/guild setup time:19:00
```

This changes the game day, time, and length together:

```text
/guild setup weekday:Friday time:19:00 duration_minutes:240
```

Discord shows channels, roles, weekdays, and True/False values as choices. Times
use a 24-hour clock: `18:00` means 6:00 PM and `09:30` means 9:30 AM.

For the time zone, use a city-based name such as `America/Denver`,
`America/New_York`, or `Europe/London`. This lets the schedule follow local
daylight-saving changes.

### 5. Check the result

Run these two commands:

```text
/guild status
/guild doctor
```

- `/guild status` shows what is saved and the current week's state.
- `/guild doctor` checks whether the bot can use the chosen channel and any
  optional roles.

Fix every ❌ before continuing. A ➖ means an optional feature is off. A ⚠️ may
remain only when you intentionally do not use that optional feature.

## Setup fields in plain language

| Field | Meaning |
| --- | --- |
| `channel` | Generic fallback where the combined signup card, tables, and built-in reminders appear. |
| `timezone` | The guild's local city-based time zone. |
| `gm_day`, `gm_time` | When members may start volunteering to run games. |
| `player_day`, `player_time` | When members may start signing up to play. |
| `tables_day`, `tables_time` | When the signup snapshot is planned; Autopilot also publishes then. |
| `open_seating_day`, `open_seating_time` | When still-unclaimed places stop being protected by signup order. |
| `weekday`, `time` | The normal game day and start time. |
| `duration_minutes` | Expected game length, from 60 through 720 minutes. |
| `minimum` | Fewest players that makes a table useful for planning. |
| `preferred` | Target number of players at a table. |
| `maximum` | Hard player limit before that table uses a waitlist. |

The five weekly stages must stay in that order. If Discord refuses a schedule,
run `/guild setup` without options, find the stage that is out of order, and
change that stage. Schedule changes affect the next event the bot creates; they
do not move an event that already exists.

The GM does not count as a player seat. A common table policy is four minimum,
six preferred, and six maximum:

```text
/guild setup minimum:4 preferred:6 maximum:6
```

See the [player and GM guide](player-guide.md#choose-a-table) for the member-facing
explanation of reservations, the global waitlist, table waitlists, and open
seating.

## Optional: reminder roles

To let the bot mention a signup audience:

1. Create or choose a normal role, such as `Game Night`.
2. In that role's Discord settings, enable **Allow anyone to @mention this
   role**.
3. Save it with `/guild setup reminder_role:@Game Night`.

An optional `admin_role` is mentioned only when player demand is larger than the
planned capacity. It does not grant access to organizer commands.

To use the built-in reminder when enabling Review, set `reminders:True`. For a
custom message or time, use `/reminder configure`; Discord will show a private
preview before anything is sent. The bot rejects `@everyone`, `@here`, raw user
mentions, and roles that were not chosen through the command field.

## Optional: Weekly GM role

To give selected GMs a temporary role:

1. Create a normal role such as `Weekly GM`.
2. Give the bot **Manage Roles**.
3. In **Server Settings → Roles**, move the bot's role above `Weekly GM`.
4. Save it with `/guild setup gm_role:@Weekly GM`.
5. Preview the result:

   ```text
   /roles sync dry_run:True
   ```

Use `dry_run:False` only when the preview is correct. The bot removes only role
assignments it previously added; it leaves manual assignments alone.

## Choose how much the bot automates

| Mode | What happens | Recommended use |
| --- | --- | --- |
| Paused | Scheduled weekly changes stop; organizer commands still work. | Setup, testing, maintenance, or an incident. |
| Review before publish | The bot opens, reminds, locks, and plans, then waits for `/week publish`. | First real weeks and any guild wanting human approval. |
| Autopilot | The complete weekly flow, including publication, is automatic. | After a tested live week. |

For the first real week, start in Review:

```text
/guild automation mode:Review before publish confirm:True role_sync:False
```

Use `role_sync:True` only after the role preview passes. Add `reminders:True`
only when you want the built-in reminder. A custom reminder should be configured
separately and left unchanged when switching modes.

## You are finished when

- `/ping` answers;
- `/guild setup` shows the intended five-stage schedule;
- `/guild status` shows the intended table policy and mode;
- `/guild doctor` has no ❌ for enabled features; and
- the guild is Paused for testing or deliberately in Review for its first week.

Weekly organizers can now use the [organizer guide](organizer-guide.md). A new
self-hosted installation should complete the
[test-server pilot](test-guild-pilot.md) before using a real server or Autopilot.

## Common problems

| Symptom | Fix |
| --- | --- |
| `/guild` is missing | Ask the deployer to register commands for this exact Discord Server ID, then reload Discord. |
| The bot appears offline | Use `/ping`; this bot may not show an online presence. |
| `/ping` does not answer | Ask the deployer to check the Worker, interaction endpoint, and Discord Public Key. |
| The channel has a ❌ | Grant View Channel, Send Messages, Embed Links, and Read Message History there. |
| A reminder role has a ❌ | Enable **Allow anyone to @mention this role**. |
| The Weekly GM role has a ❌ | Grant Manage Roles and move the bot role above the Weekly GM role. |
| The schedule is wrong | Change only the incorrect day or time, then reopen `/guild setup`. |
| Something is happening at the wrong time | Pause automation, run `/guild status`, and check the saved time zone and all five stages. |
