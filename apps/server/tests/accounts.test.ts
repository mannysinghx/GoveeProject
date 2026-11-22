import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountRegistry } from '../src/app/accounts.js';
import type { AccountContext } from '../src/app/context.js';
import { authedClient, createHarness, type Harness } from './support/harness.js';

/**
 * Every route under /api/v1. A route added later fails this test until it is listed here as
 * public or signed-in, so nobody adds a public route, or a route that skips the account
 * lookup, without deciding to. Written from the route files, not from the app's output.
 */
const ROUTES: [method: string, url: string, kind: 'public' | 'signed-in'][] = [
  // Sign-in, on the platform
  ['GET', '/api/v1/auth/session', 'public'],
  ['POST', '/api/v1/auth/setup', 'public'],
  ['POST', '/api/v1/auth/login', 'public'],
  ['POST', '/api/v1/auth/logout', 'signed-in'],
  ['POST', '/api/v1/auth/change-password', 'signed-in'],
  // System
  ['GET', '/api/v1/health', 'public'],
  ['GET', '/api/v1/system/status', 'signed-in'],
  ['GET', '/api/v1/dashboard/summary', 'signed-in'],
  ['GET', '/api/v1/settings', 'signed-in'],
  ['PATCH', '/api/v1/settings', 'signed-in'],
  // Lights
  ['GET', '/api/v1/devices', 'signed-in'],
  ['POST', '/api/v1/devices/discover', 'signed-in'],
  ['POST', '/api/v1/devices/refresh-due', 'signed-in'],
  ['POST', '/api/v1/devices/refresh-all', 'signed-in'],
  ['POST', '/api/v1/lights/brightness', 'signed-in'],
  ['GET', '/api/v1/devices/:id', 'signed-in'],
  ['POST', '/api/v1/devices/:id/refresh', 'signed-in'],
  ['GET', '/api/v1/devices/:id/commands', 'signed-in'],
  ['POST', '/api/v1/devices/:id/power', 'signed-in'],
  ['POST', '/api/v1/devices/:id/brightness', 'signed-in'],
  ['POST', '/api/v1/devices/:id/color', 'signed-in'],
  ['POST', '/api/v1/devices/:id/color-temperature', 'signed-in'],
  ['POST', '/api/v1/devices/:id/segments', 'signed-in'],
  ['GET', '/api/v1/devices/:id/scenes', 'signed-in'],
  ['POST', '/api/v1/devices/:id/scenes/refresh', 'signed-in'],
  ['POST', '/api/v1/devices/:id/scenes/:sceneId/apply', 'signed-in'],
  ['GET', '/api/v1/commands/:id', 'signed-in'],
  // Groups
  ['GET', '/api/v1/groups', 'signed-in'],
  ['POST', '/api/v1/groups', 'signed-in'],
  ['GET', '/api/v1/groups/:id', 'signed-in'],
  ['PATCH', '/api/v1/groups/:id', 'signed-in'],
  ['DELETE', '/api/v1/groups/:id', 'signed-in'],
  ['POST', '/api/v1/groups/:id/apply', 'signed-in'],
  // Presets and the daily scheme
  ['GET', '/api/v1/daily-scheme', 'signed-in'],
  ['PATCH', '/api/v1/daily-scheme', 'signed-in'],
  ['GET', '/api/v1/presets', 'signed-in'],
  ['POST', '/api/v1/presets', 'signed-in'],
  ['POST', '/api/v1/presets/apply-draft', 'signed-in'],
  ['GET', '/api/v1/presets/:id', 'signed-in'],
  ['PATCH', '/api/v1/presets/:id', 'signed-in'],
  ['DELETE', '/api/v1/presets/:id', 'signed-in'],
  ['POST', '/api/v1/presets/:id/duplicate', 'signed-in'],
  ['POST', '/api/v1/presets/:id/apply', 'signed-in'],
  // Schedules and holidays
  ['GET', '/api/v1/schedules', 'signed-in'],
  ['GET', '/api/v1/holidays', 'signed-in'],
  ['PATCH', '/api/v1/holidays/:key', 'signed-in'],
  ['POST', '/api/v1/holidays/:key/enabled', 'signed-in'],
  ['POST', '/api/v1/holidays/:key/skip', 'signed-in'],
  ['POST', '/api/v1/schedules', 'signed-in'],
  ['POST', '/api/v1/schedules/preview', 'signed-in'],
  ['GET', '/api/v1/schedules/:id', 'signed-in'],
  ['PATCH', '/api/v1/schedules/:id', 'signed-in'],
  ['DELETE', '/api/v1/schedules/:id', 'signed-in'],
  ['POST', '/api/v1/schedules/:id/enable', 'signed-in'],
  ['POST', '/api/v1/schedules/:id/disable', 'signed-in'],
  ['GET', '/api/v1/schedules/:id/executions', 'signed-in'],
  // Activity and connections
  ['GET', '/api/v1/activity', 'signed-in'],
  ['GET', '/api/v1/connection/report', 'signed-in'],
  ['POST', '/api/v1/connection/check', 'signed-in'],
  ['POST', '/api/v1/connection/missed/:id/send', 'signed-in'],
  ['POST', '/api/v1/connection/missed/:id/dismiss', 'signed-in'],
  // AI
  ['GET', '/api/v1/ai/status', 'signed-in'],
  ['POST', '/api/v1/ai/ask', 'signed-in'],
  ['POST', '/api/v1/ai/draft-pattern', 'signed-in'],
  ['POST', '/api/v1/ai/draft-schedule', 'signed-in'],
  ['GET', '/api/v1/ai/questions', 'signed-in'],
  // Notifications
  ['GET', '/api/v1/notifications', 'signed-in'],
  ['POST', '/api/v1/notifications/read-all', 'signed-in'],
  ['POST', '/api/v1/notifications/test', 'signed-in'],
  ['GET', '/api/v1/notifications/push', 'signed-in'],
  ['POST', '/api/v1/notifications/push/subscribe', 'signed-in'],
  ['POST', '/api/v1/notifications/push/unsubscribe', 'signed-in'],
  ['DELETE', '/api/v1/notifications/push/:id', 'signed-in'],
  ['POST', '/api/v1/notifications/:id/respond', 'signed-in'],
  ['POST', '/api/v1/notification-actions', 'public'],
];

describe('route census', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness();
  });
  afterEach(() => h.close());

  it('lists every API route, and exactly which ones are public', () => {
    const actual = h.app.routeTable
      .filter((r) => r.url.startsWith('/api/v1'))
      .map((r) => `${r.method} ${r.url} ${r.public ? 'public' : 'signed-in'}`)
      .sort();
    const expected = ROUTES.map(([method, url, kind]) => `${method} ${url} ${kind}`).sort();
    expect(actual).toEqual(expected);
    expect(ROUTES).toHaveLength(75);
    expect(ROUTES.filter(([, , kind]) => kind === 'public')).toHaveLength(5);
  });
});

describe('one account per request', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness();
  });
  afterEach(() => h.close());

  it('serves a signed-in request from that user\'s account', async () => {
    const client = await authedClient(h.app);
    expect(h.platform.accounts.forUser(1)).not.toBeNull();
    expect((await client.post('/api/v1/groups', { name: 'Front', deviceIds: [] })).statusCode).toBe(201);
    expect(h.platform.accounts.forUser(1)!.groups.list().map((g) => g.name)).toEqual(['Front']);
  });

  it('refuses a valid session whose account is not loaded, rather than answering from another account', async () => {
    const client = await authedClient(h.app);
    await client.post('/api/v1/groups', { name: 'Front', deviceIds: [] });
    // As if this user's account file had not loaded yet.
    h.platform.accounts.forUser = () => null;
    for (const url of ['/api/v1/groups', '/api/v1/devices', '/api/v1/settings', '/api/v1/activity']) {
      const response = await client.get(url);
      expect(response.statusCode).toBe(503);
      expect(response.json().error.code).toBe('account_unavailable');
      expect(response.body).not.toContain('Front');
    }
  });

  it('hides a secret added after startup, in the log and in activity', async () => {
    const late = 'late-secret-7f3a9c1e-not-real';
    h.platform.secrets.add(late);
    h.ctx.logger.warn({ detail: `Govee said ${late}` }, `Something mentioned ${late}`);
    h.ctx.activity.record({ eventType: 'system', outcome: 'info', message: `A message with ${late} inside` });
    expect(h.logs()).not.toContain(late);
    expect(h.logs()).toContain('[REDACTED]');
    const listed = JSON.stringify(h.ctx.activity.list({ limit: 20 }));
    expect(listed).not.toContain(late);
    expect(listed).toContain('A message with [REDACTED] inside');
  });
});

describe('AccountRegistry', () => {
  /** Just enough of an account to record what is started and stopped, and in what order. */
  function fakeAccount(userId: number, log: string[], stopDelayMs = 0): AccountContext {
    const step = (name: string, delay = 0) => async () => {
      log.push(`${userId}:${name}:start`);
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      log.push(`${userId}:${name}:end`);
    };
    const sync = (name: string) => () => void log.push(`${userId}:${name}`);
    return {
      userId,
      queue: { recoverInterrupted: sync('recover'), stop: step('queue', stopDelayMs) },
      scheduler: { start: sync('scheduler.start'), stop: step('scheduler') },
      maintenance: { start: sync('maintenance.start'), stop: sync('maintenance.stop') },
      connection: { start: sync('connection.start'), stop: step('connection', stopDelayMs) },
      builtins: { start: sync('builtins.start'), stop: step('builtins') },
      notifications: { start: sync('notifications.start'), stop: step('notifications') },
      devices: { stop: sync('devices.stop') },
      db: { close: sync('db.close') },
    } as unknown as AccountContext;
  }

  it('finds accounts by user, refuses duplicates, and will not guess when there is more than one', () => {
    const registry = new AccountRegistry();
    const log: string[] = [];
    const first = fakeAccount(1, log);
    registry.add(first);
    expect(registry.sole()).toBe(first);
    expect(() => registry.add(fakeAccount(1, log))).toThrow(/already loaded/);
    const second = fakeAccount(2, log);
    registry.add(second);
    expect(registry.forUser(2)).toBe(second);
    expect(registry.forUser(3)).toBeNull();
    expect(() => registry.sole()).toThrow(/exactly one/);
  });

  it('starts each account in the original order', () => {
    const registry = new AccountRegistry();
    const log: string[] = [];
    registry.add(fakeAccount(1, log));
    registry.startAll();
    expect(log).toEqual(['1:scheduler.start', '1:maintenance.start', '1:connection.start', '1:builtins.start', '1:notifications.start']);
  });

  it('stops accounts side by side, each in the original order', async () => {
    const registry = new AccountRegistry();
    const log: string[] = [];
    registry.add(fakeAccount(1, log, 30));
    registry.add(fakeAccount(2, log, 30));

    await registry.stopBackground();
    for (const id of [1, 2]) {
      expect(log.filter((l) => l.startsWith(`${id}:`))).toEqual([
        `${id}:maintenance.stop`,
        `${id}:connection:start`,
        `${id}:connection:end`,
        `${id}:builtins:start`,
        `${id}:builtins:end`,
        `${id}:notifications:start`,
        `${id}:notifications:end`,
        `${id}:devices.stop`,
      ]);
    }
    // Side by side: the second account started stopping before the first one finished.
    expect(log.indexOf('2:connection:start')).toBeLessThan(log.indexOf('1:connection:end'));

    log.length = 0;
    await registry.stopCore();
    for (const id of [1, 2]) {
      expect(log.filter((l) => l.startsWith(`${id}:`))).toEqual([
        `${id}:queue:start`,
        `${id}:queue:end`,
        `${id}:scheduler:start`,
        `${id}:scheduler:end`,
        `${id}:db.close`,
      ]);
    }
    expect(log.indexOf('2:queue:start')).toBeLessThan(log.indexOf('1:queue:end'));
  });
});
