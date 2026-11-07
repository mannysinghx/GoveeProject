import type { PushSubscribe } from '@glm/shared';

/** What this device can do about push notifications, so the page can explain the next step. */
export type PushSupport = 'supported' | 'unsupported' | 'needs_install' | 'denied';

export function isIos(): boolean {
  const { userAgent, platform, maxTouchPoints } = navigator;
  // iPads can report themselves as a Mac, but Macs have no touch screen.
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
}

function isInstalled(): boolean {
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
}

export function pushSupport(): PushSupport {
  // iPhones only offer push to apps added to the Home Screen, so check this before the rest.
  if (isIos() && !isInstalled()) return 'needs_install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return 'supported';
}

/** A readable name for the list of devices. It is only ever shown to the owner. */
export function deviceLabel(): string {
  const { userAgent } = navigator;
  if (/iPhone/.test(userAgent)) return 'iPhone';
  if (isIos()) return 'iPad';
  if (/Android/.test(userAgent)) return 'Android';
  if (/Macintosh/.test(userAgent)) return 'Mac';
  if (/Windows/.test(userAgent)) return 'Windows';
  return 'This device';
}

function keyToBytes(key: string): Uint8Array<ArrayBuffer> {
  const base64 = (key + '='.repeat((4 - (key.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
}

/** This device's subscription, if push is already on here. */
export async function currentEndpoint(): Promise<string | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  const existing = await navigator.serviceWorker.getRegistration();
  const subscription = await existing?.pushManager.getSubscription();
  return subscription?.endpoint ?? null;
}

/** Must run from a button press: browsers, and iPhones especially, refuse otherwise. */
export async function subscribeThisDevice(publicKey: string): Promise<PushSubscribe> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notifications were not allowed on this device. You can change that in its settings.');
  }
  const worker = await registration();
  const subscription = await worker.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyToBytes(publicKey),
  });
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error('This browser did not give a usable push address.');
  }
  return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth }, label: deviceLabel() };
}

export async function unsubscribeThisDevice(): Promise<string | null> {
  const existing = await navigator.serviceWorker.getRegistration();
  const subscription = await existing?.pushManager.getSubscription();
  if (!subscription) return null;
  const { endpoint } = subscription;
  await subscription.unsubscribe();
  return endpoint;
}
