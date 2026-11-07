import type { CapabilityStateDto, DeviceDto } from '@glm/shared';
import { VerificationBadge } from '../../components/status';
import { Badge, SectionCard } from '../../components/ui';
import { formatStateValue, instanceLabel, timeAgo } from '../../lib/format';

const DISPLAY_ORDER = ['powerSwitch', 'brightness', 'colorRgb', 'colorTemperatureK'];

function order(instance: string): number {
  const index = DISPLAY_ORDER.indexOf(instance);
  return index === -1 ? DISPLAY_ORDER.length : index;
}

/**
 * Keeps what the app asked for, what Govee accepted, and what Govee last reported
 * side by side, because they are different facts and can disagree.
 */
export function ReportedStatePanel({ device }: { device: DeviceDto }) {
  const rows = device.states
    .filter((s) => s.requested || s.accepted || s.reported)
    .sort((a, b) => order(a.instance) - order(b.instance));
  const notReported = device.states.filter((s) => s.notQueryable && !s.requested && !s.accepted && !s.reported);

  return (
    <SectionCard
      title="Status"
      description="Requested, accepted and reported values are shown separately. A value is only called confirmed when a later report from Govee matches it."
    >
      {rows.length === 0 && notReported.length === 0 ? (
        <p className="text-sm text-ink-300">
          Unknown. No report yet and no commands sent. Use Refresh status to ask Govee.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((state) => (
            <StateRow key={state.instance} state={state} />
          ))}
        </ul>
      )}
      {notReported.length > 0 ? (
        <p className="mt-3 text-sm text-ink-300">
          Not reported by Govee: {notReported.map((s) => instanceLabel(s.instance)).join(', ')}.
        </p>
      ) : null}
    </SectionCard>
  );
}

function StateRow({ state }: { state: CapabilityStateDto }) {
  return (
    <li className="rounded-lg bg-ink-850 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{instanceLabel(state.instance)}</span>
        <VerificationBadge verification={state.verification} />
      </div>
      <dl className="mt-2 grid gap-1.5 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-ink-400">Requested</dt>
          <dd>
            {state.requested ? (
              <>
                {formatStateValue(state.instance, state.requested.value)}{' '}
                <span className="text-xs text-ink-400">{timeAgo(state.requested.at)}</span>
              </>
            ) : (
              <span className="text-ink-400">None</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-400">Accepted by Govee</dt>
          <dd>
            {state.accepted ? (
              <>
                {formatStateValue(state.instance, state.accepted.value)}{' '}
                <span className="text-xs text-ink-400">{timeAgo(state.accepted.at)}</span>
              </>
            ) : (
              <span className="text-ink-400">None</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-400">Reported by Govee</dt>
          <dd>
            {state.reported ? (
              <>
                {formatStateValue(state.instance, state.reported.value)}{' '}
                <span className="text-xs text-ink-400">{timeAgo(state.reported.at)}</span>
                {state.reported.historical ? (
                  <span className="ml-1 inline-block">
                    <Badge tone="warn">Historical</Badge>
                  </span>
                ) : null}
              </>
            ) : state.notQueryable ? (
              <span className="text-ink-400">Not reported by Govee</span>
            ) : (
              <span className="text-ink-400">Unknown</span>
            )}
          </dd>
        </div>
      </dl>
    </li>
  );
}
