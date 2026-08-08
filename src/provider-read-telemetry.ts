const SAFE_REFERENCE = /^[A-Za-z0-9._:-]{1,100}$/;

export const SDG_CORRELATION_HEADER = "X-SDG-Correlation-ID";
export const GUILD_AUDIT_REFERENCE_HEADER = "X-Guild-Audit-Reference";

export type ProviderReadOperation =
  | "shop-catalog"
  | "session-summaries"
  | "player-journals"
  | "historical-summaries"
  | "progression-seasons";

type ProviderReadOutcome =
  | "success"
  | "authorization_failure"
  | "not_found"
  | "contract_incompatible"
  | "rate_limited"
  | "provider_rejection"
  | "upstream_failure"
  | "timeout"
  | "provider_failure";

type ProviderReadEvent = {
  event: "guild_assistant_provider_read";
  correlationId: string;
  operation: ProviderReadOperation;
  outcome: ProviderReadOutcome;
  latencyMs: number;
  status?: number;
  auditReference?: string;
};

export interface ProviderReadTelemetryOptions {
  now?: () => number;
  randomId?: () => string;
}

export function safeOpaqueReference(value: string | null): string | null {
  return value !== null && SAFE_REFERENCE.test(value) ? value : null;
}

export function correlationIdForRequest(
  request: Request,
  randomId: () => string = () => crypto.randomUUID(),
): string {
  return safeOpaqueReference(request.headers.get(SDG_CORRELATION_HEADER)) ?? randomId();
}

function outcomeForStatus(status: number): ProviderReadOutcome {
  if (status === 401 || status === 403) return "authorization_failure";
  if (status === 404) return "not_found";
  if (status === 406) return "contract_incompatible";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "upstream_failure";
  if (status >= 400) return "provider_rejection";
  return "success";
}

function errorOutcome(error: unknown): "timeout" | "provider_failure" {
  return error instanceof DOMException
      && (error.name === "TimeoutError" || error.name === "AbortError")
    ? "timeout"
    : "provider_failure";
}

function eventLevel(event: ProviderReadEvent): "log" | "warn" | "error" {
  if (
    event.outcome === "contract_incompatible"
    || event.outcome === "upstream_failure"
    || event.outcome === "timeout"
    || event.outcome === "provider_failure"
  ) return "error";
  if (event.outcome !== "success") return "warn";
  return "log";
}

function writeEvent(event: ProviderReadEvent): void {
  console[eventLevel(event)](event);
}

function appendExposedHeader(headers: Headers, name: string): void {
  if (!headers.has("Access-Control-Allow-Origin")) return;
  const exposed = headers.get("Access-Control-Expose-Headers")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean) ?? [];
  if (!exposed.some((value) => value.toLowerCase() === name.toLowerCase())) {
    exposed.push(name);
  }
  headers.set("Access-Control-Expose-Headers", exposed.join(", "));
}

function responseWithDiagnosticHeaders(
  response: Response,
  correlationId: string,
): { response: Response; auditReference: string | null } {
  const headers = new Headers(response.headers);
  headers.set(SDG_CORRELATION_HEADER, correlationId);
  appendExposedHeader(headers, SDG_CORRELATION_HEADER);

  const auditReference = safeOpaqueReference(headers.get(GUILD_AUDIT_REFERENCE_HEADER));
  if (auditReference === null) {
    headers.delete(GUILD_AUDIT_REFERENCE_HEADER);
  } else {
    headers.set(GUILD_AUDIT_REFERENCE_HEADER, auditReference);
    appendExposedHeader(headers, GUILD_AUDIT_REFERENCE_HEADER);
  }

  return {
    response: new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    }),
    auditReference,
  };
}

export async function observeProviderRead(
  request: Request,
  operation: ProviderReadOperation,
  read: () => Promise<Response>,
  options: ProviderReadTelemetryOptions = {},
): Promise<Response> {
  const now = options.now ?? Date.now;
  const correlationId = correlationIdForRequest(request, options.randomId);
  const startedAt = now();
  try {
    const result = responseWithDiagnosticHeaders(await read(), correlationId);
    writeEvent({
      event: "guild_assistant_provider_read",
      correlationId,
      operation,
      outcome: outcomeForStatus(result.response.status),
      status: result.response.status,
      latencyMs: Math.max(0, now() - startedAt),
      ...(result.auditReference ? { auditReference: result.auditReference } : {}),
    });
    return result.response;
  } catch (error) {
    writeEvent({
      event: "guild_assistant_provider_read",
      correlationId,
      operation,
      outcome: errorOutcome(error),
      latencyMs: Math.max(0, now() - startedAt),
    });
    throw error;
  }
}
