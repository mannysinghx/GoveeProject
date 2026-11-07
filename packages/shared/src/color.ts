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
