/**
 * @fileoverview Turns raw worksheet rows into the cleaning schedule.
 *
 * Expected layout, anchored on header texts rather than cell addresses:
 *
 *     | początek tygodnia | koniec tygodnia | <task 1> | <task 2> | … |
 *     | 2026-10-26        | 2026-11-01      | <person> | <person> | … |
 *
 * - The header row is the first row with a cell "początek tygodnia".
 * - Task columns are the consecutive non-empty header cells right of
 *   "koniec tygodnia"; everything after the first empty header is ignored.
 * - A header "title (details)" is split into title and details.
 * - A header made only of "?" (or "wolne") marks a free slot: shown in the
 *   app, never reminded.
 */

import type {Schedule, Task, Week} from '../shared/types.ts';
import type {CellValue, SheetRow} from './xlsx.ts';

const START_HEADER = 'początek tygodnia';
const END_HEADER = 'koniec tygodnia';
const DAY_MS = 24 * 60 * 60 * 1000;
/** Days between 1899-12-30 (Excel's day 0) and 1970-01-01. */
const EXCEL_EPOCH_OFFSET_DAYS = 25569;

const POLISH_LETTERS: Readonly<Record<string, string>> = {
  ą: 'a',
  ć: 'c',
  ę: 'e',
  ł: 'l',
  ń: 'n',
  ó: 'o',
  ś: 's',
  ź: 'z',
  ż: 'z',
};

/** Cell text with whitespace collapsed. */
function clean(value: CellValue | undefined): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalized(value: CellValue | undefined): string {
  return clean(value).toLowerCase();
}

/** "Łazienka i Żółć" → "lazienka-i-zolc". */
export function slugify(text: string): string {
  return normalized(text)
    .replace(/[ąćęłńóśźż]/g, letter => POLISH_LETTERS[letter])
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** An Excel serial day number or a date-like text → `YYYY-MM-DD`, or null. */
export function toIsoDate(value: CellValue | undefined): string | null {
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    const epochDays = Math.floor(value) - EXCEL_EPOCH_OFFSET_DAYS;
    return new Date(epochDays * DAY_MS).toISOString().slice(0, 10);
  }
  const text = clean(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dotted = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(text);
  if (dotted) {
    const [, day, month, year] = dotted;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return null;
}

/** `YYYY-MM-DD` shifted by a number of days. */
export function addDays(isoDate: string, days: number): string {
  const epochMs = Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS;
  return new Date(epochMs).toISOString().slice(0, 10);
}

function parseTaskHeader(value: CellValue | undefined, column: number): Task {
  const header = clean(value);
  const match = /^(.*?)\s*\((.*)\)\s*$/.exec(header);
  const title = clean(match ? match[1] : header);
  const free = /^\?+$/.test(title) || normalized(title) === 'wolne';
  return {
    key: free ? `free-${column}` : slugify(title) || `column-${column}`,
    title: free ? 'Wolne' : title,
    details: match ? clean(match[2]) : '',
    free,
  };
}

/** Gives repeated task keys a numeric suffix so that every key is unique. */
function withUniqueKeys(tasks: readonly Task[]): Task[] {
  const seen = new Set<string>();
  return tasks.map((task, index) => {
    const key = seen.has(task.key) ? `${task.key}-${index}` : task.key;
    seen.add(key);
    return {...task, key};
  });
}

/** Builds the schedule; throws when the sheet does not have the layout. */
export function buildSchedule(rows: readonly SheetRow[]): Schedule {
  const warnings: string[] = [];
  let headerIndex = -1;
  let startColumn = -1;
  for (let i = 0; i < rows.length && headerIndex < 0; i++) {
    for (const [column, value] of rows[i].cells) {
      if (normalized(value) === START_HEADER) {
        headerIndex = i;
        startColumn = column;
        break;
      }
    }
  }
  if (headerIndex < 0) {
    throw new Error(`schedule: header cell "${START_HEADER}" not found`);
  }
  const header = rows[headerIndex].cells;
  const hasEndColumn = normalized(header.get(startColumn + 1)) === END_HEADER;
  if (!hasEndColumn) {
    warnings.push(`brak kolumny "${END_HEADER}" — przyjęto tygodnie 7-dniowe`);
  }
  const firstTaskColumn = startColumn + (hasEndColumn ? 2 : 1);

  const headerTasks: Task[] = [];
  for (let column = firstTaskColumn; clean(header.get(column)); column++) {
    headerTasks.push(parseTaskHeader(header.get(column), column));
  }
  if (headerTasks.length === 0) {
    throw new Error('schedule: no task columns found');
  }
  const tasks = withUniqueKeys(headerTasks);

  const weeks: Week[] = [];
  const people: string[] = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const start = toIsoDate(row.cells.get(startColumn));
    if (!start) continue;
    let end = hasEndColumn ? toIsoDate(row.cells.get(startColumn + 1)) : null;
    if (!end || end < start) {
      if (hasEndColumn) {
        warnings.push(`wiersz ${row.r}: nieprawidłowy koniec tygodnia`);
      }
      end = addDays(start, 6);
    }
    const assignees = tasks.map((_, i) => {
      const name = clean(row.cells.get(firstTaskColumn + i));
      if (!name) return null;
      if (!people.includes(name)) people.push(name);
      return name;
    });
    weeks.push({start, end, assignees});
  }
  if (weeks.length === 0) throw new Error('schedule: no week rows found');
  weeks.sort((a, b) => (a.start < b.start ? -1 : 1));
  for (let i = 1; i < weeks.length; i++) {
    if (weeks[i].start <= weeks[i - 1].end) {
      warnings.push(
        `tygodnie ${weeks[i - 1].start} i ${weeks[i].start} nachodzą na siebie`,
      );
    }
  }
  return {tasks, people, weeks, warnings};
}

/** The week whose `[start, end]` range contains the date, or null. */
export function weekFor(schedule: Schedule, isoDate: string): Week | null {
  return (
    schedule.weeks.find(week => week.start <= isoDate && isoDate <= week.end) ??
    null
  );
}

/** Tasks (not free slots) assigned to a person in a week. */
export function tasksFor(
  schedule: Schedule,
  week: Week,
  person: string,
): Task[] {
  return schedule.tasks.filter(
    (task, index) => !task.free && week.assignees[index] === person,
  );
}
