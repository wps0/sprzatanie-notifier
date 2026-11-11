import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './helpers/d1.js';

test('the D1 stand-in applies migrations and mimics the D1 calls the Worker uses', async () => {
  const db = createD1();
  const claim = () => db.prepare('INSERT OR IGNORE INTO sent (dedupe_key, sent_at) VALUES (?, ?)').bind('k1', 1).run();
  assert.equal((await claim()).meta.changes, 1);
  assert.equal((await claim()).meta.changes, 0, 'second claim of the same key is a no-op');

  await db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').bind('last_tick', '42').run();
  assert.deepEqual(await db.prepare('SELECT key, value FROM meta WHERE key = ?').bind('last_tick').first(), { key: 'last_tick', value: '42' });
  assert.equal(await db.prepare('SELECT value FROM meta WHERE key = ?').bind('last_tick').first('value'), '42');
  assert.equal(await db.prepare('SELECT value FROM meta WHERE key = ?').bind('nope').first(), null);

  const [, rows] = await db.batch([
    db.prepare('INSERT INTO task_status (week_start, task_key, status, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)').bind('2026-11-09', 'kuchnia', 'done', 'Ala', 5),
    db.prepare('SELECT week_start, task_key, status, updated_by FROM task_status'),
  ]);
  assert.deepEqual(rows.results, [{ week_start: '2026-11-09', task_key: 'kuchnia', status: 'done', updated_by: 'Ala' }]);

  await assert.rejects(db.prepare("INSERT INTO task_status VALUES ('2026-11-09', 'smieci', 'pending', 'Ala', 1)").run(), /CHECK/, 'only non-pending statuses are stored');

  await assert.rejects(db.batch([
    db.prepare('DELETE FROM task_status'),
    db.prepare('INSERT INTO no_such_table VALUES (1)'),
  ]));
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM task_status').first()).n, 1, 'failed batch rolls back');
});
