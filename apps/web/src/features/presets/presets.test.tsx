import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type DailySchemeDto, type PresetDto, type RunResultDto } from '@glm/shared';
import { DashboardPage } from '../dashboard/DashboardPage';
import { capabilities, device, mockApi, renderApp } from '../../test/fixtures';
import { PresetsPage } from './PresetsPage';
import { filterAndSort, matchesSearch, NO_FILTER, sortPresets } from './preset-list';

afterEach(() => vi.unstubAllGlobals());

const preset = (name: string, overrides: Partial<PresetDto> = {}): PresetDto => ({
  id: name,
  name,
  description: '',
  needsTarget: false,
  builtin: null,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
  actions: [{ id: 1, deviceId: 'dev-1', deviceName: 'Outdoor Left', action: { type: 'power', on: true }, summary: 'Turn on', order: 0 }],
  ...overrides,
});
const builtin = (key: string, name: string, occasion: string, description: string, overrides: Partial<PresetDto> = {}): PresetDto =>
  preset(name, { description, builtin: { key, occasion, when: `All of ${occasion}`, colors: ['#ff0000', '#00c000'], isAutomaticShow: false }, ...overrides });
const effect = (key: string, name: string, occasion: string): PresetDto =>
  builtin(key, name, occasion, "Govee's moving effect.", {
    actions: [{ id: 2, deviceId: 'dev-1', deviceName: 'Outdoor Left', action: { type: 'scene', sceneKey: 'k', sceneName: 'Fall' }, summary: 'Scene', order: 0 }],
  });

const CANDY = builtin('christmas-candy-cane', 'Christmas: Candy Cane', 'Christmas', 'Red and white stripes.');
const FROST = builtin('december-winter-frost', 'December: Winter Frost', 'December', 'Icy blue and white.');
const PUMPKIN = builtin('season-pumpkin-patch', 'November: Pumpkin Patch', 'November', 'Pumpkin orange with green vines and a touch of cream.');
const FALL = effect('november-fall-effect', 'November: Fall Effect', 'November');
const MUERTOS = builtin('month-dia-de-muertos', 'Día de Muertos: Marigold Path', 'Día de Muertos', 'Marigold and orange.');
const MINE_OLD = preset('Porch glow', { description: 'Soft gold for evenings', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z' });
const MINE_NEW = preset('Aqua stripes', { createdAt: '2026-11-05T00:00:00.000Z', updatedAt: '2026-11-05T00:00:00.000Z' });
const ALL = [CANDY, FROST, PUMPKIN, FALL, MUERTOS, MINE_OLD, MINE_NEW];

const day = (date: string, key: string, name: string, presetId: string | null = name) => ({
  date,
  key,
  name,
  description: `About ${name}`,
  colors: ['#ff6a00', '#3c7a1e'],
  presetId,
});
const daily = (overrides: Partial<DailySchemeDto['autoChange']> = {}, more: Partial<DailySchemeDto> = {}): DailySchemeDto => ({
  presetId: 'daily',
  timeZone: 'America/Los_Angeles',
  today: day('2026-11-13', 'season-pumpkin-patch', 'November: Pumpkin Patch'),
  upcoming: Array.from({ length: 10 }, (_, i) => day(`2026-11-${14 + i}`, `k${i}`, `Scheme ${i + 1}`)),
  autoChange: { enabled: false, time: '16:05', scheduleId: null, nextRun: null, targetName: null, ...overrides },
  ...more,
});

const routes = (presets: PresetDto[], scheme: DailySchemeDto = daily()) => ({
  'GET /presets': { json: { presets } },
  'GET /devices': { json: { devices: [] } },
  'GET /schedules': { json: { schedules: [] } },
  'GET /settings': { json: DEFAULT_SETTINGS },
  'GET /daily-scheme': { json: scheme },
});
const cardNames = () => screen.queryAllByRole('button', { name: /^Apply / }).map((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').replace(/^Apply /, ''));

describe('searching and sorting, as a list', () => {
  it('matches any word in the name, description, occasion or timing, in any order', () => {
    expect(matchesSearch(CANDY, 'candy')).toBe(true);
    expect(matchesSearch(CANDY, 'stripes red')).toBe(true);
    expect(matchesSearch(CANDY, 'CHRISTMAS')).toBe(true);
    expect(matchesSearch(FROST, 'all of december')).toBe(true);
    expect(matchesSearch(CANDY, 'candy blue')).toBe(false);
    expect(matchesSearch(CANDY, '   ')).toBe(true);
  });

  it('ignores accents, and finds an effect by the name of its Govee scene', () => {
    expect(matchesSearch(MUERTOS, 'dia de muertos')).toBe(true);
    expect(matchesSearch(FALL, 'fall')).toBe(true);
    expect(matchesSearch(MINE_OLD, 'outdoor left')).toBe(true);
  });

  it('sorts by calendar, name either way, newest and most recently changed, without changing the original', () => {
    const names = (list: PresetDto[]) => list.map((p) => p.name);
    const original = [...ALL];
    // Pumpkin Patch was added to the catalog last, and still sits with the rest of November.
    expect(names(sortPresets(ALL, 'calendar')).slice(0, 5)).toEqual([FALL.name, PUMPKIN.name, FROST.name, CANDY.name, MUERTOS.name]);
    expect(names(sortPresets(ALL, 'calendar')).slice(5)).toEqual(['Aqua stripes', 'Porch glow']);
    expect(names(sortPresets(ALL, 'name'))[0]).toBe('Aqua stripes');
    expect(names(sortPresets(ALL, 'name-desc'))[0]).toBe('Porch glow');
    expect(names(sortPresets([MINE_OLD, MINE_NEW], 'newest'))).toEqual(['Aqua stripes', 'Porch glow']);
    expect(names(sortPresets([MINE_OLD, MINE_NEW], 'changed'))).toEqual(['Porch glow', 'Aqua stripes']);
    expect(ALL).toEqual(original);
  });

  it('filters still patterns from moving effects', () => {
    expect(filterAndSort(ALL, { ...NO_FILTER, kind: 'effect' }).map((p) => p.name)).toEqual([FALL.name]);
    expect(filterAndSort(ALL, { ...NO_FILTER, kind: 'pattern' })).toHaveLength(6);
  });
});

describe('searching and sorting, on the page', () => {
  it('narrows both the ready-made looks and your own as you type, and says how many', async () => {
    mockApi(routes(ALL));
    renderApp(<PresetsPage />);
    const search = await screen.findByLabelText('Search patterns');
    expect(screen.getByText(/^7 patterns and presets\./)).toBeInTheDocument();

    // A search looks inside words too, so "gold" finds "Marigold" as well as "Soft gold".
    await userEvent.type(search, 'gold');
    await waitFor(() => expect(screen.getByText(/Showing 2 of 7/)).toBeInTheDocument());
    expect(cardNames()).toEqual([MUERTOS.name]);
    await userEvent.type(search, ' evenings');
    await waitFor(() => expect(screen.getByText(/Showing 1 of 7/)).toBeInTheDocument());
    expect(cardNames()).toEqual([]);
    expect(screen.getByRole('heading', { name: 'Porch glow' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Aqua stripes' })).not.toBeInTheDocument();
    expect(screen.getByText(/No ready-made look matches/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Clear the search' }));
    expect(cardNames()).toHaveLength(5);
    expect(screen.getByRole('heading', { name: 'Aqua stripes' })).toBeInTheDocument();
  });

  it('says so when nothing of yours matches, instead of claiming you have no presets', async () => {
    mockApi(routes(ALL));
    renderApp(<PresetsPage />);
    await userEvent.type(await screen.findByLabelText('Search patterns'), 'candy');
    expect(await screen.findByText(/None of your 2 presets match/)).toBeInTheDocument();
    expect(screen.queryByText('No presets yet')).not.toBeInTheDocument();
    expect(cardNames()).toEqual(['Christmas: Candy Cane']);
  });

  it('groups by occasion in calendar order, and lists flat in the order chosen otherwise', async () => {
    mockApi(routes(ALL));
    renderApp(<PresetsPage />);
    await screen.findByLabelText('Search patterns');
    expect(cardNames()).toEqual([FALL.name, PUMPKIN.name, FROST.name, CANDY.name, MUERTOS.name]);
    expect(screen.getByRole('heading', { level: 3, name: 'November' })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'name-desc');
    expect(cardNames()).toEqual([PUMPKIN.name, FALL.name, MUERTOS.name, FROST.name, CANDY.name]);
    expect(screen.queryByRole('heading', { level: 3, name: 'November' })).not.toBeInTheDocument();
    const yours = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(yours.indexOf('Porch glow')).toBeLessThan(yours.indexOf('Aqua stripes'));
  });

  it('can show only still patterns, or only moving effects', async () => {
    mockApi(routes(ALL));
    renderApp(<PresetsPage />);
    await userEvent.selectOptions(await screen.findByLabelText('Show'), 'effect');
    expect(cardNames()).toEqual([FALL.name]);
    await userEvent.selectOptions(screen.getByLabelText('Show'), 'pattern');
    expect(cardNames()).not.toContain(FALL.name);
  });
});

describe('the color scheme of the day', () => {
  const DAILY = builtin('daily-scheme', "Today's Color Scheme", 'Changes every day', 'Shows the color scheme chosen for today.');

  it("shows today's scheme and what is coming, and keeps its own preset out of the grid", async () => {
    mockApi(routes([PUMPKIN, DAILY]));
    renderApp(<PresetsPage />);
    const card = (await screen.findByRole('heading', { name: 'Color scheme of the day' })).closest('div.rounded-xl') as HTMLElement;
    expect(within(card).getByText('Today, Fri, Nov 13')).toBeInTheDocument();
    expect(within(card).getByText('November: Pumpkin Patch')).toBeInTheDocument();
    expect(within(card).getByText('Sat, Nov 14')).toBeInTheDocument();
    expect(within(card).getAllByRole('listitem')).toHaveLength(7);
    await userEvent.click(within(card).getByRole('button', { name: 'Show all 10 days to December 31' }));
    expect(within(card).getAllByRole('listitem')).toHaveLength(10);
    expect(cardNames()).toEqual([PUMPKIN.name]);
    expect(within(card).getByText(/^Off\. The lights change only when you apply something\./)).toBeInTheDocument();
  });

  it('asks before showing it now, like any other preset', async () => {
    const { calls } = mockApi(routes([PUMPKIN, DAILY]));
    renderApp(<PresetsPage />);
    await userEvent.click(await screen.findByRole('button', { name: "Show today's scheme now: November: Pumpkin Patch" }));
    expect(await screen.findByRole('heading', { name: 'Apply "November: Pumpkin Patch"' })).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('turns the daily change on with the time shown, and says when it next runs', async () => {
    const on = daily({ enabled: true, scheduleId: 's1', targetName: 'All light strings', nextRun: { at: '2026-11-14T00:05:00.000Z', local: '2026-11-13 16:05 PST', note: null } });
    const { calls } = mockApi({ ...routes([PUMPKIN, DAILY]), 'PATCH /daily-scheme': { json: on } });
    renderApp(<PresetsPage />);
    await userEvent.click(await screen.findByLabelText('Change automatically every day'));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ enabled: true, time: '16:05' }));
    expect(await screen.findByText(/On\. Next change: 2026-11-13 16:05 PST, on All light strings/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Schedules' })).toHaveAttribute('href', '/schedules');
    expect(screen.getByLabelText('Change automatically every day')).toBeChecked();
  });

  it('saves a new time when it is on, and only waits for the switch when it is off', async () => {
    const on = daily({ enabled: true, scheduleId: 's1', targetName: 'All light strings' });
    const { calls } = mockApi({ ...routes([PUMPKIN, DAILY], on), 'PATCH /daily-scheme': { json: daily({ ...on.autoChange, time: '17:30' }) } });
    renderApp(<PresetsPage />);
    const time = await screen.findByLabelText('Time the color scheme changes each day');
    fireEvent.change(time, { target: { value: '17:30' } });
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
    fireEvent.blur(time);
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ enabled: true, time: '17:30' }));
  });

  it('uses the time typed when switching on, and sends nothing for a time change while off', async () => {
    const { calls } = mockApi({ ...routes([PUMPKIN, DAILY]), 'PATCH /daily-scheme': { json: daily({ enabled: true, time: '18:00', scheduleId: 's1' }) } });
    renderApp(<PresetsPage />);
    const time = await screen.findByLabelText('Time the color scheme changes each day');
    fireEvent.change(time, { target: { value: '18:00' } });
    fireEvent.blur(time);
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
    await userEvent.click(screen.getByLabelText('Change automatically every day'));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ enabled: true, time: '18:00' }));
  });

  it('explains itself outside November and December, and before any light is found', async () => {
    const offSeason = daily({}, { today: day('2027-03-09', 'season-warm-white', 'Everyday: Warm White'), upcoming: [], presetId: null });
    mockApi(routes([PUMPKIN, DAILY], offSeason));
    renderApp(<PresetsPage />);
    expect(await screen.findByText(/In other months this shows a plain warm white/)).toBeInTheDocument();
    expect(screen.getByText(/becomes available once your lights have been found/)).toBeInTheDocument();
    expect(screen.getByLabelText('Change automatically every day')).toBeDisabled();
  });

  it('shows the reason when the change cannot be saved', async () => {
    mockApi({
      ...routes([PUMPKIN, DAILY]),
      'PATCH /daily-scheme': { status: 422, json: { error: { code: 'no_light_strings', message: 'No light string that can show patterns has been found yet.' } } },
    });
    renderApp(<PresetsPage />);
    await userEvent.click(await screen.findByLabelText('Change automatically every day'));
    expect(await screen.findByText(/No light string that can show patterns/)).toBeInTheDocument();
  });
});

describe('one brightness for all lights', () => {
  const brightnessState = (value: number) => ({
    instance: 'brightness',
    requested: null,
    accepted: null,
    reported: { value, at: '2026-11-13T10:00:00.000Z', historical: false },
    notQueryable: false,
    verification: null,
  });
  const light = (id: string, name: string, level: number | null) =>
    device({ id, name, capabilities: [capabilities.power, capabilities.brightness], states: level === null ? [] : [brightnessState(level)] });
  const group = device({ id: 'g', name: 'Christmas', sku: 'SameModeGroup', isGoveeGroup: true, isPrimaryModel: false, capabilities: [capabilities.power, capabilities.brightness] });
  const run = (outcomes: Partial<RunResultDto['outcomes'][number]>[]): RunResultDto => ({
    runId: 'r',
    sourceType: 'manual',
    sourceId: null,
    sourceName: 'Brightness',
    status: 'all_accepted',
    startedAt: '',
    completedAt: '',
    outcomes: outcomes.map((o) => ({
      deviceId: 'x',
      deviceName: 'Light',
      actionType: 'brightness',
      summary: '',
      status: 'accepted',
      commandId: null,
      verification: 'unverified',
      reason: null,
      errorCategory: null,
      ...o,
    })) as RunResultDto['outcomes'],
  });
  const page = (devices: ReturnType<typeof device>[], extra: object = {}) => ({ ...routes([PUMPKIN]), 'GET /devices': { json: { devices } }, ...extra });

  it('shows the shared level, and sends one value for every light when the slider is let go', async () => {
    const { calls } = mockApi(page([light('a', 'Outdoor Left', 60), light('b', 'Outdoor Right', 60), group], { 'POST /lights/brightness': { json: run([{}, {}]) } }));
    renderApp(<PresetsPage />);
    const slider = await screen.findByLabelText('All 2 lights together');
    expect(slider).toHaveValue('60');
    fireEvent.change(slider, { target: { value: '35' } });
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    fireEvent.pointerUp(slider);
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toEqual([expect.objectContaining({ path: '/lights/brightness', body: { value: 35 } })]));
    expect(await screen.findByText('Govee accepted it for all 2 lights.')).toBeInTheDocument();
  });

  it('says when the lights differ, instead of showing a level that is only true for one', async () => {
    mockApi(page([light('a', 'Outdoor Left', 40), light('b', 'Outdoor Right', 100)]));
    renderApp(<PresetsPage />);
    expect(await screen.findByText(/The lights differ right now: Outdoor Left 40%, Outdoor Right 100%/)).toBeInTheDocument();
    expect(screen.getByLabelText('All 2 lights together')).toHaveAttribute('aria-valuetext', 'Unknown');
  });

  it('names a light that did not take it', async () => {
    const result = run([{}, { deviceName: 'Outdoor Center', status: 'rejected', reason: 'Govee says this light is offline. Check its power and Wi-Fi.' }]);
    mockApi(page([light('a', 'Outdoor Left', 60), light('b', 'Outdoor Center', 60)], { 'POST /lights/brightness': { json: { ...result, status: 'partial' } } }));
    renderApp(<PresetsPage />);
    const slider = await screen.findByLabelText('All 2 lights together');
    fireEvent.change(slider, { target: { value: '20' } });
    fireEvent.pointerUp(slider);
    expect(await screen.findByText(/Outdoor Center: Govee says this light is offline/)).toBeInTheDocument();
    expect(screen.queryByText(/accepted it for all/)).not.toBeInTheDocument();
  });

  it('is not offered when no light can be dimmed', async () => {
    mockApi(page([device({ capabilities: [capabilities.power] }), group]));
    renderApp(<PresetsPage />);
    await screen.findByLabelText('Search patterns');
    expect(screen.queryByText('Brightness for all lights')).not.toBeInTheDocument();
  });
});

describe('checking the lights from the dashboard', () => {
  const dashboard = (devices: ReturnType<typeof device>[], extra: object = {}) => ({
    'GET /devices': { json: { devices } },
    'GET /system/status': { status: 500, json: { error: { code: 'x', message: 'x' } } },
    'GET /dashboard/summary': { json: { upcoming: [], recentFailures: [] } },
    'GET /presets': { json: { presets: [] } },
    'GET /settings': { json: DEFAULT_SETTINGS },
    'GET /connection/report': { status: 500, json: { error: { code: 'x', message: 'x' } } },
    'POST /devices/refresh-due': { json: { devices } },
    ...extra,
  });
  const online = device({ id: 'a', name: 'Outdoor Left', connectivity: 'online', freshness: 'fresh', lastStatusRefreshAt: new Date().toISOString() });
  const checking = device({ id: 'b', name: 'Outdoor Center', connectivity: 'checking', freshness: 'fresh', lastStatusRefreshAt: new Date().toISOString() });

  it('labels a light Govee called offline once as being checked, not as offline', async () => {
    mockApi(dashboard([online, checking]));
    renderApp(<DashboardPage />);
    expect(await screen.findByText('Checking connection')).toBeInTheDocument();
    expect(screen.queryByText('Offline')).not.toBeInTheDocument();
    expect(screen.getAllByText('Last reported power')).toHaveLength(1);
  });

  it('asks Govee about every light at once, and says what it found', async () => {
    const { calls } = mockApi(dashboard([online], { 'POST /devices/refresh-all': { json: { checked: 1, listError: null, failures: [], devices: [online] } } }));
    renderApp(<DashboardPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Check lights now' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/devices/refresh-all')).toBe(true));
    expect(await screen.findByText('Asked Govee just now: all 1 lights are online.')).toBeInTheDocument();
  });

  it('names a light that is not connected, and one that could not be read', async () => {
    mockApi(dashboard([online, checking], { 'POST /devices/refresh-all': { json: { checked: 2, listError: null, failures: [], devices: [online, checking] } } }));
    const view = renderApp(<DashboardPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Check lights now' }));
    expect(await screen.findByText('Asked Govee just now: 1 of 2 lights online')).toBeInTheDocument();
    expect(screen.getByText(/Govee says Outdoor Center is not connected/)).toBeInTheDocument();
    view.unmount();

    mockApi(
      dashboard([online], {
        'POST /devices/refresh-all': { json: { checked: 1, listError: 'Govee did not respond within 10000 ms.', failures: [{ deviceId: 'a', name: 'Outdoor Left', message: 'Govee did not respond.' }], devices: [online] } },
      }),
    );
    renderApp(<DashboardPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Check lights now' }));
    expect(await screen.findByText('Some checks did not get through')).toBeInTheDocument();
    expect(screen.getByText(/The device list could not be refreshed: Govee did not respond within 10000 ms/)).toBeInTheDocument();
    expect(screen.getByText('Outdoor Left: Govee did not respond.')).toBeInTheDocument();
  });
});
