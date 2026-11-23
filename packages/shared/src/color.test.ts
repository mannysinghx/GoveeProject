import { describe, expect, it } from 'vitest';
import {
  colorName,
  ensureVivid,
  hexToInt,
  hexToRgb,
  hsvToRgb,
  hueDistance,
  intToHex,
  intToRgb,
  kelvinToHex,
  mixColors,
  rgbToHex,
  rgbToHsv,
  rgbToInt,
} from './color.js';

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

describe('colour maths for moods', () => {
  it('converts to HSV and back without losing the colour', () => {
    expect(rgbToHsv({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 1, v: 1 });
    expect(rgbToHsv({ r: 0, g: 0, b: 255 })).toMatchObject({ h: 240, s: 1, v: 1 });
    expect(rgbToHsv({ r: 0, g: 0, b: 0 })).toEqual({ h: 0, s: 0, v: 0 });
    for (const hex of ['#ff8800', '#12ab98', '#a020f0', '#ffd7a8', '#808080']) {
      expect(rgbToHex(hsvToRgb(rgbToHsv(hexToRgb(hex))))).toBe(hex);
    }
  });

  it('measures hue distance the short way round the wheel', () => {
    expect(hueDistance(350, 10)).toBe(20);
    expect(hueDistance(10, 350)).toBe(20);
    expect(hueDistance(0, 180)).toBe(180);
    expect(hueDistance(90, 90)).toBe(0);
  });

  it('raises a dark colour to a usable one and leaves bright ones alone', () => {
    expect(ensureVivid('#ff8800')).toEqual({ hex: '#ff8800', changed: false });
    const raised = ensureVivid('#101040');
    expect(raised.changed).toBe(true);
    const hsv = rgbToHsv(hexToRgb(raised.hex));
    expect(hsv.v).toBeGreaterThanOrEqual(0.49);
    // The hue stays blue.
    expect(hueDistance(hsv.h, rgbToHsv(hexToRgb('#101040')).h)).toBeLessThan(4);
    expect(ensureVivid('#FF8800').hex).toBe('#ff8800');
  });

  it('blends between colours, and the ends are the colours themselves', () => {
    expect(mixColors('#ff0000', '#0000ff', 0)).toBe('#ff0000');
    expect(mixColors('#ff0000', '#0000ff', 1)).toBe('#0000ff');
    // Red to blue goes through a rich purple, not a grey one: mixing straight in RGB gives 128, 0, 128.
    const mid = rgbToHsv(hexToRgb(mixColors('#ff0000', '#0000ff', 0.5)));
    expect(mid.s).toBeGreaterThan(0.6);
    expect(mid.v).toBeGreaterThan(0.6);
    expect(mid.h).toBeGreaterThan(270);
    expect(mid.h).toBeLessThan(345);
    // Red to green goes the short way, through orange and yellow, and stays bright.
    const warm = rgbToHsv(hexToRgb(mixColors('#ff0000', '#00ff00', 0.5)));
    expect(warm.h).toBeGreaterThan(30);
    expect(warm.h).toBeLessThan(80);
    expect(warm.s).toBeGreaterThan(0.8);
    expect(mixColors('#336699', '#336699', 0.4)).toBe('#336699');
    expect(mixColors('#ff0000', '#00ff00', -5)).toBe('#ff0000');
    expect(mixColors('#ff0000', '#00ff00', 5)).toBe('#00ff00');
  });

  it('turns a white temperature into a colour', () => {
    expect(kelvinToHex(6600)).toBe('#ffffff');
    const warm = hexToRgb(kelvinToHex(2700));
    expect(warm.r).toBe(255);
    expect(warm.b).toBeLessThan(warm.g);
    expect(warm.g).toBeLessThan(warm.r);
    const cool = hexToRgb(kelvinToHex(9000));
    expect(cool.b).toBe(255);
    expect(cool.r).toBeLessThan(cool.b);
  });

  it('names colours in plain words', () => {
    expect(colorName('#ff0000')).toBe('red');
    expect(colorName('#ff7a1a')).toBe('orange');
    expect(colorName('#ffbf00')).toBe('amber');
    expect(colorName('#00c853')).toBe('green');
    expect(colorName('#1e5aff')).toBe('blue');
    expect(colorName('#a020f0')).toBe('violet');
    expect(colorName('#ffffff')).toBe('white');
    expect(colorName('#ffd7a8')).toBe('warm white');
    expect(colorName('#f0f4ff')).toBe('cool white');
    expect(colorName('#000000')).toBe('near black');
    expect(colorName('#7a0000')).toBe('deep red');
  });
});
