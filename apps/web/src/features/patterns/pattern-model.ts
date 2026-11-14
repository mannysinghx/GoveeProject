import {
  hexToRgb,
  orderLightStrings,
  rgbToHex,
  type AiPatternDraftRequest,
  type DeviceDto,
  type PatternDraft,
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

/**
 * Published sizes, because Govee's API reports neither length nor LED count. H805C is the
 * Permanent Outdoor Lights Elite: its manual lists 150 ft, and it has about 72 LEDs per 100 ft.
 */
const MODEL_SPECS: Record<string, { lengthFeet: number; ledsPer100Feet: number }> = {
  H805C: { lengthFeet: 150, ledsPer100Feet: 72 },
};

export interface ModelSize {
  lengthFeet: number;
  ledsPer100Feet: number;
  leds: number;
}

/** Works out a string's LEDs from its model, or null when the model is not known. */
export function modelSize(sku: string): ModelSize | null {
  const spec = MODEL_SPECS[sku.toUpperCase()];
  if (!spec) return null;
  return { ...spec, leds: Math.round((spec.lengthFeet * spec.ledsPer100Feet) / 100) };
}

export interface PatternString {
  deviceId: string;
  name: string;
  sku: string;
  /** LEDs on this string, or null when neither the model nor the owner says. */
  ledCount: number | null;
  ledSource: 'owner' | 'model' | null;
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

/**
 * Combines what Govee reports now with the saved arrangement. Saved order comes first.
 * A newly added light joins at the end, and a light that has gone is simply not listed.
 */
export function resolveStrings(devices: DeviceDto[], saved: PatternStringSetting[]): PatternString[] {
  const paintable = paintableDevices(devices);
  const savedIndex = new Map(saved.map((entry) => [entry.deviceId, { entry }]));
  const ordered = orderLightStrings(paintable, saved);
  return ordered.map((device) => {
    const capability = segmentCapability(device) as SegmentedColorCapability;
    const entry = savedIndex.get(device.id)?.entry;
    const reversed = entry?.reversed ?? false;
    const fromModel = modelSize(device.sku)?.leds ?? null;
    const count = entry?.ledCount ?? fromModel;
    return {
      deviceId: device.id,
      name: device.name,
      sku: device.sku,
      // Every segment has at least one LED, so there cannot be fewer LEDs than segments.
      ledCount: count === null ? null : Math.max(count, capability.segments.length),
      ledSource: entry?.ledCount !== undefined ? 'owner' : fromModel !== null ? 'model' : null,
      connectivity: device.connectivity,
      segments: reversed ? [...capability.segments].reverse() : capability.segments,
      maxSelect: capability.maxSelect,
      included: entry?.included ?? true,
      reversed,
    };
  });
}

export function toSettings(strings: PatternString[]): PatternStringSetting[] {
  return strings.map(({ deviceId, included, reversed, ledCount, ledSource }) => ({
    deviceId,
    included,
    reversed,
    ...(ledSource === 'owner' && ledCount !== null ? { ledCount } : {}),
  }));
}

/** Applies the owner's count, or goes back to the model's when given null. */
export function withLedCount(strings: PatternString[], deviceId: string, count: number | null): PatternString[] {
  return strings.map((s) => {
    if (s.deviceId !== deviceId) return s;
    if (count !== null) return { ...s, ledCount: Math.max(count, s.segments.length), ledSource: 'owner' };
    const fromModel = modelSize(s.sku)?.leds ?? null;
    return {
      ...s,
      ledCount: fromModel === null ? null : Math.max(fromModel, s.segments.length),
      ledSource: fromModel === null ? null : 'model',
    };
  });
}

/**
 * The LEDs a segment covers, numbered from the start of the string, in on-screen order.
 * Empty when the LED count is not known. Govee can only colour whole segments, so these
 * LEDs always change together. LEDs that do not divide evenly are spread along the string.
 */
export function ledsInSegment(string: Pick<PatternString, 'segments' | 'ledCount' | 'reversed'>, segment: number): number[] {
  if (string.ledCount === null) return [];
  const total = string.segments.length;
  const position = string.segments.indexOf(segment);
  if (position < 0) return [];
  const index = string.reversed ? total - 1 - position : position;
  const start = Math.floor((index * string.ledCount) / total);
  const end = Math.floor(((index + 1) * string.ledCount) / total);
  const leds = Array.from({ length: end - start }, (_, i) => start + i + 1);
  return string.reversed ? leds.reverse() : leds;
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

/**
 * Makes everything one color. It becomes the background, not paint on every cell, so
 * anything painted afterwards still counts as the pattern for Repeat. The background is
 * shared, so this also covers strings left out of the canvas if they are included later.
 */
export function oneColor(state: PatternState, hex: string): PatternState {
  if (state.background === hex && Object.keys(state.cells).length === 0) return state;
  return { background: hex, cells: {} };
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

/** How many cells the painted part covers, from the first painted cell to the last. */
export function paintedSpan(state: PatternState, cells: PatternCell[]): number {
  const painted = cells.flatMap((cell, i) => (state.cells[cell.key] !== undefined ? [i] : []));
  const first = painted[0];
  const last = painted.at(-1);
  return first === undefined || last === undefined ? 0 : last - first + 1;
}

/** Position of the first painted cell along the run, or -1 when nothing is painted. */
export function paintedStart(state: PatternState, cells: PatternCell[]): number {
  return cells.findIndex((cell) => state.cells[cell.key] !== undefined);
}

/** True when two states show exactly the same colours in these cells, including the background. */
export function sameLook(a: PatternState, b: PatternState, cells: PatternCell[]): boolean {
  return a.background === b.background && cells.every((cell) => a.cells[cell.key] === b.cells[cell.key]);
}

/**
 * onward: copies carry on after the pattern, in the same order, and nothing before it changes.
 * both: copies also fill backwards, so the whole run is covered.
 */
export type RepeatDirection = 'onward' | 'both';

/**
 * Copies what has been painted along the run, carrying on from one string to the next. The
 * part from the first painted cell to the last is the pattern, including any unpainted cells
 * inside it, and it stays where it was painted. `gap` leaves that many cells showing the
 * background between copies. Every copy is the same sequence, starting where the last one ended.
 */
export function repeatPainted(state: PatternState, cells: PatternCell[], gap = 0, direction: RepeatDirection = 'both'): PatternState {
  const span = paintedSpan(state, cells);
  if (span === 0) return state;
  const start = cells.findIndex((cell) => state.cells[cell.key] !== undefined);
  const motif = cells.slice(start, start + span).map((cell) => state.cells[cell.key] ?? null);
  const period = span + Math.max(0, Math.floor(gap));
  const next = { ...state.cells };
  let changed = false;
  cells.forEach((cell, i) => {
    if (direction === 'onward' && i < start) return;
    const color = motif[(((i - start) % period) + period) % period] ?? null;
    if ((next[cell.key] ?? null) === color) return;
    changed = true;
    if (color === null) delete next[cell.key];
    else next[cell.key] = color;
  });
  return changed ? { ...state, cells: next } : state;
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

/**
 * The busiest light decides how long it takes, since lights change independently. The
 * server also sends a base color first, and pauses after turning a light on.
 */
export function estimatedSeconds(actions: PresetActionInput[]): number {
  const commands = slowestStringCommands(actions);
  if (commands === 0) return 0;
  const hasSegments = actions.some((a) => a.action.type === 'segmentColor');
  const hasPower = actions.some((a) => a.action.type === 'power' && a.action.on);
  return commands + (hasSegments ? 1 : 0) + (hasPower ? 1 : 0);
}

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

/** What a pattern draft needs to know about the strings: names and sizes only, in order. */
export function describeStrings(strings: PatternString[]): AiPatternDraftRequest['strings'] {
  return strings
    .filter((s) => s.included && s.segments.length > 0)
    .map((s) => ({
      name: s.name.slice(0, 80),
      cells: s.segments.length,
      ledsPerCell: s.ledCount ? Math.max(1, Math.round(s.ledCount / s.segments.length)) : null,
    }));
}

/**
 * Turns a drafted pattern into editor state, using the editor's own tools. Cells are numbered
 * along the whole run, as `canvasCells` lists them. Anything outside the canvas is ignored.
 */
export function applyPatternDraft(draft: PatternDraft, cells: PatternCell[]): PatternState {
  let state = emptyPattern(draft.background);
  for (const step of draft.steps) {
    const slice = cells.slice(step.from, Math.min(step.to, cells.length - 1) + 1);
    if (slice.length === 0) continue;
    if (step.op === 'paint') {
      for (const cell of slice) state = paintCell(state, cell.key, step.color);
    } else if (step.op === 'gradient') {
      state = gradientFill(state, slice, step.startColor, step.endColor);
    } else {
      state = repeatFill(state, slice, step.colors, step.run);
    }
  }
  return state;
}

