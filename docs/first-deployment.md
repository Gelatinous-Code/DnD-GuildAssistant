# First deployment: Discord and Cloudflare

Use this guide to create a brand-new Guild Assistant environment or connect a
new checkout for the first time. It connects four things:

1. a Discord application, which owns the bot identity and slash commands;
2. a Cloudflare Worker, which receives Discord interactions;
3. a Cloudflare D1 database, which stores guild and weekly state; and
4. a disposable Discord test server, where setup is proven before real use.

If `/ping` used to work and has stopped, do not treat the outage as a new
installation. Start with the [operations recovery guide](operations.md).

If `/ping` already works and you only need to configure a server, skip to the
[guild setup guide](guild-setup.md).

## Before you start

You need:

- Node.js 22 or newer, Git, and npm;
- permission to manage the Discord application;
- **Manage Server** in a disposable Discord test server;
- access to the Cloudflare account that owns the Worker and D1 database; and
- access to the GitHub repository.

If the repository is not on this computer yet, clone it:

```powershell
New-Item -ItemType Directory -Force C:\git
Set-Location C:\git
git clone https://github.com/Gelatinous-Code/DnD-GuildAssistant.git
Set-Location C:\git\DnD-GuildAssistant
```

If it already exists, run only the final `Set-Location` command. Stop if
`git status --short` shows changes you do not recognize. For the formal
test-guild pilot, select the current reviewed commit from `main`:

```powershell
git fetch origin
git status --short
git checkout --detach origin/main
git rev-parse HEAD
```

Record the full 40-character SHA printed by the final command. That exact SHA
must be migrated, deployed, and tested. Run every remaining PowerShell command
from this repository root.

> Merging a pull request is not a deployment step. It only changes the code on
> GitHub; it does not migrate D1 or deploy the Worker. Exploratory branch testing
> is fine, but the formal PASS must use the resulting `main` SHA. If a squash or
> rebase merge creates a different SHA, deploy and run the complete pilot again
> with that `main` SHA.

## 1. Prepare the Discord application

Open the [Discord Developer Portal](https://discord.com/developers/applications)
and select the application. If this is a new installation, create the
application first.

### Record the application values

On **General Information**, record:

- **Application ID** — a public identifier;
- **Public Key** — used by the Worker to verify Discord requests.

On **Bot**, choose **Reset Token** only if a usable token is not already stored
securely. Record the new **Bot Token** in the guild password manager. The token
is a credential: never paste it into source code, chat, logs, screenshots, or a
GitHub issue.

This bot uses Discord's HTTP interactions API, not a persistent Gateway
connection. It does not require privileged Gateway intents. Its presence may
appear offline even while commands work; `/ping` is the health check that
matters.

### Configure installation

On **Installation**:

1. Enable **Guild Install**. User Install is not needed for this bot.
2. For Guild Install, add the `applications.commands` and `bot` scopes.
3. Select these permissions:

   - View Channels
   - Send Messages
   - Embed Links
   - Read Message History
   - Attach Files, required by the test-guild pilot; otherwise optional for export
   - Manage Roles, only if the optional Weekly GM role will be automated

Do not grant Administrator.

For a private application, set **Installation → Install Link** to **None**. A
private app cannot have Discord's default authorization link. Instead, open
**OAuth2 → URL Generator**, choose the same `applications.commands` and `bot`
scopes and permissions, and copy the generated URL. A public application may
use Discord's provided install link.

Discord's current application setup terminology is documented in its
[official getting-started guide](https://docs.discord.com/developers/quick-start/getting-started).

## 2. Prepare the test Discord server

Create a disposable server or use an existing non-production server. In that
server:

1. Create a normal text channel such as `#guild-assistant-test`.
2. Optionally create a normal `Weekly GM` role.
3. Optionally create a reminder audience role and an organizer role. Enable
   **Allow anyone to @mention this role** for either role the bot should ping.
4. If Manage Roles will be used, move the bot's integration role above the
   normal `Weekly GM` role.

Install the application with the URL from the previous section. Select the test
server and approve the requested permissions.

Enable **Developer Mode** in Discord under **User Settings → Advanced**. Then
right-click the test server and choose **Copy Server ID**. This is the
`DISCORD_TEST_GUILD_ID`.

Checkpoint: the application appears in the test server's member list and you
have privately recorded the Application ID, Public Key, Bot Token, and test
Server ID.

## 3. Install the project tools

From the repository root:

```powershell
node --version
npm ci
npx wrangler --version
npx wrangler whoami
```

Node must report version 22 or newer and Wrangler must report version 4 or
newer. If Wrangler is not authenticated to the correct Cloudflare account, run:

```powershell
npx wrangler login
```

## 4. Check `wrangler.jsonc`

[`wrangler.jsonc`](../wrangler.jsonc) is the source of truth for the deployed
Worker, D1 binding, public Discord IDs, and Cron Trigger.

| Setting | Meaning | Existing New Dawn deployment |
| --- | --- | --- |
| `name` | Cloudflare Worker name | Already configured |
| `d1_databases[0].binding` | Code name for D1 | Must remain `DB` |
| `d1_databases[0].database_name` | Cloudflare D1 database name | Already configured |
| `d1_databases[0].database_id` | Exact D1 database to migrate and use | Already configured |
| `vars.DISCORD_APPLICATION_ID` | Discord application receiving commands | Already configured |
| `vars.DISCORD_TEST_GUILD_ID` | Disposable server receiving test commands | Already configured |
| `triggers.crons` | Cloudflare scheduler | Every 15 minutes |

If you are maintaining the existing New Dawn deployment, compare these values
with the accounts you opened and do not replace them casually.

If you are creating a separate installation, give every Cloudflare resource a
unique name so it cannot overwrite the New Dawn Worker or reuse its data:

1. Change Worker `name` to a unique value such as `my-guild-assistant`.
2. Replace the two Discord IDs with your Application ID and test Server ID.
3. Create a uniquely named D1 database:

   ```powershell
   npx wrangler d1 create my-guild-assistant
   ```

4. Copy the returned `database_name` and `database_id` into the matching fields
   in `wrangler.jsonc`. Keep the code binding named `DB`; the checked-in npm
   migration scripts use that binding and therefore work with any database name.

Do not point a test deployment at another guild's production database.

## 5. Configure credentials in the right places

There are three credential stores. They are independent.

| Location | Used by | Values |
| --- | --- | --- |
| Cloudflare Worker secrets | Deployed bot runtime | `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN` |
| Protected GitHub environment secret | Optional command-registration workflow | `DISCORD_BOT_TOKEN` |
| Local `.dev.vars` | Local development and local command registration | Application ID, test Server ID, Public Key, Bot Token |

Putting the token in GitHub does not put it in Cloudflare. Creating `.dev.vars`
does not configure either cloud service.

### Existing Worker

List secret names without revealing their values:

```powershell
npx wrangler secret list
```

If either required name is missing, record that fact but do not run `secret put`
yet. Current Wrangler versions deploy a Worker version when a secret is added.
Validate first, migrate D1, and then use the interactive secret command at the
deployment step.

### Brand-new Worker

For the first deployment only, create an ignored file named `.env.deploy` with
exactly these two lines:

```dotenv
DISCORD_PUBLIC_KEY=paste_the_public_key_here
DISCORD_BOT_TOKEN=paste_the_bot_token_here
```

The repository ignores `.env*` files. The deployment command later in this
guide uploads both values without placing them in `wrangler.jsonc`. Delete the
file after the first deployment and retain the values only in the guild's
password manager.

Cloudflare's current secret behavior is documented in the
[official Workers secret guide](https://developers.cloudflare.com/workers/configuration/secrets/).

## 6. Validate the release before changing cloud data

Record the exact commit and run the complete quality gate before any remote D1
migration:

```powershell
git status --short
git rev-parse HEAD
npm run check
```

Stop if the worktree is unexpectedly dirty or a test fails. Then build the
Worker bundle without uploading it. Use the first command for an existing
Worker, or the second when this is the brand-new deployment that still uses
`.env.deploy`:

```powershell
npx wrangler deploy --dry-run
npx wrangler deploy --dry-run --secrets-file .env.deploy
```

Run only the command that matches your case. Confirm the Cloudflare account and
the exact D1 target:

```powershell
npx wrangler whoami
npx wrangler d1 list
```

In the D1 list, find the row whose name and UUID exactly match
`database_name` and `database_id` in `wrangler.jsonc`. Stop if the account,
name, or UUID is wrong.

## 7. Back up and migrate the selected D1 database

A D1 migration is a numbered SQL file in [`migrations/`](../migrations). D1
records which files have already run. Do not guess which migrations are pending
and do not select filenames manually.

For an existing Worker, schedule a short maintenance window before exporting:

1. Record every installed guild's current automation mode with `/guild status`.
2. Run `/guild automation mode:Paused confirm:True` in each guild.
3. Tell testers/admins that Discord commands may fail temporarily.

A remote D1 export makes the database unavailable for queries while it runs, so
the maintenance window must cover export, migrations, and Worker deployment. A
brand-new empty database has no users to pause and does not need an export.

For a non-empty database, save a timestamped backup outside the repository and
verify that Wrangler created a non-empty file:

```powershell
New-Item -ItemType Directory -Force C:\tmp
$guildBackupStamp = Get-Date -Format "yyyyMMdd-HHmmss"
$guildBackupPath = "C:\tmp\dnd-guild-assistant-$guildBackupStamp.sql"
npx wrangler d1 export DB --remote --output $guildBackupPath
if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $guildBackupPath) -or (Get-Item -LiteralPath $guildBackupPath).Length -eq 0) { throw "D1 backup failed; stop the deployment." }
```

List exactly what this database still needs:

```powershell
npx wrangler d1 migrations list DB --remote
```

A brand-new database will list every numbered migration. An existing database
will list only newer files. Apply the reported set:

```powershell
npm run db:migrate:remote
```

Wrangler shows the files it will apply and asks for confirmation. When it
finishes, run `npx wrangler d1 migrations list DB --remote` again. It must
report no pending migrations. Cloudflare documents the list/apply behavior in its
[D1 Wrangler command reference](https://developers.cloudflare.com/d1/wrangler-commands/).

## 8. Deploy the same reviewed commit

For an existing Worker, add or rotate only the secret values that are missing or
known to be stale:

```powershell
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_BOT_TOKEN
```

At each prompt, paste only the value—not `NAME=value`. Each `secret put` creates
a Worker version, but it does not guarantee that the reviewed local code is the
version now running. Whether secrets changed or not, finish an existing-Worker
deployment with:

```powershell
npm run deploy
```

For a brand-new Worker using the one-time `.env.deploy` file:

```powershell
npx wrangler deploy --secrets-file .env.deploy
if ($LASTEXITCODE -ne 0) { throw "Deployment failed; .env.deploy was kept so you can retry." }
```

Wrangler prints the public `workers.dev` URL. The D1 binding and 15-minute Cron
Trigger are deployed from `wrangler.jsonc`; there is no separate Cron setup
step in the Cloudflare dashboard. A new or changed Cron Trigger can take several
minutes to begin firing.

Open the Worker URL in a browser or run:

```powershell
Invoke-RestMethod https://your-worker.your-subdomain.workers.dev
```

Expected result:

```text
name   : DnD New Dawn Guild Assistant
status : ready
```

This proves the Worker is reachable. Record Cloudflare's deployment ID too:

```powershell
npx wrangler deployments list
```

Match the newest deployment time to this release and keep that ID with the full
commit SHA in the pilot evidence.

For a brand-new Worker, delete the temporary secret file only after the deploy
command succeeded and this health check passed:

```powershell
Remove-Item -LiteralPath .env.deploy
```

## 9. Connect Discord to the Worker

Return to **Discord Developer Portal → General Information**. Set
**Interactions Endpoint URL** to the Worker URL with `/interactions` appended:

```text
https://your-worker.your-subdomain.workers.dev/interactions
```

Choose **Save Changes**. Discord sends a signed PING and must show that the
endpoint was verified. If verification fails, check that:

- the Worker health URL opens;
- `/interactions` is present only once;
- Cloudflare's `DISCORD_PUBLIC_KEY` matches this Discord application; and
- the latest Worker deployment succeeded.

## 10. Register commands in the test server

Command registration and Worker deployment are separate. Register commands only
after the compatible Worker and D1 schema are deployed.

### Option A: GitHub Actions

Use this option only when the deployed commit is already on `main`. In the
GitHub repository:

1. Create or open the `discord-command-registration` environment. Store
   `DISCORD_BOT_TOKEN` there as an environment secret, restrict it to `main`, and
   add a required reviewer when another maintainer is available.
2. Set `DISCORD_APPLICATION_ID` as an environment or repository variable. There
   is no fallback Application ID.
3. Open **Actions → Register Discord commands → Run workflow** from `main`.
4. Enter the test Server ID as `target_guild_id`.
5. Enter the full deployed commit SHA as `deployed_ref`. The workflow accepts
   only a 40-character SHA already on trusted `main` history.
6. Check the confirmation only after the compatible Worker and migrations are
   live, then approve the environment when prompted.

Registration is manual so matching the deployed runtime remains an explicit
operator checkpoint. For an unmerged release branch, use local registration;
the protected workflow intentionally refuses that ref.

### Option B: local registration

Create a local, ignored `.dev.vars` file:

```powershell
Copy-Item .dev.vars.example .dev.vars
```

Edit all four values, then run:

```powershell
git rev-parse HEAD
npm run commands:register
```

Run this from the same exact checkout that was deployed. The script replaces
guild-scoped commands in `DISCORD_TEST_GUILD_ID`. It does not publish global
commands. The post-pilot guide explains the explicit override for a real guild.

## 11. Prove the installation

In the disposable Discord server:

1. Type `/ping` and choose the Guild Assistant command.
2. Expect: `Pong! The guild assistant is awake.`
3. Run `/guild setup` with no options. Expect a private setup dashboard.

If commands do not appear, confirm the test Server ID, rerun command
registration, and restart/reload Discord. Reinstalling the bot is not normally
needed after command registration.

For an updated existing deployment, run `/ping`, `/guild status`, and
`/guild doctor` in every installed guild. When they pass, restore each guild's
recorded Review or Autopilot mode. Keep it Paused if any check fails.

For a brand-new environment, the platform installation is now complete.
Continue with [Configure a Discord guild](guild-setup.md). After the test-guild
pilot passes, use
[Promote the tested bot to the real guild](real-guild-go-live.md).
