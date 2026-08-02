import type { DmPriorityCredit } from "./storage/priority-repository";

function compareCredits(left: DmPriorityCredit, right: DmPriorityCredit): number {
  return (
    left.expiresAt - right.expiresAt ||
    left.earnedAt - right.earnedAt ||
    left.creditId.localeCompare(right.creditId)
  );
}

function formatLocalDate(epochMilliseconds: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(epochMilliseconds));
}

/**
 * Tokens expire at an exclusive local-midnight boundary, so the member-facing
 * date is the preceding millisecond in the guild's configured time zone.
 */
export function priorityUsableThroughDate(expiresAt: number, timeZone: string): string {
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) {
    throw new RangeError("expiresAt must be a positive epoch-millisecond value");
  }
  if (!timeZone.trim()) throw new TypeError("timeZone cannot be empty");
  return formatLocalDate(expiresAt - 1, timeZone);
}

export function renderPriorityStatus(
  credits: readonly DmPriorityCredit[],
  timeZone: string,
): string {
  const available = credits
    .filter((credit) => credit.status === "available")
    .sort(compareCredits);
  const count = available.length;
  const lines = [
    "## DM Priority Tokens",
    `**${count} token${count === 1 ? "" : "s"} available**`,
  ];

  if (count === 0) {
    lines.push(
      "You do not currently have an unexpired token in this server.",
      "Viewing status never reserves or consumes a token.",
    );
    return lines.join("\n");
  }

  for (const credit of available) {
    lines.push(`- 1 usable through ${priorityUsableThroughDate(credit.expiresAt, timeZone)}`);
  }
  lines.push(
    "",
    "Your earliest-expiring token will be used first.",
    "One token guarantees one game seat after you have an active player signup and explicitly confirm a table.",
  );
  return lines.join("\n");
}

export interface PriorityConfirmationPreview {
  eventTitle: string;
  tableTitle: string;
  balance: number;
  creditExpiresAt: number;
  timeZone: string;
  tableIsFull: boolean;
}

export function renderPriorityConfirmation(input: PriorityConfirmationPreview): string {
  const lines = [
    "## Confirm DM Priority Token",
    `**Game:** ${input.eventTitle}`,
    `**Table:** ${input.tableTitle}`,
    `**Token:** usable through ${priorityUsableThroughDate(input.creditExpiresAt, input.timeZone)}`,
    `**Current balance:** ${input.balance} token${input.balance === 1 ? "" : "s"}`,
  ];
  if (input.tableIsFull) {
    lines.push(
      "",
      "⚠️ This table is full. Confirming priority can move the lowest-ranked standard request to this table's waitlist. The other member will be notified privately without seeing your token history.",
    );
  }
  lines.push(
    "",
    "Nothing is reserved until you press Confirm. The bot rechecks your signup, token, table, and deadline at confirmation time.",
  );
  return lines.join("\n");
}

export function renderPriorityUseOutcome(input: {
  tableTitle: string;
  assigned: boolean;
  waitlistPosition?: number | null;
  displaced: boolean;
  remainingCredits: readonly DmPriorityCredit[];
  timeZone: string;
}): string {
  const outcome = input.assigned
    ? `✅ Your token is reserved and your seat at **${input.tableTitle}** is protected.`
    : `Your priority request is first-tier waitlisted${
        input.waitlistPosition ? ` at position ${input.waitlistPosition}` : ""
      }. The reservation will be released if you are still unseated when selection closes.`;
  const displaced = input.displaced
    ? " A standard request was moved to the waitlist according to the published policy."
    : "";
  return `${outcome}${displaced}\n\n${renderPriorityStatus(input.remainingCredits, input.timeZone)}`;
}
