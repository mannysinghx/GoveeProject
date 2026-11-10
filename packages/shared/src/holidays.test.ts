import { describe, expect, it } from 'vitest';
import { BUILTIN_PRESETS, builtinPresetByKey, FESTIVAL_PRESETS, HOLIDAY_PRESETS } from './festival-presets.js';
import { addMinutesToTime, DIWALI_LAST_YEAR, HOLIDAYS, holidayByKey, holidayDate } from './holidays.js';
import { colorEmoji } from './color.js';
import { recurrenceSchema } from './schemas.js';
import { describeRecurrence } from './describe.js';

describe('holiday dates', () => {
  it.each([
    ['new-years-day', 2027, '2027-01-01'],
    ['mlk-day', 2027, '2027-01-18'],
    ['presidents-day', 2027, '2027-02-15'],
    ['memorial-day', 2027, '2027-05-31'],
    ['juneteenth', 2027, '2027-06-19'],
    ['independence-day', 2027, '2027-07-04'],
    ['labor-day', 2027, '2027-09-06'],
    ['indigenous-peoples-day', 2027, '2027-10-11'],
    ['veterans-day', 2026, '2026-11-11'],
    ['thanksgiving', 2026, '2026-11-26'],
    ['thanksgiving', 2027, '2027-11-25'],
    ['christmas-day', 2026, '2026-12-25'],
    ['valentines-day', 2027, '2027-02-14'],
    ['st-patricks-day', 2027, '2027-03-17'],
    ['mothers-day', 2027, '2027-05-09'],
    ['fathers-day', 2027, '2027-06-20'],
    ['halloween', 2027, '2027-10-31'],
    ['christmas-eve', 2026, '2026-12-24'],
    ['new-years-eve', 2026, '2026-12-31'],
  ])('%s in %i is %s', (key, year, expected) => {
    expect(holidayDate(key, year)).toBe(expected);
  });

  it('uses the last Monday when a month has five', () => {
    expect(holidayDate('memorial-day', 2026)).toBe('2026-05-25');
    expect(holidayDate('memorial-day', 2028)).toBe('2028-05-29');
  });

  it.each([
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
    [2028, '2028-04-16'],
    [2030, '2030-04-21'],
    [2038, '2038-04-25'],
  ])('finds Easter in %i', (year, expected) => {
    expect(holidayDate('easter', year)).toBe(expected);
  });

  it('has Diwali for Los Angeles through the end of its table, and nothing after', () => {
    expect(holidayDate('diwali', 2026)).toBe('2026-11-08');
    expect(holidayDate('diwali', 2027)).toBe('2027-10-28');
    expect(holidayDate('diwali', 2030)).toBe('2030-10-25');
    expect(holidayDate('diwali', DIWALI_LAST_YEAR)).toBe('2037-11-06');
    expect(holidayDate('diwali', DIWALI_LAST_YEAR + 1)).toBeNull();
  });

  it('knows nothing about an unknown holiday', () => {
    expect(holidayDate('not-a-holiday', 2027)).toBeNull();
    expect(holidayByKey('not-a-holiday')).toBeUndefined();
  });
});

describe('the calendar', () => {
  it('includes all 11 US federal holidays and Diwali', () => {
    expect(HOLIDAYS.filter((h) => h.group === 'federal')).toHaveLength(11);
    expect(holidayByKey('diwali')?.group).toBe('cultural');
  });

  it('has unique keys, and only uses presets that exist', () => {
    expect(new Set(HOLIDAYS.map((h) => h.key)).size).toBe(HOLIDAYS.length);
    for (const holiday of HOLIDAYS) {
      for (const step of holiday.steps) expect(builtinPresetByKey(step.presetKey), `${holiday.key} ${step.presetKey}`).toBeDefined();
    }
  });

  it('runs Diwali 5 to 8 PM, with colors and fireworks taking turns', () => {
    const diwali = holidayByKey('diwali');
    expect(diwali).toMatchObject({ startTime: '17:00', endTime: '20:00' });
    expect(diwali?.steps.map((s) => `${addMinutesToTime('17:00', s.minutesAfterStart)} ${s.presetKey}`)).toEqual([
      '17:00 diwali-colors',
      '17:30 diwali-fireworks',
      '18:00 diwali-colors',
      '18:30 diwali-fireworks',
      '19:00 diwali-colors',
      '19:30 diwali-fireworks',
    ]);
    expect(builtinPresetByKey('diwali-fireworks')?.sceneName).toBe('Fireworks');
  });

  it('starts summer holidays later, so lights are not on in daylight', () => {
    expect(holidayByKey('independence-day')?.startTime).toBe('20:30');
    expect(holidayByKey('memorial-day')?.startTime).toBe('20:00');
    expect(holidayByKey('labor-day')?.startTime).toBe('19:30');
    expect(holidayByKey('halloween')?.startTime).toBe('18:00');
    expect(holidayByKey('thanksgiving')?.startTime).toBe('17:00');
  });

  it("leaves New Year's Eve running into the midnight fireworks", () => {
    expect(holidayByKey('new-years-eve')?.endTime).toBeNull();
    expect(holidayByKey('new-year-fireworks')?.startTime).toBe('00:00');
  });

  it('keeps the 20 festival presets separate from the holiday ones', () => {
    expect(FESTIVAL_PRESETS).toHaveLength(20);
    expect(BUILTIN_PRESETS).toHaveLength(21 + HOLIDAY_PRESETS.length);
    expect(new Set(BUILTIN_PRESETS.map((p) => p.key)).size).toBe(BUILTIN_PRESETS.length);
  });
});

describe('holiday schedules', () => {
  it('accepts a known holiday and refuses an unknown one', () => {
    expect(recurrenceSchema.safeParse({ kind: 'holiday', holiday: 'diwali', time: '17:00' }).success).toBe(true);
    expect(recurrenceSchema.safeParse({ kind: 'holiday', holiday: 'made-up', time: '17:00' }).success).toBe(false);
  });

  it('reads clearly', () => {
    expect(describeRecurrence({ kind: 'holiday', holiday: 'diwali', time: '17:00' })).toBe('Diwali, every year at 17:00');
  });

  it('adds minutes to a time', () => {
    expect(addMinutesToTime('17:00', 150)).toBe('19:30');
    expect(addMinutesToTime('20:30', 45)).toBe('21:15');
  });
});

describe('colored squares', () => {
  it.each([
    ['#ff0000', '🟥'],
    ['#00c000', '🟩'],
    ['#0000ff', '🟦'],
    ['#ffffff', '⬜'],
    ['#ffaa00', '🟧'],
    ['#5a00d6', '🟪'],
  ])('shows %s as %s', (hex, emoji) => {
    expect(colorEmoji(hex)).toBe(emoji);
  });
});
