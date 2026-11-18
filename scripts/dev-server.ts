/**
 * @fileoverview Local preview without Cloudflare: serves dist/ and the real
 * API handlers on one port, with an in-memory database and the test workbook
 * instead of the real sheet. Push messages are logged, not sent.
 *
 * Usage: npm run build && npm run dev
 * Then open http://localhost:8787/?code=dev
 * DEV_NOW=2026-11-11T12:00:00Z pins the clock.
 */

import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {extname, join, normalize} from 'node:path';

import {generateVapidKeys} from '../src/core/webpush.js';
import {handleRequest} from '../src/worker/app.ts';
import type {Deps, Env} from '../src/worker/env.ts';
import type {Database} from '../src/worker/store.ts';
import {createD1} from '../test/helpers/d1.js';

const PORT = Number(process.env['PORT'] ?? 8787);
const SHEET_URL = 'https://dev.sharepoint.com/fixture';
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

const fixture = await readFile('test/fixtures/grafik.xlsx');
const vapid = await generateVapidKeys();
const pinned = process.env['DEV_NOW'];
const offset = pinned ? Date.parse(pinned) - Date.now() : 0;

const env: Env = {
  DB: createD1() as Database,
  FLAT_CODE: 'dev',
  SHEET_URL,
  VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_KEY: vapid.privateKey ?? '',
  VAPID_SUBJECT: 'https://localhost',
};
const deps: Deps = {
  now: () => Date.now() + offset,
  fetch: async input => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith(SHEET_URL)) return new Response(fixture);
    console.log(`[push] ${url}`);
    return new Response(null, {status: 201});
  },
};

async function serveStatic(pathname: string): Promise<Response> {
  const path = normalize(pathname === '/' ? '/index.html' : pathname);
  try {
    const body = await readFile(join('dist', path));
    const type = CONTENT_TYPES[extname(path)] ?? 'application/octet-stream';
    return new Response(body, {headers: {'content-type': type}});
  } catch {
    return new Response('Not found', {status: 404});
  }
}

createServer(async (incoming, outgoing) => {
  const url = new URL(incoming.url ?? '/', `http://localhost:${PORT}`);
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) chunks.push(chunk as Buffer);
  const hasBody = incoming.method !== 'GET' && incoming.method !== 'HEAD';
  const request = new Request(url, {
    method: incoming.method,
    headers: incoming.headers as Record<string, string>,
    body: hasBody ? Buffer.concat(chunks) : undefined,
  });
  const response = url.pathname.startsWith('/api/')
    ? await handleRequest(request, env, deps)
    : await serveStatic(url.pathname);
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
}).listen(PORT, () => {
  console.log(`Preview: http://localhost:${PORT}/?code=dev`);
});
