/** @fileoverview Web Push on the device: capability, permission, keys. */

import type {PushSubscriptionData} from '../shared/types.ts';

/**
 * `needs-install`: an iPhone or iPad in a browser tab, where push only
 * works once the app is added to the home screen.
 */
export type PushSupport = 'supported' | 'needs-install' | 'unsupported';

function isIos(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

export function isStandalone(): boolean {
  const iosStandalone = (navigator as {standalone?: boolean}).standalone;
  return (
    iosStandalone === true || matchMedia('(display-mode: standalone)').matches
  );
}

export function pushSupport(): PushSupport {
  const hasApis =
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;
  if (hasApis) return 'supported';
  return isIos() && !isStandalone() ? 'needs-install' : 'unsupported';
}

export function notificationPermission(): NotificationPermission {
  return 'Notification' in window ? Notification.permission : 'denied';
}

function decodeBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toData(subscription: PushSubscription): PushSubscriptionData {
  const json = subscription.toJSON();
  return {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: json.keys?.['p256dh'] ?? '',
      auth: json.keys?.['auth'] ?? '',
    },
  };
}

/** The device's current subscription, if any. */
export async function currentSubscription(): Promise<PushSubscriptionData | null> {
  if (pushSupport() !== 'supported') return null;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return subscription ? toData(subscription) : null;
}

/** Subscribes this device, reusing an existing subscription. */
export async function subscribe(
  vapidPublicKey: string,
): Promise<PushSubscriptionData> {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeBase64Url(vapidPublicKey),
  });
  return toData(subscription);
}

/** Unsubscribes this device and returns the endpoint it had. */
export async function unsubscribe(): Promise<string | null> {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return null;
  await subscription.unsubscribe();
  return subscription.endpoint;
}
