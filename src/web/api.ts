/** @fileoverview Client for the Worker's JSON API. */

import type {
  ApiError,
  AppState,
  PrefsResponse,
  PushSubscriptionData,
  ReminderRule,
  TaskStatus,
  TaskStatusEntry,
} from '../shared/types.ts';

/** The server answered with an error status. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Empty when the API is on this origin; set when hosted elsewhere. */
export const API_BASE_URL =
  document
    .querySelector('meta[name="api-base-url"]')
    ?.getAttribute('content')
    ?.replace(/\/+$/, '') ?? '';

async function request<T>(
  code: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${code}`,
      ...(body === undefined ? {} : {'content-type': 'application/json'}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (payload ?? {}) as Partial<ApiError>;
    throw new ApiRequestError(
      response.status,
      error.error ?? 'unknown',
      error.message ?? 'Coś poszło nie tak. Spróbuj ponownie.',
    );
  }
  return payload as T;
}

export function fetchState(code: string): Promise<AppState> {
  return request(code, 'GET', '/api/state');
}

export function refreshSheet(code: string): Promise<AppState> {
  return request(code, 'POST', '/api/refresh');
}

export function fetchPrefs(
  code: string,
  person: string,
): Promise<PrefsResponse> {
  const query = new URLSearchParams({person});
  return request(code, 'GET', `/api/prefs?${query}`);
}

export function savePrefs(
  code: string,
  person: string,
  rules: readonly ReminderRule[] | null,
): Promise<PrefsResponse> {
  return request(code, 'PUT', '/api/prefs', {person, rules});
}

export function saveSubscription(
  code: string,
  person: string,
  subscription: PushSubscriptionData,
): Promise<{ok: true}> {
  return request(code, 'POST', '/api/subscriptions', {person, subscription});
}

export function removeSubscription(
  code: string,
  endpoint: string,
): Promise<{ok: true}> {
  return request(code, 'DELETE', '/api/subscriptions', {endpoint});
}

export function sendTestPush(
  code: string,
  endpoint: string,
): Promise<{ok: boolean; gone: boolean}> {
  return request(code, 'POST', '/api/push-test', {endpoint});
}

export function saveTaskStatus(
  code: string,
  entry: {
    weekStart: string;
    taskKey: string;
    status: TaskStatus;
    updatedBy: string;
  },
): Promise<{statuses: TaskStatusEntry[]}> {
  return request(code, 'PUT', '/api/task-status', entry);
}
