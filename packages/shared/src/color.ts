export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Govee takes colours as a single decimal integer. Red, green and blue occupy
 * the high, middle and low bytes: rgbToInt({r: 255, g: 0, b: 0}) === 16711680.
 * The result is a plain JSON number, never a hex literal.
 */
export function rgbToInt({ r, g, b }: Rgb): number {
  return (r << 16) | (g << 8) | b;
}

export function intToRgb(value: number): Rgb {
  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  };
}

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: string): boolean {
  return HEX_PATTERN.test(value);
}

export function hexToRgb(hex: string): Rgb {
  if (!isHexColor(hex)) {
    throw new RangeError(`Not a #rrggbb colour: ${hex}`);
  }
  return intToRgb(Number.parseInt(hex.slice(1), 16));
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const part = (n: number) => n.toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

export function hexToInt(hex: string): number {
  return rgbToInt(hexToRgb(hex));
}

export function intToHex(value: number): string {
  return rgbToHex(intToRgb(value));
}

const EMOJI_COLORS: readonly (readonly [string, number, number, number])[] = [
  ['🟥', 255, 0, 0],
  ['🟧', 255, 128, 0],
  ['🟨', 255, 220, 0],
  ['🟩', 0, 200, 0],
  ['🟦', 30, 90, 255],
  ['🟪', 150, 30, 220],
  ['🟫', 130, 70, 20],
  ['⬜', 255, 255, 255],
  ['⬛', 0, 0, 0],
];

/** The closest colored square, so a color can be shown in plain notification text. */
export function colorEmoji(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  let best = '⬜';
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [emoji, er, eg, eb] of EMOJI_COLORS) {
    const distance = (r - er) ** 2 + (g - eg) ** 2 + (b - eb) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = emoji;
    }
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/* Colour maths for moods                                                     */
/* -------------------------------------------------------------------------- */

export interface Hsv {
  /** Degrees, 0 up to 360. */
  h: number;
  /** 0 to 1. */
  s: number;
  /** 0 to 1. */
  v: number;
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  const byte = (n: number) => Math.round(Math.min(1, Math.max(0, n + m)) * 255);
  return { r: byte(r), g: byte(g), b: byte(b) };
}

/** The shorter way round the colour wheel between two hues, in degrees, 0 to 180. */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/**
 * LEDs show a dark colour as a dim, muddy one, and the light's own brightness already sets how
 * bright the whole string is. So a colour darker than this is raised, keeping its hue and richness.
 */
export const MIN_LED_VALUE = 0.5;

export function ensureVivid(hex: string, minValue = MIN_LED_VALUE): { hex: string; changed: boolean } {
  const hsv = rgbToHsv(hexToRgb(hex));
  if (hsv.v >= minValue) return { hex: hex.toLowerCase(), changed: false };
  return { hex: rgbToHex(hsvToRgb({ ...hsv, v: minValue })), changed: true };
}

const toLinear = (c: number) => {
  const n = c / 255;
  return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (c: number) => {
  const n = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, n)) * 255);
};

/**
 * A blend between two colours, `t` of the way from the first to the second. It blends by hue,
 * lightness and richness in Oklch, going the short way round the colour wheel, so a blend of two
 * bright colours stays bright. Mixing red and blue straight in RGB or Oklab goes grey in the middle.
 */
export function mixColors(from: string, to: string, t: number): string {
  const lch = (hex: string) => {
    const { r, g, b } = hexToRgb(hex);
    const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)] as const;
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    return { L, C: Math.hypot(A, B), h: (Math.atan2(B, A) * 180) / Math.PI };
  };
  const clamped = Math.min(1, Math.max(0, t));
  const a = lch(from);
  const b = lch(to);
  // A grey has no hue of its own, so it takes the other colour's.
  const ha = a.C < 0.02 ? b.h : a.h;
  const hb = b.C < 0.02 ? a.h : b.h;
  let dh = hb - ha;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  const L = a.L + (b.L - a.L) * clamped;
  const C = a.C + (b.C - a.C) * clamped;
  const h = ((ha + dh * clamped) * Math.PI) / 180;
  const A = C * Math.cos(h);
  const B = C * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return rgbToHex({
    r: fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  });
}

/** The colour of a white light at this temperature, for a light that can only show RGB. */
export function kelvinToHex(kelvin: number): string {
  const t = Math.min(40_000, Math.max(1_000, kelvin)) / 100;
  const red = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const green = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
  const blue = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const byte = (n: number) => Math.round(Math.min(255, Math.max(0, n)));
  return rgbToHex({ r: byte(red), g: byte(green), b: byte(blue) });
}

/** A plain-words name for a colour, for a reviewer that cannot see it, and for captions. */
export function colorName(hex: string): string {
  const { h, s, v } = rgbToHsv(hexToRgb(hex));
  if (v < 0.2) return 'near black';
  if (s < 0.04) return v > 0.85 ? 'white' : v > 0.5 ? 'light grey' : 'grey';
  if (s < 0.35 && v > 0.8) {
    // A faint tint of a hue: whites are named by their warmth.
    if (h < 70 || h >= 330) return 'warm white';
    if (h >= 170 && h < 270) return 'cool white';
  }
  const family =
    h < 12 || h >= 345
      ? 'red'
      : h < 38
        ? 'orange'
        : h < 52
          ? 'amber'
          : h < 70
            ? 'yellow'
            : h < 95
              ? 'lime'
              : h < 160
                ? 'green'
                : h < 195
                  ? 'teal'
                  : h < 215
                    ? 'cyan'
                    : h < 255
                      ? 'blue'
                      : h < 290
                        ? 'violet'
                        : h < 320
                          ? 'magenta'
                          : 'pink';
  const shade = v < 0.5 ? 'deep ' : s < 0.5 ? 'soft ' : '';
  return `${shade}${family}`;
}
