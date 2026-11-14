import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Blend,
  Brush,
  Copy,
  Palette,
  Eraser,
  FlipHorizontal2,
  Redo2,
  RefreshCw,
  Repeat,
  Save,
  Send,
  Trash2,
  Undo2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { isHexColor, type DeviceDto, type PatternStringSetting } from '@glm/shared';
import { RunResults } from '../../components/status';
import { Badge, Button, Card, EmptyState, ErrorNotice, Field, inputClass, Loading, Notice, PageHeader, SectionCard } from '../../components/ui';
import {
  useApplyDraft,
  useDevices,
  useDraftPattern,
  useDiscover,
  usePresets,
  useRefreshDue,
  useSavePreset,
  useSettings,
  useUpdateSettings,
} from '../../lib/queries';
import { DescribeBox } from '../ai/DescribeBox';
import {
  applyPatternDraft,
  canvasCells,
  cellColor,
  cellKey,
  clearPattern,
  describeStrings,
  emptyPattern,
  gradientFill,
  ledsInSegment,
  modelSize,
  moveString,
  oneColor,
  paintableDevices,
  paintCell,
  paintedSpan,
  paintedStart,
  patternFromPreset,
  patternToActions,
  readableTextColor,
  repeatFill,
  repeatPainted,
  resolveStrings,
  estimatedSeconds,
  sameLook,
  serpentineRows,
  toSettings,
  withLedCount,
  type PatternState,
  type PatternString,
  type RepeatDirection,
} from './pattern-model';

/** Fewer per row when each segment shows several LED boxes, so the boxes stay visible on a phone. */
function segmentsPerRow(string: PatternString): number {
  return (string.ledCount ?? 0) > string.segments.length ? 6 : 9;
}

/** Where a string's LED count comes from, because Govee's API does not report it. */
function ledCountSource(string: PatternString): string {
  const size = modelSize(string.sku);
  if (string.ledSource === 'owner') return 'You set this.';
  if (size) return `${string.sku}: ${size.lengthFeet} ft at about ${size.ledsPer100Feet} LEDs per 100 ft.`;
  return 'Govee does not report this for your model. Count them and enter it to get one box per LED.';
}

function LedCountInput({ string, onCommit }: { string: PatternString; onCommit: (count: number | null) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-ink-300">
      LEDs
      <input
        // Starts afresh when the value changes elsewhere, such as after being limited.
        key={`${string.ledSource}-${string.ledCount}`}
        type="number"
        aria-label={`LEDs on ${string.name}`}
        className="min-h-9 w-20 rounded-lg border border-ink-700 bg-ink-850 px-2 text-sm text-ink-100"
        min={string.segments.length}
        max={1000}
        placeholder="Count"
        defaultValue={string.ledCount ?? ''}
        onBlur={(event) => {
          const text = event.target.value.trim();
          const count = Math.min(1000, Math.floor(Number(text)));
          const next = text === '' || !Number.isFinite(count) || count < 1 ? null : count;
          if (next !== string.ledCount) onCommit(next);
        }}
      />
    </label>
  );
}
/** Finer than the narrowest cell on a phone, so a stroke cannot jump over one. */
const STROKE_SAMPLE_PX = 8;

function ColorChoice({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  return (
    <label className="flex items-center gap-3 text-sm font-medium text-ink-200">
      <input
        type="color"
        aria-label={label}
        className="h-11 w-14 cursor-pointer rounded-lg border border-ink-700 bg-ink-850 p-1"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {label}
    </label>
  );
}

/** Which strings are shown, in what order, and which way each one runs. */
function StringArrangement({
  strings,
  onChange,
  notPaintable,
}: {
  strings: PatternString[];
  onChange: (next: PatternString[]) => void;
  notPaintable: DeviceDto[];
}) {
  const discover = useDiscover();
  const update = (deviceId: string, change: Partial<PatternString>) =>
    onChange(strings.map((s) => (s.deviceId === deviceId ? { ...s, ...change } : s)));
  const flip = (string: PatternString) =>
    update(string.deviceId, { reversed: !string.reversed, segments: [...string.segments].reverse() });

  return (
    <SectionCard
      title={`${strings.length} light string${strings.length === 1 ? '' : 's'} found`}
      description="Put them in the order they run on your house. Flip a string if it starts from the other end."
      action={
        <Button
          size="sm"
          icon={<RefreshCw className="size-4" aria-hidden />}
          busy={discover.isPending}
          onClick={() => discover.mutate()}
        >
          Check for lights
        </Button>
      }
    >
      <ol className="space-y-2">
        {strings.map((string, index) => (
          <li key={string.deviceId} className="flex flex-wrap items-center gap-2 rounded-lg bg-ink-850 p-2.5">
            <span className="w-5 text-center text-sm text-ink-400 tabular-nums">{index + 1}</span>
            {/* Takes its own line on a phone, so a long name is never squeezed by the controls. */}
            <label className="flex min-h-9 min-w-0 flex-[1_1_calc(100%-2rem)] items-center gap-2 text-sm sm:flex-1">
              <input
                type="checkbox"
                className="size-4"
                aria-label={`Include ${string.name}`}
                checked={string.included}
                onChange={(e) => update(string.deviceId, { included: e.target.checked })}
              />
              <span className="min-w-0">
                <span className="block font-medium break-words">{string.name}</span>
                <span className="block text-xs text-ink-400">
                  {string.ledCount !== null ? `${string.ledCount} LEDs in ` : ''}
                  {string.segments.length} segments
                </span>
                <span className="block text-xs text-ink-400">{ledCountSource(string)}</span>
              </span>
            </label>
            <LedCountInput string={string} onCommit={(count) => onChange(withLedCount(strings, string.deviceId, count))} />
            {string.connectivity === 'offline' ? <Badge tone="bad">Offline</Badge> : null}
            {string.reversed ? <Badge tone="info">Flipped</Badge> : null}
            <div className="ml-auto flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Move ${string.name} earlier`}
                disabled={index === 0}
                icon={<ArrowUp className="size-4" aria-hidden />}
                onClick={() => onChange(moveString(strings, string.deviceId, -1))}
              />
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Move ${string.name} later`}
                disabled={index === strings.length - 1}
                icon={<ArrowDown className="size-4" aria-hidden />}
                onClick={() => onChange(moveString(strings, string.deviceId, 1))}
              />
              <Button
                size="sm"
                variant="ghost"
                aria-pressed={string.reversed}
                aria-label={`Flip ${string.name}`}
                icon={<FlipHorizontal2 className="size-4" aria-hidden />}
                onClick={() => flip(string)}
              />
            </div>
          </li>
        ))}
      </ol>
      {notPaintable.length > 0 ? (
        <p className="mt-3 text-xs text-ink-400">
          Not shown: {notPaintable.map((d) => d.name).join(', ')}. Groups and lights without segment control cannot be
          painted. A group's lights appear here individually.
        </p>
      ) : null}
      {discover.isError ? (
        <div className="mt-3">
          <ErrorNotice error={discover.error} />
        </div>
      ) : null}
      {discover.isSuccess ? (
        <p className="mt-3 text-xs text-ink-400" role="status">
          Light list updated from Govee.
        </p>
      ) : null}
    </SectionCard>
  );
}

/** Every string in series. Drag across them, including from one string to the next. */
function SeriesCanvas({
  pattern,
  strings,
  onStrokeStart,
  onPaint,
  onStrokeEnd,
}: {
  pattern: PatternState;
  strings: PatternString[];
  onStrokeStart: () => void;
  onPaint: (key: string) => void;
  onStrokeEnd: () => void;
}) {
  const painting = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const stop = () => {
      if (painting.current) {
        painting.current = false;
        onStrokeEnd();
      }
    };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, [onStrokeEnd]);

  const cellAtPoint = (x: number, y: number, fallback: EventTarget | null) => {
    const target = document.elementFromPoint?.(x, y) ?? fallback;
    return (target as HTMLElement | null)?.closest?.('[data-cell]')?.getAttribute('data-cell') ?? null;
  };

  const shown = strings.filter((s) => s.included);

  return (
    <div
      role="group"
      aria-label="Your light strings in series. Each small box is one LED, and LEDs in a segment change together."
      className="space-y-4 select-none"
      onPointerDown={(event: ReactPointerEvent) => {
        const key = cellAtPoint(event.clientX, event.clientY, event.target);
        if (key === null) return;
        event.preventDefault();
        painting.current = true;
        lastPoint.current = { x: event.clientX, y: event.clientY };
        onStrokeStart();
        onPaint(key);
      }}
      onPointerMove={(event: ReactPointerEvent) => {
        if (!painting.current) return;
        // A quick swipe delivers few events, so walk the line between them. Otherwise the
        // cells it crossed between two events would stay unpainted.
        const from = lastPoint.current ?? { x: event.clientX, y: event.clientY };
        const distance = Math.hypot(event.clientX - from.x, event.clientY - from.y);
        const steps = Math.max(1, Math.ceil(distance / STROKE_SAMPLE_PX));
        for (let step = 1; step <= steps; step++) {
          const x = from.x + ((event.clientX - from.x) * step) / steps;
          const y = from.y + ((event.clientY - from.y) * step) / steps;
          const key = cellAtPoint(x, y, event.target);
          if (key !== null) onPaint(key);
        }
        lastPoint.current = { x: event.clientX, y: event.clientY };
      }}
    >
      {shown.map((string, stringIndex) => {
        const perRow = segmentsPerRow(string);
        return (
          <div key={string.deviceId}>
            <p className="mb-1.5 text-sm font-medium text-ink-200">
              {stringIndex + 1}. {string.name}
              {string.ledCount !== null ? <span className="ml-2 text-xs font-normal text-ink-400">{string.ledCount} LEDs</span> : null}
              {string.connectivity === 'offline' ? <span className="ml-2 text-xs font-normal text-bad">offline</span> : null}
            </p>
            <div className="space-y-1">
              {serpentineRows(string.segments.length, perRow).map((row, rowIndex) => {
                const reversed = rowIndex % 2 === 1;
                const offset = reversed ? perRow - row.length : 0;
                return (
                  <div key={rowIndex}>
                    {rowIndex > 0 ? (
                      // Where the string turns: the right end after a left-to-right row, then the left.
                      <div className={`mb-1 flex ${reversed ? 'justify-end' : 'justify-start'}`} aria-hidden>
                        <div className="h-3 border-x-2 border-dashed border-ink-600" style={{ width: `${100 / perRow}%` }} />
                      </div>
                    ) : null}
                    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))` }}>
                      {row.map((position, column) => {
                        const segment = string.segments[position] as number;
                        const key = cellKey(string.deviceId, segment);
                        const color = cellColor(pattern, key);
                        const leds = ledsInSegment(string, segment);
                        const ledText = leds.length === 0 ? '' : ` LEDs ${Math.min(...leds)} to ${Math.max(...leds)},`;
                        return (
                          // One button per segment, because that is the smallest part Govee can colour.
                          <button
                            key={key}
                            type="button"
                            data-cell={key}
                            aria-label={`${string.name} segment ${segment},${ledText} ${color}`}
                            title={leds.length > 1 ? `LEDs ${Math.min(...leds)} to ${Math.max(...leds)} change together` : undefined}
                            // A pointer paints on pointerdown. detail is 0 only for Enter or Space.
                            onClick={(event) => {
                              if (event.detail === 0) {
                                onStrokeStart();
                                onPaint(key);
                                onStrokeEnd();
                              }
                            }}
                            // Only the cells capture touch, so labels and gaps still scroll the page on a phone.
                            className="flex h-12 min-w-0 touch-none gap-px rounded border border-ink-500 p-px"
                            style={{ gridColumnStart: offset + column + 1 }}
                          >
                            {leds.length === 0 ? (
                              <span
                                className="flex h-full min-w-0 flex-1 items-center justify-center rounded-sm text-[10px] tabular-nums sm:text-xs"
                                style={{ backgroundColor: color, color: readableTextColor(color) }}
                              >
                                {segment}
                              </span>
                            ) : (
                              // A row running right to left reads backwards, inside each segment too.
                              (reversed ? [...leds].reverse() : leds).map((led) => (
                                <span
                                  key={led}
                                  data-led={led}
                                  className="flex h-full min-w-0 flex-1 items-center justify-center rounded-sm text-[9px] tabular-nums"
                                  style={{ backgroundColor: color, color: readableTextColor(color) }}
                                >
                                  {/* Too narrow for numbers on a phone. */}
                                  <span className="hidden sm:inline">{led}</span>
                                </span>
                              ))
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Editor({ devices, presetId }: { devices: DeviceDto[]; presetId?: string | undefined }) {
  const presets = usePresets();
  const settings = useSettings();
  const updateSettings = useUpdateSettings();
  const save = useSavePreset();
  const apply = useApplyDraft();
  const draft = useDraftPattern();
  const [drafted, setDrafted] = useState<{ message: string; note: string | null } | null>(null);
  const navigate = useNavigate();

  const [arrangement, setArrangement] = useState<PatternStringSetting[] | null>(null);
  const strings = useMemo(
    () => resolveStrings(devices, arrangement ?? settings.data?.patternStrings ?? []),
    [devices, arrangement, settings.data?.patternStrings],
  );
  const cells = useMemo(() => canvasCells(strings), [strings]);
  const notPaintable = devices.filter((d) => d.discoveryStatus === 'present' && paintableDevices([d]).length === 0);

  const existing = presets.data?.find((p) => p.id === presetId);
  const [pattern, setPattern] = useState<PatternState>(() => emptyPattern());
  const [undoStack, setUndoStack] = useState<PatternState[]>([]);
  const [redoStack, setRedoStack] = useState<PatternState[]>([]);
  const [fill, setFill] = useState('#ff0000');
  const [allColor, setAllColor] = useState('#ffffff');
  const [tool, setTool] = useState<'paint' | 'erase'>('paint');
  const [runLength, setRunLength] = useState(3);
  const [repeatGap, setRepeatGap] = useState(0);
  const [repeatDirection, setRepeatDirection] = useState<RepeatDirection>('onward');
  const [turnOn, setTurnOn] = useState(true);
  const [useBrightness, setUseBrightness] = useState(false);
  const [brightness, setBrightness] = useState(100);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [notShown, setNotShown] = useState<string[]>([]);

  // Open a saved pattern once, when both it and the arrangement have arrived.
  if (existing && loadedId !== existing.id && settings.data && strings.length > 0) {
    const loaded = patternFromPreset(existing, strings);
    setLoadedId(existing.id);
    setPattern(loaded.state);
    setTurnOn(loaded.turnOn);
    setUseBrightness(loaded.brightness !== null);
    if (loaded.brightness !== null) setBrightness(loaded.brightness);
    setName(existing.name);
    setDescription(existing.description);
    setNotShown(loaded.notShown);
  }

  const arrange = (next: PatternString[]) => {
    const value = toSettings(next);
    setArrangement(value);
    updateSettings.mutate({ patternStrings: value });
  };

  const strokeStart = useRef<PatternState | null>(null);
  const latest = useRef(pattern);
  latest.current = pattern;

  /** Records one undoable step. A whole drag counts as one. */
  const commit = (before: PatternState, after: PatternState) => {
    if (before === after) return;
    setUndoStack((stack) => [...stack.slice(-99), before]);
    setRedoStack([]);
  };
  const change = (update: (state: PatternState) => PatternState) => {
    const before = latest.current;
    const after = update(before);
    setPattern(after);
    commit(before, after);
  };

  // Each Repeat result remembers the pattern it was made from, keyed to the result itself. So
  // repeating again, with a different gap or direction, after an Undo or Redo, or after a background
  // change, starts from the original. Otherwise the first repeat would count as the pattern. Any
  // painting makes a new pattern, which is then treated as the new original.
  const [repeatOrigins] = useState(() => new WeakMap<object, PatternState>());
  const repeatSource = (state: PatternState): PatternState => {
    const origin = repeatOrigins.get(state.cells);
    return origin ? { ...origin, background: state.background } : state;
  };
  const repeat = () => {
    const before = latest.current;
    const from = repeatSource(before);
    const after = repeatPainted(from, cells, repeatGap, repeatDirection);
    if (sameLook(after, before, cells)) return;
    repeatOrigins.set(after.cells, from);
    change(() => after);
  };
  const wasRepeated = repeatOrigins.has(pattern.cells);
  const repeatFrom = repeatSource(pattern);
  const span = paintedSpan(repeatFrom, cells);
  const spanStart = paintedStart(repeatFrom, cells);
  // Whether pressing Repeat now would change anything, so the button and the message can say so.
  const repeatWouldChange = span > 0 && !sameLook(repeatPainted(repeatFrom, cells, repeatGap, repeatDirection), pattern, cells);
  const repeatStatus = ((): string => {
    if (span === 0) return 'Paint the start of your pattern above, then Repeat carries it on from where it ends, in the same order.';
    if (!repeatWouldChange) {
      if (wasRepeated) {
        return repeatDirection === 'onward' && spanStart > 0
          ? `Your ${span}-segment pattern now repeats from segment ${spanStart + 1} to the end of the last string. Segments before it are unchanged. Undo goes back to it.`
          : `Your ${span}-segment pattern now repeats along all ${cells.length} segments. Undo goes back to it.`;
      }
      if (repeatDirection === 'onward' && spanStart + span >= cells.length) {
        return 'Your pattern already reaches the last segment, so there is nothing left to carry on. Choose "both ways" to fill the segments before it.';
      }
      if (repeatDirection === 'both' && span >= cells.length) return 'Your pattern already covers every box.';
      if (repeatDirection === 'onward' && spanStart + span + repeatGap >= cells.length) {
        return 'The gap leaves no room for another copy after your pattern. Try a smaller gap.';
      }
      return 'Repeat would not change anything with these settings.';
    }
    if (wasRepeated) return `Press Repeat to use these settings on your ${span}-segment pattern. Undo goes back to what you have now.`;
    return repeatDirection === 'onward'
      ? `Repeat carries on after your ${span}-segment pattern, in the same order, to the end of the last string. Segments before it stay as they are.`
      : `Repeat copies your ${span}-segment pattern across every other box, replacing what's there, on all the strings shown.`;
  })();

  const undo = () => {
    const previous = undoStack.at(-1);
    if (!previous) return;
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack, pattern]);
    setPattern(previous);
  };
  const redo = () => {
    const next = redoStack.at(-1);
    if (!next) return;
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack, pattern]);
    setPattern(next);
  };

  const actions = useMemo(
    () => patternToActions(pattern, strings, { turnOn, brightness: useBrightness ? brightness : null }),
    [pattern, strings, turnOn, useBrightness, brightness],
  );
  const seconds = estimatedSeconds(actions);
  const shownCount = strings.filter((s) => s.included).length;
  const shownLeds = strings.filter((s) => s.included).reduce((sum, s) => sum + (s.ledCount ?? 0), 0);
  const valid = isHexColor(fill) && isHexColor(pattern.background) && cells.length > 0;

  const submitSave = () => {
    if (existing) {
      save.mutate({ id: existing.id, update: { name, description, actions } }, { onSuccess: () => navigate('/presets') });
    } else {
      save.mutate({ create: { name, description, actions } }, { onSuccess: () => navigate('/presets') });
    }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-5">
        <StringArrangement strings={strings} onChange={arrange} notPaintable={notPaintable} />
        {updateSettings.isError ? <ErrorNotice error={updateSettings.error} title="The arrangement was not saved" /> : null}
        {notShown.length > 0 ? (
          <Notice tone="warn" title="This pattern also paints lights not shown here">
            {notShown.join(', ')}. Saving will remove them from the pattern. Include them above first to keep them.
          </Notice>
        ) : null}

        <SectionCard
          title="Paint your lights"
          description={
            shownLeds > 0
              ? `${shownLeds} LEDs in ${cells.length} segments across ${shownCount} string${shownCount === 1 ? '' : 's'}. Each small box is one LED.`
              : `${cells.length} segments across ${shownCount} string${shownCount === 1 ? '' : 's'}. One cell is one segment, which may cover several bulbs.`
          }
        >
          <div className="space-y-4">
            {shownLeds > cells.length ? (
              <Notice title="LEDs in a segment change together">
                Govee's API can only color whole segments, so painting one box colors every LED in its outlined group. Single-LED
                control isn't available through the API, and the LED count is worked out from published specs, so check it
                against your lights.
              </Notice>
            ) : null}
            {cells.length > 0 ? (
              <DescribeBox
                label="Describe a pattern"
                placeholder="Warm white with gold every fourth segment"
                busy={draft.isPending}
                error={draft.error}
                result={drafted}
                onDescribe={(text) => {
                  setDrafted(null);
                  draft.mutate(
                    { description: text, strings: describeStrings(strings) },
                    {
                      onSuccess: (result) => {
                        // Replaces what is painted as one undoable step. Nothing is sent until Send.
                        change(() => applyPatternDraft(result.draft, cells));
                        if (name.trim() === '') setName(result.draft.name);
                        setDrafted({
                          message: 'Drafted into the editor. Undo puts back what was there. The lights change only when you press Send.',
                          note: result.draft.note ?? null,
                        });
                      },
                    },
                  );
                }}
              />
            ) : null}
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-ink-850 p-3">
              <ColorChoice label="One color for everything" value={allColor} onChange={setAllColor} />
              <Button
                size="sm"
                icon={<Palette className="size-4" aria-hidden />}
                disabled={cells.length === 0 || !isHexColor(allColor)}
                onClick={() => change((state) => oneColor(state, allColor))}
              >
                Color all {shownCount === 1 ? 'of this string' : `${shownCount} strings`}
              </Button>
              <p className="w-full text-xs text-ink-400">
                Replaces what's painted, as one undoable step. The lights change when you press Send.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <ColorChoice
                label="Background"
                value={pattern.background}
                onChange={(hex) => change((state) => ({ ...state, background: hex }))}
              />
              <ColorChoice label="Fill color" value={fill} onChange={setFill} />
            </div>

            <div className="flex flex-wrap gap-2" role="toolbar" aria-label="Painting tools">
              <Button
                size="sm"
                aria-pressed={tool === 'paint'}
                variant={tool === 'paint' ? 'primary' : 'secondary'}
                icon={<Brush className="size-4" aria-hidden />}
                onClick={() => setTool('paint')}
              >
                Paint
              </Button>
              <Button
                size="sm"
                aria-pressed={tool === 'erase'}
                variant={tool === 'erase' ? 'primary' : 'secondary'}
                icon={<Eraser className="size-4" aria-hidden />}
                onClick={() => setTool('erase')}
              >
                Erase
              </Button>
              <Button size="sm" disabled={undoStack.length === 0} icon={<Undo2 className="size-4" aria-hidden />} onClick={undo}>
                Undo
              </Button>
              <Button size="sm" disabled={redoStack.length === 0} icon={<Redo2 className="size-4" aria-hidden />} onClick={redo}>
                Redo
              </Button>
              <Button size="sm" icon={<Trash2 className="size-4" aria-hidden />} onClick={() => change(clearPattern)}>
                Clear
              </Button>
            </div>

            {cells.length === 0 ? (
              <p className="text-sm text-ink-300">Include at least one string above to start painting.</p>
            ) : (
              <SeriesCanvas
                pattern={pattern}
                strings={strings}
                onStrokeStart={() => {
                  strokeStart.current = latest.current;
                }}
                onPaint={(key) => {
                  const next = paintCell(latest.current, key, tool === 'paint' ? fill : null);
                  latest.current = next;
                  setPattern(next);
                }}
                onStrokeEnd={() => {
                  if (strokeStart.current) commit(strokeStart.current, latest.current);
                  strokeStart.current = null;
                }}
              />
            )}

            <div className="space-y-2 border-t border-ink-700/70 pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Copy className="size-4" aria-hidden />}
                  disabled={!repeatWouldChange}
                  onClick={repeat}
                >
                  Repeat
                </Button>
                <label className="flex items-center gap-2 text-sm text-ink-300">
                  leaving a gap of
                  <input
                    type="number"
                    aria-label="Segments left blank between repeats"
                    className="min-h-9 w-16 rounded-lg border border-ink-700 bg-ink-850 px-2 text-ink-100"
                    min={0}
                    max={Math.max(0, cells.length)}
                    value={repeatGap}
                    onChange={(e) => setRepeatGap(Math.max(0, Math.floor(Number(e.target.value)) || 0))}
                  />
                  segments
                </label>
                <label className="flex items-center gap-2 text-sm text-ink-300">
                  <select
                    aria-label="Where Repeat fills"
                    className="min-h-9 rounded-lg border border-ink-700 bg-ink-850 px-2 text-ink-100"
                    value={repeatDirection}
                    onChange={(e) => setRepeatDirection(e.target.value as RepeatDirection)}
                  >
                    <option value="onward">onward from the end of my pattern</option>
                    <option value="both">both ways, covering every box</option>
                  </select>
                </label>
              </div>
              <p className="text-xs text-ink-400" role="status">
                {repeatStatus}
              </p>
            </div>

            <div className="flex flex-wrap items-end gap-2 border-t border-ink-700/70 pt-4">
              <Button
                size="sm"
                icon={<Blend className="size-4" aria-hidden />}
                disabled={cells.length === 0}
                onClick={() => change((state) => gradientFill(state, cells, state.background, fill))}
              >
                Gradient
              </Button>
              <Button
                size="sm"
                icon={<Repeat className="size-4" aria-hidden />}
                disabled={cells.length === 0}
                onClick={() => change((state) => repeatFill(state, cells, [fill, state.background], runLength))}
              >
                Alternate colors
              </Button>
              <label className="flex items-center gap-2 text-sm text-ink-300">
                every
                <input
                  type="number"
                  aria-label="Segments in each run of alternating colors"
                  className="min-h-9 w-16 rounded-lg border border-ink-700 bg-ink-850 px-2 text-ink-100"
                  min={1}
                  max={Math.max(1, cells.length)}
                  value={runLength}
                  onChange={(e) => setRunLength(Number(e.target.value) || 1)}
                />
                segments
              </label>
            </div>
            <p className="text-xs text-ink-400">
              Both tools run along all the strings shown, carrying on from one to the next. Gradient blends from the
              background to the fill color. Alternate swaps between them, such as red and green for Christmas.
            </p>
          </div>
        </SectionCard>

        <Notice title="Moving effects are not available here">
          Clockwise, Twinkle and Breathe run inside the lights, and Govee's public API cannot send them. To use one, make it
          with Finger sketch in the Govee Home app. If the API lists it, it appears under Scenes after a refresh, and it can be
          activated and scheduled from this app.
        </Notice>
      </div>

      <div className="space-y-5">
        <SectionCard
          title="Try it on the lights"
          action={
            <Link to="/patterns/check" className="text-sm text-amber-soft underline underline-offset-2">
              LEDs look wrong?
            </Link>
          }
        >
          <div className="space-y-4">
            <label className="flex min-h-9 items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={turnOn} onChange={(e) => setTurnOn(e.target.checked)} />
              Turn the lights on first
            </label>
            <label className="flex min-h-9 items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={useBrightness} onChange={(e) => setUseBrightness(e.target.checked)} />
              Set overall brightness
            </label>
            {useBrightness ? (
              <Field label={`Overall brightness: ${brightness}%`}>
                {(props) => (
                  <input {...props} type="range" className="h-8 w-full" min={1} max={100} value={brightness} onChange={(e) => setBrightness(Number(e.target.value))} />
                )}
              </Field>
            ) : null}
            <p className="text-sm text-ink-300">
              This takes about {seconds} second{seconds === 1 ? '' : 's'}: {actions.length} command
              {actions.length === 1 ? '' : 's'}, plus a base color, across {shownCount} string{shownCount === 1 ? '' : 's'}. Each string changes a
              section at a time, and they are not in perfect sync.
              {seconds > 10 ? ' Fewer colors means a quicker change.' : ''}
            </p>
            <Button
              variant="primary"
              className="w-full"
              icon={<Send className="size-4" aria-hidden />}
              busy={apply.isPending}
              disabled={!valid}
              onClick={() => apply.mutate({ name: name || 'Pattern preview', actions })}
            >
              Send to {shownCount} string{shownCount === 1 ? '' : 's'}
            </Button>
            {apply.isPending ? (
              <p className="text-sm text-ink-300" role="status">
                Sending a section at a time...
              </p>
            ) : null}
            {apply.isError ? <ErrorNotice error={apply.error} /> : null}
            {apply.data ? <RunResults run={apply.data} /> : null}
            {apply.data ? (
              <p className="text-xs text-ink-400">
                Govee does not report segment colors, so this app cannot confirm the pattern. Check the lights themselves.
              </p>
            ) : null}
          </div>
        </SectionCard>

        <SectionCard
          title="Save this pattern"
          description="Saved as an app preset that paints these strings. To schedule it, make a group of the same strings and target that."
        >
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              submitSave();
            }}
          >
            <Field label="Pattern name">
              {(props) => (
                <input {...props} className={inputClass} required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
              )}
            </Field>
            <Field label="Description (optional)">
              {(props) => (
                <input {...props} className={inputClass} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
              )}
            </Field>
            {save.isError ? <ErrorNotice error={save.error} title="The pattern was not saved" /> : null}
            <Button type="submit" className="w-full" icon={<Save className="size-4" aria-hidden />} busy={save.isPending} disabled={!valid}>
              Save pattern
            </Button>
          </form>
        </SectionCard>
      </div>
    </div>
  );
}

export function PatternEditorPage() {
  const { presetId } = useParams();
  const devices = useDevices();
  const refreshDue = useRefreshDue();

  // So an offline string is flagged from current information, not last week's.
  const hasDevices = (devices.data?.length ?? 0) > 0;
  useEffect(() => {
    if (hasDevices) refreshDue.mutate();
    // Once when devices first appear.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasDevices]);

  const list = devices.data ?? [];
  const capable = paintableDevices(list);

  return (
    <>
      <Link to="/presets" className="mb-3 inline-flex min-h-9 items-center gap-1 text-sm text-ink-300 hover:text-ink-100">
        <ArrowLeft className="size-4" aria-hidden />
        Scenes & Presets
      </Link>
      <PageHeader
        title={presetId ? 'Edit pattern' : 'Paint a pattern'}
        description="All your light strings, one after another. Paint across them, try it out, and save the result."
      />
      {devices.isPending ? <Loading label="Looking for your lights" /> : null}
      {devices.isError ? <ErrorNotice error={devices.error} /> : null}
      {devices.data && capable.length === 0 ? (
        <Card className="p-5">
          <EmptyState title="No light here reports segment control">
            Patterns need per-segment color from the Govee API. Groups made in the Govee Home app do not report it, but their
            individual lights might. Try Check lights now on the dashboard.
          </EmptyState>
        </Card>
      ) : null}
      {capable.length > 0 ? <Editor devices={list} presetId={presetId} /> : null}
    </>
  );
}
