import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type AiMoodDto, type AiMoodResultDto, type AiStatusDto, type RunResultDto } from '@glm/shared';
import { capabilities, device, mockApi, renderApp } from '../../test/fixtures';
import { PresetsPage } from '../presets/PresetsPage';
import { MoodBox } from './MoodBox';
import { acceptedSummary, checkRows, describeColors, holdReason, MOOD_SUGGESTIONS, presetDescription, previewFirstStore, shouldApplyNow } from './mood-model';

beforeEach(() => {
  window.localStorage.clear();
  previewFirstStore.reload();
});
afterEach(() => vi.unstubAllGlobals());

const ready: AiStatusDto = {
  enabled: true,
  reason: null,
  providers: [{ id: 'deepseek', label: 'DeepSeek', model: 'deepseek-flash', available: true, note: null }],
  monthSpentUsd: 0,
  monthlyLimitUsd: 5,
};

const look = (over: Partial<AiMoodResultDto> = {}): AiMoodResultDto => ({
  name: 'Fireside glow',
  summary: 'Embers of orange and red give a warm, slow, safe feeling.',
  note: null,
  lights: [
    { deviceId: 'dev-1', name: 'Front Eaves', kind: 'segments', brightness: 30, colors: ['#ff3b1f', '#ff3b1f', '#ff7a1a', '#ffb36b'] },
    { deviceId: 'dev-2', name: 'Porch Light', kind: 'power', brightness: 30, colors: [] },
  ],
  actions: [
    { deviceId: 'dev-1', action: { type: 'power', on: true } },
    { deviceId: 'dev-1', action: { type: 'brightness', value: 30 } },
    { deviceId: 'dev-1', action: { type: 'segmentColor', hex: '#ff3b1f', segments: [0, 1] } },
  ],
  checks: {
    lights: { passed: true, notes: [] },
    palette: { passed: true, notes: [] },
    review: { status: 'passed', score: 9, by: 'Google Gemini', notes: [], independent: true, confirmation: null },
  },
  clean: true,
  ...over,
});
const dto = (mood: AiMoodResultDto | null, over: Partial<AiMoodDto> = {}): AiMoodDto => ({
  isMood: mood !== null,
  reply: null,
  mood,
  provider: 'deepseek',
  model: 'deepseek-flash',
  costUsd: 0.0008,
  ...over,
});
const run = (status: RunResultDto['status'] = 'all_accepted'): RunResultDto => ({
  runId: 'r1',
  sourceType: 'preset',
  sourceId: null,
  sourceName: 'Fireside glow',
  status,
  startedAt: '2026-11-22T10:00:00.000Z',
  completedAt: '2026-11-22T10:00:05.000Z',
  outcomes: ['power', 'brightness', 'segmentColor'].map((actionType, i) => ({
    deviceId: 'dev-1',
    deviceName: 'Front Eaves',
    actionType,
    summary: actionType,
    status: 'accepted' as const,
    commandId: `c${i}`,
    verification: 'unverified' as const,
    reason: null,
    errorCategory: null,
  })),
});

const lights = [device({ id: 'dev-1', name: 'Front Eaves', capabilities: [capabilities.power] }), device({ id: 'dev-2', name: 'Porch Light', capabilities: [capabilities.power] })];
const base = {
  'GET /ai/status': { json: ready },
  'GET /devices': { json: { devices: lights } },
  'GET /groups': { json: { groups: [{ id: 'g1', name: 'Front of house', deviceIds: ['dev-1'], createdAt: '', updatedAt: '' }] } },
};

const open = () => renderApp(<MoodBox />);
const ask = async (words: string) => {
  await userEvent.type(await screen.findByLabelText('Describe the mood'), words);
  await userEvent.click(screen.getByRole('button', { name: 'Set the mood' }));
};

describe('Set the mood: the box', () => {
  it('sets the lights at once when every check is clean, and shows what was checked', async () => {
    const { calls } = mockApi({ ...base, 'POST /ai/mood': { json: dto(look()) }, 'POST /presets/apply-draft': { json: run() } });
    open();
    await ask('cozy fireside evening');

    expect(await screen.findByText('Set on your lights')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Fireside glow' })).toBeInTheDocument();
    expect(screen.getByText('Embers of orange and red give a warm, slow, safe feeling.')).toBeInTheDocument();
    expect(screen.getByText('3 of 3 steps accepted by Govee', { exact: false })).toBeInTheDocument();

    // The three checks, each saying what it covered.
    const checks = within(screen.getByRole('list', { name: 'Checks' }));
    expect(checks.getByText(/Checked against your lights/)).toBeInTheDocument();
    expect(checks.getByText(/Checked against the mood/)).toBeInTheDocument();
    expect(checks.getByText(/Second opinion/)).toBeInTheDocument();
    expect(checks.getByText('Reviewed by Google Gemini: 9 of 10.')).toBeInTheDocument();

    // Each light, with its brightness.
    const rows = within(screen.getByRole('list', { name: 'What each light shows' }));
    expect(rows.getByText('Front Eaves')).toBeInTheDocument();
    expect(rows.getAllByText('30% bright')).toHaveLength(2);
    expect(rows.getByText(/no colour control/)).toBeInTheDocument();

    const designed = calls.find((c) => c.path === '/ai/mood')!;
    expect(designed.body).toEqual({ description: 'cozy fireside evening' });
    // The steps go through the app's own apply route, exactly as designed.
    const sent = calls.find((c) => c.path === '/presets/apply-draft')!;
    expect(sent.body).toEqual({ name: 'Fireside glow', actions: look().actions });
    expect(calls.map((c) => c.path).indexOf('/ai/mood')).toBeLessThan(calls.map((c) => c.path).indexOf('/presets/apply-draft'));
  });

  it('shows the look and waits for a press when Preview first is on', async () => {
    const { calls } = mockApi({ ...base, 'POST /ai/mood': { json: dto(look()) }, 'POST /presets/apply-draft': { json: run() } });
    open();
    await userEvent.click(await screen.findByRole('checkbox', { name: /Preview first/ }));
    await ask('cozy fireside evening');

    expect(await screen.findByRole('heading', { name: 'Fireside glow' })).toBeInTheDocument();
    expect(screen.getByText('Preview first is on, so this waits for you.')).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/presets/apply-draft')).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Set my lights' }));
    expect(await screen.findByText('Set on your lights')).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/presets/apply-draft')).toHaveLength(1);
    // The choice is remembered in this browser.
    expect(window.localStorage.getItem('glm.mood.previewFirst')).toBe('on');
  });

  it('holds a look that did not pass every check, says why, and sets it only when asked', async () => {
    const concerns = look({
      clean: false,
      checks: {
        lights: { passed: true, notes: [] },
        palette: { passed: true, notes: [] },
        review: { status: 'concerns', score: 4, by: 'Google Gemini', notes: ['Reads as a party, not a fire.'], independent: true, confirmation: null },
      },
    });
    const { calls } = mockApi({ ...base, 'POST /ai/mood': { json: dto(concerns) }, 'POST /presets/apply-draft': { json: run() } });
    open();
    await ask('cozy fireside evening');

    expect(await screen.findByText('A check was not clean, so this waits for you.')).toBeInTheDocument();
    expect(screen.getByText('Reviewed by Google Gemini: 4 of 10. It still has concerns.')).toBeInTheDocument();
    expect(screen.getByText('Reads as a party, not a fire.')).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/presets/apply-draft')).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Set my lights anyway' }));
    expect(await screen.findByText('Set on your lights')).toBeInTheDocument();
  });

  it('never treats an unavailable second opinion as a pass', async () => {
    const unavailable = look({
      clean: false,
      checks: { lights: { passed: true, notes: [] }, palette: { passed: true, notes: [] }, review: { status: 'unavailable', score: null, by: null, notes: [], independent: false, confirmation: null } },
    });
    const { calls } = mockApi({ ...base, 'POST /ai/mood': { json: dto(unavailable) } });
    open();
    await ask('cozy fireside evening');
    expect(await screen.findByText('No second opinion could be had this time.')).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/presets/apply-draft')).toBe(false);
  });

  it('says what to ask for when the words are not a mood, and changes nothing', async () => {
    const { calls } = mockApi({ ...base, 'POST /ai/mood': { json: dto(null, { reply: 'I set moods. Try cozy fireside.' }) } });
    open();
    await ask('turn everything off');
    expect(await screen.findByText('I set moods. Try cozy fireside.')).toBeInTheDocument();
    expect(screen.getByText('Nothing was changed on your lights.')).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/presets/apply-draft')).toBe(false);
  });

  it('shows why a mood could not be made, and sends nothing to the lights', async () => {
    const { calls } = mockApi({
      ...base,
      'POST /ai/mood': { status: 502, json: { error: { code: 'ai_unavailable', message: 'No AI provider could answer right now.' } } },
    });
    open();
    await ask('cozy fireside evening');
    expect(await screen.findByText('No mood this time')).toBeInTheDocument();
    expect(screen.getByText('No AI provider could answer right now.')).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/presets/apply-draft')).toBe(false);
  });

  it('says so when the lights could not be set, and offers to try again', async () => {
    mockApi({
      ...base,
      'POST /ai/mood': { json: dto(look()) },
      'POST /presets/apply-draft': { status: 502, json: { error: { code: 'govee_error', message: 'Govee could not be reached.' } } },
    });
    open();
    await ask('cozy fireside evening');
    expect(await screen.findByText('Your lights were not set')).toBeInTheDocument();
    expect(screen.getByText('Govee could not be reached.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set my lights' })).toBeInTheDocument();
  });

  it('sets only the group or light chosen', async () => {
    const { calls } = mockApi({ ...base, 'POST /ai/mood': { json: dto(look()) }, 'POST /presets/apply-draft': { json: run() } });
    open();
    await screen.findByRole('option', { name: 'Front of house' });
    await userEvent.selectOptions(screen.getByLabelText('Which lights'), 'Front of house');
    await ask('cozy fireside evening');
    await screen.findByText('Set on your lights');
    expect(calls.find((c) => c.path === '/ai/mood')!.body).toEqual({ description: 'cozy fireside evening', target: { type: 'group', groupId: 'g1' } });
  });

  it('sends a suggestion with one tap', async () => {
    const { calls } = mockApi({ ...base, 'POST /ai/mood': { json: dto(look()) }, 'POST /presets/apply-draft': { json: run() } });
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Calm ocean at dusk' }));
    await screen.findByText('Set on your lights');
    expect(calls.find((c) => c.path === '/ai/mood')!.body).toEqual({ description: 'Calm ocean at dusk' });
  });

  it('can try another take with the same words, and keeps the earlier one below', async () => {
    const second = look({ name: 'Softer embers' });
    let n = 0;
    const { calls } = mockApi({
      ...base,
      'POST /ai/mood': () => ({ json: dto(n++ === 0 ? look() : second) }),
      'POST /presets/apply-draft': { json: run() },
    });
    open();
    await ask('cozy fireside evening');
    await screen.findByText('Set on your lights');
    await userEvent.click(screen.getByRole('button', { name: 'Try another take' }));
    expect(await screen.findByRole('heading', { name: 'Softer embers' })).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/ai/mood').map((c) => (c.body as { description: string }).description)).toEqual([
      'cozy fireside evening',
      'cozy fireside evening',
    ]);
    // Newest first.
    const moods = screen.getAllByRole('article');
    expect(moods).toHaveLength(2);
    expect(within(moods[0]!).getByRole('heading', { name: 'Softer embers' })).toBeInTheDocument();
    expect(within(moods[1]!).getByRole('heading', { name: 'Fireside glow' })).toBeInTheDocument();
  });

  it('saves a look as a preset under a name the owner can change, and says when the name is taken', async () => {
    let attempt = 0;
    const { calls } = mockApi({
      ...base,
      'POST /ai/mood': { json: dto(look()) },
      'POST /presets/apply-draft': { json: run() },
      'GET /presets': { json: { presets: [] } },
      'POST /presets': () =>
        attempt++ === 0
          ? { status: 409, json: { error: { code: 'name_taken', message: 'A preset named "Fireside glow" already exists.' } } }
          : { status: 201, json: { id: 'p1', name: 'Fireside glow 2', description: '', actions: [], needsTarget: false, builtin: null, createdAt: '', updatedAt: '' } },
    });
    open();
    await ask('cozy fireside evening');
    await screen.findByText('Set on your lights');
    await userEvent.click(screen.getByRole('button', { name: 'Save as preset' }));

    const name = screen.getByLabelText('Preset name');
    expect(name).toHaveValue('Fireside glow');
    await userEvent.click(screen.getByRole('button', { name: 'Save preset' }));
    expect(await screen.findByText('A preset named "Fireside glow" already exists.')).toBeInTheDocument();

    await userEvent.clear(name);
    await userEvent.type(name, 'Fireside glow 2');
    await userEvent.click(screen.getByRole('button', { name: 'Save preset' }));
    expect(await screen.findByText(/Saved as the preset “Fireside glow 2”/)).toBeInTheDocument();

    const saved = calls.filter((c) => c.method === 'POST' && c.path === '/presets')[1]!.body as { name: string; description: string; actions: unknown[] };
    expect(saved.name).toBe('Fireside glow 2');
    expect(saved.actions).toEqual(look().actions);
    expect(saved.description).toContain('Embers of orange and red');
    expect(saved.description).toContain('cozy fireside evening');
  });

  it('shows a review by the same model, and waits for a press because it is not independent', async () => {
    const self = look({
      clean: false,
      checks: { lights: { passed: true, notes: [] }, palette: { passed: true, notes: [] }, review: { status: 'passed', score: 9, by: 'DeepSeek', notes: [], independent: false, confirmation: null } },
    });
    const { calls } = mockApi({ ...base, 'POST /ai/mood': { json: dto(self) } });
    open();
    await ask('cozy fireside evening');
    expect(await screen.findByText(/Reviewed by DeepSeek, the same model that made it: 9 of 10/)).toBeInTheDocument();
    expect(screen.getByText('The second opinion came from the same model that made the look, so this waits for you.')).toBeInTheDocument();
    expect(screen.getByText(/: Not independent/)).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/presets/apply-draft')).toBe(false);
  });

  it('says when a corrected look was scored again by another model, and sets it', async () => {
    const corrected = look({
      name: 'Softer embers',
      checks: {
        lights: { passed: true, notes: [] },
        palette: { passed: true, notes: [] },
        review: { status: 'adjusted', score: 6, by: 'Google Gemini', notes: ['Too bright.'], independent: true, confirmation: { by: 'DeepSeek', score: 9 } },
      },
    });
    mockApi({ ...base, 'POST /ai/mood': { json: dto(corrected) }, 'POST /presets/apply-draft': { json: run() } });
    open();
    await ask('cozy fireside evening');
    expect(await screen.findByText('Set on your lights')).toBeInTheDocument();
    expect(screen.getByText('Reviewed by Google Gemini: 6 of 10. It corrected the look, and DeepSeek scored the corrected look 9 of 10.')).toBeInTheDocument();
    expect(screen.getByText('Too bright.')).toBeInTheDocument();
  });

  it('does not set the lights on its own after the owner has left the page', async () => {
    let release: (response: Response) => void = () => {};
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const { fetchMock, calls } = mockApi({ ...base, 'POST /presets/apply-draft': { json: run() } });
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).endsWith('/ai/mood')) return original(input, init);
      calls.push({ method: 'POST', path: '/ai/mood', body: undefined, headers: undefined });
      return gate;
    });
    const view = open();
    await ask('cozy fireside evening');
    await screen.findByText('Designing your mood');
    view.unmount();
    release(new Response(JSON.stringify(dto(look())), { status: 200, headers: { 'content-type': 'application/json' } }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls.some((c) => c.path === '/ai/mood')).toBe(true);
    expect(calls.some((c) => c.path === '/presets/apply-draft')).toBe(false);
  });

  it('says each light\'s colours in words, for anyone who cannot see the strip', async () => {
    mockApi({ ...base, 'POST /ai/mood': { json: dto(look()) }, 'POST /presets/apply-draft': { json: run() } });
    open();
    await ask('cozy fireside evening');
    await screen.findByText('Set on your lights');
    expect(screen.getByText('Colours along it: 2 red, 2 orange.')).toBeInTheDocument();
  });

  it('will not send words that are too short', async () => {
    mockApi(base);
    open();
    const send = await screen.findByRole('button', { name: 'Set the mood' });
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Describe the mood'), 'hi');
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Describe the mood'), '!');
    expect(send).toBeEnabled();
  });

  it('makes one mood at a time, and says what is happening meanwhile', async () => {
    let release: (response: Response) => void = () => {};
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const { fetchMock } = mockApi({ ...base, 'POST /presets/apply-draft': { json: run() } });
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith('/ai/mood') ? gate : original(input, init),
    );
    open();
    await ask('cozy fireside evening');

    expect(await screen.findByText('Designing your mood')).toBeInTheDocument();
    expect(screen.getByText(/Nothing changes on your lights yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Calm ocean at dusk' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Set the mood' })).toBeDisabled();

    release(new Response(JSON.stringify(dto(look())), { status: 200, headers: { 'content-type': 'application/json' } }));
    expect(await screen.findByText('Set on your lights')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Calm ocean at dusk' })).toBeEnabled();
  });
});

describe('Set the mood: when AI is not available', () => {
  it('points to Settings when the person has not added a key', async () => {
    mockApi({ ...base, 'GET /ai/status': { json: { ...ready, enabled: false, reason: 'no_key', providers: [] } } });
    open();
    const link = await screen.findByRole('link', { name: /Settings, under AI/ });
    expect(link).toHaveAttribute('href', '/settings');
    expect(screen.queryByLabelText('Describe the mood')).not.toBeInTheDocument();
  });

  it('explains the monthly limit, and leaves the box out when AI is turned off or the status cannot be read', async () => {
    mockApi({ ...base, 'GET /ai/status': { json: { ...ready, enabled: false, reason: 'limit_reached' } } });
    const first = open();
    expect(await screen.findByText(/spending limit has been reached/)).toBeInTheDocument();
    first.unmount();

    mockApi({ ...base, 'GET /ai/status': { json: { ...ready, enabled: false, reason: 'disabled', providers: [] } } });
    const second = open();
    await waitFor(() => expect(screen.queryByText(/spending limit/)).not.toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Set the mood' })).not.toBeInTheDocument();
    second.unmount();

    mockApi({ 'GET /devices': { json: { devices: lights } }, 'GET /groups': { json: { groups: [] } } });
    open();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByRole('heading', { name: 'Set the mood' })).not.toBeInTheDocument();
  });
});

describe('Set the mood: on the Scenes & Presets page', () => {
  const page = {
    'GET /presets': { json: { presets: [] } },
    'GET /schedules': { json: { schedules: [] } },
    'GET /settings': { json: DEFAULT_SETTINGS },
    'GET /ai/status': { json: ready },
    'GET /groups': { json: { groups: [] } },
  };

  it('is the first thing on the page once there are lights', async () => {
    mockApi({ ...page, 'GET /devices': { json: { devices: lights } } });
    renderApp(<PresetsPage />);
    const heading = await screen.findByRole('heading', { name: 'Set the mood' });
    const all = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(all[0]).toBe('Set the mood');
    expect(heading).toBeInTheDocument();
    expect(screen.getByLabelText('Describe the mood')).toBeInTheDocument();
  });

  it('is left out until there are lights to set', async () => {
    mockApi({ ...page, 'GET /devices': { json: { devices: [] } } });
    renderApp(<PresetsPage />);
    await screen.findByRole('heading', { name: 'Scenes & Presets' });
    expect(screen.queryByRole('heading', { name: 'Set the mood' })).not.toBeInTheDocument();
  });
});

describe('the mood model', () => {
  it('applies at once only a clean look, and only when the owner has not asked to preview', () => {
    expect(shouldApplyNow(dto(look()), false)).toBe(true);
    expect(shouldApplyNow(dto(look()), true)).toBe(false);
    expect(shouldApplyNow(dto(look({ clean: false })), false)).toBe(false);
    expect(shouldApplyNow(dto(null), false)).toBe(false);
  });

  it('names colours in order, merging neighbours with the same name', () => {
    expect(describeColors(['#ff3b1f', '#ff3b1f', '#ff7a1a', '#ffb36b'])).toBe('2 red, 2 orange');
    expect(describeColors(['#00b3a6'])).toBe('teal');
    expect(describeColors(['#ff0000', '#00c853', '#ff0000'])).toBe('1 red, 1 green, 1 red');
  });

  it('says why a look is waiting', () => {
    expect(holdReason(look(), false)).toBe('');
    expect(holdReason(look(), true)).toContain('Preview first');
    expect(holdReason(look({ clean: false }), false)).toContain('check was not clean');
    expect(holdReason(look({ clean: false }), true)).toContain('check was not clean');
    const self = look({ clean: false, checks: { ...look().checks, review: { ...look().checks.review, independent: false } } });
    expect(holdReason(self, false)).toContain('same model');
  });

  it('turns the three checks into rows in the order they ran', () => {
    const rows = checkRows(
      look({
        checks: {
          lights: { passed: true, notes: ['2 dark colours were made brighter.'] },
          palette: { passed: false, notes: ['brightness L1 at 95% is outside the 20-40% the brief calls for'] },
          review: { status: 'adjusted', score: 6, by: 'DeepSeek', notes: ['Too bright.'], independent: true, confirmation: { by: 'Google Gemini', score: 9 } },
        },
      }),
    );
    expect(rows.map((r) => [r.key, r.state])).toEqual([
      ['lights', 'pass'],
      ['palette', 'concern'],
      ['review', 'adjusted'],
    ]);
    expect(rows[0]!.notes).toEqual(['2 dark colours were made brighter.']);
    expect(rows[2]!.detail).toBe('Reviewed by DeepSeek: 6 of 10. It corrected the look, and Google Gemini scored the corrected look 9 of 10.');
  });

  it('keeps a saved description within a preset\'s limit, and counts accepted steps', () => {
    expect(presetDescription(look({ summary: 'x'.repeat(600) }), 'words').length).toBe(500);
    expect(presetDescription(look(), 'cozy')).toBe('Embers of orange and red give a warm, slow, safe feeling. Made from: "cozy"');
    expect(acceptedSummary([{ status: 'accepted' }, { status: 'failed' }])).toBe('1 of 2 steps accepted by Govee');
    expect(acceptedSummary([{ status: 'accepted' }])).toBe('1 of 1 step accepted by Govee');
    expect(MOOD_SUGGESTIONS.length).toBeGreaterThanOrEqual(4);
  });
});
