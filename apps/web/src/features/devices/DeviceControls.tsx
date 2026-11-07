import { HexColorPicker } from 'react-colorful';
import { Power, PowerOff, Save } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  hexToRgb,
  intToHex,
  isHexColor,
  rgbToHex,
  type BrightnessCapability,
  type ColorCapability,
  type ColorTemperatureCapability,
  type DeviceDto,
  type NormalizedCapability,
  type PowerCapability,
} from '@glm/shared';
import { CommandResultLine } from '../../components/status';
import { Button, ErrorNotice, Field, inputClass, SectionCard } from '../../components/ui';
import { CommitSlider } from '../../components/CommitSlider';
import { formatStateValue, timeAgo } from '../../lib/format';
import { addRecentColor, readRecentColors } from '../../lib/hooks';
import { useDeviceControl } from '../../lib/queries';
import { SaveAsPresetDialog } from './SaveAsPresetDialog';
import { ScenesPanel } from './ScenesPanel';
import { SegmentControl } from './SegmentControl';

function find<K extends NormalizedCapability['kind']>(device: DeviceDto, kind: K) {
  return device.capabilities.find((c) => c.kind === kind) as Extract<NormalizedCapability, { kind: K }> | undefined;
}

/** Newest known value for seeding a control. Marked with where it came from, so it is never mistaken for live. */
function latestKnown(device: DeviceDto, instance: string): { value: unknown; label: string } | null {
  const state = device.states.find((s) => s.instance === instance);
  if (!state) return null;
  const candidates = [
    state.reported && { at: state.reported.at, value: state.reported.value, label: state.reported.historical ? 'Last reported while offline' : 'Reported' },
    state.accepted && { at: state.accepted.at, value: state.accepted.value, label: 'Accepted, not confirmed' },
  ].filter(Boolean) as { at: string; value: unknown; label: string }[];
  const newest = candidates.sort((a, b) => b.at.localeCompare(a.at))[0];
  return newest ? { value: newest.value, label: `${newest.label} ${timeAgo(newest.at)}` } : null;
}

function KnownValue({ device, instance }: { device: DeviceDto; instance: string }) {
  const known = latestKnown(device, instance);
  return (
    <p className="text-xs text-ink-400">
      {known ? `${formatStateValue(instance, known.value)}. ${known.label}.` : 'Current value: unknown.'}
    </p>
  );
}

function ControlFeedback({
  control,
}: {
  control: ReturnType<typeof useDeviceControl>;
}) {
  if (control.isPending) return <p className="text-sm text-ink-300" role="status">Sending to Govee...</p>;
  if (control.isError) return <ErrorNotice error={control.error} />;
  if (control.data) return <CommandResultLine command={control.data.command} />;
  return null;
}

function PowerControl({ device, capability }: { device: DeviceDto; capability: PowerCapability }) {
  const control = useDeviceControl(device.id);
  void capability;
  return (
    <SectionCard title="Power">
      <div className="space-y-3">
        <div className="grid max-w-xs grid-cols-2 gap-2">
          <Button
            icon={<Power className="size-4" aria-hidden />}
            disabled={control.isPending}
            onClick={() => control.mutate({ kind: 'power', on: true })}
          >
            On
          </Button>
          <Button
            icon={<PowerOff className="size-4" aria-hidden />}
            disabled={control.isPending}
            onClick={() => control.mutate({ kind: 'power', on: false })}
          >
            Off
          </Button>
        </div>
        <KnownValue device={device} instance="powerSwitch" />
        <ControlFeedback control={control} />
      </div>
    </SectionCard>
  );
}

function BrightnessControl({ device, capability }: { device: DeviceDto; capability: BrightnessCapability }) {
  const control = useDeviceControl(device.id);
  const known = latestKnown(device, 'brightness');
  const initial = typeof known?.value === 'number' ? known.value : null;
  const percent = capability.unit === 'percent';
  return (
    <SectionCard title="Brightness">
      <div className="space-y-3">
        <CommitSlider
          label="Brightness"
          min={capability.min}
          max={capability.max}
          step={capability.step}
          value={initial}
          unit={percent ? '%' : ''}
          onCommit={(value) => control.mutate({ kind: 'brightness', value })}
        />
        <KnownValue device={device} instance="brightness" />
        <ControlFeedback control={control} />
      </div>
    </SectionCard>
  );
}

function ColorTemperatureControl({ device, capability }: { device: DeviceDto; capability: ColorTemperatureCapability }) {
  const control = useDeviceControl(device.id);
  const known = latestKnown(device, 'colorTemperatureK');
  const initial = typeof known?.value === 'number' && known.value !== 0 ? known.value : null;
  return (
    <SectionCard
      title="Colour temperature"
      description={`Warm to cool. This device reports ${capability.min} K to ${capability.max} K.`}
    >
      <div className="space-y-3">
        <div aria-hidden className="kelvin-track" />
        <CommitSlider
          label="Colour temperature"
          min={capability.min}
          max={capability.max}
          step={capability.step}
          value={initial}
          unit=" K"
          onCommit={(kelvin) => control.mutate({ kind: 'colorTemperature', kelvin })}
        />
        <KnownValue device={device} instance="colorTemperatureK" />
        <ControlFeedback control={control} />
      </div>
    </SectionCard>
  );
}

function ColorControl({ device, capability }: { device: DeviceDto; capability: ColorCapability }) {
  void capability;
  const known = latestKnown(device, 'colorRgb');
  const [hex, setHex] = useState(typeof known?.value === 'number' ? intToHex(known.value) : '#f2b45a');
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const [recent, setRecent] = useState(readRecentColors);
  const [saving, setSaving] = useState(false);
  const control = useDeviceControl(device.id);
  const rgb = hexToRgb(hex);

  const setChannel = (channel: 'r' | 'g' | 'b', value: string) => {
    const n = Math.max(0, Math.min(255, Number.parseInt(value, 10) || 0));
    setHex(rgbToHex({ ...rgb, [channel]: n }));
    setHexDraft(null);
  };

  const invalidHex = hexDraft !== null && !isHexColor(hexDraft);

  return (
    <SectionCard title="Colour">
      <div className="grid gap-5 md:grid-cols-[minmax(0,18rem)_1fr]">
        <div className="color-picker-host">
          <HexColorPicker
            color={hex}
            onChange={(value) => {
              setHex(value);
              setHexDraft(null);
            }}
          />
        </div>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div
              className="size-14 shrink-0 rounded-lg border border-ink-600"
              style={{ backgroundColor: hex }}
              role="img"
              aria-label={`Preview of ${hex}`}
            />
            <div className="min-w-0 flex-1">
              <Field label="Hex" error={invalidHex ? 'Use a colour in #rrggbb form.' : null}>
                {(props) => (
                  <input
                    {...props}
                    className={`${inputClass} font-mono`}
                    value={hexDraft ?? hex}
                    spellCheck={false}
                    onChange={(e) => {
                      const next = e.target.value;
                      setHexDraft(next);
                      if (isHexColor(next)) setHex(next.toLowerCase());
                    }}
                  />
                )}
              </Field>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(['r', 'g', 'b'] as const).map((channel) => (
              <Field key={channel} label={{ r: 'Red', g: 'Green', b: 'Blue' }[channel]}>
                {(props) => (
                  <input
                    {...props}
                    className={inputClass}
                    type="number"
                    min={0}
                    max={255}
                    value={rgb[channel]}
                    onChange={(e) => setChannel(channel, e.target.value)}
                  />
                )}
              </Field>
            ))}
          </div>

          {recent.length > 0 ? (
            <div>
              <p className="mb-1.5 text-xs text-ink-400">Recent colours</p>
              <ul className="flex flex-wrap gap-1.5">
                {recent.map((color) => (
                  <li key={color}>
                    <button
                      type="button"
                      aria-label={`Use recent colour ${color}`}
                      className="size-9 rounded-md border border-ink-600"
                      style={{ backgroundColor: color }}
                      onClick={() => {
                        setHex(color);
                        setHexDraft(null);
                      }}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              busy={control.isPending}
              disabled={invalidHex}
              onClick={() => {
                setRecent(addRecentColor(hex));
                control.mutate({ kind: 'color', hex });
              }}
            >
              Apply colour
            </Button>
            <Button icon={<Save className="size-4" aria-hidden />} disabled={invalidHex} onClick={() => setSaving(true)}>
              Save as preset
            </Button>
          </div>
          <KnownValue device={device} instance="colorRgb" />
          <ControlFeedback control={control} />
        </div>
      </div>
      {saving ? (
        <SaveAsPresetDialog
          device={device}
          actions={[{ type: 'color', hex }]}
          defaultName={`${device.name} ${hex}`}
          onClose={() => setSaving(false)}
        />
      ) : null}
    </SectionCard>
  );
}

function UnavailableList({ items }: { items: ReactNode[] }) {
  if (items.length === 0) return null;
  return (
    <SectionCard title="Not available on this device">
      <ul className="list-inside list-disc space-y-1 text-sm text-ink-300">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </SectionCard>
  );
}

/**
 * Each control appears only when Govee reports the matching capability for this
 * device. Nothing here looks at the SKU, so other models work the same way.
 */
export function DeviceControls({ device }: { device: DeviceDto }) {
  const power = find(device, 'power');
  const brightness = find(device, 'brightness');
  const color = find(device, 'color');
  const temperature = find(device, 'colorTemperature');
  const segmentColor = find(device, 'segmentedColor');
  const segmentBrightness = find(device, 'segmentedBrightness');
  const hasScenes = device.capabilities.some((c) => c.kind === 'scene');

  const unavailable: string[] = [];
  if (!power) unavailable.push('On and off control is not exposed through the official API.');
  if (!brightness) unavailable.push('Brightness control is not exposed through the official API.');
  if (!color) unavailable.push('RGB colour control is not exposed through the official API.');
  if (!temperature) unavailable.push('Colour temperature control is not exposed through the official API.');
  if (!segmentColor && !segmentBrightness) {
    unavailable.push('Segment control is not exposed by this device through the official API.');
  }
  if (!hasScenes) unavailable.push('Scenes are not exposed by this device through the official API.');

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        {power ? <PowerControl device={device} capability={power} /> : null}
        {brightness ? <BrightnessControl device={device} capability={brightness} /> : null}
      </div>
      {color ? <ColorControl device={device} capability={color} /> : null}
      {temperature ? <ColorTemperatureControl device={device} capability={temperature} /> : null}
      {segmentColor || segmentBrightness ? (
        <SegmentControl device={device} colorCapability={segmentColor} brightnessCapability={segmentBrightness} />
      ) : null}
      {hasScenes ? <ScenesPanel device={device} /> : null}
      <UnavailableList items={unavailable} />
    </div>
  );
}
