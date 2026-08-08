# Website integration observability

Guild Assistant correlates its website read-model work with
SecondDawnGuild.com without using Discord or guild identity as diagnostic
context. This applies to the public shop catalog and the protected session
summary, player journal, historical summary, and progression season routes.

## Correlation headers

The website sends `X-SDG-Correlation-ID` with each provider request. Guild
Assistant accepts only 1–100 ASCII letters, digits, dots, underscores, colons,
and hyphens. A missing or invalid value is replaced with a new random UUID and
the safe value is returned on the response. An attacker-controlled invalid value
is never logged or reflected.

The correlation ID is diagnostic context only. Neither service may use it for
identity, authorization, idempotency, replay protection, cache partitioning, or
record lookup.

`X-Guild-Audit-Reference` is a separate optional diagnostic header. It uses the
same strict format and may be returned only when a route is tied to an existing
domain audit entry. Website reads do not create audit entries, so current read
routes normally omit it. A handler must not invent an audit reference merely to
populate the header.

## Structured provider event

Each matched read emits one `guild_assistant_provider_read` event. Its complete
custom field allowlist is:

- `event`
- `correlationId`
- `operation`
- `outcome`
- `status` when an HTTP response exists
- `latencyMs`
- `auditReference` when a validated domain reference exists

Operations are bounded route names, never raw paths. Outcomes distinguish
success, authorization denial, not found, contract incompatibility, rate
limiting, other rejection, upstream 5xx, timeout, and unexpected provider
failure. The website records `recovered` when a bounded retry succeeds; join
that event to the provider's successful event with the correlation ID.

Never add authorization headers, OAuth tokens, cookies, Discord user or guild
IDs, member or role data, catalog contents, filters, query values, raw URLs,
response bodies, character/session/item IDs, or exception messages to custom
telemetry.

## Retention and redaction boundary

These events go only to Cloudflare Workers observability. Guild Assistant does
not persist them in D1 or add them to domain audit history. Cloudflare account
log-retention and export settings govern their lifetime; operators should keep
the shortest period that supports incident response and apply the same field
allowlist to any external log destination.

Domain audit records have their own policy and must not be copied into provider
telemetry. Only an opaque validated audit reference may cross that boundary.

## Cross-repository troubleshooting

1. Obtain the correlation ID from the website error response or support report.
2. Filter SecondDawnGuild.com `guild_assistant_integration` events and Guild
   Assistant `guild_assistant_provider_read` events by that exact value.
3. Compare the bounded operation, outcome, status, attempt, and latency fields.
   Do not request a member token or reproduce the raw URL in logs.
4. If a validated audit reference is present, use it in the private domain audit
   tooling. Do not assume the correlation ID identifies the member or record.
5. For recovery, confirm the website's `recovered` event is paired with a
   successful provider event. For contract errors, compare deployed contract
   versions and roll back only the incompatible consumer or provider release.

The consumer-side retry, circuit, caching, and alert policy remains documented
in the SecondDawnGuild.com integration observability runbook. This provider
instrumentation does not change any read-model authorization, cache, or response
body contract.
