import { isHexColor, type DeviceAction, type DeviceDto, type SceneDto } from '@glm/shared';
import { Field, inputClass } from '../../components/ui';

export type ActionType = DeviceAction['type'];

const ACTION_LABELS: Record<ActionType, string> = {
  power: 'Power',
  brightness: 'Brightness',
  color: 'RGB colour',
  colorTemperature: 'Colour temperature',
  scene: 'Govee scene',
  segmentColor: 'Segment colour',
  segmentBrightness: 'Segment brightness',
};

/**
 * Which actions can be offered. For a chosen device, only what it reports. With no
 * device, the settings most lights share: scenes and segments are device-specific,
 * so they require a device to be chosen first.
 */
export function availableActionTypes(device: DeviceDto | undefined): ActionType[] {
  if (!device) return ['power', 'brightness', 'color', 'colorTemperature'];
  const kinds = new Set(device.capabilities.map((c) => c.kind));
  const types: ActionType[] = [];
  if (kinds.has('power')) types.push('power');
  if (kinds.has('brightness')) types.push('brightness');
  if (kinds.has('color')) types.push('color');
  if (kinds.has('colorTemperature')) types.push('colorTemperature');
  if (kinds.has('scene')) types.push('scene');
  if (kinds.has('segmentedColor')) types.push('segmentColor');
  if (kinds.has('segmentedBrightness')) types.push('segmentBrightness');
  return types;
}

export function actionTypeLabel(type: ActionType): string {
  return ACTION_LABELS[type];
}

export function defaultAction(type: ActionType, device: DeviceDto | undefined): DeviceAction {
  const cap = <K extends DeviceDto['capabilities'][number]['kind']>(kind: K) =>
    device?.capabilities.find((c) => c.kind === kind) as Extract<DeviceDto['capabilities'][number], { kind: K }> | undefined;
  switch (type) {
    case 'power':
      return { type, on: true };
    case 'brightness':
      return { type, value: cap('brightness')?.max ?? 100 };
    case 'color':
      return { type, hex: '#f2b45a' };
    case 'colorTemperature':
      return { type, kelvin: cap('colorTemperature')?.min ?? 2700 };
    case 'scene':
      return { type, sceneKey: '' };
    case 'segmentColor':
      return { type, segments: [], hex: '#f2b45a' };
    case 'segmentBrightness':
      return { type, segments: [], value: cap('segmentedBrightness')?.max ?? 100 };
  }
}

function parseSegments(text: string): number[] {
  const out = new Set<number>();
  for (const part of text.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(trimmed);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      for (let i = from; i <= to && i - from < 512; i++) out.add(i);
    } else if (/^\d+$/.test(trimmed)) {
      out.add(Number(trimmed));
    }
  }
  return [...out].sort((a, b) => a - b);
}

export function ActionFields({
  action,
  device,
  scenes,
  onChange,
}: {
  action: DeviceAction;
  device?: DeviceDto | undefined;
  scenes?: SceneDto[] | undefined;
  onChange: (action: DeviceAction) => void;
}) {
  const brightnessCap = device?.capabilities.find((c) => c.kind === 'brightness');
  const temperatureCap = device?.capabilities.find((c) => c.kind === 'colorTemperature');

  switch (action.type) {
    case 'power':
      return (
        <Field label="State">
          {(props) => (
            <select
              {...props}
              className={inputClass}
              value={action.on ? 'on' : 'off'}
              onChange={(e) => onChange({ ...action, on: e.target.value === 'on' })}
            >
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          )}
        </Field>
      );
    case 'brightness':
      return (
        <Field
          label="Brightness"
          hint={brightnessCap?.kind === 'brightness' ? `${brightnessCap.min} to ${brightnessCap.max}` : 'Checked against each device when applied.'}
        >
          {(props) => (
            <input
              {...props}
              type="number"
              className={inputClass}
              value={action.value}
              {...(brightnessCap?.kind === 'brightness' ? { min: brightnessCap.min, max: brightnessCap.max } : {})}
              onChange={(e) => onChange({ ...action, value: Number.parseInt(e.target.value, 10) || 0 })}
            />
          )}
        </Field>
      );
    case 'color':
      return <ColorInput value={action.hex} onChange={(hex) => onChange({ ...action, hex })} />;
    case 'colorTemperature':
      return (
        <Field
          label="Kelvin"
          hint={
            temperatureCap?.kind === 'colorTemperature'
              ? `${temperatureCap.min} K to ${temperatureCap.max} K`
              : 'Ranges differ between devices. Checked when applied.'
          }
        >
          {(props) => (
            <input
              {...props}
              type="number"
              className={inputClass}
              value={action.kelvin}
              {...(temperatureCap?.kind === 'colorTemperature' ? { min: temperatureCap.min, max: temperatureCap.max } : {})}
              onChange={(e) => onChange({ ...action, kelvin: Number.parseInt(e.target.value, 10) || 0 })}
            />
          )}
        </Field>
      );
    case 'scene':
      return (
        <Field label="Scene" hint={scenes?.length ? undefined : 'No scenes loaded. Refresh scenes on the device page first.'}>
          {(props) => (
            <select
              {...props}
              className={inputClass}
              value={action.sceneKey}
              onChange={(e) => {
                const scene = scenes?.find((s) => s.key === e.target.value);
                onChange({ ...action, sceneKey: e.target.value, ...(scene ? { sceneName: scene.name } : {}) });
              }}
            >
              <option value="">Choose a scene</option>
              {scenes?.map((scene) => (
                <option key={scene.key} value={scene.key}>
                  {scene.name} ({scene.kind === 'diy' ? 'DIY' : scene.kind})
                </option>
              ))}
            </select>
          )}
        </Field>
      );
    case 'segmentColor':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <SegmentsInput segments={action.segments} onChange={(segments) => onChange({ ...action, segments })} />
          <ColorInput value={action.hex} onChange={(hex) => onChange({ ...action, hex })} />
        </div>
      );
    case 'segmentBrightness':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <SegmentsInput segments={action.segments} onChange={(segments) => onChange({ ...action, segments })} />
          <Field label="Brightness">
            {(props) => (
              <input
                {...props}
                type="number"
                className={inputClass}
                value={action.value}
                onChange={(e) => onChange({ ...action, value: Number.parseInt(e.target.value, 10) || 0 })}
              />
            )}
          </Field>
        </div>
      );
  }
}

function ColorInput({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  return (
    <div className="flex items-end gap-2">
      <input
        type="color"
        aria-label="Pick a colour"
        className="h-11 w-14 cursor-pointer rounded-lg border border-ink-700 bg-ink-850 p-1"
        value={isHexColor(value) ? value : '#000000'}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="min-w-0 flex-1">
        <Field label="Hex" error={isHexColor(value) ? null : 'Use a colour in #rrggbb form.'}>
          {(props) => (
            <input
              {...props}
              className={`${inputClass} font-mono`}
              spellCheck={false}
              value={value}
              onChange={(e) => onChange(e.target.value)}
            />
          )}
        </Field>
      </div>
    </div>
  );
}

function SegmentsInput({ segments, onChange }: { segments: number[]; onChange: (segments: number[]) => void }) {
  return (
    <Field label="Segments" hint="For example: 0-4, 7. Checked against the device when saved.">
      {(props) => (
        <input
          {...props}
          className={inputClass}
          defaultValue={segments.join(', ')}
          onChange={(e) => onChange(parseSegments(e.target.value))}
        />
      )}
    </Field>
  );
}
