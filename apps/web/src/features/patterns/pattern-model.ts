import { hexToRgb, rgbToHex, type DeviceAction, type PresetDto } from '@glm/shared';

/**
 * A pattern is what is painted on a light string: one colour per segment Govee reports.
 * A cell holds a colour, or null for "shows the background", so changing the background
 * recolours everything that was not painted. Patterns are saved as ordinary app presets,
 * so they can be applied to groups and used in schedules like any other preset.
 */
export interface PatternState {
  background: string;
  cells: (string | null)[];
}

export function emptyPattern(segmentCount: number, background = '#ffffff'): PatternState {
  return { background, cells: Array.from({ length: segmentCount }, () => null) };
}

export function cellColor(state: PatternState, index: number): string {
  return state.cells[index] ?? state.background;
}

export function resizePattern(state: PatternState, segmentCount: number): PatternState {
  if (state.cells.length === segmentCount) return state;
  return {
    ...state,
    cells: Array.from({ length: segmentCount }, (_, i) => state.cells[i] ?? null),
  };
}

export function paintCell(state: PatternState, index: number, color: string | null): PatternState {
  if (index < 0 || index >= state.cells.length || state.cells[index] === color) return state;
  const cells = [...state.cells];
  cells[index] = color;
  return { ...state, cells };
}

export function clearPattern(state: PatternState): PatternState {
  return { ...state, cells: state.cells.map(() => null) };
}

/** A fixed blend across the string. It does not move: that would need the lights' own effects. */
export function gradientFill(state: PatternState, from: string, to: string): PatternState {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const last = Math.max(1, state.cells.length - 1);
  return {
    ...state,
    cells: state.cells.map((_, i) => {
      const t = i / last;
      return rgbToHex({
        r: Math.round(a.r + (b.r - a.r) * t),
        g: Math.round(a.g + (b.g - a.g) * t),
        b: Math.round(a.b + (b.b - a.b) * t),
      });
    }),
  };
}

/** Repeats runs of colours along the string, such as red and green for Christmas. */
export function repeatFill(state: PatternState, colors: string[], runLength: number): PatternState {
  const run = Math.max(1, Math.floor(runLength));
  return {
    ...state,
    cells: state.cells.map((_, i) => colors[Math.floor(i / run) % colors.length] ?? null),
  };
}

/**
 * Serpentine rows, like a string zigzagging back and forth. Each row lists segment
 * indexes in display order, so every other row runs right to left.
 */
export function serpentineRows(segmentCount: number, perRow: number): number[][] {
  const rows: number[][] = [];
  for (let start = 0; start < segmentCount; start += perRow) {
    const row = Array.from({ length: Math.min(perRow, segmentCount - start) }, (_, i) => start + i);
    rows.push(rows.length % 2 === 0 ? row : row.reverse());
  }
  return rows;
}

export interface PatternOptions {
  turnOn: boolean;
  /** Overall brightness, or null to leave it as it is. */
  brightness: number | null;
  /** Most segments one command may name, from the device's capability. */
  maxPerCommand: number;
}

/**
 * The fewest commands that produce the pattern: one per colour, not one per segment.
 * Each command takes real time at Govee's rate limits, so this is what keeps painting usable.
 */
export function patternToActions(state: PatternState, options: PatternOptions): DeviceAction[] {
  const byColor = new Map<string, number[]>();
  state.cells.forEach((_, index) => {
    const hex = cellColor(state, index).toLowerCase();
    byColor.set(hex, [...(byColor.get(hex) ?? []), index]);
  });

  const colorActions: DeviceAction[] = [];
  const largestFirst = [...byColor.entries()].sort((a, b) => b[1].length - a[1].length);
  const limit = Math.max(1, options.maxPerCommand);
  for (const [hex, segments] of largestFirst) {
    for (let i = 0; i < segments.length; i += limit) {
      colorActions.push({ type: 'segmentColor', hex, segments: segments.slice(i, i + limit) });
    }
  }

  return [
    ...(options.turnOn ? [{ type: 'power', on: true } as const] : []),
    ...(options.brightness !== null ? [{ type: 'brightness', value: options.brightness } as const] : []),
    ...colorActions,
  ];
}

export function commandCount(state: PatternState, options: PatternOptions): number {
  return patternToActions(state, options).length;
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
}

export function patternFromPreset(preset: PresetDto, segmentCount: number): LoadedPattern {
  const colors: (string | null)[] = Array.from({ length: segmentCount }, () => null);
  let turnOn = false;
  let brightness: number | null = null;
  for (const { action } of preset.actions) {
    if (action.type === 'power' && action.on) turnOn = true;
    if (action.type === 'brightness') brightness = action.value;
    if (action.type === 'segmentColor') {
      for (const segment of action.segments) {
        if (segment < segmentCount) colors[segment] = action.hex.toLowerCase();
      }
    }
  }
  // The most common colour becomes the background, so erasing behaves as it did when painted.
  const counts = new Map<string, number>();
  for (const color of colors) if (color) counts.set(color, (counts.get(color) ?? 0) + 1);
  const background = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '#ffffff';
  return {
    turnOn,
    brightness,
    state: { background, cells: colors.map((c) => (c === background ? null : c)) },
  };
}

/** Dark or light cell numbers, whichever is readable on this colour. */
export function readableTextColor(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  return (r * 299 + g * 587 + b * 114) / 1000 > 140 ? '#15181b' : '#ffffff';
}
