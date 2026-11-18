/**
 * @fileoverview Persistence on the device. localStorage can throw (private
 * mode, blocked site data), so every access is guarded and the app must work
 * with nothing stored.
 */

export type StorageKey =
  | 'flatCode'
  | 'person'
  | 'lastState'
  | 'onboardingDone'
  | 'subscriptionEndpoint'
  | 'subscriptionPerson'
  | 'subscriptionSyncedAt';

export function readItem(key: StorageKey): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeItem(key: StorageKey, value: string | null): void {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // Nothing to do: the value simply will not survive a reload.
  }
}

/** What the service worker needs to act on a notification button. */
export interface WorkerConfig {
  readonly apiBaseUrl: string;
  readonly code: string;
  readonly person: string;
}

const CONFIG_CACHE = 'config';
const CONFIG_KEY = './__config';

/**
 * Shares the session with the service worker, which cannot read
 * localStorage. `null` removes it.
 */
export async function writeWorkerConfig(
  config: WorkerConfig | null,
): Promise<void> {
  try {
    const cache = await caches.open(CONFIG_CACHE);
    if (config) {
      await cache.put(CONFIG_KEY, new Response(JSON.stringify(config)));
    } else {
      await cache.delete(CONFIG_KEY);
    }
  } catch {
    // Without it the notification buttons fall back to opening the app.
  }
}
