/* global self, URL, fetch */
/*
 * Shows push notifications, and handles their buttons. A button answers with a one-time
 * token from the notification itself, so it works even when the app is signed out.
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data.json();
  } catch {
    // Browsers require something to be shown for every push.
    data = { title: 'Light Manager', body: 'Open the app to see what happened.', link: '/notifications' };
  }
  const actions = Array.isArray(data.actions) ? data.actions : [];
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { link: data.link || '/notifications', actions },
      actions: actions.map(({ action, title }) => ({ action, title })),
    }),
  );
});

async function openApp(link) {
  const url = new URL(link, self.location.origin).href;
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
  if (existing) {
    await existing.focus();
    if ('navigate' in existing) await existing.navigate(url);
    return;
  }
  await self.clients.openWindow(url);
}

async function answer(entry, link) {
  try {
    const response = await fetch('/api/v1/notification-actions', {
      method: 'POST',
      credentials: 'omit',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: entry.token }),
    });
    if (!response.ok) throw new Error('Answer not accepted');
    // Saying the lights did not change leads straight to what the app found out.
    if (entry.action === 'didnt_change') await openApp('/connections');
  } catch {
    // The answer can still be given from the app, which has the same buttons.
    await openApp(link);
  }
}

self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const { link, actions } = notification.data || {};
  notification.close();
  const entry = (actions || []).find((candidate) => candidate.action === event.action);
  event.waitUntil(entry ? answer(entry, '/notifications') : openApp(link || '/notifications'));
});
