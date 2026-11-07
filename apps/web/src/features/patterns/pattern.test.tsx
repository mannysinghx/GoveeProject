import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeviceAction, PresetDto } from '@glm/shared';
import { capabilities, device, mockApi, renderApp } from '../../test/fixtures';
import { PatternEditorPage } from './PatternEditorPage';
import {
  cellColor,
  clearPattern,
  emptyPattern,
  gradientFill,
  isPatternPreset,
  paintCell,
  patternFromPreset,
  patternToActions,
  repeatFill,
  serpentineRows,
} from './pattern-model';

afterEach(() => vi.unstubAllGlobals());

const options = { turnOn: false, brightness: null, maxPerCommand: 27 };
const colorSteps = (actions: DeviceAction[]) => actions.filter((a) => a.type === 'segmentColor');

describe('pattern model', () => {
  it('shows the background through unpainted cells, and through erased ones', () => {
    let state = emptyPattern(3, '#ffffff');
    state = paintCell(state, 1, '#ff0000');
    expect([0, 1, 2].map((i) => cellColor(state, i))).toEqual(['#ffffff', '#ff0000', '#ffffff']);
    state = { ...state, background: '#000000' };
    expect(cellColor(state, 0)).toBe('#000000');
    expect(cellColor(state, 1)).toBe('#ff0000');
    state = paintCell(state, 1, null);
    expect(cellColor(state, 1)).toBe('#000000');
  });

  it('sends one command per color rather than one per segment', () => {
    let state = emptyPattern(27, '#ffffff');
    state = paintCell(paintCell(state, 3, '#ff0000'), 9, '#ff0000');
    const steps = colorSteps(patternToActions(state, options));
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ hex: '#ffffff' });
    expect(steps[1]).toEqual({ type: 'segmentColor', hex: '#ff0000', segments: [3, 9] });
  });

  it('covers every segment exactly once', () => {
    const state = repeatFill(emptyPattern(27), ['#ff0000', '#00ff00'], 3);
    const covered = colorSteps(patternToActions(state, options)).flatMap((a) =>
      a.type === 'segmentColor' ? a.segments : [],
    );
    expect(covered.sort((a, b) => a - b)).toEqual(Array.from({ length: 27 }, (_, i) => i));
  });

  it('splits a command when the device limits how many segments one can name', () => {
    const steps = colorSteps(patternToActions(emptyPattern(27), { ...options, maxPerCommand: 10 }));
    expect(steps.map((a) => (a.type === 'segmentColor' ? a.segments.length : 0))).toEqual([10, 10, 7]);
  });

  it('turns on and sets brightness before any color', () => {
    const actions = patternToActions(emptyPattern(3), { turnOn: true, brightness: 40, maxPerCommand: 3 });
    expect(actions.map((a) => a.type)).toEqual(['power', 'brightness', 'segmentColor']);
  });

  it('repeats runs of colors', () => {
    const state = repeatFill(emptyPattern(6), ['#ff0000', '#00ff00'], 2);
    expect(state.cells).toEqual(['#ff0000', '#ff0000', '#00ff00', '#00ff00', '#ff0000', '#ff0000']);
  });

  it('blends a gradient from end to end', () => {
    const state = gradientFill(emptyPattern(3), '#000000', '#ffffff');
    expect(state.cells).toEqual(['#000000', '#808080', '#ffffff']);
  });

  it('lays rows out as a zigzag', () => {
    expect(serpentineRows(7, 3)).toEqual([[0, 1, 2], [5, 4, 3], [6]]);
  });

  it('survives saving and reopening', () => {
    let state = emptyPattern(5, '#ffffff');
    state = paintCell(state, 2, '#ff0000');
    const actions = patternToActions(state, { turnOn: true, brightness: 50, maxPerCommand: 5 });
    const preset = {
      id: 'p',
      name: 'x',
      description: '',
      needsTarget: true,
      createdAt: '',
      updatedAt: '',
      actions: actions.map((action, order) => ({ id: order, deviceId: null, deviceName: null, action, summary: '', order })),
    } satisfies PresetDto;
    expect(isPatternPreset(preset)).toBe(true);
    const loaded = patternFromPreset(preset, 5);
    expect(loaded).toMatchObject({ turnOn: true, brightness: 50 });
    expect([0, 1, 2, 3, 4].map((i) => cellColor(loaded.state, i))).toEqual([0, 1, 2, 3, 4].map((i) => cellColor(state, i)));
    expect(cellColor(clearPattern(loaded.state), 2)).toBe('#ffffff');
  });

  it('leaves ordinary presets to the ordinary editor', () => {
    const base = { id: 'p', name: 'x', description: '', needsTarget: true, createdAt: '', updatedAt: '' };
    const step = (action: DeviceAction) => ({ id: 0, deviceId: null, deviceName: null, action, summary: '', order: 0 });
    expect(isPatternPreset({ ...base, actions: [step({ type: 'power', on: true })] })).toBe(false);
    expect(
      isPatternPreset({
        ...base,
        actions: [step({ type: 'segmentColor', segments: [0], hex: '#ff0000' }), step({ type: 'color', hex: '#ff0000' })],
      }),
    ).toBe(false);
  });
});

describe('pattern editor', () => {
  const string27 = device({
    capabilities: [
      capabilities.power,
      { ...capabilities.segments, segments: Array.from({ length: 27 }, (_, i) => i), maxSelect: 27 },
    ],
  });
  const routes = {
    'GET /devices': { json: { devices: [string27] } },
    'GET /presets': { json: { presets: [] } },
    'GET /groups': { json: { groups: [] } },
    'GET /dashboard/summary': { json: { upcoming: [], recentFailures: [] } },
  };
  const open = (route = '/patterns/new') =>
    renderApp(
      <Routes>
        <Route path="/patterns/new" element={<PatternEditorPage />} />
        <Route path="/patterns/:presetId" element={<PatternEditorPage />} />
        <Route path="/presets" element={<p>Presets list</p>} />
      </Routes>,
      { route },
    );
  const setColor = (label: string, hex: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: hex } });
  const cell = (index: number) => screen.getByRole('button', { name: new RegExp(`^Segment ${index},`) });

  it('draws one cell per reported segment, and says a segment may not be one bulb', async () => {
    mockApi(routes);
    open();
    await screen.findByText(/reports 27 segments/);
    expect(screen.getAllByRole('button', { name: /^Segment \d+,/ })).toHaveLength(27);
    expect(screen.getByText(/may cover several bulbs/)).toBeInTheDocument();
  });

  it('explains when no light reports segments, without offering a fake editor', async () => {
    mockApi({
      ...routes,
      'GET /devices': { json: { devices: [device({ sku: 'SameModeGroup', isGoveeGroup: true, capabilities: [capabilities.power] })] } },
    });
    open();
    expect(await screen.findByText('No light here reports segment control')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Segment/ })).not.toBeInTheDocument();
  });

  it('paints by dragging, erases, and treats a whole drag as one undo', async () => {
    mockApi(routes);
    open();
    await screen.findByText(/reports 27 segments/);
    setColor('Fill color', '#ff0000');

    fireEvent.pointerDown(cell(0));
    fireEvent.pointerMove(cell(1));
    fireEvent.pointerMove(cell(2));
    fireEvent.pointerUp(window);
    for (const i of [0, 1, 2]) expect(cell(i)).toHaveAccessibleName(`Segment ${i}, #ff0000`);
    expect(cell(3)).toHaveAccessibleName('Segment 3, #ffffff');

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    for (const i of [0, 1, 2]) expect(cell(i)).toHaveAccessibleName(`Segment ${i}, #ffffff`);

    await userEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(cell(1)).toHaveAccessibleName('Segment 1, #ff0000');

    await userEvent.click(screen.getByRole('button', { name: 'Erase' }));
    fireEvent.pointerDown(cell(1));
    fireEvent.pointerUp(window);
    expect(cell(1)).toHaveAccessibleName('Segment 1, #ffffff');
    expect(cell(0)).toHaveAccessibleName('Segment 0, #ff0000');
  });

  it('can be painted from the keyboard', async () => {
    mockApi(routes);
    open();
    await screen.findByText(/reports 27 segments/);
    setColor('Fill color', '#00ff00');
    cell(5).focus();
    await userEvent.keyboard('{Enter}');
    expect(cell(5)).toHaveAccessibleName('Segment 5, #00ff00');
  });

  it('sends the fewest commands, says how long it takes, and is honest about the result', async () => {
    const { calls } = mockApi({
      ...routes,
      'POST /presets/apply-draft': {
        json: {
          runId: 'r',
          sourceType: 'preset',
          sourceId: null,
          sourceName: 'Pattern preview',
          status: 'all_accepted',
          startedAt: '2026-11-07T00:00:00.000Z',
          completedAt: '2026-11-07T00:00:01.000Z',
          outcomes: [
            { deviceId: 'dev-1', deviceName: 'Front Eaves', actionType: 'segmentColor', summary: 'Set segments', status: 'accepted', commandId: 'c', verification: 'unverified', reason: null, errorCategory: null },
          ],
        },
      },
    });
    open('/patterns/new?device=dev-1');
    await screen.findByText(/reports 27 segments/);
    setColor('Fill color', '#ff0000');
    await userEvent.click(screen.getByRole('button', { name: 'Repeat pattern' }));

    expect(screen.getByText(/This takes 3 commands per light, about 3 seconds/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send to lights' }));

    await waitFor(() => expect(calls.find((c) => c.path === '/presets/apply-draft')).toBeTruthy());
    const body = calls.find((c) => c.path === '/presets/apply-draft')?.body as { actions: DeviceAction[]; target: unknown };
    expect(body.target).toEqual({ type: 'device', deviceId: 'dev-1' });
    expect(body.actions.map((a) => a.type)).toEqual(['power', 'segmentColor', 'segmentColor']);
    expect(await screen.findByText(/cannot confirm the pattern/)).toBeInTheDocument();
    expect(screen.queryByText(/^Confirmed/)).not.toBeInTheDocument();
  });

  it('needs a target before sending', async () => {
    mockApi(routes);
    open();
    await screen.findByText(/reports 27 segments/);
    expect(screen.getByRole('button', { name: 'Send to lights' })).toBeDisabled();
  });

  it('is upfront that moving effects are not available', async () => {
    mockApi(routes);
    open();
    expect(await screen.findByText('Moving effects are not available here')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /clockwise|twinkle|breathe/i })).not.toBeInTheDocument();
  });

  it('saves as a preset any light can use, and shows a save error', async () => {
    const { calls } = mockApi({
      ...routes,
      'POST /presets': { status: 409, json: { error: { code: 'name_taken', message: 'A preset named "Xmas" already exists.' } } },
    });
    open();
    await screen.findByText(/reports 27 segments/);
    await userEvent.type(screen.getByLabelText('Pattern name'), 'Xmas');
    await userEvent.click(screen.getByRole('button', { name: 'Save pattern' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
    const body = calls.find((c) => c.path === '/presets' && c.method === 'POST')?.body as { name: string; actions: { deviceId: string | null }[] };
    expect(body.name).toBe('Xmas');
    expect(body.actions.every((a) => a.deviceId === null)).toBe(true);
  });

  it('reopens a saved pattern and updates it in place', async () => {
    const saved: PresetDto = {
      id: 'p1',
      name: 'Xmas',
      description: 'Red and white',
      needsTarget: true,
      createdAt: '',
      updatedAt: '',
      actions: [
        { id: 1, deviceId: null, deviceName: null, action: { type: 'power', on: true }, summary: '', order: 0 },
        { id: 2, deviceId: null, deviceName: null, action: { type: 'segmentColor', segments: Array.from({ length: 26 }, (_, i) => i + 1), hex: '#ffffff' }, summary: '', order: 1 },
        { id: 3, deviceId: null, deviceName: null, action: { type: 'segmentColor', segments: [0], hex: '#ff0000' }, summary: '', order: 2 },
      ],
    };
    const { calls } = mockApi({
      ...routes,
      'GET /presets': { json: { presets: [saved] } },
      'PATCH /presets/p1': { json: saved },
    });
    open('/patterns/p1');
    await waitFor(() => expect(screen.getByLabelText('Pattern name')).toHaveValue('Xmas'));
    expect(cell(0)).toHaveAccessibleName('Segment 0, #ff0000');
    expect(cell(1)).toHaveAccessibleName('Segment 1, #ffffff');
    await userEvent.click(screen.getByRole('button', { name: 'Save pattern' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.path).toBe('/presets/p1'));
    expect(await screen.findByText('Presets list')).toBeInTheDocument();
  });
});
