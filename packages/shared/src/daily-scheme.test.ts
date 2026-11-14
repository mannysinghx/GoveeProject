import { describe, expect, it } from 'vitest';
import { addDays, dailyScheme, dailySchemeKey, EVERYDAY_SCHEME_KEY, hasDailySchemes, localDate } from './daily-scheme.js';
import { isHexColor } from './color.js';
import { BUILTIN_PRESETS, builtinPresetByKey, DAILY_SCHEME_PRESET, SEASON_PRESETS } from './festival-presets.js';
import { holidayDate } from './holidays.js';

const daysOf = (year: number, month: number) =>
  Array.from({ length: new Date(Date.UTC(year, month, 0)).getUTCDate() }, (_, i) => `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`);
const YEARS = [2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033];

describe('the November and December color schemes', () => {
  it('adds 18 still schemes with unique keys and names, and valid colors', () => {
    expect(SEASON_PRESETS).toHaveLength(18);
    expect(new Set(BUILTIN_PRESETS.map((p) => p.key)).size).toBe(BUILTIN_PRESETS.length);
    expect(new Set(BUILTIN_PRESETS.map((p) => p.name.toLowerCase())).size).toBe(BUILTIN_PRESETS.length);
    for (const preset of SEASON_PRESETS) {
      expect(preset.key.startsWith('season-'), preset.key).toBe(true);
      expect(preset.sceneName, preset.key).toBeUndefined();
      expect(preset.colors.every(isHexColor), preset.key).toBe(true);
      // Each distinct color is one command per string, so these stay quick to send.
      expect(new Set(preset.colors).size, preset.key).toBeLessThanOrEqual(7);
    }
    expect(SEASON_PRESETS.filter((p) => p.occasion === 'November')).toHaveLength(7);
    expect(SEASON_PRESETS.filter((p) => p.occasion === 'December')).toHaveLength(10);
  });
});

describe("today's color scheme", () => {
  it('always names a real, still preset, never a moving effect and never itself', () => {
    for (const year of YEARS) {
      for (const date of [...daysOf(year, 11), ...daysOf(year, 12)]) {
        const scheme = builtinPresetByKey(dailySchemeKey(date));
        expect(scheme, date).toBeDefined();
        expect(scheme?.sceneName, date).toBeUndefined();
        expect(scheme?.key, date).not.toBe(DAILY_SCHEME_PRESET.key);
      }
    }
  });

  it('changes every single day through November and December, in every year checked', () => {
    for (const year of YEARS) {
      const run = [`${year}-10-31`, ...daysOf(year, 11), ...daysOf(year, 12), `${year + 1}-01-01`].map(dailySchemeKey);
      run.slice(1).forEach((key, i) => expect(key, `${year} day ${i + 1}`).not.toBe(run[i]));
    }
  });

  it('uses autumn looks in November and winter and Christmas looks in December', () => {
    const occasions = (month: number) => new Set(daysOf(2026, month).map((d) => dailyScheme(d).occasion));
    expect([...occasions(11)].sort()).toEqual(['November', 'Thanksgiving', 'Veterans Day']);
    expect([...occasions(12)].sort()).toEqual(['Christmas', 'December', 'New Year']);
  });

  it('shows plenty of variety: at least 11 different looks in November and 16 in December', () => {
    expect(new Set(daysOf(2026, 11).map(dailySchemeKey)).size).toBeGreaterThanOrEqual(11);
    expect(new Set(daysOf(2026, 12).map(dailySchemeKey)).size).toBeGreaterThanOrEqual(16);
  });

  it('keeps the special days: Veterans Day, Thanksgiving, Christmas Eve, Christmas and New Year’s Eve', () => {
    expect(dailySchemeKey('2026-11-11')).toBe('veterans-red-white-blue');
    for (const year of YEARS) {
      expect(dailySchemeKey(holidayDate('thanksgiving', year) as string), String(year)).toBe('thanksgiving-harvest-gold');
    }
    expect(holidayDate('thanksgiving', 2026)).toBe('2026-11-26');
    expect(dailySchemeKey('2026-12-24')).toBe('christmas-classic');
    expect(dailySchemeKey('2026-12-25')).toBe('christmas-evergreen');
    expect(dailySchemeKey('2026-12-31')).toBe('new-year-eve-midnight-gold');
  });

  it('is the same every time it is asked, and falls back to warm white in other months', () => {
    expect(dailySchemeKey('2026-11-13')).toBe(dailySchemeKey('2026-11-13'));
    expect(dailySchemeKey('2027-03-09')).toBe(EVERYDAY_SCHEME_KEY);
    expect(dailyScheme('2027-03-09').name).toBe('Everyday: Warm White');
    expect(hasDailySchemes('2026-11-30')).toBe(true);
    expect(hasDailySchemes('2027-01-01')).toBe(false);
  });

  it('goes by the local date, so it changes at midnight where the lights are', () => {
    const justBeforeMidnightLA = Date.parse('2026-12-01T07:59:00Z');
    expect(localDate('America/Los_Angeles', justBeforeMidnightLA)).toBe('2026-11-30');
    expect(localDate('America/Los_Angeles', justBeforeMidnightLA + 60_000)).toBe('2026-12-01');
    expect(localDate('UTC', justBeforeMidnightLA)).toBe('2026-12-01');
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});
