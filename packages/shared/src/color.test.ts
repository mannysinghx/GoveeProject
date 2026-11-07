import { describe, expect, it } from 'vitest';
import { hexToInt, hexToRgb, intToHex, intToRgb, rgbToHex, rgbToInt } from './color.js';

describe('colour conversion', () => {
  it('matches the values in the project brief', () => {
    expect(rgbToInt({ r: 255, g: 0, b: 0 })).toBe(16711680);
    expect(rgbToInt({ r: 0, g: 255, b: 0 })).toBe(65280);
    expect(rgbToInt({ r: 0, g: 0, b: 255 })).toBe(255);
  });

  it('round trips every byte boundary', () => {
    for (const hex of ['#000000', '#ffffff', '#010203', '#ff8800', '#00ff7f']) {
      expect(intToHex(hexToInt(hex))).toBe(hex);
    }
    expect(intToRgb(16777215)).toEqual({ r: 255, g: 255, b: 255 });
    expect(rgbToHex({ r: 1, g: 2, b: 3 })).toBe('#010203');
  });

  it('serialises to a plain JSON integer', () => {
    expect(JSON.stringify({ rgb: hexToInt('#0000ff') })).toBe('{"rgb":255}');
  });

  it('rejects anything that is not #rrggbb', () => {
    for (const bad of ['ff0000', '#ff00', '#gg0000', '0xff0000', '']) {
      expect(() => hexToRgb(bad)).toThrow(RangeError);
    }
  });
});
