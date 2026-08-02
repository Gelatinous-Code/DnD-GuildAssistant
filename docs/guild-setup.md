# Configure a Discord guild

Use this guide after the Worker is deployed, the application is installed in a
disposable Discord server, and `/ping` works. All commands in this guide are run
inside Discord by a member with **Manage Server**.

The bot has no separate web control panel. `/guild setup` is its configuration
screen. Setup responses are private, the process is resumable, and the scheduler
stays paused until an administrator explicitly enables it.

## The five-minute safe setup

The built-in schedule is New Dawn's default, not a universal recommendation.
Every guild should explicitly confirm its time zone, weekday, and start time.

1. Create a normal text channel such as `#guild-assistant-test`.
2. Save that channel:

   ```text
   /guild setup channel:#guild-assistant-test
   ```

3. Run `/guild setup` again with no options. Confirm the displayed time zone,
   weekday, time, signup window, and table sizes. Update any value that is wrong.
4. Run `/guild status` and then `/guild doctor`.
5. Fix every ❌. Optional ⚠️ warnings may remain only when that feature is
   intentionally unused.
6. Leave automation **Paused** while you run the test-guild pilot. The pilot
   explains exactly when to enable Review and Autopilot.

The first setup command saves these defaults:

- Saturday at 18:30 in `America/Denver`;
- signups open seven days before the game and lock 24 hours before it;
- four players minimum, six preferred, and six maximum per table;
- the selected channel receives signup, table, and built-in reminder posts;
- reminders, Weekly GM role sync, and scheduled automation remain off.

Nothing is published merely by saving setup.

## How `/guild setup` updates settings

Running `/guild setup` without options only shows the current dashboard. It does
not save anything.

The first save requires `channel`. After that, each setup call changes only the
options supplied and retains every other saved value. For example, this changes
only the game time:

```text
/guild setup time:19:00
```

Discord presents channels, roles, weekdays, and booleans as pickers. The examples
in this guide show their selected values as readable text.

## Every `/guild setup` option

### Core weekly settings

| Option | Default | What it means | Rules |
| --- | --- | --- | --- |
| `channel` | No default; required once | One normal text or announcement channel for signup posts, table posts, and built-in reminders | Must belong to this server and be visible to the bot |
| `timezone` | `America/Denver` | Time zone used for every weekly deadline | Use an IANA region such as `America/Denver`, not a fixed offset, so daylight-saving changes work |
| `weekday` | Saturday | Local day the guild normally plays | Choose Monday through Sunday |
| `time` | `18:30` | Local game start time | Use 24-hour `HH:mm`, such as `09:30` or `19:00` |
| `signup_lead_days` | `7` | Days before game time that signups open | Whole number from 1 through 7 |
| `lock_lead_hours` | `24` | Hours before game time that signups lock and planning begins | Whole number from 1 through 168; cannot be longer than the signup window |

`/guild setup` uses one channel for signup, table, and built-in reminder posts.
A custom reminder may use another destination through `/reminder configure`
with its `channel` option. Signup and table channels are not separately
configurable yet. Every event has a fixed four-hour duration.

### Table planning settings

| Option | Default | What it means | Rules |
| --- | ---: | --- | --- |
| `minimum` | 4 | Smallest viable player count used when deciding whether another GM/table is supportable | 1–20; cannot exceed `preferred` |
| `preferred` | 6 | Desired player count and plan-health target | 1–20; between `minimum` and `maximum` |
| `maximum` | 6 | Hard player-seat capacity before the waitlist is used | 1–20; cannot be below `preferred` |

The GM is not counted as a player seat. The recommended production policy is
`minimum:4 preferred:6 maximum:6`. The pilot deliberately uses smaller values
so three testers can exercise waitlists and displacement.

### Optional roles

| Option | Purpose | Requirements |
| --- | --- | --- |
| `gm_role` | Temporarily assigned to the GMs selected for the currently published week | Create a normal Discord role; grant the bot Manage Roles and place its highest role above this role before enabling role sync |
| `reminder_role` | The only ordinary audience role scheduled signup reminders may ping | Role must exist and have **Allow anyone to @mention this role** enabled |
| `admin_role` | Pings organizers only when projected player demand exceeds GM capacity | Role must be mentionable; it does not grant permission to run admin commands |

Selecting a role saves it but does not enable reminders or role sync.

To remove a saved role, use one of these booleans with value `True`:

- `clear_gm_role` — removes assistant-owned Weekly GM role leases and disables
  role sync; manually assigned roles are preserved;
- `clear_reminder_role` — clears the default reminder audience; and
- `clear_admin_role` — clears the capacity-risk organizer audience.

Do not supply a role and its matching `clear_*` option in the same command.

If a custom reminder rule already exists, changing `channel` or using
`clear_reminder_role` does not rewrite that rule. Run `/reminder configure`
again afterward.

## Recommended explicit setup example

An administrator who wants to record every important choice can enter one
command and fill these options in Discord:

```text
/guild setup
  channel: #guild-assistant-test
  timezone: America/Denver
  weekday: Saturday
  time: 18:30
  minimum: 4
  preferred: 6
  maximum: 6
  signup_lead_days: 7
  lock_lead_hours: 24
```

Discord sends it as one command; the line breaks above are only for readability.
Add optional roles only if the pilot will test those features.

## Verify the saved setup

Run:

```text
/guild status
/guild doctor
```

`/guild status` answers: “What is saved, and what week is active?” It shows the
effective schedule, signup timing, table policy, automation mode, current weekly
phase, counts, and recent operations.

`/guild doctor` answers: “Can the bot use the saved Discord resources right
now?” It checks the channel, bot permissions, optional role existence and
mentionability, Manage Roles, and role hierarchy.

Interpret the symbols this way:

- ✅ — ready;
- ➖ — optional and not enabled;
- ⚠️ — optional capability is unavailable, such as Attach Files for CSV export;
- ❌ — fix this before enabling the affected feature.

The core workflow requires View Channels, Send Messages, Embed Links, and Read
Message History in the configured channel. Manage Roles is required only for
Weekly GM role sync. Attach Files is needed only for `/week export`.

## Optional: configure reminders

For the built-in reminder, set `reminders:True` when enabling Review mode. It is
sent 48 hours before signup lock and uses the configured reminder role, if any.

For a custom reminder, configure it first:

```text
/reminder configure enabled:True hours_before:48 channel:#guild-assistant-test role:@Gaming message:Please choose Run a Game or Play before signups close. We have {players} players and {gms} GMs.
```

This command saves the rule immediately and then shows a private rendered
confirmation. It does not send a reminder immediately. Check the destination,
timing, text, and role.

`/reminder configure` replaces the rule; it is not a partial update. When
correcting, disabling, or later re-enabling a custom rule, resupply the complete
desired `hours_before`, `channel`, `role`, and `message`. Omitted timing and text
return to the built-in 48-hour/default-message values. The supported template
values are:

- `{event}`
- `{when}`
- `{players}`
- `{gms}`
- `{open_seats}`

The bot rejects `@everyone`, `@here`, raw member mentions, raw role mentions in
the message text, unknown template values, and non-mentionable roles. Choose the
allowed role with the `role` option instead of typing its mention into the
message.

Important: supplying `reminders:True` or `reminders:False` later through
`/guild automation` replaces a custom rule with the built-in 48-hour/default
rule. When a custom rule is already correct, omit the `reminders` option while
changing automation mode.

## Optional: configure the Weekly GM role

Before enabling role sync:

1. Confirm the bot has Manage Roles.
2. Under **Server Settings → Roles**, move the bot's role above the normal
   `Weekly GM` role.
3. Save `gm_role` with `/guild setup`.
4. Run this exact preview command:

   ```text
   /roles sync dry_run:True
   ```

Never omit `dry_run` while testing. `dry_run:False` applies changes. The bot
may add the role to GMs selected in the current published plan and records those
assignments as its own leases. It removes only assistant-leased assignments;
unrelated and manually assigned roles are preserved.

## Choose an automation mode

| Mode | What the scheduler does | When to use it |
| --- | --- | --- |
| **Paused** | Does not advance weekly signup/table phases; role sync is forced off | Initial setup, maintenance, or incident containment |
| **Review before publish** | Opens signups, delivers any enabled reminder, locks, and plans; waits for an admin to run `/week publish`; then finalizes and archives automatically | First activation and normal operation when organizers want approval |
| **Autopilot** | Runs the complete weekly lifecycle, including publication | Only after the live pilot passes |

Every mode change requires `confirm:True`. During initial setup, leave Paused.
The test-guild pilot and real-guild promotion guide provide the exact Review and
Autopilot commands at the point where they are safe to run.

To turn on the built-in reminder, add `reminders:True`. To preserve an existing
custom reminder, omit `reminders`. Supplying either reminder value replaces a
custom rule with the built-in rule. If the Weekly GM role preview passed, choose
`role_sync:True`; otherwise leave it False.

Review and Autopilot are refused when required channel/permission checks fail.
Paused mode leaves manual admin lifecycle commands available.

## Next step

Keep the disposable server **Paused** and complete the
[test-guild go-live pilot](test-guild-pilot.md). That guide enables Review and
Autopilot at controlled points. Do not enable a real-guild week until the pilot
has recorded a passing result.

## Common setup problems

| Symptom | What to do |
| --- | --- |
| `/guild` commands do not appear | Register commands for the correct test Server ID, then reload Discord |
| Bot appears offline | This HTTP bot has no Gateway presence; use `/ping` |
| `/ping` does not respond | Verify the Worker deployment, Discord interaction endpoint, and matching Public Key |
| Channel fails doctor | Grant View Channels, Send Messages, Embed Links, and Read Message History in that channel |
| Reminder role fails doctor | Enable **Allow anyone to @mention this role** |
| GM role fails doctor | Grant Manage Roles and move the bot role above the Weekly GM role |
| Wrong schedule appears | Rerun `/guild setup` with only `timezone`, `weekday`, or `time` |
| Need to stop automation | Run `/guild automation mode:Paused confirm:True` |
