import assert from 'node:assert/strict';
import test from 'node:test';

import {handleScheduled, TICK_CRON} from '../src/worker/app.ts';
import type {Harness} from './helpers/harness.ts';
import {api, createHarness, endpoint, subscribe} from './helpers/harness.ts';

// Monday 2026-11-09, 09:00 in Warsaw: the default "start of week" reminder.
const MONDAY_9 = Date.parse('2026-11-09T08:00:00Z');
const MINUTE = 60_000;

async function harnessWithSchedule(): Promise<Harness> {
  const h = await createHarness('2026-11-09T07:00:00Z');
  await api(h, 'GET', '/api/state');
  return h;
}

async function tick(h: Harness, atMs: number): Promise<void> {
  h.world.now = atMs;
  await handleScheduled({cron: TICK_CRON, scheduledTime: atMs}, h.env, h.deps);
}

function setStatus(h: Harness, status: string) {
  return api(h, 'PUT', '/api/task-status', {
    weekStart: '2026-11-09',
    taskKey: 'lazienka',
    status,
    updatedBy: 'Ewa',
  });
}

test('a reminder goes to every device of the person, exactly once', async () => {
  const h = await harnessWithSchedule();
  await subscribe(h, 'Ewa', 'phone');
  await subscribe(h, 'Ewa', 'laptop');
  await subscribe(h, 'Celina', 'free-this-week');

  await tick(h, MONDAY_9 - 15 * MINUTE);
  assert.deepEqual(h.pushes, []);
  await tick(h, MONDAY_9);
  assert.deepEqual(h.pushes.sort(), [endpoint('laptop'), endpoint('phone')]);
  await tick(h, MONDAY_9);
  await tick(h, MONDAY_9 + 15 * MINUTE);
  assert.equal(h.pushes.length, 2);
});

test('a late tick catches up, but not beyond three hours', async () => {
  const late = await harnessWithSchedule();
  await subscribe(late, 'Ewa', 'phone');
  await tick(late, MONDAY_9 - 15 * MINUTE);
  await tick(late, MONDAY_9 + 45 * MINUTE);
  assert.equal(late.pushes.length, 1);

  const tooLate = await harnessWithSchedule();
  await subscribe(tooLate, 'Ewa', 'phone');
  await tick(tooLate, MONDAY_9 - 4 * 60 * MINUTE);
  await tick(tooLate, MONDAY_9 + 3 * 60 * MINUTE + 30 * MINUTE);
  assert.equal(tooLate.pushes.length, 0);
});

test('a dead subscription is removed and the rest still delivered', async () => {
  const h = await harnessWithSchedule();
  await subscribe(h, 'Ewa', 'dead');
  await subscribe(h, 'Ewa', 'alive');
  h.world.pushStatus = url => (url.endsWith('dead') ? 410 : 201);
  await tick(h, MONDAY_9);
  assert.equal(h.pushes.length, 2);

  // Saturday 11:00 in Warsaw: only the live device is contacted.
  h.pushes.length = 0;
  await tick(h, Date.parse('2026-11-14T10:00:00Z'));
  assert.deepEqual(h.pushes, [endpoint('alive')]);
});

test('a reminder nobody received is retried on the next tick', async () => {
  const h = await harnessWithSchedule();
  await subscribe(h, 'Ewa', 'phone');
  h.world.pushStatus = () => 500;
  await tick(h, MONDAY_9);
  await tick(h, MONDAY_9 + 15 * MINUTE);
  assert.equal(h.pushes.length, 2, 'tried twice');

  h.world.pushStatus = () => 201;
  await tick(h, MONDAY_9 + 30 * MINUTE);
  assert.equal(h.pushes.length, 3, 'delivered on the third attempt');
  await tick(h, MONDAY_9 + 45 * MINUTE);
  assert.equal(h.pushes.length, 3, 'and never again');
});

test('acknowledged and done silence reminders; pending restores them', async () => {
  const saturday = Date.parse('2026-11-14T10:00:00Z');
  const sunday = Date.parse('2026-11-15T17:00:00Z');
  for (const status of ['acknowledged', 'done']) {
    const h = await harnessWithSchedule();
    await subscribe(h, 'Ewa', 'phone');
    await subscribe(h, 'Ala', 'other');
    await setStatus(h, status);
    await tick(h, MONDAY_9);
    assert.deepEqual(h.pushes, [endpoint('other')], status);

    await tick(h, saturday);
    assert.equal(h.pushes.length, 2, 'still only the other person');
    h.world.now = saturday + MINUTE;
    await setStatus(h, 'pending');
    await tick(h, sunday);
    assert.deepEqual(h.pushes.slice(2).sort(), [
      endpoint('other'),
      endpoint('phone'),
    ]);
  }
});

test('custom rules replace the defaults for that person only', async () => {
  const h = await harnessWithSchedule();
  await subscribe(h, 'Ewa', 'phone');
  await subscribe(h, 'Ala', 'other');
  await api(h, 'PUT', '/api/prefs', {
    person: 'Ewa',
    rules: [{weekday: 2, time: '20:00'}],
  });
  await tick(h, MONDAY_9);
  assert.deepEqual(h.pushes, [endpoint('other')]);
  await tick(h, Date.parse('2026-11-10T19:00:00Z'));
  assert.deepEqual(h.pushes, [endpoint('other'), endpoint('phone')]);
});

test('without a schedule or without devices a tick does nothing', async () => {
  const empty = await createHarness('2026-11-09T07:00:00Z');
  await tick(empty, MONDAY_9);
  assert.equal(empty.world.sheetDownloads, 0);
  const noDevices = await harnessWithSchedule();
  await tick(noDevices, MONDAY_9);
  assert.deepEqual(noDevices.pushes, []);
});
