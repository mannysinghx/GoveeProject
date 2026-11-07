import { afterEach, describe, expect, it } from 'vitest';
import { FESTIVAL_PRESETS, FIREWORKS_PRESET, recurrenceSchema, type DiscoveryResultDto, type PresetDto, type ScheduleDto } from '@glm/shared';
import { nextOccurrence, occurrenceOnDate } from '../src/scheduler/occurrences.js';
import { authedClient, createHarness, type Harness } from './support/harness.js';
import { mockFullDevice } from './support/mock-govee.js';

const harnesses: Harness[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.close();
});

/** Real H805C lights report 27 segments and these scene names. The ids are invented. */
const string27 = (name: string, suffix: string) => {
  const device = JSON.parse(JSON.stringify(mockFullDevice()).replaceAll('"max":14', '"max":26').replaceAll('"max":15', '"max":27')) as ReturnType<typeof mockFullDevice>;
  return { ...device, deviceName: name, device: `AA:BB:CC:DD:EE:FF:00:${suffix}` };
};
const LEFT = string27('Outdoor Left', '11');
const CENTER = string27('Outdoor Center', '12');
const RIGHT = string27('Outdoor Right', '13');
const GROUP = {
  sku: 'SameModeGroup',
  device: 'group-1',
  deviceName: 'Christmas',
  capabilities: mockFullDevice().capabilities.filter((c) => (c as { instance: string }).instance === 'powerSwitch'),
};
const REAL_SCENES = ['Fireworks', 'New Years', 'Thanksgiving', 'Christmas Eve', 'Winter Wonderland', 'Fall'].map((name, i) => ({
  name,
  value: { paramId: 5000 + i, id: 6000 + i },
}));
const LA = 'America/Los_Angeles';

async function house(scenes: unknown[] = REAL_SCENES) {
  const h = await createHarness();
  harnesses.push(h);
  h.mock.devices = [RIGHT, GROUP, CENTER, LEFT];
  h.mock.dynamicScenes = scenes;
  const client = await authedClient(h.app);
  await client.patch('/api/v1/settings', { defaultTimeZone: LA });
  const { devices } = (await client.post('/api/v1/devices/discover')).json() as DiscoveryResultDto;
  const id = (name: string) => devices.find((d) => d.name === name)?.id as string;
  await h.ctx.builtins.sync();
  return { h, client, left: id('Outdoor Left'), center: id('Outdoor Center'), right: id('Outdoor Right') };
}

const presets = (h: Harness): PresetDto[] => h.ctx.presets.list();
const builtin = (h: Harness, key: string) => presets(h).find((p) => p.builtin?.key === key) as PresetDto;
const schedules = (h: Harness): ScheduleDto[] => h.ctx.schedules.list();

async function runSchedulerAt(h: Harness, iso: string) {
  h.clock.advance(Date.parse(iso) - h.clock.nowMs());
  await h.ctx.scheduler.tick();
  await h.ctx.scheduler.idle();
}

describe('the built-in presets', () => {
  it('adds 20 festival presets and the fireworks show, for every string and not the Govee group', async () => {
    const { h, left, center, right } = await house();
    const all = presets(h).filter((p) => p.builtin);
    expect(FESTIVAL_PRESETS).toHaveLength(20);
    expect(all).toHaveLength(21);
    for (const preset of all) {
      expect(preset.needsTarget).toBe(false);
      expect(new Set(preset.actions.map((a) => a.deviceId))).toEqual(new Set([left, center, right]));
    }
  });

  it('colors every segment of every string exactly once', async () => {
    const { h, left } = await house();
    const preset = builtin(h, 'christmas-classic');
    const segments = preset.actions
      .filter((a) => a.deviceId === left)
      .flatMap((a) => (a.action.type === 'segmentColor' ? a.action.segments : []));
    expect([...segments].sort((a, b) => a - b)).toEqual(Array.from({ length: 27 }, (_, i) => i));
  });

  it('carries a pattern on from one string to the next, in the arranged order', async () => {
    const { h, left, center } = await house();
    const preset = builtin(h, 'christmas-classic'); // Three red, then three green, repeating.
    const colorOf = (deviceId: string, segment: number) =>
      preset.actions.flatMap((a) => (a.deviceId === deviceId && a.action.type === 'segmentColor' && a.action.segments.includes(segment) ? [a.action.hex] : []))[0];
    expect(colorOf(left, 0)).toBe('#ff0000');
    expect(colorOf(left, 26)).toBe('#ff0000'); // Position 26 is 2 of 6: still in the red band.
    expect(colorOf(center, 0)).toBe('#00c000'); // Position 27 is 3 of 6: green, not a fresh start in red.
  });

  it('uses few commands, since each color is one command per string', async () => {
    const { h } = await house();
    expect(builtin(h, 'christmas-classic').actions).toHaveLength(9); // Power and 2 colors, on 3 strings.
  });

  it('uses the real moving effect where a light offers it', async () => {
    const { h } = await house();
    const steps = builtin(h, 'thanksgiving-effect').actions.map((a) => a.action);
    expect(steps.filter((a) => a.type === 'scene')).toHaveLength(3);
    expect(steps.some((a) => a.type === 'segmentColor')).toBe(false);
  });

  it('falls back to fixed colors when a light does not offer the effect, and upgrades later', async () => {
    const { h, left } = await house([{ name: 'Sunrise', value: { paramId: 1, id: 2 } }]);
    const fireworks = builtin(h, FIREWORKS_PRESET.key);
    expect(fireworks.actions.some((a) => a.action.type === 'scene')).toBe(false);
    expect(fireworks.actions.some((a) => a.action.type === 'segmentColor')).toBe(true);

    h.mock.dynamicScenes = REAL_SCENES;
    await h.ctx.devices.refreshScenes(left);
    await h.ctx.builtins.sync();
    expect(builtin(h, FIREWORKS_PRESET.key).actions.filter((a) => a.deviceId === left).map((a) => a.action.type)).toEqual(['power', 'brightness', 'scene']);
  });

  it('every preset is accepted by the API when applied', async () => {
    const { h } = await house();
    for (const preset of presets(h).filter((p) => p.builtin)) {
      h.clock.advance(60_000);
      const run = await h.ctx.presets.apply(preset.id, undefined);
      expect(run.status, preset.name).toBe('all_accepted');
    }
  });

  it('cannot be edited or deleted, but a duplicate is the owner’s to change', async () => {
    const { h, client } = await house();
    const preset = builtin(h, 'veterans-salute');
    const edit = await client.patch(`/api/v1/presets/${preset.id}`, { name: 'Mine' });
    expect(edit.statusCode).toBe(409);
    expect(edit.json().error.message).toContain('Duplicate it');
    expect((await client.delete(`/api/v1/presets/${preset.id}`)).statusCode).toBe(409);

    const copy = (await client.post(`/api/v1/presets/${preset.id}/duplicate`)).json() as PresetDto;
    expect(copy.builtin).toBeNull();
    expect((await client.patch(`/api/v1/presets/${copy.id}`, { name: 'Mine' })).statusCode).toBe(200);
    expect((await client.delete(`/api/v1/presets/${copy.id}`)).statusCode).toBeLessThan(300);
  });

  it('changes nothing when run again, and fetches scenes only once', async () => {
    const { h } = await house();
    const before = JSON.stringify(presets(h));
    const scenes = () => h.mock.requests.filter((r) => r.path.endsWith('/device/scenes')).length;
    const count = scenes();
    h.clock.advance(60_000);
    await h.ctx.builtins.sync();
    expect(JSON.stringify(presets(h))).toBe(before);
    expect(scenes()).toBe(count);
  });

  it('keeps an owner’s preset that has the same name', async () => {
    const h = await createHarness();
    harnesses.push(h);
    h.mock.devices = [LEFT];
    const client = await authedClient(h.app);
    await client.post('/api/v1/devices/discover');
    h.ctx.presets.create({ name: FESTIVAL_PRESETS[0]!.name, description: '', actions: [{ deviceId: null, action: { type: 'power', on: true } }] });
    await h.ctx.builtins.sync();
    const names = presets(h).filter((p) => p.name.startsWith(FESTIVAL_PRESETS[0]!.name));
    expect(names).toHaveLength(2);
    expect(names.find((p) => p.builtin)?.name).toContain('(built-in)');
    expect(names.find((p) => !p.builtin)?.actions).toHaveLength(1);
  });

  it('follows the owner’s arrangement and any light added later', async () => {
    const { h, client, left, right } = await house();
    await client.patch('/api/v1/settings', {
      patternStrings: [
        { deviceId: right, included: true, reversed: true },
        { deviceId: left, included: true, reversed: false },
      ],
    });
    await h.ctx.builtins.sync();
    const preset = builtin(h, 'christmas-classic');
    expect(preset.actions[0]?.deviceId).toBe(right);
    const first = preset.actions.find((a) => a.deviceId === right && a.action.type === 'segmentColor');
    expect(first?.action).toMatchObject({ hex: '#ff0000' });
    expect(first?.action.type === 'segmentColor' && first.action.segments).toContain(26); // Flipped: 26 comes first.

    const extra = string27('Garage', '14');
    h.mock.devices = [...h.mock.devices, extra];
    await h.ctx.devices.discover();
    await h.ctx.builtins.sync();
    expect(builtin(h, 'christmas-classic').actions.some((a) => a.deviceName === 'Garage')).toBe(true);
    const group = h.ctx.groups.list().find((g) => g.name === 'All light strings');
    expect(group?.deviceIds).toHaveLength(4);
  });
});

describe('fireworks at midnight on January 1', () => {
  const show = (h: Harness) => schedules(h).find((s) => s.name === FIREWORKS_PRESET.name) as ScheduleDto;

  it('is set up for the next January 1, in the owner’s time zone, with an end time', async () => {
    const { h } = await house();
    expect(show(h)).toMatchObject({ enabled: true, timeZone: LA, missedRunPolicy: 'skip', recurrence: { kind: 'yearly', month: 1, day: 1, time: '00:00' } });
    expect(show(h).nextRun?.at).toBe('2027-01-01T08:00:00.000Z'); // Midnight in Los Angeles.
    const end = schedules(h).find((s) => s.name === `${FIREWORKS_PRESET.name}: end`) as ScheduleDto;
    expect(end.nextRun?.at).toBe('2027-01-01T08:30:00.000Z');
    expect(end.action).toEqual({ type: 'power', on: false });
  });

  it('runs on all strings right at midnight, and not before', async () => {
    const { h } = await house();
    const start = h.mock.controlRequests().length;
    await runSchedulerAt(h, '2027-01-01T07:59:59.000Z');
    expect(h.mock.controlRequests()).toHaveLength(start);
    await runSchedulerAt(h, '2027-01-01T08:00:00.000Z');
    const sent = h.mock.controlRequests().slice(start);
    expect(sent).toHaveLength(9); // Power, brightness and the effect, on 3 strings.
    for (const device of [LEFT, CENTER, RIGHT]) {
      expect(sent.filter((c) => c.device === device.device).map((c) => c.capability.instance)).toEqual(['powerSwitch', 'brightness', 'lightScene']);
    }
    expect(sent.some((c) => c.device === GROUP.device)).toBe(false);
  });

  it('runs once, ends at 12:30, and is ready for the next year', async () => {
    const { h } = await house();
    await runSchedulerAt(h, '2027-01-01T08:00:00.000Z');
    const afterShow = h.mock.controlRequests().length;
    await runSchedulerAt(h, '2027-01-01T08:00:20.000Z');
    expect(h.mock.controlRequests()).toHaveLength(afterShow);
    await runSchedulerAt(h, '2027-01-01T08:30:00.000Z');
    const off = h.mock.controlRequests().slice(afterShow);
    expect(off).toHaveLength(3);
    expect(off.every((c) => c.capability.instance === 'powerSwitch' && c.capability.value === 0)).toBe(true);
    expect(show(h).nextRun?.at).toBe('2028-01-01T08:00:00.000Z');
  });

  it('does not set off fireworks hours late after an outage', async () => {
    const { h } = await house();
    const start = h.mock.controlRequests().filter((c) => c.capability.instance === 'lightScene').length;
    await runSchedulerAt(h, '2027-01-01T11:00:00.000Z');
    expect(h.mock.controlRequests().filter((c) => c.capability.instance === 'lightScene')).toHaveLength(start);
  });

  it('stays deleted if the owner deletes it', async () => {
    const { h, client } = await house();
    expect((await client.delete(`/api/v1/schedules/${show(h).id}`)).statusCode).toBeLessThan(300);
    await h.ctx.builtins.sync();
    expect(show(h)).toBeUndefined();
  });

  it('is not saved to replay later for a light that was offline', async () => {
    const { h } = await house();
    h.mock.intercept = (request, res) => {
      if (!request.path.endsWith('/control')) return false;
      if ((request.body as { payload: { device: string } }).payload.device !== CENTER.device) return false;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 400, msg: 'Device is offline. Please check the Wi-Fi connection.' }));
      return true;
    };
    await runSchedulerAt(h, '2027-01-01T08:00:00.000Z');
    expect(h.ctx.missed.listWaiting()).toEqual([]);
    await runSchedulerAt(h, '2027-01-01T08:30:00.000Z');
    expect(h.ctx.missed.listWaiting()).toEqual([]); // Nor is a late "turn off".
  });

  it('still saves an ordinary pattern for an offline light', async () => {
    const { h } = await house();
    h.mock.intercept = (request, res) => {
      if (!request.path.endsWith('/control')) return false;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 400, msg: 'Device is offline.' }));
      return true;
    };
    await h.ctx.presets.apply(builtin(h, 'christmas-classic').id, undefined);
    expect(h.ctx.missed.listWaiting()).toHaveLength(3);
  });
});

describe('waking at the exact time', () => {
  it('wakes exactly when a run is due before the next regular check', async () => {
    const { h } = await house();
    const midnight = Date.parse('2027-01-01T08:00:00.000Z');
    expect(h.ctx.scheduler.nextWakeDelayMs(midnight - 7_000)).toBe(7_000);
    expect(h.ctx.scheduler.nextWakeDelayMs(midnight - 60_000)).toBeNull(); // A regular check comes first.
    expect(h.ctx.scheduler.nextWakeDelayMs(midnight + 1)).toBeNull(); // Already due: the next check takes it.
  });
});

describe('yearly schedules', () => {
  const yearly = { kind: 'yearly', month: 1, day: 1, time: '00:00' } as const;

  it('occur only on that date, every year', () => {
    expect(occurrenceOnDate(yearly, LA, '2026-12-31')).toBeNull();
    expect(occurrenceOnDate(yearly, LA, '2027-01-02')).toBeNull();
    expect(occurrenceOnDate(yearly, LA, '2027-01-01')?.at.toISO()).toBe('2027-01-01T08:00:00.000Z');
    const next = nextOccurrence(yearly, LA, Date.parse('2027-01-01T08:00:00.000Z'));
    expect(next?.localDate).toBe('2028-01-01');
  });

  it('give each year its own identity, so a past year cannot block the next', () => {
    expect(occurrenceOnDate(yearly, LA, '2027-01-01')?.key).not.toBe(occurrenceOnDate(yearly, LA, '2028-01-01')?.key);
  });

  it('reject dates a month does not have', () => {
    expect(recurrenceSchema.safeParse({ kind: 'yearly', month: 2, day: 28, time: '00:00' }).success).toBe(true);
    expect(recurrenceSchema.safeParse({ kind: 'yearly', month: 2, day: 29, time: '00:00' }).success).toBe(false);
    expect(recurrenceSchema.safeParse({ kind: 'yearly', month: 4, day: 31, time: '00:00' }).success).toBe(false);
    expect(recurrenceSchema.safeParse({ kind: 'yearly', month: 13, day: 1, time: '00:00' }).success).toBe(false);
  });
});
