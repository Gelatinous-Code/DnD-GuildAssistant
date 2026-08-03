# First deployment

**Audience: the one person responsible for putting the bot online.** This is a
technical, one-time guide. Players, GMs, and weekly organizers should not use it.
They start with the [documentation map](README.md).

This guide creates an independent installation with its own Discord application,
Cloudflare Worker, and D1 database. If you are updating an installation that
already works, use the [operations guide](operations.md#deploy-an-update) instead.

## What you are connecting

- **Discord application:** the bot's identity, permissions, and slash commands.
- **Cloudflare Worker:** receives button clicks and commands from Discord.
- **D1 database:** stores each server's setup and weekly state.
- **Discord test server:** a disposable place to prove setup before real use.

One capable volunteer can complete this, but keep the Discord, Cloudflare, and
GitHub ownership under the guild or organization and give recovery access to a
second maintainer.

## Before you start

You need:

- a Windows computer with Git and Node.js 22 or newer;
- a Cloudflare account allowed to create Workers and D1 databases;
- a Discord account allowed to create an application;
- **Manage Server** in a disposable Discord test server; and
- a password manager for the Discord bot token.

The bot token is a password. Never paste it into source code, an issue, chat,
logs, or screenshots.

## 1. Create the Discord application

Open the [Discord Developer Portal](https://discord.com/developers/applications),
choose **New Application**, and give the bot a recognizable name.

Record these values privately:

| Portal page | Value | Secret? |
| --- | --- | --- |
| General Information | Application ID | No |
| General Information | Public Key | Integrity-critical, but not a password |
| Bot | Bot Token | **Yes** |

On the **Bot** page, reset the token only when you need a new usable token. Store
the result immediately in the password manager.

On **Installation**:

1. Enable **Guild Install**. User Install is not needed.
2. Add the `applications.commands` and `bot` scopes.
3. Select View Channels, Send Messages, Embed Links, and Read Message History.
4. Add Attach Files only if administrators will use `/week export`.
5. Do not grant Manage Roles. Member role assignment is reserved for server admins.

Do not grant Administrator. Discord's current installation concepts are in its
[official application documentation](https://docs.discord.com/developers/resources/application#installation-context).

## 2. Prepare the disposable Discord server

In a test server:

1. Create a normal text channel such as `#guild-assistant-test`.
2. Enable **User Settings → Advanced → Developer Mode**.
3. Right-click the server, choose **Copy Server ID**, and record the number.
4. Use the Discord application's install link to add the app to this server.

Optional roles can wait until the basic installation works.

Checkpoint: you now have the Application ID, Public Key, Bot Token, test Server
ID, and a test channel.

## 3. Download the project

Open PowerShell and run:

```powershell
git clone https://github.com/Gelatinous-Code/DnD-GuildAssistant.git
Set-Location DnD-GuildAssistant
node --version
npm ci
```

Node must report version 22 or newer. Run every remaining computer command from
this `DnD-GuildAssistant` folder.

Sign in to the intended Cloudflare account:

```powershell
npx wrangler login
npx wrangler whoami
```

Stop if `whoami` shows the wrong account.

## 4. Give the installation its own names and IDs

Open [`wrangler.jsonc`](../wrangler.jsonc) in a text editor. The checked-in file
points at the New Dawn installation; do not deploy those IDs for another guild.

Choose a unique Worker name and change:

- `name` to that Worker name;
- `vars.DISCORD_APPLICATION_ID` to your Application ID; and
- `vars.DISCORD_TEST_GUILD_ID` to your test Server ID.

Leave the D1 binding named `DB` and leave `migrations_dir` as `migrations`.

Create a separate D1 database with a similarly unique name:

```powershell
npx wrangler d1 create my-guild-assistant
```

Replace `my-guild-assistant` with the name you chose. Wrangler prints a
`database_name` and `database_id`. Copy both values into the one object under
`d1_databases` in `wrangler.jsonc`.

Do not reuse another guild's database. Confirm the result:

```powershell
npx wrangler d1 list
```

The name and UUID in the list must exactly match `wrangler.jsonc`.

## 5. Prepare the two private local files

Copy the local example:

```powershell
Copy-Item .dev.vars.example .dev.vars
```

Open `.dev.vars` and replace every example with your Application ID, test Server
ID, Public Key, and Bot Token. This file is used only for local command
registration and is ignored by Git.

Create a second ignored file named `.env.deploy` with exactly the two Worker
secrets:

```dotenv
DISCORD_PUBLIC_KEY=paste_the_public_key_here
DISCORD_BOT_TOKEN=paste_the_bot_token_here
```

Do not add either file to Git. The files do different jobs: `.dev.vars` supplies
the local registration script, while `.env.deploy` uploads encrypted Worker
secrets with the first deployment.

## 6. Test before changing the cloud database

Run the same local quality checks used by continuous integration:

```powershell
npm run db:migrate:local
npm run check
npx wrangler deploy --dry-run --secrets-file .env.deploy
```

Stop and fix the first error. Do not continue to remote migrations after a failed
test or dry run.

## 7. Create the remote database schema

Ask Wrangler which migrations are waiting, apply them, and check again:

```powershell
npx wrangler d1 migrations list DB --remote
npm run db:migrate:remote
npx wrangler d1 migrations list DB --remote
```

The final list must report no pending migrations. Wrangler records applied
migrations; do not choose SQL filenames by hand. Cloudflare documents this in
the [D1 migration reference](https://developers.cloudflare.com/d1/reference/migrations/).

## 8. Deploy the Worker and secrets together

Run:

```powershell
npx wrangler deploy --secrets-file .env.deploy
```

Wrangler prints a public `workers.dev` URL. Open that URL in a browser. The
expected response contains:

```text
status: ready
```

The D1 binding and 15-minute schedule come from `wrangler.jsonc`; there is no
separate scheduler step. Cloudflare's
[secret guide](https://developers.cloudflare.com/workers/configuration/secrets/)
documents the `--secrets-file` deployment behavior.

After the deploy and health check both succeed, delete the one-time deployment
file:

```powershell
Remove-Item -LiteralPath .env.deploy
```

Keep the real values only in the password manager and Cloudflare's encrypted
secret storage.

## 9. Connect Discord to the Worker

Return to **Discord Developer Portal → General Information**. Set the
**Interactions Endpoint URL** to the Worker URL plus `/interactions`:

```text
https://your-worker.your-subdomain.workers.dev/interactions
```

Save it. Discord sends a signed check and must report that the endpoint is
verified.

If verification fails, confirm that the health URL works, `/interactions`
appears exactly once, and Cloudflare's `DISCORD_PUBLIC_KEY` came from this same
Discord application.

## 10. Register commands in the test server

Worker deployment and Discord command registration are separate. From the same
checkout you just deployed, run:

```powershell
npm run commands:register
```

The output should list `/help`, `/ping`, `/guild`, `/week`, and the remaining
command groups. This registration targets the test Server ID in `.dev.vars`.

If the commands do not appear immediately, reload Discord. Reinstalling the app
is not normally needed.

## 11. Hand off to the Discord setup owner

In the disposable server:

1. Run `/ping` and expect a private Pong response.
2. Run `/help` and choose a topic.
3. Run `/guild setup` and expect the private setup dashboard.

The platform installation is complete. The person with **Manage Server** can now
follow [Discord server setup](guild-setup.md), which contains Discord commands
only. Keep automation Paused until the [test-server pilot](test-guild-pilot.md)
passes.

## If something fails

| Symptom | Check |
| --- | --- |
| Wrangler is not signed in | Run `npx wrangler whoami`, then `npx wrangler login`. |
| D1 says there is no database | Recheck both D1 values in `wrangler.jsonc` and the active Cloudflare account. |
| Deploy reports missing secrets | Recheck the two names and values in `.env.deploy`. |
| Worker health works but Discord verification fails | Recheck `/interactions` and the Public Key from the same application. |
| `/ping` is missing | Recheck the test Server ID in `.dev.vars` and run command registration again. |
| `/ping` returns an error | Check the bot token, Worker logs, and Discord channel permissions. |

For an outage after a previously working installation, use the
[operations recovery runbook](operations.md#incident-recovery), not this guide.
