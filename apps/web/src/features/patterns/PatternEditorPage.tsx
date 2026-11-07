import { ArrowLeft, Blend, Brush, Eraser, Redo2, Repeat, Save, Send, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { isHexColor, type DeviceDto, type SegmentedColorCapability } from '@glm/shared';
import { RunResults } from '../../components/status';
import { Button, Card, EmptyState, ErrorNotice, Field, inputClass, Loading, Notice, PageHeader, SectionCard } from '../../components/ui';
import { useApplyDraft, useDevices, usePresets, useSavePreset } from '../../lib/queries';
import { parseTarget, TargetOptions } from '../presets/ApplyPresetDialog';
import {
  cellColor,
  clearPattern,
  emptyPattern,
  gradientFill,
  paintCell,
  patternFromPreset,
  patternToActions,
  readableTextColor,
  repeatFill,
  resizePattern,
  serpentineRows,
  type PatternState,
} from './pattern-model';

const CELLS_PER_ROW = 9;
/** Finer than the narrowest cell on a phone, so a stroke cannot jump over one. */
const STROKE_SAMPLE_PX = 8;

function segmentCapability(device: DeviceDto | undefined): SegmentedColorCapability | undefined {
  return device?.capabilities.find((c) => c.kind === 'segmentedColor') as SegmentedColorCapability | undefined;
}

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

/** The light string, drawn as it zigzags. Drag across it, or use the keyboard, to paint. */
function StringCanvas({
  pattern,
  rows,
  onStrokeStart,
  onPaint,
  onStrokeEnd,
}: {
  pattern: PatternState;
  rows: number[][];
  onStrokeStart: () => void;
  onPaint: (index: number) => void;
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

  const segmentAtPoint = (x: number, y: number, fallback: EventTarget | null) => {
    const target = document.elementFromPoint?.(x, y) ?? fallback;
    const value = (target as HTMLElement | null)?.closest?.('[data-segment]')?.getAttribute('data-segment');
    return value === null || value === undefined ? null : Number(value);
  };

  return (
    <div
      role="group"
      aria-label="Light string. Each cell is one segment."
      className="touch-none select-none space-y-1"
      onPointerDown={(event: ReactPointerEvent) => {
        const index = segmentAtPoint(event.clientX, event.clientY, event.target);
        if (index === null) return;
        event.preventDefault();
        painting.current = true;
        lastPoint.current = { x: event.clientX, y: event.clientY };
        onStrokeStart();
        onPaint(index);
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
          const index = segmentAtPoint(x, y, event.target);
          if (index !== null) onPaint(index);
        }
        lastPoint.current = { x: event.clientX, y: event.clientY };
      }}
    >
      {rows.map((row, rowIndex) => {
        const reversed = rowIndex % 2 === 1;
        const offset = reversed ? CELLS_PER_ROW - row.length : 0;
        return (
          <div key={rowIndex}>
            {rowIndex > 0 ? (
              // Where the string turns: the right end after a left-to-right row, then the left.
              <div className={`mb-1 flex ${reversed ? 'justify-end' : 'justify-start'}`} aria-hidden>
                <div className="h-3 w-[calc((100%-2rem)/9)] border-x-2 border-dashed border-ink-600" />
              </div>
            ) : null}
            <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${CELLS_PER_ROW}, minmax(0, 1fr))` }}>
              {row.map((index, position) => {
                const color = cellColor(pattern, index);
                return (
                  <button
                    key={index}
                    type="button"
                    data-segment={index}
                    aria-label={`Segment ${index}, ${color}`}
                    // A pointer paints on pointerdown. detail is 0 only for Enter or Space.
                    onClick={(event) => {
                      if (event.detail === 0) {
                        onStrokeStart();
                        onPaint(index);
                        onStrokeEnd();
                      }
                    }}
                    className="h-14 min-w-0 rounded border border-ink-600 text-[10px] tabular-nums sm:text-xs"
                    style={{
                      backgroundColor: color,
                      color: readableTextColor(color),
                      gridColumnStart: offset + position + 1,
                    }}
                  >
                    {index}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Editor({ devices, presetId, initialDeviceId }: { devices: DeviceDto[]; presetId?: string | undefined; initialDeviceId: string | null }) {
  const presets = usePresets();
  const save = useSavePreset();
  const apply = useApplyDraft();
  const navigate = useNavigate();

  const existing = presets.data?.find((p) => p.id === presetId);
  const [layoutId, setLayoutId] = useState(
    devices.find((d) => d.id === initialDeviceId)?.id ?? devices[0]?.id ?? '',
  );
  const layout = devices.find((d) => d.id === layoutId);
  const capability = segmentCapability(layout);
  const segmentCount = capability?.segments.length ?? 0;
  const rows = useMemo(() => serpentineRows(segmentCount, CELLS_PER_ROW), [segmentCount]);

  const [pattern, setPattern] = useState<PatternState>(() => emptyPattern(segmentCount));
  const [undoStack, setUndoStack] = useState<PatternState[]>([]);
  const [redoStack, setRedoStack] = useState<PatternState[]>([]);
  const [fill, setFill] = useState('#ff0000');
  const [tool, setTool] = useState<'paint' | 'erase'>('paint');
  const [runLength, setRunLength] = useState(3);
  const [turnOn, setTurnOn] = useState(true);
  const [useBrightness, setUseBrightness] = useState(false);
  const [brightness, setBrightness] = useState(100);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [target, setTarget] = useState(initialDeviceId ? `device:${initialDeviceId}` : '');
  const [loadedId, setLoadedId] = useState<string | null>(null);

  // Open a saved pattern once, when it arrives. The editor is the owner of the state after that.
  if (existing && loadedId !== existing.id && segmentCount > 0) {
    const loaded = patternFromPreset(existing, segmentCount);
    setLoadedId(existing.id);
    setPattern(loaded.state);
    setTurnOn(loaded.turnOn);
    setUseBrightness(loaded.brightness !== null);
    if (loaded.brightness !== null) setBrightness(loaded.brightness);
    setName(existing.name);
    setDescription(existing.description);
  }

  // A different light string can have a different number of segments.
  if (pattern.cells.length !== segmentCount) setPattern(resizePattern(pattern, segmentCount));

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
    () =>
      patternToActions(pattern, {
        turnOn,
        brightness: useBrightness ? brightness : null,
        maxPerCommand: capability?.maxSelect ?? segmentCount,
      }),
    [pattern, turnOn, useBrightness, brightness, capability, segmentCount],
  );
  const parsedTarget = parseTarget(target);
  const valid = isHexColor(fill) && isHexColor(pattern.background) && segmentCount > 0;

  const submitSave = () => {
    const steps = actions.map((action) => ({ deviceId: null, action }));
    if (existing) {
      save.mutate(
        { id: existing.id, update: { name, description, actions: steps } },
        { onSuccess: () => navigate('/presets') },
      );
    } else {
      save.mutate({ create: { name, description, actions: steps } }, { onSuccess: () => navigate('/presets') });
    }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-5">
        <SectionCard
          title="Paint your lights"
          description={`${layout?.name ?? 'This string'} reports ${segmentCount} segments. One cell is one segment, which may cover several bulbs.`}
        >
          <div className="space-y-4">
            {devices.length > 1 ? (
              <Field label="Light string">
                {(props) => (
                  <select {...props} className={inputClass} value={layoutId} onChange={(e) => setLayoutId(e.target.value)}>
                    {devices.map((device) => (
                      <option key={device.id} value={device.id}>
                        {device.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            ) : null}

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

            <StringCanvas
              pattern={pattern}
              rows={rows}
              onStrokeStart={() => {
                strokeStart.current = latest.current;
              }}
              onPaint={(index) => {
                const next = paintCell(latest.current, index, tool === 'paint' ? fill : null);
                latest.current = next;
                setPattern(next);
              }}
              onStrokeEnd={() => {
                if (strokeStart.current) commit(strokeStart.current, latest.current);
                strokeStart.current = null;
              }}
            />

            <div className="flex flex-wrap items-end gap-2 border-t border-ink-700/70 pt-4">
              <Button
                size="sm"
                icon={<Blend className="size-4" aria-hidden />}
                onClick={() => change((state) => gradientFill(state, state.background, fill))}
              >
                Gradient
              </Button>
              <Button
                size="sm"
                icon={<Repeat className="size-4" aria-hidden />}
                onClick={() => change((state) => repeatFill(state, [fill, state.background], runLength))}
              >
                Repeat pattern
              </Button>
              <label className="flex items-center gap-2 text-sm text-ink-300">
                every
                <input
                  type="number"
                  aria-label="Segments in each run of the repeat pattern"
                  className="min-h-9 w-16 rounded-lg border border-ink-700 bg-ink-850 px-2 text-ink-100"
                  min={1}
                  max={Math.max(1, segmentCount)}
                  value={runLength}
                  onChange={(e) => setRunLength(Number(e.target.value) || 1)}
                />
                segments
              </label>
            </div>
            <p className="text-xs text-ink-400">
              Gradient blends from the background to the fill color. Repeat alternates them, such as red and green for
              Christmas.
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
        <SectionCard title="Try it on the lights">
          <div className="space-y-4">
            <Field label="Send to">
              {(props) => (
                <select {...props} className={inputClass} value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">Choose a device or group</option>
                  <TargetOptions />
                </select>
              )}
            </Field>
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
              This takes {actions.length} command{actions.length === 1 ? '' : 's'} per light, about {actions.length} second
              {actions.length === 1 ? '' : 's'}. The lights change a section at a time.
              {actions.length > 10 ? ' Fewer colors means a quicker change.' : ''}
            </p>
            <Button
              variant="primary"
              className="w-full"
              icon={<Send className="size-4" aria-hidden />}
              busy={apply.isPending}
              disabled={!parsedTarget || !valid}
              onClick={() => {
                if (parsedTarget) apply.mutate({ name: name || 'Pattern preview', target: parsedTarget, actions });
              }}
            >
              Send to lights
            </Button>
            {apply.isPending ? <p className="text-sm text-ink-300" role="status">Sending a section at a time...</p> : null}
            {apply.isError ? <ErrorNotice error={apply.error} /> : null}
            {apply.data ? <RunResults run={apply.data} /> : null}
            {apply.data ? (
              <p className="text-xs text-ink-400">
                Govee does not report segment colors, so this app cannot confirm the pattern. Check the lights themselves.
              </p>
            ) : null}
          </div>
        </SectionCard>

        <SectionCard title="Save this pattern" description="Saved as an app preset, so you can apply it to a group or schedule it.">
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
  const [params] = useSearchParams();
  const devices = useDevices();

  const capable = (devices.data ?? []).filter(
    (d) => d.discoveryStatus === 'present' && segmentCapability(d) !== undefined,
  );

  return (
    <>
      <Link to="/presets" className="mb-3 inline-flex min-h-9 items-center gap-1 text-sm text-ink-300 hover:text-ink-100">
        <ArrowLeft className="size-4" aria-hidden />
        Scenes & Presets
      </Link>
      <PageHeader
        title={presetId ? 'Edit pattern' : 'Paint a pattern'}
        description="Choose colors for each section of your lights, try them out, and save the result."
      />
      {devices.isPending ? <Loading label="Loading your lights" /> : null}
      {devices.isError ? <ErrorNotice error={devices.error} /> : null}
      {devices.data && capable.length === 0 ? (
        <Card className="p-5">
          <EmptyState title="No light here reports segment control">
            Patterns need per-segment color from the Govee API. Groups made in the Govee Home app do not report it, but their
            individual lights might.
          </EmptyState>
        </Card>
      ) : null}
      {capable.length > 0 ? <Editor devices={capable} presetId={presetId} initialDeviceId={params.get('device')} /> : null}
    </>
  );
}
