import test from 'node:test';
import assert from 'node:assert/strict';
import { localParts, slotsBetween, isoWeekday, SLOT_MS } from '../src/core/time.js';

const at = (iso) => Date.parse(iso);

test('localParts converts UTC instants to Warsaw wall-clock time', () => {
  assert.deepEqual(localParts(at('2026-11-11T20:00:00Z')), { date: '2026-11-11', weekday: 3, time: '21:00' }); // CET, UTC+1
  assert.deepEqual(localParts(at('2027-07-01T22:30:00Z')), { date: '2027-07-02', weekday: 5, time: '00:30' }); // CEST, UTC+2, past midnight
  assert.deepEqual(localParts(at('2026-11-15T22:59:00Z')), { date: '2026-11-15', weekday: 7, time: '23:59' }); // Sunday is 7
  assert.deepEqual(localParts(at('2026-11-15T23:00:00Z')), { date: '2026-11-16', weekday: 1, time: '00:00' }); // never "24:00"
  assert.deepEqual(localParts(at('2026-11-11T20:00:00Z'), 'UTC'), { date: '2026-11-11', weekday: 3, time: '20:00' });
});

test('localParts across daylight-saving changes', () => {
  // Spring forward, 2027-03-28: 01:59 CET is followed by 03:00 CEST.
  assert.equal(localParts(at('2027-03-28T00:45:00Z')).time, '01:45');
  assert.equal(localParts(at('2027-03-28T01:00:00Z')).time, '03:00');
  // Fall back, 2027-10-31: 02:30 happens twice (the reminder dedupe key absorbs this).
  assert.deepEqual(localParts(at('2027-10-31T00:30:00Z')), { date: '2027-10-31', weekday: 7, time: '02:30' });
  assert.deepEqual(localParts(at('2027-10-31T01:30:00Z')), { date: '2027-10-31', weekday: 7, time: '02:30' });
});

test('slotsBetween lists 15-minute grid instants in (from, to]', () => {
  const base = at('2026-11-09T08:00:00Z');
  assert.deepEqual(slotsBetween(base, base), []);
  assert.deepEqual(slotsBetween(base - 1, base), [base]);
  assert.deepEqual(slotsBetween(base, base + SLOT_MS - 1), []);
  assert.deepEqual(slotsBetween(base + 1, base + 2 * SLOT_MS + 5), [base + SLOT_MS, base + 2 * SLOT_MS]);
  assert.equal(slotsBetween(base, base + 3 * 3600 * 1000).length, 12);
});

test('isoWeekday', () => {
  assert.equal(isoWeekday('2026-11-09'), 1);
  assert.equal(isoWeekday('2026-11-15'), 7);
});
