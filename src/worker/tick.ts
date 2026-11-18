/** @fileoverview The 15-minute cron: finds due reminders and pushes them. */

import {
  buildNotification,
  DEFAULT_RULES,
  dueReminders,
  statusKey,
} from '../core/reminders.ts';
import type {Reminder} from '../core/reminders.ts';
import {addDays} from '../core/schedule.js';
import {localParts} from '../core/time.js';
import {b64url, sendPush} from '../core/webpush.js';
import type {NotificationPayload, ReminderRule} from '../shared/types.ts';
import type {Deps, Env} from './env.ts';
import {timeZoneOf} from './env.ts';
import {
  claimReminder,
  deleteSubscription,
  getMeta,
  listRules,
  listStatuses,
  listSubscriptions,
  loadSchedule,
  recordPushFailure,
  recordPushSuccess,
  releaseReminder,
  setMeta,
} from './store.ts';
import type {StoredSubscription} from './store.ts';

const TICK_MS = 15 * 60 * 1000;
/** After an outage, reminders older than this are dropped, not sent late. */
const MAX_LOOKBACK_MS = 3 * 60 * 60 * 1000;
const STATUS_LOOKBACK_DAYS = 21;
const PUSH_TTL_SECONDS = 24 * 60 * 60;
const TOPIC_LENGTH = 32;

/** VAPID settings in the shape `sendPush` expects. */
export function vapidOf(env: Env) {
  return {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT,
  };
}

/**
 * Push services replace an undelivered message with a newer one that has the
 * same topic, so a phone that was offline gets only the latest reminder.
 */
async function topicFor(reminder: Reminder): Promise<string> {
  const text = [reminder.weekStart, reminder.task.key, reminder.person].join(
    '|',
  );
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return b64url.encode(new Uint8Array(digest)).slice(0, TOPIC_LENGTH);
}

/**
 * Sends one notification to every device of a person. Returns true when at
 * least one device accepted it. Dead subscriptions are removed.
 */
export async function pushToDevices(
  env: Env,
  deps: Deps,
  devices: readonly StoredSubscription[],
  payload: NotificationPayload,
  options: {urgency: 'normal' | 'high'; topic?: string},
): Promise<boolean> {
  const results = await Promise.allSettled(
    devices.map(device =>
      sendPush(device, payload, {
        vapid: vapidOf(env),
        ttl: PUSH_TTL_SECONDS,
        urgency: options.urgency,
        topic: options.topic,
        fetch: deps.fetch,
      }),
    ),
  );
  let delivered = false;
  for (const [index, result] of results.entries()) {
    const {endpoint} = devices[index];
    if (result.status === 'fulfilled' && result.value.ok) {
      delivered = true;
      await recordPushSuccess(env.DB, endpoint, deps.now());
    } else if (result.status === 'fulfilled' && result.value.gone) {
      await deleteSubscription(env.DB, endpoint);
    } else {
      await recordPushFailure(env.DB, endpoint);
    }
  }
  return delivered;
}

/** Runs one reminder tick for the instant `nowMs`. */
export async function runTick(
  env: Env,
  deps: Deps,
  nowMs: number,
): Promise<void> {
  const lastTick =
    Number(await getMeta(env.DB, 'last_tick')) || nowMs - TICK_MS;
  const fromMs = Math.max(lastTick, nowMs - MAX_LOOKBACK_MS);
  await setMeta(env.DB, 'last_tick', String(nowMs));

  const schedule = await loadSchedule(env.DB);
  if (!schedule) return;

  const devicesByPerson = new Map<string, StoredSubscription[]>();
  for (const device of await listSubscriptions(env.DB)) {
    const devices = devicesByPerson.get(device.person) ?? [];
    devices.push(device);
    devicesByPerson.set(device.person, devices);
  }
  if (devicesByPerson.size === 0) return;

  const storedRules = await listRules(env.DB);
  const rulesByPerson = new Map<string, readonly ReminderRule[]>();
  for (const person of devicesByPerson.keys()) {
    rulesByPerson.set(person, storedRules.get(person) ?? DEFAULT_RULES);
  }

  const timeZone = timeZoneOf(env);
  const today = localParts(nowMs, timeZone).date;
  const statuses = await listStatuses(
    env.DB,
    addDays(today, -STATUS_LOOKBACK_DAYS),
  );
  const silenced = new Set(
    statuses.map(entry => statusKey(entry.weekStart, entry.taskKey)),
  );

  const reminders = dueReminders({
    schedule,
    rulesByPerson,
    silenced,
    fromMs,
    toMs: nowMs,
    timeZone,
  });
  let retryFromMs: number | null = null;
  for (const reminder of reminders) {
    if (!(await claimReminder(env.DB, reminder.dedupeKey, nowMs))) continue;
    const delivered = await pushToDevices(
      env,
      deps,
      devicesByPerson.get(reminder.person) ?? [],
      buildNotification(reminder),
      {
        urgency: reminder.kind === 'last' ? 'high' : 'normal',
        topic: await topicFor(reminder),
      },
    );
    if (!delivered) {
      // Give the claim back and rewind the watermark so the next tick looks
      // at this slot again. MAX_LOOKBACK_MS bounds the number of retries.
      await releaseReminder(env.DB, reminder.dedupeKey);
      retryFromMs = Math.min(retryFromMs ?? nowMs, reminder.slotMs - 1);
    }
  }
  if (retryFromMs !== null) {
    await setMeta(env.DB, 'last_tick', String(retryFromMs));
  }
}
