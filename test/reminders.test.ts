import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {
  buildNotification,
  DEFAULT_RULES,
  dueReminders,
  statusKey,
  validateRules,
  ValidationError,
} from '../src/core/reminders.ts';
import type {Reminder} from '../src/core/reminders.ts';
import {buildSchedule} from '../src/core/schedule.js';
import {readFirstSheet} from '../src/core/xlsx.js';
import type {ReminderRule, Schedule} from '../src/shared/types.ts';

const FIXTURE = new URL('./fixtures/grafik.xlsx', import.meta.url);
const TIME_ZONE = 'Europe/Warsaw';
const PEOPLE = ['Ala', 'Bartek', 'Celina', 'Darek', 'Ewa'];

async function fixtureSchedule(): Promise<Schedule> {
  const sheet = await readFirstSheet(new Uint8Array(await readFile(FIXTURE)));
  return buildSchedule(sheet.rows);
}

function everyone(
  rules: readonly ReminderRule[] = DEFAULT_RULES,
): Map<string, readonly ReminderRule[]> {
  return new Map(PEOPLE.map(person => [person, rules]));
}

/** Reminders due in the minute ending at the given UTC instant. */
function dueAt(
  schedule: Schedule,
  iso: string,
  overrides: Partial<Parameters<typeof dueReminders>[0]> = {},
): Reminder[] {
  const toMs = Date.parse(iso);
  return dueReminders({
    schedule,
    rulesByPerson: everyone(),
    silenced: new Set(),
    fromMs: toMs - 60_000,
    toMs,
    timeZone: TIME_ZONE,
    ...overrides,
  });
}

const summary = (reminders: Reminder[]) =>
  reminders.map(r => `${r.person}:${r.task.key}:${r.kind}`).sort();

test('Monday 09:00 announces the week to everyone with a task', async () => {
  const schedule = await fixtureSchedule();
  // 09:00 in Warsaw is 08:00 UTC in winter.
  assert.deepEqual(summary(dueAt(schedule, '2026-11-09T08:00:00Z')), [
    'Ala:kuchnia:start',
    'Bartek:korytarz-z-butami-ew-tez-z-chodnikiem:start',
    'Darek:smieci:start',
    'Ewa:lazienka:start',
  ]);
  assert.deepEqual(dueAt(schedule, '2026-11-09T08:01:00Z'), []);
});

test('acknowledged or done tasks are not reminded', async () => {
  const schedule = await fixtureSchedule();
  const silenced = new Set([statusKey('2026-11-09', 'lazienka')]);
  const due = dueAt(schedule, '2026-11-09T08:00:00Z', {silenced});
  assert.equal(due.length, 3);
  assert.ok(!due.some(r => r.person === 'Ewa'));
});

test('a window spanning several slots yields each reminder once', async () => {
  const schedule = await fixtureSchedule();
  const due = dueAt(schedule, '2026-11-09T08:30:00Z', {
    fromMs: Date.parse('2026-11-09T05:00:00Z'),
  });
  assert.equal(due.length, 4);
  assert.equal(new Set(due.map(r => r.dedupeKey)).size, 4);
});

test("kinds follow the order of a person's rules in the week", async () => {
  const schedule = await fixtureSchedule();
  const saturday = dueAt(schedule, '2026-11-14T10:00:00Z');
  const sunday = dueAt(schedule, '2026-11-15T17:00:00Z');
  assert.ok(saturday.length === 4 && saturday.every(r => r.kind === 'nudge'));
  assert.ok(sunday.length === 4 && sunday.every(r => r.kind === 'last'));
  assert.deepEqual(
    saturday.map(r => r.daysLeft).concat(sunday.map(r => r.daysLeft)),
    [1, 1, 1, 1, 0, 0, 0, 0],
  );
});

test('custom rules, no rules, unknown people and unknown dates', async () => {
  const schedule = await fixtureSchedule();
  const custom = new Map<string, readonly ReminderRule[]>([
    ['Ewa', [{weekday: 3, time: '20:15'}]],
    ['Ala', []],
    ['Nikt', DEFAULT_RULES],
  ]);
  assert.deepEqual(
    summary(dueAt(schedule, '2026-11-11T19:15:00Z', {rulesByPerson: custom})),
    ['Ewa:lazienka:start'],
  );
  assert.deepEqual(
    dueAt(schedule, '2026-11-09T08:00:00Z', {rulesByPerson: custom}),
    [],
  );
  assert.deepEqual(dueAt(schedule, '2030-01-07T08:00:00Z'), []);
});

test('summer time: 09:00 in Warsaw is 07:00 UTC', async () => {
  const schedule = await fixtureSchedule();
  assert.equal(dueAt(schedule, '2027-07-05T07:00:00Z').length, 4);
  assert.equal(dueAt(schedule, '2027-07-05T08:00:00Z').length, 0);
});

const TINY: Schedule = {
  tasks: [
    {key: 'kuchnia', title: 'kuchnia', details: 'zmyć blaty', free: false},
    {key: 'okna', title: 'okna', details: '', free: false},
  ],
  people: ['Ala', 'Ewa'],
  // Saturday to Friday, covering the autumn clock change on 2027-10-31.
  weeks: [{start: '2027-10-30', end: '2027-11-05', assignees: ['Ala', 'Ewa']}],
  warnings: [],
};

test('the repeated hour of the autumn clock change reminds once', () => {
  const rulesByPerson = new Map([['Ala', [{weekday: 7, time: '02:30'}]]]);
  const due = dueAt(TINY, '2027-10-31T02:00:00Z', {
    rulesByPerson,
    fromMs: Date.parse('2027-10-31T00:00:00Z'),
  });
  assert.deepEqual(summary(due), ['Ala:kuchnia:start']);
});

test('kinds are ordered from the first day of the week, not Monday', () => {
  const rules = [
    {weekday: 1, time: '09:00'},
    {weekday: 6, time: '11:00'},
    {weekday: 5, time: '18:00'},
  ];
  const rulesByPerson = new Map([['Ala', rules]]);
  const kindAt = (iso: string) =>
    dueAt(TINY, iso, {rulesByPerson}).map(r => r.kind);
  assert.deepEqual(kindAt('2027-10-30T09:00:00Z'), ['start']); // Saturday
  assert.deepEqual(kindAt('2027-11-01T08:00:00Z'), ['nudge']); // Monday
  assert.deepEqual(kindAt('2027-11-05T17:00:00Z'), ['last']); // Friday
});

test('notification text', () => {
  const rulesByPerson = new Map([
    ['Ala', [{weekday: 2, time: '09:00'}]],
    [
      'Ewa',
      [
        {weekday: 4, time: '09:00'},
        {weekday: 5, time: '09:00'},
      ],
    ],
  ]);
  const at = (iso: string) =>
    buildNotification(dueAt(TINY, iso, {rulesByPerson})[0]);
  assert.deepEqual(at('2027-11-02T08:00:00Z'), {
    title: 'Twój dyżur: kuchnia',
    body: 'zmyć blaty · termin: 05.11',
    tag: '2027-10-30|kuchnia',
    url: './',
    data: {weekStart: '2027-10-30', taskKey: 'kuchnia', person: 'Ala'},
  });
  assert.equal(at('2027-11-04T08:00:00Z').body, 'termin mija jutro');
  const last = at('2027-11-05T08:00:00Z');
  assert.equal(last.title, 'Ostatni dzwonek: okna');
  assert.equal(last.body, 'termin mija dziś');
});

test('validateRules', () => {
  assert.deepEqual(
    validateRules([
      {weekday: 1, time: '09:00', extra: true},
      {weekday: 1, time: '09:00'},
      {weekday: 7, time: '23:45'},
    ]),
    [
      {weekday: 1, time: '09:00'},
      {weekday: 7, time: '23:45'},
    ],
  );
  assert.deepEqual(validateRules([]), []);
  const invalid: unknown[] = [
    null,
    'x',
    [{weekday: 0, time: '09:00'}],
    [{weekday: 8, time: '09:00'}],
    [{weekday: 1.5, time: '09:00'}],
    [{weekday: 1, time: '9:00'}],
    [{weekday: 1, time: '09:10'}],
    [{weekday: 1, time: '24:00'}],
    [null],
    Array.from({length: 11}, () => ({weekday: 1, time: '09:00'})),
  ];
  for (const input of invalid) {
    assert.throws(() => validateRules(input), ValidationError);
  }
});
