/**
 * @fileoverview Reads and fills the three values in wrangler.jsonc that the
 * one-time setup owns. Edits are exact string replacements so that comments
 * and formatting of the file survive.
 */

/** The `database_id` wrangler.jsonc ships with. */
export const PLACEHOLDER_DATABASE_ID = '00000000-0000-0000-0000-000000000000';

export interface SetupValues {
  readonly databaseId: string;
  readonly vapidPublicKey: string;
  readonly vapidSubject: string;
}

const KEYS: Readonly<Record<keyof SetupValues, string>> = {
  databaseId: 'database_id',
  vapidPublicKey: 'VAPID_PUBLIC_KEY',
  vapidSubject: 'VAPID_SUBJECT',
};

/** Characters that can appear in a UUID, a base64url key or an https URL. */
const SAFE_VALUE = /^[\w.:/@+-]*$/;

function entryPattern(key: string): RegExp {
  return new RegExp(`("${key}"\\s*:\\s*)"([^"]*)"`);
}

export function readSetupValues(config: string): SetupValues {
  const read = (field: keyof SetupValues): string => {
    const match = entryPattern(KEYS[field]).exec(config);
    if (!match) throw new Error(`wrangler.jsonc: "${KEYS[field]}" not found`);
    return match[2];
  };
  return {
    databaseId: read('databaseId'),
    vapidPublicKey: read('vapidPublicKey'),
    vapidSubject: read('vapidSubject'),
  };
}

/** Returns the config with the given values replaced. */
export function writeSetupValues(
  config: string,
  values: Partial<SetupValues>,
): string {
  let result = config;
  for (const field of Object.keys(KEYS) as Array<keyof SetupValues>) {
    const value = values[field];
    if (value === undefined) continue;
    if (!SAFE_VALUE.test(value)) {
      throw new Error(`wrangler.jsonc: unexpected characters in ${field}`);
    }
    const pattern = entryPattern(KEYS[field]);
    if (!pattern.test(result)) {
      throw new Error(`wrangler.jsonc: "${KEYS[field]}" not found`);
    }
    result = result.replace(
      pattern,
      (_, prefix: string) => `${prefix}"${value}"`,
    );
  }
  return result;
}
