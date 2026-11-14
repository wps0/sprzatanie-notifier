/** @fileoverview Downloads the workbook and caches the parsed schedule. */

import {buildSchedule} from '../core/schedule.js';
import {downloadWorkbook} from '../core/sheet-fetch.js';
import {readFirstSheet} from '../core/xlsx.js';
import type {Schedule} from '../shared/types.ts';
import type {Deps, Env} from './env.ts';
import {deleteMeta, getMeta, setMeta} from './store.ts';

const MAX_PEOPLE = 20;
const MAX_TASKS = 20;
const MAX_NAME_LENGTH = 60;
const MAX_JSON_BYTES = 200_000;
const MIN_INTERVAL_MS = 60_000;

/** Error stored in `meta.schedule_error`. */
export interface ScheduleError {
  readonly message: string;
  readonly at: number;
}

function assertPlausible(schedule: Schedule): void {
  const tooLong = (text: string) => text.length > MAX_NAME_LENGTH;
  if (schedule.people.length < 1 || schedule.people.length > MAX_PEOPLE) {
    throw new Error('schedule: implausible number of people');
  }
  if (schedule.tasks.length < 1 || schedule.tasks.length > MAX_TASKS) {
    throw new Error('schedule: implausible number of tasks');
  }
  if (schedule.weeks.length < 1) throw new Error('schedule: no weeks');
  if (
    schedule.people.some(tooLong) ||
    schedule.tasks.some(task => tooLong(task.title))
  ) {
    throw new Error('schedule: a name or a task title is too long');
  }
}

/**
 * Refreshes the cached schedule. A sheet that cannot be downloaded or
 * understood never replaces the last good schedule; the failure is recorded
 * instead. Returns false when skipped because the last attempt was recent.
 */
export async function refreshSchedule(
  env: Env,
  deps: Deps,
  options: {force?: boolean} = {},
): Promise<boolean> {
  const now = deps.now();
  const lastAttempt = Number(await getMeta(env.DB, 'schedule_attempt_at'));
  if (!options.force && now - lastAttempt < MIN_INTERVAL_MS) return false;
  await setMeta(env.DB, 'schedule_attempt_at', String(now));
  try {
    const {bytes} = await downloadWorkbook(env.SHEET_URL, {fetch: deps.fetch});
    const sheet = await readFirstSheet(bytes);
    const schedule: Schedule = buildSchedule(sheet.rows);
    assertPlausible(schedule);
    const json = JSON.stringify(schedule);
    if (json.length > MAX_JSON_BYTES) throw new Error('schedule: too large');
    await setMeta(env.DB, 'schedule_json', json);
    await setMeta(env.DB, 'schedule_fetched_at', String(now));
    await deleteMeta(env.DB, 'schedule_error');
  } catch (e: unknown) {
    const error: ScheduleError = {
      message: e instanceof Error ? e.message : String(e),
      at: now,
    };
    await setMeta(env.DB, 'schedule_error', JSON.stringify(error));
  }
  return true;
}
