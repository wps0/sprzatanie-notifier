/** @fileoverview Builds a Worker environment with fake I/O for tests. */

import {readFile} from 'node:fs/promises';

import {generateVapidKeys} from '../../src/core/webpush.js';
import {handleRequest} from '../../src/worker/app.ts';
import type {Deps, Env} from '../../src/worker/env.ts';
import type {Database} from '../../src/worker/store.ts';
import {createD1} from './d1.js';

export const CODE = 'test-code-1234';
const SHEET_URL = 'https://tenant-my.sharepoint.com/:x:/g/personal/x/TOKEN';
const FIXTURE = new URL('../fixtures/grafik.xlsx', import.meta.url);

/** Valid subscription keys (the receiver from the RFC 8291 example). */
export const KEYS = {
  p256dh:
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7' +
    'Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
};

export function endpoint(name: string): string {
  return `https://fcm.googleapis.com/fcm/send/${name}`;
}

export interface Harness {
  readonly env: Env;
  readonly deps: Deps;
  /** Endpoints that received a push, in order. */
  readonly pushes: string[];
  /** Mutable knobs of the fake world. */
  readonly world: {
    now: number;
    sheetDownloads: number;
    sheetBody: BodyInit;
    pushStatus: (endpoint: string) => number;
  };
}

export async function createHarness(nowIso: string): Promise<Harness> {
  const vapid = await generateVapidKeys();
  const pushes: string[] = [];
  const world: Harness['world'] = {
    now: Date.parse(nowIso),
    sheetDownloads: 0,
    sheetBody: new Uint8Array((await readFile(FIXTURE)).buffer),
    pushStatus: () => 201,
  };
  const fakeFetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    if (new URL(url).hostname.endsWith('.sharepoint.com')) {
      world.sheetDownloads++;
      return new Response(world.sheetBody);
    }
    pushes.push(url);
    return new Response(null, {status: world.pushStatus(url)});
  };
  const env: Env = {
    DB: createD1() as Database,
    FLAT_CODE: CODE,
    SHEET_URL,
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey ?? '',
    VAPID_SUBJECT: 'https://example.org',
    ALLOWED_ORIGINS: 'https://pages.example',
  };
  const deps: Deps = {fetch: fakeFetch as typeof fetch, now: () => world.now};
  return {env, deps, pushes, world};
}

export interface ApiResult {
  readonly status: number;
  // Tests read arbitrary fields of arbitrary endpoints.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly body: any;
  readonly headers: Headers;
}

export async function api(
  harness: Harness,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {authorization: `Bearer ${CODE}`},
): Promise<ApiResult> {
  const request = new Request(`https://app.example${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await handleRequest(request, harness.env, harness.deps);
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
    headers: response.headers,
  };
}

export async function subscribe(
  harness: Harness,
  person: string,
  device: string,
): Promise<void> {
  const result = await api(harness, 'POST', '/api/subscriptions', {
    person,
    subscription: {endpoint: endpoint(device), keys: KEYS},
  });
  if (result.status !== 200) throw new Error(JSON.stringify(result.body));
}
