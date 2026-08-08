# Website management read API

The website configurator reads Guild Assistant configuration through the
internal `WebsiteManagementApi` Cloudflare service-binding entrypoint. The
entrypoint has no public `fetch` method and is not callable from browser code.
Discord commands remain the operational fallback.

## Available methods

- `describeManagementContract` returns supported versions, safe field/help
  metadata, diagnostic metadata, and settings that remain deployer-only.
- `getEffectiveConfiguration` returns the effective schedule, channels, roles,
  table policy, automation mode, pre-lock reminder state, setup completeness,
  warnings, and an opaque configuration revision.
- `getDiagnostics` returns sanitized channel, role, permission, schedule,
  table, reminder, and automation checks for that same revision.

`previewConfiguration` and `applyConfiguration` remain reserved for issue #60.
They are deliberately absent from the entrypoint until revision checks,
validation, confirmation, idempotency, and mutation audit are implemented.

## Request and authorization

Every method accepts exactly the envelope defined in
[`contracts/website-management.v1.json`](../contracts/website-management.v1.json):

```json
{
  "contractVersion": "website-management.v1",
  "guildId": "123456789012345678",
  "discordAccessToken": "short-lived Discord OAuth access token",
  "correlationId": "2bf597aa-8317-4fb4-bbc1-27ce88b6304a"
}
```

Guild Assistant verifies the token with Discord on every call and requires the
currently configured Administrator role. A stale website session, GM role, or
caller-supplied identity never grants access. Discord verification failures
fail closed. The OAuth token is not stored, logged, or returned.

Successful and failed calls return structured `ok`, `correlationId`, and
`cachePolicy` fields. Failures contain only a stable error code and, for
throttling, `retryAfterSeconds`. The website's HTTP route must enforce the
returned private/no-store policy because RPC responses do not carry HTTP
headers.

## Resource safety and reconciliation

Channel and role values expose display names plus provider-issued SHA-256
opaque references. Raw Discord channel and role IDs, bot credentials, D1 rows,
member history, and exception details are excluded. `/guild status`,
`/guild doctor`, the configuration response, and the diagnostics response use
the same effective-configuration and revision helpers so values can be
reconciled during rollout.

Rate limits use D1 migration `0026_website_management_rate_limits.sql` and are
scoped independently by guild, verified Discord user, and method. Apply that
migration before enabling a website service binding to this entrypoint.

The consuming Worker should bind to service
`dnd-new-dawn-guild-assistant` with entrypoint `WebsiteManagementApi`; it must
keep the binding and Discord token server-side. Provider deployment precedes
consumer deployment, as required by ADR 0003.
