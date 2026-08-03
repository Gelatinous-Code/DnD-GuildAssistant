# Move the tested bot to the real Discord server

**Audience: the deployer and the Discord server owner working through separate
handoffs.** Begin only after the disposable-server pilot is marked PASS for the
exact deployed commit.

The same Worker and D1 database can serve the test server and the real server.
Each server's configuration and weekly data are separated by Discord Server ID.
Do not create a second production Worker unless the maintainers deliberately
want a separate environment.

Keep the current manual process available until the first real week completes.

## Handoff A: deployer registers the real server

The Discord server owner gives the deployer the real **Server ID**, not a bot
token. To copy it, enable Discord Developer Mode, right-click the server, and
choose **Copy Server ID**.

The deployer confirms:

- the full pilot-tested commit is the active Worker deployment and is on `main`;
- remote D1 migrations are current;
- the `discord-command-registration` GitHub environment is limited to `main`;
- `DISCORD_BOT_TOKEN` is an environment secret; and
- `DISCORD_APPLICATION_ID` is an environment or repository variable.

Then use **GitHub Actions → Register Discord commands → Run workflow**:

1. select `main`;
2. enter the real Server ID as `target_guild_id`;
3. enter the full deployed commit SHA as `deployed_ref`;
4. confirm that the compatible Worker and migrations are live; and
5. require a green workflow result.

If the protected workflow is unavailable, the deployer may register from the
exact deployed checkout with a complete ignored `.dev.vars`:

```powershell
$env:DISCORD_GUILD_ID = "paste_real_server_id_here"
npm run commands:register
Remove-Item Env:DISCORD_GUILD_ID
```

That fallback belongs to the deployer. The Discord server owner does not run it.

Handoff checkpoint: the deployer tells the server owner that commands are
registered for the exact real Server ID.

## Handoff B: server owner installs the application

In the Discord Developer Portal, use the same installation settings proven in
the test server:

- scopes: `applications.commands` and `bot`;
- core permissions: View Channels, Send Messages, Embed Links, and Read Message
  History;
- Attach Files only if administrators will use `/week export`.

Do not grant Manage Roles. Member role assignment remains an admin task.

Do not grant Administrator. Open the application's install link, choose the real
server, and authorize it.

In the real server, run `/ping`. If it does not answer, stop and return the issue
to the deployer. Do not continue by guessing at setup.

## Discord-only real-server setup

From this point through activation, every action happens in Discord.

1. Confirm `#gm-sign-up`, `#game-sign-ups`, `GM`, `Guild Player`, and `Administrator` retain those exact names.
2. Run `/guild setup preset:Second Dawn Guild`.
3. Run `/guild setup` without options and read all five weekly stages.
4. Change any wrong day, time, time zone, duration, or table size.
5. Run `/guild status`, then `/guild doctor`.
6. Fix every ❌ for a feature you plan to use.

Use [Discord server setup](guild-setup.md) for the full plain-language field and
permission guide. Do not copy the example schedule without checking it against
the guild's actual policy.

Leave automation Paused while configuring optional reminders. Member roles are
managed manually by server admins.

## Start the first real week in Review

Run:

```text
/guild automation mode:Review before publish confirm:True
```

Add `reminders:True` only when you want the built-in reminder; do not overwrite
a custom reminder while changing mode.

For the first real week, organizers should:

1. verify the signup post and all local times;
2. compare player and GM counts with the fallback process;
3. inspect the private plan with `/week status`;
4. publish with `/week publish`; and
5. verify the final roster and post-game attendance before retiring the fallback.

Continue in Review for as many weeks as the guild wants. Use Autopilot only
after organizers trust the complete flow:

```text
/guild automation mode:Autopilot confirm:True
```

## Roll back without losing state

Pause scheduled transitions:

```text
/guild automation mode:Paused confirm:True
```

Use `/week cancel` or `/week archive` only when it matches the active phase.
Keep D1 intact, resume the previous guild process, and give the maintainer the
event ID plus sanitized `/week status` and `/guild doctor` output. Never repair
production by editing D1 rows or bot messages directly.
