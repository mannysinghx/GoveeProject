import { builtinPresetByKey, DAILY_SCHEME_PRESET, type BuiltinPresetDefinition } from './festival-presets.js';
import { holidayDate } from './holidays.js';

/**
 * Which still color scheme "Today's Color Scheme" shows on a given date. It is worked out
 * from the date alone, so it is the same after a restart, and the whole month can be listed
 * in advance. Only fixed patterns are used: moving effects are Govee's own and not all
 * lights offer them.
 */

/** Shown on days outside November and December. */
export const EVERYDAY_SCHEME_KEY = 'season-warm-white';

/** In the order they come round. Neighbours are chosen to look different from each other. */
const NOVEMBER_SCHEMES = [
  'season-pumpkin-patch',
  'thanksgiving-cozy-hearth',
  'season-maple-sunset',
  'november-cranberry-spice',
  'season-golden-hour',
  'season-forest-ember',
  'season-harvest-moon',
  'season-mulled-cider',
  'thanksgiving-autumn-leaves',
  'season-copper-plum',
] as const;

const DECEMBER_SCHEMES = [
  'christmas-classic',
  'december-winter-frost',
  'season-poinsettia',
  'christmas-warm-gold',
  'season-blue-christmas',
  'christmas-candy-cane',
  'season-starry-night',
  'season-holly-berries',
  'december-silver-gold',
  'season-peppermint-twist',
  'season-sugar-plum',
  'christmas-evergreen',
  'season-champagne',
  'season-nordic',
  'season-gingerbread',
  'season-vintage-bulbs',
] as const;

/**
 * Days with a look of their own, as month-day. Thanksgiving moves, so it is worked out below,
 * and its Harvest Gold is kept for that day alone.
 */
const FIXED_DAYS: Readonly<Record<string, string>> = {
  '11-11': 'veterans-red-white-blue',
  '12-24': 'christmas-classic',
  '12-25': 'christmas-evergreen',
  '12-31': 'new-year-eve-midnight-gold',
};

const THANKSGIVING_SCHEME = 'thanksgiving-harvest-gold';

function specialDay(year: number, month: number, day: number): string | undefined {
  const monthDay = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (holidayDate('thanksgiving', year) === `${year}-${monthDay}`) return THANKSGIVING_SCHEME;
  return FIXED_DAYS[monthDay];
}

/**
 * Every day of one month, in order. The rotation goes by day of the month, and a day steps
 * on to the next scheme if it would match the day before or a special day after it, so the
 * look always changes from one day to the next.
 */
function monthSchemes(year: number, month: number, schemes: readonly string[]): string[] {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const keys: string[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const special = specialDay(year, month, day);
    if (special) {
      keys.push(special);
      continue;
    }
    const avoid = [keys[day - 2], specialDay(year, month, day + 1)];
    let offset = 0;
    while (offset < schemes.length - 1 && avoid.includes(schemes[(day - 1 + offset) % schemes.length])) offset += 1;
    keys.push(schemes[(day - 1 + offset) % schemes.length] as string);
  }
  return keys;
}

/** The built-in preset key for a local date written as YYYY-MM-DD. */
export function dailySchemeKey(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const schemes = month === 11 ? NOVEMBER_SCHEMES : month === 12 ? DECEMBER_SCHEMES : null;
  if (!schemes) return EVERYDAY_SCHEME_KEY;
  return monthSchemes(year, month, schemes)[day - 1] ?? EVERYDAY_SCHEME_KEY;
}

export function dailyScheme(date: string): BuiltinPresetDefinition {
  return builtinPresetByKey(dailySchemeKey(date)) ?? DAILY_SCHEME_PRESET;
}

/** True in the months that have a scheme for every day. */
export function hasDailySchemes(date: string): boolean {
  const month = Number(date.slice(5, 7));
  return month === 11 || month === 12;
}

/** The local calendar date in a time zone, as YYYY-MM-DD. */
export function localDate(timeZone: string, atMs: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(
    new Date(atMs),
  );
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** The date `days` after a YYYY-MM-DD date, in the same form. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
