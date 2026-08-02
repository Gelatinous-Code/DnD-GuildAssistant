import { describe, expect, it } from "vitest";
import {
  renderPriorityDiagnostics,
  type PriorityDiagnosticCounts,
  type PriorityDiagnosticsReport,
} from "../src/priority-diagnostics";

function counts(): PriorityDiagnosticCounts {
  return {
    guildExists: true,
    sessions: {
      total: 1,
      revisions: 2,
      events: 4,
      rewardSync: { none: 0, pending: 0, synced: 1, failed: 0 },
    },
    grants: { total: 1, byStatus: { active: 1, corrected: 0 } },
    credits: {
      total: 2,
      byStatus: {
        available: 1,
        reserved: 0,
        redeemed: 1,
        expired: 0,
        corrected: 0,
      },
    },
    creditEvents: {
      total: 4,
      byAction: {
        granted: 2,
        reserved: 1,
        redeemed: 1,
        refunded: 0,
        expired: 0,
        corrected: 0,
      },
    },
    seating: {
      operations: 2,
      events: 3,
      byAction: {
        requested: 0,
        priority_requested: 1,
        displaced: 1,
        promoted: 1,
        reranked: 0,
        priority_released: 0,
        priority_redeemed: 0,
        left: 0,
        withdrawn: 0,
        cancelled: 0,
        carried_forward: 0,
        expired: 0,
      },
    },
    notifications: {
      total: 2,
      byStatus: {
        pending: 1,
        sending: 0,
        retry: 0,
        sent: 1,
        blocked: 0,
        failed: 0,
        uncertain: 0,
        cancelled: 0,
      },
    },
  };
}

describe("priority diagnostics rendering", () => {
  it("renders a private, correlated report below the Discord message limit", () => {
    const report: PriorityDiagnosticsReport = {
      scope: "member",
      generatedAt: 1_800_000_000_000,
      counts: counts(),
      ledgerReferences: {
        correctGrantIds: ["grant-actionable-1"],
        refundCreditIds: ["credit-actionable-1"],
        truncated: false,
      },
      traceTruncated: false,
      trace: Array.from({ length: 30 }, (_, index) => ({
        occurredAt: 1_800_000_000_000 - index,
        area: "credit" as const,
        action: index % 2 === 0 ? "redeemed" : "refunded",
        status: index % 2 === 0 ? "redeemed" : "available",
        entityRef: "credit-event-" + (index + 1),
        correlations: ["credit-" + (index + 1), "event-1"],
        actor: index % 2 === 0 ? "self" : "external",
        subject: "self",
        policyRevision: "dm-priority-v1",
        revision: index + 1,
        operationRevision: null,
        configRevision: null,
        detailCode: null,
        errorCode: null,
      })),
    };

    const rendered = renderPriorityDiagnostics(report, 900);
    expect(rendered.length).toBeLessThanOrEqual(900);
    expect(rendered).toContain("tenant-scoped");
    expect(rendered).toContain("credit-event-1 -> credit-1,event-1");
    expect(rendered).toContain("additional trace rows omitted");
    expect(rendered).toContain("grant_id: `grant-actionable-1`");
    expect(rendered).toContain(
      "credit_id: `credit-actionable-1`",
    );
  });

  it("defensively redacts free-form values even in an externally built report", () => {
    const secret = "TOP SECRET <@123> **ping**";
    const report: PriorityDiagnosticsReport = {
      scope: "event",
      generatedAt: 1_800_000_000_000,
      counts: counts(),
      ledgerReferences: {
        correctGrantIds: [secret, "grant-safe-2"],
        refundCreditIds: [secret, "credit-safe-2"],
        truncated: false,
      },
      traceTruncated: false,
      trace: [{
        occurredAt: 1_800_000_000_000,
        area: "notification",
        action: "seat_promoted",
        status: "sent",
        entityRef: secret,
        correlations: [secret],
        actor: secret,
        subject: secret,
        policyRevision: secret,
        revision: null,
        operationRevision: null,
        configRevision: 1,
        detailCode: secret,
        errorCode: 50_007,
      }],
    };

    const rendered = renderPriorityDiagnostics(report);
    expect(rendered).not.toContain("TOP SECRET");
    expect(rendered).not.toContain("<@123>");
    expect(rendered).toContain("redacted");
    expect(rendered).toContain("`grant-safe-2`");
    expect(rendered).toContain("`credit-safe-2`");
  });

  it("rejects output limits that are not valid Discord-sized private reports", () => {
    const report: PriorityDiagnosticsReport = {
      scope: "guild",
      generatedAt: 1_800_000_000_000,
      counts: counts(),
      ledgerReferences: {
        correctGrantIds: [],
        refundCreditIds: [],
        truncated: false,
      },
      trace: [],
      traceTruncated: false,
    };
    expect(() => renderPriorityDiagnostics(report, 499)).toThrow(RangeError);
    expect(() => renderPriorityDiagnostics(report, 2_001)).toThrow(RangeError);
  });
});
