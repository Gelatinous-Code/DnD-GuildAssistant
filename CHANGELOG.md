# Changelog

Notable changes to this project will be documented in this file.

The project follows [Semantic Versioning](https://semver.org/). Dates use the
<code>YYYY-MM-DD</code> format.

## Unreleased

### Added

- Private, topic-based `/help` guidance for players, GMs, priority tokens, and
  weekly organizers.
- Audience-specific player, organizer, Discord setup, deployment, and operations
  guides with Discord and computer commands kept in separate paths.
- One-command Second Dawn guild setup that discovers existing GM/player signup
  channels and permanent audience roles, with staged audience-specific cards
  and no broad mentions.
- Weekly Tier 1 (levels 3–4), Tier 2 (levels 5–7), and Tier 3 (levels 8+)
  snapshots for GM and player signups, plus backup-GM availability that does not
  add planned table capacity.
- Per-tier planning, reservations, waitlists, promotions, table selection,
  priority seating, published cards, and versioned CSV export fields.
- Initial Cloudflare Worker Discord interaction endpoint.
- Signed request verification, endpoint PING/PONG handling, and ping command.
- Tests, type checking, and repository community health files.
- D1-backed per-guild setup, weekly lifecycle, native GM/player signups, and
  scheduled orchestration.
- Deterministic GM rotation and automatic 4–6-player table planning.
- Reviewable revisions, audited admin corrections/overrides, explicit
  publication, player table choice, table-specific waitlists, and promotion.
- Bot-owned GM role reconciliation, hierarchy diagnostics, and safe
  role-mention reminders with idempotent retry.
- Persisted scheduler/reminder recovery with leases, audited retry/skip controls,
  role-audience previews, and conditional organizer capacity escalation.
- Event-scoped overlap handling, superseded-card cleanup, current GM-history
  markers, and free-tier-safe bulk D1 planning writes.
- Versioned D1 migration, operations/retention documentation, and Cloudflare
  deployment configuration.
- Guided, update-only setup with explicit paused, review, and autopilot modes.
- Automatic publication, post-publication correction recovery, table-choice
  carry-forward, selection deadlines, final manifests, and archive sequencing.
- Private admin-only weekly roster CSV downloads with deterministic ordering,
  bounded attachments, and spreadsheet-formula neutralization.
- GitHub Actions command registration using the repository's Discord secret
  after command definitions change on the default branch.
