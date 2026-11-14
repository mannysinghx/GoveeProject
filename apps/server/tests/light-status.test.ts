import { afterEach, describe, expect, it } from 'vitest';
import type { CommandDto, ConnectionReportDto, DeviceDto, DiscoveryResultDto, RefreshAllResultDto } from '@glm/shared';
import { refusedBackoffMs } from '../src/devices/device-service.js';
import { authedClient, createHarness, type Harness } from './support/harness.js';
import { mockFullDevice } from './support/mock-govee.js';

const harnesses: Harness[] = [];
afterEach(async () => {
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

async function house() {
  const h = await createHarness();
  harnesses.push(h);
  h.mock.devices = [LEFT, CENTER, RIGHT];
  const client = await authedClient(h.app);
  const { devices } = (await client.post('/api/v1/devices/discover')).json() as DiscoveryResultDto;
  const by = (name: string) => devices.find((d) => d.name === name) as DeviceDto;
  return { h, client, left: by('Outdoor Left'), center: by('Outdoor Center'), right: by('Outdoor Right') };
}

const report = (h: Harness): ConnectionReportDto => h.ctx.connection.report();
const check = async (h: Harness) => {
  h.clock.advance(130_000); // One background interval.
  await h.ctx.connection.check();
};
const stateCalls = (h: Harness, address?: string) =>
  h.mock.requests.filter(
    (r) => r.path.endsWith('/state') && (!address || (r.body as { payload: { device: string } }).payload.device === address),
  ).length;
const device = async (client: Awaited<ReturnType<typeof authedClient>>, id: string) =>
  (await client.get(`/api/v1/devices/${id}`)).json() as DeviceDto;

/** What Govee sent for all three strings on 12 November 2026: a 400 that did not mention "offline". */
function refuseStatus(h: Harness, addresses?: string[]) {
  h.mock.intercept = (request, res) => {
    if (!request.path.endsWith('/state')) return false;
    const address = (request.body as { payload: { device: string } }).payload.device;
    if (addresses && !addresses.includes(address)) return false;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 400, msg: 'devices not exist' }));
    return true;
  };
}

describe('a status request Govee refuses for a real light', () => {
  it('is asked again at the next check, so one bad answer cannot freeze a light for a day', async () => {
    const { h, client, center } = await house();
    await check(h);
    expect(report(h).overall).toBe('healthy');

    refuseStatus(h);
    await check(h);
    expect((await device(client, center.id)).lastStatusError?.category).toBe('bad_request');

    // Govee recovers. The very next check must reach every light again.
    h.mock.intercept = null;
    const before = stateCalls(h);
    await check(h);
    expect(stateCalls(h)).toBe(before + 3);
    const after = await device(client, center.id);
    expect(after).toMatchObject({ connectivity: 'online', freshness: 'fresh', lastStatusError: null });
    expect(report(h).overall).toBe('healthy');
  });

  it('notices a light that went offline during the refusals as soon as Govee answers again', async () => {
    const { h, center } = await house();
    await check(h);
    refuseStatus(h);
    await check(h);
    h.mock.intercept = null;
    h.mock.online.set(CENTER.device, false);
    await check(h);
    expect(report(h).devices.find((d) => d.deviceId === center.id)?.state).toBe('offline');
  });

  it('spaces out repeats, up to six hours, and never stops for good', async () => {
    expect([1, 2, 3, 4, 5, 9, 30].map(refusedBackoffMs)).toEqual([
      0,
      5 * 60_000,
      10 * 60_000,
      20 * 60_000,
      40 * 60_000,
      6 * 3600_000,
      6 * 3600_000,
    ]);

    const { h } = await house();
    refuseStatus(h, [CENTER.device]);
    await check(h);
    await check(h);
    const afterTwo = stateCalls(h, CENTER.device);
    // Two refusals in a row: held back for five minutes, so the next check skips it.
    await check(h);
    expect(stateCalls(h, CENTER.device)).toBe(afterTwo);
    h.clock.advance(5 * 60_000);
    await check(h);
    expect(stateCalls(h, CENTER.device)).toBe(afterTwo + 1);
    // The other lights were checked every time.
    expect(report(h).devices.filter((d) => d.state === 'online')).toHaveLength(2);
  });

  it('is asked straight away when the owner presses Check lights now', async () => {
    const { h, client, center } = await house();
    refuseStatus(h, [CENTER.device]);
    await check(h);
    await check(h);
    h.mock.intercept = null;
    h.clock.advance(10_000);
    const result = (await client.post('/api/v1/devices/refresh-all')).json() as RefreshAllResultDto;
    expect(result).toMatchObject({ checked: 3, listError: null, failures: [] });
    expect(result.devices.find((d) => d.id === center.id)).toMatchObject({ connectivity: 'online', lastStatusError: null });
    await h.ctx.connection.check();
  });

  it('says which light could not be read, and still reads the others', async () => {
    const { h, client } = await house();
    refuseStatus(h, [CENTER.device]);
    h.clock.advance(10_000);
    const result = (await client.post('/api/v1/devices/refresh-all')).json() as RefreshAllResultDto;
    expect(result.failures.map((f) => f.name)).toEqual(['Outdoor Center']);
    expect(result.devices.filter((d) => d.connectivity === 'online')).toHaveLength(2);
    await h.ctx.connection.check();
  });
});

describe('a light Govee calls offline', () => {
  it('is not called offline, and raises no alarm, when the next answer says online', async () => {
    const { h, client, center } = await house();
    await check(h);
    h.mock.online.set(CENTER.device, false);
    h.clock.advance(60_000);
    await client.post('/api/v1/devices/refresh-due');
    expect((await device(client, center.id)).connectivity).toBe('checking');
    expect(report(h).devices.find((d) => d.deviceId === center.id)).toMatchObject({ state: 'unknown' });

    h.mock.online.set(CENTER.device, true);
    await check(h);
    expect((await device(client, center.id)).connectivity).toBe('online');
    expect(report(h).incidents).toEqual([]);
    expect(report(h).overall).toBe('healthy');
  });

  it('is confirmed within one check when it really is offline, by asking a second time', async () => {
    const { h, client, center } = await house();
    await check(h);
    h.mock.online.set(CENTER.device, false);
    const before = stateCalls(h, CENTER.device);
    await check(h);
    expect(stateCalls(h, CENTER.device)).toBe(before + 2);
    expect((await device(client, center.id)).connectivity).toBe('offline');
    expect(report(h).incidents.filter((i) => i.kind === 'device_offline')).toHaveLength(1);
  });

  it('opens no incident when all three drop for one answer, as on 10 November 2026', async () => {
    const { h } = await house();
    await check(h);
    for (const light of [LEFT, CENTER, RIGHT]) h.mock.online.set(light.device, false);
    // Back before the second answer is requested.
    const realSleep = h.clock.sleep.bind(h.clock);
    h.clock.sleep = async (ms: number) => {
      for (const light of [LEFT, CENTER, RIGHT]) h.mock.online.set(light.device, true);
      await realSleep(ms);
    };
    await check(h);
    expect(report(h).incidents).toEqual([]);
    expect(report(h).overall).toBe('healthy');
  });

  it('is marked from a refused command too, then corrected by the next status report', async () => {
    const { h, client, center } = await house();
    await check(h);
    h.mock.intercept = (request, res) => {
      if (!request.path.endsWith('/control')) return false;
      if ((request.body as { payload: { device: string } }).payload.device !== CENTER.device) return false;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 400, msg: 'Device is offline. Please check the Wi-Fi connection.' }));
      return true;
    };
    const { command } = (await client.post(`/api/v1/devices/${center.id}/power`, { on: true })).json() as { command: CommandDto };
    expect(command).toMatchObject({ status: 'rejected', errorCategory: 'device_offline' });
    expect((await device(client, center.id)).connectivity).toBe('checking');

    await check(h);
    expect((await device(client, center.id)).connectivity).toBe('online');
  });
});

describe('upgrading a database', () => {
  it('keeps a light that was offline as offline, and frees a light held back under the old rule', async () => {
    const { h, client, center, left } = await house();
    h.ctx.db.prepare('UPDATE devices SET online = 0, offline_streak = 0 WHERE id = ?').run(center.id);
    h.ctx.db
      .prepare('UPDATE devices SET last_status_error_json = ?, status_failures = 0 WHERE id = ?')
      .run(JSON.stringify({ category: 'bad_request', message: 'refused', at: h.clock.nowIso() }), left.id);
    // The two data statements of the migration, as it runs them on an existing database.
    h.ctx.db.exec(`UPDATE devices SET offline_streak = 2 WHERE online = 0;
                   UPDATE devices SET status_failures = 1 WHERE last_status_error_json IS NOT NULL;`);
    expect((await device(client, center.id)).connectivity).toBe('offline');
    const before = stateCalls(h, LEFT.device);
    await check(h);
    expect(stateCalls(h, LEFT.device)).toBe(before + 1);
  });
});
