import type {
  NormalizedCapability,
  OtherCapability,
  SegmentedBrightnessCapability,
  SegmentedColorCapability,
} from '@glm/shared';
import type { RawCapability } from './transport.js';

/**
 * Turns Govee capability JSON into structures the rest of the app can trust.
 *
 * Rules:
 *  - Only what the device reports becomes a control. Nothing is inferred from a
 *    model number or from marketing material.
 *  - Metadata that is malformed becomes a read-only "other" entry rather than a
 *    control with guessed limits.
 *  - Known documentation quirks are tolerated: some samples spell the prefix
 *    "device.capabilities", diyScene appears under three different types, and
 *    field lists use both options arrays and elementRange/size for segments.
 */

const MAX_SEGMENTS = 512;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typeSuffix(type: string): string {
  return type.replace(/^devices?\.capabilities\./, '');
}

interface Range {
  min: number;
  max: number;
  step: number;
}

function readRange(params: unknown): Range | null {
  if (!isObject(params) || !isObject(params.range)) return null;
  const { min, max, precision } = params.range;
  if (typeof min !== 'number' || typeof max !== 'number' || min > max) return null;
  const step = typeof precision === 'number' && precision > 0 ? precision : 1;
  return { min, max, step };
}

function readUnit(params: unknown): string | null {
  if (!isObject(params) || typeof params.unit !== 'string') return null;
  return params.unit.replace(/^unit\./, '');
}

function readDataType(params: unknown): string | null {
  return isObject(params) && typeof params.dataType === 'string' ? params.dataType : null;
}

function readEnumOptions(params: unknown): { name: string; value: unknown }[] {
  if (!isObject(params) || !Array.isArray(params.options)) return [];
  return params.options.filter(
    (o): o is { name: string; value: unknown } => isObject(o) && typeof o.name === 'string' && 'value' in o,
  );
}

function fieldByName(params: unknown, name: string): Record<string, unknown> | null {
  if (!isObject(params) || !Array.isArray(params.fields)) return null;
  const match = params.fields.find((f) => isObject(f) && f.fieldName === name);
  return isObject(match) ? match : null;
}

interface SegmentInfo {
  segments: number[];
  minSelect: number;
  maxSelect: number;
}

/** Govee describes segment indexes either as an options list or as elementRange and size. */
function readSegments(field: Record<string, unknown> | null): SegmentInfo | null {
  if (!field) return null;
  let segments: number[] = [];

  if (Array.isArray(field.options)) {
    segments = field.options
      .map((o) => (isObject(o) ? o.value : undefined))
      .filter((v): v is number => Number.isInteger(v) && (v as number) >= 0);
  } else if (isObject(field.elementRange)) {
    const { min, max } = field.elementRange;
    if (Number.isInteger(min) && Number.isInteger(max) && (min as number) >= 0 && (max as number) >= (min as number)) {
      const count = (max as number) - (min as number) + 1;
      if (count > MAX_SEGMENTS) return null;
      segments = Array.from({ length: count }, (_, i) => (min as number) + i);
    }
  }

  segments = [...new Set(segments)].sort((a, b) => a - b);
  if (segments.length === 0 || segments.length > MAX_SEGMENTS) return null;

  let minSelect = 1;
  let maxSelect = segments.length;
  if (isObject(field.size)) {
    if (Number.isInteger(field.size.min)) minSelect = Math.max(1, field.size.min as number);
    if (Number.isInteger(field.size.max)) maxSelect = Math.min(segments.length, field.size.max as number);
  }
  return { segments, minSelect, maxSelect: Math.max(minSelect, maxSelect) };
}

function other(type: string, instance: string, params: unknown, reason: OtherCapability['reason']): OtherCapability {
  return { kind: 'other', type, instance, dataType: readDataType(params), reason };
}

function normalizeOne(raw: RawCapability): NormalizedCapability | null {
  if (typeof raw.type !== 'string' || typeof raw.instance !== 'string') return null;
  const { type, instance, parameters: params } = raw;
  const suffix = typeSuffix(type);

  if (suffix === 'on_off' && instance === 'powerSwitch') {
    const options = readEnumOptions(params);
    const on = options.find((o) => o.name.toLowerCase() === 'on');
    const off = options.find((o) => o.name.toLowerCase() === 'off');
    if (!on || !off || typeof on.value !== 'number' || typeof off.value !== 'number') {
      return other(type, instance, params, 'malformed_metadata');
    }
    return { kind: 'power', type, instance, onValue: on.value, offValue: off.value };
  }

  if (suffix === 'range' && instance === 'brightness') {
    const range = readRange(params);
    if (!range) return other(type, instance, params, 'malformed_metadata');
    return { kind: 'brightness', type, instance, ...range, unit: readUnit(params) };
  }

  if (suffix === 'color_setting' && instance === 'colorRgb') {
    const range = readRange(params);
    if (!range) return other(type, instance, params, 'malformed_metadata');
    return { kind: 'color', type, instance, min: range.min, max: range.max };
  }

  if (suffix === 'color_setting' && instance === 'colorTemperatureK') {
    const range = readRange(params);
    if (!range) return other(type, instance, params, 'malformed_metadata');
    return { kind: 'colorTemperature', type, instance, ...range, unit: readUnit(params) };
  }

  if (suffix === 'segment_color_setting' && instance === 'segmentedColorRgb') {
    const info = readSegments(fieldByName(params, 'segment'));
    if (!info) return other(type, instance, params, 'malformed_metadata');
    const capability: SegmentedColorCapability = { kind: 'segmentedColor', type, instance, ...info };
    return capability;
  }

  if (suffix === 'segment_color_setting' && instance === 'segmentedBrightness') {
    const info = readSegments(fieldByName(params, 'segment'));
    const range = readRange(fieldByName(params, 'brightness'));
    if (!info || !range) return other(type, instance, params, 'malformed_metadata');
    const capability: SegmentedBrightnessCapability = {
      kind: 'segmentedBrightness',
      type,
      instance,
      ...info,
      ...range,
    };
    return capability;
  }

  if (instance === 'lightScene' || instance === 'diyScene' || instance === 'snapshot') {
    const sceneKind = instance === 'lightScene' ? 'static' : instance === 'diyScene' ? 'diy' : 'snapshot';
    return {
      kind: 'scene',
      type,
      instance,
      sceneKind,
      listedOptionCount: readEnumOptions(params).length,
    };
  }

  return other(type, instance, params, 'not_controlled_by_app');
}

export function normalizeCapabilities(raw: RawCapability[]): NormalizedCapability[] {
  const out: NormalizedCapability[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const normalized = normalizeOne(entry);
    if (!normalized) continue;
    const key = `${normalized.type}/${normalized.instance}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

export function findCapability<K extends NormalizedCapability['kind']>(
  capabilities: NormalizedCapability[],
  kind: K,
): Extract<NormalizedCapability, { kind: K }> | undefined {
  return capabilities.find((c) => c.kind === kind) as Extract<NormalizedCapability, { kind: K }> | undefined;
}

export interface ParsedSceneOption {
  key: string;
  name: string;
  value: number | { paramId: number; id: number };
}

/**
 * Reads scene options from a capability's ENUM. Only the two value shapes the
 * documentation shows are accepted: an integer or {paramId, id}. The key is
 * built from the value so that it stays stable across refreshes.
 */
export function parseSceneOptions(prefix: string, parameters: unknown): ParsedSceneOption[] {
  const out: ParsedSceneOption[] = [];
  const seen = new Set<string>();
  for (const option of readEnumOptions(parameters)) {
    const value = option.value;
    let key: string | null = null;
    let parsed: ParsedSceneOption['value'] | null = null;
    if (Number.isInteger(value)) {
      key = `${prefix}-${value as number}`;
      parsed = value as number;
    } else if (isObject(value) && Number.isInteger(value.paramId) && Number.isInteger(value.id)) {
      key = `${prefix}-${value.paramId as number}-${value.id as number}`;
      parsed = { paramId: value.paramId as number, id: value.id as number };
    }
    if (key === null || parsed === null || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, name: option.name, value: parsed });
  }
  return out;
}
