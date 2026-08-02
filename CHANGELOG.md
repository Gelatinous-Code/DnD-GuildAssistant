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
