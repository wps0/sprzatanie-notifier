import assert from 'node:assert/strict';
import test from 'node:test';

import {handleScheduled, REFRESH_CRON} from '../src/worker/app.ts';
import {
  api,
  CODE,
  createHarness,
  endpoint,
  KEYS,
  subscribe,
} from './helpers/harness.ts';

const WEDNESDAY = '2026-11-11T12:00:00Z';

test('every endpoint requires the flat code', async () => {
  const h = await createHarness(WEDNESDAY);
  const none = await api(h, 'GET', '/api/state', undefined, {});
  assert.equal(none.status, 401);
  assert.equal(none.body.error, 'unauthorized');
  const wrong = await api(h, 'GET', '/api/state', undefined, {
    authorization: 'Bearer nope',
  });
  assert.equal(wrong.status, 401);
  assert.equal(h.world.sheetDownloads, 0, 'nothing happens before auth');
  const shouted = await api(h, 'GET', '/api/state', undefined, {
    authorization: `Bearer  ${CODE.toUpperCase()} `,
  });
  assert.equal(shouted.status, 200);
});

test('state carries the schedule, the date in the flat and the keys', async () => {
  const h = await createHarness('2026-11-15T23:30:00Z');
  const {status, body, headers} = await api(h, 'GET', '/api/state');
  assert.equal(status, 200);
  assert.equal(headers.get('cache-control'), 'no-store');
  assert.equal(body.today, '2026-11-16', 'already Monday in Warsaw');
  assert.equal(body.schedule.weeks.length, 50);
  assert.deepEqual(body.schedule.people, [
    'Ala',
    'Bartek',
    'Celina',
    'Darek',
    'Ewa',
  ]);
  assert.equal(body.sheet.error, null);
  assert.equal(body.sheet.fetchedAt, h.world.now);
  assert.equal(body.vapidPublicKey, h.env.VAPID_PUBLIC_KEY);
  assert.equal(body.defaultRules.length, 3);
  assert.deepEqual(body.statuses, []);
});

test('an unreadable sheet never replaces the last good schedule', async () => {
  const h = await createHarness(WEDNESDAY);
  await api(h, 'GET', '/api/state');
  for (const broken of ['<html>Sign in</html>', new Uint8Array([80, 75, 1])]) {
    h.world.sheetBody = broken;
    h.world.now += 6 * 3600_000;
    await handleScheduled(
      {cron: REFRESH_CRON, scheduledTime: h.world.now},
      h.env,
      h.deps,
    );
    const {body} = await api(h, 'GET', '/api/state');
    assert.equal(body.schedule.weeks.length, 50);
    assert.equal(typeof body.sheet.error, 'string');
    assert.equal(body.sheet.fetchedAt, Date.parse(WEDNESDAY));
  }
});

test('with no schedule at all the state is empty but valid', async () => {
  const h = await createHarness(WEDNESDAY);
  h.world.sheetBody = 'not a workbook';
  const {status, body} = await api(h, 'GET', '/api/state');
  assert.equal(status, 200);
  assert.deepEqual(body.schedule.people, []);
  assert.match(body.sheet.error, /XLSX/);
  const prefs = await api(h, 'GET', '/api/prefs?person=Ala');
  assert.equal(prefs.status, 409);
});

test('manual refresh downloads at most once a minute', async () => {
  const h = await createHarness(WEDNESDAY);
  await api(h, 'GET', '/api/state');
  assert.equal(h.world.sheetDownloads, 1);
  await api(h, 'POST', '/api/refresh');
  assert.equal(h.world.sheetDownloads, 1, 'too soon');
  h.world.now += 61_000;
  const {body} = await api(h, 'POST', '/api/refresh');
  assert.equal(h.world.sheetDownloads, 2);
  assert.equal(body.sheet.fetchedAt, h.world.now);
});

test('subscriptions are validated before they are stored', async () => {
  const h = await createHarness(WEDNESDAY);
  await api(h, 'GET', '/api/state');
  const post = (person: string, subscription: unknown) =>
    api(h, 'POST', '/api/subscriptions', {person, subscription});
  const good = {endpoint: endpoint('a'), keys: KEYS};

  assert.equal((await post('Ala', good)).status, 200);
  assert.equal((await post('Obcy', good)).body.error, 'unknown_person');
  const evil = await post('Ala', {...good, endpoint: 'https://evil.test/x'});
  assert.equal(evil.body.error, 'unsupported_push_service');
  assert.match(evil.body.message, /evil\.test/);
  const bad = [
    {...good, endpoint: 'http://fcm.googleapis.com/x'},
    {...good, endpoint: 'nonsense'},
    {...good, keys: {...KEYS, auth: 'short'}},
    {...good, keys: {...KEYS, p256dh: KEYS.auth}},
    {endpoint: good.endpoint},
    null,
  ];
  for (const subscription of bad) {
    assert.equal((await post('Ala', subscription)).status, 400);
  }
  for (const host of [
    'https://web.push.apple.com/x',
    'https://updates.push.services.mozilla.com/wpush/v2/x',
    'https://wns2-par02p.notify.windows.com/w/?token=x',
  ]) {
    assert.equal((await post('Ala', {...good, endpoint: host})).status, 200);
  }
});

test('push-test notifies one device and forgets dead ones', async () => {
  const h = await createHarness(WEDNESDAY);
  await api(h, 'GET', '/api/state');
  await subscribe(h, 'Ala', 'phone');
  const test1 = await api(h, 'POST', '/api/push-test', {
    endpoint: endpoint('phone'),
  });
  assert.deepEqual(test1.body, {ok: true, gone: false});
  assert.deepEqual(h.pushes, [endpoint('phone')]);

  h.world.pushStatus = () => 410;
  const test2 = await api(h, 'POST', '/api/push-test', {
    endpoint: endpoint('phone'),
  });
  assert.deepEqual(test2.body, {ok: false, gone: true});
  const test3 = await api(h, 'POST', '/api/push-test', {
    endpoint: endpoint('phone'),
  });
  assert.deepEqual(test3.body, {ok: false, gone: true});
  assert.equal(h.pushes.length, 2, 'a forgotten device is not contacted');

  await subscribe(h, 'Ala', 'tablet');
  const removed = await api(h, 'DELETE', '/api/subscriptions', {
    endpoint: endpoint('tablet'),
  });
  assert.deepEqual(removed.body, {ok: true});
});

test('reminder preferences per person', async () => {
  const h = await createHarness(WEDNESDAY);
  await api(h, 'GET', '/api/state');
  const initial = await api(h, 'GET', '/api/prefs?person=Ewa');
  assert.equal(initial.body.isDefault, true);
  assert.equal(initial.body.rules.length, 3);

  const rules = [{weekday: 5, time: '19:30'}];
  const saved = await api(h, 'PUT', '/api/prefs', {person: 'Ewa', rules});
  assert.deepEqual(saved.body, {person: 'Ewa', rules, isDefault: false});
  const muted = await api(h, 'PUT', '/api/prefs', {person: 'Ewa', rules: []});
  assert.deepEqual(muted.body.rules, []);
  assert.equal(muted.body.isDefault, false);

  const invalid = await api(h, 'PUT', '/api/prefs', {
    person: 'Ewa',
    rules: [{weekday: 9, time: '19:30'}],
  });
  assert.equal(invalid.status, 400);
  assert.equal(
    (await api(h, 'GET', '/api/prefs?person=Ewa')).body.rules.length,
    0,
  );

  const reset = await api(h, 'PUT', '/api/prefs', {person: 'Ewa', rules: null});
  assert.equal(reset.body.isDefault, true);
  assert.equal((await api(h, 'GET', '/api/prefs?person=X')).status, 400);
  assert.equal((await api(h, 'GET', '/api/prefs')).status, 400);
});

test('task status moves freely between the three states', async () => {
  const h = await createHarness(WEDNESDAY);
  await api(h, 'GET', '/api/state');
  const put = (status: string, extra: object = {}) =>
    api(h, 'PUT', '/api/task-status', {
      weekStart: '2026-11-09',
      taskKey: 'lazienka',
      status,
      updatedBy: 'Ewa',
      ...extra,
    });

  const acknowledged = await put('acknowledged');
  assert.deepEqual(acknowledged.body.statuses, [
    {
      weekStart: '2026-11-09',
      taskKey: 'lazienka',
      status: 'acknowledged',
      updatedBy: 'Ewa',
      updatedAt: h.world.now,
    },
  ]);
  const done = await put('done', {updatedBy: 'Bartek'});
  assert.equal(done.body.statuses[0].status, 'done');
  assert.equal(done.body.statuses[0].updatedBy, 'Bartek');
  assert.equal(
    (await put('acknowledged')).body.statuses[0].status,
    'acknowledged',
  );
  assert.deepEqual((await put('pending')).body.statuses, []);
  assert.deepEqual((await put('pending')).body.statuses, []);
  assert.equal((await put('done')).body.statuses.length, 1);
  assert.equal((await api(h, 'GET', '/api/state')).body.statuses.length, 1);

  // Last week may still be changed; the future may not.
  assert.equal((await put('done', {weekStart: '2026-11-02'})).status, 200);
  const rejected: Array<[object, string]> = [
    [{status: 'finished'}, 'invalid_status'],
    [{weekStart: '2026-11-16'}, 'invalid_week'],
    [{weekStart: '2026-11-10'}, 'invalid_week'],
    [{taskKey: 'free-6'}, 'invalid_task'],
    [{taskKey: 'okna'}, 'invalid_task'],
    [{updatedBy: 'Obcy'}, 'unknown_person'],
    [{updatedBy: ''}, 'invalid_request'],
  ];
  for (const [extra, error] of rejected) {
    const result = await put('done', extra);
    assert.equal(result.status, 400);
    assert.equal(result.body.error, error);
  }
});

test('malformed requests and unknown paths', async () => {
  const h = await createHarness(WEDNESDAY);
  await api(h, 'GET', '/api/state');
  const auth = {authorization: `Bearer ${CODE}`};
  const raw = async (body: string) => {
    const {handleRequest} = await import('../src/worker/app.ts');
    const request = new Request('https://app.example/api/prefs', {
      method: 'PUT',
      headers: auth,
      body,
    });
    return (await handleRequest(request, h.env, h.deps)).status;
  };
  assert.equal(await raw('{'), 400);
  assert.equal(await raw('[1]'), 400);
  assert.equal(await raw(JSON.stringify({pad: 'x'.repeat(9000)})), 413);
  assert.equal((await api(h, 'GET', '/api/nope')).status, 404);
  assert.equal((await api(h, 'POST', '/api/state')).status, 404);
});

test('CORS is granted only to configured origins', async () => {
  const h = await createHarness(WEDNESDAY);
  const preflight = await api(h, 'OPTIONS', '/api/state', undefined, {
    origin: 'https://pages.example',
    'access-control-request-method': 'PUT',
  });
  assert.equal(preflight.status, 204);
  assert.equal(
    preflight.headers.get('access-control-allow-origin'),
    'https://pages.example',
  );
  const allowed = await api(h, 'GET', '/api/state', undefined, {
    origin: 'https://pages.example',
    authorization: `Bearer ${CODE}`,
  });
  assert.equal(
    allowed.headers.get('access-control-allow-origin'),
    'https://pages.example',
  );
  const denied = await api(h, 'GET', '/api/state', undefined, {
    origin: 'https://elsewhere.example',
    authorization: `Bearer ${CODE}`,
  });
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
  const unauthorized = await api(h, 'GET', '/api/state', undefined, {
    origin: 'https://pages.example',
  });
  assert.equal(unauthorized.status, 401);
  assert.ok(unauthorized.headers.get('access-control-allow-origin'));
});
