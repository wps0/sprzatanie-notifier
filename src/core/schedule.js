// Turns raw worksheet rows into the cleaning schedule model.
//
// Expected layout (anchored on header texts, not on fixed cell addresses):
//
//   | początek tygodnia | koniec tygodnia | <task 1> | <task 2> | ... | (empty header = stop)
//   | 2026-10-26        | 2026-11-01      | <person> | <person> | ...
//
// - The header row is the first row containing a cell "początek tygodnia".
// - Task columns are the consecutive non-empty header cells right of "koniec tygodnia".
//   Anything after the first empty header cell is ignored.
// - Header "title (details)" is split into title and details.
// - A header made only of "?" (or "wolne") marks a free slot: shown in the app, never reminded.

const POLISH = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const norm = (v) => clean(v).toLowerCase();

export function slugify(s) {
  return norm(s).replace(/[ąćęłńóśźż]/g, (c) => POLISH[c]).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Excel serial day number or a date-like string -> "YYYY-MM-DD" (or null). */
export function toIsoDate(v) {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    return new Date((Math.floor(v) - 25569) * 86400000).toISOString().slice(0, 10);
  }
  const s = clean(v);
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

export function addDays(iso, days) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

function parseTaskHeader(text, col) {
  const header = clean(text);
  const m = /^(.*?)\s*\((.*)\)\s*$/.exec(header);
  const title = clean(m ? m[1] : header);
  const free = /^\?+$/.test(title) || norm(title) === 'wolne';
  return { key: free ? `wolne-${col}` : slugify(title) || `kolumna-${col}`, title: free ? 'Wolne' : title, details: m ? clean(m[2]) : '', free };
}

/**
 * @param {{ r: number, cells: Map<number, string | number | boolean> }[]} rows
 * @returns {{ tasks: {key: string, title: string, details: string, free: boolean}[], people: string[],
 *             weeks: {start: string, end: string, assignees: (string|null)[]}[], warnings: string[] }}
 */
export function buildSchedule(rows) {
  const warnings = [];
  let headerIdx = -1, startCol = -1;
  for (let i = 0; i < rows.length && headerIdx < 0; i++) {
    for (const [col, value] of rows[i].cells) {
      if (norm(value) === 'początek tygodnia') { headerIdx = i; startCol = col; break; }
    }
  }
  if (headerIdx < 0) throw new Error('schedule: header cell "początek tygodnia" not found');
  const header = rows[headerIdx].cells;
  const hasEndCol = norm(header.get(startCol + 1)) === 'koniec tygodnia';
  if (!hasEndCol) warnings.push('brak kolumny "koniec tygodnia" — przyjęto tygodnie 7-dniowe');
  const firstTaskCol = startCol + (hasEndCol ? 2 : 1);

  const tasks = [];
  for (let col = firstTaskCol; clean(header.get(col)) !== ''; col++) tasks.push(parseTaskHeader(header.get(col), col));
  if (tasks.length === 0) throw new Error('schedule: no task columns found');
  const keys = new Set();
  for (const t of tasks) { if (keys.has(t.key)) t.key += `-${tasks.indexOf(t)}`; keys.add(t.key); }

  const weeks = [];
  const people = [];
  for (const row of rows.slice(headerIdx + 1)) {
    const start = toIsoDate(row.cells.get(startCol));
    if (!start) continue;
    let end = hasEndCol ? toIsoDate(row.cells.get(startCol + 1)) : null;
    if (!end || end < start) {
      if (hasEndCol) warnings.push(`wiersz ${row.r}: nieprawidłowy koniec tygodnia`);
      end = addDays(start, 6);
    }
    const assignees = tasks.map((_, i) => {
      const name = clean(row.cells.get(firstTaskCol + i));
      if (!name) return null;
      if (!people.includes(name)) people.push(name);
      return name;
    });
    weeks.push({ start, end, assignees });
  }
  if (weeks.length === 0) throw new Error('schedule: no week rows found');
  weeks.sort((a, b) => (a.start < b.start ? -1 : 1));
  for (let i = 1; i < weeks.length; i++) {
    if (weeks[i].start <= weeks[i - 1].end) warnings.push(`tygodnie ${weeks[i - 1].start} i ${weeks[i].start} nachodzą na siebie`);
  }
  return { tasks, people, weeks, warnings };
}

/** The week whose [start, end] range contains the given ISO date, or null. */
export function weekFor(schedule, isoDate) {
  return schedule.weeks.find((w) => w.start <= isoDate && isoDate <= w.end) ?? null;
}

/** Non-free tasks assigned to a person in a week. */
export function tasksFor(schedule, week, person) {
  return schedule.tasks.filter((t, i) => !t.free && week.assignees[i] === person);
}
