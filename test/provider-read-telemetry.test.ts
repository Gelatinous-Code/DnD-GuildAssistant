import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GUILD_AUDIT_REFERENCE_HEADER,
  SDG_CORRELATION_HEADER,
  correlationIdForRequest,
  observeProviderRead,
  safeOpaqueReference,
} from "../src/provider-read-telemetry";

afterEach(() => {
  vi.restoreAllMocks();
});

function captureEvents(): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  for (const level of ["log", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((value: unknown) => {
      events.push(value as Record<string, unknown>);
    });
  }
  return events;
}

describe("provider read telemetry", () => {
  it("accepts only bounded safe opaque references", () => {
    expect(safeOpaqueReference("site.request_1:retry-2")).toBe("site.request_1:retry-2");
    expect(safeOpaqueReference("")).toBeNull();
    expect(safeOpaqueReference("a".repeat(101))).toBeNull();
    expect(safeOpaqueReference("unsafe value")).toBeNull();
    expect(safeOpaqueReference("unsafe\nvalue")).toBeNull();

    const generated = correlationIdForRequest(new Request("https://guild.example/read", {
      headers: { [SDG_CORRELATION_HEADER]: "attacker value" },
    }), () => "generated-safe-id");
    expect(generated).toBe("generated-safe-id");
  });

  it.each([
    [200, "success"],
    [304, "success"],
    [401, "authorization_failure"],
    [403, "authorization_failure"],
    [404, "not_found"],
    [406, "contract_incompatible"],
    [429, "rate_limited"],
    [500, "upstream_failure"],
    [503, "upstream_failure"],
  ] as const)("returns a safe correlation header and classifies HTTP %s", async (status, outcome) => {
    const events = captureEvents();
    let clock = 100;
    const request = new Request(
      "https://guild.example/api/v1/guilds/secret-guild/shop-catalog?query=secret-item",
      { headers: {
        Authorization: "Bearer secret-token",
        Cookie: "session=secret-cookie",
        [SDG_CORRELATION_HEADER]: "site-request-123",
      } },
    );
    const response = await observeProviderRead(
      request,
      "shop-catalog",
      async () => new Response(status === 304 ? null : "secret response body", {
        status,
        headers: {
          "Access-Control-Allow-Origin": "*",
          [GUILD_AUDIT_REFERENCE_HEADER]: "audit.safe:123",
        },
      }),
      { now: () => clock++ },
    );

    expect(response.headers.get(SDG_CORRELATION_HEADER)).toBe("site-request-123");
    expect(response.headers.get(GUILD_AUDIT_REFERENCE_HEADER)).toBe("audit.safe:123");
    expect(response.headers.get("Access-Control-Expose-Headers"))
      .toContain(SDG_CORRELATION_HEADER);
    expect(events).toEqual([{
      event: "guild_assistant_provider_read",
      correlationId: "site-request-123",
      operation: "shop-catalog",
      outcome,
      status,
      latencyMs: 1,
      auditReference: "audit.safe:123",
    }]);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("secret-cookie");
    expect(serialized).not.toContain("secret-guild");
    expect(serialized).not.toContain("secret-item");
    expect(serialized).not.toContain("secret response body");
  });

  it("replaces an invalid correlation ID and strips an invalid audit reference", async () => {
    const events = captureEvents();
    const response = await observeProviderRead(
      new Request("https://guild.example/read", {
        headers: { [SDG_CORRELATION_HEADER]: "attacker value" },
      }),
      "session-summaries",
      async () => new Response("ok", {
        headers: { [GUILD_AUDIT_REFERENCE_HEADER]: "bad audit value" },
      }),
      { now: () => 10, randomId: () => "replacement-safe-id" },
    );

    expect(response.headers.get(SDG_CORRELATION_HEADER)).toBe("replacement-safe-id");
    expect(response.headers.has(GUILD_AUDIT_REFERENCE_HEADER)).toBe(false);
    expect(JSON.stringify(events)).not.toContain("attacker value");
    expect(JSON.stringify(events)).not.toContain("bad audit value");
  });

  it("records a timeout without logging the exception message", async () => {
    const events = captureEvents();
    await expect(observeProviderRead(
      new Request("https://guild.example/read"),
      "progression-seasons",
      async () => { throw new DOMException("secret timeout details", "TimeoutError"); },
      { now: () => 10, randomId: () => "timeout-safe-id" },
    )).rejects.toMatchObject({ name: "TimeoutError" });

    expect(events).toEqual([{
      event: "guild_assistant_provider_read",
      correlationId: "timeout-safe-id",
      operation: "progression-seasons",
      outcome: "timeout",
      latencyMs: 0,
    }]);
    expect(JSON.stringify(events)).not.toContain("secret timeout details");
  });
});
