import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/** Runs the real service worker file with a stand-in for the browser's worker environment. */
function loadWorker(fetchResult: { ok: boolean } = { ok: true }) {
  const listeners = new Map<string, (event: unknown) => void>();
  const showNotification = vi.fn(async () => {});
  const focus = vi.fn(async () => {});
  const navigate = vi.fn(async () => {});
  const openWindow = vi.fn(async () => {});
  const fetchMock = vi.fn(async () => fetchResult);
  const self = {
    location: { origin: 'https://lights.example' },
    registration: { showNotification },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(async () => {}), matchAll: vi.fn(async () => [] as unknown[]), openWindow },
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
  };
  const source = fs.readFileSync(path.resolve(__dirname, '../../../public/sw.js'), 'utf8');
  new Function('self', 'URL', 'fetch', source)(self, URL, fetchMock);

  const fire = async (type: string, event: Record<string, unknown>) => {
    let done: Promise<unknown> = Promise.resolve();
    listeners.get(type)?.({ ...event, waitUntil: (work: Promise<unknown>) => (done = work) });
    await done;
  };
  const click = (action: string, data: unknown) =>
    fire('notificationclick', { action, notification: { data, close: vi.fn() } });
  return { self, fire, click, showNotification, fetchMock, openWindow, focus, navigate };
}

const payload = {
  title: 'Diwali started',
  body: '🟧🟥\nGovee accepted it on 3 strings. Did the lights change?',
  link: '/notifications',
  tag: 'notification-1',
  actions: [
    { action: 'looks_right', title: 'Looks right', token: 'token-right' },
    { action: 'didnt_change', title: "Didn't change", token: 'token-no' },
  ],
};
const data = { link: payload.link, actions: payload.actions };

describe('the service worker', () => {
  it('shows the notification with its buttons, and keeps tokens out of what the system displays', async () => {
    const { fire, showNotification } = loadWorker();
    await fire('push', { data: { json: () => payload } });
    const [title, options] = showNotification.mock.calls[0] as unknown as [string, { body: string; actions: unknown[]; data: unknown }];
    expect(title).toBe('Diwali started');
    expect(options.body).toBe(payload.body);
    expect(options.actions).toEqual([
      { action: 'looks_right', title: 'Looks right' },
      { action: 'didnt_change', title: "Didn't change" },
    ]);
    expect(JSON.stringify(options.actions)).not.toContain('token');
  });

  it('still shows something if a push cannot be read, as browsers require', async () => {
    const { fire, showNotification } = loadWorker();
    await fire('push', {
      data: {
        json: () => {
          throw new Error('Not JSON');
        },
      },
    });
    expect(showNotification.mock.calls[0]).toContain('Light Manager');
  });

  it('answers a button with its one-time token, with no cookies, and without opening the app', async () => {
    const { click, fetchMock, openWindow } = loadWorker();
    await click('looks_right', data);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/notification-actions');
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit' });
    expect(JSON.parse(String(init.body))).toEqual({ token: 'token-right' });
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('takes you to Connections after saying the lights did not change', async () => {
    const { click, openWindow } = loadWorker();
    await click('didnt_change', data);
    expect(openWindow).toHaveBeenCalledWith('https://lights.example/connections');
  });

  it('opens the app if the answer fails, where the same buttons are', async () => {
    const { click, openWindow } = loadWorker({ ok: false });
    await click('looks_right', data);
    expect(openWindow).toHaveBeenCalledWith('https://lights.example/notifications');
  });

  it('opens the linked page on a tap, sending nothing', async () => {
    const { click, fetchMock, openWindow } = loadWorker();
    await click('', { link: '/connections', actions: payload.actions });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(openWindow).toHaveBeenCalledWith('https://lights.example/connections');
  });
});
