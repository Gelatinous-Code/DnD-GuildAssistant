# Promote the tested bot to the real guild

Use this guide only after the disposable-server pilot is marked **PASS**. The
same deployed Worker can serve both the test server and the real guild: every
guild's configuration and weekly data are isolated by Discord Server ID in D1.
No second Cloudflare Worker or database is required.

Commands are currently registered per guild, not globally. Installing the bot
does not make slash commands appear until the registration step below succeeds.

## Before you start

You need:

- the full commit SHA that passed the pilot, is deployed, and is on `main`;
- Manage Server in the real Discord guild;
- access to the Discord application and GitHub repository; and
- the real guild's intended channel, time zone, schedule, table sizes, and
  optional roles.

Keep Raid Helper or the current manual process available until the first real
Guild Assistant week completes successfully.

The formal pilot must happen **after merge** against the exact deployed `main`
commit. Pre-merge testing is useful feedback, but it does not count as the final
PASS. If a squash or rebase merge creates a new SHA, migrate and deploy that new
`main` SHA and run the complete test-guild pilot against it before promotion.

## 1. Protect production command registration

The workflow uses the `discord-command-registration` GitHub environment. Before
using it for the real guild:

1. Open **Repository Settings → Environments → discord-command-registration**.
2. Limit deployment branches to `main` and add a required reviewer when another
   maintainer is available.
3. Store `DISCORD_BOT_TOKEN` as an **environment secret**.
4. Store `DISCORD_APPLICATION_ID` as an environment or repository variable.
5. Remove any repository-level copy of `DISCORD_BOT_TOKEN` after the environment
   secret works. This prevents an untrusted branch workflow from reading it.

The registration workflow itself accepts only a full 40-character commit SHA
that is already on `main` history.

## 2. Install the application in the real guild

In the Discord Developer Portal, reuse the installation settings proven by the
test guild:

- scopes: `applications.commands` and `bot`;
- required permissions: View Channels, Send Messages, Embed Links, and Read
  Message History;
- Attach Files if real-guild admins will use `/week export`; and
- Manage Roles only if the Weekly GM role will be automated.

Do not grant Administrator. For a private application, keep **Installation →
Install Link** set to **None** and generate the install URL under **OAuth2 → URL
Generator**. Open that URL, choose the real guild, and authorize it.

Enable Discord Developer Mode, right-click the real server, and choose **Copy
Server ID**. Keep this non-secret ID ready for registration.

## 3. Register commands for the real guild

Preferred GitHub path:

1. Open **Actions → Register Discord commands**.
2. Select **Run workflow** from `main`.
3. Enter the real **Server ID** as `target_guild_id`.
4. Enter the full pilot-tested commit SHA as `deployed_ref`.
5. Check `deployment_verified` and start the run.
6. Approve the protected environment when prompted and require a green result.

If GitHub Actions is unavailable, register locally from the exact deployed
`main` checkout. A complete ignored `.dev.vars` must already contain the
matching Application ID and Bot Token:

```powershell
$env:DISCORD_GUILD_ID = "paste_real_server_id_here"
npm run commands:register
Remove-Item Env:DISCORD_GUILD_ID
```

This replaces Guild Assistant's command definitions only in that guild.

## 4. Configure the real guild while Paused

In the real guild, run `/ping`. Then save the actual production choices in one
command (Discord displays these as option fields):

```text
/guild setup channel:#guild-games timezone:America/Denver weekday:Saturday time:18:30 minimum:4 preferred:6 maximum:6 signup_lead_days:7 lock_lead_hours:24
```

Replace every example value that differs from the guild's real policy. Add
`gm_role`, `reminder_role`, or `admin_role` only when those features will be
used. Setup remains Paused.

Run, in order:

```text
/guild setup
/guild status
/guild doctor
```

Confirm every displayed value and fix every ❌. Optional ⚠️ warnings may remain
only for features the real guild will not use. If role sync is planned, require
a clean `/roles sync dry_run:True` first. If a custom reminder is planned,
configure it now and inspect the saved private rendering.

## 5. Start the real guild in Review mode

Enable Review without overwriting a custom reminder:

```text
/guild automation mode:Review before publish confirm:True role_sync:False
```

Use `role_sync:True` only after its dry run is correct. To use the built-in
48-hour reminder instead of a custom rule, add `reminders:True`.

For the first real week:

1. verify the signup post and local timestamps;
2. compare GM/player counts with the old process;
3. inspect the planned tables with `/week status`;
4. publish them manually with `/week publish`; and
5. verify the final manifest and archive before retiring the fallback process.

Remain in Review as long as organizers want approval. When the guild is ready
for automatic publication, run:

```text
/guild automation mode:Autopilot confirm:True
```

## Roll back safely

Run `/guild automation mode:Paused confirm:True` to stop new scheduled weekly
transitions. Use `/week cancel` or `/week archive` only when appropriate for the
active phase, keep D1 intact, and resume the prior guild process while the issue
is investigated. Never repair production by editing D1 rows or Discord bot
messages directly.
