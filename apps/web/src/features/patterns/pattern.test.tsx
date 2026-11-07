import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type DeviceDetailDto, type PresetActionInput, type PresetDto } from '@glm/shared';
import { capabilities, device, mockApi, renderApp } from '../../test/fixtures';
import { PatternEditorPage } from './PatternEditorPage';
import {
  canvasCells,
  cellColor,
  cellKey,
  ledsInSegment,
  modelSize,
  clearPattern,
  emptyPattern,
  gradientFill,
  isPatternPreset,
  moveString,
  paintableDevices,
  paintCell,
  patternFromPreset,
  patternToActions,
  paintedSpan,
  repeatFill,
  repeatPainted,
  resolveStrings,
  serpentineRows,
  slowestStringCommands,
  toSettings,
  withLedCount,
  type PatternString,
} from './pattern-model';

afterEach(() => vi.unstubAllGlobals());

const string27 = (id: string, name: string, overrides: Partial<DeviceDetailDto> = {}) =>
  device({
    id,
    name,
    capabilities: [
      capabilities.power,
      { ...capabilities.segments, segments: Array.from({ length: 27 }, (_, i) => i), maxSelect: 27 },
    ],
    ...overrides,
  });
const left = string27('left', 'Outdoor Left');
const center = string27('center', 'Outdoor Center', { connectivity: 'offline' });
const right = string27('right', 'Outdoor Right');
const group = device({ id: 'group', name: 'Christmas', sku: 'SameModeGroup', isGoveeGroup: true, capabilities: [capabilities.power] });
const house = [right, group, center, left];
const options = { turnOn: false, brightness: null };
const colorSteps = (actions: PresetActionInput[]) => actions.filter((a) => a.action.type === 'segmentColor');

describe('recognising the strings', () => {
  it('finds everything paintable, and leaves out groups and missing lights', () => {
    const gone = string27('gone', 'Gone', { discoveryStatus: 'missing' });
    expect(paintableDevices([...house, gone]).map((d) => d.id).sort()).toEqual(['center', 'left', 'right']);
  });

  it('guesses left, center, right, then alphabetical, until arranged', () => {
    const others = [string27('z', 'Zebra'), string27('a', 'Apple')];
    expect(resolveStrings([...others, ...house], []).map((s) => s.name)).toEqual([
      'Outdoor Left',
      'Outdoor Center',
      'Outdoor Right',
      'Apple',
      'Zebra',
    ]);
  });

  it('keeps the saved order, with a new light joining at the end and a removed one dropping out', () => {
    const saved = [
      { deviceId: 'right', included: true, reversed: false },
      { deviceId: 'removed', included: true, reversed: false },
      { deviceId: 'left', included: false, reversed: true },
    ];
    const strings = resolveStrings(house, saved);
    expect(strings.map((s) => s.deviceId)).toEqual(['right', 'left', 'center']);
    expect(strings[1]).toMatchObject({ included: false, reversed: true });
    expect(strings[1]?.segments[0]).toBe(26);
    expect(strings[2]).toMatchObject({ included: true, reversed: false });
  });

  it('moves strings, stopping at the ends, and round trips the arrangement', () => {
    const strings = resolveStrings(house, []);
    const moved = moveString(strings, 'center', -1);
    expect(moved.map((s) => s.deviceId)).toEqual(['center', 'left', 'right']);
    expect(moveString(moved, 'center', -1)).toBe(moved);
    expect(resolveStrings(house, toSettings(moved)).map((s) => s.deviceId)).toEqual(['center', 'left', 'right']);
  });

  it('lays out every included string in series', () => {
    const strings = resolveStrings(house, [
      { deviceId: 'left', included: true, reversed: false },
      { deviceId: 'center', included: false, reversed: false },
      { deviceId: 'right', included: true, reversed: true },
    ]);
    const cells = canvasCells(strings);
    expect(cells).toHaveLength(54);
    expect(cells[0]).toMatchObject({ deviceId: 'left', segment: 0 });
    expect(cells[26]).toMatchObject({ deviceId: 'left', segment: 26 });
    expect(cells[27]).toMatchObject({ deviceId: 'right', segment: 26 });
    expect(cells[53]).toMatchObject({ deviceId: 'right', segment: 0 });
  });
});

describe('pattern model', () => {
  const strings = resolveStrings(house, []);
  const cells = canvasCells(strings);

  it('shows the background through unpainted and erased cells', () => {
    const key = cellKey('left', 1);
    let state = paintCell(emptyPattern('#ffffff'), key, '#ff0000');
    expect(cellColor(state, key)).toBe('#ff0000');
    expect(cellColor(state, cellKey('left', 0))).toBe('#ffffff');
    state = { ...state, background: '#000000' };
    expect(cellColor(state, cellKey('left', 0))).toBe('#000000');
    expect(cellColor(state, key)).toBe('#ff0000');
    state = paintCell(state, key, null);
    expect(cellColor(state, key)).toBe('#000000');
  });

  it('keeps paint with its string when strings are reordered or flipped', () => {
    const key = cellKey('right', 5);
    const state = paintCell(emptyPattern(), key, '#ff0000');
    const rearranged = resolveStrings(house, [{ deviceId: 'right', included: true, reversed: true }]);
    const painted = patternToActions(state, rearranged, options).find(
      (a) => a.deviceId === 'right' && a.action.type === 'segmentColor' && a.action.hex === '#ff0000',
    );
    expect(painted?.action).toMatchObject({ segments: [5] });
  });

  it('sends each string only its own segments, in one command per color', () => {
    let state = emptyPattern('#ffffff');
    state = paintCell(paintCell(state, cellKey('center', 3), '#ff0000'), cellKey('center', 9), '#ff0000');
    const actions = patternToActions(state, strings, options);
    expect(actions.filter((a) => a.deviceId === 'left')).toHaveLength(1);
    const middle = actions.filter((a) => a.deviceId === 'center');
    expect(middle).toHaveLength(2);
    expect(middle[1]?.action).toEqual({ type: 'segmentColor', hex: '#ff0000', segments: [3, 9] });
    expect(slowestStringCommands(actions)).toBe(2);
  });

  it('covers every segment of every string exactly once', () => {
    const state = repeatFill(emptyPattern(), cells, ['#ff0000', '#00ff00'], 2);
    for (const id of ['left', 'center', 'right']) {
      const covered = colorSteps(patternToActions(state, strings, options))
        .filter((a) => a.deviceId === id)
        .flatMap((a) => (a.action.type === 'segmentColor' ? a.action.segments : []));
      expect(covered.sort((a, b) => a - b)).toEqual(Array.from({ length: 27 }, (_, i) => i));
    }
  });

  it('carries a repeat and a gradient on from one string to the next', () => {
    const repeated = repeatFill(emptyPattern(), cells, ['#ff0000', '#00ff00'], 2);
    // Segment 26 and the next string's segment 0 fall in the same run of two.
    expect(cellColor(repeated, cellKey('left', 26))).toBe('#00ff00');
    expect(cellColor(repeated, cellKey('center', 0))).toBe('#00ff00');
    expect(cellColor(repeated, cellKey('center', 1))).toBe('#ff0000');
    const blended = gradientFill(emptyPattern(), cells, '#000000', '#ffffff');
    expect(cellColor(blended, cellKey('left', 0))).toBe('#000000');
    expect(cellColor(blended, cellKey('right', 26))).toBe('#ffffff');
    expect(cellColor(blended, cellKey('center', 13))).toBe('#808080');
  });

  it('splits a command when a device limits how many segments it can name', () => {
    const limited = strings.map((s) => ({ ...s, maxSelect: 10 }));
    const steps = patternToActions(emptyPattern(), limited, options).filter((a) => a.deviceId === 'left');
    expect(steps.map((a) => (a.action.type === 'segmentColor' ? a.action.segments.length : 0))).toEqual([10, 10, 7]);
  });

  it('turns each string on and sets brightness before any color', () => {
    const actions = patternToActions(emptyPattern(), strings, { turnOn: true, brightness: 40 }).filter((a) => a.deviceId === 'left');
    expect(actions.map((a) => a.action.type)).toEqual(['power', 'brightness', 'segmentColor']);
  });

  it('sends nothing to a string that is left out', () => {
    const without = strings.map((s) => (s.deviceId === 'center' ? { ...s, included: false } : s));
    expect(patternToActions(emptyPattern(), without, options).some((a) => a.deviceId === 'center')).toBe(false);
  });

  it('lays rows out as a zigzag', () => {
    expect(serpentineRows(7, 3)).toEqual([[0, 1, 2], [5, 4, 3], [6]]);
  });

  const presetOf = (actions: PresetActionInput[]): PresetDto => ({
    id: 'p',
    name: 'x',
    description: '',
    needsTarget: false,
    builtin: null,
    createdAt: '',
    updatedAt: '',
    actions: actions.map(({ deviceId, action }, order) => ({ id: order, deviceId, deviceName: deviceId, action, summary: '', order })),
  });

  it('survives saving and reopening, across strings', () => {
    let state = emptyPattern('#ffffff');
    state = paintCell(paintCell(state, cellKey('left', 2), '#ff0000'), cellKey('right', 26), '#00ff00');
    const preset = presetOf(patternToActions(state, strings, { turnOn: true, brightness: 50 }));
    expect(isPatternPreset(preset)).toBe(true);
    const loaded = patternFromPreset(preset, strings);
    expect(loaded).toMatchObject({ turnOn: true, brightness: 50, notShown: [] });
    for (const cell of cells) expect(cellColor(loaded.state, cell.key)).toBe(cellColor(state, cell.key));
    expect(cellColor(clearPattern(loaded.state), cellKey('left', 2))).toBe('#ffffff');
  });

  it('reports lights a saved pattern paints that are not shown, so saving cannot silently drop them', () => {
    const preset = presetOf(patternToActions(emptyPattern(), strings, options));
    const without = strings.map((s) => (s.deviceId === 'center' ? { ...s, included: false } : s));
    expect(patternFromPreset(preset, without).notShown).toEqual(['center']);
  });

  it('opens a pattern from the earlier version, which named no device, on every string', () => {
    const preset = presetOf([{ deviceId: null, action: { type: 'segmentColor', segments: [0], hex: '#ff0000' } }]);
    const loaded = patternFromPreset(preset, strings);
    expect(cellColor(loaded.state, cellKey('left', 0))).toBe('#ff0000');
    expect(cellColor(loaded.state, cellKey('right', 0))).toBe('#ff0000');
    expect(loaded.notShown).toEqual([]);
  });

  it('leaves ordinary presets to the ordinary editor', () => {
    expect(isPatternPreset(presetOf([{ deviceId: null, action: { type: 'power', on: true } }]))).toBe(false);
    expect(
      isPatternPreset(
        presetOf([
          { deviceId: null, action: { type: 'segmentColor', segments: [0], hex: '#ff0000' } },
          { deviceId: null, action: { type: 'color', hex: '#ff0000' } },
        ]),
      ),
    ).toBe(false);
  });
});

describe('repeating what was painted', () => {
  const strings = resolveStrings([left, center, right], []);
  const cells = canvasCells(strings);
  const RED = '#ff0000';
  const GREEN = '#00ff00';
  const key = (i: number) => cells[i]?.key as string;
  const colors = (state: ReturnType<typeof emptyPattern>) => cells.map((c) => state.cells[c.key] ?? null);
  const start = (...painted: [number, string][]) =>
    painted.reduce((state, [i, color]) => paintCell(state, key(i), color), emptyPattern());

  it('fills every box from a starting pattern, carrying on across the strings', () => {
    const result = colors(repeatPainted(start([0, RED], [1, RED], [2, GREEN]), cells));
    expect(result).toHaveLength(81);
    expect(result.every((color, i) => color === (i % 3 === 2 ? GREEN : RED))).toBe(true);
    expect(result[26]).toBe(GREEN); // End of the first string.
    expect(result[27]).toBe(RED); // Start of the next.
  });

  it('repeats blanks inside the pattern, so they keep showing the background', () => {
    const state = repeatPainted(start([0, RED], [2, GREEN]), cells);
    expect(colors(state).slice(0, 7)).toEqual([RED, null, GREEN, RED, null, GREEN, RED]);
    expect(cellColor({ ...state, background: '#000000' }, key(4))).toBe('#000000');
  });

  it('leaves the requested gap between copies', () => {
    expect(colors(repeatPainted(start([0, RED], [1, GREEN]), cells, 2)).slice(0, 8)).toEqual([RED, GREEN, null, null, RED, GREEN, null, null]);
  });

  it('keeps a pattern painted further along where it is, filling both directions', () => {
    const result = colors(repeatPainted(start([4, RED], [5, GREEN]), cells));
    expect(result.slice(0, 7)).toEqual([RED, GREEN, RED, GREEN, RED, GREEN, RED]);
    expect(result[80]).toBe(RED);
    const shifted = colors(repeatPainted(start([3, RED], [4, GREEN]), cells));
    expect(shifted.slice(3, 5)).toEqual([RED, GREEN]);
    expect(shifted[0]).toBe(GREEN);
  });

  it('follows the on-screen order of a flipped string', () => {
    const flipped = resolveStrings([left], [{ deviceId: 'left', included: true, reversed: true }]);
    const run = canvasCells(flipped);
    const state = repeatPainted(paintCell(paintCell(emptyPattern(), cellKey('left', 26), RED), cellKey('left', 25), GREEN), run);
    expect(state.cells[cellKey('left', 24)]).toBe(RED);
    expect(state.cells[cellKey('left', 23)]).toBe(GREEN);
    expect(state.cells[cellKey('left', 0)]).toBe(RED);
  });

  it('does not touch a string left out', () => {
    const shown = canvasCells(strings.map((s) => (s.deviceId === 'right' ? { ...s, included: false } : s)));
    const outside = paintCell(paintCell(emptyPattern(), cellKey('left', 0), RED), cellKey('right', 3), GREEN);
    const state = repeatPainted(outside, shown);
    expect(state.cells[cellKey('center', 26)]).toBe(RED);
    expect(state.cells[cellKey('right', 3)]).toBe(GREEN);
    expect(state.cells[cellKey('right', 4)]).toBeUndefined();
  });

  it('changes nothing when nothing is painted or nothing is left to fill', () => {
    const empty = emptyPattern();
    expect(repeatPainted(empty, cells)).toBe(empty);
    expect(paintedSpan(empty, cells)).toBe(0);
    const full = repeatPainted(start([0, RED]), cells);
    expect(paintedSpan(full, cells)).toBe(81);
    expect(repeatPainted(full, cells)).toBe(full);
  });

  it('still sends few commands, since each color is one command', () => {
    const state = repeatPainted(start([0, RED], [1, GREEN]), cells);
    expect(colorSteps(patternToActions(state, strings, options))).toHaveLength(6);
  });
});

describe('LEDs on a string', () => {
  const strings = resolveStrings([left], []);
  const string = strings[0] as PatternString;

  it('works out the count from the model', () => {
    expect(modelSize('H805C')).toEqual({ lengthFeet: 150, ledsPer100Feet: 72, leds: 108 });
    expect(modelSize('h805c')?.leds).toBe(108);
    expect(modelSize('H9999')).toBeNull();
    expect(string).toMatchObject({ sku: 'H805C', ledCount: 108, ledSource: 'model' });
  });

  it('gives each H805C segment 4 LEDs, covering all 108 exactly once, in order', () => {
    expect(ledsInSegment(string, 0)).toEqual([1, 2, 3, 4]);
    expect(ledsInSegment(string, 26)).toEqual([105, 106, 107, 108]);
    const all = string.segments.flatMap((segment) => ledsInSegment(string, segment));
    expect(all).toEqual(Array.from({ length: 108 }, (_, i) => i + 1));
  });

  it('keeps LEDs tied to their segment when a string is flipped', () => {
    const flipped = resolveStrings([left], [{ deviceId: 'left', included: true, reversed: true }])[0] as PatternString;
    expect(flipped.segments[0]).toBe(26);
    expect(ledsInSegment(flipped, 26)).toEqual([108, 107, 106, 105]);
    expect(ledsInSegment(flipped, 0)).toEqual([4, 3, 2, 1]);
  });

  it('spreads LEDs that do not divide evenly, losing none', () => {
    const uneven = { ...string, ledCount: 100 };
    const sizes = string.segments.map((segment) => ledsInSegment(uneven, segment).length);
    expect(sizes.reduce((a, b) => a + b)).toBe(100);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBe(1);
  });

  it('never allows fewer LEDs than segments, since each segment needs one', () => {
    const saved = resolveStrings([left], [{ deviceId: 'left', included: true, reversed: false, ledCount: 5 }])[0] as PatternString;
    expect(saved).toMatchObject({ ledCount: 27, ledSource: 'owner' });
    expect(withLedCount(strings, 'left', 3)[0]).toMatchObject({ ledCount: 27, ledSource: 'owner' });
  });

  it('only saves a count the owner set, and goes back to the model when cleared', () => {
    expect(toSettings(strings)[0]).toEqual({ deviceId: 'left', included: true, reversed: false });
    const set = withLedCount(strings, 'left', 54);
    expect(toSettings(set)[0]).toEqual({ deviceId: 'left', included: true, reversed: false, ledCount: 54 });
    expect(withLedCount(set, 'left', null)[0]).toMatchObject({ ledCount: 108, ledSource: 'model' });
  });

  it('changes nothing about what is sent to the lights', () => {
    const state = paintCell(emptyPattern(), cellKey('left', 0), '#ff0000');
    const withoutCount = patternToActions(state, [{ ...string, ledCount: null, ledSource: null }], options);
    expect(patternToActions(state, strings, options)).toEqual(withoutCount);
  });
});

describe('pattern editor', () => {
  const routes = {
    'GET /devices': { json: { devices: house } },
    'POST /devices/refresh-due': { json: { devices: house } },
    'GET /settings': { json: DEFAULT_SETTINGS },
    'PATCH /settings': (body: unknown) => ({ json: { ...DEFAULT_SETTINGS, ...(body as object) } }),
    'GET /presets': { json: { presets: [] } },
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
  const ready = () => screen.findByText('3 light strings found');
  const setColor = (label: string, hex: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: hex } });
  const cell = (name: string, segment: number) => screen.getByRole('button', { name: new RegExp(`^${name} segment ${segment},`) });

  it('says how many strings it found, and shows them all in series', async () => {
    mockApi(routes);
    open();
    await ready();
    expect(screen.getByText('81 segments across 3 strings.', { exact: false })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /segment \d+,/ })).toHaveLength(81);
    const titles = screen.getAllByText(/^\d\. Outdoor/).map((e) => e.textContent);
    expect(titles[0]).toContain('1. Outdoor Left');
    expect(titles[1]).toContain('2. Outdoor Center');
    expect(titles[2]).toContain('3. Outdoor Right');
  });

  it('draws one box per LED, worked out from the model, and says where the count comes from', async () => {
    mockApi(routes);
    const { container } = open();
    await ready();
    expect(container.querySelectorAll('[data-led]')).toHaveLength(324);
    expect(screen.getByText('324 LEDs in 81 segments across 3 strings.', { exact: false })).toBeInTheDocument();
    expect(screen.getAllByText('H805C: 150 ft at about 72 LEDs per 100 ft.')).toHaveLength(3);
    expect(screen.getByText(/can only color whole segments/)).toBeInTheDocument();
  });

  it('colors every LED in a segment together, because that is what the lights will do', async () => {
    mockApi(routes);
    const { container } = open();
    await ready();
    setColor('Fill color', '#ff0000');
    const led = cell('Outdoor Left', 0).querySelector('[data-led="3"]') as HTMLElement;
    fireEvent.pointerDown(led);
    fireEvent.pointerUp(window);
    const boxes = [...cell('Outdoor Left', 0).querySelectorAll<HTMLElement>('[data-led]')];
    expect(boxes.map((b) => b.dataset.led)).toEqual(['1', '2', '3', '4']);
    for (const box of boxes) expect(box.style.backgroundColor).toBe('rgb(255, 0, 0)');
    const next = container.querySelector('[data-cell="left:1"] [data-led]') as HTMLElement;
    expect(next.style.backgroundColor).toBe('rgb(255, 255, 255)');
  });

  describe('the Repeat button', () => {
    const repeatButton = () => screen.getByRole('button', { name: 'Repeat' });
    const paint = (name: string, segment: number) => {
      fireEvent.pointerDown(cell(name, segment));
      fireEvent.pointerUp(window);
    };
    const label = (name: string, segment: number) => cell(name, segment).getAttribute('aria-label') as string;

    it('stays off until something is painted', async () => {
      mockApi(routes);
      open();
      await ready();
      expect(repeatButton()).toBeDisabled();
      expect(screen.getByText(/Paint the start of your pattern/)).toBeInTheDocument();
    });

    it('fills the rest of the boxes in one click, and Undo brings back the original', async () => {
      mockApi(routes);
      open();
      await ready();
      setColor('Fill color', '#ff0000');
      paint('Outdoor Left', 0);
      setColor('Fill color', '#00ff00');
      paint('Outdoor Left', 1);
      expect(label('Outdoor Left', 2)).toContain('#ffffff');
      await userEvent.click(repeatButton());
      expect(label('Outdoor Left', 2)).toContain('#ff0000');
      expect(label('Outdoor Left', 3)).toContain('#00ff00');
      expect(label('Outdoor Right', 26)).toContain('#ff0000');
      expect(screen.getByText(/Your 2-segment pattern now repeats along all 81 segments/)).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
      expect(label('Outdoor Left', 2)).toContain('#ffffff');
      expect(label('Outdoor Left', 1)).toContain('#00ff00');
    });

    it('can be pressed again with a different gap, starting from the original pattern', async () => {
      mockApi(routes);
      open();
      await ready();
      setColor('Fill color', '#ff0000');
      paint('Outdoor Left', 0);
      await userEvent.click(repeatButton());
      expect(label('Outdoor Left', 1)).toContain('#ff0000');
      fireEvent.change(screen.getByRole('spinbutton', { name: 'Segments left blank between repeats' }), { target: { value: '1' } });
      await userEvent.click(repeatButton());
      expect(label('Outdoor Left', 1)).toContain('#ffffff');
      expect(label('Outdoor Left', 2)).toContain('#ff0000');
    });

    it('treats the result as a new pattern once it has been repainted', async () => {
      mockApi(routes);
      open();
      await ready();
      setColor('Fill color', '#ff0000');
      paint('Outdoor Left', 0);
      await userEvent.click(repeatButton());
      setColor('Fill color', '#0000ff');
      paint('Outdoor Left', 5);
      await userEvent.click(repeatButton());
      expect(label('Outdoor Left', 5)).toContain('#0000ff');
      expect(label('Outdoor Left', 0)).toContain('#ff0000');
    });
  });

  describe('one color for everything', () => {
    const allBoxes = () => screen.getAllByRole('button', { name: /segment \d+,/ }).map((b) => (b.getAttribute('aria-label') as string).slice(-7));
    const colorAll = () => userEvent.click(screen.getByRole('button', { name: 'Color all 3 strings' }));

    it('colors every box on every string, replacing what was painted', async () => {
      mockApi(routes);
      open();
      await ready();
      setColor('Fill color', '#ff0000');
      fireEvent.pointerDown(cell('Outdoor Left', 0));
      fireEvent.pointerUp(window);
      setColor('One color for everything', '#00ff00');
      await colorAll();
      expect(allBoxes()).toHaveLength(81);
      expect(new Set(allBoxes())).toEqual(new Set(['#00ff00']));
      await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
      expect(cell('Outdoor Left', 0).getAttribute('aria-label')).toContain('#ff0000');
      expect(cell('Outdoor Left', 1).getAttribute('aria-label')).toContain('#ffffff');
    });

    it('sends each string one color command, and only when Send is pressed', async () => {
      const { calls } = mockApi(routes);
      open();
      await ready();
      setColor('One color for everything', '#0000ff');
      await colorAll();
      expect(calls.some((c) => c.path === '/presets/apply-draft')).toBe(false);
      await userEvent.click(screen.getByRole('checkbox', { name: 'Turn the lights on first' }));
      await userEvent.click(screen.getByRole('button', { name: 'Send to 3 strings' }));
      await waitFor(() => expect(calls.some((c) => c.path === '/presets/apply-draft')).toBe(true));
      const body = calls.find((c) => c.path === '/presets/apply-draft')?.body as { actions: PresetActionInput[] };
      expect(body.actions).toHaveLength(3);
      for (const step of body.actions) expect(step.action).toMatchObject({ type: 'segmentColor', hex: '#0000ff' });
    });

    it('leaves later painting as the pattern that Repeat copies', async () => {
      mockApi(routes);
      open();
      await ready();
      setColor('One color for everything', '#0000ff');
      await colorAll();
      expect(screen.getByRole('button', { name: 'Repeat' })).toBeDisabled();
      setColor('Fill color', '#ff0000');
      fireEvent.pointerDown(cell('Outdoor Left', 0));
      fireEvent.pointerUp(window);
      expect(cell('Outdoor Left', 1).getAttribute('aria-label')).toContain('#0000ff');
      expect(screen.getByRole('button', { name: 'Repeat' })).toBeEnabled();
    });

    it('names just the one string when only one is shown', async () => {
      mockApi({ ...routes, 'GET /devices': { json: { devices: [left] } } });
      open();
      await screen.findByText('1 light string found');
      expect(screen.getByRole('button', { name: 'Color all of this string' })).toBeInTheDocument();
    });
  });

  it('links to the light check from the send area', async () => {
    mockApi(routes);
    open();
    await ready();
    expect(screen.getByRole('link', { name: 'LEDs look wrong?' })).toHaveAttribute('href', '/patterns/check');
  });

  it('keeps the LEDs in string order along rows that run right to left', async () => {
    mockApi(routes);
    const { container } = open();
    await ready();
    const numbers = (segment: number) =>
      [...container.querySelectorAll<HTMLElement>(`[data-cell="left:${segment}"] [data-led]`)].map((b) => Number(b.dataset.led));
    expect(numbers(5)).toEqual([21, 22, 23, 24]); // First row, left to right.
    expect(numbers(6)).toEqual([28, 27, 26, 25]); // Second row, right to left.
  });

  it('lets the owner correct the count for a string that was cut or extended, and remembers it', async () => {
    const { calls } = mockApi(routes);
    const { container } = open();
    await ready();
    const input = screen.getByRole('spinbutton', { name: 'LEDs on Outdoor Left' });
    fireEvent.change(input, { target: { value: '54' } });
    fireEvent.blur(input);
    await waitFor(() => expect(container.querySelectorAll('[data-cell^="left:"] [data-led]')).toHaveLength(54));
    let saved = calls.filter((c) => c.method === 'PATCH' && c.path === '/settings').at(-1)?.body as { patternStrings: { deviceId: string; ledCount?: number }[] };
    expect(saved.patternStrings.find((s) => s.deviceId === 'left')?.ledCount).toBe(54);
    expect(saved.patternStrings.find((s) => s.deviceId === 'right')).not.toHaveProperty('ledCount');
    expect(screen.getByText('You set this.')).toBeInTheDocument();

    const again = screen.getByRole('spinbutton', { name: 'LEDs on Outdoor Left' });
    fireEvent.change(again, { target: { value: '' } });
    fireEvent.blur(again);
    await waitFor(() => expect(container.querySelectorAll('[data-cell^="left:"] [data-led]')).toHaveLength(108));
    saved = calls.filter((c) => c.method === 'PATCH' && c.path === '/settings').at(-1)?.body as typeof saved;
    expect(saved.patternStrings.find((s) => s.deviceId === 'left')).not.toHaveProperty('ledCount');
  });

  it('falls back to one box per segment, and says so, for a model with no known size', async () => {
    const unknown = [string27('other', 'Patio', { sku: 'H9999' })];
    mockApi({ ...routes, 'GET /devices': { json: { devices: unknown } } });
    const { container } = open();
    await screen.findByText('1 light string found');
    expect(container.querySelectorAll('[data-led]')).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: /segment \d+,/ })).toHaveLength(27);
    expect(screen.getByText(/Count them and enter it/)).toBeInTheDocument();
    expect(screen.queryByText(/can only color whole segments/)).not.toBeInTheDocument();
  });

  it('flags an offline string, and explains why a group is not shown', async () => {
    mockApi(routes);
    open();
    await ready();
    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(screen.getByText(/Not shown: Christmas/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Christmas segment/ })).not.toBeInTheDocument();
  });

  it('checks current status on opening, and re-checks with Govee on request', async () => {
    const { calls } = mockApi({ ...routes, 'POST /devices/discover': { json: { total: 3, added: 0, updated: 3, noLongerDiscovered: 0, discoveredAt: '', devices: house } } });
    open();
    await ready();
    await waitFor(() => expect(calls.some((c) => c.path === '/devices/refresh-due')).toBe(true));
    await userEvent.click(screen.getByRole('button', { name: 'Check for lights' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/devices/discover')).toBe(true));
    expect(await screen.findByText('Light list updated from Govee.')).toBeInTheDocument();
  });

  it('remembers a new order, flip and left-out string on the server', async () => {
    const { calls } = mockApi(routes);
    open();
    await ready();
    await userEvent.click(screen.getByRole('button', { name: 'Move Outdoor Right earlier' }));
    await waitFor(() => expect(screen.getAllByText(/^\d\. Outdoor/)[1]?.textContent).toContain('2. Outdoor Right'));
    await userEvent.click(screen.getByRole('button', { name: 'Flip Outdoor Left' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Include Outdoor Center' }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: /segment \d+,/ })).toHaveLength(54));

    const saves = calls.filter((c) => c.method === 'PATCH' && c.path === '/settings');
    expect(saves.at(-1)?.body).toEqual({
      patternStrings: [
        { deviceId: 'left', included: true, reversed: true },
        { deviceId: 'right', included: true, reversed: false },
        { deviceId: 'center', included: false, reversed: false },
      ],
    });
    // Flipped, the first cell on screen is the far end of the string.
    const firstCell = screen.getAllByRole('button', { name: /segment \d+,/ })[0];
    expect(firstCell).toHaveAccessibleName('Outdoor Left segment 26, LEDs 105 to 108, #ffffff');
  });

  it('lets a drag cross from one string to the next, as one undo', async () => {
    mockApi(routes);
    open();
    await ready();
    setColor('Fill color', '#ff0000');
    fireEvent.pointerDown(cell('Outdoor Left', 26));
    fireEvent.pointerMove(cell('Outdoor Center', 0));
    fireEvent.pointerUp(window);
    expect(cell('Outdoor Left', 26)).toHaveAccessibleName('Outdoor Left segment 26, LEDs 105 to 108, #ff0000');
    expect(cell('Outdoor Center', 0)).toHaveAccessibleName('Outdoor Center segment 0, LEDs 1 to 4, #ff0000');
    expect(cell('Outdoor Right', 0)).toHaveAccessibleName('Outdoor Right segment 0, LEDs 1 to 4, #ffffff');

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(cell('Outdoor Left', 26)).toHaveAccessibleName('Outdoor Left segment 26, LEDs 105 to 108, #ffffff');
    expect(cell('Outdoor Center', 0)).toHaveAccessibleName('Outdoor Center segment 0, LEDs 1 to 4, #ffffff');
    await userEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(cell('Outdoor Center', 0)).toHaveAccessibleName('Outdoor Center segment 0, LEDs 1 to 4, #ff0000');

    await userEvent.click(screen.getByRole('button', { name: 'Erase' }));
    fireEvent.pointerDown(cell('Outdoor Center', 0));
    fireEvent.pointerUp(window);
    expect(cell('Outdoor Center', 0)).toHaveAccessibleName('Outdoor Center segment 0, LEDs 1 to 4, #ffffff');
    expect(cell('Outdoor Left', 26)).toHaveAccessibleName('Outdoor Left segment 26, LEDs 105 to 108, #ff0000');
  });

  it('can be painted from the keyboard', async () => {
    mockApi(routes);
    open();
    await ready();
    setColor('Fill color', '#00ff00');
    cell('Outdoor Right', 5).focus();
    await userEvent.keyboard('{Enter}');
    expect(cell('Outdoor Right', 5)).toHaveAccessibleName('Outdoor Right segment 5, LEDs 21 to 24, #00ff00');
  });

  it('sends each string its own commands, says how long, and is honest about the result', async () => {
    const { calls } = mockApi({
      ...routes,
      'POST /presets/apply-draft': {
        json: {
          runId: 'r',
          sourceType: 'preset',
          sourceId: null,
          sourceName: 'Pattern preview',
          status: 'partial',
          startedAt: '2026-11-07T00:00:00.000Z',
          completedAt: '2026-11-07T00:00:01.000Z',
          outcomes: [
            { deviceId: 'left', deviceName: 'Outdoor Left', actionType: 'segmentColor', summary: 'Set segments', status: 'accepted', commandId: 'c', verification: 'unverified', reason: null, errorCategory: null },
            { deviceId: 'center', deviceName: 'Outdoor Center', actionType: 'segmentColor', summary: 'Set segments', status: 'failed', commandId: 'd', verification: 'not_applicable', reason: 'Timed out', errorCategory: 'timeout' },
          ],
        },
      },
    });
    open();
    await ready();
    setColor('Fill color', '#ff0000');
    await userEvent.click(screen.getByRole('button', { name: 'Alternate colors' }));
    expect(screen.getByText(/This takes about 5 seconds: 9 commands, plus a base color, across 3 strings/)).toBeInTheDocument();
    expect(screen.getByText(/not in perfect sync/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Send to 3 strings' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/presets/apply-draft')).toBeTruthy());
    const body = calls.find((c) => c.path === '/presets/apply-draft')?.body as { actions: PresetActionInput[]; target?: unknown };
    expect(body.target).toBeUndefined();
    expect([...new Set(body.actions.map((a) => a.deviceId))]).toEqual(['left', 'center', 'right']);
    expect(await screen.findByText('Partly accepted')).toBeInTheDocument();
    expect(screen.getByText(/cannot confirm the pattern/)).toBeInTheDocument();
    expect(screen.queryByText(/^Confirmed/)).not.toBeInTheDocument();
  });

  it('cannot send or paint with no strings included', async () => {
    mockApi(routes);
    open();
    await ready();
    for (const name of ['Left', 'Center', 'Right']) {
      await userEvent.click(screen.getByRole('checkbox', { name: `Include Outdoor ${name}` }));
    }
    expect(await screen.findByText('Include at least one string above to start painting.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send to 0 strings' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save pattern' })).toBeDisabled();
  });

  it('explains when no light reports segments, without offering a fake editor', async () => {
    mockApi({ ...routes, 'GET /devices': { json: { devices: [group] } } });
    open();
    expect(await screen.findByText('No light here reports segment control')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /segment \d+,/ })).not.toBeInTheDocument();
  });

  it('is upfront that moving effects are not available', async () => {
    mockApi(routes);
    open();
    expect(await screen.findByText('Moving effects are not available here')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /clockwise|twinkle|breathe/i })).not.toBeInTheDocument();
  });

  it('saves steps tied to each string, and shows a save error', async () => {
    const { calls } = mockApi({
      ...routes,
      'POST /presets': { status: 409, json: { error: { code: 'name_taken', message: 'A preset named "Xmas" already exists.' } } },
    });
    open();
    await ready();
    await userEvent.type(screen.getByLabelText('Pattern name'), 'Xmas');
    await userEvent.click(screen.getByRole('button', { name: 'Save pattern' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/already exists/)).toBeInTheDocument();
    const body = calls.find((c) => c.path === '/presets' && c.method === 'POST')?.body as { name: string; actions: PresetActionInput[] };
    expect(body.name).toBe('Xmas');
    expect([...new Set(body.actions.map((a) => a.deviceId))]).toEqual(['left', 'center', 'right']);
  });

  it('reopens a saved pattern and updates it in place', async () => {
    const whole = (deviceId: string, hex: string, segments: number[], id: number) => ({
      id,
      deviceId,
      deviceName: deviceId,
      action: { type: 'segmentColor' as const, segments, hex },
      summary: '',
      order: id,
    });
    const allButFirst = Array.from({ length: 26 }, (_, i) => i + 1);
    const saved: PresetDto = {
      id: 'p1',
      name: 'Xmas',
      description: 'Red and white',
      needsTarget: false,
      builtin: null,
      createdAt: '',
      updatedAt: '',
      actions: [
        { id: 0, deviceId: 'left', deviceName: 'left', action: { type: 'power', on: true }, summary: '', order: 0 },
        whole('left', '#ffffff', allButFirst, 1),
        whole('left', '#ff0000', [0], 2),
        whole('center', '#ffffff', [...allButFirst, 0], 3),
        whole('right', '#ffffff', [...allButFirst, 0], 4),
      ],
    };
    const { calls } = mockApi({
      ...routes,
      'GET /presets': { json: { presets: [saved] } },
      'PATCH /presets/p1': { json: saved },
    });
    open('/patterns/p1');
    await waitFor(() => expect(screen.getByLabelText('Pattern name')).toHaveValue('Xmas'));
    expect(cell('Outdoor Left', 0)).toHaveAccessibleName('Outdoor Left segment 0, LEDs 1 to 4, #ff0000');
    expect(cell('Outdoor Left', 1)).toHaveAccessibleName('Outdoor Left segment 1, LEDs 5 to 8, #ffffff');
    await userEvent.click(screen.getByRole('button', { name: 'Save pattern' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH' && c.path === '/presets/p1')).toBeTruthy());
    expect(await screen.findByText('Presets list')).toBeInTheDocument();
  });
});
