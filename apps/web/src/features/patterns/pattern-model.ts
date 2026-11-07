import {
  hexToRgb,
  rgbToHex,
  type DeviceDto,
  type PatternStringSetting,
  type PresetActionInput,
  type PresetDto,
  type SegmentedColorCapability,
} from '@glm/shared';

/**
 * A canvas covers every connected light string, one after another. Paint belongs to a
 * specific segment of a specific light, so it follows the string when strings are
 * reordered, flipped or left out. A segment with no paint shows the background.
 */
export interface PatternState {
  background: string;
  cells: Record<string, string>;
}

export interface PatternString {
  deviceId: string;
  name: string;
  connectivity: DeviceDto['connectivity'];
  /** Segment numbers in on-screen order. Flipped strings run high to low. */
  segments: number[];
  maxSelect: number;
  included: boolean;
  reversed: boolean;
}

export interface PatternCell {
  key: string;
  deviceId: string;
  deviceName: string;
  segment: number;
}

export function cellKey(deviceId: string, segment: number): string {
  return `${deviceId}:${segment}`;
}

function segmentCapability(device: DeviceDto): SegmentedColorCapability | undefined {
  return device.capabilities.find((c) => c.kind === 'segmentedColor') as SegmentedColorCapability | undefined;
}

/** Everything on the account that can be painted. Groups and other lights do not qualify. */
export function paintableDevices(devices: DeviceDto[]): DeviceDto[] {
  return devices.filter((d) => d.discoveryStatus === 'present' && segmentCapability(d) !== undefined);
}

/** A sensible first guess at the physical order, until the owner arranges it themselves. */
function nameRank(name: string): number {
  if (/\bleft\b/i.test(name)) return 0;
  if (/\b(center|centre|middle)\b/i.test(name)) return 1;
  if (/\bright\b/i.test(name)) return 2;
  return 3;
}

/**
 * Combines what Govee reports now with the saved arrangement. Saved order comes first.
 * A newly added light joins at the end, and a light that has gone is simply not listed.
 */
export function resolveStrings(devices: DeviceDto[], saved: PatternStringSetting[]): PatternString[] {
  const paintable = paintableDevices(devices);
  const savedIndex = new Map(saved.map((entry, index) => [entry.deviceId, { entry, index }]));
  const ordered = [...paintable].sort((a, b) => {
    const left = savedIndex.get(a.id)?.index ?? Number.MAX_SAFE_INTEGER;
    const right = savedIndex.get(b.id)?.index ?? Number.MAX_SAFE_INTEGER;
    return left - right || nameRank(a.name) - nameRank(b.name) || a.name.localeCompare(b.name);
  });
  return ordered.map((device) => {
    const capability = segmentCapability(device) as SegmentedColorCapability;
    const entry = savedIndex.get(device.id)?.entry;
    const reversed = entry?.reversed ?? false;
    return {
      deviceId: device.id,
      name: device.name,
      connectivity: device.connectivity,
      segments: reversed ? [...capability.segments].reverse() : capability.segments,
      maxSelect: capability.maxSelect,
      included: entry?.included ?? true,
      reversed,
    };
  });
}

export function toSettings(strings: PatternString[]): PatternStringSetting[] {
  return strings.map(({ deviceId, included, reversed }) => ({ deviceId, included, reversed }));
}

export function moveString(strings: PatternString[], deviceId: string, direction: -1 | 1): PatternString[] {
  const index = strings.findIndex((s) => s.deviceId === deviceId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= strings.length) return strings;
  const next = [...strings];
  const [item] = next.splice(index, 1);
  if (item) next.splice(target, 0, item);
  return next;
}

/** Every cell shown, in order along the whole run of lights. */
export function canvasCells(strings: PatternString[]): PatternCell[] {
  return strings
    .filter((s) => s.included)
    .flatMap((s) =>
      s.segments.map((segment) => ({
        key: cellKey(s.deviceId, segment),
        deviceId: s.deviceId,
        deviceName: s.name,
        segment,
      })),
    );
}

export function emptyPattern(background = '#ffffff'): PatternState {
  return { background, cells: {} };
}

export function cellColor(state: PatternState, key: string): string {
  return state.cells[key] ?? state.background;
}

export function paintCell(state: PatternState, key: string, color: string | null): PatternState {
  const current = state.cells[key] ?? null;
  if (current === color) return state;
  const cells = { ...state.cells };
  if (color === null) delete cells[key];
  else cells[key] = color;
  return { ...state, cells };
}

export function clearPattern(state: PatternState): PatternState {
  return { ...state, cells: {} };
}

/** A fixed blend along the whole run. It does not move: that needs the lights' own effects. */
export function gradientFill(state: PatternState, cells: PatternCell[], from: string, to: string): PatternState {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const last = Math.max(1, cells.length - 1);
  const next = { ...state.cells };
  cells.forEach((cell, i) => {
    const t = i / last;
    next[cell.key] = rgbToHex({
      r: Math.round(a.r + (b.r - a.r) * t),
      g: Math.round(a.g + (b.g - a.g) * t),
      b: Math.round(a.b + (b.b - a.b) * t),
    });
  });
  return { ...state, cells: next };
}

/** Repeats runs of colours along the whole run, carrying on from one string to the next. */
export function repeatFill(state: PatternState, cells: PatternCell[], colors: string[], runLength: number): PatternState {
  const run = Math.max(1, Math.floor(runLength));
  const next = { ...state.cells };
  cells.forEach((cell, i) => {
    const color = colors[Math.floor(i / run) % colors.length];
    if (color) next[cell.key] = color;
  });
  return { ...state, cells: next };
}

/** Rows of cell positions that zigzag, so every other row runs right to left. */
export function serpentineRows(count: number, perRow: number): number[][] {
  const rows: number[][] = [];
  for (let start = 0; start < count; start += perRow) {
    const row = Array.from({ length: Math.min(perRow, count - start) }, (_, i) => start + i);
    rows.push(rows.length % 2 === 0 ? row : row.reverse());
  }
  return rows;
}

export interface PatternOptions {
  turnOn: boolean;
  /** Overall brightness, or null to leave it as it is. */
  brightness: number | null;
}

/**
 * What each light must be sent, in order. Each gets only its own segments, in the fewest
 * commands: one per colour, not one per segment. Each command takes real time at Govee's
 * rate limits, so this is what keeps painting usable.
 */
export function patternToActions(state: PatternState, strings: PatternString[], options: PatternOptions): PresetActionInput[] {
  return strings
    .filter((s) => s.included)
    .flatMap((string) => {
      const byColor = new Map<string, number[]>();
      for (const segment of string.segments) {
        const hex = cellColor(state, cellKey(string.deviceId, segment)).toLowerCase();
        byColor.set(hex, [...(byColor.get(hex) ?? []), segment]);
      }
      const steps: PresetActionInput['action'][] = [];
      if (options.turnOn) steps.push({ type: 'power', on: true });
      if (options.brightness !== null) steps.push({ type: 'brightness', value: options.brightness });
      const limit = Math.max(1, string.maxSelect);
      const largestFirst = [...byColor.entries()].sort((a, b) => b[1].length - a[1].length);
      for (const [hex, all] of largestFirst) {
        const sorted = [...all].sort((a, b) => a - b);
        for (let i = 0; i < sorted.length; i += limit) {
          steps.push({ type: 'segmentColor', hex, segments: sorted.slice(i, i + limit) });
        }
      }
      return steps.map((action) => ({ deviceId: string.deviceId, action }));
    });
}

/** The busiest light decides how long it takes, since lights change independently. */
export function slowestStringCommands(actions: PresetActionInput[]): number {
  const counts = new Map<string, number>();
  for (const { deviceId } of actions) counts.set(deviceId ?? '', (counts.get(deviceId ?? '') ?? 0) + 1);
  return Math.max(0, ...counts.values());
}

/** True when a preset could only have come from painting, so the editor can reopen it. */
export function isPatternPreset(preset: PresetDto): boolean {
  const steps = preset.actions.map((a) => a.action.type);
  return (
    steps.includes('segmentColor') && steps.every((t) => t === 'segmentColor' || t === 'power' || t === 'brightness')
  );
}

export interface LoadedPattern {
  state: PatternState;
  turnOn: boolean;
  brightness: number | null;
  /** Lights this pattern paints that are not on the canvas. Saving would drop them. */
  notShown: string[];
}

export function patternFromPreset(preset: PresetDto, strings: PatternString[]): LoadedPattern {
  const colors = new Map<string, string>();
  const notShown = new Set<string>();
  const shown = strings.filter((s) => s.included);
  let turnOn = false;
  let brightness: number | null = null;

  for (const { action, deviceId, deviceName } of preset.actions) {
    if (action.type === 'power' && action.on) turnOn = true;
    if (action.type === 'brightness') brightness = action.value;
    if (action.type !== 'segmentColor') continue;
    if (deviceId !== null && !shown.some((s) => s.deviceId === deviceId)) {
      notShown.add(deviceName ?? 'A light that is no longer available');
      continue;
    }
    // A step with no device came from an earlier version, and applies to whichever lights are chosen.
    const targets = deviceId === null ? shown : shown.filter((s) => s.deviceId === deviceId);
    for (const string of targets) {
      for (const segment of action.segments) {
        if (string.segments.includes(segment)) colors.set(cellKey(string.deviceId, segment), action.hex.toLowerCase());
      }
    }
  }

  // The most common colour becomes the background, so erasing behaves as it did when painted.
  const counts = new Map<string, number>();
  for (const color of colors.values()) counts.set(color, (counts.get(color) ?? 0) + 1);
  const background = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '#ffffff';
  const cells: Record<string, string> = {};
  for (const [key, color] of colors) if (color !== background) cells[key] = color;

  return { turnOn, brightness, notShown: [...notShown], state: { background, cells } };
}

/** Dark or light cell numbers, whichever is readable on this colour. */
export function readableTextColor(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  return (r * 299 + g * 587 + b * 114) / 1000 > 140 ? '#15181b' : '#ffffff';
}
