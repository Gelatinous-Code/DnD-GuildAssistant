# Changelog

Notable changes to this project will be documented in this file.

The project follows [Semantic Versioning](https://semver.org/). Dates use the
<code>YYYY-MM-DD</code> format.

## Unreleased

### Added

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
