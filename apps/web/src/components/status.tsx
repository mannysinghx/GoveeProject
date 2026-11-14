import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  CircleHelp,
  Clock,
  Hourglass,
  Loader2,
  MinusCircle,
  Radar,
  Wifi,
  WifiOff,
  XCircle,
} from 'lucide-react';
import type {
  ActionOutcomeDto,
  CommandDto,
  DeviceDto,
  ExecutionStatus,
  OutcomeStatus,
  RunResultDto,
  RunStatus,
  Verification,
} from '@glm/shared';
import { api } from '../lib/api';
import { STATUS_LABEL, timeAgo, VERIFICATION_LABEL } from '../lib/format';
import { Badge, type Tone } from './ui';

const ICON = 'size-3';

/** Connection state. Every state has its own icon and words, so colour is never the only cue. */
export function ConnectivityBadge({ device }: { device: DeviceDto }) {
  if (device.discoveryStatus === 'missing') {
    return (
      <Badge tone="warn" icon={<AlertTriangle className={ICON} aria-hidden />}>
        No longer discovered
      </Badge>
    );
  }
  if (device.connectivity === 'online') {
    return (
      <Badge tone="good" icon={<Wifi className={ICON} aria-hidden />}>
        Online
      </Badge>
    );
  }
  if (device.connectivity === 'offline') {
    return (
      <Badge tone="bad" icon={<WifiOff className={ICON} aria-hidden />}>
        Offline
      </Badge>
    );
  }
  if (device.connectivity === 'checking') {
    return (
      <Badge tone="warn" icon={<Radar className={ICON} aria-hidden />}>
        Checking connection
      </Badge>
    );
  }
  return (
    <Badge tone="neutral" icon={<CircleHelp className={ICON} aria-hidden />}>
      Status unknown
    </Badge>
  );
}

export function FreshnessBadge({ device }: { device: DeviceDto }) {
  if (device.freshness === 'never') {
    return (
      <Badge tone="neutral" icon={<CircleDashed className={ICON} aria-hidden />}>
        No report yet
      </Badge>
    );
  }
  const age = timeAgo(device.lastStatusRefreshAt);
  if (device.freshness === 'stale') {
    return (
      <Badge tone="warn" icon={<Clock className={ICON} aria-hidden />}>
        Stale: {age}
      </Badge>
    );
  }
  return (
    <Badge tone="neutral" icon={<Clock className={ICON} aria-hidden />}>
      Updated {age}
    </Badge>
  );
}

const STATUS_TONE: Record<OutcomeStatus, Tone> = {
  queued: 'info',
  sending: 'info',
  accepted: 'amber',
  rejected: 'bad',
  failed: 'bad',
  superseded: 'neutral',
  interrupted: 'warn',
  skipped: 'neutral',
};

function statusIcon(status: OutcomeStatus) {
  switch (status) {
    case 'queued':
      return <Hourglass className={ICON} aria-hidden />;
    case 'sending':
      return <Loader2 className={`${ICON} animate-spin`} aria-hidden />;
    case 'accepted':
      return <CircleDashed className={ICON} aria-hidden />;
    case 'rejected':
    case 'failed':
      return <XCircle className={ICON} aria-hidden />;
    case 'interrupted':
      return <AlertTriangle className={ICON} aria-hidden />;
    default:
      return <MinusCircle className={ICON} aria-hidden />;
  }
}

export function CommandStatusBadge({ status }: { status: OutcomeStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} icon={statusIcon(status)}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

/**
 * "Accepted" and "confirmed" must never look alike. Only a later report from Govee
 * showing the same value earns a tick, and it is still labelled as a report.
 */
export function VerificationBadge({ verification }: { verification: Verification | null }) {
  if (!verification || verification === 'not_applicable') return null;
  const tone: Tone =
    verification === 'confirmed' ? 'good' : verification === 'mismatch' ? 'warn' : 'neutral';
  const icon =
    verification === 'confirmed' ? (
      <CheckCircle2 className={ICON} aria-hidden />
    ) : verification === 'mismatch' ? (
      <AlertTriangle className={ICON} aria-hidden />
    ) : (
      <CircleDashed className={ICON} aria-hidden />
    );
  return (
    <Badge tone={tone} icon={icon}>
      {VERIFICATION_LABEL[verification]}
    </Badge>
  );
}

/** The server checks a command against a later report, so its outcome can still change. */
const COMMAND_POLL_MS = 3000;
const COMMAND_POLL_LIMIT = 10;

function isSettled(command: CommandDto): boolean {
  if (command.status === 'queued' || command.status === 'sending') return false;
  return !(command.status === 'accepted' && command.verification === 'unverified');
}

export function CommandResultLine({ command: initial }: { command: CommandDto }) {
  const { data } = useQuery({
    queryKey: ['command', initial.id],
    queryFn: async () => (await api<{ command: CommandDto }>(`/commands/${initial.id}`)).command,
    initialData: initial,
    initialDataUpdatedAt: Date.now(),
    staleTime: COMMAND_POLL_MS,
    retry: false,
    refetchInterval: (query) =>
      query.state.data && !isSettled(query.state.data) && query.state.dataUpdateCount < COMMAND_POLL_LIMIT
        ? COMMAND_POLL_MS
        : false,
  });
  const command = data ?? initial;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" role="status">
      <span className="text-ink-200">{command.summary}</span>
      <CommandStatusBadge status={command.status} />
      {command.status === 'accepted' ? <VerificationBadge verification={command.verification} /> : null}
      {command.errorMessage ? <span className="text-xs text-bad">{command.errorMessage}</span> : null}
    </div>
  );
}

const RUN_LABEL: Record<RunStatus | 'missed' | 'interrupted', { label: string; tone: Tone }> = {
  running: { label: 'Running', tone: 'info' },
  all_accepted: { label: 'All accepted by Govee', tone: 'amber' },
  partial: { label: 'Partly accepted', tone: 'warn' },
  failed: { label: 'Failed', tone: 'bad' },
  skipped: { label: 'Nothing sent', tone: 'neutral' },
  missed: { label: 'Missed', tone: 'warn' },
  interrupted: { label: 'Interrupted', tone: 'warn' },
};

export function RunStatusBadge({ status }: { status: RunStatus | ExecutionStatus }) {
  const { label, tone } = RUN_LABEL[status];
  return <Badge tone={tone}>{label}</Badge>;
}

function OutcomeRow({ outcome }: { outcome: ActionOutcomeDto }) {
  return (
    <li className="rounded-lg bg-ink-850 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink-100">{outcome.deviceName}</span>
        <CommandStatusBadge status={outcome.status} />
      </div>
      <p className="mt-1 text-sm text-ink-300">{outcome.summary}</p>
      {outcome.reason ? <p className="mt-1 text-xs text-ink-400">{outcome.reason}</p> : null}
    </li>
  );
}

/** Per-device results for a preset, group or segment run. */
export function RunResults({ run }: { run: RunResultDto }) {
  const accepted = run.outcomes.filter((o) => o.status === 'accepted').length;
  return (
    <div className="space-y-3" role="status">
      <div className="flex flex-wrap items-center gap-2">
        <RunStatusBadge status={run.status} />
        <span className="text-sm text-ink-300">
          {accepted} of {run.outcomes.length} action{run.outcomes.length === 1 ? '' : 's'} accepted by Govee
        </span>
      </div>
      {accepted > 0 ? (
        <p className="text-xs text-ink-400">
          Accepted means Govee took the request. It does not prove the lights changed. Devices are updated one after
          another, not in sync.
        </p>
      ) : null}
      {run.outcomes.length > 0 ? (
        <ul className="space-y-2">
          {run.outcomes.map((outcome, index) => (
            <OutcomeRow key={`${outcome.deviceId}-${index}`} outcome={outcome} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-300">There was nothing to send.</p>
      )}
    </div>
  );
}
