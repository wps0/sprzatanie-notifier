/** @fileoverview Request routing, authorisation and the cron dispatcher. */

import {ValidationError} from '../core/reminders.ts';
import type {Deps, Env} from './env.ts';
import {
  deleteSubscriptionHandler,
  getPrefs,
  getState,
  postPushTest,
  postRefresh,
  postSubscription,
  putPrefs,
  putTaskStatus,
} from './handlers.ts';
import {HttpError, jsonResponse, secretsEqual} from './http.ts';
import {refreshSchedule} from './refresh.ts';
import {pruneSent} from './store.ts';
import {runTick} from './tick.ts';

/** Must match `triggers.crons` in wrangler.jsonc exactly. */
export const TICK_CRON = '*/15 * * * *';
export const REFRESH_CRON = '7 */6 * * *';

const MAX_BODY_BYTES = 8 * 1024;
const SENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** The part of a Cloudflare scheduled event this project reads. */
export interface ScheduledEvent {
  readonly cron: string;
  readonly scheduledTime: number;
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('origin');
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

async function authorize(request: Request, env: Env): Promise<void> {
  const header = request.headers.get('authorization') ?? '';
  const code = header
    .replace(/^Bearer\s+/i, '')
    .trim()
    .toLowerCase();
  const expected = env.FLAT_CODE.trim().toLowerCase();
  if (!code || !(await secretsEqual(code, expected))) {
    throw new HttpError(401, 'unauthorized', 'Nieprawidłowy kod mieszkania.');
  }
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new HttpError(413, 'too_large', 'Zbyt duże żądanie.');
  }
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
  } catch {
    // Reported below.
  }
  throw new HttpError(400, 'invalid_request', 'Nieprawidłowa treść żądania.');
}

async function route(
  request: Request,
  url: URL,
  env: Env,
  deps: Deps,
): Promise<unknown> {
  switch (`${request.method} ${url.pathname}`) {
    case 'GET /api/state':
      return getState(env, deps);
    case 'POST /api/refresh':
      return postRefresh(env, deps);
    case 'GET /api/prefs':
      return getPrefs(env, url.searchParams.get('person'));
    case 'PUT /api/prefs':
      return putPrefs(env, deps, await readBody(request));
    case 'POST /api/subscriptions':
      return postSubscription(
        env,
        deps,
        await readBody(request),
        request.headers.get('user-agent'),
      );
    case 'DELETE /api/subscriptions':
      return deleteSubscriptionHandler(env, await readBody(request));
    case 'POST /api/push-test':
      return postPushTest(env, deps, await readBody(request));
    case 'PUT /api/task-status':
      return putTaskStatus(env, deps, await readBody(request));
    default:
      throw new HttpError(404, 'not_found', 'Nie ma takiego adresu.');
  }
}

/** Handles every request that is not a static asset. */
export async function handleRequest(
  request: Request,
  env: Env,
  deps: Deps,
): Promise<Response> {
  const cors = corsHeaders(request, env);
  if (request.method === 'OPTIONS') {
    return new Response(null, {status: 204, headers: cors});
  }
  try {
    await authorize(request, env);
    const body = await route(request, new URL(request.url), env, deps);
    return jsonResponse(body, 200, cors);
  } catch (e: unknown) {
    if (e instanceof HttpError) {
      return jsonResponse({error: e.code, message: e.message}, e.status, cors);
    }
    if (e instanceof ValidationError) {
      return jsonResponse(
        {error: 'invalid_request', message: e.message},
        400,
        cors,
      );
    }
    console.error(e);
    return jsonResponse(
      {error: 'internal', message: 'Błąd serwera. Spróbuj ponownie.'},
      500,
      cors,
    );
  }
}

/**
 * Runs a cron job. The two jobs are separate invocations on purpose: parsing
 * the sheet is the most expensive thing the Worker does and the free plan
 * allows 10 ms of CPU per invocation.
 */
export async function handleScheduled(
  event: ScheduledEvent,
  env: Env,
  deps: Deps,
): Promise<void> {
  if (event.cron === REFRESH_CRON) {
    await refreshSchedule(env, deps, {force: true});
    await pruneSent(env.DB, deps.now() - SENT_RETENTION_MS);
    return;
  }
  await runTick(env, deps, event.scheduledTime);
}
