import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import type {CommandResult, SetupIO} from '../scripts/setup/cloudflare.ts';
import {runSetup} from '../scripts/setup/cloudflare.ts';
import {
  PLACEHOLDER_DATABASE_ID,
  readSetupValues,
  writeSetupValues,
} from '../scripts/setup/wrangler-config.ts';

const WRANGLER_CONFIG = new URL('../wrangler.jsonc', import.meta.url);
const DB_ID = '1c0ffee0-0000-4000-8000-000000000001';

test('reads and fills the real wrangler.jsonc, keeping everything else', async () => {
  const config = await readFile(WRANGLER_CONFIG, 'utf8');
  assert.deepEqual(readSetupValues(config), {
    databaseId: PLACEHOLDER_DATABASE_ID,
    vapidPublicKey: '',
    vapidSubject: '',
  });
  const filled = writeSetupValues(config, {
    databaseId: DB_ID,
    vapidSubject: 'https://sprzatanie.flat.workers.dev',
  });
  assert.deepEqual(readSetupValues(filled), {
    databaseId: DB_ID,
    vapidPublicKey: '',
    vapidSubject: 'https://sprzatanie.flat.workers.dev',
  });
  const changed = filled
    .split('\n')
    .filter((line, i) => line !== config.split('\n')[i]);
  assert.equal(changed.length, 2, 'only the two edited lines differ');
  assert.throws(
    () => writeSetupValues(config, {vapidSubject: 'x" , "evil": "'}),
    /unexpected/,
  );
  assert.throws(() => readSetupValues('{}'), /not found/);
});

/** An in-memory Cloudflare account behind a fake `wrangler`. */
class FakeCloudflare implements SetupIO {
  config: string;
  databases: Array<{name: string; uuid: string}> = [];
  secrets = new Map<string, string>();
  subdomain: string | null = null;
  workerExists = false;
  answers: string[] = [];
  readonly questions: string[] = [];
  readonly commands: string[] = [];
  readonly logs: string[] = [];

  constructor(config: string) {
    this.config = config;
  }

  wrangler(args: readonly string[], input?: string): CommandResult {
    const command = args.join(' ');
    this.commands.push(command);
    const ok = (stdout = ''): CommandResult => ({ok: true, stdout, stderr: ''});
    if (command === 'd1 list --json') {
      return ok(`banner\n${JSON.stringify(this.databases)}`);
    }
    if (command === 'd1 create sprzatanie --update-config=false') {
      this.databases.push({name: 'sprzatanie', uuid: DB_ID});
      return ok('created');
    }
    if (command === 'secret list --format json') {
      if (!this.workerExists) {
        return {
          ok: false,
          stdout: '',
          stderr: 'This Worker does not exist [code: 10007]',
        };
      }
      return ok(JSON.stringify([...this.secrets.keys()].map(name => ({name}))));
    }
    if (args[0] === 'secret' && args[1] === 'put') {
      assert.ok(input, 'secret values arrive on stdin');
      this.workerExists = true;
      this.secrets.set(args[2], input);
      return ok();
    }
    if (command === 'd1 migrations apply sprzatanie --remote')
      return ok('applied');
    if (command === 'deploy') return ok('deployed');
    throw new Error(`unexpected wrangler ${command}`);
  }

  build(): CommandResult {
    this.commands.push('build');
    return {ok: true, stdout: '', stderr: ''};
  }

  async getSubdomain() {
    return this.subdomain;
  }

  async createSubdomain(name: string) {
    this.subdomain = name;
  }

  async ask(question: string) {
    this.questions.push(question);
    const answer = this.answers.shift();
    if (answer === undefined)
      throw new Error(`unexpected question: ${question}`);
    return answer;
  }

  readConfig() {
    return this.config;
  }

  writeConfig(text: string) {
    this.config = text;
  }

  async generateVapidKeys() {
    return {publicKey: 'BPublicKey_-1', privateKey: 'private-key'};
  }

  generateFlatCode() {
    return 'aaaa-bbbb-cccc-dddd';
  }

  log(message: string) {
    this.logs.push(message);
  }
}

async function freshAccount(): Promise<FakeCloudflare> {
  return new FakeCloudflare(await readFile(WRANGLER_CONFIG, 'utf8'));
}

test('a fresh account is set up completely in one run', async () => {
  const cloudflare = await freshAccount();
  cloudflare.answers = [
    'Nasze Mieszkanie',
    'nasze-mieszkanie',
    'http://x',
    'https://sheet.example/s',
  ];
  const result = await runSetup(cloudflare);

  assert.deepEqual(result, {
    appUrl: 'https://sprzatanie.nasze-mieszkanie.workers.dev',
    flatCode: 'aaaa-bbbb-cccc-dddd',
    configChanged: true,
  });
  assert.deepEqual(readSetupValues(cloudflare.config), {
    databaseId: DB_ID,
    vapidPublicKey: 'BPublicKey_-1',
    vapidSubject: 'https://sprzatanie.nasze-mieszkanie.workers.dev',
  });
  assert.deepEqual(Object.fromEntries(cloudflare.secrets), {
    VAPID_PRIVATE_KEY: 'private-key',
    FLAT_CODE: 'aaaa-bbbb-cccc-dddd',
    SHEET_URL: 'https://sheet.example/s',
  });
  assert.equal(
    cloudflare.questions.length,
    4,
    'invalid answers are asked again',
  );
  assert.ok(
    cloudflare.commands.includes('d1 migrations apply sprzatanie --remote'),
  );
  assert.ok(!cloudflare.commands.includes('deploy'), 'no deploy unless asked');
});

test('running it again changes nothing and asks nothing', async () => {
  const cloudflare = await freshAccount();
  cloudflare.answers = ['flat', 'https://sheet.example/s'];
  await runSetup(cloudflare);
  const config = cloudflare.config;
  const secrets = new Map(cloudflare.secrets);
  cloudflare.commands.length = 0;

  const again = await runSetup(cloudflare);
  assert.deepEqual(again, {
    appUrl: 'https://sprzatanie.flat.workers.dev',
    flatCode: null,
    configChanged: false,
  });
  assert.equal(cloudflare.config, config);
  assert.deepEqual(cloudflare.secrets, secrets);
  assert.ok(
    !cloudflare.commands.some(
      c => c.startsWith('secret put') || c.startsWith('d1 create'),
    ),
  );
});

test('--new-code and --new-sheet-url replace only those secrets', async () => {
  const cloudflare = await freshAccount();
  cloudflare.answers = ['flat', 'https://sheet.example/old'];
  await runSetup(cloudflare);
  cloudflare.generateFlatCode = () => 'zzzz-yyyy-xxxx-wwww';
  cloudflare.answers = ['https://sheet.example/new'];

  const result = await runSetup(cloudflare, {newCode: true, newSheetUrl: true});
  assert.equal(result.flatCode, 'zzzz-yyyy-xxxx-wwww');
  assert.equal(cloudflare.secrets.get('FLAT_CODE'), 'zzzz-yyyy-xxxx-wwww');
  assert.equal(
    cloudflare.secrets.get('SHEET_URL'),
    'https://sheet.example/new',
  );
  assert.equal(cloudflare.secrets.get('VAPID_PRIVATE_KEY'), 'private-key');
});

test('--deploy builds and deploys after the setup', async () => {
  const cloudflare = await freshAccount();
  cloudflare.answers = ['flat', 'https://sheet.example/s'];
  await runSetup(cloudflare, {deploy: true});
  assert.deepEqual(cloudflare.commands.slice(-3), [
    'd1 migrations apply sprzatanie --remote',
    'build',
    'deploy',
  ]);
});

test('refuses to continue when config and account disagree', async () => {
  const mismatch = await freshAccount();
  mismatch.databases = [{name: 'sprzatanie', uuid: DB_ID}];
  mismatch.config = writeSetupValues(mismatch.config, {
    databaseId: '22222222-2222-4222-8222-222222222222',
  });
  await assert.rejects(runSetup(mismatch), /names database 2222/);

  const lostKey = await freshAccount();
  lostKey.subdomain = 'flat';
  lostKey.config = writeSetupValues(lostKey.config, {vapidPublicKey: 'BOld'});
  await assert.rejects(runSetup(lostKey), /cannot be recovered/);
  assert.equal(lostKey.secrets.size, 0, 'nothing written before the check');
});
