import { Temporal } from "@js-temporal/polyfill";

export interface WeeklySchedule {
  /** ISO weekday: Monday = 1, Sunday = 7. */
  weekday: number;
  /** Guild-local time in 24-hour HH:mm format. */
  time: string;
  timeZone: string;
}

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function validateTimeZone(timeZone: string): boolean {
  try {
    Temporal.Now.zonedDateTimeISO(timeZone);
    return true;
  } catch {
    return false;
  }
}

export function validateWeeklySchedule(schedule: WeeklySchedule): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(schedule.weekday) || schedule.weekday < 1 || schedule.weekday > 7) {
    errors.push("weekday must be an integer from 1 (Monday) through 7 (Sunday)");
  }
  if (!TIME_PATTERN.test(schedule.time)) {
    errors.push("time must use 24-hour HH:mm format");
  }
  if (!validateTimeZone(schedule.timeZone)) {
    errors.push(`time zone '${schedule.timeZone}' is not a valid IANA time zone`);
  }
  return errors;
}

/**
 * Returns the next guild-local weekly occurrence as an ISO UTC instant.
 * A time equal to `after` is considered already due, so the following week wins.
 * Temporal's compatible disambiguation advances nonexistent spring-forward times
 * and selects the earlier duplicate during fall-back.
 */
export function nextWeeklyOccurrence(
  schedule: WeeklySchedule,
  after: string | Temporal.Instant = Temporal.Now.instant(),
): string {
  const errors = validateWeeklySchedule(schedule);
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }

  const instant = typeof after === "string" ? Temporal.Instant.from(after) : after;
  const localNow = instant.toZonedDateTimeISO(schedule.timeZone);
  const [hour, minute] = schedule.time.split(":").map(Number) as [number, number];
  let daysAhead = (schedule.weekday - localNow.dayOfWeek + 7) % 7;

  let targetDate = localNow.toPlainDate().add({ days: daysAhead });
  let target = Temporal.ZonedDateTime.from(
    {
      timeZone: schedule.timeZone,
      year: targetDate.year,
      month: targetDate.month,
      day: targetDate.day,
      hour,
      minute,
    },
    { disambiguation: "compatible" },
  );

  if (Temporal.ZonedDateTime.compare(target, localNow) <= 0) {
    daysAhead = daysAhead === 0 ? 7 : daysAhead + 7;
    targetDate = localNow.toPlainDate().add({ days: daysAhead });
    target = Temporal.ZonedDateTime.from(
      {
        timeZone: schedule.timeZone,
        year: targetDate.year,
        month: targetDate.month,
        day: targetDate.day,
        hour,
        minute,
      },
      { disambiguation: "compatible" },
    );
  }

  return target.toInstant().toString();
}

export function occurrenceWindows(
  schedule: WeeklySchedule,
  after: string | Temporal.Instant,
  signupLeadDays: number,
  lockLeadHours: number,
  reminderLeadHours: number,
): {
  startsAt: string;
  signupOpensAt: string;
  locksAt: string;
  reminderAt: string;
} {
  const startsAt = Temporal.Instant.from(nextWeeklyOccurrence(schedule, after));
  return {
    startsAt: startsAt.toString(),
    signupOpensAt: startsAt.subtract({ hours: signupLeadDays * 24 }).toString(),
    locksAt: startsAt.subtract({ hours: lockLeadHours }).toString(),
    reminderAt: startsAt.subtract({ hours: reminderLeadHours }).toString(),
  };
}

export function eventKey(guildId: string, startsAt: string): string {
  return `${guildId}:${Temporal.Instant.from(startsAt).epochMilliseconds}`;
}
