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

export const BUILTIN_PRESETS: readonly BuiltinPresetDefinition[] = [...FESTIVAL_PRESETS, FIREWORKS_PRESET];

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
