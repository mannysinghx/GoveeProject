import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandDto, DeviceDto, DiscoveryResultDto, ScheduleDto } from '@glm/shared';
import { GoveeCloudTransport } from '../src/govee/cloud-transport.js';
import { TransportError } from '../src/govee/transport.js';
import { authedClient, createHarness, type Harness } from './support/harness.js';
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
