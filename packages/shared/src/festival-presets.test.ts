import { describe, expect, it } from 'vitest';
import { BUILTIN_PRESETS, builtinPresetActions, FESTIVAL_PRESETS, FIREWORKS_PRESET, MONTH_PRESETS, orderLightStrings, type BuiltinString } from './festival-presets.js';
import { hexToRgb, isHexColor } from './color.js';
import { HOLIDAYS } from './holidays.js';
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
    expect(new Set(BUILTIN_PRESETS.map((p) => p.key)).size).toBe(BUILTIN_PRESETS.length);
    expect(new Set(BUILTIN_PRESETS.map((p) => p.name.toLowerCase())).size).toBe(BUILTIN_PRESETS.length);
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

describe('the month and heritage presets', () => {
  it('adds 18, each with its own occasion note and a short run of colors', () => {
    expect(MONTH_PRESETS).toHaveLength(18);
    for (const preset of MONTH_PRESETS) {
      expect(preset.key.startsWith('month-'), preset.key).toBe(true);
      expect(preset.when.length, preset.name).toBeGreaterThan(0);
      expect(preset.description.length, preset.name).toBeGreaterThan(10);
      // Each distinct color is one command to Govee, about a second each, so it stays short.
      expect(new Set(preset.colors).size, preset.name).toBeLessThanOrEqual(11);
    }
  });

  it('are listed after the others, in calendar order, without disturbing them', () => {
    const keys = BUILTIN_PRESETS.map((p) => p.key);
    expect(keys.slice(-18)).toEqual(MONTH_PRESETS.map((p) => p.key));
    expect(MONTH_PRESETS.map((p) => p.key)).toEqual([
      'month-january-aurora',
      'month-lunar-new-year',
      'month-black-history',
      'month-womens-history',
      'month-holi',
      'month-eid',
      'month-april-cherry-blossom',
      'month-earth-day',
      'month-cinco-de-mayo',
      'month-pride-rainbow',
      'month-pride-progress',
      'month-summer-sunset',
      'month-hispanic-heritage',
      'month-pink-ribbon',
      'month-dia-de-muertos',
      'month-hanukkah',
      'month-winter-solstice',
      'month-kwanzaa',
    ]);
  });

  it('match what their cards claim', () => {
    const colors = (key: string) => MONTH_PRESETS.find((p) => p.key === key)!.colors;
    const distinct = (key: string) => new Set(colors(key)).size;
    // The Progress Pride card says it uses 11 colors, and Pride Rainbow has the six stripes.
    expect(distinct('month-pride-progress')).toBe(11);
    expect(distinct('month-pride-rainbow')).toBe(6);
    expect(colors('month-pride-progress').slice(0, 5)).toEqual(['#ffffff', '#f5a9b8', '#5bcefa', '#8b4513', '#000000']);
    // Black History Month and Kwanzaa carry red, black and green.
    for (const key of ['month-black-history', 'month-kwanzaa']) {
      expect(colors(key), key).toEqual(expect.arrayContaining(['#ff0000', '#000000', '#00b040']));
    }
    // Cinco de Mayo is green, white and red in two segments each, like the flag.
    expect(colors('month-cinco-de-mayo')).toEqual(['#00a000', '#00a000', '#ffffff', '#ffffff', '#ff0000', '#ff0000']);
    // No preset spends a command on two colors that look the same.
    const near = (a: string, b: string) => Math.max(...(['r', 'g', 'b'] as const).map((c) => Math.abs(hexToRgb(a)[c] - hexToRgb(b)[c]))) < 40;
    for (const preset of MONTH_PRESETS.filter((p) => !p.key.match(/aurora|cherry|sunset|solstice/))) {
      const unique = [...new Set(preset.colors)];
      for (const [i, a] of unique.entries()) {
        for (const b of unique.slice(i + 1)) expect(near(a, b), `${preset.name}: ${a} and ${b}`).toBe(false);
      }
    }
  });

  it('say roughly when moving festivals fall, not a fixed date', () => {
    for (const key of ['month-lunar-new-year', 'month-holi', 'month-eid', 'month-hanukkah', 'month-winter-solstice']) {
      const when = MONTH_PRESETS.find((p) => p.key === key)!.when;
      expect(when.length, key).toBeGreaterThan(25);
    }
    expect(MONTH_PRESETS.find((p) => p.key === 'month-hanukkah')!.when).toMatch(/November or December/);
    expect(MONTH_PRESETS.find((p) => p.key === 'month-winter-solstice')!.when).toMatch(/20 to 22/);
  });

  it('are only presets: no holiday schedule uses them, so nothing is scheduled by itself', () => {
    const monthKeys = new Set(MONTH_PRESETS.map((p) => p.key));
    for (const holiday of HOLIDAYS) for (const step of holiday.steps) expect(monthKeys.has(step.presetKey), holiday.key).toBe(false);
  });

  it('loop smoothly: the end of a wave leads back into its start with no jump', () => {
    const waves = ['month-january-aurora', 'month-april-cherry-blossom', 'month-summer-sunset', 'month-winter-solstice'];
    for (const key of waves) {
      const colors = MONTH_PRESETS.find((p) => p.key === key)!.colors;
      const step = (a: string, b: string) => Math.max(...(['r', 'g', 'b'] as const).map((c) => Math.abs(hexToRgb(a)[c] - hexToRgb(b)[c])));
      const steps = colors.map((color, i) => step(color, colors[(i + 1) % colors.length]!));
      // No neighbour, including the wrap from last back to first, is a bigger jump than the rest.
      expect(Math.max(...steps), key).toBeLessThanOrEqual(110);
      expect(steps.at(-1), key).toBeLessThanOrEqual(Math.max(...steps.slice(0, -1)));
      expect(colors[0], key).not.toBe(colors.at(-1));
    }
  });

  it('keep black as a dark segment, and send it like any other color', () => {
    const black = MONTH_PRESETS.filter((p) => p.colors.includes('#000000')).map((p) => p.key);
    expect(black).toEqual(['month-black-history', 'month-pride-progress', 'month-kwanzaa']);
    const steps = builtinPresetActions(MONTH_PRESETS.find((p) => p.key === 'month-kwanzaa')!, [string('a', 27)]);
    expect(steps.some((s) => s.action.type === 'segmentColor' && s.action.hex === '#000000')).toBe(true);
  });

  it('spread the Kwanzaa candles as three red, one black, three green', () => {
    const kwanzaa = MONTH_PRESETS.find((p) => p.key === 'month-kwanzaa')!;
    expect(kwanzaa.colors).toHaveLength(7);
    expect(kwanzaa.colors.filter((c) => c === '#ff0000')).toHaveLength(3);
    expect(kwanzaa.colors.filter((c) => c === '#000000')).toHaveLength(1);
    expect(kwanzaa.colors.filter((c) => c === '#00b040')).toHaveLength(3);
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
