import { generateVAPIDKeys, sendNotification } from 'web-push';

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface VapidDetails {
  subject: string;
  publicKey: string;
  privateKey: string;
}

export interface PushOptions {
  /** How long the push service may hold this if the phone is unreachable. */
  ttlSeconds: number;
  urgency: 'normal' | 'high';
}

export interface PushSender {
  send(target: PushTarget, payload: string, vapid: VapidDetails, options: PushOptions): Promise<void>;
}

export class PushDeliveryError extends Error {
  constructor(
    message: string,
    readonly statusCode: number | null,
  ) {
    super(message);
    this.name = 'PushDeliveryError';
  }
}

export function generatePushKeys(): { publicKey: string; privateKey: string } {
  return generateVAPIDKeys();
}

/** Web Push: the payload is encrypted so that only the subscribed browser can read it. */
export const webPushSender: PushSender = {
  async send(target, payload, vapid, options) {
    try {
      await sendNotification(target, payload, {
        vapidDetails: vapid,
        TTL: options.ttlSeconds,
        urgency: options.urgency,
        timeout: 10_000,
      });
    } catch (error) {
      const status = (error as { statusCode?: unknown }).statusCode;
      // Only a status and a generic message: an error here can quote the private endpoint.
      throw new PushDeliveryError(
        typeof status === 'number' ? `The push service answered ${status}.` : 'Could not reach the push service.',
        typeof status === 'number' ? status : null,
      );
    }
  },
};

const ALLOWED_HOSTS = ['fcm.googleapis.com'];
const ALLOWED_SUFFIXES = ['.push.apple.com', '.notify.windows.com', '.push.services.mozilla.com'];

/**
 * Only the push services browsers actually use. Without this, anyone signed in could make
 * the server send requests to an address of their choosing, including internal ones.
 */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_HOSTS.includes(host) || ALLOWED_SUFFIXES.some((suffix) => host.endsWith(suffix));
}
