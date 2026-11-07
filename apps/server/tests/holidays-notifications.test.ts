import crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { generateRequestDetails } from 'web-push';
import { HOLIDAYS, type DiscoveryResultDto, type HolidayDto, type NotificationDto, type NotificationListDto, type PresetDto } from '@glm/shared';
import { generatePushKeys, isAllowedPushEndpoint, PushDeliveryError, type PushSender } from '../src/notifications/push-sender.js';
import { nextOccurrence, previewSchedule } from '../src/scheduler/occurrences.js';
import { authedClient, createHarness, type Harness } from './support/harness.js';
import { mockFullDevice, TEST_API_KEY } from './support/mock-govee.js';

const harnesses: Harness[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.close();
});

const string27 = (name: string, suffix: string) => {
  const device = JSON.parse(JSON.stringify(mockFullDevice()).replaceAll('"max":14', '"max":26').replaceAll('"max":15', '"max":27')) as ReturnType<typeof mockFullDevice>;
  return { ...device, deviceName: name, device: `AA:BB:CC:DD:EE:FF:00:${suffix}` };
};
const LEFT = string27('Outdoor Left', '11');
const CENTER = string27('Outdoor Center', '12');
const RIGHT = string27('Outdoor Right', '13');
const SCENES = ['Fireworks', 'New Years', 'Thanksgiving', 'Christmas Eve', 'Winter Wonderland', 'Fall'].map((name, i) => ({
  name,
  value: { paramId: 5000 + i, id: 6000 + i },
}));
const LA = 'America/Los_Angeles';
const VALID_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc123';
const KEYS = { p256dh: 'BPublicKeyValue_-', auth: 'authValue-_' };

interface PushPayload {
  title: string;
  body: string;
  actions: { action: string; token: string }[];
}

class RecordingSender implements PushSender {
  sent: { endpoint: string; payload: PushPayload; subject: string; ttl: number; urgency: string; privateKey: string }[] = [];
  failWith: Error | null = null;
  async send(target: { endpoint: string }, payload: string, vapid: { subject: string; privateKey: string }, options: { ttlSeconds: number; urgency: string }) {
    if (this.failWith) throw this.failWith;
    this.sent.push({
      endpoint: target.endpoint,
      payload: JSON.parse(payload) as PushPayload,
      subject: vapid.subject,
      ttl: options.ttlSeconds,
      urgency: options.urgency,
      privateKey: vapid.privateKey,
    });
  }
}

async function house() {
  const sender = new RecordingSender();
  const h = await createHarness({ overrides: { pushSender: sender } });
  harnesses.push(h);
  h.mock.devices = [RIGHT, CENTER, LEFT];
  h.mock.dynamicScenes = SCENES;
  const client = await authedClient(h.app);
  await client.patch('/api/v1/settings', { defaultTimeZone: LA });
  const { devices } = (await client.post('/api/v1/devices/discover')).json() as DiscoveryResultDto;
  await h.ctx.builtins.sync();
  return { h, client, sender, center: devices.find((d) => d.name === 'Outdoor Center')?.id as string };
}

async function runAt(h: Harness, iso: string) {
  h.clock.advance(Date.parse(iso) - h.clock.nowMs());
  await h.ctx.scheduler.tick();
  await h.ctx.scheduler.idle();
  await h.ctx.notifications.idle();
}

const holidays = (h: Harness): HolidayDto[] => h.ctx.holidays.list();
const holiday = (h: Harness, key: string) => holidays(h).find((x) => x.key === key) as HolidayDto;
const notifications = (h: Harness): NotificationDto[] => h.ctx.notifications.list(200).items;
const presetName = (h: Harness, key: string) => (h.ctx.presets.list().find((p: PresetDto) => p.builtin?.key === key) as PresetDto).name;
const scheduleNames = (h: Harness, key: string) => h.ctx.schedules.list().filter((s) => s.builtinShow === key).map((s) => s.name);
const NOV_8_5PM = '2026-11-09T01:00:00.000Z'; // 5 PM in Los Angeles, once daylight saving has ended.

/** Moves past everything before Diwali, so only Diwali's own commands count from here. */
async function justBeforeDiwali(h: Harness) {
  await runAt(h, '2026-11-09T00:59:00.000Z');
  h.mock.requests.length = 0;
}

describe('the holiday calendar', () => {
  it('sets up every holiday, on all strings, with one summary in the activity log', async () => {
    const { h } = await house();
    expect(holidays(h).map((x) => x.key).sort()).toEqual(HOLIDAYS.map((x) => x.key).sort());
    expect(h.ctx.activity.list({ eventType: 'schedule', limit: 100 }).events.filter((e) => e.message.startsWith('Created schedule "Diwali'))).toEqual([]);
    expect(h.ctx.activity.list({ eventType: 'schedule', limit: 100 }).events.some((e) => e.message.includes('holiday show'))).toBe(true);
    const group = h.ctx.groups.list().find((g) => g.name === 'All light strings');
    expect(group?.deviceIds).toHaveLength(3);
  });

  it('lists the soonest first, with the right date, window and colors', async () => {
    const { h } = await house();
    h.clock.advance(Date.parse('2026-11-07T05:00:00.000Z') - h.clock.nowMs());
    const list = holidays(h);
    expect(list[0]).toMatchObject({ key: 'diwali', nextDate: '2026-11-08', startTime: '17:00', endTime: '20:00', enabled: true, skipped: false });
    expect(list[0]?.colors).toEqual(expect.arrayContaining(['#ffaa00', '#e6007e']));
    expect(list[1]).toMatchObject({ key: 'veterans-day', nextDate: '2026-11-11', startTime: '17:00', endTime: '23:00' });
  });

  it('puts the existing fireworks schedules in the calendar, with the end quiet', async () => {
    const { h } = await house();
    const steps = h.ctx.schedules.list().filter((s) => s.builtinShow === 'new-year-fireworks');
    expect(steps.map((s) => [s.name, s.quiet]).sort()).toEqual([
      ['New Year Fireworks', false],
      ['New Year Fireworks: end', true],
    ]);
    expect(holiday(h, 'new-year-fireworks')).toMatchObject({ startTime: '00:00', endTime: '00:30' });
  });

  it('does not recreate a show the owner deleted, or duplicate one when run again', async () => {
    const { h, client } = await house();
    const before = h.ctx.schedules.list().length;
    await h.ctx.builtins.sync();
    expect(h.ctx.schedules.list()).toHaveLength(before);
    const halloween = h.ctx.schedules.list().filter((s) => s.builtinShow === 'halloween');
    for (const schedule of halloween) await client.delete(`/api/v1/schedules/${schedule.id}`);
    await h.ctx.builtins.sync();
    expect(holidays(h).some((x) => x.key === 'halloween')).toBe(false);
  });

  it('turns a whole show on or off together', async () => {
    const { h, client } = await house();
    const off = (await client.post('/api/v1/holidays/diwali/enabled', { enabled: false })).json() as { holidays: HolidayDto[] };
    expect(off.holidays.find((x) => x.key === 'diwali')?.enabled).toBe(false);
    expect(h.ctx.schedules.list().filter((s) => s.builtinShow === 'diwali').every((s) => !s.enabled)).toBe(true);
    await client.post('/api/v1/holidays/diwali/enabled', { enabled: true });
    expect(h.ctx.schedules.list().filter((s) => s.builtinShow === 'diwali').every((s) => s.enabled)).toBe(true);
  });

  it('refuses an unknown holiday', async () => {
    const { client } = await house();
    expect((await client.post('/api/v1/holidays/nope/enabled', { enabled: false })).statusCode).toBe(404);
  });

  it('finds next year when this year has passed, and nothing after the Diwali table ends', () => {
    const diwali = { kind: 'holiday', holiday: 'diwali', time: '17:00' } as const;
    expect(nextOccurrence(diwali, LA, Date.parse(NOV_8_5PM))?.localDate).toBe('2027-10-28');
    expect(nextOccurrence(diwali, LA, Date.parse('2037-12-01T00:00:00.000Z'))).toBeNull();
    expect(previewSchedule(diwali, LA, Date.parse('2026-11-01T00:00:00.000Z'), 3).nextRuns.map((r) => r.local.slice(0, 10))).toEqual([
      '2026-11-08',
      '2027-10-28',
      '2028-10-17',
    ]);
  });
});

describe('Diwali', () => {
  it('runs on November 8, 2026, from 5 to 8 PM Los Angeles time, taking turns every 30 minutes', async () => {
    const { h } = await house();
    await justBeforeDiwali(h);
    const instances = () => h.mock.controlRequests().map((c) => c.capability.instance);

    await runAt(h, NOV_8_5PM);
    expect(instances()).toContain('segmentedColorRgb');
    expect(instances()).not.toContain('lightScene');

    h.mock.requests.length = 0;
    await runAt(h, '2026-11-09T01:30:00.000Z');
    expect(instances().filter((i) => i === 'lightScene')).toHaveLength(3);
    expect(instances()).not.toContain('segmentedColorRgb');

    h.mock.requests.length = 0;
    await runAt(h, '2026-11-09T02:00:00.000Z');
    expect(instances()).toContain('segmentedColorRgb');

    await runAt(h, '2026-11-09T02:30:00.000Z');
    await runAt(h, '2026-11-09T03:00:00.000Z');
    await runAt(h, '2026-11-09T03:30:00.000Z');

    h.mock.requests.length = 0;
    await runAt(h, '2026-11-09T04:00:00.000Z'); // 8 PM.
    const off = h.mock.controlRequests();
    expect(off).toHaveLength(3);
    expect(off.every((c) => c.capability.instance === 'powerSwitch' && c.capability.value === 0)).toBe(true);
  });

  it('notifies once for the show, not for every 30-minute change', async () => {
    const { h } = await house();
    await justBeforeDiwali(h);
    for (const iso of [NOV_8_5PM, '2026-11-09T01:30:00.000Z', '2026-11-09T02:00:00.000Z', '2026-11-09T04:00:00.000Z']) await runAt(h, iso);
    const started = notifications(h).filter((n) => n.kind === 'run' && n.title.includes('Diwali'));
    expect(started.map((n) => n.title)).toEqual(['Diwali started']);
  });

  it('skips only that date when skipped, and stays on for next year', async () => {
    const { h, client } = await house();
    // The clock jumps months ahead below, past a sign-in, so this is the only call through the API.
    const response = await client.post('/api/v1/holidays/diwali/skip', { skip: false });
    expect(response.statusCode, response.body).toBe(200);
    h.clock.advance(Date.parse('2026-11-07T05:00:00.000Z') - h.clock.nowMs());
    const skipped = h.ctx.holidays.setSkipped('diwali', true);
    expect(skipped.find((x) => x.key === 'diwali')).toMatchObject({ skipped: true, nextDate: '2026-11-08' });
    await justBeforeDiwali(h);
    await runAt(h, NOV_8_5PM);
    await runAt(h, '2026-11-09T01:30:00.000Z');
    await runAt(h, '2026-11-09T04:00:00.000Z');
    expect(h.mock.controlRequests()).toHaveLength(0);
    const first = h.ctx.schedules.list().find((s) => s.name === 'Diwali');
    expect(first?.lastExecution).toMatchObject({ status: 'skipped' });
    expect(holiday(h, 'diwali')).toMatchObject({ enabled: true, skipped: false, nextDate: '2027-10-28' });
  });

  it('can be un-skipped before it starts', async () => {
    const { h } = await house();
    h.clock.advance(Date.parse('2026-11-07T05:00:00.000Z') - h.clock.nowMs());
    h.ctx.holidays.setSkipped('diwali', true);
    expect(holiday(h, 'diwali').skipped).toBe(true);
    h.ctx.holidays.setSkipped('diwali', false);
    expect(holiday(h, 'diwali').skipped).toBe(false);
    await justBeforeDiwali(h);
    await runAt(h, NOV_8_5PM);
    expect(h.mock.controlRequests().length).toBeGreaterThan(0);
  });

  it('does not run hours late after an outage', async () => {
    const { h } = await house();
    await runAt(h, '2026-11-09T00:59:00.000Z');
    h.mock.requests.length = 0;
    await runAt(h, '2026-11-09T02:45:00.000Z'); // Past the 2:30 step, and well past its grace period.
    expect(h.mock.controlRequests()).toEqual([]);
  });

  it('is not replayed later for a light that was offline', async () => {
    const { h } = await house();
    await justBeforeDiwali(h);
    h.mock.intercept = (request, res) => {
      if (!request.path.endsWith('/control')) return false;
      if ((request.body as { payload: { device: string } }).payload.device !== CENTER.device) return false;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 400, msg: 'Device is offline. Please check the Wi-Fi connection.' }));
      return true;
    };
    await runAt(h, NOV_8_5PM);
    expect(h.ctx.missed.listWaiting()).toEqual([]);
    const problem = notifications(h).find((n) => n.kind === 'run_problem');
    expect(problem).toMatchObject({ title: 'Diwali only partly started', severity: 'warn', link: '/connections' });
    expect(problem?.body).toContain('Outdoor Center: offline.');
  });
});

describe('Lights Check', () => {
  async function started() {
    const context = await house();
    const preset = context.h.ctx.presets.list().find((p: PresetDto) => p.builtin?.key === 'christmas-classic') as PresetDto;
    await context.h.ctx.presets.apply(preset.id, undefined);
    await context.h.ctx.notifications.idle();
    const notification = notifications(context.h).find((n) => n.kind === 'run') as NotificationDto;
    return { ...context, preset, notification };
  }

  it('shows the colors sent, says only that Govee accepted it, and asks', async () => {
    const { notification, preset } = await started();
    expect(notification.title).toBe(`${preset.name} started`);
    expect(notification.body).toContain('🟥🟥🟥🟩🟩🟩');
    expect(notification.body).toContain('Govee accepted it on 3 strings. Did the lights change?');
    expect(notification.body).not.toMatch(/\b(lights|colors) (have )?changed\b/i);
    expect(notification.actions.map((a) => a.label)).toEqual(['Looks right', "Didn't change"]);
  });

  it('records the answer, once', async () => {
    const { h, client, notification } = await started();
    const answered = (await client.post(`/api/v1/notifications/${notification.id}/respond`, { action: 'looks_right' })).json() as NotificationDto;
    expect(answered).toMatchObject({ answer: 'looks_right' });
    expect(answered.readAt).toBeTruthy();
    await client.post(`/api/v1/notifications/${notification.id}/respond`, { action: 'didnt_change' });
    expect(h.ctx.notifications.get(notification.id).answer).toBe('looks_right');
    const events = h.ctx.activity.list({ eventType: 'notification', limit: 20 }).events;
    expect(events.filter((e) => e.message.includes('You confirmed the lights changed'))).toHaveLength(1);
    expect(events.some((e) => e.message.includes('did not change'))).toBe(false);
  });

  it('starts a connection check when the lights did not change', async () => {
    const { h, client, notification } = await started();
    h.mock.requests.length = 0;
    h.clock.advance(10_000);
    await client.post(`/api/v1/notifications/${notification.id}/respond`, { action: 'didnt_change' });
    await h.ctx.connection.check();
    expect(h.mock.requests.filter((r) => r.path.endsWith('/state')).length).toBeGreaterThan(0);
    expect(h.ctx.activity.list({ eventType: 'notification', limit: 20 }).events[0]?.message).toContain('though Govee accepted it');
  });

  it('refuses an answer that does not apply', async () => {
    const { client, notification } = await started();
    expect((await client.post(`/api/v1/notifications/${notification.id}/respond`, { action: 'skip' })).statusCode).toBe(422);
    expect((await client.post('/api/v1/notifications/99999/respond', { action: 'skip' })).statusCode).toBe(404);
  });

  it('tells apart a schedule, a pattern, and a run nobody should be notified about', async () => {
    const { h, client, preset } = await started();
    const count = () => notifications(h).length;
    const before = count();
    await client.patch('/api/v1/settings', { notifyPatternStarts: false });
    h.clock.advance(60_000);
    await h.ctx.presets.apply(preset.id, undefined);
    expect(count()).toBe(before);
    // A plain command to one light is not a pattern or schedule.
    await client.patch('/api/v1/settings', { notifyPatternStarts: true });
    const devices = h.ctx.devices.repository.list();
    h.clock.advance(60_000);
    await client.post(`/api/v1/devices/${devices[0]?.id}/power`, { on: true });
    expect(count()).toBe(before);
  });

  it('still reports a failed run when start notifications are off', async () => {
    const { h, client, preset } = await started();
    await client.patch('/api/v1/settings', { notifyPatternStarts: false, notifyScheduleStarts: false });
    h.mock.intercept = (request, res) => {
      if (!request.path.endsWith('/control')) return false;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 400, msg: 'Parameter value out of range' }));
      return true;
    };
    h.clock.advance(60_000);
    await h.ctx.presets.apply(preset.id, undefined);
    expect(notifications(h)[0]).toMatchObject({ kind: 'run_problem', severity: 'bad', title: `${preset.name} didn't start` });
  });

  it('counts unread, and clears it', async () => {
    const { client } = await started();
    const list = (await client.get('/api/v1/notifications')).json() as NotificationListDto;
    expect(list.unread).toBeGreaterThan(0);
    const after = (await client.post('/api/v1/notifications/read-all')).json() as NotificationListDto;
    expect(after.unread).toBe(0);
  });
});

describe('the holiday heads-up', () => {
  it('comes 15 minutes before, once, with a Skip that works', async () => {
    const { h, sender, client } = await house();
    await client.post('/api/v1/notifications/push/subscribe', { endpoint: VALID_ENDPOINT, keys: KEYS, label: 'iPhone' });
    h.clock.advance(Date.parse('2026-11-09T00:30:00.000Z') - h.clock.nowMs());
    h.ctx.notifications.sendHeadsUps();
    expect(notifications(h).some((n) => n.kind === 'heads_up')).toBe(false);

    h.clock.advance(Date.parse('2026-11-09T00:45:00.000Z') - h.clock.nowMs());
    h.ctx.notifications.sendHeadsUps();
    h.clock.advance(60_000);
    h.ctx.notifications.sendHeadsUps();
    await h.ctx.notifications.idle();
    const reminders = notifications(h).filter((n) => n.kind === 'heads_up');
    expect(reminders.map((n) => n.title)).toEqual(['Diwali starts in 15 min']);
    expect(reminders[0]?.actions.map((a) => a.action)).toEqual(['skip']);

    const push = sender.sent.find((s) => s.payload.title === 'Diwali starts in 15 min');
    const token = push?.payload.actions[0]?.token as string;
    expect((await h.app.inject({ method: 'POST', url: '/api/v1/notification-actions', payload: { token } })).statusCode).toBe(200);
    expect(notifications(h).find((n) => n.kind === 'heads_up')?.answer).toBe('skip');

    h.mock.requests.length = 0;
    await runAt(h, NOV_8_5PM);
    expect(h.mock.controlRequests()).toHaveLength(0);
  });

  it('does not remind about a show already skipped, turned off, or with reminders off', async () => {
    const { h } = await house();
    h.clock.advance(Date.parse('2026-11-07T05:00:00.000Z') - h.clock.nowMs());
    h.ctx.holidays.setSkipped('diwali', true);
    h.clock.advance(Date.parse('2026-11-09T00:50:00.000Z') - h.clock.nowMs());
    h.ctx.notifications.sendHeadsUps();
    expect(notifications(h).filter((n) => n.kind === 'heads_up')).toEqual([]);

    h.ctx.holidays.setSkipped('diwali', false);
    h.ctx.settings.update({ notifyHeadsUp: false });
    h.ctx.notifications.sendHeadsUps();
    expect(notifications(h).filter((n) => n.kind === 'heads_up')).toEqual([]);

    h.ctx.settings.update({ notifyHeadsUp: true });
    h.ctx.holidays.setEnabled('diwali', false);
    h.ctx.notifications.sendHeadsUps();
    expect(notifications(h).filter((n) => n.kind === 'heads_up')).toEqual([]);

    h.ctx.holidays.setEnabled('diwali', true);
    h.ctx.notifications.sendHeadsUps();
    expect(notifications(h).filter((n) => n.kind === 'heads_up')).toHaveLength(1);
  });

  it('never reminds about an ordinary daily schedule', async () => {
    const { h, client } = await house();
    const group = h.ctx.groups.list()[0];
    await client.post('/api/v1/schedules', {
      name: 'Daily',
      enabled: true,
      timeZone: 'UTC',
      recurrence: { kind: 'daily', time: '12:10' },
      target: { type: 'group', groupId: group?.id },
      action: { type: 'power', on: true },
      missedRunPolicy: 'skip',
    });
    h.ctx.notifications.sendHeadsUps();
    expect(notifications(h).filter((n) => n.kind === 'heads_up')).toEqual([]);
  });
});

describe('phone notification buttons', () => {
  async function withToken() {
    const context = await house();
    await context.client.post('/api/v1/notifications/push/subscribe', { endpoint: VALID_ENDPOINT, keys: KEYS, label: 'Phone' });
    const preset = context.h.ctx.presets.list().find((p: PresetDto) => p.builtin?.key === 'christmas-classic') as PresetDto;
    await context.h.ctx.presets.apply(preset.id, undefined);
    await context.h.ctx.notifications.idle();
    const push = context.sender.sent.find((s) => s.payload.actions.length > 0);
    return { ...context, push, tokens: push?.payload.actions as PushPayload['actions'] };
  }
  const post = (h: Harness, token: string) => h.app.inject({ method: 'POST', url: '/api/v1/notification-actions', payload: { token } });

  it('works with no session or CSRF token, and only once', async () => {
    const { h, tokens } = await withToken();
    const token = tokens.find((t) => t.action === 'looks_right')?.token as string;
    expect((await post(h, token)).statusCode).toBe(200);
    expect((await post(h, token)).statusCode).toBe(404);
  });

  it('uses up the other button too', async () => {
    const { h, tokens } = await withToken();
    expect((await post(h, tokens[0]?.token as string)).statusCode).toBe(200);
    expect((await post(h, tokens[1]?.token as string)).statusCode).toBe(404);
  });

  it('stores only a hash, so the database cannot be used to answer', async () => {
    const { h, tokens } = await withToken();
    const rows = h.ctx.db.prepare('SELECT token_hash FROM notification_tokens').all() as { token_hash: string }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(tokens.map((t) => t.token)).not.toContain(row.token_hash);
      expect((await post(h, row.token_hash)).statusCode).toBe(404);
    }
  });

  it('expires, and refuses made-up tokens', async () => {
    const { h, tokens } = await withToken();
    expect((await post(h, 'x'.repeat(43))).statusCode).toBe(404);
    expect((await post(h, 'short')).statusCode).toBe(400);
    h.clock.advance(8 * 24 * 3600 * 1000);
    expect((await post(h, tokens[0]?.token as string)).statusCode).toBe(404);
  });

  it('does not put the token in logs', async () => {
    const { h, tokens } = await withToken();
    await post(h, tokens[0]?.token as string);
    expect(h.logs()).not.toContain(tokens[0]?.token);
  });
});

describe('push devices', () => {
  it('sends to each device, signed with keys made once, and hides them from the API', async () => {
    const { h, sender, client } = await house();
    const first = (await client.get('/api/v1/notifications/push')).json();
    expect(first.devices).toEqual([]);
    await client.post('/api/v1/notifications/push/subscribe', { endpoint: VALID_ENDPOINT, keys: KEYS, label: 'iPhone' });
    await client.post('/api/v1/notifications/test');
    await h.ctx.notifications.idle();
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]).toMatchObject({ endpoint: VALID_ENDPOINT, urgency: 'high' });
    expect(sender.sent[0]?.payload.body).toContain('🟥🟧🟨🟩🟦🟪');

    const status = await client.get('/api/v1/notifications/push');
    expect(status.body).not.toContain(sender.sent[0]?.privateKey);
    expect(status.body).not.toContain(VALID_ENDPOINT);
    const again = (await client.get('/api/v1/notifications/push')).json();
    expect(again.publicKey).toBe(first.publicKey);
    expect(again.devices[0]).toMatchObject({ label: 'iPhone' });
    expect(again.devices[0].lastSuccessAt).toBeTruthy();
    expect(h.logs()).not.toContain(sender.sent[0]?.privateKey);
    expect(h.logs()).not.toContain(TEST_API_KEY);
  });

  it('works with the real library: encrypted, and signed as this app', () => {
    const keys = generatePushKeys();
    const browser = crypto.createECDH('prime256v1');
    browser.generateKeys();
    const details = generateRequestDetails(
      {
        endpoint: VALID_ENDPOINT,
        keys: { p256dh: browser.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') },
      },
      JSON.stringify({ title: 'Secret title' }),
      {
        vapidDetails: { subject: 'https://glmserver-production.up.railway.app', publicKey: keys.publicKey, privateKey: keys.privateKey },
        TTL: 900,
        urgency: 'high',
        timeout: 10_000,
      },
    );
    expect(details.endpoint).toBe(VALID_ENDPOINT);
    expect(details.headers).toMatchObject({ 'Content-Encoding': 'aes128gcm', TTL: 900, Urgency: 'high' });
    expect(String(details.headers.Authorization)).toContain(keys.publicKey);
    expect(Buffer.from(details.body as Buffer).toString('latin1')).not.toContain('Secret title');
  });

  it('updates an existing device rather than adding it twice', async () => {
    const { client } = await house();
    await client.post('/api/v1/notifications/push/subscribe', { endpoint: VALID_ENDPOINT, keys: KEYS, label: 'Phone' });
    const status = (await client.post('/api/v1/notifications/push/subscribe', { endpoint: VALID_ENDPOINT, keys: KEYS, label: 'iPhone' })).json();
    expect(status.devices).toHaveLength(1);
    expect(status.devices[0].label).toBe('iPhone');
  });

  it('removes a device the push service says has gone', async () => {
    const { h, sender, client } = await house();
    await client.post('/api/v1/notifications/push/subscribe', { endpoint: VALID_ENDPOINT, keys: KEYS, label: 'Old phone' });
    sender.failWith = new PushDeliveryError('The push service answered 410.', 410);
    await client.post('/api/v1/notifications/test');
    await h.ctx.notifications.idle();
    expect(h.ctx.notifications.pushStatus().devices).toEqual([]);
  });

  it('keeps a device through a temporary failure, and says so', async () => {
    const { h, sender, client } = await house();
    await client.post('/api/v1/notifications/push/subscribe', { endpoint: VALID_ENDPOINT, keys: KEYS, label: 'Phone' });
    sender.failWith = new PushDeliveryError('The push service answered 503.', 503);
    await client.post('/api/v1/notifications/test');
    await h.ctx.notifications.idle();
    expect(h.ctx.notifications.pushStatus().devices[0]?.lastError).toBe('The push service answered 503.');
  });

  it('never lets a push failure affect a run', async () => {
    const { h, sender, client } = await house();
    await client.post('/api/v1/notifications/push/subscribe', { endpoint: VALID_ENDPOINT, keys: KEYS, label: 'Phone' });
    sender.failWith = new Error('Push service exploded');
    const preset = h.ctx.presets.list().find((p: PresetDto) => p.builtin?.key === 'christmas-classic') as PresetDto;
    const run = await h.ctx.presets.apply(preset.id, undefined);
    await h.ctx.notifications.idle();
    expect(run.status).toBe('all_accepted');
  });

  it('refuses addresses that are not browser push services', async () => {
    const { client } = await house();
    for (const endpoint of ['http://fcm.googleapis.com/x', 'https://169.254.169.254/latest/meta-data', 'https://localhost/x', 'https://evil.example/push']) {
      const response = await client.post('/api/v1/notifications/push/subscribe', { endpoint, keys: KEYS, label: 'Bad' });
      expect(response.statusCode, endpoint).toBe(422);
    }
  });

  it.each([
    ['https://fcm.googleapis.com/fcm/send/a', true],
    ['https://web.push.apple.com/a', true],
    ['https://wns2-par02p.notify.windows.com/w/?token=a', true],
    ['https://updates.push.services.mozilla.com/wpush/v2/a', true],
    ['http://web.push.apple.com/a', false],
    ['https://push.apple.com.evil.example/a', false],
    ['https://evilpush.apple.com/a', false],
    ['https://fcm.googleapis.com:8443/a', false],
    ['https://user:pass@fcm.googleapis.com/a', false],
    ['not a url', false],
  ])('checks %s', (endpoint, allowed) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(allowed);
  });
});

describe('connection problems', () => {
  it('notifies when a light drops and comes back, once each', async () => {
    const { h } = await house();
    const check = async () => {
      h.clock.advance(10_000);
      await h.ctx.connection.check();
    };
    h.mock.online.set(CENTER.device, false);
    await check();
    await check();
    const problems = () => notifications(h).filter((n) => n.kind === 'problem');
    expect(problems().map((n) => n.title)).toEqual(['Outdoor Center went offline']);
    h.mock.online.set(CENTER.device, true);
    await check();
    expect(notifications(h).filter((n) => n.kind === 'recovered').map((n) => n.title)).toEqual(['Outdoor Center is back online']);
  });

  it('can be turned off', async () => {
    const { h, client } = await house();
    await client.patch('/api/v1/settings', { notifyProblems: false });
    h.mock.online.set(CENTER.device, false);
    h.clock.advance(10_000);
    await h.ctx.connection.check();
    expect(notifications(h)).toEqual([]);
  });
});

describe('settings and housekeeping', () => {
  it('turns everything on by default', async () => {
    const { client } = await house();
    expect((await client.get('/api/v1/settings')).json()).toMatchObject({
      notifyScheduleStarts: true,
      notifyPatternStarts: true,
      notifyHeadsUp: true,
      notifyProblems: true,
    });
  });

  it('removes old notifications with the rest of the history', async () => {
    const { h, client } = await house();
    await client.post('/api/v1/notifications/test');
    expect(notifications(h).length).toBeGreaterThan(0);
    h.clock.advance(91 * 24 * 3600 * 1000);
    h.ctx.maintenance.prune();
    expect(notifications(h)).toEqual([]);
  });
});

describe('preset naming', () => {
  it('gives each holiday its own preset, in the calendar', async () => {
    const { h } = await house();
    expect(presetName(h, 'diwali-colors')).toBe('Diwali: Festival Colors');
    expect(scheduleNames(h, 'diwali').sort()).toEqual([
      'Diwali',
      'Diwali: Festival Colors (18:00)',
      'Diwali: Festival Colors (19:00)',
      'Diwali: Fireworks (17:30)',
      'Diwali: Fireworks (18:30)',
      'Diwali: Fireworks (19:30)',
      'Diwali: end',
    ]);
  });
});
