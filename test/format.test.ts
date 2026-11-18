import assert from 'node:assert/strict';
import test from 'node:test';

import {
  capitalize,
  formatDeadline,
  formatWeekRange,
  formatWeekShort,
  initials,
} from '../src/web/format.ts';

test('week ranges within and across months', () => {
  assert.equal(formatWeekRange('2026-11-09', '2026-11-15'), '9–15 listopada');
  assert.equal(
    formatWeekRange('2026-10-26', '2026-11-01'),
    '26 października – 1 listopada',
  );
  assert.equal(formatWeekShort('2026-11-09', '2026-11-15'), '9–15 lis');
  assert.equal(formatWeekShort('2026-12-28', '2027-01-03'), '28 gru – 3 sty');
});

test('deadlines relative to today', () => {
  assert.equal(
    formatDeadline('2026-11-15', '2026-11-11'),
    'termin: niedziela, 15 listopada',
  );
  assert.equal(formatDeadline('2026-11-15', '2026-11-14'), 'termin mija jutro');
  assert.equal(formatDeadline('2026-11-15', '2026-11-15'), 'termin mija dziś');
  assert.equal(formatDeadline('2026-11-15', '2026-11-16'), 'termin minął');
});

test('text helpers', () => {
  assert.equal(capitalize('łazienka'), 'Łazienka');
  assert.equal(capitalize(''), '');
  assert.equal(initials('Ewa'), 'E');
  assert.equal(initials(' anna maria  nowak '), 'AM');
});
