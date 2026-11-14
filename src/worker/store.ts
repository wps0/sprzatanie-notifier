/**
 * @fileoverview All SQL lives here. Works against Cloudflare D1 and against
 * the in-memory stand-in used by the tests.
 */

import type {
  PushSubscriptionData,
  ReminderRule,
  Schedule,
  TaskStatusEntry,
} from '../shared/types.ts';

/** The subset of a D1 prepared statement this project uses. */
export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T>(column?: string): Promise<T | null>;
  all<T>(): Promise<{results: T[]}>;
  run(): Promise<{meta: {changes: number}}>;
}

/** The subset of a D1 database this project uses. */
export interface Database {
  prepare(sql: string): Statement;
}

/** Keys of the `meta` table. */
export type MetaKey =
  | 'schedule_json'
  | 'schedule_fetched_at'
  | 'schedule_attempt_at'
  | 'schedule_error'
  | 'last_tick';

export interface StoredSubscription extends PushSubscriptionData {
  readonly person: string;
}

export async function getMeta(
  db: Database,
  key: MetaKey,
): Promise<string | null> {
  return db
    .prepare('SELECT value FROM meta WHERE key = ?')
    .bind(key)
    .first<string>('value');
}

export async function setMeta(
  db: Database,
  key: MetaKey,
  value: string,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO meta (key, value) VALUES (?, ?) ' +
        'ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    )
    .bind(key, value)
    .run();
}

export async function deleteMeta(db: Database, key: MetaKey): Promise<void> {
  await db.prepare('DELETE FROM meta WHERE key = ?').bind(key).run();
}

export async function loadSchedule(db: Database): Promise<Schedule | null> {
  const json = await getMeta(db, 'schedule_json');
  return json ? (JSON.parse(json) as Schedule) : null;
}

interface SubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
  person: string;
}

function toSubscription(row: SubscriptionRow): StoredSubscription {
  return {
    endpoint: row.endpoint,
    keys: {p256dh: row.p256dh, auth: row.auth},
    person: row.person,
  };
}

export async function listSubscriptions(
  db: Database,
): Promise<StoredSubscription[]> {
  const {results} = await db
    .prepare('SELECT endpoint, p256dh, auth, person FROM subscriptions')
    .all<SubscriptionRow>();
  return results.map(toSubscription);
}

export async function findSubscription(
  db: Database,
  endpoint: string,
): Promise<StoredSubscription | null> {
  const row = await db
    .prepare(
      'SELECT endpoint, p256dh, auth, person FROM subscriptions ' +
        'WHERE endpoint = ?',
    )
    .bind(endpoint)
    .first<SubscriptionRow>();
  return row ? toSubscription(row) : null;
}

export async function upsertSubscription(
  db: Database,
  subscription: StoredSubscription,
  userAgent: string | null,
  now: number,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO subscriptions ' +
        '(endpoint, p256dh, auth, person, user_agent, created_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?) ' +
        'ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, ' +
        'auth = excluded.auth, person = excluded.person, ' +
        'user_agent = excluded.user_agent, fail_count = 0',
    )
    .bind(
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth,
      subscription.person,
      userAgent,
      now,
    )
    .run();
}

export async function deleteSubscription(
  db: Database,
  endpoint: string,
): Promise<void> {
  await db
    .prepare('DELETE FROM subscriptions WHERE endpoint = ?')
    .bind(endpoint)
    .run();
}

export async function recordPushSuccess(
  db: Database,
  endpoint: string,
  now: number,
): Promise<void> {
  await db
    .prepare(
      'UPDATE subscriptions SET last_ok_at = ?, fail_count = 0 ' +
        'WHERE endpoint = ?',
    )
    .bind(now, endpoint)
    .run();
}

export async function recordPushFailure(
  db: Database,
  endpoint: string,
): Promise<void> {
  await db
    .prepare(
      'UPDATE subscriptions SET fail_count = fail_count + 1 ' +
        'WHERE endpoint = ?',
    )
    .bind(endpoint)
    .run();
}

/** Stored rules of one person, or null when they use the defaults. */
export async function getRules(
  db: Database,
  person: string,
): Promise<ReminderRule[] | null> {
  const json = await db
    .prepare('SELECT rules_json FROM prefs WHERE person = ?')
    .bind(person)
    .first<string>('rules_json');
  return json ? (JSON.parse(json) as ReminderRule[]) : null;
}

export async function listRules(
  db: Database,
): Promise<Map<string, ReminderRule[]>> {
  const {results} = await db
    .prepare('SELECT person, rules_json FROM prefs')
    .all<{person: string; rules_json: string}>();
  return new Map(
    results.map(row => [
      row.person,
      JSON.parse(row.rules_json) as ReminderRule[],
    ]),
  );
}

/** Stores a person's rules; `null` goes back to the defaults. */
export async function setRules(
  db: Database,
  person: string,
  rules: readonly ReminderRule[] | null,
  now: number,
): Promise<void> {
  if (rules === null) {
    await db.prepare('DELETE FROM prefs WHERE person = ?').bind(person).run();
    return;
  }
  await db
    .prepare(
      'INSERT INTO prefs (person, rules_json, updated_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT (person) DO UPDATE SET ' +
        'rules_json = excluded.rules_json, updated_at = excluded.updated_at',
    )
    .bind(person, JSON.stringify(rules), now)
    .run();
}

interface StatusRow {
  week_start: string;
  task_key: string;
  status: TaskStatusEntry['status'];
  updated_by: string;
  updated_at: number;
}

/** Non-pending statuses of weeks starting on or after `sinceWeekStart`. */
export async function listStatuses(
  db: Database,
  sinceWeekStart: string,
): Promise<TaskStatusEntry[]> {
  const {results} = await db
    .prepare(
      'SELECT week_start, task_key, status, updated_by, updated_at ' +
        'FROM task_status WHERE week_start >= ? ORDER BY week_start, task_key',
    )
    .bind(sinceWeekStart)
    .all<StatusRow>();
  return results.map(row => ({
    weekStart: row.week_start,
    taskKey: row.task_key,
    status: row.status,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  }));
}

export async function setStatus(
  db: Database,
  entry: TaskStatusEntry,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO task_status ' +
        '(week_start, task_key, status, updated_by, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?) ' +
        'ON CONFLICT (week_start, task_key) DO UPDATE SET ' +
        'status = excluded.status, updated_by = excluded.updated_by, ' +
        'updated_at = excluded.updated_at',
    )
    .bind(
      entry.weekStart,
      entry.taskKey,
      entry.status,
      entry.updatedBy,
      entry.updatedAt,
    )
    .run();
}

/** Back to `pending`. */
export async function clearStatus(
  db: Database,
  weekStart: string,
  taskKey: string,
): Promise<void> {
  await db
    .prepare('DELETE FROM task_status WHERE week_start = ? AND task_key = ?')
    .bind(weekStart, taskKey)
    .run();
}

/** Claims a reminder for sending. False means someone already sent it. */
export async function claimReminder(
  db: Database,
  dedupeKey: string,
  now: number,
): Promise<boolean> {
  const result = await db
    .prepare('INSERT OR IGNORE INTO sent (dedupe_key, sent_at) VALUES (?, ?)')
    .bind(dedupeKey, now)
    .run();
  return result.meta.changes === 1;
}

/** Gives a claim back so that the next tick retries the reminder. */
export async function releaseReminder(
  db: Database,
  dedupeKey: string,
): Promise<void> {
  await db
    .prepare('DELETE FROM sent WHERE dedupe_key = ?')
    .bind(dedupeKey)
    .run();
}

export async function pruneSent(db: Database, before: number): Promise<void> {
  await db.prepare('DELETE FROM sent WHERE sent_at < ?').bind(before).run();
}
