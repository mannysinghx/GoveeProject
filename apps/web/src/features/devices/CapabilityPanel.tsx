import type { NormalizedCapability } from '@glm/shared';
import { Badge, SectionCard } from '../../components/ui';
import { instanceLabel } from '../../lib/format';

function describe(capability: NormalizedCapability): string {
  switch (capability.kind) {
    case 'power':
      return `On sends ${capability.onValue}. Off sends ${capability.offValue}.`;
    case 'brightness':
      return `${capability.min} to ${capability.max}${capability.unit === 'percent' ? '%' : ''}, in steps of ${capability.step}.`;
    case 'colorTemperature':
      return `${capability.min} K to ${capability.max} K, in steps of ${capability.step}.`;
    case 'color':
      return `Any RGB colour, sent as an integer from ${capability.min} to ${capability.max}.`;
    case 'segmentedColor':
      return `${capability.segments.length} segments reported (${capability.segments[0]} to ${capability.segments.at(-1)}). Select ${capability.minSelect} to ${capability.maxSelect} at a time.`;
    case 'segmentedBrightness':
      return `${capability.segments.length} segments reported. Brightness ${capability.min} to ${capability.max}.`;
    case 'scene':
      return capability.listedOptionCount > 0
        ? `${capability.listedOptionCount} option(s) in the device list. Refresh scenes for any others.`
        : 'Options are retrieved with Refresh scenes.';
    case 'other':
      return capability.reason === 'malformed_metadata'
        ? 'Govee reported this with metadata the app could not read, so no control is offered.'
        : `Reported by Govee. This version of the app has no control for it.${capability.dataType ? ` Data type: ${capability.dataType}.` : ''}`;
  }
}

const REQUIRED_KINDS: { kinds: NormalizedCapability['kind'][]; label: string }[] = [
  { kinds: ['power'], label: 'On and off' },
  { kinds: ['brightness'], label: 'Brightness' },
  { kinds: ['color'], label: 'RGB colour' },
  { kinds: ['colorTemperature'], label: 'Colour temperature' },
  { kinds: ['segmentedColor', 'segmentedBrightness'], label: 'Segment control' },
  { kinds: ['scene'], label: 'Scenes' },
];

export function CapabilityPanel({
  capabilities,
  rawCapabilities,
}: {
  capabilities: NormalizedCapability[];
  rawCapabilities: unknown;
}) {
  const absent = REQUIRED_KINDS.filter(({ kinds }) => !capabilities.some((c) => kinds.includes(c.kind)));

  return (
    <SectionCard
      title="Capabilities reported by Govee"
      description="Controls above are built from this list, not from the model number."
    >
      {capabilities.length === 0 ? (
        <p className="text-sm text-ink-300">Govee reported no capabilities for this device.</p>
      ) : (
        <ul className="divide-y divide-ink-700/60">
          {capabilities.map((capability) => (
            <li key={`${capability.type}/${capability.instance}`} className="py-2.5 first:pt-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{instanceLabel(capability.instance)}</span>
                {capability.kind === 'other' ? <Badge>Read only</Badge> : null}
              </div>
              <p className="mt-0.5 text-sm text-ink-300">{describe(capability)}</p>
              <p className="mt-0.5 font-mono text-xs break-all text-ink-400">
                {capability.type} / {capability.instance}
              </p>
            </li>
          ))}
        </ul>
      )}

      {absent.length > 0 ? (
        <div className="mt-4 rounded-lg bg-ink-850 p-3">
          <p className="text-sm font-medium">Not exposed by this device through the official API</p>
          <p className="mt-1 text-sm text-ink-300">{absent.map((a) => a.label).join(', ')}.</p>
          <p className="mt-1 text-xs text-ink-400">
            Some of these may still work in the Govee Home app. This app only uses what the public API reports.
          </p>
        </div>
      ) : null}

      <details className="mt-4">
        <summary className="cursor-pointer text-sm text-ink-300 hover:text-ink-100">
          Developer diagnostics: capability JSON as returned
        </summary>
        <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-ink-950 p-3 font-mono text-xs text-ink-200">
          {JSON.stringify(rawCapabilities, null, 2)}
        </pre>
      </details>
    </SectionCard>
  );
}
