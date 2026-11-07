import { describe, expect, it } from 'vitest';
import { BUILTIN_PRESETS, builtinPresetActions, FESTIVAL_PRESETS, FIREWORKS_PRESET, orderLightStrings, type BuiltinString } from './festival-presets.js';
import { isHexColor } from './color.js';
import { presetCreateSchema } from './schemas.js';

const string = (deviceId: string, segments: number, overrides: Partial<BuiltinString> = {}): BuiltinString => ({
  deviceId,
  segments: Array.from({ length: segments }, (_, i) => i),
  maxSelect: segments,
  hasBrightness: true,
  findScene: () => null,
  ...overrides,
});

describe('the festival catalog', () => {
  it('has exactly 20 festival presets, with unique keys and names', () => {
    expect(FESTIVAL_PRESETS).toHaveLength(20);
    expect(new Set(BUILTIN_PRESETS.map((p) => p.key)).size).toBe(21);
    expect(new Set(BUILTIN_PRESETS.map((p) => p.name.toLowerCase())).size).toBe(21);
  });

  it('covers every occasion asked for, including the days around New Year', () => {
    const occasions = new Set(FESTIVAL_PRESETS.map((p) => p.occasion));
    expect([...occasions]).toEqual(['November', 'Veterans Day', 'Thanksgiving', 'December', 'Christmas', 'New Year']);
    const newYear = FESTIVAL_PRESETS.filter((p) => p.occasion === 'New Year').map((p) => p.when);
    expect(newYear).toEqual(['December 31, the day before', 'January 1', 'January 2, the day after']);
  });

  it('uses only valid colors, and each is a valid preset', () => {
    for (const preset of BUILTIN_PRESETS) {
      expect(preset.colors.length).toBeGreaterThan(0);
      expect(preset.colors.every(isHexColor), preset.name).toBe(true);
      const actions = builtinPresetActions(preset, [string('a', 27), string('b', 27)]);
      expect(presetCreateSchema.safeParse({ name: preset.name, description: preset.description, actions }).success, preset.name).toBe(true);
    }
  });
});

describe('building the steps', () => {
  it('repeats the colors along the run, carrying on across strings', () => {
    const preset = { ...FESTIVAL_PRESETS[0]!, sceneName: undefined, colors: ['#ff0000', '#00ff00', '#0000ff'] } as typeof FIREWORKS_PRESET;
    const steps = builtinPresetActions(preset, [string('a', 4), string('b', 2)]);
    const color = (deviceId: string, segment: number) =>
      steps.flatMap((s) => (s.deviceId === deviceId && s.action.type === 'segmentColor' && s.action.segments.includes(segment) ? [s.action.hex] : []))[0];
    expect([0, 1, 2, 3].map((s) => color('a', s))).toEqual(['#ff0000', '#00ff00', '#0000ff', '#ff0000']);
    expect([0, 1].map((s) => color('b', s))).toEqual(['#00ff00', '#0000ff']);
  });

  it('splits a command when a light limits how many segments one can name', () => {
    const preset = { ...FESTIVAL_PRESETS[0]!, sceneName: undefined, colors: ['#ff0000'] } as typeof FIREWORKS_PRESET;
    const steps = builtinPresetActions(preset, [string('a', 25, { maxSelect: 10 })]);
    expect(steps.flatMap((s) => (s.action.type === 'segmentColor' ? [s.action.segments.length] : []))).toEqual([10, 10, 5]);
  });

  it('turns the light on first, and uses the effect where one is offered', () => {
    const steps = builtinPresetActions(FIREWORKS_PRESET, [
      string('a', 27, { findScene: (name) => (name === 'Fireworks' ? { key: 'k', name } : null) }),
      string('b', 27),
    ]);
    expect(steps.filter((s) => s.deviceId === 'a').map((s) => s.action.type)).toEqual(['power', 'brightness', 'scene']);
    expect(steps.filter((s) => s.deviceId === 'b').slice(0, 2).map((s) => s.action.type)).toEqual(['power', 'brightness']);
    expect(steps.filter((s) => s.deviceId === 'b').some((s) => s.action.type === 'segmentColor')).toBe(true);
  });

  it('skips brightness on a light without it', () => {
    const steps = builtinPresetActions(FIREWORKS_PRESET, [string('a', 3, { hasBrightness: false })]);
    expect(steps.some((s) => s.action.type === 'brightness')).toBe(false);
  });
});

describe('ordering strings', () => {
  const light = (id: string, name: string) => ({ id, name });

  it('guesses left, center and right when nothing is saved', () => {
    const ordered = orderLightStrings([light('r', 'Outdoor Right'), light('c', 'Outdoor Center'), light('l', 'Outdoor Left')], []);
    expect(ordered.map((d) => d.id)).toEqual(['l', 'c', 'r']);
  });

  it('puts the saved order first, with new lights after', () => {
    const saved = [{ deviceId: 'r', included: true, reversed: false }];
    const ordered = orderLightStrings([light('l', 'Outdoor Left'), light('r', 'Outdoor Right')], saved);
    expect(ordered.map((d) => d.id)).toEqual(['r', 'l']);
  });
});
