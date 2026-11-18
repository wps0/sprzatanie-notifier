/**
 * @fileoverview Decides which reminders are due. Pure logic: no I/O, no clock.
 */

import type {
  NotificationPayload,
  ReminderRule,
  Schedule,
  Task,
} from '../shared/types.ts';
import {tasksFor, weekFor} from './schedule.js';
import {isoWeekday, localParts, slotsBetween} from './time.js';

/** Monday morning, Saturday late morning, Sunday evening. */
export const DEFAULT_RULES: readonly ReminderRule[] = [
  {weekday: 1, time: '09:00'},
  {weekday: 6, time: '11:00'},
  {weekday: 7, time: '18:00'},
];

const MAX_RULES = 10;
const TIME_PATTERN = /^([01]\d|2[0-3]):(00|15|30|45)$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Thrown for input the caller should fix; the message is user-facing. */
export class ValidationError extends Error {}

/** First reminder of the week, a later one, or the final one. */
export type ReminderKind = 'start' | 'nudge' | 'last';

export interface Reminder {
  readonly person: string;
  readonly weekStart: string;
  readonly weekEnd: string;
  readonly task: Task;
  readonly kind: ReminderKind;
  /** Whole days from the reminder's local date to the end of the week. */
  readonly daysLeft: number;
  readonly slotMs: number;
  /** Stable identity of this reminder; sending it twice is a bug. */
  readonly dedupeKey: string;
}

export interface DueRemindersInput {
  readonly schedule: Schedule;
  readonly rulesByPerson: ReadonlyMap<string, readonly ReminderRule[]>;
  /** Keys from `statusKey()` of tasks that are acknowledged or done. */
  readonly silenced: ReadonlySet<string>;
  /** Exclusive lower bound, epoch milliseconds. */
  readonly fromMs: number;
  /** Inclusive upper bound, epoch milliseconds. */
  readonly toMs: number;
  readonly timeZone: string;
}

/** Key under which a task's status in a week is looked up. */
export function statusKey(weekStart: string, taskKey: string): string {
  return `${weekStart}|${taskKey}`;
}

/** Returns normalised, de-duplicated rules or throws `ValidationError`. */
export function validateRules(input: unknown): ReminderRule[] {
  if (!Array.isArray(input) || input.length > MAX_RULES) {
    throw new ValidationError(
      `Lista przypomnień może mieć najwyżej ${MAX_RULES} pozycji.`,
    );
  }
  const rules = new Map<string, ReminderRule>();
  for (const item of input as unknown[]) {
    const {weekday, time} = (item ?? {}) as Partial<ReminderRule>;
    if (
      typeof weekday !== 'number' ||
      !Number.isInteger(weekday) ||
      weekday < 1 ||
      weekday > 7
    ) {
      throw new ValidationError('Dzień tygodnia musi być liczbą od 1 do 7.');
    }
    if (typeof time !== 'string' || !TIME_PATTERN.test(time)) {
      throw new ValidationError(
        'Godzina musi mieć postać GG:MM z minutami 00, 15, 30 lub 45.',
      );
    }
    rules.set(`${weekday}|${time}`, {weekday, time});
  }
  return [...rules.values()];
}

/** Position of a rule within a week that starts on `weekStart`. */
function ruleOrder(rule: ReminderRule, weekStart: string): string {
  const offset = (rule.weekday - isoWeekday(weekStart) + 7) % 7;
  return `${offset}|${rule.time}`;
}

function kindOf(
  rule: ReminderRule,
  rules: readonly ReminderRule[],
  weekStart: string,
): ReminderKind {
  const order = rules.map(r => ruleOrder(r, weekStart)).sort();
  const index = order.indexOf(ruleOrder(rule, weekStart));
  if (index === 0) return 'start';
  return index === order.length - 1 ? 'last' : 'nudge';
}

/**
 * Lists the reminders whose local wall-clock time falls in `(fromMs, toMs]`.
 * A repeated local hour (autumn clock change) yields each reminder once.
 */
export function dueReminders(input: DueRemindersInput): Reminder[] {
  const due = new Map<string, Reminder>();
  for (const slotMs of slotsBetween(input.fromMs, input.toMs)) {
    const local = localParts(slotMs, input.timeZone);
    const week = weekFor(input.schedule, local.date);
    if (!week) continue;
    const daysLeft = Math.round(
      (Date.parse(week.end) - Date.parse(local.date)) / DAY_MS,
    );
    for (const [person, rules] of input.rulesByPerson) {
      for (const rule of rules) {
        if (rule.weekday !== local.weekday || rule.time !== local.time) {
          continue;
        }
        for (const task of tasksFor(input.schedule, week, person)) {
          if (input.silenced.has(statusKey(week.start, task.key))) continue;
          const dedupeKey = [
            week.start,
            task.key,
            person,
            `${local.date}T${local.time}`,
          ].join('|');
          if (due.has(dedupeKey)) continue;
          due.set(dedupeKey, {
            person,
            weekStart: week.start,
            weekEnd: week.end,
            task,
            kind: kindOf(rule, rules, week.start),
            daysLeft,
            slotMs,
            dedupeKey,
          });
        }
      }
    }
  }
  return [...due.values()];
}

const TITLES: Readonly<Record<ReminderKind, string>> = {
  start: 'Twój dyżur',
  nudge: 'Przypomnienie',
  last: 'Ostatni dzwonek',
};

function deadlinePhrase(reminder: Reminder): string {
  if (reminder.daysLeft <= 0) return 'termin mija dziś';
  if (reminder.daysLeft === 1) return 'termin mija jutro';
  const [, month, day] = reminder.weekEnd.split('-');
  return `termin: ${day}.${month}`;
}

/** The notification shown for a reminder. */
export function buildNotification(reminder: Reminder): NotificationPayload {
  const deadline = deadlinePhrase(reminder);
  const {details} = reminder.task;
  return {
    title: `${TITLES[reminder.kind]}: ${reminder.task.title}`,
    body: details ? `${details} · ${deadline}` : deadline,
    tag: statusKey(reminder.weekStart, reminder.task.key),
    url: './',
    data: {
      weekStart: reminder.weekStart,
      taskKey: reminder.task.key,
      person: reminder.person,
    },
  };
}
