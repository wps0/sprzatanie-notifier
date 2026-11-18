/**
 * @fileoverview Wall-clock helpers for one fixed IANA time zone, built on
 * `Intl` only (no date library). Cron Triggers run in UTC while reminder rules
 * are written in local time, so every "what day and time is it in the flat?"
 * question goes through `localParts()`.
 */

/** A moment as seen on a wall clock in the flat. */
export interface LocalParts {
  /** Calendar date, `YYYY-MM-DD`. */
  readonly date: string;
  /** ISO weekday, Monday = 1 .. Sunday = 7. */
  readonly weekday: number;
  /** `HH:MM`, from `00:00` to `23:59` (never `24:00`). */
  readonly time: string;
}

/** Length of one reminder slot; rules use quarter-hour times. */
export const SLOT_MS = 15 * 60 * 1000;

const WEEKDAYS: Readonly<Record<string, number>> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      // 'h23' rather than hour12: false, which may print midnight as "24".
      hourCycle: 'h23',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    formatters.set(timeZone, format);
  }
  return format;
}

/** The wall-clock date, weekday and time of an instant in a time zone. */
export function localParts(
  epochMs: number,
  timeZone = 'Europe/Warsaw',
): LocalParts {
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of formatter(timeZone).formatToParts(new Date(epochMs))) {
    parts[part.type] = part.value;
  }
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAYS[parts.weekday ?? ''],
    time: `${parts.hour}:${parts.minute}`,
  };
}

/** Every slot instant `t` on the 15-minute grid with `fromMs < t <= toMs`. */
export function slotsBetween(fromMs: number, toMs: number): number[] {
  const slots: number[] = [];
  const first = Math.floor(fromMs / SLOT_MS) * SLOT_MS + SLOT_MS;
  for (let t = first; t <= toMs; t += SLOT_MS) slots.push(t);
  return slots;
}

/** ISO weekday (Monday = 1 .. Sunday = 7) of a `YYYY-MM-DD` date. */
export function isoWeekday(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay() || 7;
}
