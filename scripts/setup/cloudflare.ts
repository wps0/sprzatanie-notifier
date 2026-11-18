/**
 * @fileoverview One-time Cloudflare setup, steps 1–3 of docs/DEPLOYMENT.md:
 * D1 database, workers.dev address, VAPID keys, the Worker's secrets and the
 * database migrations. Safe to run again: it skips what already exists and
 * never prints a secret it did not just create.
 *
 * Meant to run inside the container started by scripts/setup/podman.sh, with
 * CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment.
 * Usage: node scripts/setup/cloudflare.ts [--new-code] [--new-sheet-url] [--deploy]
 */

import {spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {stdin, stdout} from 'node:process';
import {createInterface} from 'node:readline/promises';
import {parseArgs} from 'node:util';

import {generateVapidKeys} from '../../src/core/webpush.ts';
import type {VapidKeys} from '../../src/core/webpush.ts';
import {generateFlatCode} from '../flat-code.ts';
import type {SetupValues} from './wrangler-config.ts';
import {
  PLACEHOLDER_DATABASE_ID,
  readSetupValues,
  writeSetupValues,
} from './wrangler-config.ts';

/** Must match `name` and `database_name` in wrangler.jsonc. */
export const WORKER_NAME = 'sprzatanie';
export const DATABASE_NAME = 'sprzatanie';

const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export interface CommandResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

/** Everything the setup does to the outside world, so tests can fake it. */
export interface SetupIO {
  wrangler(args: readonly string[], input?: string): CommandResult;
  build(): CommandResult;
  /** The account's workers.dev subdomain, or null when none is chosen yet. */
  getSubdomain(): Promise<string | null>;
  createSubdomain(name: string): Promise<void>;
  ask(question: string): Promise<string>;
  readConfig(): string;
  writeConfig(text: string): void;
  generateVapidKeys(): Promise<VapidKeys>;
  generateFlatCode(): string;
  log(message: string): void;
}

export interface SetupOptions {
  /** Replace FLAT_CODE even if it exists; every device must sign in again. */
  readonly newCode?: boolean;
  /** Ask for SHEET_URL even if it exists. */
  readonly newSheetUrl?: boolean;
  /** Build and deploy right away instead of waiting for a merge. */
  readonly deploy?: boolean;
}

export interface SetupResult {
  readonly appUrl: string;
  /** Set only when this run created a new flat code. */
  readonly flatCode: string | null;
  readonly configChanged: boolean;
}

function wranglerOrThrow(
  io: SetupIO,
  args: readonly string[],
  input?: string,
): string {
  const result = io.wrangler(args, input);
  if (!result.ok) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new Error(
      `wrangler ${args.slice(0, 3).join(' ')} failed:\n${detail}`,
    );
  }
  return result.stdout;
}

/** Parses the JSON array Wrangler prints, ignoring any banner before it. */
function parseJsonArray<T>(text: string): T[] {
  const start = text.indexOf('[');
  if (start < 0) throw new Error(`unexpected Wrangler output: ${text.trim()}`);
  return JSON.parse(text.slice(start)) as T[];
}

function findDatabaseId(io: SetupIO): string | null {
  const databases = parseJsonArray<{name: string; uuid: string}>(
    wranglerOrThrow(io, ['d1', 'list', '--json']),
  );
  return databases.find(db => db.name === DATABASE_NAME)?.uuid ?? null;
}

function listSecrets(io: SetupIO): Set<string> {
  const result = io.wrangler(['secret', 'list', '--format', 'json']);
  if (!result.ok) {
    // A Worker that does not exist yet simply has no secrets.
    if (/10007|does not exist|not found/i.test(result.stderr)) return new Set();
    throw new Error(`wrangler secret list failed:\n${result.stderr.trim()}`);
  }
  const secrets = parseJsonArray<{name: string}>(result.stdout);
  return new Set(secrets.map(secret => secret.name));
}

function putSecret(io: SetupIO, name: string, value: string): void {
  // Passed on stdin, never on the command line.
  wranglerOrThrow(io, ['secret', 'put', name], value);
}

async function askUntilValid(
  io: SetupIO,
  question: string,
  validate: (answer: string) => string | null,
): Promise<string> {
  for (;;) {
    const answer = (await io.ask(question)).trim();
    const problem = validate(answer);
    if (!problem) return answer;
    io.log(`  ${problem}`);
  }
}

function validateSheetUrl(answer: string): string | null {
  try {
    return new URL(answer).protocol === 'https:'
      ? null
      : 'Link musi zaczynać się od https://';
  } catch {
    return 'To nie jest poprawny link.';
  }
}

function validateSubdomain(answer: string): string | null {
  return SUBDOMAIN_PATTERN.test(answer)
    ? null
    : 'Tylko małe litery, cyfry i myślniki (nie na początku ani na końcu).';
}

export async function runSetup(
  io: SetupIO,
  options: SetupOptions = {},
): Promise<SetupResult> {
  const original = io.readConfig();
  let values: SetupValues = readSetupValues(original);
  const update = (patch: Partial<SetupValues>) => {
    io.writeConfig(writeSetupValues(io.readConfig(), patch));
    values = {...values, ...patch};
  };

  io.log('1/4 Baza danych D1');
  let databaseId = findDatabaseId(io);
  if (!databaseId) {
    wranglerOrThrow(io, [
      'd1',
      'create',
      DATABASE_NAME,
      '--update-config=false',
    ]);
    databaseId = findDatabaseId(io);
    if (!databaseId) throw new Error('the new D1 database is not listed');
    io.log(`  utworzona: ${databaseId}`);
  } else {
    io.log(`  istnieje: ${databaseId}`);
  }
  if (values.databaseId === PLACEHOLDER_DATABASE_ID) {
    update({databaseId});
  } else if (values.databaseId !== databaseId) {
    throw new Error(
      `wrangler.jsonc names database ${values.databaseId}, but the ` +
        `"${DATABASE_NAME}" database on this account is ${databaseId}. ` +
        'Fix database_id in wrangler.jsonc or use the right account.',
    );
  }

  io.log('2/4 Adres workers.dev');
  let subdomain = await io.getSubdomain();
  if (!subdomain) {
    io.log(
      '  Konto nie ma jeszcze subdomeny workers.dev. Będzie częścią linku',
    );
    io.log('  dla współlokatorów, więc lepiej bez imienia i nazwiska.');
    subdomain = await askUntilValid(
      io,
      '  Subdomena (np. nasze-mieszkanie): ',
      validateSubdomain,
    );
    await io.createSubdomain(subdomain);
  }
  const appUrl = `https://${WORKER_NAME}.${subdomain}.workers.dev`;
  io.log(`  ${appUrl}`);
  if (!values.vapidSubject) update({vapidSubject: appUrl});

  io.log('3/4 Klucze i sekrety Workera');
  const secrets = listSecrets(io);
  if (!values.vapidPublicKey) {
    const keys = await io.generateVapidKeys();
    // Secret first: if this fails, the config still has no public key.
    putSecret(io, 'VAPID_PRIVATE_KEY', keys.privateKey);
    update({vapidPublicKey: keys.publicKey});
    io.log('  nowe klucze VAPID');
  } else if (!secrets.has('VAPID_PRIVATE_KEY')) {
    throw new Error(
      'wrangler.jsonc has VAPID_PUBLIC_KEY but the Worker has no ' +
        'VAPID_PRIVATE_KEY, and the private half cannot be recovered. ' +
        'Empty VAPID_PUBLIC_KEY in wrangler.jsonc and run the setup again ' +
        '(devices will have to enable notifications again).',
    );
  }
  let flatCode: string | null = null;
  if (!secrets.has('FLAT_CODE') || options.newCode) {
    flatCode = io.generateFlatCode();
    putSecret(io, 'FLAT_CODE', flatCode);
    io.log('  nowy kod mieszkania');
  }
  if (!secrets.has('SHEET_URL') || options.newSheetUrl) {
    const sheetUrl = await askUntilValid(
      io,
      '  Link udostępniania arkusza (https://…): ',
      validateSheetUrl,
    );
    putSecret(io, 'SHEET_URL', sheetUrl);
    io.log('  zapisano link do arkusza');
  }

  io.log('4/4 Migracje bazy');
  io.log(
    wranglerOrThrow(io, [
      'd1',
      'migrations',
      'apply',
      DATABASE_NAME,
      '--remote',
    ]).trim(),
  );

  if (options.deploy) {
    io.log('Wdrożenie');
    const build = io.build();
    if (!build.ok) throw new Error(`build failed:\n${build.stderr.trim()}`);
    io.log(wranglerOrThrow(io, ['deploy']).trim());
  }

  return {
    appUrl,
    flatCode,
    configChanged: io.readConfig() !== original,
  };
}

/** Real side effects, used when the file is run directly. */
function createIO(env: NodeJS.ProcessEnv): SetupIO {
  const token = env['CLOUDFLARE_API_TOKEN'] ?? '';
  const accountId = env['CLOUDFLARE_ACCOUNT_ID'] ?? '';
  const subdomainUrl =
    `https://api.cloudflare.com/client/v4/accounts/${accountId}` +
    '/workers/subdomain';
  const headers = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
  const run = (command: string, args: readonly string[], input = '') => {
    const result = spawnSync(command, args, {
      input,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    return {
      ok: result.status === 0,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? String(result.error ?? ''),
    };
  };
  const readline = createInterface({input: stdin, output: stdout});
  return {
    wrangler: (args, input) =>
      run(join('node_modules', '.bin', 'wrangler'), args, input),
    build: () => run('npm', ['run', 'build']),
    async getSubdomain() {
      const response = await fetch(subdomainUrl, {headers});
      if (response.status === 404) return null;
      const body = (await response.json()) as {
        success?: boolean;
        result?: {subdomain?: string} | null;
        errors?: unknown;
      };
      if (!response.ok || !body.success) {
        throw new Error(
          `Cloudflare API (workers subdomain): HTTP ${response.status} ` +
            JSON.stringify(body.errors ?? body),
        );
      }
      return body.result?.subdomain || null;
    },
    async createSubdomain(subdomain) {
      const response = await fetch(subdomainUrl, {
        method: 'PUT',
        headers,
        body: JSON.stringify({subdomain}),
      });
      if (!response.ok) {
        throw new Error(
          `Cloudflare API: could not create the subdomain "${subdomain}" ` +
            `(HTTP ${response.status}): ${await response.text()}`,
        );
      }
    },
    ask: question => readline.question(question),
    readConfig: () => readFileSync('wrangler.jsonc', 'utf8'),
    writeConfig: text => writeFileSync('wrangler.jsonc', text),
    generateVapidKeys,
    generateFlatCode,
    log: message => console.log(message),
  };
}

async function main(): Promise<void> {
  const {values: flags} = parseArgs({
    options: {
      'new-code': {type: 'boolean', default: false},
      'new-sheet-url': {type: 'boolean', default: false},
      deploy: {type: 'boolean', default: false},
    },
  });
  for (const name of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
    if (!process.env[name]) {
      throw new Error(`${name} is not set (see docs/DEPLOYMENT.md, step 4)`);
    }
  }
  const io = createIO(process.env);
  const result = await runSetup(io, {
    newCode: flags['new-code'],
    newSheetUrl: flags['new-sheet-url'],
    deploy: flags.deploy,
  });

  console.log('\nGotowe.');
  if (result.flatCode) {
    console.log('\nLink dla współlokatorów (zapisz go, kod nie będzie');
    console.log('pokazany ponownie):\n');
    console.log(`  ${result.appUrl}/?code=${result.flatCode}\n`);
  } else {
    console.log(`\nAdres aplikacji: ${result.appUrl}`);
  }
  if (result.configChanged) {
    console.log('wrangler.jsonc został uzupełniony. Wypuść tę zmianę');
    console.log("pull requestem; GitHub wdroży aplikację po merge'u.");
  }
  console.log(
    `\nDo środowiska "cloudflare" w GitHubie: zmienna ` +
      `CLOUDFLARE_ACCOUNT_ID=${process.env['CLOUDFLARE_ACCOUNT_ID']} ` +
      'i sekret CLOUDFLARE_API_TOKEN (docs/DEPLOYMENT.md, krok 5).',
  );
  process.exit(0);
}

if (import.meta.main) {
  main().catch((e: unknown) => {
    console.error(`\nBłąd: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
