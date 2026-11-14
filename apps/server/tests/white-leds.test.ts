import { afterEach, describe, expect, it } from 'vitest';
import type { DeviceDetailDto, DiscoveryResultDto, RunResultDto } from '@glm/shared';
import { withBaseCoat } from '../src/commands/action-service.js';
import type { DeviceRecord } from '../src/devices/device-repository.js';
import { authedClient, createHarness, type Harness } from './support/harness.js';
import { mockBasicDevice, mockFullDevice } from './support/mock-govee.js';

const harnesses: Harness[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.close();
});

const SEGMENTS = Array.from({ length: 15 }, (_, i) => i); // The mock reports 15.
const RED = '#ff0000';
const GREEN = '#00ff00';

async function oneString() {
  const h = await createHarness();
  harnesses.push(h);
  h.mock.devices = [mockFullDevice()];
  const client = await authedClient(h.app);
  const { devices } = (await client.post('/api/v1/devices/discover')).json() as DiscoveryResultDto;
  const id = (devices[0] as DeviceDetailDto).id;
  return { h, client, id };
}

const pattern = (deviceId: string, extra: object = {}) => ({
  name: 'Xmas',
  actions: [
    { deviceId, action: { type: 'power', on: true } },
    { deviceId, action: { type: 'segmentColor', hex: GREEN, segments: SEGMENTS.slice(0, 5) } },
    { deviceId, action: { type: 'segmentColor', hex: RED, segments: SEGMENTS.slice(5) } },
  ],
  ...extra,
});
const sent = (h: Harness) => h.mock.controlRequests().map((c) => c.capability);

describe('a pattern on a real string', () => {
  it('sets the whole string to the main color before any segment', async () => {
    const { h, client, id } = await oneString();
    const run = (await client.post('/api/v1/presets/apply-draft', pattern(id))).json() as RunResultDto;
    expect(run.status).toBe('all_accepted');
    expect(sent(h).map((c) => c.instance)).toEqual(['powerSwitch', 'colorRgb', 'segmentedColorRgb', 'segmentedColorRgb']);
    expect(sent(h)[1]?.value).toBe(0xff0000); // Red covers 10 of 15, so it is the main color.
  });

  it('can skip the base color, for testing the segment command itself', async () => {
    const { h, client, id } = await oneString();
    await client.post('/api/v1/presets/apply-draft', pattern(id, { plainSegments: true }));
    expect(sent(h).map((c) => c.instance)).toEqual(['powerSwitch', 'segmentedColorRgb', 'segmentedColorRgb']);
  });

  it('leaves the rest of the string alone when a step names only some segments', async () => {
    const { h, client, id } = await oneString();
    await client.post('/api/v1/presets/apply-draft', {
      name: 'Accent',
      actions: [{ deviceId: id, action: { type: 'segmentColor', hex: RED, segments: [0, 1] } }],
    });
    expect(sent(h).map((c) => c.instance)).toEqual(['segmentedColorRgb']);
  });

  it('applies to patterns saved before this existed, without changing what is stored', async () => {
    const { h, id } = await oneString();
    const preset = h.ctx.presets.create({ name: 'Old', description: '', actions: pattern(id).actions as never });
    await h.ctx.presets.apply(preset.id, undefined);
    expect(sent(h).map((c) => c.instance)).toContain('colorRgb');
    expect(h.ctx.presets.get(preset.id).actions).toHaveLength(3);
  });

  it('spaces commands to one light at least a second apart, with an extra pause after turning on', async () => {
    const { h, client, id } = await oneString();
    const start = h.ctx.clock.nowMs();
    h.clock.sleeps.length = 0;
    await client.post('/api/v1/presets/apply-draft', pattern(id));
    expect(h.clock.sleeps).toContain(1000);
    // Power, a 1 s pause, then 3 commands a second apart.
    expect(h.ctx.clock.nowMs() - start).toBeGreaterThanOrEqual(3000);
  });

  it('does not pause after turning on when nothing follows', async () => {
    const { h, client, id } = await oneString();
    h.clock.sleeps.length = 0;
    await client.post('/api/v1/presets/apply-draft', { name: 'On', actions: [{ deviceId: id, action: { type: 'power', on: true } }] });
    expect(h.clock.sleeps).toEqual([]);
  });

  it('does not pause after turning off', async () => {
    const { h, client, id } = await oneString();
    const start = h.ctx.clock.nowMs();
    await client.post('/api/v1/presets/apply-draft', {
      name: 'Off then brightness',
      actions: [
        { deviceId: id, action: { type: 'power', on: false } },
        { deviceId: id, action: { type: 'brightness', value: 50 } },
      ],
    });
    // Only the one-second spacing between commands, with no settling pause on top.
    expect(h.ctx.clock.nowMs() - start).toBeLessThan(1500);
  });

  it('reports the base color in the results, so nothing is hidden', async () => {
    const { client, id } = await oneString();
    const run = (await client.post('/api/v1/presets/apply-draft', pattern(id))).json() as RunResultDto;
    expect(run.outcomes.map((o) => o.actionType)).toEqual(['power', 'color', 'segmentColor', 'segmentColor']);
  });

  it('never replays a base color twice after a catch-up', async () => {
    const { h, id } = await oneString();
    const device = h.ctx.devices.repository.get(id) as DeviceRecord;
    const once = withBaseCoat({ device, actions: pattern(id).actions.map((a) => a.action) as never });
    const twice = withBaseCoat(once);
    expect(twice.actions.filter((a) => a.type === 'color')).toHaveLength(1);
  });
});

describe('the base color', () => {
  it('skips a light with no whole-string color', async () => {
    const h = await createHarness();
    harnesses.push(h);
    h.mock.devices = [mockBasicDevice()];
    const client = await authedClient(h.app);
    const { devices } = (await client.post('/api/v1/devices/discover')).json() as DiscoveryResultDto;
    const device = h.ctx.devices.repository.get((devices[0] as DeviceDetailDto).id) as DeviceRecord;
    const plan = { device, actions: [{ type: 'segmentColor' as const, hex: RED, segments: [0] }] };
    expect(withBaseCoat(plan)).toBe(plan);
  });

  it('skips a plan with no segment commands, such as a moving effect', async () => {
    const { h, id } = await oneString();
    const device = h.ctx.devices.repository.get(id) as DeviceRecord;
    const plan = { device, actions: [{ type: 'power' as const, on: true }] };
    expect(withBaseCoat(plan)).toBe(plan);
  });

  it('skips a plan that already sets a color first', async () => {
    const { h, id } = await oneString();
    const device = h.ctx.devices.repository.get(id) as DeviceRecord;
    const plan = { device, actions: [{ type: 'color' as const, hex: GREEN }, { type: 'segmentColor' as const, hex: RED, segments: SEGMENTS }] };
    expect(withBaseCoat(plan)).toBe(plan);
  });

  it('goes after turning on and setting brightness, right before the segments', async () => {
    const { h, id } = await oneString();
    const device = h.ctx.devices.repository.get(id) as DeviceRecord;
    const result = withBaseCoat({
      device,
      actions: [
        { type: 'power', on: true },
        { type: 'brightness', value: 50 },
        { type: 'segmentColor', hex: RED, segments: SEGMENTS },
      ],
    });
    expect(result.actions.map((a) => a.type)).toEqual(['power', 'brightness', 'color', 'segmentColor']);
  });
});
