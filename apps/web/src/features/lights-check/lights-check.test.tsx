import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type DeviceDetailDto, type PresetActionInput } from '@glm/shared';
import { capabilities, device, mockApi, renderApp } from '../../test/fixtures';
import { resolveStrings, type PatternString } from '../patterns/pattern-model';
import { LightsCheckPage } from './LightsCheckPage';
import { describeRanges, diagnoseLights, lightsReport, markedLeds, markedSegments, markKey, markPattern, testActions } from './lights-check-model';

afterEach(() => vi.unstubAllGlobals());

const string27 = (id: string, name: string, overrides: Partial<DeviceDetailDto> = {}) =>
  device({
    id,
    name,
    capabilities: [capabilities.power, capabilities.color, { ...capabilities.segments, segments: Array.from({ length: 27 }, (_, i) => i), maxSelect: 27 }],
    ...overrides,
  });
const left = string27('left', 'Outdoor Left');
const right = string27('right', 'Outdoor Right');
const strings = resolveStrings([left, right], []);
const one = strings[0] as PatternString;

const marksFor = (...leds: number[]) => new Set(leds.map((led) => markKey('left', led)));

describe('the tests that are sent', () => {
  it('Test 1 uses a whole-string color and no segment commands', () => {
    const steps = testActions('whole', strings).filter((s) => s.deviceId === 'left');
    expect(steps.map((s) => s.action)).toEqual([{ type: 'power', on: true }, { type: 'color', hex: '#ff0000' }]);
  });

  it('Test 2 names every segment', () => {
    const steps = testActions('segments', strings).filter((s) => s.deviceId === 'left' && s.action.type === 'segmentColor');
    expect(steps).toHaveLength(1);
    expect(steps[0]?.action).toMatchObject({ hex: '#0000ff', segments: Array.from({ length: 27 }, (_, i) => i) });
  });

  it('Test 3 uses three colors, one per segment, covering each segment once', () => {
    const steps = testActions('blocks', strings).filter((s) => s.deviceId === 'left').flatMap((s) => (s.action.type === 'segmentColor' ? [s.action] : []));
    expect(steps.map((s) => s.hex)).toEqual(['#ff0000', '#00c000', '#0000ff']);
    expect(steps[0]?.segments.slice(0, 3)).toEqual([0, 3, 6]);
    expect(steps.flatMap((s) => s.segments).sort((a, b) => a - b)).toEqual(Array.from({ length: 27 }, (_, i) => i));
  });

  it('respects a light’s limit on segments per command', () => {
    const limited = { ...one, maxSelect: 10 };
    const steps = testActions('segments', [limited]).flatMap((s) => (s.action.type === 'segmentColor' ? [s.action.segments.length] : []));
    expect(steps).toEqual([10, 10, 7]);
  });

  it('numbers segments in string order, even on a flipped string', () => {
    const flipped = resolveStrings([left], [{ deviceId: 'left', included: true, reversed: true }]);
    const steps = testActions('blocks', flipped).flatMap((s) => (s.action.type === 'segmentColor' ? [s.action] : []));
    expect(steps[0]?.segments[0]).toBe(0);
  });
});

describe('marked LEDs', () => {
  it('finds the marked LEDs and their segments', () => {
    const marks = marksFor(5, 6, 16);
    expect(markedLeds(one, marks)).toEqual([5, 6, 16]);
    expect(markedSegments(one, marks)).toEqual([1, 3]);
  });

  it('writes ranges plainly', () => {
    expect(describeRanges([1, 2, 3, 7, 9, 10])).toBe('1 to 3, 7, 9 to 10');
    expect(describeRanges([4])).toBe('4');
  });

  it('notices marks that follow whole segments', () => {
    expect(markPattern(one, marksFor(5, 6, 7, 8))?.wholeSegments).toBe(true);
    expect(markPattern(one, marksFor(5, 6))?.wholeSegments).toBe(false);
  });

  it('notices marks running to the end of the string', () => {
    const tail = Array.from({ length: 12 }, (_, i) => 97 + i);
    expect(markPattern(one, marksFor(...tail))?.reachesEnd).toBe(true);
    expect(markPattern(one, marksFor(50, 51))?.reachesEnd).toBe(false);
    expect(markPattern(one, marksFor(...Array.from({ length: 108 }, (_, i) => i + 1)))?.reachesEnd).toBe(false);
  });

  it('notices marks within one 12-LED section', () => {
    expect(markPattern(one, marksFor(13, 24))?.oneSection).toBe(true);
    expect(markPattern(one, marksFor(12, 13))?.oneSection).toBe(false);
  });

  it('notices when only higher segment numbers are affected', () => {
    const high = Array.from({ length: 108 - 64 }, (_, i) => 65 + i); // Segment 16 and up.
    expect(markPattern(one, marksFor(...high))?.fromSegment).toBe(16);
    expect(markPattern(one, marksFor(5, 6))?.fromSegment).toBeNull();
  });

  it('returns nothing when none are marked', () => {
    expect(markPattern(one, new Set())).toBeNull();
  });
});

describe('the diagnosis', () => {
  it('waits until there is enough to say', () => {
    expect(diagnoseLights({}, null, strings, new Set())).toBeNull();
    expect(diagnoseLights({ whole: 'good' }, null, strings, new Set())).toBeNull();
  });

  it('points at the hardware when even a whole-string color misses LEDs', () => {
    const result = diagnoseLights({ whole: 'bad' }, null, strings, marksFor(13, 14));
    expect(result?.title).toContain("don't respond even when the whole string");
    expect(result?.steps.join(' ')).toContain('12-LED section');
  });

  it('points at a connector when everything from one LED onward is wrong', () => {
    const tail = Array.from({ length: 30 }, (_, i) => 79 + i);
    expect(diagnoseLights({ whole: 'bad' }, null, strings, marksFor(...tail))?.steps[0]).toContain('connector');
  });

  it('points at segment commands when only those miss', () => {
    const high = Array.from({ length: 44 }, (_, i) => 65 + i);
    const result = diagnoseLights({ whole: 'good', segments: 'bad' }, null, strings, marksFor(...high));
    expect(result?.title).toContain('segment command misses');
    expect(result?.steps[0]).toContain('segment 16 and above');
  });

  it('points at the LED count when the blocks are a different size', () => {
    const result = diagnoseLights({ whole: 'good', segments: 'good', blocks: 'good' }, 6, strings, new Set());
    expect(result?.explanation).toContain('counted 6');
    expect(result?.steps[0]).toContain('162');
  });

  it('says plainly that an all-clear does not prove the cause', () => {
    const result = diagnoseLights({ whole: 'good', segments: 'good', blocks: 'good' }, 4, strings, new Set());
    expect(result?.title).toBe('Everything responded in these tests');
    expect(result?.explanation).toContain("isn't proven");
  });
});

describe('the report', () => {
  it('says what was seen, with no device identifiers', () => {
    const report = lightsReport({ whole: 'good', segments: 'bad' }, null, strings, marksFor(5, 6, 7, 8));
    expect(report).toContain('Whole-string red: all correct');
    expect(report).toContain('Segment blue: some wrong');
    expect(report).toContain('Color blocks: not run');
    expect(report).toContain('Outdoor Left (H805C, 108 LEDs, flipped: no): LEDs 5 to 8, segments 1');
    expect(report).toContain('Outdoor Right (H805C, 108 LEDs, flipped: no): none marked');
    expect(report).not.toContain('left:');
  });
});

describe('the page', () => {
  const routes = {
    'GET /devices': { json: { devices: [left, right] } },
    'GET /settings': { json: DEFAULT_SETTINGS },
    'POST /presets/apply-draft': { json: { runId: 'r', status: 'all_accepted', outcomes: [] } },
  };
  const applied = (calls: { path: string; body?: unknown }[]) =>
    calls.filter((c) => c.path === '/presets/apply-draft').map((c) => c.body as { name: string; plainSegments: boolean; actions: PresetActionInput[] });

  it('is plain that it cannot read the LEDs', async () => {
    mockApi(routes);
    renderApp(<LightsCheckPage />);
    expect(await screen.findByText(/can't report what color a segment or LED is showing/)).toBeInTheDocument();
  });

  it('sends nothing until asked, and turns the base color off for the tests', async () => {
    const { calls } = mockApi(routes);
    renderApp(<LightsCheckPage />);
    const sends = await screen.findAllByRole('button', { name: 'Send to 2 strings' });
    expect(applied(calls)).toEqual([]);
    await userEvent.click(sends[1] as HTMLElement);
    await waitFor(() => expect(applied(calls)).toHaveLength(1));
    expect(applied(calls)[0]?.plainSegments).toBe(true);
    expect(applied(calls)[0]?.name).toContain('Test 2');
  });

  it('asks what you saw only after sending, then lets you mark LEDs and resend', async () => {
    const { calls } = mockApi(routes);
    renderApp(<LightsCheckPage />);
    const sends = await screen.findAllByRole('button', { name: 'Send to 2 strings' });
    expect(screen.queryByText('Is every LED blue?')).not.toBeInTheDocument();
    await userEvent.click(sends[1] as HTMLElement);
    await userEvent.click(await screen.findByRole('button', { name: 'Some are not blue' }));
    const led = await screen.findByRole('button', { name: 'Outdoor Left LED 6, segment 1' });
    expect(screen.getAllByRole('button', { name: /^Outdoor Left LED \d+,/ })).toHaveLength(108);
    fireEvent.click(led);
    expect(led).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Outdoor Left: LEDs 6, in segment 1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Resend marked segments' }));
    await waitFor(() => expect(applied(calls)).toHaveLength(2));
    expect(applied(calls)[1]?.actions).toEqual([{ deviceId: 'left', action: { type: 'segmentColor', hex: '#0000ff', segments: [1] } }]);
    expect((screen.getByRole('textbox', { name: 'Light check report' }) as HTMLTextAreaElement).value).toContain('LEDs 6, segments 1');
  });
});
