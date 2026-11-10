/**
 * Holiday dates, worked out here so nothing needs looking up at run time. US holidays
 * use the actual date, not the "observed" workday, because that is when lights go up.
 */

export type HolidayRule =
  | { type: 'fixed'; month: number; day: number }
  /** weekday is ISO: 1 is Monday, 7 is Sunday. nth of -1 means the last in the month. */
  | { type: 'nth'; month: number; weekday: number; nth: number }
  | { type: 'easter' }
  | { type: 'table'; dates: Readonly<Record<number, string>> };

export interface HolidayStep {
  minutesAfterStart: number;
  presetKey: string;
}

export interface HolidayDefinition {
  key: string;
  name: string;
  group: 'federal' | 'observance' | 'cultural' | 'show';
  rule: HolidayRule;
  /** Local 24-hour time. Later in summer, so lights are not on in daylight. */
  startTime: string;
  /** Local 24-hour time on the same date, or null when something else follows. */
  endTime: string | null;
  steps: HolidayStep[];
  description: string;
}

/**
 * Lakshmi Puja for Los Angeles, as listed by Drik Panchang. It follows the lunar calendar,
 * so it cannot be worked out from a simple rule, and some other calendars differ by a day
 * (some give 2027-10-29 and 2030-10-26, which are the dates for India).
 */
const DIWALI_DATES: Readonly<Record<number, string>> = {
  2026: '2026-11-08',
  2027: '2027-10-28',
  2028: '2028-10-17',
  2029: '2029-11-05',
  2030: '2030-10-25',
  2031: '2031-11-13',
  2032: '2032-11-02',
  2033: '2033-10-22',
  2034: '2034-11-09',
  2035: '2035-10-30',
  2036: '2036-10-18',
  2037: '2037-11-06',
};

export const DIWALI_LAST_YEAR = 2037;

const show = (presetKey: string): HolidayStep[] => [{ minutesAfterStart: 0, presetKey }];
const END = '23:00';

export const HOLIDAYS: readonly HolidayDefinition[] = [
  {
    key: 'new-year-fireworks',
    name: 'New Year Fireworks',
    group: 'show',
    rule: { type: 'fixed', month: 1, day: 1 },
    startTime: '00:00',
    endTime: '00:30',
    steps: show('new-year-fireworks'),
    description: "Govee's Fireworks effect at midnight.",
  },
  {
    key: 'new-years-day',
    name: "New Year's Day",
    group: 'federal',
    rule: { type: 'fixed', month: 1, day: 1 },
    startTime: '17:00',
    endTime: END,
    steps: show('holiday-new-year-day'),
    description: 'Gold, silver and white.',
  },
  {
    key: 'mlk-day',
    name: 'Martin Luther King Jr. Day',
    group: 'federal',
    rule: { type: 'nth', month: 1, weekday: 1, nth: 3 },
    startTime: '17:00',
    endTime: END,
    steps: show('holiday-mlk'),
    description: 'Warm white, gold and deep blue.',
  },
  {
    key: 'valentines-day',
    name: "Valentine's Day",
    group: 'observance',
    rule: { type: 'fixed', month: 2, day: 14 },
    startTime: '17:00',
    endTime: END,
    steps: show('holiday-valentines'),
    description: 'Red, pink and white.',
  },
  {
    key: 'presidents-day',
    name: "Presidents' Day",
    group: 'federal',
    rule: { type: 'nth', month: 2, weekday: 1, nth: 3 },
    startTime: '17:00',
    endTime: END,
    steps: show('holiday-presidents'),
    description: 'Red, white and blue.',
  },
  {
    key: 'st-patricks-day',
    name: "St. Patrick's Day",
    group: 'observance',
    rule: { type: 'fixed', month: 3, day: 17 },
    startTime: '19:30',
    endTime: END,
    steps: show('holiday-st-patricks'),
    description: 'Greens, gold and white.',
  },
  {
    key: 'easter',
    name: 'Easter',
    group: 'observance',
    rule: { type: 'easter' },
    startTime: '19:30',
    endTime: END,
    steps: show('holiday-easter'),
    description: 'Soft pastels.',
  },
  {
    key: 'mothers-day',
    name: "Mother's Day",
    group: 'observance',
    rule: { type: 'nth', month: 5, weekday: 7, nth: 2 },
    startTime: '20:00',
    endTime: END,
    steps: show('holiday-mothers'),
    description: 'Pink, lavender and warm white.',
  },
  {
    key: 'memorial-day',
    name: 'Memorial Day',
    group: 'federal',
    rule: { type: 'nth', month: 5, weekday: 1, nth: -1 },
    startTime: '20:00',
    endTime: END,
    steps: show('holiday-memorial'),
    description: 'Poppy red, white and navy.',
  },
  {
    key: 'fathers-day',
    name: "Father's Day",
    group: 'observance',
    rule: { type: 'nth', month: 6, weekday: 7, nth: 3 },
    startTime: '20:30',
    endTime: END,
    steps: show('holiday-fathers'),
    description: 'Blue, navy and warm amber.',
  },
  {
    key: 'juneteenth',
    name: 'Juneteenth',
    group: 'federal',
    rule: { type: 'fixed', month: 6, day: 19 },
    startTime: '20:30',
    endTime: END,
    steps: show('holiday-juneteenth'),
    description: 'Red, gold and green.',
  },
  {
    key: 'independence-day',
    name: 'Independence Day',
    group: 'federal',
    rule: { type: 'fixed', month: 7, day: 4 },
    startTime: '20:30',
    endTime: END,
    steps: show('holiday-independence'),
    description: 'Red, white and blue.',
  },
  {
    key: 'labor-day',
    name: 'Labor Day',
    group: 'federal',
    rule: { type: 'nth', month: 9, weekday: 1, nth: 1 },
    startTime: '19:30',
    endTime: END,
    steps: show('holiday-labor'),
    description: 'Navy, gold and white.',
  },
  {
    key: 'indigenous-peoples-day',
    name: "Columbus / Indigenous Peoples' Day",
    group: 'federal',
    rule: { type: 'nth', month: 10, weekday: 1, nth: 2 },
    startTime: '18:00',
    endTime: END,
    steps: show('holiday-indigenous'),
    description: 'Turquoise, terracotta and gold.',
  },
  {
    key: 'halloween',
    name: 'Halloween',
    group: 'observance',
    rule: { type: 'fixed', month: 10, day: 31 },
    startTime: '18:00',
    endTime: END,
    steps: show('holiday-halloween'),
    description: 'Orange, purple and green.',
  },
  {
    key: 'diwali',
    name: 'Diwali',
    group: 'cultural',
    rule: { type: 'table', dates: DIWALI_DATES },
    startTime: '17:00',
    endTime: '20:00',
    steps: [0, 30, 60, 90, 120, 150].map((minutesAfterStart, i) => ({
      minutesAfterStart,
      presetKey: i % 2 === 0 ? 'diwali-colors' : 'diwali-fireworks',
    })),
    description: "Diwali colors and Govee's Fireworks effect, taking turns every 30 minutes.",
  },
  {
    key: 'veterans-day',
    name: 'Veterans Day',
    group: 'federal',
    rule: { type: 'fixed', month: 11, day: 11 },
    startTime: '17:00',
    endTime: END,
    steps: show('veterans-red-white-blue'),
    description: 'Red, white and blue.',
  },
  {
    key: 'thanksgiving',
    name: 'Thanksgiving',
    group: 'federal',
    rule: { type: 'nth', month: 11, weekday: 4, nth: 4 },
    startTime: '17:00',
    endTime: END,
    steps: show('thanksgiving-harvest-gold'),
    description: 'Orange, gold and deep red.',
  },
  {
    key: 'christmas-eve',
    name: 'Christmas Eve',
    group: 'observance',
    rule: { type: 'fixed', month: 12, day: 24 },
    startTime: '17:00',
    endTime: END,
    steps: show('christmas-warm-gold'),
    description: 'Warm white and gold.',
  },
  {
    key: 'christmas-day',
    name: 'Christmas Day',
    group: 'federal',
    rule: { type: 'fixed', month: 12, day: 25 },
    startTime: '17:00',
    endTime: END,
    steps: show('christmas-classic'),
    description: 'Red and green.',
  },
  {
    key: 'new-years-eve',
    name: "New Year's Eve",
    group: 'observance',
    rule: { type: 'fixed', month: 12, day: 31 },
    startTime: '17:00',
    // New Year Fireworks follows at midnight.
    endTime: null,
    steps: show('new-year-eve-midnight-gold'),
    description: 'Gold, white and purple, ready for the midnight fireworks.',
  },
];

export function holidayByKey(key: string): HolidayDefinition | undefined {
  return HOLIDAYS.find((holiday) => holiday.key === key);
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;

function isoWeekday(year: number, month: number, day: number): number {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** The Gregorian Easter calculation (the anonymous, or Meeus/Jones/Butcher, algorithm). */
function easter(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(year, month, day);
}

function nthWeekday(year: number, month: number, weekday: number, nth: number): string {
  if (nth > 0) {
    const offset = (weekday - isoWeekday(year, month, 1) + 7) % 7;
    return iso(year, month, 1 + offset + (nth - 1) * 7);
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const back = (isoWeekday(year, month, lastDay) - weekday + 7) % 7;
  return iso(year, month, lastDay - back);
}

/** The holiday's date in a year as YYYY-MM-DD, or null if unknown, as with Diwali after the table ends. */
export function holidayDate(key: string, year: number): string | null {
  const holiday = holidayByKey(key);
  if (!holiday) return null;
  const { rule } = holiday;
  switch (rule.type) {
    case 'fixed':
      return iso(year, rule.month, rule.day);
    case 'nth':
      return nthWeekday(year, rule.month, rule.weekday, rule.nth);
    case 'easter':
      return easter(year);
    case 'table':
      return rule.dates[year] ?? null;
  }
}

/** Adds minutes to a local HH:MM. Show steps stay on the same date. */
export function addMinutesToTime(time: string, minutes: number): string {
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  const total = hour * 60 + minute + minutes;
  return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
}

/** A local 24-hour time as people read it, such as "5:00 PM". */
export function describeTime(time: string): string {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${pad(minute)} ${hour < 12 ? 'AM' : 'PM'}`;
}
