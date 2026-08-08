# ADR 0003: Website management API boundary

- Status: Accepted
- Date: 2026-08-08
- Scope: Website configurator transport, authorization, and contract ownership

## Context

SecondDawnGuild.com will give guild administrators a safer view of Guild Assistant configuration and diagnostics, followed later by previewed and revision-guarded changes. The browser must not receive a bot token, a service credential, a raw D1 binding, or authority merely because the website rendered an Administrator page.

The existing member read APIs use HTTP-shaped service-binding calls. Configuration has a larger blast radius, so its boundary must not also be callable as a public HTTP route. Cloudflare recommends RPC for internal service-binding APIs and supports binding a caller directly to a named `WorkerEntrypoint`.

## Decision

Guild Assistant will export a named `WebsiteManagementApi` `WorkerEntrypoint`. The Second Dawn website Worker binds directly to that named entrypoint and invokes versioned RPC methods. No management method has a public HTTP route, and browser code cannot hold or call the binding.

The binding proves only that the caller is an explicitly configured Worker on the same Cloudflare account. It is not end-user authorization. Every RPC call also carries the visitor's short-lived Discord OAuth access token with `guilds.members.read`; Guild Assistant calls Discord for the current guild member and derives the actor from that response. It requires the currently configured Administrator role on every call and fails closed when Discord, guild configuration, or role verification is unavailable. Website session claims, submitted actor IDs, GM role, and prior authorization results are never trusted.

The versioned contract is [`contracts/website-management.v1.json`](../../contracts/website-management.v1.json). It defines the field inventory, safe value shapes, compatibility rules, opaque revision, diagnostics envelope, rate limits, stable errors, and excluded data. Issue #59 implements read-only configuration and diagnostics. Issue #60 implements preview and mutation. Issue #61 adds abuse controls and operational hardening without replacing the RPC and live-Discord authorization boundary.

## Threat model and controls

| Threat | Control |
| --- | --- |
| Browser calls Guild Assistant directly | Management exists only on the named RPC entrypoint; the website exposes a separately reviewed server route and never serializes the binding or OAuth token. |
| Token substitution or forged actor | Guild Assistant asks Discord for `/users/@me/guilds/{guild_id}/member` and derives the actor from the returned user. Caller-supplied actor IDs are forbidden. |
| Stale or removed Administrator role | Discord membership and the configured Administrator role are rechecked on every call before D1 reads or domain work. Failure denies access. |
| Confused deputy or cross-guild access | The requested guild scopes configuration, rate limits, Discord membership, revisions, and audit. The token holder must currently administer that same guild. |
| CSRF or hostile origin | The browser never calls the RPC entrypoint. The website owns same-origin request/CSRF controls before it invokes RPC; Guild Assistant still independently authorizes the Discord actor. |
| Replay or concurrent overwrite | Reads are side-effect free. Preview and apply require a current expected revision; apply also requires a unique idempotency key and explicit confirmation metadata. |
| CORS bypass | There is no public management HTTP route, so CORS is not an authorization mechanism. |
| SSRF through configured resources | Methods accept contract fields and provider-issued opaque Discord references, never caller-provided URLs. Guild Assistant resolves and validates Discord resources. |
| Secret or private-history disclosure | Responses use an allowlist. Raw Discord IDs, bot/OAuth credentials, environment settings, D1 rows, audit actors, and member histories are excluded. |
| Privilege escalation through future fields | Unknown methods and fields fail closed. Additive fields remain unavailable until contract metadata names their access, sensitivity, constraints, and permissions. |

## Compatibility and rollout

Provider changes land before consumers:

1. Guild Assistant publishes a new RPC method or additive contract version while older supported versions remain available.
2. The website adds support and detects unsupported versions before rendering or mutation.
3. Production traffic moves to the new version.
4. A later release may remove a deprecated major version only after both repositories and the operator runbook have moved.

Read-only methods ship first. Preview and apply cannot be enabled until their domain validation, revision, idempotency, confirmation, and audit requirements pass. Disabling the named entrypoint or removing the website binding leaves Discord commands and the scheduled weekly workflow operational.

## Consequences

The website can explain effective values and diagnostics without becoming a second configuration authority. A demoted administrator loses access on the next call. No separately rotated service secret is required for the Worker-to-Worker capability; Discord OAuth token handling and Cloudflare binding configuration still require normal deployment discipline.

Local end-to-end development must run both Workers with the website binding pointed at `WebsiteManagementApi`. Contract tests can run without Discord or production D1, but production acceptance still requires the test-guild cases tracked in #62.

## References

- [Cloudflare service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
- [Cloudflare service-binding RPC and named entrypoints](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/)
- [Cloudflare RPC visibility and security model](https://developers.cloudflare.com/workers/runtime-apis/rpc/visibility/)
