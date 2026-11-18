import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {normalizeApiBaseUrl, prepareIndexHtml} from '../scripts/html.ts';

const INDEX = new URL('../src/web/index.html', import.meta.url);

test('normalizeApiBaseUrl', () => {
  assert.equal(normalizeApiBaseUrl(undefined), '');
  assert.equal(normalizeApiBaseUrl('  '), '');
  assert.equal(
    normalizeApiBaseUrl('https://sprzatanie.example.workers.dev/'),
    'https://sprzatanie.example.workers.dev',
  );
  assert.equal(
    normalizeApiBaseUrl('http://localhost:8787'),
    'http://localhost:8787',
  );
  assert.throws(() => normalizeApiBaseUrl('http://example.com'), /HTTPS/);
  assert.throws(() => normalizeApiBaseUrl('https://x.dev/?a=1'), /query/);
  assert.throws(() => normalizeApiBaseUrl('not a url'));
});

test('prepareIndexHtml points the real page at a remote API', async () => {
  const html = await readFile(INDEX, 'utf8');
  assert.equal(prepareIndexHtml(html, ''), html);
  const remote = prepareIndexHtml(html, 'https://api.example.dev/base');
  assert.match(
    remote,
    /<meta name="api-base-url" content="https:\/\/api\.example\.dev\/base" \/>/,
  );
  assert.match(remote, /connect-src 'self' https:\/\/api\.example\.dev;/);
  assert.throws(() => prepareIndexHtml('<html></html>', ''), /missing/);
});
