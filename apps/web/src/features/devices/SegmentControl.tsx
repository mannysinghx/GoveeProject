import { Plus, Save, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  formatSegmentList,
  isHexColor,
  type DeviceAction,
  type DeviceDto,
  type SegmentedBrightnessCapability,
  type SegmentedColorCapability,
  type SegmentOperation,
} from '@glm/shared';
import { RunResults } from '../../components/status';
import { Button, ErrorNotice, Field, Notice, inputClass, SectionCard } from '../../components/ui';
import { useSegments } from '../../lib/queries';
import { SaveAsPresetDialog } from './SaveAsPresetDialog';

export function SegmentControl({
  device,
  colorCapability,
  brightnessCapability,
}: {
  device: DeviceDto;
  colorCapability: SegmentedColorCapability | undefined;
  brightnessCapability: SegmentedBrightnessCapability | undefined;
}) {
  const allSegments = useMemo(
    () =>
      [...new Set([...(colorCapability?.segments ?? []), ...(brightnessCapability?.segments ?? [])])].sort(
        (a, b) => a - b,
      ),
    [colorCapability, brightnessCapability],
  );
  const maxSelect = Math.min(
    colorCapability?.maxSelect ?? Infinity,
    brightnessCapability?.maxSelect ?? Infinity,
  );

  const [selected, setSelected] = useState<number[]>([]);
  const [hex, setHex] = useState('#f2b45a');
  const [useColor, setUseColor] = useState(Boolean(colorCapability));
  const [useBrightness, setUseBrightness] = useState(false);
  const [brightness, setBrightness] = useState(brightnessCapability?.max ?? 100);
  const [steps, setSteps] = useState<SegmentOperation[]>([]);
  const [saving, setSaving] = useState(false);
  const segments = useSegments(device.id);

  const pendingSegments = new Set<number>(
    segments.isPending ? (segments.variables?.operations ?? []).flatMap((op) => op.segments) : [],
  );

  const toggle = (index: number) => {
    setSelected((current) =>
      current.includes(index) ? current.filter((s) => s !== index) : [...current, index].sort((a, b) => a - b),
    );
  };

  const currentOperation = (): SegmentOperation | null => {
    if (selected.length === 0) return null;
    if (useColor && !isHexColor(hex)) return null;
    if (!useColor && !useBrightness) return null;
    return {
      segments: selected,
      ...(useColor && colorCapability ? { hex } : {}),
      ...(useBrightness && brightnessCapability ? { brightness } : {}),
    };
  };
  const operation = currentOperation();

  const allOperations = steps.length > 0 ? steps : operation ? [operation] : [];

  const presetActions: DeviceAction[] = allOperations.flatMap((op) => [
    ...(op.hex ? [{ type: 'segmentColor' as const, segments: op.segments, hex: op.hex }] : []),
    ...(op.brightness !== undefined
      ? [{ type: 'segmentBrightness' as const, segments: op.segments, value: op.brightness }]
      : []),
  ]);

  return (
    <SectionCard
      title="Segments"
      description="Segments are the sections Govee reports for this device. One segment is not necessarily one bulb."
    >
      <div className="space-y-4">
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-ink-200">
            Select segments ({selected.length} of {allSegments.length})
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {allSegments.map((index) => {
              const isSelected = selected.includes(index);
              const isPending = pendingSegments.has(index);
              return (
                <button
                  key={index}
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={`Segment ${index}${isPending ? ', command pending' : ''}`}
                  onClick={() => toggle(index)}
                  className={`relative size-11 rounded-lg border text-sm tabular-nums transition-colors ${
                    isSelected
                      ? 'border-amber-glow bg-amber-wash font-semibold text-amber-soft'
                      : 'border-ink-700 bg-ink-850 text-ink-200 hover:bg-ink-800'
                  }`}
                >
                  {index}
                  {isPending ? (
                    <span aria-hidden className="absolute top-1 right-1 size-1.5 animate-pulse rounded-full bg-info" />
                  ) : null}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected(allSegments.slice(0, maxSelect))}>
              Select all
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
              Clear
            </Button>
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          {colorCapability ? (
            <div className="space-y-2">
              <label className="flex min-h-9 items-center gap-2 text-sm">
                <input type="checkbox" className="size-4" checked={useColor} onChange={(e) => setUseColor(e.target.checked)} />
                Set colour
              </label>
              {useColor ? (
                <div className="flex items-end gap-2">
                  <input
                    type="color"
                    aria-label="Segment colour"
                    className="h-11 w-14 cursor-pointer rounded-lg border border-ink-700 bg-ink-850 p-1"
                    value={isHexColor(hex) ? hex : '#000000'}
                    onChange={(e) => setHex(e.target.value)}
                  />
                  <div className="flex-1">
                    <Field label="Hex" error={isHexColor(hex) ? null : 'Use a colour in #rrggbb form.'}>
                      {(props) => (
                        <input
                          {...props}
                          className={`${inputClass} font-mono`}
                          spellCheck={false}
                          value={hex}
                          onChange={(e) => setHex(e.target.value)}
                        />
                      )}
                    </Field>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {brightnessCapability ? (
            <div className="space-y-2">
              <label className="flex min-h-9 items-center gap-2 text-sm">
                <input type="checkbox" className="size-4" checked={useBrightness} onChange={(e) => setUseBrightness(e.target.checked)} />
                Set brightness
              </label>
              {useBrightness ? (
                <Field label={`Segment brightness: ${brightness}`}>
                  {(props) => (
                    <input
                      {...props}
                      type="range"
                      className="h-8 w-full"
                      min={brightnessCapability.min}
                      max={brightnessCapability.max}
                      step={brightnessCapability.step}
                      value={brightness}
                      onChange={(e) => setBrightness(Number(e.target.value))}
                    />
                  )}
                </Field>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            busy={segments.isPending}
            disabled={allOperations.length === 0}
            onClick={() => segments.mutate({ operations: allOperations })}
          >
            {steps.length > 0 ? `Apply ${steps.length} step(s)` : 'Apply to selected'}
          </Button>
          <Button
            icon={<Plus className="size-4" aria-hidden />}
            disabled={!operation}
            onClick={() => {
              if (operation) setSteps((current) => [...current, operation]);
              setSelected([]);
            }}
          >
            Add as a step
          </Button>
          <Button
            icon={<Save className="size-4" aria-hidden />}
            disabled={presetActions.length === 0}
            onClick={() => setSaving(true)}
          >
            Save as preset
          </Button>
        </div>

        {steps.length > 0 ? (
          <div>
            <p className="mb-2 text-sm font-medium text-ink-200">Arrangement</p>
            <ol className="space-y-1.5">
              {steps.map((step, index) => (
                <li key={index} className="flex items-center justify-between gap-2 rounded-lg bg-ink-850 p-2.5 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    {step.hex ? (
                      <span aria-hidden className="size-4 shrink-0 rounded border border-ink-600" style={{ backgroundColor: step.hex }} />
                    ) : null}
                    <span className="min-w-0 break-words">
                      Segments {formatSegmentList(step.segments)}
                      {step.hex ? `: ${step.hex}` : ''}
                      {step.brightness !== undefined ? `, brightness ${step.brightness}` : ''}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove step ${index + 1}`}
                    icon={<Trash2 className="size-4" aria-hidden />}
                    onClick={() => setSteps((current) => current.filter((_, i) => i !== index))}
                  />
                </li>
              ))}
            </ol>
            <p className="mt-2 text-xs text-ink-400">
              Steps are sent one at a time through the command queue, so a pattern appears gradually, not all at once.
            </p>
          </div>
        ) : null}

        {segments.isError ? <ErrorNotice error={segments.error} /> : null}
        {segments.data ? <RunResults run={segments.data} /> : null}
        {segments.data && segments.data.status === 'partial' ? (
          <Notice tone="warn">Some segment commands did not go through, so the pattern may be incomplete.</Notice>
        ) : null}
      </div>

      {saving ? (
        <SaveAsPresetDialog
          device={device}
          actions={presetActions}
          defaultName={`${device.name} segments`}
          onClose={() => setSaving(false)}
        />
      ) : null}
    </SectionCard>
  );
}
