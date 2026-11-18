/** @fileoverview Polish date and text formatting. */

const MONTHS_GENITIVE = [
  'stycznia',
  'lutego',
  'marca',
  'kwietnia',
  'maja',
  'czerwca',
  'lipca',
  'sierpnia',
  'września',
  'października',
  'listopada',
  'grudnia',
];

const MONTHS_SHORT = [
  'sty',
  'lut',
  'mar',
  'kwi',
  'maj',
  'cze',
  'lip',
  'sie',
  'wrz',
  'paź',
  'lis',
  'gru',
];

/** Short weekday names, indexed by ISO weekday minus one. */
export const WEEKDAYS_SHORT = ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Ndz'];

/** Indexed by ISO weekday minus one. */
export const WEEKDAYS = [
  'poniedziałek',
  'wtorek',
  'środa',
  'czwartek',
  'piątek',
  'sobota',
  'niedziela',
];

interface DateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

function parts(isoDate: string): DateParts {
  const [year, month, day] = isoDate.split('-').map(Number);
  return {year, month, day};
}

/** "9–15 listopada", or "26 października – 1 listopada" across months. */
export function formatWeekRange(start: string, end: string): string {
  const from = parts(start);
  const to = parts(end);
  if (from.month === to.month) {
    return `${from.day}–${to.day} ${MONTHS_GENITIVE[to.month - 1]}`;
  }
  return (
    `${from.day} ${MONTHS_GENITIVE[from.month - 1]} – ` +
    `${to.day} ${MONTHS_GENITIVE[to.month - 1]}`
  );
}

/** "9–15 lis" or "26 paź – 1 lis". */
export function formatWeekShort(start: string, end: string): string {
  const from = parts(start);
  const to = parts(end);
  if (from.month === to.month) {
    return `${from.day}–${to.day} ${MONTHS_SHORT[to.month - 1]}`;
  }
  return (
    `${from.day} ${MONTHS_SHORT[from.month - 1]} – ` +
    `${to.day} ${MONTHS_SHORT[to.month - 1]}`
  );
}

/** ISO weekday (Mon=1 .. Sun=7) of a `YYYY-MM-DD` date. */
function isoWeekday(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay() || 7;
}

/** "do niedzieli, 15 listopada" style deadline, relative to today. */
export function formatDeadline(end: string, today: string): string {
  const days = Math.round((Date.parse(end) - Date.parse(today)) / 86_400_000);
  if (days < 0) return 'termin minął';
  if (days === 0) return 'termin mija dziś';
  if (days === 1) return 'termin mija jutro';
  const {day, month} = parts(end);
  const weekday = WEEKDAYS[isoWeekday(end) - 1];
  return `termin: ${weekday}, ${day} ${MONTHS_GENITIVE[month - 1]}`;
}

/** "dziś, 14:05" or "12 lis, 14:05" in the device's time zone. */
export function formatTimestamp(epochMs: number, now: number): string {
  const date = new Date(epochMs);
  const time = date.toLocaleTimeString('pl-PL', {
    hour: '2-digit',
    minute: '2-digit',
  });
  if (new Date(now).toDateString() === date.toDateString()) {
    return `dziś, ${time}`;
  }
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}, ${time}`;
}

export function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase('pl-PL') + text.slice(1);
}

/** Up to two initials of a name. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).slice(0, 2);
  return words.map(word => word.charAt(0).toLocaleUpperCase('pl-PL')).join('');
}
