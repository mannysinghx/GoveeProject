import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandDto, DeviceDto, DiscoveryResultDto, ScheduleDto } from '@glm/shared';
import { GoveeCloudTransport } from '../src/govee/cloud-transport.js';
import { TransportError } from '../src/govee/transport.js';
import { authedClient, createHarness, testConfig, type Harness } from './support/harness.js';
import { mockFullDevice, TEST_API_KEY } from './support/mock-govee.js';

const PASSWORD = 'correct-horse-battery';
const harnesses: Harness[] = [];

async function harness(options: Parameters<typeof createHarness>[0] = {}): Promise<Harness> {
  const h = await createHarness(options);
  harnesses.push(h);
  return h;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const h of harnesses.splice(0)) await h.close();
});

async function withDevice(h: Harness) {
  h.mock.devices = [mockFullDevice()];
  const client = await authedClient(h.app);
  const { devices } = (await client.post('/api/v1/devices/discover')).json() as DiscoveryResultDto;
  return { client, device: devices[0] as DeviceDto };
}

describe('authentication cannot be skipped by spelling the path differently', () => {
  it.each(['/%61pi/v1/devices', '/api/v1/%64evices', '/%61%70%69/v1/settings', '/api/%76%31/system/status'])(
    'requires a session for GET %s',
    async (url) => {
      const h = await harness();
      const response = await h.app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(401);
    },
  );

  it('does not send a command through an encoded path without a session', async () => {
    const h = await harness();
    const { device } = await withDevice(h);
    const response = await h.app.inject({
      method: 'POST',
      url: `/%61pi/v1/devices/${device.id}/power`,
      payload: { on: true },
    });
    expect(response.statusCode).toBe(401);
    expect(h.mock.controlRequests()).toHaveLength(0);
  });

  it('still requires the CSRF token on an encoded path', async () => {
    const h = await harness();
    const client = await authedClient(h.app);
    const response = await h.app.inject({
      method: 'POST',
      url: '/%61pi/v1/groups',
      cookies: client.cookies,
      payload: { name: 'x' },
    });
    expect(response.statusCode).toBe(403);
    expect(h.ctx.groups.list()).toEqual([]);
  });

  it('treats an encoded unknown API path like any other unknown API path', async () => {
    const h = await harness();
    expect((await h.app.inject({ method: 'GET', url: '/%61pi/v1/nope' })).statusCode).toBe(401);
    const client = await authedClient(h.app);
    expect((await client.get('/%61pi/v1/nope')).statusCode).toBe(404);
  });

  it('survives a malformed percent sequence', async () => {
    const h = await harness();
    expect((await h.app.inject({ method: 'GET', url: '/api/v1/%zz' })).statusCode).toBeLessThan(500);
    expect((await h.app.inject({ method: 'GET', url: '/%zz' })).statusCode).toBeLessThan(500);
  });
});

describe('first-run setup behind a proxy', () => {
  const session = async (h: Harness) => (await h.app.inject({ method: 'GET', url: '/api/v1/auth/session' })).json();

  it('requires a code when a reverse proxy is declared, even on a loopback bind', async () => {
    const h = await harness({ env: { TRUST_PROXY: 'true' } });
    expect((await session(h)).setupCodeRequired).toBe(true);
    const stranger = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: { username: 'stranger', password: PASSWORD },
    });
    expect(stranger.statusCode).toBe(403);
    expect(h.ctx.auth.setupRequired()).toBe(true);
  });

  it('requires a code when a non-loopback host name is allowed', async () => {
    const h = await harness({ env: { ALLOWED_HOSTS: 'lights.example.com' } });
    const response = await h.app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { host: 'lights.example.com' },
    });
    expect(response.json().setupCodeRequired).toBe(true);
  });

  it('needs no code when only loopback names are allowed', async () => {
    const h = await harness({ env: { ALLOWED_HOSTS: 'localhost,127.0.0.1,[::1]' } });
    expect((await session(h)).setupCodeRequired).toBe(false);
  });
});

describe('a long Retry-After cannot stall the app', () => {
  const rateLimited = (seconds: number) => (request: { path: string }, res: http.ServerResponse) => {
    if (!request.path.endsWith('/control')) return false;
    res.writeHead(429, { 'retry-after': String(seconds), 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 429, message: 'too many request, request limits' }));
    return true;
  };

  it('fails a command at once instead of sleeping for hours, and does not resend it later', async () => {
    const h = await harness();
    const { client, device } = await withDevice(h);
    h.mock.intercept = rateLimited(6 * 3600);

    const response = await client.post(`/api/v1/devices/${device.id}/power`, { on: true });
    const { command } = response.json() as { command: CommandDto };
    expect(command.status).toBe('failed');
    expect(command.errorCategory).toBe('rate_limited');
    expect(h.mock.controlRequests()).toHaveLength(1);
    expect(Math.max(0, ...h.clock.sleeps)).toBeLessThanOrEqual(60_000);
  });

  it('does not let a stalled command hold up the next one past its limit', async () => {
    const h = await harness();
    const { client, device } = await withDevice(h);
    h.mock.intercept = rateLimited(6 * 3600);
    await client.post(`/api/v1/devices/${device.id}/power`, { on: true });
    const second = (await client.post(`/api/v1/devices/${device.id}/brightness`, { value: 10 })).json() as {
      command: CommandDto;
    };
    expect(second.command.status).toBe('failed');
    expect(second.command.errorCategory).toBe('rate_limited');
    expect(h.mock.controlRequests()).toHaveLength(1); // Paused, so nothing else was sent.
  });

  it('counts time spent queued against the limit', async () => {
    const h = await harness({ env: { QUEUE_MAX_WAIT_MS: '2000' } });
    const { client, device } = await withDevice(h);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => client.post(`/api/v1/devices/${device.id}/segments`, {
        operations: [{ segments: [i], hex: '#ff0000' }],
      })),
    );
    await h.ctx.queue.idle();
    const statuses = results.flatMap((r) => (r.json() as { outcomes: { status: string }[] }).outcomes.map((o) => o.status));
    expect(statuses.filter((s) => s === 'accepted').length).toBeLessThan(8);
    expect(statuses.filter((s) => s === 'failed').length).toBeGreaterThan(0);
  });

  it('does not sleep through a long Retry-After on a read', async () => {
    const h = await harness();
    h.mock.intercept = (_request, res) => {
      res.writeHead(429, { 'retry-after': String(6 * 3600), 'content-type': 'application/json' });
      res.end('{}');
      return true;
    };
    const client = await authedClient(h.app);
    const response = await client.post('/api/v1/devices/discover');
    expect(response.statusCode).toBe(429);
    expect(Math.max(0, ...h.clock.sleeps)).toBeLessThanOrEqual(15_000);
  });

  it('caps how long one response can pause the whole app', async () => {
    const h = await harness();
    h.ctx.limiter.pause(30 * 24 * 3600 * 1000);
    const until = Date.parse(h.ctx.limiter.pausedUntil() ?? '');
    expect(until - h.clock.nowMs()).toBeLessThanOrEqual(3600 * 1000);
  });
});

describe('login throttling under parallel requests', () => {
  it('stops a burst from one address rather than checking every guess', async () => {
    const h = await harness();
    await authedClient(h.app, PASSWORD);
    const attempts = await Promise.all(
      Array.from({ length: 40 }, () =>
        h.app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          remoteAddress: '10.5.0.1',
          payload: { username: 'owner', password: 'wrong-password' },
        }),
      ),
    );
    const statuses = attempts.map((a) => a.statusCode);
    expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(5);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(35);
  });

  it('does not count a successful login as a failure', async () => {
    const h = await harness();
    await authedClient(h.app, PASSWORD);
    for (let i = 0; i < 8; i++) {
      const ok = await h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: '10.5.0.2',
        payload: { username: 'owner', password: PASSWORD },
      });
      expect(ok.statusCode).toBe(200);
    }
  });
});

describe('client address behind a proxy', () => {
  it('uses the address the proxy appended, not one the client forged', async () => {
    const h = await harness({ env: { TRUST_PROXY: 'true', SETUP_TOKEN: 'a-setup-token-value' } });
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: { username: 'owner', password: PASSWORD, setupCode: 'a-setup-token-value' },
    });
    const attempt = (forged: number) =>
      h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { 'x-forwarded-for': `203.0.113.${forged}, 198.51.100.7` },
        payload: { username: 'owner', password: 'wrong-password' },
      });
    for (let i = 0; i < 5; i++) expect((await attempt(i)).statusCode).toBe(401);
    expect((await attempt(99)).statusCode).toBe(429);
  });
});

describe('proxy hop count', () => {
  const ipFor = async (env: NodeJS.ProcessEnv) => {
    const h = await harness({ env });
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'x-forwarded-for': '203.0.113.9, 198.51.100.7, 10.0.0.2' },
      payload: { username: 'owner', password: 'wrong-password' },
    });
    return h.ctx.activity.list({ eventType: 'auth', limit: 1 }).events[0]?.details as { ip: string };
  };

  it('takes the address that many proxies back, and never the forgeable left end', async () => {
    expect((await ipFor({ TRUST_PROXY: 'false' })).ip).toBe('127.0.0.1');
    expect((await ipFor({ TRUST_PROXY: 'true' })).ip).toBe('10.0.0.2');
    expect((await ipFor({ TRUST_PROXY: '1' })).ip).toBe('10.0.0.2');
    expect((await ipFor({ TRUST_PROXY: '2' })).ip).toBe('198.51.100.7');
  });

  it('rejects anything else', () => {
    expect(() => testConfig({ TRUST_PROXY: 'yes' })).toThrow(/TRUST_PROXY/);
  });
});

describe('verification follows the newest report', () => {
  it('moves from mismatch to confirmed when a later report catches up', async () => {
    const h = await harness();
    const { client, device } = await withDevice(h);
    h.mock.applyCommands = false;
    h.mock.state.set(device.goveeDeviceId, { brightness: 10 });
    await client.post(`/api/v1/devices/${device.id}/brightness`, { value: 50 });

    h.clock.advance(5000);
    await h.ctx.devices.refreshState(device.id, 'post_command');
    const instance = (d: DeviceDto) => d.states.find((s) => s.instance === 'brightness');
    expect(instance(h.ctx.devices.get(device.id))?.verification).toBe('mismatch');
    expect(h.ctx.commands.listForDevice(device.id, 1)[0]?.verification).toBe('mismatch');

    h.mock.state.set(device.goveeDeviceId, { brightness: 50 });
    h.clock.advance(5000);
    await h.ctx.devices.refreshState(device.id, 'post_command');
    expect(instance(h.ctx.devices.get(device.id))?.verification).toBe('confirmed');
    expect(h.ctx.commands.listForDevice(device.id, 1)[0]?.verification).toBe('confirmed');
  });

  it('does not downgrade an earlier command already confirmed', async () => {
    const h = await harness();
    const { client, device } = await withDevice(h);
    await client.post(`/api/v1/devices/${device.id}/brightness`, { value: 50 });
    h.clock.advance(5000);
    await h.ctx.devices.refreshState(device.id, 'post_command');
    expect(h.ctx.commands.listForDevice(device.id, 1)[0]?.verification).toBe('confirmed');

    h.mock.state.set(device.goveeDeviceId, { brightness: 99 }); // Changed in the Govee app, say.
    h.clock.advance(5000);
    await h.ctx.devices.refreshState(device.id, 'post_command');
    expect(h.ctx.commands.listForDevice(device.id, 1)[0]?.verification).toBe('confirmed');
  });
});

describe('host checks', () => {
  it('leaves the health check reachable when ALLOWED_HOSTS is set, so containers stay healthy', async () => {
    const h = await harness({ env: { ALLOWED_HOSTS: 'lights.example.com' } });
    const health = await h.app.inject({ method: 'GET', url: '/api/v1/health', headers: { host: '127.0.0.1:8787' } });
    expect(health.statusCode).toBe(200);
    const other = await h.app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { host: '127.0.0.1:8787' } });
    expect(other.statusCode).toBe(421);
  });
});

describe('the API key never follows a redirect', () => {
  it('refuses a redirect instead of forwarding the key to another host', async () => {
    const h = await harness();
    const seen: http.IncomingHttpHeaders[] = [];
    const elsewhere = http.createServer((req, res) => {
      seen.push(req.headers);
      res.end('{}');
    });
    await new Promise<void>((resolve) => elsewhere.listen(0, '127.0.0.1', resolve));
    const port = (elsewhere.address() as AddressInfo).port;
    h.mock.intercept = (_request, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${port}/steal` });
      res.end();
      return true;
    };
    const transport = new GoveeCloudTransport({ apiKey: TEST_API_KEY, baseUrl: h.mock.url, timeoutMs: 500 });
    await expect(transport.discoverDevices()).rejects.toThrow(TransportError);
    expect(seen).toHaveLength(0);
    await new Promise<void>((resolve) => elsewhere.close(() => resolve()));
  });
});

describe('editing a schedule', () => {
  it('still runs at the new time after its time zone changes on the same day', async () => {
    const h = await harness();
    const { device } = await withDevice(h);
    h.clock.set('2026-06-15T12:00:00Z');
    const created = h.ctx.schedules.create({
      name: 'Evening',
      enabled: true,
      timeZone: 'America/New_York',
      recurrence: { kind: 'daily', time: '20:00' },
      target: { type: 'device', deviceId: device.id },
      action: { type: 'power', on: true },
      missedRunPolicy: 'skip',
    });
    const tick = async () => {
      await h.ctx.scheduler.tick();
      await h.ctx.scheduler.idle();
      await h.ctx.queue.idle();
    };
    h.clock.set('2026-06-16T00:00:10Z'); // 20:00 in New York.
    await tick();
    expect(h.mock.controlRequests()).toHaveLength(1);

    const edited: ScheduleDto = h.ctx.schedules.update(created.id, { timeZone: 'America/Los_Angeles' });
    expect(edited.nextRun?.at).toBe('2026-06-16T03:00:00.000Z'); // 20:00 in Los Angeles, same date.
    h.clock.set('2026-06-16T03:00:10Z');
    await tick();
    expect(h.mock.controlRequests()).toHaveLength(2);
    expect(h.ctx.schedules.executions(created.id, 10)).toHaveLength(2);
  });

  it('still runs after solar coordinates change on the same day', async () => {
    const h = await harness();
    const { device } = await withDevice(h);
    h.clock.set('2026-06-15T00:00:00Z');
    const created = h.ctx.schedules.create({
      name: 'Sunset',
      enabled: true,
      timeZone: 'UTC',
      recurrence: { kind: 'solar', event: 'sunset', offsetMinutes: 0, latitude: 51.5, longitude: 0 },
      target: { type: 'device', deviceId: device.id },
      action: { type: 'power', on: true },
      missedRunPolicy: 'skip',
    });
    const first = created.nextRun!.at;
    h.clock.set(new Date(Date.parse(first) + 10_000).toISOString());
    await h.ctx.scheduler.tick();
    await h.ctx.scheduler.idle();
    await h.ctx.queue.idle();
    expect(h.mock.controlRequests()).toHaveLength(1);

    // Far enough west that today's sunset is still ahead.
    const edited = h.ctx.schedules.update(created.id, {
      recurrence: { kind: 'solar', event: 'sunset', offsetMinutes: 0, latitude: 51.5, longitude: -30 },
    });
    expect(edited.nextRun!.at.slice(0, 10)).toBe(first.slice(0, 10));
    h.clock.set(new Date(Date.parse(edited.nextRun!.at) + 10_000).toISOString());
    await h.ctx.scheduler.tick();
    await h.ctx.scheduler.idle();
    await h.ctx.queue.idle();
    expect(h.mock.controlRequests()).toHaveLength(2);
  });
});

describe('key scrubbing', () => {
  it('removes the key before trimming, so a partial key cannot survive', async () => {
    const h = await harness();
    h.mock.intercept = (_request, res) => {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 400, message: `${'x'.repeat(190)}${TEST_API_KEY}` }));
      return true;
    };
    const transport = new GoveeCloudTransport({ apiKey: TEST_API_KEY, baseUrl: h.mock.url, timeoutMs: 500 });
    const error = await transport.discoverDevices().catch((e: unknown) => e as Error);
    expect((error as Error).message).not.toContain(TEST_API_KEY.slice(0, 6));
  });
});

describe('failures inside background work', () => {
  it('a database error during a tick is logged, not an unhandled rejection', async () => {
    const h = await harness();
    vi.spyOn(h.ctx.db, 'prepare').mockImplementationOnce(() => {
      throw new Error('database is locked');
    });
    await expect(h.ctx.scheduler.tick()).resolves.toBeUndefined();
    expect(h.logs()).toContain('Scheduler tick failed');
  });

  it('a command promise still resolves, and the queue keeps going, if recording its outcome fails', async () => {
    const h = await harness();
    const { device } = await withDevice(h);
    const record = h.ctx.devices.getRecord(device.id);
    const enqueue = (value: number) =>
      h.ctx.queue.enqueue({
        deviceId: device.id,
        address: { sku: record.sku, device: record.goveeDeviceId },
        capability: { type: 'devices.capabilities.range', instance: 'brightness', value },
        actionType: 'brightness',
        summary: `brightness ${value}`,
        coalesceKey: null,
        sourceType: 'manual',
      });

    vi.spyOn(h.ctx.commands, 'markAccepted').mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    const failure = () => {
      throw new Error('disk full');
    };
    vi.spyOn(h.ctx.commands, 'markFinished').mockImplementationOnce(failure).mockImplementationOnce(failure);
    const first = enqueue(10);
    const second = enqueue(20);
    await expect(first.done).resolves.toMatchObject({ id: first.command.id, status: 'failed', errorCategory: 'unknown' });
    await expect(second.done).resolves.toMatchObject({ status: 'accepted' });
  });
});

describe('Govee groups, as the real API reports them', () => {
  const group = () => ({
    sku: 'SameModeGroup',
    device: 'group-1',
    deviceName: 'Christmas',
    capabilities: mockFullDevice().capabilities.filter((c) => (c as { instance: string }).instance === 'powerSwitch'),
  });
  const refuseState = (h: Harness) => {
    h.mock.intercept = (request, res) => {
      if (!request.path.endsWith('/state')) return false;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 400, msg: 'devices not exist' }));
      return true;
    };
  };
  const stateCalls = (h: Harness) => h.mock.requests.filter((r) => r.path.endsWith('/state')).length;

  async function setup() {
    const h = await harness();
    h.mock.devices = [group()];
    const client = await authedClient(h.app);
    const { devices } = (await client.post('/api/v1/devices/discover')).json() as DiscoveryResultDto;
    refuseState(h);
    return { h, client, device: devices[0] as DeviceDto };
  }

  it('recognises the group and reads it with no type', async () => {
    const { device } = await setup();
    expect(device).toMatchObject({ isGoveeGroup: true, isPrimaryModel: false, deviceType: null });
    expect(device.capabilities.map((c) => c.kind)).toEqual(['power']);
  });

  it('stops polling after Govee refuses, instead of failing every minute', async () => {
    const { h, client } = await setup();
    await client.post('/api/v1/devices/refresh-due');
    expect(stateCalls(h)).toBe(1);
    for (let i = 0; i < 5; i++) {
      h.clock.advance(61_000);
      await client.post('/api/v1/devices/refresh-due');
    }
    expect(stateCalls(h)).toBe(1);
    expect(h.ctx.activity.list({ eventType: 'state', outcome: 'failure', limit: 50 }).events).toHaveLength(1);
  });

  it('tries again the next day, and always when asked by hand', async () => {
    const { h, client, device } = await setup();
    await client.post('/api/v1/devices/refresh-due');
    h.clock.advance(10_000);
    expect((await client.post(`/api/v1/devices/${device.id}/refresh`)).statusCode).toBe(422);
    expect(stateCalls(h)).toBe(2);

    h.ctx.db.prepare('UPDATE sessions SET expires_at = ?').run('2030-01-01T00:00:00.000Z');
    h.clock.advance(24 * 3600 * 1000 + 1000);
    await client.post('/api/v1/devices/refresh-due');
    expect(stateCalls(h)).toBe(3);
  });

  it('keeps polling through temporary failures', async () => {
    const h = await harness();
    h.mock.devices = [mockFullDevice()];
    const client = await authedClient(h.app);
    await client.post('/api/v1/devices/discover');
    h.mock.intercept = (request, res) => {
      if (!request.path.endsWith('/state')) return false;
      res.writeHead(500);
      res.end();
      return true;
    };
    await client.post('/api/v1/devices/refresh-due');
    const first = stateCalls(h);
    h.clock.advance(61_000);
    await client.post('/api/v1/devices/refresh-due');
    expect(stateCalls(h)).toBeGreaterThan(first);
  });

  it('does not check status after a command when Govee has refused it', async () => {
    const { h, client, device } = await setup();
    await client.post('/api/v1/devices/refresh-due');
    const before = stateCalls(h);
    const command = (await client.post(`/api/v1/devices/${device.id}/power`, { on: true })).json() as { command: CommandDto };
    expect(command.command).toMatchObject({ status: 'accepted', verification: 'unverified' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stateCalls(h)).toBe(before);
  });
});

describe('sending an unsaved pattern', () => {
  const second = () => ({ ...mockFullDevice(), device: 'AA:BB:CC:DD:EE:FF:00:09', deviceName: 'Second string' });

  async function twoStrings() {
    const h = await harness();
    h.mock.devices = [mockFullDevice(), second()];
    const client = await authedClient(h.app);
    const { devices } = (await client.post('/api/v1/devices/discover')).json() as DiscoveryResultDto;
    return { h, client, a: devices.find((d) => d.goveeDeviceId.endsWith('01'))!, b: devices.find((d) => d.goveeDeviceId.endsWith('09'))! };
  }

  it('gives each string only its own segments, in order, and stores no preset', async () => {
    const { h, client, a, b } = await twoStrings();
    const response = await client.post('/api/v1/presets/apply-draft', {
      name: 'Pattern preview',
      actions: [
        { deviceId: a.id, action: { type: 'power', on: true } },
        { deviceId: a.id, action: { type: 'segmentColor', segments: [0, 1], hex: '#ff0000' } },
        { deviceId: b.id, action: { type: 'segmentColor', segments: [2], hex: '#00ff00' } },
      ],
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('all_accepted');
    const sentTo = (device: string) =>
      h.mock.controlRequests().filter((c) => c.device === device).map((c) => c.capability.value);
    expect(sentTo(a.goveeDeviceId)).toEqual([1, { segment: [0, 1], rgb: 16711680 }]);
    expect(sentTo(b.goveeDeviceId)).toEqual([{ segment: [2], rgb: 65280 }]);
    expect(h.ctx.presets.list()).toEqual([]);
    expect(h.ctx.db.prepare('SELECT COUNT(*) AS n FROM execution_runs').get()).toEqual({ n: 1 });
  });

  it('reports one string failing while the other is accepted', async () => {
    const { h, client, a, b } = await twoStrings();
    h.mock.intercept = (request, res) => {
      if (!request.path.endsWith('/control')) return false;
      if ((request.body as { payload: { device: string } }).payload.device !== b.goveeDeviceId) return false;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 400, msg: 'Invalid parameter format' }));
      return true;
    };
    const run = (
      await client.post('/api/v1/presets/apply-draft', {
        actions: [
          { deviceId: a.id, action: { type: 'segmentColor', segments: [0], hex: '#ff0000' } },
          { deviceId: b.id, action: { type: 'segmentColor', segments: [0], hex: '#ff0000' } },
        ],
      })
    ).json() as { status: string; outcomes: { deviceId: string; status: string }[] };
    expect(run.status).toBe('partial');
    expect(Object.fromEntries(run.outcomes.map((o) => [o.deviceId, o.status]))).toEqual({ [a.id]: 'accepted', [b.id]: 'rejected' });
  });

  it('saves a multi-string pattern that applies with no target, each string getting its own', async () => {
    const { h, client, a, b } = await twoStrings();
    const preset = (
      await client.post('/api/v1/presets', {
        name: 'Across two',
        actions: [
          { deviceId: a.id, action: { type: 'segmentColor', segments: [0], hex: '#ff0000' } },
          { deviceId: b.id, action: { type: 'segmentColor', segments: [0], hex: '#0000ff' } },
        ],
      })
    ).json();
    expect(preset.needsTarget).toBe(false);
    const run = (await client.post(`/api/v1/presets/${preset.id}/apply`, {})).json() as { status: string };
    expect(run.status).toBe('all_accepted');
    expect(h.mock.controlRequests().map((c) => [c.device, (c.capability.value as { rgb: number }).rgb]).sort()).toEqual(
      [[a.goveeDeviceId, 16711680], [b.goveeDeviceId, 255]].sort(),
    );
  });

  it('holds a full gradient across several strings', async () => {
    const { client, a, b } = await twoStrings();
    const steps = (deviceId: string) =>
      Array.from({ length: 15 }, (_, i) => ({
        deviceId,
        action: { type: 'segmentColor', segments: [i], hex: `#0000${(i + 16).toString(16)}` },
      }));
    const many = [a.id, b.id, a.id, b.id, a.id, b.id, a.id, b.id, a.id, b.id].flatMap(steps);
    expect(many.length).toBe(150);
    const response = await client.post('/api/v1/presets', { name: 'Long', actions: many });
    expect(response.statusCode).toBe(201);
  });

  it('skips steps a light cannot do, with the reason, and still runs its power step', async () => {
    const h = await harness();
    h.mock.devices = [
      {
        sku: 'SameModeGroup',
        device: 'group-1',
        capabilities: mockFullDevice().capabilities.filter((c) => (c as { instance: string }).instance === 'powerSwitch'),
      },
    ];
    const client = await authedClient(h.app);
    const { devices } = (await client.post('/api/v1/devices/discover')).json() as DiscoveryResultDto;
    const id = devices[0]!.id;
    const run = (
      await client.post('/api/v1/presets/apply-draft', {
        actions: [
          { deviceId: id, action: { type: 'power', on: true } },
          { deviceId: id, action: { type: 'segmentColor', segments: [0], hex: '#ff0000' } },
        ],
      })
    ).json() as { status: string; outcomes: { status: string; reason: string | null }[] };
    expect(run.status).toBe('partial');
    expect(run.outcomes.map((o) => o.status)).toEqual(['accepted', 'skipped']);
    expect(run.outcomes[1]?.reason).toContain('does not report segment colour');
  });

  it('rejects a segment the device does not report, with nothing sent for it', async () => {
    const h = await harness();
    const { client, device } = await withDevice(h);
    const run = (
      await client.post('/api/v1/presets/apply-draft', {
        actions: [{ deviceId: device.id, action: { type: 'segmentColor', segments: [99], hex: '#ff0000' } }],
      })
    ).json() as { status: string; outcomes: { reason: string | null }[] };
    expect(run.status).toBe('skipped');
    expect(run.outcomes[0]?.reason).toContain('99');
    expect(h.mock.controlRequests()).toHaveLength(0);
  });

  it('asks for a target for steps with no device, and rejects empty requests', async () => {
    const h = await harness();
    const client = await authedClient(h.app);
    const generic = await client.post('/api/v1/presets/apply-draft', {
      actions: [{ deviceId: null, action: { type: 'power', on: true } }],
    });
    expect(generic.statusCode).toBe(400);
    expect(generic.json().error.code).toBe('target_required');
    expect((await client.post('/api/v1/presets/apply-draft', { actions: [] })).statusCode).toBe(400);
  });
});

describe('string arrangement setting', () => {
  it('persists and rejects anything malformed', async () => {
    const h = await harness();
    const client = await authedClient(h.app);
    expect((await client.get('/api/v1/settings')).json().patternStrings).toEqual([]);
    const value = [{ deviceId: 'a', included: true, reversed: true }];
    expect((await client.patch('/api/v1/settings', { patternStrings: value })).json().patternStrings).toEqual(value);
    expect((await client.get('/api/v1/settings')).json().patternStrings).toEqual(value);
    expect((await client.patch('/api/v1/settings', { patternStrings: [{ deviceId: 'a' }] })).statusCode).toBe(400);
  });
});

describe('serving the frontend', () => {
  it('returns the app for page addresses, and a real 404 for missing files', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glm-web-'));
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<div id="root"></div>');
    fs.writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log(1)');
    const h = await harness({ env: { WEB_DIST_DIR: dir } });
    try {
      for (const url of ['/', '/schedules', '/patterns/new?device=x', '/devices/a.b/x']) {
        const response = await h.app.inject({ method: 'GET', url });
        expect(response.statusCode, url).toBe(200);
        expect(response.body, url).toContain('id="root"');
      }
      const asset = await h.app.inject({ method: 'GET', url: '/assets/app.js' });
      expect(asset.statusCode).toBe(200);
      expect(String(asset.headers['content-type'])).toContain('javascript');
      for (const url of ['/assets/old-hash.js', '/assets/old-hash.css', '/favicon.ico']) {
        const missing = await h.app.inject({ method: 'GET', url });
        expect(missing.statusCode, url).toBe(404);
        expect(missing.body, url).not.toContain('id="root"');
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
