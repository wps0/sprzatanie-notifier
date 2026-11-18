/** @fileoverview One function per API endpoint. */

import {DEFAULT_RULES, validateRules} from '../core/reminders.ts';
import {addDays} from '../core/schedule.js';
import {localParts} from '../core/time.js';
import {b64url} from '../core/webpush.js';
import type {
  AppState,
  NotificationPayload,
  PrefsResponse,
  PushSubscriptionData,
  Schedule,
  TaskStatus,
  TaskStatusEntry,
} from '../shared/types.ts';
import type {Deps, Env} from './env.ts';
import {timeZoneOf} from './env.ts';
import {HttpError} from './http.ts';
import type {ScheduleError} from './refresh.ts';
import {refreshSchedule} from './refresh.ts';
import {
  clearStatus,
  deleteSubscription,
  findSubscription,
  getMeta,
  getRules,
  listStatuses,
  loadSchedule,
  setRules,
  setStatus,
  upsertSubscription,
} from './store.ts';
import {pushToDevices} from './tick.ts';

const STATUS_HISTORY_DAYS = 56;
const EMPTY_SCHEDULE: Schedule = {
  tasks: [],
  people: [],
  weeks: [],
  warnings: [],
};

/** Hosts of the push services of Chrome, Firefox, Safari and Edge. */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /\.push\.apple\.com$/,
  /\.notify\.windows\.com$/,
];

const TEST_NOTIFICATION: NotificationPayload = {
  title: 'Sprzątanie',
  body: 'Powiadomienia działają. Tak będą wyglądać przypomnienia.',
  tag: 'test',
  url: './',
};

type Json = Record<string, unknown>;

function field(body: Json, name: string): string {
  const value = body[name];
  if (typeof value !== 'string' || value === '') {
    throw new HttpError(400, 'invalid_request', `Brak pola „${name}".`);
  }
  return value;
}

async function requireSchedule(env: Env): Promise<Schedule> {
  const schedule = await loadSchedule(env.DB);
  if (!schedule) {
    throw new HttpError(
      409,
      'no_schedule',
      'Grafik nie został jeszcze wczytany.',
    );
  }
  return schedule;
}

function requirePerson(schedule: Schedule, person: string): string {
  if (!schedule.people.includes(person)) {
    throw new HttpError(400, 'unknown_person', `Nie ma osoby „${person}".`);
  }
  return person;
}

function today(env: Env, deps: Deps): string {
  return localParts(deps.now(), timeZoneOf(env)).date;
}

async function recentStatuses(
  env: Env,
  deps: Deps,
): Promise<TaskStatusEntry[]> {
  return listStatuses(env.DB, addDays(today(env, deps), -STATUS_HISTORY_DAYS));
}

/** `GET /api/state`. Loads the schedule first if there is none yet. */
export async function getState(env: Env, deps: Deps): Promise<AppState> {
  let schedule = await loadSchedule(env.DB);
  if (!schedule) {
    await refreshSchedule(env, deps);
    schedule = await loadSchedule(env.DB);
  }
  const fetchedAt = await getMeta(env.DB, 'schedule_fetched_at');
  const errorJson = await getMeta(env.DB, 'schedule_error');
  const error = errorJson ? (JSON.parse(errorJson) as ScheduleError) : null;
  return {
    now: deps.now(),
    today: today(env, deps),
    timezone: timeZoneOf(env),
    schedule: schedule ?? EMPTY_SCHEDULE,
    sheet: {
      fetchedAt: fetchedAt ? Number(fetchedAt) : null,
      error: error ? error.message : null,
      url: env.SHEET_URL,
    },
    statuses: await recentStatuses(env, deps),
    vapidPublicKey: env.VAPID_PUBLIC_KEY,
    defaultRules: DEFAULT_RULES,
  };
}

/** `POST /api/refresh`. Rate-limited inside `refreshSchedule`. */
export async function postRefresh(env: Env, deps: Deps): Promise<AppState> {
  await refreshSchedule(env, deps);
  return getState(env, deps);
}

/** `GET /api/prefs?person=`. */
export async function getPrefs(
  env: Env,
  person: string | null,
): Promise<PrefsResponse> {
  const schedule = await requireSchedule(env);
  const name = requirePerson(schedule, person ?? '');
  const rules = await getRules(env.DB, name);
  return {person: name, rules: rules ?? DEFAULT_RULES, isDefault: !rules};
}

/** `PUT /api/prefs`. `rules: null` restores the defaults. */
export async function putPrefs(
  env: Env,
  deps: Deps,
  body: Json,
): Promise<PrefsResponse> {
  const schedule = await requireSchedule(env);
  const person = requirePerson(schedule, field(body, 'person'));
  const rules = body['rules'] === null ? null : validateRules(body['rules']);
  await setRules(env.DB, person, rules, deps.now());
  return getPrefs(env, person);
}

function decodedLength(text: unknown): number {
  if (typeof text !== 'string') return -1;
  try {
    return b64url.decode(text).length;
  } catch {
    return -1;
  }
}

function parseSubscription(input: unknown): PushSubscriptionData {
  const {endpoint, keys} = (input ?? {}) as Partial<PushSubscriptionData>;
  let url: URL;
  try {
    url = new URL(String(endpoint));
  } catch {
    throw new HttpError(400, 'invalid_request', 'Nieprawidłowa subskrypcja.');
  }
  if (
    url.protocol !== 'https:' ||
    !PUSH_HOSTS.some(pattern => pattern.test(url.hostname))
  ) {
    throw new HttpError(
      400,
      'unsupported_push_service',
      `Nieobsługiwana usługa powiadomień: ${url.hostname}.`,
    );
  }
  if (decodedLength(keys?.p256dh) !== 65 || decodedLength(keys?.auth) !== 16) {
    throw new HttpError(400, 'invalid_request', 'Nieprawidłowa subskrypcja.');
  }
  return {
    endpoint: url.href,
    keys: {p256dh: keys!.p256dh, auth: keys!.auth},
  };
}

/** `POST /api/subscriptions`. Registers or re-assigns a device. */
export async function postSubscription(
  env: Env,
  deps: Deps,
  body: Json,
  userAgent: string | null,
): Promise<{ok: true}> {
  const schedule = await requireSchedule(env);
  const person = requirePerson(schedule, field(body, 'person'));
  const subscription = parseSubscription(body['subscription']);
  await upsertSubscription(
    env.DB,
    {...subscription, person},
    userAgent?.slice(0, 200) ?? null,
    deps.now(),
  );
  return {ok: true};
}

/** `DELETE /api/subscriptions`. */
export async function deleteSubscriptionHandler(
  env: Env,
  body: Json,
): Promise<{ok: true}> {
  await deleteSubscription(env.DB, field(body, 'endpoint'));
  return {ok: true};
}

/** `POST /api/push-test`. Sends a test notification to one device. */
export async function postPushTest(
  env: Env,
  deps: Deps,
  body: Json,
): Promise<{ok: boolean; gone: boolean}> {
  const endpoint = field(body, 'endpoint');
  const device = await findSubscription(env.DB, endpoint);
  if (!device) return {ok: false, gone: true};
  const ok = await pushToDevices(env, deps, [device], TEST_NOTIFICATION, {
    urgency: 'high',
  });
  const gone = !ok && !(await findSubscription(env.DB, endpoint));
  return {ok, gone};
}

const STATUSES: readonly TaskStatus[] = ['pending', 'acknowledged', 'done'];

/** `PUT /api/task-status`. Any transition between the three is allowed. */
export async function putTaskStatus(
  env: Env,
  deps: Deps,
  body: Json,
): Promise<{statuses: TaskStatusEntry[]}> {
  const schedule = await requireSchedule(env);
  const weekStart = field(body, 'weekStart');
  const taskKey = field(body, 'taskKey');
  const status = field(body, 'status') as TaskStatus;
  const updatedBy = requirePerson(schedule, field(body, 'updatedBy'));
  if (!STATUSES.includes(status)) {
    throw new HttpError(400, 'invalid_status', 'Nieznany stan zadania.');
  }
  const week = schedule.weeks.find(candidate => candidate.start === weekStart);
  if (!week || weekStart > today(env, deps)) {
    throw new HttpError(
      400,
      'invalid_week',
      'Można zmieniać tylko bieżący i minione tygodnie.',
    );
  }
  const task = schedule.tasks.find(candidate => candidate.key === taskKey);
  if (!task || task.free) {
    throw new HttpError(400, 'invalid_task', 'Nie ma takiego zadania.');
  }
  if (status === 'pending') {
    await clearStatus(env.DB, weekStart, taskKey);
  } else {
    await setStatus(env.DB, {
      weekStart,
      taskKey,
      status,
      updatedBy,
      updatedAt: deps.now(),
    });
  }
  return {statuses: await recentStatuses(env, deps)};
}
