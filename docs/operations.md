# Service maintainer operations

**Audience: the people who own the Discord application, Cloudflare account,
database, and deployments.** Weekly organizers should use the
[organizer guide](organizer-guide.md). Discord server owners should use
[Discord server setup](guild-setup.md).

D1 is the source of truth. Discord messages are views of that state. Never
repair a week by editing a bot message, clearing database rows, or asking members
to click controls in a special sequence.

## Ownership and service boundary

Keep these under guild or organization control with at least two maintainers:

- the Discord application and recovery access;
- the Cloudflare account, Worker, and D1 database;
- the GitHub repository and protected command-registration environment; and
- the password manager containing recovery credentials.

Normal operation uses a Cloudflare Worker, one D1 binding named `DB`, and the
Cron Trigger in `wrangler.jsonc`. No personal computer stays online. Raid Helper,
Google Sheets, and downloaded CSV files are outside the runtime and provide no
state back to the bot.

Production values belong in the right place:

| Value | Production location |
| --- | --- |
| `DISCORD_PUBLIC_KEY` | Cloudflare Worker secret |
| `DISCORD_BOT_TOKEN` | Cloudflare Worker secret; protected GitHub environment secret only when the registration workflow is used |
| `DISCORD_APPLICATION_ID` | Non-secret Worker/GitHub configuration |
| `DB` | D1 binding in `wrangler.jsonc` |

Never commit a token or include one in logs, issues, screenshots, pilot evidence,
or support messages.

## Operating handoff

The weekly organizer owns member-facing decisions in Discord. The maintainer is
needed when the problem involves deployment, command registration, Worker logs,
secrets, D1, or the scheduled trigger.

The maintainer should know these Discord checks:

1. `/guild automation mode:Paused confirm:True` stops scheduled phase changes.
2. `/week status` identifies the event, phase, and recent operation result.
3. `/guild doctor` identifies channel, permission, role, and hierarchy failures.

The full slash-command list is intentionally separate in the
[Discord command reference](discord-command-reference.md).

## Deploy an update

Merging code into GitHub does not update D1, deploy the Worker, or register
changed Discord commands. Deploy one reviewed commit from a clean checkout.

### 1. Record and validate the release

```powershell
git status --short
git rev-parse HEAD
npm ci
npm run db:migrate:local
npm run check
npx wrangler deploy --dry-run
npx wrangler whoami
npx wrangler d1 list
```

Stop if the worktree is unexpectedly dirty, a check fails, the Cloudflare
account is wrong, or the D1 name and UUID do not exactly match
`wrangler.jsonc`. Record the full commit SHA.

### 2. Pause installed guilds and back up D1

In every installed Discord server:

1. record the current mode from `/guild status`;
2. run `/guild automation mode:Paused confirm:True`; and
3. tell organizers there is a maintenance window.

For a non-empty database, export a timestamped backup outside the repository and
verify that it is not empty:

```powershell
New-Item -ItemType Directory -Force C:\tmp
$guildBackupStamp = Get-Date -Format "yyyyMMdd-HHmmss"
$guildBackupPath = "C:\tmp\dnd-guild-assistant-$guildBackupStamp.sql"
npx wrangler d1 export DB --remote --output $guildBackupPath
if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $guildBackupPath) -or (Get-Item -LiteralPath $guildBackupPath).Length -eq 0) { throw "D1 backup failed; stop the deployment." }
```

Keep the maintenance window open through migrations, deployment, and Discord
verification. Store and expire the backup according to guild policy.

### 3. Apply only pending migrations

```powershell
npx wrangler d1 migrations list DB --remote
npm run db:migrate:remote
npx wrangler d1 migrations list DB --remote
```

Wrangler's first list is the authority for what is pending. Do not guess from a
pull request or run selected SQL files manually. The final list must report no
pending migrations.

### 4. Deploy the same commit

```powershell
npm run deploy
npx wrangler deployments list
```

Open the reported Worker URL and require `status: ready`. Match the latest
deployment time and ID to the recorded commit.

### 5. Register changed commands

Registration happens after compatible migrations and Worker code are live. If
the command manifest did not change, skip this step.

For a commit on `main`, use **GitHub Actions → Register Discord commands → Run
workflow**. Supply each target Discord Server ID, the full deployed commit SHA,
and the deployment confirmation. The `discord-command-registration` environment
should be restricted to `main`, use a required reviewer when possible, and hold
`DISCORD_BOT_TOKEN` as an environment secret rather than a repository secret.

For an unmerged test deployment, register locally from the exact deployed
checkout using its ignored `.dev.vars`:

```powershell
npm run commands:register
```

### 6. Verify and reopen

In every installed server:

1. run `/ping`;
2. run `/guild status` and `/guild doctor`;
3. resolve every ❌ for enabled features; and
4. restore the recorded Review or Autopilot mode only after checks pass.

Leave a failing server Paused.

## Normal service behavior

The scheduler evaluates each guild's five local times and records a stable
operation before acting. Repeated delivery is a retry, not permission to create
a second event, plan, publication, reminder, final roster, role mutation, or
reward.

| Stage | Expected result |
| --- | --- |
| GM signup | The weekly post opens for GM volunteers. |
| Player signup | The same week opens for player interest. |
| Table planning | Signup order is snapshotted; Review waits for approval and Autopilot publishes. |
| Open seating | Unclaimed weekly capacity becomes first-come, first-served. |
| Game time and end | Table controls close, a final roster posts, and the week later archives. |

An organizer correction through `/week signup` is audited and regenerates or
supersedes the plan. Compatible table choices carry forward; incompatible ones
return to a deterministic waitlist or organizer review.

Member roles are never changed by the assistant. Optional reminders must allow
at most one successful send per scheduled occurrence unless
an administrator explicitly confirms a resend.

## Incident recovery

Start with a safe pause when automatic work or member notifications could make
the incident worse:

```text
/guild automation mode:Paused confirm:True
```

Then:

1. Capture sanitized `/week status` and `/guild doctor` output.
2. Record the event ID, phase, operation kind/key, and any stored Discord message
   ID. Do not record tokens or private message bodies.
3. Find the last successful D1 operation.
4. Correct one configuration, permission, credential, hierarchy, or service
   problem.
5. Retry exactly one supported step and inspect both status and Discord before
   another retry.
6. Back up D1 and obtain peer review before any manual data repair.

Do not reopen an archived week by editing D1. Use an explicit audited correction
flow when one exists; otherwise document the exception and handle it in the next
week.

### Symptom guide

| Symptom | Safe response |
| --- | --- |
| Every interaction is rejected | Verify the Discord endpoint and matching `DISCORD_PUBLIC_KEY`. Never bypass signature verification. |
| Health works but commands fail | Check structured Worker logs, the bot token, and `/guild doctor`. D1 remains authoritative. |
| A configured channel or role was deleted | Replace it through `/guild setup`, then rerun `/guild doctor`. |
| A scheduled open, lock, or final roster was missed | Fix the schedule/trigger problem, inspect `/week status`, then retry only that supported step. |
| Publication timed out | Check the stored publication and target channel, then repeat `/week publish`; do not create messages manually. |
| A reminder failed | Fix its channel or permission, then retry the same occurrence. Use intentional resend only for a deliberate second message. |
| A member role needs changing | A server admin changes it in Discord. The Guild Assistant never assigns or removes member roles. |
| D1 reports a missing table | Confirm the binding and remote migration list before retrying. |
| A final roster is missing | Restore channel permissions, inspect status, and retry only finalization. |
| A member's token message is missing | Check `/priority-admin diagnose`; message delivery does not create or erase the token. |
| A table thread or DM link is missing | Fix the parent-channel permissions, inspect `/table-thread-admin status`, then use a confirmed reasoned retry or recreate. |

## Credential recovery

If the Discord bot token is exposed:

1. pause automation if commands still work;
2. reset the token in the Discord Developer Portal;
3. update the Cloudflare Worker secret;
4. update the protected GitHub environment secret if it is used;
5. redeploy or verify the active Worker version as required; and
6. test `/ping`, one harmless private command, and command registration.

Invalidate and remove local copies. Never paste the old or new token into the
incident record.

A Public Key change must be coordinated between the Discord application and the
Cloudflare secret. Verify the interaction endpoint immediately afterward.

## Backups and exports

- Take a D1 export before migrations, destructive repair, retention work, or
  deletion.
- Test restores against a non-production database.
- `/week export` is a private portability snapshot, not a database backup and
  not a source of truth.
- A downloaded CSV or external spreadsheet is controlled outside the bot. It
  does not update D1 and should be access-limited and deleted on schedule.

## Data retention and deletion

Guild IDs, user IDs, display names, signup intent, assignments, attendance, and
notification recipients are member-identifying operational data. Use them only
for the weekly workflow, explainable rotation, recovery, and guild-requested
export.

| Data | Retention target after event |
| --- | ---: |
| Signups, plans, assignments, GM history, attendance, rewards, and seating decisions | 13 months |
| Audit metadata and publication revisions | 13 months |
| Completed operation request/result payloads | 90 days |
| Retired legacy role-lease records | 90 days |
| Reminder/DM delivery content and failure text | 30 days |
| Cloudflare logs | Shortest practical setting; at most 30 days for the MVP |

These targets are not yet enforced by a self-service purge command. Review them
at least quarterly with a tested, tenant-scoped process. Do not run broad ad hoc
SQL against production.

For a guild deletion request:

1. authenticate an authorized guild owner through a second channel;
2. pause scheduling and reminders for that guild;
3. offer `/week export` where appropriate and explain backup retention;
4. verify the exact guild ID and take a recovery backup;
5. delete that one tenant root in a reviewed transaction so foreign-key cascades
   remove its operational rows; and
6. verify no rows remain for that guild and let backups expire on schedule.

For an individual request, scope every query by both guild ID and user ID. Remove
or pseudonymize member identifiers as policy permits and explain that deletion
resets the history available to GM rotation. Never target a user ID globally
without confirming every guild scope.

## Maintainer handoff

- Transfer Discord, Cloudflare, GitHub, password-manager, and recovery-factor
  access; do not merely share one person's login.
- Review the Worker, D1 binding, scheduled trigger, command manifest, secrets,
  installed guilds, automation modes, and last successful weekly cycle.
- Demonstrate a non-production backup/restore, token rotation, `/guild doctor`,
  one safe retry, reminder disablement, and role dry run.
- Transfer the retention calendar and sanitized open incidents.
- Confirm the successor can pause every guild and restore its recorded mode.
