import { hexToRgb, rgbToHex } from './color.js';
import type { DeviceAction, PatternStringSetting, PresetActionInput } from './schemas.js';

/**
 * Presets that come with the app. A pattern is a short run of colors, one per segment,
 * repeated along all the strings. Where `sceneName` is set and a light offers that Govee
 * scene, the light runs Govee's own moving effect, and the colors are the fallback.
 */
export interface BuiltinPresetDefinition {
  key: string;
  name: string;
  occasion: string;
  when: string;
  description: string;
  colors: string[];
  sceneName?: string;
  brightness?: number;
}

const RED = '#ff0000';
const WHITE = '#ffffff';
const BLUE = '#0000ff';
const NAVY = '#001a80';
const WARM = '#ffb46b';
const GOLD = '#ffaa00';
const AMBER = '#ff8000';
const ORANGE = '#ff5a00';
const RUST = '#b33a00';
const BURGUNDY = '#8a0020';
const CRANBERRY = '#c80032';
const GREEN = '#00c000';
const EVERGREEN = '#006b1f';
const ICE = '#66ccff';
const SILVER = '#c8d8ff';
const PURPLE = '#5a00d6';

const run = (color: string, length: number): string[] => Array.from({ length }, () => color);

const NOVEMBER = 'November';
const VETERANS = 'Veterans Day';
const THANKSGIVING = 'Thanksgiving';
const DECEMBER = 'December';
const CHRISTMAS = 'Christmas';
const NEW_YEAR = 'New Year';

/** The 20 festival presets, in calendar order. */
export const FESTIVAL_PRESETS: readonly BuiltinPresetDefinition[] = [
  {
    key: 'november-fall-effect',
    name: 'November: Fall Effect',
    occasion: NOVEMBER,
    when: 'All of November',
    description: "Govee's moving Fall effect.",
    colors: [RUST, AMBER, GOLD],
    sceneName: 'Fall',
  },
  {
    key: 'november-cranberry-spice',
    name: 'November: Cranberry Spice',
    occasion: NOVEMBER,
    when: 'All of November',
    description: 'Cranberry red with warm spice tones.',
    colors: [...run(CRANBERRY, 2), AMBER, ...run(BURGUNDY, 2), WARM],
  },
  {
    key: 'veterans-red-white-blue',
    name: 'Veterans Day: Red, White & Blue',
    occasion: VETERANS,
    when: 'November 11',
    description: 'Even bands of red, white and blue.',
    colors: [...run(RED, 3), ...run(WHITE, 3), ...run(BLUE, 3)],
  },
  {
    key: 'veterans-honor-stripes',
    name: 'Veterans Day: Honor Stripes',
    occasion: VETERANS,
    when: 'November 11',
    description: 'A blue field followed by red and white stripes.',
    colors: [...run(NAVY, 3), RED, WHITE, RED, WHITE, RED, WHITE],
  },
  {
    key: 'veterans-salute',
    name: 'Veterans Day: Salute',
    occasion: VETERANS,
    when: 'November 11',
    description: 'Warm white with red and blue accents.',
    colors: [...run(WARM, 4), RED, ...run(WARM, 4), BLUE],
  },
  {
    key: 'thanksgiving-effect',
    name: 'Thanksgiving: Govee Effect',
    occasion: THANKSGIVING,
    when: 'Fourth Thursday of November',
    description: "Govee's moving Thanksgiving effect.",
    colors: [ORANGE, GOLD, BURGUNDY],
    sceneName: 'Thanksgiving',
  },
  {
    key: 'thanksgiving-harvest-gold',
    name: 'Thanksgiving: Harvest Gold',
    occasion: THANKSGIVING,
    when: 'Fourth Thursday of November',
    description: 'Orange, gold and deep red.',
    colors: [...run(ORANGE, 2), ...run(GOLD, 2), ...run(BURGUNDY, 2)],
  },
  {
    key: 'thanksgiving-autumn-leaves',
    name: 'Thanksgiving: Autumn Leaves',
    occasion: THANKSGIVING,
    when: 'Fourth Thursday of November',
    description: 'Scattered rust, amber, burgundy and gold.',
    colors: [RUST, AMBER, BURGUNDY, GOLD, RUST, ORANGE],
  },
  {
    key: 'thanksgiving-cozy-hearth',
    name: 'Thanksgiving: Cozy Hearth',
    occasion: THANKSGIVING,
    when: 'Fourth Thursday of November',
    description: 'Warm white with touches of amber, for a quieter look.',
    colors: [...run(WARM, 3), AMBER, ...run(WARM, 3), ORANGE],
  },
  {
    key: 'december-winter-wonderland',
    name: 'December: Winter Wonderland Effect',
    occasion: DECEMBER,
    when: 'All of December',
    description: "Govee's moving Winter Wonderland effect.",
    colors: [ICE, WHITE, SILVER],
    sceneName: 'Winter Wonderland',
  },
  {
    key: 'december-winter-frost',
    name: 'December: Winter Frost',
    occasion: DECEMBER,
    when: 'All of December',
    description: 'Icy blue and white.',
    colors: [...run(ICE, 2), WHITE, ...run(ICE, 2), SILVER],
  },
  {
    key: 'december-silver-gold',
    name: 'December: Silver & Gold',
    occasion: DECEMBER,
    when: 'All of December',
    description: 'Alternating silver and gold.',
    colors: [...run(SILVER, 2), ...run(GOLD, 2)],
  },
  {
    key: 'christmas-classic',
    name: 'Christmas: Classic Red & Green',
    occasion: CHRISTMAS,
    when: 'December 24 and 25',
    description: 'Traditional red and green bands.',
    colors: [...run(RED, 3), ...run(GREEN, 3)],
  },
  {
    key: 'christmas-candy-cane',
    name: 'Christmas: Candy Cane',
    occasion: CHRISTMAS,
    when: 'December 24 and 25',
    description: 'Red and white stripes.',
    colors: [...run(RED, 2), ...run(WHITE, 2)],
  },
  {
    key: 'christmas-warm-gold',
    name: 'Christmas: Warm White & Gold',
    occasion: CHRISTMAS,
    when: 'December 24 and 25',
    description: 'A classic warm glow with gold accents.',
    colors: [...run(WARM, 3), GOLD],
  },
  {
    key: 'christmas-evergreen',
    name: 'Christmas: Evergreen',
    occasion: CHRISTMAS,
    when: 'December 24 and 25',
    description: 'Deep green with gold and red ornaments.',
    colors: [...run(EVERGREEN, 3), GOLD, ...run(EVERGREEN, 3), RED],
  },
  {
    key: 'christmas-eve-effect',
    name: 'Christmas Eve: Govee Effect',
    occasion: CHRISTMAS,
    when: 'December 24',
    description: "Govee's moving Christmas Eve effect.",
    colors: [RED, GOLD, GREEN],
    sceneName: 'Christmas Eve',
  },
  {
    key: 'new-year-eve-midnight-gold',
    name: "New Year's Eve: Midnight Gold",
    occasion: NEW_YEAR,
    when: 'December 31, the day before',
    description: 'Gold and white over deep purple, ready for the countdown.',
    colors: [...run(GOLD, 2), WHITE, ...run(PURPLE, 2)],
  },
  {
    key: 'new-year-day-effect',
    name: "New Year's Day: Govee Effect",
    occasion: NEW_YEAR,
    when: 'January 1',
    description: "Govee's moving New Years effect.",
    colors: [GOLD, SILVER, WHITE],
    sceneName: 'New Years',
  },
  {
    key: 'new-year-after-calm',
    name: 'After New Year: Calm Glow',
    occasion: NEW_YEAR,
    when: 'January 2, the day after',
    description: 'A soft warm white with a little gold, winding things down.',
    colors: [...run(WARM, 4), GOLD],
  },
];

/** The show that runs automatically at midnight on January 1. */
export const FIREWORKS_PRESET: BuiltinPresetDefinition = {
  key: 'new-year-fireworks',
  name: 'New Year Fireworks',
  occasion: NEW_YEAR,
  when: 'Automatically at 12:00 AM on January 1',
  description: "Turns the lights on at full brightness and runs Govee's moving Fireworks effect.",
  colors: [GOLD, RED, WHITE, BLUE, GOLD, PURPLE, WHITE, GREEN],
  sceneName: 'Fireworks',
  brightness: 100,
};

const PINK = '#ff4d94';
const LAVENDER = '#a678ff';
const MINT = '#66e0a3';
const BUTTER = '#ffe680';
const ROYAL = '#1e3cc8';
const TURQUOISE = '#00b4b4';
const TERRACOTTA = '#c8552d';
const MAGENTA = '#e6007e';
const MARIGOLD = '#ffb300';
const LIME = '#66cc00';

const US_HOLIDAYS = 'US holidays';

/** Holiday colors the calendar uses. Many holidays have no official colors, so these are suggestions. */
export const HOLIDAY_PRESETS: readonly BuiltinPresetDefinition[] = [
  {
    key: 'holiday-new-year-day',
    name: "New Year's Day: Gold & Silver",
    occasion: US_HOLIDAYS,
    when: 'January 1',
    description: 'Gold, silver and white.',
    colors: [...run(GOLD, 2), ...run(SILVER, 2), WHITE],
  },
  {
    key: 'holiday-mlk',
    name: 'Martin Luther King Jr. Day: Unity',
    occasion: US_HOLIDAYS,
    when: 'Third Monday of January',
    description: 'Warm white, gold and deep blue.',
    colors: [...run(WARM, 3), GOLD, ...run(ROYAL, 2)],
  },
  {
    key: 'holiday-valentines',
    name: "Valentine's Day: Hearts",
    occasion: US_HOLIDAYS,
    when: 'February 14',
    description: 'Red, pink and white.',
    colors: [...run(RED, 2), ...run(PINK, 2), WHITE],
  },
  {
    key: 'holiday-presidents',
    name: "Presidents' Day: Stars & Stripes",
    occasion: US_HOLIDAYS,
    when: 'Third Monday of February',
    description: 'Red, white and blue.',
    colors: [...run(BLUE, 2), RED, WHITE, RED, WHITE],
  },
  {
    key: 'holiday-st-patricks',
    name: "St. Patrick's Day: Shamrock",
    occasion: US_HOLIDAYS,
    when: 'March 17',
    description: 'Greens, gold and white.',
    colors: [...run(GREEN, 2), LIME, GOLD, ...run(EVERGREEN, 2), WHITE],
  },
  {
    key: 'holiday-easter',
    name: 'Easter: Pastels',
    occasion: US_HOLIDAYS,
    when: 'Easter Sunday',
    description: 'Soft pink, lavender, mint and butter yellow.',
    colors: [PINK, LAVENDER, MINT, BUTTER],
  },
  {
    key: 'holiday-mothers',
    name: "Mother's Day: Blush",
    occasion: US_HOLIDAYS,
    when: 'Second Sunday of May',
    description: 'Pink, lavender and warm white.',
    colors: [...run(PINK, 2), LAVENDER, ...run(WARM, 2)],
  },
  {
    key: 'holiday-memorial',
    name: 'Memorial Day: Remembrance',
    occasion: US_HOLIDAYS,
    when: 'Last Monday of May',
    description: 'Poppy red, white and navy.',
    colors: [...run(RED, 2), ...run(WHITE, 2), ...run(NAVY, 2)],
  },
  {
    key: 'holiday-fathers',
    name: "Father's Day: Blue & Amber",
    occasion: US_HOLIDAYS,
    when: 'Third Sunday of June',
    description: 'Blue, navy and warm amber.',
    colors: [...run(BLUE, 2), NAVY, ...run(AMBER, 2)],
  },
  {
    key: 'holiday-juneteenth',
    name: 'Juneteenth: Freedom',
    occasion: US_HOLIDAYS,
    when: 'June 19',
    description: 'Red, gold and green.',
    colors: [...run(RED, 2), ...run(GOLD, 2), ...run(GREEN, 2)],
  },
  {
    key: 'holiday-independence',
    name: 'Independence Day: Red, White & Blue',
    occasion: US_HOLIDAYS,
    when: 'July 4',
    description: 'Bold red, white and blue.',
    colors: [RED, RED, WHITE, WHITE, BLUE, BLUE],
  },
  {
    key: 'holiday-labor',
    name: 'Labor Day: Navy & Gold',
    occasion: US_HOLIDAYS,
    when: 'First Monday of September',
    description: 'Navy, gold and white.',
    colors: [...run(NAVY, 2), ...run(GOLD, 2), WHITE],
  },
  {
    key: 'holiday-indigenous',
    name: "Columbus / Indigenous Peoples' Day: Earth & Sky",
    occasion: US_HOLIDAYS,
    when: 'Second Monday of October',
    description: 'Turquoise, terracotta and gold.',
    colors: [...run(TURQUOISE, 2), ...run(TERRACOTTA, 2), GOLD],
  },
  {
    key: 'holiday-halloween',
    name: 'Halloween: Spooky',
    occasion: US_HOLIDAYS,
    when: 'October 31',
    description: 'Orange, purple and green.',
    colors: [...run(ORANGE, 3), ...run(PURPLE, 2), LIME],
  },
  {
    key: 'diwali-colors',
    name: 'Diwali: Festival Colors',
    occasion: 'Diwali',
    when: 'Diwali evening',
    description: 'Gold, marigold, orange, magenta and red.',
    colors: [GOLD, MARIGOLD, ORANGE, MAGENTA, RED],
  },
  {
    key: 'diwali-fireworks',
    name: 'Diwali: Fireworks',
    occasion: 'Diwali',
    when: 'Diwali evening',
    description: "Turns the lights on at full brightness and runs Govee's moving Fireworks effect.",
    colors: [GOLD, MAGENTA, ORANGE, WHITE, RED, MARIGOLD],
    sceneName: 'Fireworks',
    brightness: 100,
  },
];

/**
 * Colors blending evenly from one stop to the next, `perLeg` colors per leg, with the last
 * stop included once. Each distinct color is a separate command to Govee, so keep this short.
 */
function blend(stops: string[], perLeg: number): string[] {
  const out: string[] = [];
  stops.slice(0, -1).forEach((from, i) => {
    const a = hexToRgb(from);
    const b = hexToRgb(stops[i + 1] as string);
    for (let k = 0; k < perLeg; k++) {
      const t = k / perLeg;
      out.push(rgbToHex({ r: Math.round(a.r + (b.r - a.r) * t), g: Math.round(a.g + (b.g - a.g) * t), b: Math.round(a.b + (b.b - a.b) * t) }));
    }
  });
  out.push(stops.at(-1) as string);
  return out;
}

/** Blends out and back, so the pattern repeats along the strings with no jump between copies. */
function wave(stops: string[], perLeg: number): string[] {
  const out = blend(stops, perLeg);
  return [...out, ...out.slice(1, -1).reverse()];
}

const BLACK = '#000000';
const VIOLET = '#8000ff';
const PAN_GREEN = '#00b040';
const EMERALD = '#00a86b';
const OCEAN = '#0a78ff';
const LEAF = '#00b050';
const FLAG_GREEN = '#00a000';
const YELLOW = '#ffd800';
const PRIDE_ORANGE = '#ff7a00';
const PRIDE_GREEN = '#00c040';
const PRIDE_BLUE = '#0050ff';
const PRIDE_VIOLET = '#8000c0';
const TRANS_PINK = '#f5a9b8';
const TRANS_BLUE = '#5bcefa';
const BROWN = '#8b4513';
const RIBBON_PINK = '#ff4da6';
const HANUKKAH_BLUE = '#1e50ff';

/**
 * Colors for months, heritage and awareness months, and festivals that move around the calendar.
 * They are only presets: nothing here is scheduled automatically. Many of these have no official
 * colors, so they are suggestions drawn from flags, ribbons and common custom. Black is a dark
 * segment, not a color, so it leaves a gap in the pattern. Each is a short run of colors, because
 * every distinct color is one command to Govee.
 */
export const MONTH_PRESETS: readonly BuiltinPresetDefinition[] = [
  {
    key: 'month-january-aurora',
    name: 'January: Aurora',
    occasion: 'January',
    when: 'All of January',
    description: 'Green, teal and violet that blend smoothly and loop, like the northern lights.',
    colors: wave(['#00e08a', '#00b4b4', '#6a3dff'], 3),
  },
  {
    key: 'month-lunar-new-year',
    name: 'Lunar New Year: Red & Gold',
    occasion: 'Lunar New Year',
    when: 'Late January to mid-February. The date follows the lunar calendar.',
    description: 'Red lanterns with gold sparks.',
    colors: [...run(RED, 3), GOLD, RED, RED, GOLD],
  },
  {
    key: 'month-black-history',
    name: 'February: Black History Month',
    occasion: 'Black History Month',
    when: 'All of February',
    description: 'Red, black and green from the Pan-African flag, with gold. Black segments stay dark.',
    colors: [...run(RED, 2), BLACK, ...run(PAN_GREEN, 2), BLACK, GOLD],
  },
  {
    key: 'month-womens-history',
    name: "March: Women's History Month",
    occasion: "Women's History Month",
    when: 'All of March',
    description: 'Purple, white and green, the suffragette colors.',
    colors: [...run(VIOLET, 2), WHITE, ...run(PAN_GREEN, 2), WHITE],
  },
  {
    key: 'month-holi',
    name: 'Holi: Festival of Colors',
    occasion: 'Holi',
    when: 'Spring full moon. The date follows the lunar calendar.',
    description: 'Magenta, orange, gold, lime, turquoise, blue and pink, all bright.',
    colors: [MAGENTA, ORANGE, GOLD, LIME, TURQUOISE, ROYAL, PINK],
  },
  {
    key: 'month-eid',
    name: 'Eid: Crescent Green & Gold',
    occasion: 'Eid',
    when: 'After Ramadan, and at Eid al-Adha. Dates follow the lunar calendar.',
    description: 'Emerald green with gold and white.',
    colors: [...run(EMERALD, 3), GOLD, WHITE],
  },
  {
    key: 'month-april-cherry-blossom',
    name: 'April: Cherry Blossom',
    occasion: 'April',
    when: 'All of April',
    description: 'Soft pink fading to white and back, looping with no jump.',
    colors: wave(['#ff7aa8', '#ffe9f1'], 4),
  },
  {
    key: 'month-earth-day',
    name: 'Earth Day: Blue & Green',
    occasion: 'Earth Day',
    when: 'April 22',
    description: 'Ocean blue, leaf green and cloud white.',
    colors: [...run(OCEAN, 2), ...run(LEAF, 2), WHITE],
  },
  {
    key: 'month-cinco-de-mayo',
    name: 'Cinco de Mayo: Green, White & Red',
    occasion: 'Cinco de Mayo',
    when: 'May 5',
    description: 'The colors of the Mexican flag.',
    colors: [...run(FLAG_GREEN, 2), ...run(WHITE, 2), ...run(RED, 2)],
  },
  {
    key: 'month-pride-rainbow',
    name: 'June: Pride Rainbow',
    occasion: 'Pride Month',
    when: 'All of June',
    description: 'The six stripes of the rainbow flag.',
    colors: [RED, PRIDE_ORANGE, YELLOW, PRIDE_GREEN, PRIDE_BLUE, PRIDE_VIOLET],
  },
  {
    key: 'month-pride-progress',
    name: 'June: Progress Pride',
    occasion: 'Pride Month',
    when: 'All of June',
    description:
      'The Progress Pride flag: its white, pink and light blue chevron, brown and black, then the rainbow. Black stays dark. It uses 11 colors, so it takes a little longer to send.',
    colors: [WHITE, TRANS_PINK, TRANS_BLUE, BROWN, BLACK, RED, PRIDE_ORANGE, YELLOW, PRIDE_GREEN, PRIDE_BLUE, PRIDE_VIOLET],
  },
  {
    key: 'month-summer-sunset',
    name: 'Summer: Sunset',
    occasion: 'Summer',
    when: 'June to August',
    description: 'Violet, magenta, orange and gold, blending smoothly and looping like a sunset sky.',
    colors: wave(['#7a1fff', MAGENTA, ORANGE, MARIGOLD], 2),
  },
  {
    key: 'month-hispanic-heritage',
    name: 'Hispanic Heritage Month: Fiesta',
    occasion: 'Hispanic Heritage Month',
    when: 'September 15 to October 15',
    description: 'Bright papel picado colors: marigold, magenta, turquoise, lime, red and blue.',
    colors: [MARIGOLD, MAGENTA, TURQUOISE, LIME, RED, ROYAL],
  },
  {
    key: 'month-pink-ribbon',
    name: 'October: Pink Ribbon',
    occasion: 'Breast Cancer Awareness Month',
    when: 'All of October',
    description: 'Pink and white, for Breast Cancer Awareness Month.',
    colors: [...run(RIBBON_PINK, 3), WHITE, ...run(RIBBON_PINK, 2), PINK],
  },
  {
    key: 'month-dia-de-muertos',
    name: 'Día de Muertos: Marigold Path',
    occasion: 'Día de Muertos',
    when: 'October 31 to November 2',
    description: 'Marigold and orange, with purple, magenta and white, like the flowers and paper banners.',
    colors: [MARIGOLD, ORANGE, MARIGOLD, VIOLET, MAGENTA, WHITE],
  },
  {
    key: 'month-hanukkah',
    name: 'Hanukkah: Blue & Silver',
    occasion: 'Hanukkah',
    when: 'Eight nights. The date follows the Hebrew calendar.',
    description: 'Blue, white and silver, with a gold accent.',
    colors: [HANUKKAH_BLUE, HANUKKAH_BLUE, WHITE, SILVER, HANUKKAH_BLUE, GOLD],
  },
  {
    key: 'month-winter-solstice',
    name: 'Winter Solstice: Longest Night',
    occasion: 'Winter Solstice',
    when: 'December 21',
    description: 'Midnight blue brightening to ice white and back, looping with no jump.',
    colors: wave(['#0b1d6e', '#3a5bff', '#e6f0ff'], 3),
  },
  {
    key: 'month-kwanzaa',
    name: 'Kwanzaa: Red, Black & Green',
    occasion: 'Kwanzaa',
    when: 'December 26 to January 1',
    description: 'The seven candles of the kinara: three red, one black and three green. Black stays dark.',
    colors: [...run(RED, 3), BLACK, ...run(PAN_GREEN, 3)],
  },
];

export const BUILTIN_PRESETS: readonly BuiltinPresetDefinition[] = [
  ...FESTIVAL_PRESETS,
  FIREWORKS_PRESET,
  ...HOLIDAY_PRESETS,
  ...MONTH_PRESETS,
];

export function builtinPresetByKey(key: string): BuiltinPresetDefinition | undefined {
  return BUILTIN_PRESETS.find((preset) => preset.key === key);
}

/** A sensible first guess at the physical order, until the owner arranges the strings. */
function nameRank(name: string): number {
  if (/\bleft\b/i.test(name)) return 0;
  if (/\b(center|centre|middle)\b/i.test(name)) return 1;
  if (/\bright\b/i.test(name)) return 2;
  return 3;
}

/** Saved order first. A light with no saved place joins the end, by likely physical position. */
export function orderLightStrings<T extends { id: string; name: string }>(devices: readonly T[], saved: readonly PatternStringSetting[]): T[] {
  const savedIndex = new Map(saved.map((entry, index) => [entry.deviceId, index]));
  return [...devices].sort((a, b) => {
    const left = savedIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const right = savedIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return left - right || nameRank(a.name) - nameRank(b.name) || a.name.localeCompare(b.name);
  });
}

export interface BuiltinString {
  deviceId: string;
  /** Segment numbers in on-screen order, so a flipped string runs high to low. */
  segments: number[];
  maxSelect: number;
  hasBrightness: boolean;
  /** The Govee scene with this name on this light, or null if it does not offer one. */
  findScene: (name: string) => { key: string; name: string } | null;
}

/**
 * The steps for each light. A pattern carries on from one string to the next, and each
 * light gets one command per color, not one per segment, which keeps changes quick.
 */
export function builtinPresetActions(definition: BuiltinPresetDefinition, strings: readonly BuiltinString[]): PresetActionInput[] {
  let position = 0;
  return strings.flatMap((string) => {
    const steps: DeviceAction[] = [{ type: 'power', on: true }];
    if (definition.brightness !== undefined && string.hasBrightness) {
      steps.push({ type: 'brightness', value: definition.brightness });
    }
    const scene = definition.sceneName ? string.findScene(definition.sceneName) : null;
    if (scene) {
      steps.push({ type: 'scene', sceneKey: scene.key, sceneName: scene.name });
    } else {
      const byColor = new Map<string, number[]>();
      string.segments.forEach((segment, i) => {
        const color = definition.colors[(position + i) % definition.colors.length] as string;
        byColor.set(color, [...(byColor.get(color) ?? []), segment]);
      });
      const limit = Math.max(1, string.maxSelect);
      for (const [hex, all] of [...byColor.entries()].sort((a, b) => b[1].length - a[1].length)) {
        const sorted = [...all].sort((a, b) => a - b);
        for (let i = 0; i < sorted.length; i += limit) {
          steps.push({ type: 'segmentColor', hex, segments: sorted.slice(i, i + limit) });
        }
      }
    }
    position += string.segments.length;
    return steps.map((action) => ({ deviceId: string.deviceId, action }));
  });
}
