import { afterEach, describe, expect, it } from 'vitest';
import {
  builtinPresetByKey,
  DAILY_SCHEME_PRESET,
  dailySchemeKey,
  type DailySchemeDto,
  type DiscoveryResultDto,
  type PresetDto,
  type RunResultDto,
  type ScheduleDto,
} from '@glm/shared';
import { authedClient, createHarness, type Harness } from './support/harness.js';
import { mockBasicDevice, mockFullDevice } from './support/mock-govee.js';

const harnesses: Harness[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.close();
});

const stringNamed = (name: string, suffix: string) => ({ ...mockFullDevice(), deviceName: name, device: `AA:BB:CC:DD:EE:FF:00:${suffix}` });
const LEFT = stringNamed('Outdoor Left', '11');
const RIGHT = stringNamed('Outdoor Right', '13');
const GROUP = {
  sku: 'SameModeGroup',
  device: 'group-1',
  deviceName: 'Christmas',
  capabilities: mockFullDevice().capabilities.filter((c) => (c as { instance: string }).instance === 'powerSwitch'),
};
const LA = 'America/Los_Angeles';

async function house(startIso = '2026-11-13T20:00:00.000Z') {
  const h = await createHarness();
  harnesses.push(h);
  h.clock.set(startIso);
  h.mock.devices = [LEFT, RIGHT, GROUP];
  const client = await authedClient(h.app);
  await client.patch('/api/v1/settings', { defaultTimeZone: LA });
  const { devices } = (await client.post('/api/v1/devices/discover')).json() as DiscoveryResultDto;
  await h.ctx.builtins.sync();
  const id = (name: string) => devices.find((d) => d.name === name)?.id as string;
  return { h, client, left: id('Outdoor Left'), right: id('Outdoor Right') };
}

const status = async (client: Awaited<ReturnType<typeof authedClient>>) =>
  (await client.get('/api/v1/daily-scheme')).json() as DailySchemeDto;
const schedules = (h: Harness): ScheduleDto[] => h.ctx.schedules.list();
const dailySchedules = (h: Harness, presetId: string | null) =>
  schedules(h).filter((s) => s.action.type === 'preset' && s.action.presetId === presetId);
/** The colors sent to one light, in the order its segments run. */
function sentColors(h: Harness, address: string): Map<number, number> {
  const colors = new Map<number, number>();
  for (const c of h.mock.controlRequests().filter((r) => r.device === address && r.capability.instance === 'segmentedColorRgb')) {
    const value = c.capability.value as { segment: number[]; rgb: number };
    for (const segment of value.segment) colors.set(segment, value.rgb);
  }
  return colors;
}
const rgb = (hex: string) => Number.parseInt(hex.slice(1), 16);

async function runSchedulerAt(h: Harness, iso: string) {
  h.clock.set(iso);
  await h.ctx.scheduler.tick();
  await h.ctx.scheduler.idle();
  await h.ctx.queue.idle();
}

describe("today's color scheme", () => {
  it('says what today and the rest of the season show, by the local date', async () => {
    // 20:00 UTC on 13 November is midday in Los Angeles, still the 13th.
    const { client } = await house();
    const s = await status(client);
    expect(s.timeZone).toBe(LA);
    expect(s.today).toMatchObject({ date: '2026-11-13', key: dailySchemeKey('2026-11-13') });
    expect(s.today.presetId).toBeTruthy();
    expect(s.upcoming[0]?.date).toBe('2026-11-14');
    expect(s.upcoming.at(-1)?.date).toBe('2026-12-31');
    expect(s.upcoming).toHaveLength(17 + 31);
    expect(s.autoChange).toMatchObject({ enabled: false, scheduleId: null, time: '16:05' });
  });

  it('applies the scheme for the day it runs, across the strings in order', async () => {
    const { h, client } = await house();
    const s = await status(client);
    h.mock.requests.length = 0;
    const run = (await client.post(`/api/v1/presets/${s.presetId}/apply`, {})).json() as RunResultDto;
    await h.ctx.queue.idle();
    expect(run.status).toBe('all_accepted');
    // Reported under the name of the look it showed, so the activity log says which one.
    expect(run.sourceName).toBe(s.today.name);

    const scheme = builtinPresetByKey(s.today.key)!;
    const left = sentColors(h, LEFT.device);
    const right = sentColors(h, RIGHT.device);
    expect(left.size).toBe(15);
    expect(right.size).toBe(15);
    for (let i = 0; i < 15; i++) {
      expect(left.get(i), `left ${i}`).toBe(rgb(scheme.colors[i % scheme.colors.length]!));
      expect(right.get(i), `right ${i}`).toBe(rgb(scheme.colors[(15 + i) % scheme.colors.length]!));
    }
    expect(h.mock.controlRequests().some((c) => c.capability.instance === 'lightScene')).toBe(false);
  });

  it('shows a different scheme the next day, even before the hourly refresh has caught up', async () => {
    const { h, client } = await house();
    const s = await status(client);
    // The next local day. The stored steps of "Today's Color Scheme" are still yesterday's.
    h.clock.set('2026-11-14T20:00:00.000Z');
    expect(dailySchemeKey('2026-11-14')).not.toBe(dailySchemeKey('2026-11-13'));
    h.mock.requests.length = 0;
    await client.post(`/api/v1/presets/${s.presetId}/apply`, {});
    await h.ctx.queue.idle();
    const tomorrow = builtinPresetByKey(dailySchemeKey('2026-11-14'))!;
    const left = sentColors(h, LEFT.device);
    for (let i = 0; i < 15; i++) expect(left.get(i), `left ${i}`).toBe(rgb(tomorrow.colors[i % tomorrow.colors.length]!));

    // And the card follows once the built-ins are refreshed.
    await h.ctx.builtins.sync();
    const preset = h.ctx.presets.list().find((p) => p.builtin?.key === DAILY_SCHEME_PRESET.key) as PresetDto;
    expect(preset.builtin?.today).toEqual({ key: tomorrow.key, name: tomorrow.name });
    expect(preset.builtin?.colors).toEqual(tomorrow.colors);
    // Its stored steps now paint tomorrow's colors too, so a copy or a preview matches.
    const stored = new Set(preset.actions.flatMap((a) => (a.action.type === 'segmentColor' ? [a.action.hex] : [])));
    expect(stored).toEqual(new Set(tomorrow.colors));
  });
});

describe('changing automatically every day', () => {
  it('is off until chosen, and turning it off first creates nothing', async () => {
    const { h, client } = await house();
    const before = schedules(h).length;
    const off = (await client.patch('/api/v1/daily-scheme', { enabled: false, time: '17:00' })).json() as DailySchemeDto;
    expect(off.autoChange.enabled).toBe(false);
    expect(schedules(h)).toHaveLength(before);
  });

  it('turning it on makes one ordinary daily schedule for all the strings', async () => {
    const { h, client, left, right } = await house();
    const on = (await client.patch('/api/v1/daily-scheme', { enabled: true, time: '16:05' })).json() as DailySchemeDto;
    expect(on.autoChange).toMatchObject({ enabled: true, time: '16:05', targetName: 'All light strings' });
    expect(on.autoChange.nextRun?.local).toContain('16:05');
    const made = dailySchedules(h, on.presetId);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({
      name: 'Daily color scheme',
      enabled: true,
      timeZone: LA,
      recurrence: { kind: 'daily', time: '16:05' },
      missedRunPolicy: 'run_latest',
      builtinShow: null,
    });
    const group = h.ctx.groups.get((made[0]!.target as { groupId: string }).groupId);
    expect([...group.deviceIds].sort()).toEqual([left, right].sort());
  });

  it('changes the time and turns off and on again without making a second schedule', async () => {
    const { h, client } = await house();
    const on = (await client.patch('/api/v1/daily-scheme', { enabled: true, time: '16:05' })).json() as DailySchemeDto;
    const later = (await client.patch('/api/v1/daily-scheme', { enabled: true, time: '17:30' })).json() as DailySchemeDto;
    expect(later.autoChange).toMatchObject({ enabled: true, time: '17:30', scheduleId: on.autoChange.scheduleId });
    const off = (await client.patch('/api/v1/daily-scheme', { enabled: false, time: '17:30' })).json() as DailySchemeDto;
    expect(off.autoChange).toMatchObject({ enabled: false, time: '17:30', nextRun: null });
    const again = (await client.patch('/api/v1/daily-scheme', { enabled: true, time: '17:30' })).json() as DailySchemeDto;
    expect(again.autoChange.enabled).toBe(true);
    expect(dailySchedules(h, on.presetId)).toHaveLength(1);
  });

  it('follows a change made under Schedules, because that schedule is all there is', async () => {
    const { h, client } = await house();
    const on = (await client.patch('/api/v1/daily-scheme', { enabled: true, time: '16:05' })).json() as DailySchemeDto;
    h.ctx.schedules.delete(on.autoChange.scheduleId as string);
    expect((await status(client)).autoChange).toMatchObject({ enabled: false, scheduleId: null });
  });

  it('shows a different scheme on each of three evenings', async () => {
    const { h, client } = await house();
    await client.patch('/api/v1/daily-scheme', { enabled: true, time: '16:05' });
    const seen: string[] = [];
    // 16:05 in Los Angeles is 00:05 UTC the next day, in winter.
    for (const [local, utc] of [
      ['2026-11-13', '2026-11-14T00:05:00.000Z'],
      ['2026-11-14', '2026-11-15T00:05:00.000Z'],
      ['2026-11-15', '2026-11-16T00:05:00.000Z'],
    ] as const) {
      h.mock.requests.length = 0;
      await runSchedulerAt(h, utc);
      const scheme = builtinPresetByKey(dailySchemeKey(local))!;
      const left = sentColors(h, LEFT.device);
      expect(left.size, local).toBe(15);
      for (let i = 0; i < 15; i++) expect(left.get(i), `${local} segment ${i}`).toBe(rgb(scheme.colors[i % scheme.colors.length]!));
      seen.push([...left.values()].join(','));
    }
    expect(new Set(seen).size).toBe(3);
  });

  it('refuses politely before any light has been found', async () => {
    const h = await createHarness();
    harnesses.push(h);
    const client = await authedClient(h.app);
    const response = await client.patch('/api/v1/daily-scheme', { enabled: true, time: '16:05' });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('daily_scheme_not_ready');
    expect((await status(client)).presetId).toBeNull();
  });

  it('rejects a time that is not a time', async () => {
    const { client } = await house();
    expect((await client.patch('/api/v1/daily-scheme', { enabled: true, time: '25:00' })).statusCode).toBe(400);
  });
});

describe('one brightness for all the lights', () => {
  it('sends the same brightness to every light, and never to a Govee group', async () => {
    const { h, client } = await house();
    h.mock.requests.length = 0;
    const run = (await client.post('/api/v1/lights/brightness', { value: 40 })).json() as RunResultDto;
    await h.ctx.queue.idle();
    expect(run.status).toBe('all_accepted');
    expect(run.outcomes).toHaveLength(2);
    const sent = h.mock.controlRequests();
    expect(sent.map((c) => [c.device, c.capability.instance, c.capability.value]).sort()).toEqual(
      [
        [LEFT.device, 'brightness', 40],
        [RIGHT.device, 'brightness', 40],
      ].sort(),
    );
  });

  it('leaves the colors alone: nothing but brightness is sent', async () => {
    const { h, client } = await house();
    h.mock.requests.length = 0;
    await client.post('/api/v1/lights/brightness', { value: 100 });
    await h.ctx.queue.idle();
    expect(new Set(h.mock.controlRequests().map((c) => c.capability.instance))).toEqual(new Set(['brightness']));
  });

  it('refuses values outside 1 to 100, and says so when no light has brightness', async () => {
    const { client } = await house();
    expect((await client.post('/api/v1/lights/brightness', { value: 0 })).statusCode).toBe(400);
    expect((await client.post('/api/v1/lights/brightness', { value: 101 })).statusCode).toBe(400);

    const h = await createHarness();
    harnesses.push(h);
    h.mock.devices = [{ ...mockBasicDevice(), capabilities: mockBasicDevice().capabilities.slice(0, 1) }];
    const other = await authedClient(h.app);
    await other.post('/api/v1/devices/discover');
    const response = await other.post('/api/v1/lights/brightness', { value: 50 });
    expect(response.statusCode).toBe(422);
  });
});
