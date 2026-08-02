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

## Start here

Choose the guide that matches what you are trying to do:

| Goal | Start with |
| --- | --- |
| Create/connect the Discord application, Cloudflare Worker, and D1 database | [First deployment: Discord and Cloudflare](docs/first-deployment.md) |
| The bot responds to `/ping`; configure a Discord server | [Configure a Discord guild](docs/guild-setup.md) |
| Validate a deployed release in a disposable server | [Test-guild go-live pilot](docs/test-guild-pilot.md) |
| The pilot passed; activate the real guild | [Promote the tested bot to the real guild](docs/real-guild-go-live.md) |
| Operate, recover, back up, or hand off an existing deployment | [Operations guide](docs/operations.md) |
| Change the code locally | [Contributing guide](CONTRIBUTING.md) and **Local development** below |

The shortest safe Discord-admin path, after deployment, is:

1. Run `/ping`.
2. Run `/guild setup channel:#guild-assistant-test`.
3. Run `/guild setup` again and confirm the time zone, weekly schedule, signup
   window, and table sizes.
4. Run `/guild status`, then `/guild doctor`; fix every ❌.
5. Leave automation Paused and complete the disposable-server pilot. The pilot
   turns on Review and Autopilot at controlled points.
6. After a PASS, follow the separate real-guild promotion guide.

The [guild setup guide](docs/guild-setup.md) explains every `/guild setup`
option, default, optional role, permission, and expected result.

## Functional MVP

The native weekly workflow is implemented end to end:

- Guided, resumable per-server Discord setup, sanitized status, and actionable
  doctor commands. Starting values can be reviewed and changed one setting at a time.
- Time-zone-aware weekly event creation across daylight-saving changes.
- Explicit draft, open, locked, planned, published, archived, and cancelled
  lifecycle state with audited, idempotent transitions.
- Native GM/player/withdraw buttons backed by D1, plus audited admin corrections.
- Deterministic GM rotation using fewest prior selections, oldest/never selected,
  signup time, and Discord ID tie-breaks.
- Deterministic table sizing that prefers six seats and reduces to five or four
  when more GMs are viable.
- Reviewable draft revisions with audited table-name, capacity, and GM overrides.
- Paused, review, and autopilot modes. Autopilot creates/opens the week, sends
  configured reminders, locks, plans, publishes, finalizes, and archives it;
  review mode pauses for an organizer to approve publication.
- Idempotent publication, Discord-enforced message nonces, and concurrency
  guards.
- Player table choice/change/leave, atomic capacity enforcement, table-specific
  waitlists, and deterministic promotion. Selection closes at game time and the
  bot posts a final Discord manifest for the session.
- Organizer-confirmed actual session attendance, including cancellation,
  no-show, substitute, walk-in, and append-only correction outcomes. One
  eligible completed DM session awards exactly two idempotent DM priority
  tokens; publishing or archiving alone awards nothing.
- Explicit private priority preview/confirmation, deterministic full-table
  displacement and promotion, close-time redemption/release, cancellation
  refunds, expiration, compatible-plan carry-forward, and sanitized admin
  diagnostics.
- Durable private lifecycle DMs with configurable pre-expiration reminders,
  blocked-DM handling, and conservative ambiguous-delivery quarantine.
- Audited late admin corrections that regenerate the plan and carry forward
  valid player table choices when the table and its capacity still allow them.
- Bot-owned weekly GM role leases that preserve every manually assigned role.
- Safe configured-role reminders, aggregate capacity warnings, atomic claims,
  one-occurrence cooldowns, conditional organizer escalation, capped
  retry/backoff, expiry, and explicit intentional resend.
- A 15-minute scheduled orchestration pass with structured logs and isolated
  failures.
- Versioned D1 migrations and comprehensive automated tests.

Raid Helper can remain beside the assistant for the broad gaming-interest poll
or unrelated events during the pilot. It is not a dependency: Guild Assistant
never scrapes another bot or depends on private Raid Helper behavior. See the
[interoperability decision](docs/decisions/0001-raid-helper-boundary.md).

`/week export` provides an admin-only, private, formula-safe CSV snapshot for
portability, backup, or ad hoc analysis. It is not a weekly operating step and
the bot needs no Google account or credentials. D1 remains the source of truth
and Discord remains the member-facing workflow; an optional spreadsheet is only
an external copy. See the [export boundary](docs/decisions/0002-export-boundary.md).

## Discord commands

Admin commands require Manage Server and return private responses.

| Command | Purpose |
| --- | --- |
| <code>/ping</code> | Verify the signed interaction endpoint. |
| <code>/guild setup</code> | Show the guided setup dashboard or update only the supplied channel, role, time-zone, schedule, or table-policy settings. |
| <code>/guild automation</code> | Explicitly select paused, review, or autopilot mode and optional reminder/role automation. |
| <code>/guild status</code> | Show sanitized effective configuration and current weekly state. |
| <code>/guild doctor</code> | Check channels, permissions, role existence, and hierarchy. |
| <code>/week open</code> | Open the next scheduled or explicitly dated signup. |
| <code>/week status</code> | Show the current phase, counts, revision, delivery state, and capacity risk. |
| <code>/week signup</code> | Record an audited late signup, cancellation, or admin correction. |
| <code>/week lock</code> | Lock the signup snapshot. |
| <code>/week plan</code> | Generate or regenerate a deterministic draft revision. |
| <code>/week override</code> | Change one draft table's name, capacity, or active GM with an audit reason. |
| <code>/week publish</code> | Explicitly publish the reviewed draft. |
| <code>/week export</code> | Download a private, formula-safe CSV snapshot for portability or backup. |
| <code>/week retry</code> | Recover publication, open, lock/plan, reminder, finalization, or role work safely. |
| <code>/week skip</code> | Confirm an audited skip of one scheduled open, lock, reminder, publication, finalization, or archive occurrence. |
| <code>/week cancel</code> | Cancel an unfinished/published week with an audit reason. |
| <code>/week archive</code> | Close the week and reconcile assistant-owned roles. |
| <code>/roles sync</code> | Preview or apply weekly GM role reconciliation. |
| <code>/reminder configure</code> | Save or disable the pre-lock rule and show a private rendered confirmation. |
| <code>/reminder send</code> | Send once now or explicitly request an intentional resend. |
| <code>/session status</code> / <code>attendance</code> / <code>confirm</code> | Privately record actual archived-table outcomes and reconcile the DM reward. |
| <code>/priority status</code> / <code>use</code> / <code>release</code> | Privately view, explicitly confirm, or release a member's DM priority token. |
| <code>/priority-admin diagnose</code> | Return a sanitized private trace plus admin-only correction/refund references. |
| <code>/priority-admin correct</code> / <code>refund</code> | Append an authorized, reasoned reward correction or exceptional token refund. |
| <code>/priority-admin configure</code> | Configure or disable the private pre-expiration reminder. |

Members use signup/table buttons plus the private `/priority` command; they do
not need admin permissions.

## Discord permissions

Install with the <code>applications.commands</code> and <code>bot</code> scopes.
Grant only:

- View Channels
- Send Messages
- Embed Links
- Read Message History
- Manage Roles, only for weekly GM role automation
- Attach Files in a channel only when admins will invoke <code>/week export</code>

Do not grant Administrator. Put the bot's integration role above the normal
weekly GM role. If reminders must notify a role, enable **Allow anyone to
@mention this role** for that configured role.

The bot constructs <code>allowed_mentions</code> explicitly. It never enables
<code>@everyone</code>, <code>@here</code>, arbitrary users, or undeclared roles.

## Local development

Local development is not Discord installation: Discord cannot call localhost
without a public tunnel. Use it for tests, local D1, and implementation work.

Requirements: Node.js 22 or newer and npm.

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Fill `.dev.vars` with the Discord application ID, test Server ID, public key,
and bot token. Never commit that file or paste its token into logs or issues.
For a real Discord endpoint, follow the first-deployment guide and deploy the
Worker.

## Runtime configuration

| Variable or binding | Sensitive? | Deployed Worker location | Command-registration location |
| --- | --- | --- | --- |
| <code>DB</code> | No | D1 binding in <code>wrangler.jsonc</code> | Not used |
| <code>DISCORD_APPLICATION_ID</code> | No | Worker variable in <code>wrangler.jsonc</code> | Required GitHub environment/repository variable, or local <code>.dev.vars</code> |
| <code>DISCORD_TEST_GUILD_ID</code> | No | Not used by the runtime | Default local registration target in <code>.dev.vars</code> |
| <code>DISCORD_GUILD_ID</code> | No | Not used by the runtime | GitHub workflow input or one-command local override for the target guild |
| <code>DISCORD_PUBLIC_KEY</code> | No, but integrity-critical | Cloudflare Worker secret | Not used |
| <code>DISCORD_BOT_TOKEN</code> | **Yes** | Cloudflare Worker secret | Protected GitHub environment secret, or local <code>.dev.vars</code> |

The Cloudflare secret store, GitHub Actions secret store, and local
`.dev.vars` file are independent. Saving a value in one does not populate the
others. Configure every column used by your chosen runtime and registration
path.

## Release deployment summary

Do not begin with “merge the PR” or guess migration filenames. From the exact
reviewed commit you intend to deploy:

1. Record the commit, run `npm run check`, and run a Wrangler deploy dry run.
2. Verify the Cloudflare account and exact D1 name/UUID.
3. Back up a non-empty D1 database outside the repository.
4. Ask `npx wrangler d1 migrations list DB --remote` which migrations are
   pending, then apply that reported set.
5. Deploy the same reviewed commit and verify the Worker health URL.
6. Register commands from the exact deployed commit, verify the Discord
   interaction endpoint, then run `/ping` and
   `/guild doctor`.

This is only an orientation. The authoritative commands, secret branches,
Discord Portal screens, and checkpoints are in [First deployment](docs/first-deployment.md)
for a brand-new environment and [Operations](docs/operations.md#deploy-an-update-to-an-existing-worker)
for an existing Worker update. The
checked-in `wrangler.jsonc` deploys the D1 binding and a 15-minute Cron Trigger.
Per-guild local schedule and time zone live in D1; repeated Cloudflare
deliveries use conditional writes, stable operation keys, and Discord nonces.

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
| <code>npm run commands:register</code> | Replace guild-scoped commands for the explicit/local target guild. |

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
retention, credential rotation, and maintainer handoff. The existing
[GM priority policy](docs/gm-priority-policy.md) documents deterministic GM
selection, while the [DM priority token policy](docs/dm-priority-token-policy.md)
defines completed-session rewards and priority player seats.

Use the [DM priority operations runbook](docs/dm-priority-operations.md) for
attendance confirmation, disputes, lifecycle delivery, and go-live recovery.

## Contributing and security

Contributions are welcome; read [CONTRIBUTING.md](CONTRIBUTING.md). Report
vulnerabilities privately according to [SECURITY.md](SECURITY.md), never in a
public issue.

## License

Available under the [MIT License](LICENSE).
