# DnD New Dawn Guild Assistant

![DnD New Dawn Guild Assistant banner](assets/brand/new-dawn-banner-1800x600.png)

[![CI](https://github.com/Gelatinous-Code/DnD-GuildAssistant/actions/workflows/ci.yml/badge.svg)](https://github.com/Gelatinous-Code/DnD-GuildAssistant/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A Discord-native weekly tabletop organizer for GM and player signups, fair GM
rotation, automatic 4–6-player tables, table selection and waitlists, temporary
GM roles, and safe reminders.

The bot is a serverless HTTP interaction endpoint on Cloudflare Workers. D1 is
its source of truth and a Cron Trigger handles weekly orchestration; no computer
or long-running gateway process must stay online.

Live health endpoint:
<https://dnd-new-dawn-guild-assistant.dnd-new-dawn-guild-assistant.workers.dev>

## Functional MVP

M1–M3 are implemented:

- Per-server Discord setup, sanitized status, and actionable doctor commands.
- Time-zone-aware weekly event creation across daylight-saving changes.
- Explicit draft, open, locked, planned, published, archived, and cancelled
  lifecycle state with audited, idempotent transitions.
- Native GM/player/withdraw buttons backed by D1, plus audited admin corrections.
- Deterministic GM rotation using fewest prior selections, oldest/never selected,
  signup time, and Discord ID tie-breaks.
- Deterministic table sizing that prefers six seats and reduces to five or four
  when more GMs are viable.
- Reviewable draft revisions with audited table-name, capacity, and GM overrides.
- Explicit publication, Discord-enforced message nonces, and concurrency guards.
- Player table choice/change/leave, atomic capacity enforcement, table-specific
  waitlists, and deterministic promotion.
- Bot-owned weekly GM role leases that preserve every manually assigned role.
- Safe configured-role reminders, aggregate capacity warnings, atomic claims,
  one-occurrence cooldowns, conditional organizer escalation, capped
  retry/backoff, expiry, and explicit intentional resend.
- A 15-minute scheduled orchestration pass with structured logs and isolated
  failures.
- Versioned D1 migrations and comprehensive automated tests.

Raid Helper can remain beside the assistant for the broad gaming-interest poll
and its existing CSV/Google Sheets handoff. Guild Assistant never scrapes another
bot or depends on private Raid Helper behavior. See the
[interoperability decision](docs/decisions/0001-raid-helper-boundary.md).

CSV export and direct Google Sheets automation remain M4, so M1–M3 are the
functional weekly-operations MVP while Raid Helper supplies the existing export
fallback.

## Discord commands

Admin commands require Manage Server and return private responses.

| Command | Purpose |
| --- | --- |
| <code>/ping</code> | Verify the signed interaction endpoint. |
| <code>/guild setup</code> | Configure text/announcement channel, GM/reminder/organizer roles, IANA time zone, schedule, table policy, and safe automation switches. |
| <code>/guild status</code> | Show sanitized effective configuration and current weekly state. |
| <code>/guild doctor</code> | Check channels, permissions, role existence, and hierarchy. |
| <code>/week open</code> | Open the next scheduled or explicitly dated signup. |
| <code>/week signup</code> | Record an audited late signup, cancellation, or admin correction. |
| <code>/week lock</code> | Lock the signup snapshot. |
| <code>/week plan</code> | Generate or regenerate a deterministic draft revision. |
| <code>/week override</code> | Change one draft table's name, capacity, or active GM with an audit reason. |
| <code>/week publish</code> | Explicitly publish the reviewed draft. |
| <code>/week retry</code> | Recover publication, open, lock/plan, reminder, or role work safely. |
| <code>/week skip</code> | Confirm an audited skip of one scheduled occurrence. |
| <code>/week cancel</code> | Cancel an unfinished/published week with an audit reason. |
| <code>/week archive</code> | Close the week and reconcile assistant-owned roles. |
| <code>/roles sync</code> | Preview or apply weekly GM role reconciliation. |
| <code>/reminder configure</code> | Preview and enable/disable the pre-lock reminder. |
| <code>/reminder send</code> | Send once now or explicitly request an intentional resend. |

Members use buttons on the signup and published table messages; they do not need
admin commands.

## Discord permissions

Install with the <code>applications.commands</code> and <code>bot</code> scopes.
Grant only:

- View Channels
- Send Messages
- Embed Links
- Read Message History
- Manage Roles, only for weekly GM role automation
- Attach Files later, when M4 exports are enabled

Do not grant Administrator. Put the bot's integration role above the normal
weekly GM role. If reminders must notify a role, make that role mentionable or
grant the narrow Discord permission that allows the bot to mention it.

The bot constructs <code>allowed_mentions</code> explicitly. It never enables
<code>@everyone</code>, <code>@here</code>, arbitrary users, or undeclared roles.

## Quick start

Requirements: Node.js 22 or newer, npm, a Cloudflare account, and a Discord
application installed in a test server.

1. Install dependencies:

       npm install

2. Copy the local environment template:

       Copy-Item .dev.vars.example .dev.vars

3. Fill in the Discord application ID, test guild ID, public key, and bot token.
   Never commit <code>.dev.vars</code> or paste its token into logs/issues.

4. Apply the local D1 migration:

       npm run db:migrate:local

5. Start the Worker:

       npm run dev

Discord cannot call localhost directly. Local mode is useful for health,
migration, and automated testing; deploy for Discord endpoint validation.

## Configuration

| Variable or binding | Secret | Purpose |
| --- | --- | --- |
| <code>DB</code> | No | D1 binding for all tenant-scoped workflow state. |
| <code>DISCORD_APPLICATION_ID</code> | No | Discord application and command registration. |
| <code>DISCORD_TEST_GUILD_ID</code> | No | Immediate guild-scoped command registration. |
| <code>DISCORD_PUBLIC_KEY</code> | No | Ed25519 verification for every interaction. |
| <code>DISCORD_BOT_TOKEN</code> | **Yes** | Discord REST publication, role, reminder, and registration calls. |

Discord snowflakes and the application public key are public identifiers, not
credentials. The bot token and Cloudflare credentials are secrets.

## Deploy

Authenticate Wrangler, create a D1 database once, place its database ID in
<code>wrangler.jsonc</code>, then:

    npx wrangler secret put DISCORD_PUBLIC_KEY
    npx wrangler secret put DISCORD_BOT_TOKEN
    npm run db:migrate:remote
    npm run check
    npm run deploy
    npm run commands:register

Set the deployed Worker URL as the Discord application's Interactions Endpoint
URL. In the test server, run <code>/guild setup</code>, then
<code>/guild doctor</code>, and resolve every required failure before a real
weekly cycle. First-time setup leaves scheduling and role sync paused unless
their explicit options are enabled.

The checked-in Cron Trigger runs every 15 minutes. Per-guild local schedule and
time zone live in D1; repeated Cloudflare deliveries use conditional writes,
stable operation keys, and Discord nonces.

## Development commands

| Command | Purpose |
| --- | --- |
| <code>npm run check</code> | Generated-type check, TypeScript compile, and all tests. |
| <code>npm test</code> | Run the Vitest suite once. |
| <code>npm run test:watch</code> | Run tests in watch mode. |
| <code>npm run types</code> | Regenerate Cloudflare Worker types. |
| <code>npm run db:migrate:local</code> | Apply pending migrations to local D1. |
| <code>npm run db:migrate:remote</code> | Apply pending migrations to remote D1. |
| <code>npm run dev</code> | Run the Worker locally. |
| <code>npm run deploy</code> | Deploy Worker code, bindings, and Cron Trigger. |
| <code>npm run commands:register</code> | Replace test-guild command definitions. |

## Project layout

| Path | Purpose |
| --- | --- |
| <code>src/app.ts</code> | Slash-command, component, and scheduled routing. |
| <code>src/domain/</code> | Pure lifecycle and deterministic planning policies. |
| <code>src/storage/</code> | Bound-statement D1 repository. |
| <code>src/*-service.ts</code> | Weekly, reminder, and role orchestration. |
| <code>migrations/</code> | Versioned D1 schema migrations. |
| <code>test/</code> | Unit, policy, persistence, retry, and service tests. |
| <code>docs/</code> | Architecture decision, GM policy, and operations runbook. |
| <code>scripts/</code> | Discord command and repository utilities. |
| <code>assets/brand/</code> | Project artwork. |

## Operations, cost, and handoff

The runtime uses Cloudflare Workers, D1, and Cron Triggers and is designed to fit
within the platform's free tier for a single guild's weekly traffic, subject to
Cloudflare's current limits. There is no always-on VM. Keep the GitHub
organization, Discord application, Cloudflare account, and recovery factors
organization-owned with at least two maintainers so one volunteer's departure
does not become a financial or access emergency.

Read the [operations guide](docs/operations.md) for activation, failure recovery,
retention, credential rotation, and maintainer handoff. The
[GM priority policy](docs/gm-priority-policy.md) documents every deterministic
tie and edge case.

## Contributing and security

Contributions are welcome; read [CONTRIBUTING.md](CONTRIBUTING.md). Report
vulnerabilities privately according to [SECURITY.md](SECURITY.md), never in a
public issue.

## License

Available under the [MIT License](LICENSE).
