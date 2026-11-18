/**
 * @fileoverview Service worker: keeps the app shell available offline and
 * turns push messages into notifications. It never polls and never runs
 * unless the browser hands it an event.
 */

/** Written to Cache Storage by the page; the worker has no localStorage. */
interface WorkerConfig {
  readonly apiBaseUrl: string;
  readonly code: string;
  readonly person: string;
}

interface PushPayload {
  readonly title?: string;
  readonly body?: string;
  readonly tag?: string;
  readonly url?: string;
  readonly data?: {readonly weekStart: string; readonly taskKey: string};
}

/** `actions` and `renotify` are missing from the standard typings. */
interface RichNotificationOptions extends NotificationOptions {
  actions?: Array<{action: string; title: string}>;
  renotify?: boolean;
}

const worker = self as unknown as ServiceWorkerGlobalScope;

// Both placeholders are replaced by scripts/build.ts.
const BUILD_ID = '__BUILD_ID__';
const SHELL_FILES: readonly string[] = JSON.parse('__SHELL_FILES__');

const SHELL_CACHE = `shell-${BUILD_ID}`;
const CONFIG_CACHE = 'config';
const CONFIG_KEY = './__config';
const STATUS_BY_ACTION: Readonly<Record<string, string>> = {
  acknowledge: 'acknowledged',
  done: 'done',
};

worker.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_FILES))
      .then(() => worker.skipWaiting()),
  );
});

worker.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name !== SHELL_CACHE && name !== CONFIG_CACHE) {
          await caches.delete(name);
        }
      }
      await worker.clients.claim();
    })(),
  );
});

worker.addEventListener('fetch', event => {
  const {request} = event;
  const url = new URL(request.url);
  const isShell =
    request.method === 'GET' &&
    url.origin === worker.location.origin &&
    !url.pathname.includes('/api/');
  if (!isShell) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(request, {ignoreSearch: true});
      return cached ?? fetch(request);
    })(),
  );
});

worker.addEventListener('push', event => {
  let payload: PushPayload = {};
  try {
    payload = (event.data?.json() ?? {}) as PushPayload;
  } catch {
    // Fall through to the generic notification: a push must always show one.
  }
  const options: RichNotificationOptions = {
    body: payload.body ?? 'Sprawdź grafik.',
    tag: payload.tag,
    renotify: Boolean(payload.tag),
    icon: './icons/icon-192.png',
    badge: './icons/badge-96.png',
    data: payload,
    actions: payload.data
      ? [
          {action: 'acknowledge', title: 'Pamiętam'},
          {action: 'done', title: 'Zrobione'},
        ]
      : [],
  };
  event.waitUntil(
    worker.registration.showNotification(
      payload.title ?? 'Sprzątanie',
      options,
    ),
  );
});

async function readConfig(): Promise<WorkerConfig | null> {
  const cache = await caches.open(CONFIG_CACHE);
  const response = await cache.match(CONFIG_KEY);
  return response ? ((await response.json()) as WorkerConfig) : null;
}

/** Sets the task status straight from the notification. */
async function updateStatus(
  payload: PushPayload,
  status: string,
): Promise<boolean> {
  const config = await readConfig();
  if (!config || !payload.data) return false;
  const response = await fetch(`${config.apiBaseUrl}/api/task-status`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${config.code}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      weekStart: payload.data.weekStart,
      taskKey: payload.data.taskKey,
      status,
      updatedBy: config.person,
    }),
  });
  return response.ok;
}

async function openApp(path: string): Promise<void> {
  const target = new URL(path, worker.registration.scope).href;
  const windows = await worker.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });
  for (const client of windows) {
    if (client.url.startsWith(worker.registration.scope)) {
      await client.focus();
      return;
    }
  }
  await worker.clients.openWindow(target);
}

worker.addEventListener('notificationclick', event => {
  const payload = (event.notification.data ?? {}) as PushPayload;
  const status = STATUS_BY_ACTION[event.action];
  event.notification.close();
  event.waitUntil(
    (async () => {
      if (status) {
        const updated = await updateStatus(payload, status).catch(() => false);
        if (updated) return;
      }
      await openApp(payload.url ?? './');
    })(),
  );
});
