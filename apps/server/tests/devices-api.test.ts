import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommandDto, DeviceDetailDto, DeviceDto, DiscoveryResultDto, RunResultDto, ScenesDto } from '@glm/shared';
import { buildCommand } from '../src/devices/command-builder.js';
import { authedClient, createHarness, type Harness } from './support/harness.js';
import { mockBasicDevice, mockFullDevice } from './support/mock-govee.js';

type Client = Awaited<ReturnType<typeof authedClient>>;

describe('devices API', () => {
  let h: Harness;
  let client: Client;

  beforeEach(async () => {
    h = await createHarness();
    h.mock.devices = [mockFullDevice(), mockBasicDevice()];
    client = await authedClient(h.app);
  });

  afterEach(() => h.close());

  async function discover(): Promise<{ full: DeviceDto; basic: DeviceDto; result: DiscoveryResultDto }> {
    const result = (await client.post('/api/v1/devices/discover')).json() as DiscoveryResultDto;
    return {
      result,
      full: result.devices.find((d) => d.sku === 'H805C')!,
      basic: result.devices.find((d) => d.sku === 'H6001')!,
    };
  }

  const command = (body: string) => (JSON.parse(body) as { command: CommandDto }).command;

  describe('discovery', () => {
    it('stores what Govee returns, and highlights the H805C without restricting to it', async () => {
      const { full, basic, result } = await discover();
      expect(result).toMatchObject({ total: 2, added: 2, noLongerDiscovered: 0 });
      expect(full.isPrimaryModel).toBe(true);
      expect(basic.isPrimaryModel).toBe(false);
      expect(full.name).toBe('Front Eaves (test data)');
      expect(full.connectivity).toBe('unknown'); // In the list does not mean online.
      expect(full.freshness).toBe('never');
    });

    it('does not call the device list on ordinary reads', async () => {
      await discover();
      const before = h.mock.requests.length;
      await client.get('/api/v1/devices');
      await client.get('/api/v1/devices');
      expect(h.mock.requests.length).toBe(before);
    });

    it('keeps internal ids stable across rediscovery', async () => {
      const first = await discover();
      const second = await discover();
      expect(second.full.id).toBe(first.full.id);
      expect(second.result).toMatchObject({ added: 0, updated: 2 });
    });

    it('marks a vanished device but keeps its history, presets and schedules', async () => {
      const { full, basic } = await discover();
      await client.post(`/api/v1/devices/${basic.id}/power`, { on: true });
      const preset = await client.post('/api/v1/presets', {
        name: 'Porch',
        actions: [{ deviceId: basic.id, action: { type: 'power', on: true } }],
      });
      const schedule = await client.post('/api/v1/schedules', {
        name: 'Porch on',
        timeZone: 'UTC',
        recurrence: { kind: 'daily', time: '18:00' },
        target: { type: 'device', deviceId: basic.id },
        action: { type: 'power', on: true },
      });

      h.mock.devices = [mockFullDevice()];
      const { result } = await discover();
      expect(result.noLongerDiscovered).toBe(1);

      const missing = (await client.get(`/api/v1/devices/${basic.id}`)).json() as DeviceDetailDto;
      expect(missing.discoveryStatus).toBe('missing');
      expect(missing.missingSince).toBeTruthy();
      expect(missing.recentCommands.length).toBe(1);
      expect((await client.get(`/api/v1/presets/${preset.json().id}`)).statusCode).toBe(200);
      const scheduleRead = await client.get(`/api/v1/schedules/${schedule.json().id}`);
      expect(scheduleRead.json().problem).toContain('not in the last Govee device list');
      expect(full.discoveryStatus).toBe('present');

      const blocked = await client.post(`/api/v1/devices/${basic.id}/power`, { on: false });
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().error.code).toBe('device_missing');

      h.mock.devices = [mockFullDevice(), mockBasicDevice()];
      const back = await discover();
      expect(back.basic.id).toBe(basic.id);
      expect(back.basic.discoveryStatus).toBe('present');
      expect(back.basic.missingSince).toBeNull();
    });

    it('reports an invalid key clearly', async () => {
      h.mock.intercept = (_r, res) => {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code: 401, message: 'Unauthorized. check you apiKey' }));
        return true;
      };
      const response = await client.post('/api/v1/devices/discover');
      expect(response.statusCode).toBe(502);
      expect(response.json().error.code).toBe('govee_auth');
      expect(response.json().error.message).toContain('GOVEE_API_KEY');
    });

    it('reports a missing key without calling Govee', async () => {
      const noKey = await createHarness({ env: { GOVEE_API_KEY: '' } });
      try {
        const noKeyClient = await authedClient(noKey.app);
        const response = await noKeyClient.post('/api/v1/devices/discover');
        expect(response.statusCode).toBe(503);
        expect(response.json().error.code).toBe('govee_not_configured');
        expect(noKey.mock.requests).toHaveLength(0);
      } finally {
        await noKey.close();
      }
    });

    it('keeps cached devices when discovery fails', async () => {
      await discover();
      h.mock.intercept = (_r, res) => {
        res.writeHead(500);
        res.end();
        return true;
      };
      expect((await client.post('/api/v1/devices/discover')).statusCode).toBe(502);
      const list = (await client.get('/api/v1/devices')).json() as { devices: DeviceDto[] };
      expect(list.devices).toHaveLength(2);
      expect(list.devices.every((d) => d.discoveryStatus === 'present')).toBe(true);
    });
  });

  describe('commands', () => {
    it('sends a valid power command and reports it as accepted, not confirmed', async () => {
      const { full } = await discover();
      const response = await client.post(`/api/v1/devices/${full.id}/power`, { on: false });
      expect(response.statusCode).toBe(200);
      expect(command(response.body)).toMatchObject({ status: 'accepted', verification: 'unverified' });
      expect(h.mock.controlRequests()[0]).toEqual({
        sku: 'H805C',
        device: full.goveeDeviceId,
        capability: { type: 'devices.capabilities.on_off', instance: 'powerSwitch', value: 0 },
      });
    });

    it('rejects an invalid power value before it reaches Govee', async () => {
      const { full } = await discover();
      const response = await client.post(`/api/v1/devices/${full.id}/power`, { on: 'yes' });
      expect(response.statusCode).toBe(400);
      expect(h.mock.controlRequests()).toHaveLength(0);
    });

    it('rejects brightness outside the range the device reports', async () => {
      const { full } = await discover();
      for (const value of [0, 101, -5]) {
        const response = await client.post(`/api/v1/devices/${full.id}/brightness`, { value });
        expect(response.statusCode, String(value)).toBe(422);
        expect(response.json().error.code).toBe('value_out_of_range');
        expect(response.json().error.message).toContain('from 1 to 100');
      }
      expect((await client.post(`/api/v1/devices/${full.id}/brightness`, { value: 1.5 })).statusCode).toBe(400);
      expect(h.mock.controlRequests()).toHaveLength(0);
    });

    it('rejects colour on a device that does not report it', async () => {
      const { basic } = await discover();
      const response = await client.post(`/api/v1/devices/${basic.id}/color`, { hex: '#ff0000' });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('unsupported_capability');
      expect(response.json().error.message).toContain('does not report');
      expect(h.mock.controlRequests()).toHaveLength(0);
    });

    it('sends colour as a decimal JSON integer', async () => {
      const { full } = await discover();
      await client.post(`/api/v1/devices/${full.id}/color`, { hex: '#FF0000' });
      await h.ctx.queue.idle();
      const raw = h.mock.requests.find((r) => r.path.endsWith('/control'));
      expect((raw?.body as { payload: { capability: { value: unknown } } }).payload.capability.value).toBe(16711680);
    });

    it('rejects an invalid colour value', async () => {
      const { full } = await discover();
      for (const hex of ['red', '#ff00', '0xff0000', '#gggggg']) {
        expect((await client.post(`/api/v1/devices/${full.id}/color`, { hex })).statusCode, hex).toBe(400);
      }
    });

    it('validates colour temperature against this device\'s own range', async () => {
      const { full, basic } = await discover();
      expect((await client.post(`/api/v1/devices/${full.id}/color-temperature`, { kelvin: 1000 })).statusCode).toBe(422);
      expect((await client.post(`/api/v1/devices/${full.id}/color-temperature`, { kelvin: 3000 })).statusCode).toBe(200);
      expect((await client.post(`/api/v1/devices/${basic.id}/color-temperature`, { kelvin: 3000 })).statusCode).toBe(422);
    });

    it('returns 404 for an unknown device id, with nothing sent', async () => {
      const response = await client.post('/api/v1/devices/not-a-device/power', { on: true });
      expect(response.statusCode).toBe(404);
      expect(h.mock.controlRequests()).toHaveLength(0);
    });

    it('ignores a client attempt to supply a Govee address or raw capability', async () => {
      const { full } = await discover();
      await client.post(`/api/v1/devices/${full.id}/power`, {
        on: true,
        device: 'EV:IL',
        sku: 'H0000',
        capability: { type: 'evil', instance: 'evil', value: 1 },
      });
      expect(h.mock.controlRequests()[0]).toMatchObject({
        sku: 'H805C',
        device: full.goveeDeviceId,
        capability: { instance: 'powerSwitch', value: 1 },
      });
    });

    it('reports a Govee rejection as rejected', async () => {
      const { full } = await discover();
      h.mock.intercept = (request, res) => {
        if (!request.path.endsWith('/control')) return false;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code: 400, msg: 'Parameter value out of range' }));
        return true;
      };
      const response = await client.post(`/api/v1/devices/${full.id}/brightness`, { value: 50 });
      expect(response.statusCode).toBe(200);
      const result = command(response.body);
      expect(result.status).toBe('rejected');
      expect(result.errorMessage).toContain('Parameter value out of range');
      expect(result.verification).toBe('not_applicable');
    });

    it('records command history with the source', async () => {
      const { full } = await discover();
      await client.post(`/api/v1/devices/${full.id}/power`, { on: true });
      const history = (await client.get(`/api/v1/devices/${full.id}/commands`)).json() as { commands: CommandDto[] };
      expect(history.commands[0]).toMatchObject({ sourceType: 'manual', actionType: 'power', status: 'accepted' });
      const single = await client.get(`/api/v1/commands/${history.commands[0]!.id}`);
      expect(single.statusCode).toBe(200);
    });
  });

  describe('state reconciliation', () => {
    it('keeps requested, accepted and reported apart, and confirms only from a later report', async () => {
      const { full } = await discover();
      await client.post(`/api/v1/devices/${full.id}/brightness`, { value: 42 });

      const after = (await client.get(`/api/v1/devices/${full.id}`)).json() as DeviceDetailDto;
      const accepted = after.states.find((s) => s.instance === 'brightness');
      expect(accepted?.requested?.value).toBe(42);
      expect(accepted?.accepted?.value).toBe(42);
      expect(accepted?.reported).toBeNull();
      expect(accepted?.verification).toBe('unverified');

      h.clock.advance(5000);
      const refreshed = (await client.post(`/api/v1/devices/${full.id}/refresh`)).json() as { device: DeviceDto };
      const reported = refreshed.device.states.find((s) => s.instance === 'brightness');
      expect(reported?.reported?.value).toBe(42);
      expect(reported?.verification).toBe('confirmed');
      expect(refreshed.device.connectivity).toBe('online');
      expect(refreshed.device.freshness).toBe('fresh');

      const history = h.ctx.commands.listForDevice(full.id, 1);
      expect(history[0]?.verification).toBe('confirmed');
    });

    it('reports a mismatch when Govee reports a different value afterwards', async () => {
      const { full } = await discover();
      h.mock.applyCommands = false;
      h.mock.state.set(full.goveeDeviceId, { brightness: 10 });
      await client.post(`/api/v1/devices/${full.id}/brightness`, { value: 80 });
      h.clock.advance(5000);
      const refreshed = (await client.post(`/api/v1/devices/${full.id}/refresh`)).json() as { device: DeviceDto };
      const state = refreshed.device.states.find((s) => s.instance === 'brightness');
      expect(state?.verification).toBe('mismatch');
      expect(state?.reported?.value).toBe(10);
      expect(state?.accepted?.value).toBe(80);
    });

    it('marks settings Govee does not report as not_reported, with no invented value', async () => {
      const { full } = await discover();
      h.mock.applyCommands = false;
      await client.post(`/api/v1/devices/${full.id}/brightness`, { value: 80 });
      h.clock.advance(5000);
      const refreshed = (await client.post(`/api/v1/devices/${full.id}/refresh`)).json() as { device: DeviceDto };
      const state = refreshed.device.states.find((s) => s.instance === 'brightness');
      expect(state?.notQueryable).toBe(true);
      expect(state?.reported).toBeNull();
      expect(state?.verification).toBe('not_reported');
    });

    it('marks an offline report as historical and refuses to confirm from it', async () => {
      const { full } = await discover();
      await client.post(`/api/v1/devices/${full.id}/brightness`, { value: 80 });
      h.mock.online.set(full.goveeDeviceId, false);
      h.clock.advance(5000);
      const refreshed = (await client.post(`/api/v1/devices/${full.id}/refresh`)).json() as { device: DeviceDto };
      expect(refreshed.device.connectivity).toBe('offline');
      const state = refreshed.device.states.find((s) => s.instance === 'brightness');
      expect(state?.reported?.historical).toBe(true);
      expect(state?.verification).toBe('unverified');
    });

    it('records when a device was last seen online and keeps it through offline reports', async () => {
      const { full } = await discover();
      const online = (await client.post(`/api/v1/devices/${full.id}/refresh`)).json() as { device: DeviceDto };
      const seen = online.device.lastOnlineAt;
      expect(seen).toBeTruthy();
      h.mock.online.set(full.goveeDeviceId, false);
      h.clock.advance(60_000);
      const offline = (await client.post(`/api/v1/devices/${full.id}/refresh`)).json() as { device: DeviceDto };
      expect(offline.device.lastOnlineAt).toBe(seen);
      expect(offline.device.lastStatusRefreshAt).not.toBe(seen);
    });

    it('marks old data as stale', async () => {
      const { full } = await discover();
      await client.post(`/api/v1/devices/${full.id}/refresh`);
      h.clock.advance(301_000);
      const list = (await client.get('/api/v1/devices')).json() as { devices: DeviceDto[] };
      expect(list.devices.find((d) => d.id === full.id)?.freshness).toBe('stale');
    });

    it('serves a repeated refresh from cache rather than calling Govee again', async () => {
      const { full } = await discover();
      await client.post(`/api/v1/devices/${full.id}/refresh`);
      const before = h.mock.requests.length;
      const second = (await client.post(`/api/v1/devices/${full.id}/refresh`)).json() as { throttled: boolean };
      expect(second.throttled).toBe(true);
      expect(h.mock.requests.length).toBe(before);
    });

    it('refreshes only devices that are due', async () => {
      const { full, basic } = await discover();
      await client.post(`/api/v1/devices/${full.id}/refresh`);
      h.clock.advance(30_000); // Poll interval defaults to 60 s.
      const before = h.mock.requests.length;
      await client.post('/api/v1/devices/refresh-due');
      const stateCalls = h.mock.requests.slice(before).map((r) => (r.body as { payload: { device: string } }).payload.device);
      expect(stateCalls).toEqual([basic.goveeDeviceId]);
    });

    it('records a refresh failure on the device, keeping the last good data', async () => {
      const { full } = await discover();
      await client.post(`/api/v1/devices/${full.id}/refresh`);
      h.clock.advance(10_000);
      h.mock.intercept = (_r, res) => {
        res.writeHead(500);
        res.end();
        return true;
      };
      expect((await client.post(`/api/v1/devices/${full.id}/refresh`)).statusCode).toBe(502);
      const device = (await client.get(`/api/v1/devices/${full.id}`)).json() as DeviceDetailDto;
      expect(device.lastStatusError?.category).toBe('server_error');
      expect(device.lastStatusRefreshAt).toBeTruthy();
    });

    it('clears other colour modes when one is accepted, avoiding false mismatches', async () => {
      const { full } = await discover();
      await client.post(`/api/v1/devices/${full.id}/color-temperature`, { kelvin: 3000 });
      await client.post(`/api/v1/devices/${full.id}/color`, { hex: '#ff0000' });
      const device = (await client.get(`/api/v1/devices/${full.id}`)).json() as DeviceDetailDto;
      expect(device.states.find((s) => s.instance === 'colorTemperatureK')?.accepted).toBeNull();
      expect(device.states.find((s) => s.instance === 'colorRgb')?.accepted?.value).toBe(16711680);
    });
  });

  describe('segments', () => {
    it('sends segment commands in the documented shape, in order, and reports each', async () => {
      const { full } = await discover();
      const response = await client.post(`/api/v1/devices/${full.id}/segments`, {
        operations: [
          { segments: [0, 1, 2], hex: '#ff0000' },
          { segments: [3, 4], hex: '#00ff00', brightness: 40 },
        ],
      });
      expect(response.statusCode).toBe(200);
      const run = response.json() as RunResultDto;
      expect(run.status).toBe('all_accepted');
      expect(run.outcomes).toHaveLength(3);
      expect(h.mock.controlRequests().map((c) => c.capability)).toEqual([
        { type: 'devices.capabilities.segment_color_setting', instance: 'segmentedColorRgb', value: { segment: [0, 1, 2], rgb: 16711680 } },
        { type: 'devices.capabilities.segment_color_setting', instance: 'segmentedColorRgb', value: { segment: [3, 4], rgb: 65280 } },
        { type: 'devices.capabilities.segment_color_setting', instance: 'segmentedBrightness', value: { segment: [3, 4], brightness: 40 } },
      ]);
    });

    it('rejects a segment index the device does not report', async () => {
      const { full } = await discover();
      const response = await client.post(`/api/v1/devices/${full.id}/segments`, {
        operations: [{ segments: [0, 99], hex: '#ff0000' }],
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('invalid_segment');
      expect(response.json().error.message).toContain('99');
      expect(h.mock.controlRequests()).toHaveLength(0);
    });

    it('rejects duplicate segments, and segment brightness out of range', async () => {
      const { full } = await discover();
      const dup = await client.post(`/api/v1/devices/${full.id}/segments`, { operations: [{ segments: [1, 1], hex: '#ff0000' }] });
      expect(dup.json().error.code).toBe('invalid_segment');
      const range = await client.post(`/api/v1/devices/${full.id}/segments`, { operations: [{ segments: [1], brightness: 500 }] });
      expect(range.json().error.code).toBe('value_out_of_range');
    });

    it('explains when the device does not expose segments', async () => {
      const { basic } = await discover();
      const response = await client.post(`/api/v1/devices/${basic.id}/segments`, {
        operations: [{ segments: [0], hex: '#ff0000' }],
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('unsupported_capability');
    });

    it('reports partial failure and does not continue past a failed step', async () => {
      const { full } = await discover();
      let controls = 0;
      h.mock.intercept = (request, res) => {
        if (!request.path.endsWith('/control')) return false;
        controls += 1;
        if (controls === 2) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ code: 400, msg: 'Invalid parameter format' }));
        } else {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ code: 200, msg: 'success' }));
        }
        return true;
      };
      const response = await client.post(`/api/v1/devices/${full.id}/segments`, {
        operations: [
          { segments: [0], hex: '#ff0000' },
          { segments: [1], hex: '#00ff00' },
          { segments: [2], hex: '#0000ff' },
        ],
      });
      const run = response.json() as RunResultDto;
      expect(run.status).toBe('partial');
      expect(run.outcomes.map((o) => o.status)).toEqual(['accepted', 'rejected', 'skipped']);
      expect(run.outcomes[2]?.reason).toContain('earlier action');
    });
  });

  describe('scenes', () => {
    it('lists scenes from the device list after discovery, with separate kinds', async () => {
      const { full } = await discover();
      const scenes = (await client.get(`/api/v1/devices/${full.id}/scenes`)).json() as ScenesDto;
      expect(scenes.supported).toBe(true);
      expect(scenes.scenes.map((s) => s.key).sort()).toEqual(['diy-8216567', 'static-3054', 'static-3095']);
    });

    it('merges the documented dynamic and DIY endpoints on refresh', async () => {
      const { full } = await discover();
      const scenes = (await client.post(`/api/v1/devices/${full.id}/scenes/refresh`)).json() as ScenesDto;
      expect(scenes.fetchedAt).toBeTruthy();
      expect(scenes.lastRefreshErrors).toEqual([]);
      const byKind = Object.fromEntries(scenes.scenes.map((s) => [s.key, s.kind]));
      expect(byKind).toMatchObject({
        'dynamic-4280-3853': 'dynamic',
        'diy-8216931': 'diy',
        'static-3054': 'static',
      });
    });

    it('activates a dynamic scene with the documented {paramId, id} value', async () => {
      const { full } = await discover();
      await client.post(`/api/v1/devices/${full.id}/scenes/refresh`);
      const response = await client.post(`/api/v1/devices/${full.id}/scenes/dynamic-4280-3853/apply`);
      expect(command(response.body)).toMatchObject({ status: 'accepted', verification: 'unverified' });
      expect(command(response.body).summary).toContain('Sunrise');
      expect(h.mock.controlRequests()[0]?.capability).toEqual({
        type: 'devices.capabilities.dynamic_scene',
        instance: 'lightScene',
        value: { paramId: 4280, id: 3853 },
      });
    });

    it('activates a DIY scene using the type the device list reported', async () => {
      const { full } = await discover();
      await client.post(`/api/v1/devices/${full.id}/scenes/refresh`);
      await client.post(`/api/v1/devices/${full.id}/scenes/diy-8216931/apply`);
      expect(h.mock.controlRequests()[0]?.capability).toEqual({
        type: 'devices.capabilities.dynamic_scene',
        instance: 'diyScene',
        value: 8216931,
      });
    });

    it('rejects an unknown scene, with nothing sent', async () => {
      const { full } = await discover();
      const response = await client.post(`/api/v1/devices/${full.id}/scenes/dynamic-1-2/apply`);
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('scene_not_found');
      expect(h.mock.controlRequests()).toHaveLength(0);
    });

    it('reports scenes as unsupported on a device without them, and does not call Govee', async () => {
      const { basic } = await discover();
      const scenes = (await client.get(`/api/v1/devices/${basic.id}/scenes`)).json() as ScenesDto;
      expect(scenes).toMatchObject({ supported: false, scenes: [] });
      const before = h.mock.requests.length;
      const refresh = await client.post(`/api/v1/devices/${basic.id}/scenes/refresh`);
      expect(refresh.statusCode).toBe(422);
      expect(h.mock.requests.length).toBe(before);
      const apply = await client.post(`/api/v1/devices/${basic.id}/scenes/static-1/apply`);
      expect(apply.json().error.code).toBe('unsupported_capability');
    });

    it('keeps cached scenes when one source fails, and reports which', async () => {
      const { full } = await discover();
      await client.post(`/api/v1/devices/${full.id}/scenes/refresh`);
      h.clock.advance(10_000);
      h.mock.intercept = (request, res) => {
        if (!request.path.endsWith('/diy-scenes')) return false;
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code: 404, message: 'nope' }));
        return true;
      };
      const scenes = (await client.post(`/api/v1/devices/${full.id}/scenes/refresh`)).json() as ScenesDto;
      expect(scenes.lastRefreshErrors).toMatchObject([{ source: 'diy', category: 'not_found' }]);
      expect(scenes.scenes.some((s) => s.key === 'diy-8216931')).toBe(true);
    });
  });

  describe('builder rules', () => {
    it('enforces a step other than 1', async () => {
      h.mock.devices = [
        {
          sku: 'H0001',
          device: 'XX',
          capabilities: [
            {
              type: 'devices.capabilities.color_setting',
              instance: 'colorTemperatureK',
              parameters: { dataType: 'INTEGER', range: { min: 2700, max: 6500, precision: 100 } },
            },
          ],
        },
      ];
      const list = ((await client.post('/api/v1/devices/discover')).json() as DiscoveryResultDto).devices;
      const record = h.ctx.devices.getRecord(list[0]!.id);
      const good = buildCommand(record, { type: 'colorTemperature', kelvin: 2800 }, h.ctx.scenes);
      const bad = buildCommand(record, { type: 'colorTemperature', kelvin: 2750 }, h.ctx.scenes);
      expect(good.ok).toBe(true);
      expect(bad).toMatchObject({ ok: false, code: 'value_out_of_range' });
    });
  });
});

describe('presets and groups', () => {
  let h: Harness;
  let client: Client;
  let full: DeviceDto;
  let basic: DeviceDto;

  beforeEach(async () => {
    h = await createHarness();
    h.mock.devices = [mockFullDevice(), mockBasicDevice()];
    client = await authedClient(h.app);
    const result = (await client.post('/api/v1/devices/discover')).json() as DiscoveryResultDto;
    full = result.devices.find((d) => d.sku === 'H805C')!;
    basic = result.devices.find((d) => d.sku === 'H6001')!;
  });
  afterEach(() => h.close());

  describe('presets', () => {
    const everydayWarm = () => ({
      name: 'Everyday Warm',
      description: 'Warm white',
      actions: [
        { deviceId: null, action: { type: 'power', on: true } },
        { deviceId: null, action: { type: 'brightness', value: 60 } },
        { deviceId: null, action: { type: 'colorTemperature', kelvin: 2700 } },
      ],
    });

    it('creates, reads, edits, renames, duplicates and deletes', async () => {
      const created = await client.post('/api/v1/presets', everydayWarm());
      expect(created.statusCode).toBe(201);
      const preset = created.json();
      expect(preset.actions.map((a: { order: number }) => a.order)).toEqual([0, 1, 2]);
      expect(preset.needsTarget).toBe(true);

      const renamed = await client.patch(`/api/v1/presets/${preset.id}`, { name: 'Warm' });
      expect(renamed.json().name).toBe('Warm');
      expect(renamed.json().actions).toHaveLength(3);
      expect(renamed.json().description).toBe('Warm white'); // A rename must not clear this.

      const edited = await client.patch(`/api/v1/presets/${preset.id}`, {
        actions: [{ deviceId: null, action: { type: 'power', on: false } }],
      });
      expect(edited.json().actions).toHaveLength(1);

      const copy = (await client.post(`/api/v1/presets/${preset.id}/duplicate`)).json();
      expect(copy.name).toBe('Warm copy');
      const copy2 = (await client.post(`/api/v1/presets/${preset.id}/duplicate`)).json();
      expect(copy2.name).toBe('Warm copy 2');

      expect((await client.delete(`/api/v1/presets/${preset.id}`)).statusCode).toBe(204);
      expect((await client.get(`/api/v1/presets/${preset.id}`)).statusCode).toBe(404);
      expect(h.ctx.db.prepare('SELECT COUNT(*) AS n FROM preset_actions WHERE preset_id = ?').get(preset.id)).toEqual({ n: 0 });
    });

    it('rejects duplicate names and an empty preset', async () => {
      await client.post('/api/v1/presets', everydayWarm());
      expect((await client.post('/api/v1/presets', everydayWarm())).statusCode).toBe(409);
      const empty = await client.post('/api/v1/presets', { name: 'Empty', actions: [] });
      expect(empty.statusCode).toBe(400);
      expect(empty.json().error.message).toContain('at least one action');
    });

    it('validates device-bound actions against that device when saving', async () => {
      const response = await client.post('/api/v1/presets', {
        name: 'Bad',
        actions: [
          { deviceId: basic.id, action: { type: 'power', on: true } },
          { deviceId: basic.id, action: { type: 'color', hex: '#ff0000' } },
        ],
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.message).toContain('Action 2');
      expect(response.json().error.message).toContain('does not report RGB colour');
    });

    it('needs a target for device-independent actions', async () => {
      const preset = (await client.post('/api/v1/presets', everydayWarm())).json();
      const response = await client.post(`/api/v1/presets/${preset.id}/apply`, {});
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('target_required');
    });

    it('runs actions in order on one device', async () => {
      const preset = (await client.post('/api/v1/presets', everydayWarm())).json();
      const run = (
        await client.post(`/api/v1/presets/${preset.id}/apply`, { target: { type: 'device', deviceId: full.id } })
      ).json() as RunResultDto;
      expect(run.status).toBe('all_accepted');
      expect(h.mock.controlRequests().map((c) => c.capability.instance)).toEqual([
        'powerSwitch',
        'brightness',
        'colorTemperatureK',
      ]);
    });

    it('applies to a group with per-device results, skipping what a device cannot do', async () => {
      const group = (await client.post('/api/v1/groups', { name: 'All', deviceIds: [full.id, basic.id] })).json();
      const preset = (await client.post('/api/v1/presets', everydayWarm())).json();
      const run = (
        await client.post(`/api/v1/presets/${preset.id}/apply`, { target: { type: 'group', groupId: group.id } })
      ).json() as RunResultDto;
      expect(run.status).toBe('partial');
      const basicOutcomes = run.outcomes.filter((o) => o.deviceId === basic.id);
      expect(basicOutcomes.map((o) => o.status)).toEqual(['accepted', 'accepted', 'skipped']);
      expect(basicOutcomes[2]?.reason).toContain('colour temperature');
      expect(run.outcomes.filter((o) => o.deviceId === full.id).every((o) => o.status === 'accepted')).toBe(true);
    });

    it('stops a device after a failed step, while other devices continue', async () => {
      const group = (await client.post('/api/v1/groups', { name: 'All', deviceIds: [full.id, basic.id] })).json();
      const preset = (await client.post('/api/v1/presets', everydayWarm())).json();
      h.mock.intercept = (request, res) => {
        if (!request.path.endsWith('/control')) return false;
        const payload = (request.body as { payload: { device: string } }).payload;
        if (payload.device !== full.goveeDeviceId) return false;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code: 400, msg: 'Invalid parameter format' }));
        return true;
      };
      const run = (
        await client.post(`/api/v1/presets/${preset.id}/apply`, { target: { type: 'group', groupId: group.id } })
      ).json() as RunResultDto;
      expect(run.status).toBe('partial');
      expect(run.outcomes.filter((o) => o.deviceId === full.id).map((o) => o.status)).toEqual(['rejected', 'skipped', 'skipped']);
      expect(run.outcomes.filter((o) => o.deviceId === basic.id).map((o) => o.status)).toEqual(['accepted', 'accepted', 'skipped']);
    });

    it('revalidates at execution, since capabilities may have changed since saving', async () => {
      const preset = (
        await client.post('/api/v1/presets', {
          name: 'Bound',
          actions: [{ deviceId: full.id, action: { type: 'colorTemperature', kelvin: 8000 } }],
        })
      ).json();
      const device = mockFullDevice();
      device.capabilities = device.capabilities.filter((c) => (c as { instance: string }).instance !== 'colorTemperatureK');
      h.mock.devices = [device, mockBasicDevice()];
      await client.post('/api/v1/devices/discover');

      const run = (await client.post(`/api/v1/presets/${preset.id}/apply`, {})).json() as RunResultDto;
      expect(run.status).toBe('skipped');
      expect(run.outcomes[0]?.reason).toContain('does not report colour temperature');
      expect(h.mock.controlRequests()).toHaveLength(0);
    });

    it('skips a bound action when the chosen target excludes its device', async () => {
      const preset = (
        await client.post('/api/v1/presets', {
          name: 'Bound',
          actions: [{ deviceId: full.id, action: { type: 'power', on: true } }],
        })
      ).json();
      const run = (
        await client.post(`/api/v1/presets/${preset.id}/apply`, { target: { type: 'device', deviceId: basic.id } })
      ).json() as RunResultDto;
      expect(run.outcomes[0]).toMatchObject({ status: 'skipped' });
      expect(run.outcomes[0]?.reason).toContain('outside the chosen target');
    });

    it('keeps a preset scene bound to a device, and resolves its value on the server', async () => {
      await client.post(`/api/v1/devices/${full.id}/scenes/refresh`);
      const preset = (
        await client.post('/api/v1/presets', {
          name: 'Sunrise',
          actions: [{ deviceId: full.id, action: { type: 'scene', sceneKey: 'dynamic-4280-3853', sceneName: 'Sunrise' } }],
        })
      ).json();
      await client.post(`/api/v1/presets/${preset.id}/apply`, {});
      expect(h.mock.controlRequests()[0]?.capability.value).toEqual({ paramId: 4280, id: 3853 });
    });

    it('stores an execution history', async () => {
      const preset = (await client.post('/api/v1/presets', everydayWarm())).json();
      await client.post(`/api/v1/presets/${preset.id}/apply`, { target: { type: 'device', deviceId: full.id } });
      const runs = h.ctx.db.prepare('SELECT * FROM execution_runs WHERE source_id = ?').all(preset.id) as { status: string; outcomes_json: string }[];
      expect(runs).toHaveLength(1);
      expect(runs[0]?.status).toBe('all_accepted');
      expect(JSON.parse(runs[0]!.outcomes_json)).toHaveLength(3);
      const events = h.ctx.activity.list({ eventType: 'preset', limit: 5 }).events;
      expect(events[0]?.message).toContain('3 of 3 action(s) accepted');
    });
  });

  describe('groups', () => {
    it('creates, renames, changes members and deletes', async () => {
      const group = (await client.post('/api/v1/groups', { name: 'Front of House', deviceIds: [full.id] })).json();
      expect(group.deviceIds).toEqual([full.id]);
      const renamed = (await client.patch(`/api/v1/groups/${group.id}`, { name: 'Front' })).json();
      expect(renamed).toMatchObject({ name: 'Front', deviceIds: [full.id] });
      const members = (await client.patch(`/api/v1/groups/${group.id}`, { deviceIds: [basic.id] })).json();
      expect(members.deviceIds).toEqual([basic.id]);
      expect((await client.delete(`/api/v1/groups/${group.id}`)).statusCode).toBe(204);
      expect((await client.get('/api/v1/groups')).json().groups).toEqual([]);
    });

    it('rejects unknown devices and duplicate names', async () => {
      const unknown = await client.post('/api/v1/groups', { name: 'G', deviceIds: ['nope'] });
      expect(unknown.statusCode).toBe(422);
      await client.post('/api/v1/groups', { name: 'G' });
      expect((await client.post('/api/v1/groups', { name: 'g' })).statusCode).toBe(409);
    });

    it('checks each device independently and reports per device', async () => {
      const group = (await client.post('/api/v1/groups', { name: 'All', deviceIds: [full.id, basic.id] })).json();
      const run = (
        await client.post(`/api/v1/groups/${group.id}/apply`, { action: { type: 'color', hex: '#ff8800' } })
      ).json() as RunResultDto;
      expect(run.status).toBe('partial');
      const byDevice = Object.fromEntries(run.outcomes.map((o) => [o.deviceId, o.status]));
      expect(byDevice).toEqual({ [full.id]: 'accepted', [basic.id]: 'skipped' });
      expect(h.mock.controlRequests()).toHaveLength(1);
    });

    it('reports one device failing while the other is accepted', async () => {
      const group = (await client.post('/api/v1/groups', { name: 'All', deviceIds: [full.id, basic.id] })).json();
      h.mock.intercept = (request, res) => {
        if (!request.path.endsWith('/control')) return false;
        if ((request.body as { payload: { device: string } }).payload.device !== basic.goveeDeviceId) return false;
        res.writeHead(500);
        res.end();
        return true;
      };
      const run = (
        await client.post(`/api/v1/groups/${group.id}/apply`, { action: { type: 'power', on: true } })
      ).json() as RunResultDto;
      expect(run.status).toBe('partial');
      expect(run.outcomes.find((o) => o.deviceId === basic.id)).toMatchObject({ status: 'failed', errorCategory: 'server_error' });
      expect(run.outcomes.find((o) => o.deviceId === full.id)).toMatchObject({ status: 'accepted' });
    });

    it('treats an empty group as skipped, not as success', async () => {
      const group = (await client.post('/api/v1/groups', { name: 'Empty' })).json();
      const run = (await client.post(`/api/v1/groups/${group.id}/apply`, { action: { type: 'power', on: true } })).json();
      expect(run.status).toBe('skipped');
    });
  });
});

describe('activity and diagnostics', () => {
  let h: Harness;
  let client: Client;

  beforeEach(async () => {
    h = await createHarness();
    h.mock.devices = [mockFullDevice()];
    client = await authedClient(h.app);
  });
  afterEach(() => h.close());

  it('filters activity by device, type, outcome and date', async () => {
    const { devices } = (await client.post('/api/v1/devices/discover')).json() as DiscoveryResultDto;
    const device = devices[0]!;
    await client.post(`/api/v1/devices/${device.id}/power`, { on: true });
    h.mock.intercept = (_r, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 400, msg: 'no' }));
      return true;
    };
    await client.post(`/api/v1/devices/${device.id}/power`, { on: false });

    const q = async (query: string) => (await client.get(`/api/v1/activity?${query}`)).json().events as { eventType: string; outcome: string; deviceId: string; deviceName: string }[];
    const forDevice = await q(`deviceId=${device.id}`);
    expect(forDevice.length).toBe(2);
    expect(forDevice[0]?.deviceName).toBe(device.name);
    expect((await q('eventType=discovery')).every((e) => e.eventType === 'discovery')).toBe(true);
    const failures = await q('eventType=command&outcome=failure');
    expect(failures).toHaveLength(1);
    expect(await q('from=2030-01-01T00:00:00Z')).toEqual([]);
    expect((await q('to=2030-01-01T00:00:00Z')).length).toBeGreaterThan(0);
    expect((await client.get('/api/v1/activity?eventType=bogus')).statusCode).toBe(400);
  });

  it('pages through activity', async () => {
    for (let i = 0; i < 5; i++) h.ctx.activity.record({ eventType: 'system', outcome: 'info', message: `m${i}` });
    const first = (await client.get('/api/v1/activity?eventType=system&limit=2')).json();
    expect(first.events).toHaveLength(2);
    const second = (await client.get(`/api/v1/activity?eventType=system&limit=10&beforeId=${first.nextBeforeId}`)).json();
    expect(second.events).toHaveLength(3);
    expect(second.nextBeforeId).toBeNull();
  });

  it('diagnostics report configuration without revealing the key', async () => {
    await client.post('/api/v1/devices/discover');
    const status = (await client.get('/api/v1/system/status')).json();
    expect(status).toMatchObject({
      backend: 'ok',
      database: { status: 'ok', schemaVersion: '005_ai.sql' },
      govee: { keyConfigured: true, usingLocalTestEndpoint: true },
      devices: { discovered: 1, noLongerDiscovered: 0 },
      queue: { pending: 0, pausedUntil: null },
    });
    expect(status.govee.lastSuccessfulConnectionAt).toBeTruthy();
    expect(status.version).toBeTruthy();
    expect(status.scheduler.status).toBe('stopped');
  });

  it('records the last error category', async () => {
    h.mock.intercept = (_r, res) => {
      res.writeHead(401);
      res.end();
      return true;
    };
    await client.post('/api/v1/devices/discover');
    const status = (await client.get('/api/v1/system/status')).json();
    expect(status.govee.lastErrorCategory).toBe('auth');
  });

  it('settings persist, reject invalid values, and survive a reload from the database', async () => {
    const updated = (await client.patch('/api/v1/settings', { statusPollSeconds: 120, defaultTimeZone: 'Asia/Tokyo' })).json();
    expect(updated).toMatchObject({ statusPollSeconds: 120, defaultTimeZone: 'Asia/Tokyo' });
    expect((await client.patch('/api/v1/settings', { statusPollSeconds: 1 })).statusCode).toBe(400);
    expect((await client.patch('/api/v1/settings', { defaultTimeZone: 'Nowhere/Land' })).statusCode).toBe(400);
    expect((await client.get('/api/v1/settings')).json().statusPollSeconds).toBe(120);
  });

  it('health is public, has no secrets, and reports the database', async () => {
    const response = await h.app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', database: 'ok' });
    expect(Object.keys(response.json()).sort()).toEqual(['database', 'scheduler', 'status', 'version']);
  });

  it('prunes old history but keeps recent history', async () => {
    h.ctx.activity.record({ eventType: 'system', outcome: 'info', message: 'old' });
    h.clock.advance(91 * 24 * 3600 * 1000);
    h.ctx.activity.record({ eventType: 'system', outcome: 'info', message: 'new' });
    h.ctx.maintenance.prune();
    const events = h.ctx.activity.list({ eventType: 'system', limit: 10 }).events;
    expect(events.map((e) => e.message)).toEqual(['new']);
  });
});

describe('migrations', () => {
  it('applies once, enables foreign keys, and detects a changed migration', async () => {
    const h = await createHarness();
    try {
      expect(h.ctx.db.pragma('foreign_keys', { simple: true })).toBe(1);
      const { runMigrations } = await import('../src/database/database.js');
      const again = runMigrations(h.ctx.db, h.ctx.config.migrationsDir);
      expect(again.applied).toEqual([]);

      h.ctx.db.prepare(`UPDATE schema_migrations SET checksum = 'tampered'`).run();
      expect(() => runMigrations(h.ctx.db, h.ctx.config.migrationsDir)).toThrow(/changed after it was applied/);
    } finally {
      await h.close();
    }
  });

  it('enforces foreign keys', async () => {
    const h = await createHarness();
    try {
      expect(() =>
        h.ctx.db.prepare(`INSERT INTO group_devices (group_id, device_id) VALUES ('no', 'no')`).run(),
      ).toThrow(/FOREIGN KEY/);
    } finally {
      await h.close();
    }
  });
});
