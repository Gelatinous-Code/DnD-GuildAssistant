# Guild Assistant documentation

Pick the sentence that describes you. Each path intentionally uses the tools
for that role only.

## I play or run games

Read the [player and GM guide](player-guide.md).

You will use Discord buttons and, occasionally, `/help` or `/priority`. You do
not need this repository, Cloudflare, Node.js, npm, a bot token, or a database.

## I organize the weekly event

Read the [organizer guide](organizer-guide.md), then keep the
[Discord command reference](discord-command-reference.md) nearby.

This path stays inside Discord. It covers checking the week, reviewing tables,
recording attendance, and stopping automation safely.

## I manage the Discord server

If `/ping` already answers, use [Discord server setup](guild-setup.md). It covers
the channel, schedule, table sizes, optional roles, permissions, and automation
mode without requiring a terminal.

If `/ping` does not exist or does not answer, send the
[first-deployment guide](first-deployment.md) to the person responsible for
hosting the bot.

## I deploy or maintain the service

- [First deployment](first-deployment.md) — create a separate Discord app,
  Worker, and D1 database and connect them.
- [Test-server pilot](test-guild-pilot.md) — release acceptance in a disposable
  Discord server.
- [Real-server go-live](real-guild-go-live.md) — hand the tested bot to the real
  server without mixing test and production setup.
- [Operations](operations.md) — updates, backup, incident recovery, retention,
  credential rotation, and maintainer handoff.

These are the only user guides that contain computer or cloud commands.

## I change the code

Use [CONTRIBUTING.md](../CONTRIBUTING.md) for local development and
[RELEASING.md](../RELEASING.md) for release preparation.

Technical design and policy references:

- [Weekly game tiers](game-tiers.md)
- [GM selection policy](gm-priority-policy.md)
- [Session completion policy](session-completion.md)
- [Session summaries](session-summaries.md)
- [Player character journals](player-journals.md)
- [Historical summary import](historical-session-import.md)
- [Protected website summary API](website-read-model.md)
- [Website integration observability](integration-observability.md)
- [Website management API boundary](decisions/0003-website-management-boundary.md)
- [Website management read API](website-management-read-api.md)
- [Automatic pre-session table threads](table-threads.md)
- [Progression seasons and rollover](progression-seasons.md)
- [Character registry](characters.md)
- [Character progression ledger](progression.md)
- [Guild shop and gold purchases](guild-shop.md)
- [DM priority token policy](dm-priority-token-policy.md)
- [DM priority operations](dm-priority-operations.md)
- [Architecture decisions](decisions/)

## How to recognize a command

A command beginning with `/`, such as `/week status`, is entered in Discord.
A command mentioning `npm`, `npx`, `git`, or PowerShell is entered on a
deployer's or developer's computer. Those two kinds of commands are never mixed
in the player, GM, organizer, or Discord server setup paths.
