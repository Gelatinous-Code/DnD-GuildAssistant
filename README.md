# DnD New Dawn Guild Assistant

![DnD New Dawn Guild Assistant banner](assets/brand/new-dawn-banner-1800x600.png)

[![CI](https://github.com/Gelatinous-Code/DnD-GuildAssistant/actions/workflows/ci.yml/badge.svg)](https://github.com/Gelatinous-Code/DnD-GuildAssistant/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A Discord assistant for organizing weekly tabletop games: GM signups, player
capacity, table creation, reminders, and exports.

The bot runs as a serverless Discord interactions endpoint on Cloudflare Workers.
It is in early development; the current milestone provides a signed <code>/ping</code>
command for the test guild.

Live interaction endpoint:
<https://dnd-new-dawn-guild-assistant.dnd-new-dawn-guild-assistant.workers.dev>

## What works today

- Health reporting on <code>GET /</code>.
- Ed25519 verification for Discord interaction requests.
- Discord endpoint-validation PING/PONG handling.
- A private <code>/ping</code> response with the caller's display name.
- A 1 MiB interaction-body limit.
- Automated unit tests and TypeScript/Workers type checks.

Planned guild-management features are tracked in
[GitHub Issues](https://github.com/Gelatinous-Code/DnD-GuildAssistant/issues).

## Built with

- [Cloudflare Workers](https://workers.cloudflare.com/)
- [Discord Interactions](https://discord.com/developers/docs/interactions/overview)
- TypeScript and Node.js 22+
- Vitest

## Quick start

Requirements: Node.js 22 or newer, npm, a Cloudflare account, and a Discord
application with a test server.

1. Install dependencies:

       npm install

2. Copy <code>.dev.vars.example</code> to <code>.dev.vars</code>:

       Copy-Item .dev.vars.example .dev.vars

3. Fill in the values from the Discord Developer Portal. Never commit
   <code>.dev.vars</code> or share its bot token.

4. Start the Worker locally:

       npm run dev

Discord cannot call localhost directly, so local mode is primarily useful for
health checks and automated tests. Deploy the Worker for Discord's endpoint
handshake.

## Configuration

| Variable | Used by | Secret | Purpose |
| --- | --- | --- | --- |
| <code>DISCORD_APPLICATION_ID</code> | Command registration | No | Identifies the Discord application. |
| <code>DISCORD_TEST_GUILD_ID</code> | Command registration | No | Targets fast, guild-scoped command registration. |
| <code>DISCORD_PUBLIC_KEY</code> | Worker | No | Verifies signed Discord interaction requests. |
| <code>DISCORD_BOT_TOKEN</code> | Command registration | **Yes** | Authorizes Discord API calls. Keep it only in local secrets. |

The checked-in test-environment identifiers are public IDs, not credentials.
Treat the bot token and any future API keys as secrets.

## Deploy and register the command

1. Authenticate with Cloudflare:

       npx wrangler login

2. Store the Discord public key as a Worker secret:

       npx wrangler secret put DISCORD_PUBLIC_KEY

3. Deploy:

       npm run deploy

4. Copy the deployed URL into **Discord Developer Portal > General Information >
   Interactions Endpoint URL** and save it.

5. Register the test-guild command:

       npm run commands:register

6. Run <code>/ping</code> in the test server. The reply is visible only to the caller.

## Development commands

| Command | Purpose |
| --- | --- |
| <code>npm run dev</code> | Run the Worker locally with Wrangler. |
| <code>npm test</code> | Run the test suite once. |
| <code>npm run test:watch</code> | Run tests in watch mode. |
| <code>npm run types</code> | Regenerate Cloudflare Worker types. |
| <code>npm run typecheck</code> | Check generated Worker types and TypeScript. |
| <code>npm run commands:register</code> | Register commands in the configured test guild. |
| <code>npm run deploy</code> | Deploy the Worker to Cloudflare. |

## Project layout

| Path | Purpose |
| --- | --- |
| <code>src/</code> | Worker request handling and Discord types |
| <code>test/</code> | Vitest tests |
| <code>scripts/</code> | Command and repository utilities |
| <code>assets/brand/</code> | Project artwork |
| <code>.github/</code> | CI, dependency, issue, PR, and release configuration |

## Contributing and security

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening
a pull request. Report vulnerabilities privately according to
[SECURITY.md](SECURITY.md), not through a public issue.

## License

This project is available under the [MIT License](LICENSE).
