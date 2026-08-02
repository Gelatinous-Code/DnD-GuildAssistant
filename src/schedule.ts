import { Temporal } from "@js-temporal/polyfill";

export interface WeeklySchedule {
  /** ISO weekday: Monday = 1, Sunday = 7. */
  weekday: number;
  /** Guild-local time in 24-hour HH:mm format. */
  time: string;
  timeZone: string;
}

export interface WeeklyMoment {
  /** ISO weekday: Monday = 1, Sunday = 7. */
  weekday: number;
  /** Guild-local time in 24-hour HH:mm format. */
  time: string;
}

export interface WeeklyCadence {
  timeZone: string;
  game: WeeklyMoment;
  gmSignup: WeeklyMoment;
  playerSignup: WeeklyMoment;
  tablePublish: WeeklyMoment;
  openSeating: WeeklyMoment;
}

export interface WeeklyCadenceWindows {
  startsAt: string;
  gmSignupOpensAt: string;
  playerSignupOpensAt: string;
  tablesPublishAt: string;
  openSeatingAt: string;
}

export const NEW_DAWN_CADENCE: WeeklyCadence = {
  timeZone: "America/Denver",
  gmSignup: { weekday: 3, time: "17:00" },
  playerSignup: { weekday: 4, time: "17:00" },
  tablePublish: { weekday: 6, time: "17:00" },
  openSeating: { weekday: 1, time: "17:00" },
  game: { weekday: 2, time: "18:00" },
};
export interface WeeklyCadenceConfiguration {
  timezone: string;
  weeklyDay: number;
  weeklyTime: string;
  gmSignupDay?: number | null;
  gmSignupTime?: string | null;
  playerSignupDay?: number | null;
  playerSignupTime?: string | null;
  tablePublishDay?: number | null;
  tablePublishTime?: string | null;
  openSeatingDay?: number | null;
  openSeatingTime?: string | null;
}

/** Returns null for legacy guild rows that have not explicitly saved a staged cadence. */
export function cadenceFromConfig(
  config: WeeklyCadenceConfiguration,
): WeeklyCadence | null {
  if (
    config.gmSignupDay == null || !config.gmSignupTime ||
    config.playerSignupDay == null || !config.playerSignupTime ||
    config.tablePublishDay == null || !config.tablePublishTime ||
    config.openSeatingDay == null || !config.openSeatingTime
  ) return null;
  return {
    timeZone: config.timezone,
    game: { weekday: config.weeklyDay, time: config.weeklyTime },
    gmSignup: { weekday: config.gmSignupDay, time: config.gmSignupTime },
    playerSignup: { weekday: config.playerSignupDay, time: config.playerSignupTime },
    tablePublish: { weekday: config.tablePublishDay, time: config.tablePublishTime },
    openSeating: { weekday: config.openSeatingDay, time: config.openSeatingTime },
  };
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

function validateMoment(moment: WeeklyMoment, label: string): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(moment.weekday) || moment.weekday < 1 || moment.weekday > 7) {
    errors.push(`${label} weekday must be an integer from 1 (Monday) through 7 (Sunday)`);
  }
  if (!TIME_PATTERN.test(moment.time)) {
    errors.push(`${label} time must use 24-hour HH:mm format`);
  }
  return errors;
}

function localMomentBefore(
  startsAt: Temporal.ZonedDateTime,
  moment: WeeklyMoment,
): Temporal.ZonedDateTime {
  const daysBefore = (startsAt.dayOfWeek - moment.weekday + 7) % 7;
  const [hour, minute] = moment.time.split(":").map(Number) as [number, number];
  let date = startsAt.toPlainDate().subtract({ days: daysBefore });
  let value = date.toZonedDateTime({
    timeZone: startsAt.timeZoneId,
    plainTime: { hour, minute },
  });
  if (Temporal.ZonedDateTime.compare(value, startsAt) >= 0) {
    date = date.subtract({ days: 7 });
    value = date.toZonedDateTime({
      timeZone: startsAt.timeZoneId,
      plainTime: { hour, minute },
    });
  }
  return value;
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

export function cadenceWindowsForStart(
  cadence: WeeklyCadence,
  startsAt: string | Temporal.Instant,
): WeeklyCadenceWindows {
  const errors = validateWeeklyCadence(cadence, false);
  if (errors.length > 0) throw new Error(errors.join("; "));
  const instant = typeof startsAt === "string" ? Temporal.Instant.from(startsAt) : startsAt;
  const localStart = instant.toZonedDateTimeISO(cadence.timeZone);
  return {
    startsAt: instant.toString(),
    gmSignupOpensAt: localMomentBefore(localStart, cadence.gmSignup).toInstant().toString(),
    playerSignupOpensAt: localMomentBefore(localStart, cadence.playerSignup).toInstant().toString(),
    tablesPublishAt: localMomentBefore(localStart, cadence.tablePublish).toInstant().toString(),
    openSeatingAt: localMomentBefore(localStart, cadence.openSeating).toInstant().toString(),
  };
}

export function cadenceWindows(
  cadence: WeeklyCadence,
  after: string | Temporal.Instant = Temporal.Now.instant(),
): WeeklyCadenceWindows {
  const startsAt = nextWeeklyOccurrence(
    { ...cadence.game, timeZone: cadence.timeZone },
    after,
  );
  return cadenceWindowsForStart(cadence, startsAt);
}

export function validateWeeklyCadence(
  cadence: WeeklyCadence,
  validateOrder = true,
): string[] {
  const errors = validateTimeZone(cadence.timeZone)
    ? []
    : [`time zone '${cadence.timeZone}' is not a valid IANA time zone`];
  errors.push(
    ...validateMoment(cadence.gmSignup, "GM signup"),
    ...validateMoment(cadence.playerSignup, "player signup"),
    ...validateMoment(cadence.tablePublish, "table publication"),
    ...validateMoment(cadence.openSeating, "open seating"),
    ...validateMoment(cadence.game, "game"),
  );
  if (errors.length > 0 || !validateOrder) return errors;

  const sampleStart = nextWeeklyOccurrence(
    { ...cadence.game, timeZone: cadence.timeZone },
    "2026-01-01T00:00:00Z",
  );
  const windows = cadenceWindowsForStart(cadence, sampleStart);
  const ordered = [
    windows.gmSignupOpensAt,
    windows.playerSignupOpensAt,
    windows.tablesPublishAt,
    windows.openSeatingAt,
    windows.startsAt,
  ].map(Date.parse);
  if (ordered.some((value, index) => index > 0 && value <= ordered[index - 1])) {
    errors.push("weekly cadence must run in this order: GM signup, player signup, table publication, open seating, game");
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
