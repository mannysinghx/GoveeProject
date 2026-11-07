import { describe, expect, it } from 'vitest';
import { findCapability, normalizeCapabilities, parseSceneOptions } from '../src/govee/capabilities.js';
import { mockFullDevice } from './support/mock-govee.js';

describe('capability normalization', () => {
  it('normalizes every control the test device reports', () => {
    const caps = normalizeCapabilities(mockFullDevice().capabilities as never);
    expect(caps.map((c) => c.kind).sort()).toEqual(
      ['brightness', 'color', 'colorTemperature', 'power', 'scene', 'scene', 'segmentedBrightness', 'segmentedColor'].sort(),
    );
    expect(findCapability(caps, 'power')).toMatchObject({ onValue: 1, offValue: 0 });
    expect(findCapability(caps, 'brightness')).toMatchObject({ min: 1, max: 100, step: 1, unit: 'percent' });
    expect(findCapability(caps, 'colorTemperature')).toMatchObject({ min: 2000, max: 9000 });
  });

  it('does not assume capabilities the device does not report', () => {
    const caps = normalizeCapabilities([
      {
        type: 'devices.capabilities.on_off',
        instance: 'powerSwitch',
        parameters: {
          dataType: 'ENUM',
          options: [
            { name: 'on', value: 1 },
            { name: 'off', value: 0 },
          ],
        },
      },
    ]);
    expect(findCapability(caps, 'brightness')).toBeUndefined();
    expect(findCapability(caps, 'segmentedColor')).toBeUndefined();
    expect(findCapability(caps, 'scene')).toBeUndefined();
  });

  it('uses each device\'s own Kelvin range rather than a shared one', () => {
    const caps = normalizeCapabilities([
      {
        type: 'devices.capabilities.color_setting',
        instance: 'colorTemperatureK',
        parameters: { dataType: 'INTEGER', range: { min: 2700, max: 6500, precision: 100 } },
      },
    ]);
    expect(findCapability(caps, 'colorTemperature')).toMatchObject({ min: 2700, max: 6500, step: 100 });
  });

  it('reads segments from an options list, as in the H6601 sample', () => {
    const caps = normalizeCapabilities([
      {
        type: 'devices.capabilities.segment_color_setting',
        instance: 'segmentedColorRgb',
        parameters: {
          dataType: 'STRUCT',
          fields: [
            { fieldName: 'segment', dataType: 'Array', options: [{ value: 0 }, { value: 1 }, { value: 2 }], required: true },
            { fieldName: 'rgb', dataType: 'INTEGER', range: { min: 0, max: 16777215 }, required: true },
          ],
        },
      },
    ]);
    expect(findCapability(caps, 'segmentedColor')).toMatchObject({ segments: [0, 1, 2], minSelect: 1, maxSelect: 3 });
  });

  it('reads segments from elementRange and size, as in the H713B sample', () => {
    const caps = normalizeCapabilities(mockFullDevice().capabilities as never);
    const segmented = findCapability(caps, 'segmentedColor');
    expect(segmented?.segments).toHaveLength(15);
    expect(segmented?.segments[14]).toBe(14);
    expect(segmented).toMatchObject({ minSelect: 1, maxSelect: 15 });
  });

  it('tolerates the misspelled "reauired" key in the documentation sample', () => {
    const caps = normalizeCapabilities([
      {
        type: 'devices.capabilities.segment_color_setting',
        instance: 'segmentedColorRgb',
        parameters: {
          dataType: 'STRUCT',
          fields: [
            { fieldName: 'segment', dataType: 'Array', options: [{ value: 0 }], required: true },
            { fieldName: 'rgb', dataType: 'INTEGER', reauired: true },
          ],
        },
      },
    ]);
    expect(findCapability(caps, 'segmentedColor')).toBeDefined();
  });

  it('accepts the "device.capabilities" prefix some documentation uses', () => {
    const caps = normalizeCapabilities([
      {
        type: 'device.capabilities.range',
        instance: 'brightness',
        parameters: { dataType: 'INTEGER', range: { min: 1, max: 100 } },
      },
    ]);
    expect(findCapability(caps, 'brightness')).toBeDefined();
  });

  it.each(['devices.capabilities.dynamic_scene', 'devices.capabilities.dynamic_setting', 'devices.capabilities.diy_color_setting'])(
    'recognises diyScene under the documented type %s, and keeps the type as sent',
    (type) => {
      const caps = normalizeCapabilities([
        { type, instance: 'diyScene', parameters: { dataType: 'ENUM', options: [{ name: 'Fade', value: 1 }] } },
      ]);
      expect(findCapability(caps, 'scene')).toMatchObject({ sceneKind: 'diy', type, listedOptionCount: 1 });
    },
  );

  it('keeps malformed metadata read-only rather than guessing limits', () => {
    const caps = normalizeCapabilities([
      { type: 'devices.capabilities.range', instance: 'brightness', parameters: { dataType: 'INTEGER' } },
      { type: 'devices.capabilities.on_off', instance: 'powerSwitch', parameters: { dataType: 'ENUM', options: [] } },
      {
        type: 'devices.capabilities.segment_color_setting',
        instance: 'segmentedColorRgb',
        parameters: { dataType: 'STRUCT', fields: [{ fieldName: 'segment', dataType: 'Array' }] },
      },
    ]);
    expect(caps.map((c) => c.kind)).toEqual(['other', 'other', 'other']);
    expect(caps.every((c) => c.kind === 'other' && c.reason === 'malformed_metadata')).toBe(true);
  });

  it('lists capabilities the app has no control for, read-only', () => {
    const caps = normalizeCapabilities([
      { type: 'devices.capabilities.music_setting', instance: 'musicMode', parameters: { dataType: 'STRUCT' } },
      { type: 'devices.capabilities.toggle', instance: 'gradientToggle', parameters: { dataType: 'ENUM' } },
    ]);
    expect(caps).toMatchObject([
      { kind: 'other', instance: 'musicMode', reason: 'not_controlled_by_app' },
      { kind: 'other', instance: 'gradientToggle', reason: 'not_controlled_by_app' },
    ]);
  });

  it('ignores entries with no usable type or instance, and removes duplicates', () => {
    const power = {
      type: 'devices.capabilities.on_off',
      instance: 'powerSwitch',
      parameters: {
        options: [
          { name: 'on', value: 1 },
          { name: 'off', value: 0 },
        ],
      },
    };
    expect(normalizeCapabilities([{ instance: 'x' }, { type: 1, instance: 2 }, power, power])).toHaveLength(1);
  });
});

describe('scene option parsing', () => {
  it('accepts the two documented value shapes, with keys stable across refreshes', () => {
    const options = parseSceneOptions('dynamic', {
      options: [
        { name: 'Sunrise', value: { paramId: 4280, id: 3853 } },
        { name: 'Plain', value: 3054 },
      ],
    });
    expect(options).toEqual([
      { key: 'dynamic-4280-3853', name: 'Sunrise', value: { paramId: 4280, id: 3853 } },
      { key: 'dynamic-3054', name: 'Plain', value: 3054 },
    ]);
  });

  it('skips undocumented shapes and duplicates instead of forwarding them to Govee', () => {
    const options = parseSceneOptions('diy', {
      options: [
        { name: 'A', value: 'string-value' },
        { name: 'B', value: { foo: 1 } },
        { name: 'C', value: 5 },
        { name: 'C again', value: 5 },
      ],
    });
    expect(options.map((o) => o.name)).toEqual(['C']);
  });

  it('returns nothing for missing parameters', () => {
    expect(parseSceneOptions('static', undefined)).toEqual([]);
  });
});
