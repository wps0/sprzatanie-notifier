/**
 * @fileoverview Builds the web app into dist/: compiles TypeScript, builds
 * the Tailwind stylesheet, copies static files and tells the service worker
 * which files make up the app shell. Usage: npm run build
 */

import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join, relative, sep} from 'node:path';

import {normalizeApiBaseUrl, prepareIndexHtml} from './html.ts';

const OUT_DIR = 'dist';
const BIN_DIR = join('node_modules', '.bin');
/** Never precached: the worker itself and files only the host reads. */
const NOT_SHELL = new Set(['sw.js', '_headers']);

function run(tool: string, args: readonly string[]): void {
  execFileSync(join(BIN_DIR, tool), args, {stdio: 'inherit'});
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter(entry => entry.isFile())
    .map(entry => relative(directory, join(entry.parentPath, entry.name)))
    .map(file => file.split(sep).join('/'))
    .sort();
}

await rm(OUT_DIR, {recursive: true, force: true});
run('tsc', ['-p', 'tsconfig.web.json']);
run('tsc', ['-p', 'tsconfig.sw.json']);
run('tailwindcss', [
  '--input',
  'src/web/style.css',
  '--output',
  join(OUT_DIR, 'style.css'),
  '--minify',
]);

// When the web app is hosted away from the API (for example on GitHub
// Pages), API_BASE_URL names the Worker and is allowed in the CSP.
const apiBaseUrl = normalizeApiBaseUrl(process.env['API_BASE_URL']);
const html = prepareIndexHtml(
  await readFile('src/web/index.html', 'utf8'),
  apiBaseUrl,
);
await writeFile(join(OUT_DIR, 'index.html'), html);
await cp('src/web/static', OUT_DIR, {recursive: true});

const files = (await listFiles(OUT_DIR)).filter(file => !NOT_SHELL.has(file));
const hash = createHash('sha256');
for (const file of files) {
  hash.update(file).update(await readFile(join(OUT_DIR, file)));
}
const buildId = hash.digest('hex').slice(0, 12);
const shell = ['./', ...files.map(file => `./${file}`)];

const workerPath = join(OUT_DIR, 'sw.js');
const worker = (await readFile(workerPath, 'utf8'))
  .replace('__BUILD_ID__', buildId)
  .replace('__SHELL_FILES__', JSON.stringify(shell));
await writeFile(workerPath, worker);
console.log(`Built ${files.length} files into ${OUT_DIR}/ (${buildId}).`);
