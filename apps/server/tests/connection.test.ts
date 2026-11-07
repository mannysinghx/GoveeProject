import http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandDto, ConnectionReportDto, DeviceDto, DiscoveryResultDto, RunResultDto } from '@glm/shared';
import { GoveeCloudTransport } from '../src/govee/cloud-transport.js';
import { TransportError } from '../src/govee/transport.js';
import { diagnose, overallStatus } from '../src/connection/diagnosis.js';
import { authedClient, createHarness, type Harness } from './support/harness.js';
import { mockFullDevice, TEST_API_KEY } from './support/mock-govee.js';

const harnesses: Harness[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const h of harnesses.splice(0)) await h.close();
});

const stringNamed = (name: string, suffix: string) => ({
  ...mockFullDevice(),
  deviceName: name,
  device: `AA:BB:CC:DD:EE:FF:00:${suffix}`,
});
const LEFT = stringNamed('Outdoor Left', '11');
const CENTER = stringNamed('Outdoor Center', '12');
const RIGHT = stringNamed('Outdoor Right', '13');
const GROUP = {
  sku: 'SameModeGroup',
  device: 'group-1',
  deviceName: 'Christmas',
  capabilities: mockFullDevice().capabilities.filter((c) => (c as { instance: string }).instance === 'powerSwitch'),
};

/** Govee's real answer for a command to an offline light, as seen on a live account. */
function rejectOfflineCommands(h: Harness, address: string) {
  h.mock.intercept = (request, res) => {
    if (!request.path.endsWith('/control')) return false;
    if ((request.body as { payload: { device: string } }).payload.device !== address) return false;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 400, msg: 'Device is offline. Please check the Wi-Fi connection.' }));
    return true;
  };
}

async function house(env?: NodeJS.ProcessEnv) {
  const h = await createHarness(env ? { env } : {});
  harnesses.push(h);
  h.mock.devices = [LEFT, CENTER, RIGHT, GROUP];
  const client = await authedClient(h.app);
  const { devices } = (await client.post('/api/v1/devices/discover')).json() as DiscoveryResultDto;
  const by = (name: string) => devices.find((d) => d.name === name) as DeviceDto;
  return { h, client, left: by('Outdoor Left'), center: by('Outdoor Center'), right: by('Outdoor Right'), group: by('Christmas') };
}

const report = (h: Harness): ConnectionReportDto => h.ctx.connection.report();
const check = async (h: Harness) => {
  h.clock.advance(10_000); // Past the minimum gap between status requests.
  await h.ctx.connection.check();
};
const adviceIds = (h: Harness) => report(h).advice.map((a) => a.id);

describe('offline commands, with the answer the real API gives', () => {
  it('reports an offline light as offline, not as an invalid request', async () => {
    const { h, client, center } = await house();
    rejectOfflineCommands(h, CENTER.device);
    const { command } = (await client.post(`/api/v1/devices/${center.id}/power`, { on: true })).json() as { command: CommandDto };
    expect(command).toMatchObject({ status: 'rejected', errorCategory: 'device_offline', attempts: 1 });
    expect(command.errorMessage).toContain('offline');
    expect(command.errorMessage).not.toContain('invalid');
  });

  it('recognises it as an HTTP status too, and leaves real bad requests alone', async () => {
    const { h } = await house();
    const transport = new GoveeCloudTransport({ apiKey: TEST_API_KEY, baseUrl: h.mock.url, timeoutMs: 500 });
    const answer = (status: number, body: object) => {
      h.mock.intercept = (_r, res: http.ServerResponse) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
        return true;
      };
    };
    const send = () =>
      transport
        .sendCommand({ sku: 'H805C', device: 'x' }, { type: 't', instance: 'i', value: 1 }, { requestId: 'r' })
        .catch((e: unknown) => e as TransportError);

    answer(400, { message: 'Device is offline' });
    expect(await send()).toMatchObject({ category: 'device_offline', retryable: false });
    answer(200, { code: 400, msg: 'Parameter value out of range' });
    expect(await send()).toMatchObject({ category: 'bad_request' });
    answer(200, { code: 200, msg: 'success, was offline earlier' });
    expect(await send()).toMatchObject({ hadExplicitCode: true });
  });
});

describe('watching lights', () => {
  it('reports healthy when every light is online, and leaves the group unmonitored', async () => {
    const { h, group } = await house();
    await check(h);
    const r = report(h);
    expect(r.overall).toBe('healthy');
    expect(r.advice).toEqual([]);
    expect(r.devices.filter((d) => d.state === 'online')).toHaveLength(3);
    expect(r.devices.find((d) => d.deviceId === group.id)).toMatchObject({ state: 'not_monitored' });
    expect(h.mock.requests.filter((q) => q.path.endsWith('/state')).map((q) => (q.body as { payload: { device: string } }).payload.device)).not.toContain(GROUP.device);
  });

  it('opens one incident when a light drops, and closes it when it returns', async () => {
    const { h, center } = await house();
    await check(h);
    h.mock.online.set(CENTER.device, false);
    await check(h);
    await check(h);
    await check(h);
    let r = report(h);
    expect(r.incidents.filter((i) => i.kind === 'device_offline' && i.deviceId === center.id)).toHaveLength(1);
    expect(r.incidents[0]).toMatchObject({ deviceName: 'Outdoor Center', closedAt: null });
    expect(r.devices.find((d) => d.deviceId === center.id)).toMatchObject({ state: 'offline', dropsLast7Days: 1 });
    expect(r.devices.find((d) => d.deviceId === center.id)?.problemSince).toBeTruthy();

    h.clock.advance(600_000);
    h.mock.online.set(CENTER.device, true);
    await check(h);
    r = report(h);
    expect(r.incidents[0]?.closedAt).toBeTruthy();
    expect(r.overall).toBe('healthy');
    const log = r.automaticActions.map((a) => a.message);
    expect(log.some((m) => m.includes('Outdoor Center went offline'))).toBe(true);
    expect(log.some((m) => /Outdoor Center is back online after \d+ min/.test(m))).toBe(true);
  });

  it('keeps an open incident through a restart instead of opening a duplicate', async () => {
    const { h } = await house();
    h.mock.online.set(CENTER.device, false);
    await check(h);
    await h.ctx.connection.stop();
    h.ctx.connection.start();
    await h.ctx.connection.stop();
    await check(h);
    expect(report(h).incidents.filter((i) => i.kind === 'device_offline')).toHaveLength(1);
  });

  it('does not spam the activity log while a problem continues', async () => {
    const { h } = await house();
    h.mock.intercept = (request, res) => {
      if (!request.path.endsWith('/state')) return false;
      res.writeHead(500);
      res.end();
      return true;
    };
    for (let i = 0; i < 5; i++) await check(h);
    expect(h.ctx.activity.list({ eventType: 'state', limit: 50 }).events).toHaveLength(0);
    expect(h.ctx.activity.list({ eventType: 'connection', limit: 50 }).events.filter((e) => e.message.includes('could not reach'))).toHaveLength(1);
  });

  it('is off when disabled, and keeps working if a check fails unexpectedly', async () => {
    const { h } = await house({ CONNECTION_MONITOR_ENABLED: 'false' });
    h.ctx.connection.start();
    expect(report(h).monitor.status).toBe('disabled');
    vi.spyOn(h.ctx.devices.repository, 'list').mockImplementationOnce(() => {
      throw new Error('database is locked');
    });
    await expect(h.ctx.connection.check()).resolves.toBeUndefined();
    expect(h.logs()).toContain('Connection check failed');
  });

  it('checks less often as lights are added, staying within a quarter of the daily budget', async () => {
    const { h } = await house({ GOVEE_DAILY_REQUEST_BUDGET: '2000' });
    await check(h);
    // 3 lights, 500 requests a day for monitoring: one check every 518 s.
    expect(report(h).monitor.intervalSeconds).toBe(519);
    const daily = (86_400 / report(h).monitor.intervalSeconds) * 3;
    expect(daily).toBeLessThanOrEqual(500);
  });

  it('never checks faster than the configured interval', async () => {
    const { h } = await house();
    expect(report(h).monitor.intervalSeconds).toBe(130);
    const relaxed = await house({ CONNECTION_CHECK_SECONDS: '600' });
    expect(report(relaxed.h).monitor.intervalSeconds).toBe(600);
  });

  it('limits how often a person can force a check', async () => {
    const { h, client } = await house();
    const first = (await client.post('/api/v1/connection/check')).json();
    const second = (await client.post('/api/v1/connection/check')).json();
    expect(first.ran).toBe(true);
    expect(second.ran).toBe(false);
    h.clock.advance(16_000);
    expect((await client.post('/api/v1/connection/check')).json().ran).toBe(true);
  });
});

describe('diagnosis from what is and is not working', () => {
  it('blames one light when the others are online, saying which and why', async () => {
    const { h, center } = await house();
    h.mock.online.set(CENTER.device, false);
    await check(h);
    const r = report(h);
    expect(r.overall).toBe('attention');
    const advice = r.advice.find((a) => a.id === `offline-${center.id}`);
    expect(advice?.title).toBe('Outdoor Center is offline');
    expect(advice?.explanation).toContain('Outdoor Left and Outdoor Right are online');
    expect(advice?.explanation).toContain('Govee key look fine');
    expect(advice?.steps.join(' ')).toMatch(/power adapter/);
  });

  it('points at something shared when every light drops together', async () => {
    const { h } = await house();
    for (const d of [LEFT, CENTER, RIGHT]) h.mock.online.set(d.device, false);
    await check(h);
    const r = report(h);
    expect(r.overall).toBe('problem');
    expect(adviceIds(h)).toEqual(['all-offline']);
    expect(r.advice[0]?.title).toBe('All 3 lights are offline');
    expect(r.advice[0]?.steps.join(' ')).toMatch(/router/);
  });

  it('blames Govee or the server, not the lights, when no status request gets through', async () => {
    const { h } = await house();
    h.mock.intercept = (request, res) => {
      if (!request.path.endsWith('/state')) return false;
      res.writeHead(503);
      res.end();
      return true;
    };
    await check(h);
    expect(adviceIds(h)).toEqual(['govee-unreachable']);
    expect(report(h).overall).toBe('problem');

    h.mock.intercept = null;
    await check(h);
    expect(adviceIds(h)).toEqual([]);
    expect(report(h).automaticActions.some((a) => a.message.startsWith('Resolved after'))).toBe(true);
  });

  it('flags a rejected API key, and does not blame the lights', async () => {
    const { h } = await house();
    h.mock.intercept = (_r, res) => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 401, message: 'Unauthorized' }));
      return true;
    };
    await check(h);
    expect(adviceIds(h)).toEqual(['api-key-rejected']);
    expect(report(h).advice[0]?.explanation).toContain('not a problem with your lights');
  });

  it('reports a missing API key without calling Govee', async () => {
    const h = await createHarness({ env: { GOVEE_API_KEY: '' } });
    harnesses.push(h);
    await h.ctx.connection.check();
    expect(adviceIds(h)).toEqual(['api-key-missing']);
    expect(h.mock.requests).toHaveLength(0);
  });

  it('notices a light that keeps dropping, even while it is online', async () => {
    const { h, center } = await house();
    for (let i = 0; i < 3; i++) {
      h.mock.online.set(CENTER.device, false);
      await check(h);
      h.mock.online.set(CENTER.device, true);
      await check(h);
    }
    expect(report(h).devices.find((d) => d.deviceId === center.id)).toMatchObject({ state: 'online', dropsLast7Days: 3 });
    expect(adviceIds(h)).toEqual([`flaky-${center.id}`]);
  });

  it('stops counting old drops after 7 days', async () => {
    const { h, center } = await house();
    h.mock.online.set(CENTER.device, false);
    await check(h);
    h.mock.online.set(CENTER.device, true);
    await check(h);
    h.ctx.db.prepare('UPDATE sessions SET expires_at = ?').run('2030-01-01T00:00:00.000Z');
    h.clock.advance(8 * 24 * 3600 * 1000);
    expect(report(h).devices.find((d) => d.deviceId === center.id)?.dropsLast7Days).toBe(0);
  });

  it('never claims a cause it cannot compare, when there is only one light', () => {
    const device = { deviceId: 'a', name: 'Solo', sku: 'H805C', state: 'offline', problemSince: null, lastOnlineAt: null, lastCheckedAt: null, dropsLast7Days: 0, note: null } as const;
    const [advice] = diagnose([device], new Set());
    expect(advice?.explanation).not.toContain('are online');
    expect(advice?.explanation).toContain('likely cause');
  });

  it('says unknown, not healthy, when nothing has been checked', () => {
    expect(overallStatus([], [], 0)).toBe('unknown');
  });
});

describe('self-healing', () => {
  it('rechecks the device list when a light vanishes, and at most hourly', async () => {
    const { h, center } = await house();
    await check(h);
    h.mock.devices = [LEFT, RIGHT];
    await h.ctx.devices.discover();
    const lists = () => h.mock.requests.filter((r) => r.path.endsWith('/user/devices')).length;
    const before = lists();
    await check(h);
    await check(h);
    expect(lists()).toBe(before + 1);
    expect(report(h).devices.find((d) => d.deviceId === center.id)?.state).toBe('missing');
    expect(adviceIds(h)).toContain(`missing-${center.id}`);

    h.mock.devices = [LEFT, CENTER, RIGHT];
    h.clock.advance(3600 * 1000 + 1000);
    await check(h);
    expect(lists()).toBe(before + 2);
    await check(h);
    expect(report(h).devices.find((d) => d.deviceId === center.id)?.state).toBe('online');
    expect(adviceIds(h)).not.toContain(`missing-${center.id}`);
  });
});

describe('catching a light up', () => {
  const pattern = (deviceId: string, hex = '#ff0000') => ({
    name: 'Xmas',
    actions: [
      { deviceId, action: { type: 'power', on: true } },
      { deviceId, action: { type: 'segmentColor', segments: [0], hex } },
    ],
  });

  /** An offline light misses a pattern, exactly as on the real account. */
  async function missedOne(env?: NodeJS.ProcessEnv) {
    const context = await house(env);
    const { h, client, center } = context;
    h.mock.online.set(CENTER.device, false);
    rejectOfflineCommands(h, CENTER.device);
    await check(h);
    const run = (await client.post('/api/v1/presets/apply-draft', pattern(center.id))).json() as RunResultDto;
    expect(run.outcomes[0]).toMatchObject({ status: 'rejected', errorCategory: 'device_offline' });
    h.mock.requests.length = 0; // From here on, only what is resent counts.
    return context;
  }
  const backOnline = (h: Harness) => {
    h.mock.online.set(CENTER.device, true);
    h.mock.intercept = null;
  };
  const sentTo = (h: Harness, address: string) => h.mock.controlRequests().filter((c) => c.device === address);

  it('remembers what an offline light missed', async () => {
    const { h, center } = await missedOne();
    expect(report(h).waiting).toMatchObject([{ deviceId: center.id, deviceName: 'Outdoor Center', runName: 'Xmas', stepCount: 2 }]);
    expect(report(h).overall).toBe('attention');
  });

  it('does not remember failures that are not about being offline', async () => {
    const { h, client, center } = await house();
    h.mock.intercept = (request, res) => {
      if (!request.path.endsWith('/control')) return false;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 400, msg: 'Parameter value out of range' }));
      return true;
    };
    await client.post('/api/v1/presets/apply-draft', pattern(center.id));
    expect(report(h).waiting).toEqual([]);
  });

  it('changes nothing on its own while catch-up is off, which is the default', async () => {
    const { h } = await missedOne();
    backOnline(h);
    expect(report(h).catchUpEnabled).toBe(false);
    await check(h);
    expect(sentTo(h, CENTER.device)).toHaveLength(0);
    expect(report(h).waiting).toHaveLength(1);
  });

  it('when on, resends once when the light returns, in order, and says it cannot confirm', async () => {
    const { h, client } = await missedOne();
    await client.patch('/api/v1/settings', { catchUpEnabled: true });
    await check(h);
    expect(sentTo(h, CENTER.device)).toHaveLength(0); // Still offline, so nothing is attempted.

    backOnline(h);
    await check(h);
    await check(h);
    await check(h);
    expect(sentTo(h, CENTER.device).map((c) => c.capability.instance)).toEqual(['powerSwitch', 'segmentedColorRgb']);
    const r = report(h);
    expect(r.waiting).toEqual([]);
    expect(r.recentDeliveries[0]).toMatchObject({ status: 'delivered', runName: 'Xmas' });
    const message = r.automaticActions.map((a) => a.message).find((m) => m.startsWith('Caught'));
    expect(message).toContain('cannot confirm');
  });

  it('keeps only the newest thing a light missed', async () => {
    const { h, client, center } = await missedOne();
    await client.post('/api/v1/presets/apply-draft', { ...pattern(center.id, '#00ff00'), name: 'Newer' });
    const r = report(h);
    expect(r.waiting).toHaveLength(1);
    expect(r.waiting[0]?.runName).toBe('Newer');
    expect(r.recentDeliveries[0]).toMatchObject({ status: 'replaced', runName: 'Xmas' });
  });

  it('does not overwrite something newer sent after the light came back', async () => {
    const { h, client, center } = await missedOne();
    await client.patch('/api/v1/settings', { catchUpEnabled: true });
    backOnline(h);
    h.clock.advance(1000);
    await client.post(`/api/v1/devices/${center.id}/power`, { on: false });
    const before = sentTo(h, CENTER.device).length;
    await check(h);
    expect(sentTo(h, CENTER.device)).toHaveLength(before);
    expect(report(h).recentDeliveries[0]).toMatchObject({ status: 'replaced' });
  });

  it('drops anything too old, so lights do not change unexpectedly much later', async () => {
    const { h, client } = await missedOne();
    await client.patch('/api/v1/settings', { catchUpEnabled: true });
    h.clock.advance(25 * 3600 * 1000);
    backOnline(h);
    await check(h);
    expect(sentTo(h, CENTER.device)).toHaveLength(0);
    expect(report(h).recentDeliveries[0]).toMatchObject({ status: 'expired' });
  });

  it('survives a restart, and never resends one interrupted mid-delivery', async () => {
    const { h, center } = await missedOne();
    expect(h.ctx.missed.waiting()).toHaveLength(1);
    const id = h.ctx.missed.waiting()[0]!.id;
    h.ctx.missed.claim(id);
    h.ctx.connection.start();
    await h.ctx.connection.stop();
    expect(report(h).recentDeliveries[0]).toMatchObject({ status: 'failed', deviceId: center.id });
    expect(report(h).recentDeliveries[0]?.detail).toContain('not repeated');
    backOnline(h);
    await check(h);
    expect(sentTo(h, CENTER.device)).toHaveLength(0);
  });

  it('records a new miss, once, when a catch-up finds the light offline again', async () => {
    const { h, client } = await missedOne();
    await client.patch('/api/v1/settings', { catchUpEnabled: true });
    h.mock.online.set(CENTER.device, true); // Reports online, but commands are still refused.
    await check(h);
    const r = report(h);
    expect(r.waiting).toHaveLength(1);
    expect(r.waiting[0]?.runName).toBe('Xmas'); // No "Catch-up: Catch-up:" pile-up.
    expect(r.recentDeliveries.some((d) => d.status === 'failed')).toBe(true);
  });

  it('can be sent by hand once online, and refuses while offline', async () => {
    const { h, client } = await missedOne();
    const id = report(h).waiting[0]!.id;
    const early = await client.post(`/api/v1/connection/missed/${id}/send`);
    expect(early.statusCode).toBe(409);
    expect(early.json().error.message).toContain('not online yet');
    backOnline(h);
    await check(h);
    const sent = await client.post(`/api/v1/connection/missed/${id}/send`);
    expect(sent.statusCode).toBe(200);
    expect(sent.json().waiting).toEqual([]);
    expect(sentTo(h, CENTER.device)).toHaveLength(2);
    expect((await client.post(`/api/v1/connection/missed/${id}/send`)).statusCode).toBe(404);
  });

  it('can be dismissed, so it is never sent', async () => {
    const { h, client } = await missedOne();
    await client.patch('/api/v1/settings', { catchUpEnabled: true });
    const id = report(h).waiting[0]!.id;
    expect((await client.post(`/api/v1/connection/missed/${id}/dismiss`)).json().waiting).toEqual([]);
    backOnline(h);
    await check(h);
    expect(sentTo(h, CENTER.device)).toHaveLength(0);
    expect(report(h).recentDeliveries[0]).toMatchObject({ status: 'dismissed' });
  });

  it('removes old finished records with the rest of the history', async () => {
    const { h, client } = await missedOne();
    const id = report(h).waiting[0]!.id;
    await client.post(`/api/v1/connection/missed/${id}/dismiss`);
    h.mock.online.set(CENTER.device, true);
    await check(h);
    expect(report(h).incidents.length).toBeGreaterThan(0);
    h.clock.advance(91 * 24 * 3600 * 1000);
    h.ctx.maintenance.prune();
    h.ctx.db.prepare('UPDATE sessions SET expires_at = ?').run('2030-01-01T00:00:00.000Z');
    expect(report(h).incidents).toEqual([]);
    expect(report(h).recentDeliveries).toEqual([]);
  });

  it('keeps the catch-up setting from being reset by a stale settings save', async () => {
    const { client } = await house();
    await client.patch('/api/v1/settings', { catchUpEnabled: true });
    await client.patch('/api/v1/settings', { statusPollSeconds: 90 });
    expect((await client.get('/api/v1/settings')).json().catchUpEnabled).toBe(true);
  });
});

describe('a status request refused because the light is offline', () => {
  it('counts as offline, not as a failed check', async () => {
    const { h, center } = await house();
    h.mock.intercept = (request, res) => {
      if (!request.path.endsWith('/state')) return false;
      if ((request.body as { payload: { device: string } }).payload.device !== CENTER.device) return false;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 400, msg: 'Device is offline. Please check the Wi-Fi connection.' }));
      return true;
    };
    await check(h);
    expect(report(h).devices.find((d) => d.deviceId === center.id)).toMatchObject({ state: 'offline' });
    expect(adviceIds(h)).toEqual([`offline-${center.id}`]);
    // Still checked next time, unlike a request Govee refuses as invalid.
    h.mock.intercept = null;
    await check(h);
    expect(adviceIds(h)).toEqual([]);
  });
});

describe('report contents', () => {
  it('never includes the API key', async () => {
    const { h, client } = await house();
    h.mock.online.set(CENTER.device, false);
    await check(h);
    const response = await client.get('/api/v1/connection/report');
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(TEST_API_KEY);
  });
});
