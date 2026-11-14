/** Data shapes shared by the Worker and the web app. Types only. */

/** One column of the sheet: a chore, or a free slot. */
export interface Task {
  readonly key: string;
  readonly title: string;
  readonly details: string;
  /** Free slots are shown in the schedule but never reminded. */
  readonly free: boolean;
}

/** One row of the sheet. `assignees[i]` does `tasks[i]` that week. */
export interface Week {
  readonly start: string;
  readonly end: string;
  readonly assignees: ReadonlyArray<string | null>;
}

export interface Schedule {
  readonly tasks: readonly Task[];
  readonly people: readonly string[];
  readonly weeks: readonly Week[];
  readonly warnings: readonly string[];
}

/**
 * `pending` sends reminders. `acknowledged` and `done` both silence them and
 * differ only in what the others see.
 */
export type TaskStatus = 'pending' | 'acknowledged' | 'done';

/** A stored, non-pending status of a task in a given week. */
export interface TaskStatusEntry {
  readonly weekStart: string;
  readonly taskKey: string;
  readonly status: Exclude<TaskStatus, 'pending'>;
  readonly updatedBy: string;
  readonly updatedAt: number;
}

/** "Remind me on this ISO weekday (Mon=1 .. Sun=7) at this local time." */
export interface ReminderRule {
  readonly weekday: number;
  readonly time: string;
}

/** The serialisable part of a browser PushSubscription. */
export interface PushSubscriptionData {
  readonly endpoint: string;
  readonly keys: {readonly p256dh: string; readonly auth: string};
}

/** What the service worker receives in a push event. */
export interface NotificationPayload {
  readonly title: string;
  readonly body: string;
  readonly tag: string;
  readonly url: string;
  readonly data?: {
    readonly weekStart: string;
    readonly taskKey: string;
    readonly person: string;
  };
}

/** Response of `GET /api/state`. */
export interface AppState {
  readonly now: number;
  /** Today's date in the flat's time zone, `YYYY-MM-DD`. */
  readonly today: string;
  readonly timezone: string;
  readonly schedule: Schedule;
  readonly sheet: {
    readonly fetchedAt: number | null;
    readonly error: string | null;
    readonly url: string;
  };
  readonly statuses: readonly TaskStatusEntry[];
  readonly vapidPublicKey: string;
  readonly defaultRules: readonly ReminderRule[];
}

export interface PrefsResponse {
  readonly person: string;
  readonly rules: readonly ReminderRule[];
  readonly isDefault: boolean;
}

export interface ApiError {
  readonly error: string;
  readonly message: string;
}
