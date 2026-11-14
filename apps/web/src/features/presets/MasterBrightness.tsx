import { SunMedium } from 'lucide-react';
import type { DeviceDto } from '@glm/shared';
import { CommitSlider } from '../../components/CommitSlider';
import { Card, ErrorNotice } from '../../components/ui';
import { useAllBrightness } from '../../lib/queries';

/** Lights that can be dimmed. A Govee group is left out: its lights are already here one by one. */
export function dimmableLights(devices: DeviceDto[]): DeviceDto[] {
  return devices.filter(
    (d) => d.discoveryStatus === 'present' && !d.isGoveeGroup && d.capabilities.some((c) => c.kind === 'brightness'),
  );
}

function reportedBrightness(device: DeviceDto): number | null {
  const value = device.states.find((s) => s.instance === 'brightness')?.reported?.value;
  return typeof value === 'number' ? value : null;
}

/**
 * One slider for every light string. Govee keeps brightness apart from color, so the colors
 * stay exactly as they are, and the level stays as set when a pattern or scheme changes.
 */
export function MasterBrightness({ devices }: { devices: DeviceDto[] }) {
  const lights = dimmableLights(devices);
  const send = useAllBrightness();
  if (lights.length === 0) return null;

  // What an offline light last reported is history, so it does not count towards the level shown.
  const live = lights.filter((d) => d.connectivity !== 'offline' && d.connectivity !== 'checking');
  const reported = live.map(reportedBrightness);
  const known = reported.filter((value): value is number => value !== null);
  const same = live.length > 0 && known.length === live.length && new Set(known).size === 1;
  const refused = send.data?.outcomes.filter((o) => o.status !== 'accepted') ?? [];
  const accepted = (send.data?.outcomes.length ?? 0) - refused.length;

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <SunMedium className="size-4 text-amber-soft" aria-hidden />
        <h2 className="font-semibold">Brightness for all lights</h2>
      </div>
      <CommitSlider
        label={`All ${lights.length} light${lights.length === 1 ? '' : 's'} together`}
        min={1}
        max={100}
        step={1}
        unit="%"
        value={same ? (known[0] as number) : null}
        onCommit={(value) => send.mutate(value)}
      />
      <p className="mt-2 text-xs text-ink-400">
        {same || known.length === 0
          ? 'Changes how bright the whole display is. The colors and pattern stay as they are, and the level stays when the pattern changes.'
          : `The lights differ right now: ${live.map((d, i) => `${d.name} ${reported[i] === null ? 'unknown' : `${reported[i]}%`}`).join(', ')}. Moving the slider sets them all to the same level.`}
      </p>
      <div className="mt-2 text-sm" role="status">
        {send.isPending ? <p className="text-ink-300">Sending to {lights.length} light{lights.length === 1 ? '' : 's'}...</p> : null}
        {send.data && refused.length === 0 ? (
          <p className="text-ink-300">
            Govee accepted it for all {send.data.outcomes.length} light{send.data.outcomes.length === 1 ? '' : 's'}.
          </p>
        ) : null}
        {refused.length > 0 ? (
          <p className="text-ink-300">
            Govee accepted it for {accepted} of {send.data?.outcomes.length} lights.
          </p>
        ) : null}
        {refused.length > 0 ? (
          <ul className="space-y-1 text-bad">
            {refused.map((outcome) => (
              <li key={outcome.deviceId ?? outcome.deviceName}>
                {outcome.deviceName}: {outcome.reason ?? 'not sent'}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {send.isError ? <ErrorNotice error={send.error} title="The brightness was not sent" /> : null}
    </Card>
  );
}
