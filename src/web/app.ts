/**
 * @fileoverview The app's state and everything that changes it. Views read
 * the model and call these functions; they never talk to the network.
 */

import type {
  AppState,
  PrefsResponse,
  ReminderRule,
  TaskStatus,
  TaskStatusEntry,
} from '../shared/types.ts';
import * as api from './api.ts';
import type {PushSupport} from './push.ts';
import * as push from './push.ts';
import {readItem, writeItem, writeWorkerConfig} from './storage.ts';

export interface PushInfo {
  readonly support: PushSupport;
  readonly permission: NotificationPermission;
  /** True when this device has a subscription registered on the server. */
  readonly subscribed: boolean;
}

export interface Model {
  readonly code: string | null;
  readonly person: string | null;
  readonly state: AppState | null;
  readonly offline: boolean;
  readonly loading: boolean;
  readonly codeError: string | null;
  readonly onboardingDone: boolean;
  readonly push: PushInfo;
  readonly prefs: PrefsResponse | null;
  readonly toast: string | null;
  /** Names of operations in flight, for spinners and disabled buttons. */
  readonly busy: ReadonlySet<string>;
  readonly canInstall: boolean;
}

/** Chrome's install prompt event; not in the standard typings. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

const STATE_MAX_AGE_MS = 5 * 60 * 1000;
const SUBSCRIPTION_SYNC_MS = 24 * 60 * 60 * 1000;
const TOAST_MS = 4000;

let model: Model = {
  code: readItem('flatCode'),
  person: readItem('person'),
  state: null,
  offline: false,
  loading: false,
  codeError: null,
  onboardingDone: readItem('onboardingDone') === '1',
  push: {
    support: push.pushSupport(),
    permission: push.notificationPermission(),
    subscribed: readItem('subscriptionEndpoint') !== null,
  },
  prefs: null,
  toast: null,
  busy: new Set(),
  canInstall: false,
};

const listeners = new Set<() => void>();
let installPrompt: InstallPromptEvent | null = null;
let stateLoadedAt = 0;
let toastTimer = 0;

export function getModel(): Model {
  return model;
}

/** Registers a function to call after every change of the model. */
export function onChange(listener: () => void): void {
  listeners.add(listener);
}

function update(patch: Partial<Model>): void {
  model = {...model, ...patch};
  for (const listener of listeners) listener();
}

export function showToast(message: string): void {
  window.clearTimeout(toastTimer);
  update({toast: message});
  toastTimer = window.setTimeout(() => update({toast: null}), TOAST_MS);
}

function setBusy(key: string, busy: boolean): void {
  const next = new Set(model.busy);
  if (busy) {
    next.add(key);
  } else {
    next.delete(key);
  }
  update({busy: next});
}

function forgetCode(message: string): void {
  writeItem('flatCode', null);
  void writeWorkerConfig(null);
  update({code: null, state: null, codeError: message});
}

function reportError(error: unknown): void {
  if (error instanceof api.ApiRequestError) {
    if (error.status === 401) {
      forgetCode('Kod mieszkania jest nieaktualny. Wpisz nowy.');
      return;
    }
    showToast(error.message);
  } else if (error instanceof TypeError) {
    update({offline: true});
    showToast('Brak połączenia z internetem.');
  } else {
    console.error(error);
    showToast('Coś poszło nie tak. Spróbuj ponownie.');
  }
}

/** Runs an operation with a busy flag; errors become toasts. */
async function withBusy(key: string, work: () => Promise<void>): Promise<void> {
  if (model.busy.has(key)) return;
  setBusy(key, true);
  try {
    await work();
  } catch (e: unknown) {
    reportError(e);
  } finally {
    setBusy(key, false);
  }
}

function knownPerson(): string | null {
  const {person, state} = model;
  return person && state?.schedule.people.includes(person) ? person : null;
}

function shareSessionWithWorker(): void {
  const person = knownPerson();
  if (!model.code || !person) return;
  void writeWorkerConfig({
    apiBaseUrl: api.API_BASE_URL,
    code: model.code,
    person,
  });
}

function acceptState(state: AppState): void {
  stateLoadedAt = Date.now();
  writeItem('lastState', JSON.stringify(state));
  update({state, offline: false, codeError: null});
  shareSessionWithWorker();
}

/**
 * Keeps the server's copy of this device's subscription fresh. Browsers
 * drop subscriptions silently, so this runs on every start.
 */
async function syncSubscription(force = false): Promise<void> {
  const person = knownPerson();
  const {code, state} = model;
  if (!code || !state || !person) return;
  if (model.push.support !== 'supported') return;
  if (push.notificationPermission() !== 'granted') {
    update({push: {...model.push, subscribed: false}});
    return;
  }
  // No subscription although we had one: it expired, so subscribe again.
  const hadOne = readItem('subscriptionEndpoint') !== null;
  let subscription = await push.currentSubscription();
  if (!subscription && (hadOne || force)) {
    subscription = await push.subscribe(state.vapidPublicKey);
  }
  if (!subscription) {
    update({push: {...model.push, subscribed: false}});
    return;
  }
  const syncedAt = Number(readItem('subscriptionSyncedAt'));
  const upToDate =
    readItem('subscriptionEndpoint') === subscription.endpoint &&
    readItem('subscriptionPerson') === person &&
    Date.now() - syncedAt < SUBSCRIPTION_SYNC_MS;
  if (force || !upToDate) {
    await api.saveSubscription(code, person, subscription);
    writeItem('subscriptionEndpoint', subscription.endpoint);
    writeItem('subscriptionPerson', person);
    writeItem('subscriptionSyncedAt', String(Date.now()));
  }
  update({
    push: {
      support: 'supported',
      permission: push.notificationPermission(),
      subscribed: true,
    },
  });
}

/** Loads the state from the server; keeps showing the cached one offline. */
export async function loadState(): Promise<void> {
  const {code} = model;
  if (!code || model.loading) return;
  update({loading: true});
  try {
    acceptState(await api.fetchState(code));
    await syncSubscription();
  } catch (e: unknown) {
    if (e instanceof TypeError) {
      update({offline: true});
    } else {
      reportError(e);
    }
  } finally {
    update({loading: false});
  }
}

/** Extracts the code from a pasted invite link, or returns the text. */
function parseCode(input: string): string {
  const text = input.trim();
  try {
    return new URL(text).searchParams.get('code') ?? text;
  } catch {
    return text;
  }
}

export async function submitCode(input: string): Promise<void> {
  const code = parseCode(input).toLowerCase();
  if (!code) {
    update({codeError: 'Wpisz kod mieszkania.'});
    return;
  }
  await withBusy('code', async () => {
    try {
      const state = await api.fetchState(code);
      writeItem('flatCode', code);
      update({code});
      acceptState(state);
    } catch (e: unknown) {
      if (e instanceof api.ApiRequestError && e.status === 401) {
        update({codeError: 'Nieprawidłowy kod. Sprawdź i spróbuj ponownie.'});
        return;
      }
      throw e;
    }
  });
}

export function choosePerson(person: string): void {
  writeItem('person', person);
  update({person, prefs: null});
  shareSessionWithWorker();
  void syncSubscription(true).catch(reportError);
}

/** Lets the user pick a different name. */
export function changePerson(): void {
  writeItem('person', null);
  update({person: null, prefs: null});
}

export function finishOnboarding(): void {
  writeItem('onboardingDone', '1');
  update({onboardingDone: true});
}

/** Forgets the flat code on this device. */
export async function signOut(): Promise<void> {
  await disableNotifications();
  for (const key of ['person', 'lastState', 'onboardingDone'] as const) {
    writeItem(key, null);
  }
  forgetCode('');
  update({person: null, onboardingDone: false, codeError: null});
}

function withStatus(
  statuses: readonly TaskStatusEntry[],
  weekStart: string,
  taskKey: string,
  status: TaskStatus,
  updatedBy: string,
): TaskStatusEntry[] {
  const others = statuses.filter(
    entry => entry.weekStart !== weekStart || entry.taskKey !== taskKey,
  );
  if (status === 'pending') return others;
  return [
    ...others,
    {weekStart, taskKey, status, updatedBy, updatedAt: Date.now()},
  ];
}

/** Changes a task's status. The view updates at once and reverts on error. */
export async function setTaskStatus(
  weekStart: string,
  taskKey: string,
  status: TaskStatus,
): Promise<void> {
  const {code, state} = model;
  const updatedBy = knownPerson();
  if (!code || !state || !updatedBy) return;
  const before = state.statuses;
  await withBusy(`status:${taskKey}`, async () => {
    const optimistic = withStatus(
      before,
      weekStart,
      taskKey,
      status,
      updatedBy,
    );
    update({state: {...state, statuses: optimistic}});
    try {
      const {statuses} = await api.saveTaskStatus(code, {
        weekStart,
        taskKey,
        status,
        updatedBy,
      });
      if (model.state) acceptState({...model.state, statuses});
    } catch (e: unknown) {
      if (model.state) update({state: {...model.state, statuses: before}});
      throw e;
    }
  });
}

export async function refreshSheet(): Promise<void> {
  const {code} = model;
  if (!code) return;
  await withBusy('refresh', async () => {
    const state = await api.refreshSheet(code);
    acceptState(state);
    showToast(
      state.sheet.error
        ? 'Nie udało się odczytać arkusza.'
        : 'Grafik jest aktualny.',
    );
  });
}

/** Asks for permission, subscribes and sends a test notification. */
export async function enableNotifications(): Promise<void> {
  await withBusy('notifications', async () => {
    const permission = await Notification.requestPermission();
    update({push: {...model.push, permission}});
    if (permission !== 'granted') {
      showToast('Powiadomienia są zablokowane w ustawieniach przeglądarki.');
      return;
    }
    await syncSubscription(true);
    await sendTest();
  });
}

async function sendTest(): Promise<void> {
  const endpoint = readItem('subscriptionEndpoint');
  if (!model.code || !endpoint) return;
  const result = await api.sendTestPush(model.code, endpoint);
  if (result.ok) {
    showToast('Wysłano testowe powiadomienie.');
  } else if (result.gone) {
    writeItem('subscriptionEndpoint', null);
    await syncSubscription(true);
    showToast('Odnowiono subskrypcję. Spróbuj jeszcze raz.');
  } else {
    showToast('Nie udało się wysłać powiadomienia.');
  }
}

export async function sendTestNotification(): Promise<void> {
  await withBusy('test', sendTest);
}

export async function disableNotifications(): Promise<void> {
  await withBusy('notifications', async () => {
    const endpoint =
      (await push.unsubscribe().catch(() => null)) ??
      readItem('subscriptionEndpoint');
    writeItem('subscriptionEndpoint', null);
    update({push: {...model.push, subscribed: false}});
    if (model.code && endpoint) {
      await api.removeSubscription(model.code, endpoint);
    }
  });
}

export async function loadPrefs(): Promise<void> {
  const person = knownPerson();
  const {code} = model;
  if (!code || !person) return;
  await withBusy('prefs', async () => {
    update({prefs: await api.fetchPrefs(code, person)});
  });
}

/** Saves reminder rules; `null` restores the defaults. */
export async function savePrefs(
  rules: readonly ReminderRule[] | null,
): Promise<void> {
  const person = knownPerson();
  const {code, prefs} = model;
  if (!code || !person) return;
  if (prefs && rules) update({prefs: {...prefs, rules, isDefault: false}});
  await withBusy('prefs-save', async () => {
    try {
      update({prefs: await api.savePrefs(code, person, rules)});
    } catch (e: unknown) {
      update({prefs});
      throw e;
    }
  });
}

export async function installApp(): Promise<void> {
  await installPrompt?.prompt();
  installPrompt = null;
  update({canInstall: false});
}

/** Reads the invite link and the cached state, then loads fresh data. */
export async function start(): Promise<void> {
  const url = new URL(location.href);
  const invited = url.searchParams.get('code');
  if (invited) {
    url.searchParams.delete('code');
    history.replaceState(null, '', url);
  }
  const cached = readItem('lastState');
  if (cached) {
    try {
      update({state: JSON.parse(cached) as AppState});
    } catch {
      writeItem('lastState', null);
    }
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event as InstallPromptEvent;
    update({canInstall: true});
  });
  window.addEventListener('online', () => void loadState());
  window.addEventListener('offline', () => update({offline: true}));
  document.addEventListener('visibilitychange', () => {
    const stale = Date.now() - stateLoadedAt > STATE_MAX_AGE_MS;
    if (document.visibilityState === 'visible' && stale) void loadState();
  });

  if (invited && invited.toLowerCase() !== model.code) {
    await submitCode(invited);
  } else {
    await loadState();
  }
}
