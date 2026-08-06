# Session summaries

The scheduled Worker treats each ended, archived table in the final roster as completed unless an administrator has recorded a different result. Completion awards the session rewards. The summary-request portion is implemented but disabled by default until guild administrators approve and configure an incentive; enabling it creates one request for the actual DM recorded on that completion revision.

## DM workflow

The bot sends the DM a private **Write session summary** button. The button opens a Discord form containing:

- a required player-facing summary;
- the required area or location;
- optional important events;
- optional bonus gold or items; and
- optional other notes.

The on-time deadline is 72 hours after the scheduled session end. An unsubmitted summary normally receives one reminder 48 hours after the session end. If an administrator creates a corrected completion after that point, its reminder is delayed until at least 24 hours after the new prompt. Discord delivery uses a stable idempotency key, so a retry does not intentionally create a second prompt.

The first successful submission opens a seven-day edit window. Reopening the same DM button prefills the current answers. Each changed submission appends an immutable content revision while the summary row points to the current version.

Only the Discord account recorded as the actual DM can open or submit the form. A correction that cancels the session or supersedes its completion revision makes old buttons inactive and stops outstanding delivery attempts. A corrected completed revision can create a new request for its recorded DM.

## Publication and incentives

Submitted summaries are structured for the guild website through the protected [website read model](website-read-model.md). Public readers should include only submitted, visible summaries attached to the current completed session revision. Pending forms, delivery failures, Discord interaction tokens, and attendance details are not public content.

The database records whether the first submission met the deadline, but **no gold, XP, priority token, or other incentive is awarded yet**. Guild administrators have not approved a reward policy. That decision can be added later without changing the summary or revision records.

## Administrator corrections

Use `/session attendance` and `/session confirm` to record cancellations, substitute DMs, no-shows, walk-ins, and later corrections. These commands remain the authority for what actually happened; automatic completion is only the default for a finalized table with no contrary result.

If Discord cannot deliver a prompt, the outbox records a bounded error category and retries with backoff. Operators can inspect D1 delivery state without storing a bot token, message body, or interaction token in the summary tables.
