// Wall-clock helpers for one fixed IANA time zone, built on Intl only (no date library).
// Cron Triggers run in UTC; reminder rules are expressed in local time, so every
// "what day/time is it for the flat?" question goes through localParts().

const DOW = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const formatters = new Map();

function formatter(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat('en-GB', {
      timeZone, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }));
  }
  return formatters.get(timeZone);
}

/**
 * @returns {{ date: string, dow: number, time: string }}
 *   local calendar date "YYYY-MM-DD", ISO weekday (Mon=1 .. Sun=7) and "HH:MM" (00:00 .. 23:59)
 */
export function localParts(epochMs, timeZone = 'Europe/Warsaw') {
  const p = Object.fromEntries(formatter(timeZone).formatToParts(new Date(epochMs)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, dow: DOW[p.weekday], time: `${p.hour}:${p.minute}` };
}

export const SLOT_MS = 15 * 60 * 1000;

/** Every 15-minute grid instant t with fromMs < t <= toMs. */
export function slotsBetween(fromMs, toMs) {
  const out = [];
  for (let t = Math.floor(fromMs / SLOT_MS) * SLOT_MS + SLOT_MS; t <= toMs; t += SLOT_MS) out.push(t);
  return out;
}

/** ISO weekday (Mon=1 .. Sun=7) of a "YYYY-MM-DD" date. */
export function isoWeekday(isoDate) {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay() || 7;
}
