/** @fileoverview The Worker's bindings and injected dependencies. */

import type {Database} from './store.ts';

/** Bindings and variables configured in wrangler.jsonc and as secrets. */
export interface Env {
  readonly DB: Database;
  /** Shared secret that every API call must present. */
  readonly FLAT_CODE: string;
  /** Share link of the workbook. */
  readonly SHEET_URL: string;
  readonly VAPID_PRIVATE_KEY: string;
  readonly VAPID_PUBLIC_KEY: string;
  /** `https://…` or `mailto:…`, sent to push services as the contact. */
  readonly VAPID_SUBJECT: string;
  /** IANA time zone of the flat. Defaults to Europe/Warsaw. */
  readonly TIMEZONE?: string;
  /**
   * Comma-separated origins allowed to call the API from a browser, for when
   * the web app is hosted elsewhere (for example on GitHub Pages).
   */
  readonly ALLOWED_ORIGINS?: string;
}

/** Everything non-deterministic, injected so that tests can replace it. */
export interface Deps {
  readonly fetch: typeof fetch;
  readonly now: () => number;
}

export const DEFAULT_TIMEZONE = 'Europe/Warsaw';

export function timeZoneOf(env: Env): string {
  return env.TIMEZONE || DEFAULT_TIMEZONE;
}
