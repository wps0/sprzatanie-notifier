import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFirstSheet, parseSheetXml, parseSharedStrings, colIndex, decodeXml } from '../src/core/xlsx.js';
import { buildSchedule, weekFor, tasksFor, toIsoDate, slugify, addDays } from '../src/core/schedule.js';
import { downloadWorkbook } from '../src/core/sheet-fetch.js';

// The fixture is the real workbook exported by Excel Online with names replaced
// (Ala, Bartek, Celina, Darek, Ewa) and images / document properties removed.
const fixture = async () => new Uint8Array(await readFile(new URL('./fixtures/grafik.xlsx', import.meta.url)));

test('reads the real-world workbook layout', async () => {
  const sheet = await readFirstSheet(await fixture());
  assert.equal(sheet.name, 'Arkusz1');
  const schedule = buildSchedule(sheet.rows);

  assert.deepEqual(schedule.tasks.map((t) => [t.key, t.title, t.free]), [
    ['smieci', 'śmieci', false],
    ['lazienka', 'łazienka', false],
    ['kuchnia', 'kuchnia', false],
    ['korytarz-z-butami-ew-tez-z-chodnikiem', 'korytarz z butami, ew też z chodnikiem', false],
    ['free-6', 'Wolne', true],
  ]);
  assert.equal(schedule.tasks[1].details, 'odkurzyć podłogę, przemyć półkę pod lustrem i umywalkę');
  assert.deepEqual(schedule.people, ['Ala', 'Bartek', 'Celina', 'Darek', 'Ewa']);
  assert.equal(schedule.weeks.length, 50);
  assert.deepEqual(schedule.weeks[0], { start: '2026-10-26', end: '2026-11-01', assignees: ['Ala', 'Bartek', 'Celina', 'Darek', 'Ewa'] });
  assert.equal(schedule.weeks.at(-1).end, '2027-10-10');
  assert.deepEqual(schedule.warnings, []);
});

test('formula cells are read through their cached values, and the rotation holds', async () => {
  const schedule = buildSchedule((await readFirstSheet(await fixture())).rows);
  const week = weekFor(schedule, '2026-11-11');
  assert.deepEqual(week, { start: '2026-11-09', end: '2026-11-15', assignees: ['Darek', 'Ewa', 'Ala', 'Bartek', 'Celina'] });
  assert.deepEqual(tasksFor(schedule, week, 'Ewa').map((t) => t.key), ['lazienka']);
  assert.deepEqual(tasksFor(schedule, week, 'Celina'), [], 'the free column never yields a task');
  assert.equal(weekFor(schedule, '2026-11-15'), week, 'Sunday still belongs to the week');
  assert.equal(weekFor(schedule, '2026-11-16').start, '2026-11-16');
  assert.equal(weekFor(schedule, '2025-01-01'), null);
});

test('columns after the first empty header are ignored', async () => {
  const schedule = buildSchedule((await readFirstSheet(await fixture())).rows);
  // The workbook has a second block of name headers in J..N; it must not become tasks.
  assert.equal(schedule.tasks.length, 5);
});

test('parseSheetXml handles shared, inline, formula, boolean, error and empty cells', () => {
  const shared = parseSharedStrings('<sst><si><t>plain</t></si><si><r><t>ri</t></r><r><t xml:space="preserve">ch </t></r><rPh><t>x</t></rPh></si><si/></sst>');
  assert.deepEqual(shared, ['plain', 'rich ', '']);
  const rows = parseSheetXml(`<sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
    <row r="2"/>
    <row r="3" spans="1:9"><c r="A3" s="4"><v>46321</v></c><c r="B3" t="inlineStr"><is><t>in&amp;line</t></is></c>
      <c r="C3" t="str"><f>A1</f><v>Tom &lt;3</v></c><c r="D3" t="e"><v>#VALUE!</v></c><c r="E3" s="2"/><c r="F3" t="b"><v>1</v></c><c r="AA3"><v>1.5</v></c></row>
  </sheetData>`, shared);
  assert.deepEqual(rows.map((r) => r.r), [1, 2, 3]);
  assert.deepEqual([...rows[0].cells], [[0, 'plain'], [1, 'rich ']]);
  assert.equal(rows[1].cells.size, 0);
  assert.deepEqual([...rows[2].cells], [[0, 46321], [1, 'in&line'], [2, 'Tom <3'], [5, true], [26, 1.5]]);
});

test('small helpers', () => {
  assert.equal(colIndex('A'), 0);
  assert.equal(colIndex('Z'), 25);
  assert.equal(colIndex('AA'), 26);
  assert.equal(decodeXml('a &amp; b &#x142; &#322; &unknown;'), 'a & b ł ł &unknown;');
  assert.equal(toIsoDate(46321), '2026-10-26');
  assert.equal(toIsoDate(46321.75), '2026-10-26');
  assert.equal(toIsoDate('2026-10-26T00:00:00'), '2026-10-26');
  assert.equal(toIsoDate('26.10.2026'), '2026-10-26');
  assert.equal(toIsoDate('1/2/2027'), '2027-02-01');
  assert.equal(toIsoDate('Ala'), null);
  assert.equal(toIsoDate(5), null);
  assert.equal(addDays('2026-12-28', 6), '2027-01-03');
  assert.equal(slugify('  Łazienka i Żółć  '), 'lazienka-i-zolc');
});

const row = (r, values) => ({ r, cells: new Map(values.map((v, i) => [i, v]).filter(([, v]) => v !== null)) });

test('buildSchedule copes with a shifted table, a missing end column and gaps', () => {
  const schedule = buildSchedule([
    row(1, ['tytuł']),
    row(4, [null, 'Początek  tygodnia', 'Kuchnia', '???', null, 'notatki']),
    row(5, [null, 46328, 'Ala', 'Ola', null, 'ignored']),
    row(6, [null, 'suma', 'x']),
    row(7, [null, 46321, 'Ola']),
  ]);
  assert.deepEqual(schedule.tasks.map((t) => [t.key, t.free]), [['kuchnia', false], ['free-3', true]]);
  assert.deepEqual(schedule.weeks, [
    { start: '2026-10-26', end: '2026-11-01', assignees: ['Ola', null] },
    { start: '2026-11-02', end: '2026-11-08', assignees: ['Ala', 'Ola'] },
  ]);
  assert.deepEqual(schedule.people, ['Ala', 'Ola']);
  assert.equal(schedule.warnings.length, 1);
});

test('buildSchedule rejects sheets it cannot understand', () => {
  assert.throws(() => buildSchedule([row(1, ['cokolwiek'])]), /początek tygodnia/);
  assert.throws(() => buildSchedule([row(1, ['początek tygodnia', 'koniec tygodnia'])]), /no task columns/);
  assert.throws(() => buildSchedule([row(1, ['początek tygodnia', 'koniec tygodnia', 'kuchnia'])]), /no week rows/);
});

test('downloadWorkbook follows the SharePoint cookie redirect by hand', async () => {
  const bytes = await fixture();
  const seen = [];
  const fakeFetch = async (url, init) => {
    seen.push({ url: String(url), cookie: init.headers.cookie, redirect: init.redirect });
    if (url.pathname.startsWith('/:x:/')) {
      const headers = new Headers({ location: '/personal/someone/Documents/file.xlsx?ga=1' });
      headers.append('set-cookie', 'FedAuth=abc123; path=/; secure; HttpOnly');
      headers.append('set-cookie', 'other=1; path=/');
      return new Response(null, { status: 302, headers });
    }
    if (init.headers.cookie !== 'FedAuth=abc123; other=1') return new Response('403 FORBIDDEN', { status: 403 });
    return new Response(bytes, { status: 200, headers: { etag: '"v61"' } });
  };
  const result = await downloadWorkbook('https://tenant-my.sharepoint.com/:x:/g/personal/someone/TOKEN?rtime=abc', { fetch: fakeFetch });
  assert.equal(result.bytes.length, bytes.length);
  assert.equal(result.etag, '"v61"');
  assert.equal(seen.length, 2);
  assert.match(seen[0].url, /download=1/);
  assert.equal(seen[0].redirect, 'manual');
  assert.equal(seen[1].url, 'https://tenant-my.sharepoint.com/personal/someone/Documents/file.xlsx?ga=1');
});

test('downloadWorkbook fails clearly on login pages, HTTP errors and redirect loops', async () => {
  const html = async () => new Response('<!DOCTYPE html><html>Sign in</html>', { status: 200 });
  await assert.rejects(downloadWorkbook('https://x.sharepoint.com/a', { fetch: html }), /not an XLSX file/);
  const forbidden = async () => new Response('no', { status: 403 });
  await assert.rejects(downloadWorkbook('https://x.sharepoint.com/a', { fetch: forbidden }), /HTTP 403/);
  const loop = async () => new Response(null, { status: 302, headers: { location: '/again' } });
  await assert.rejects(downloadWorkbook('https://x.sharepoint.com/a', { fetch: loop }), /too many redirects/);
  await assert.rejects(downloadWorkbook('http://x.sharepoint.com/a', { fetch: html }), /non-HTTPS/);
});
