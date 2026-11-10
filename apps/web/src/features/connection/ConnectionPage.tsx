import { RefreshCw, Send, X } from 'lucide-react';
import type {
  ConnectionAdviceDto,
  ConnectionIncidentDto,
  ConnectionReportDto,
  DeviceHealthDto,
  IncidentKind,
  MissedDeliveryDto,
  MissedDeliveryStatus,
} from '@glm/shared';
import { Badge, Button, ErrorNotice, Loading, Notice, PageHeader, SectionCard } from '../../components/ui';
import { dateTime, timeAgo } from '../../lib/format';
import {
  useConnectionReport,
  useDismissMissed,
  useRunConnectionCheck,
  useSendMissed,
  useUpdateSettings,
} from '../../lib/queries';

const OVERALL: Record<ConnectionReportDto['overall'], { tone: 'good' | 'info' | 'warn' | 'bad'; title: string }> = {
  healthy: { tone: 'good', title: 'Everything looks connected' },
  attention: { tone: 'warn', title: 'Something needs a look' },
  problem: { tone: 'bad', title: 'There is a connection problem' },
  unknown: { tone: 'info', title: 'Nothing has been checked yet' },
};

const STATE_BADGE: Record<DeviceHealthDto['state'], { tone: 'good' | 'bad' | 'warn' | 'neutral'; label: string }> = {
  online: { tone: 'good', label: 'Online' },
  offline: { tone: 'bad', label: 'Offline' },
  missing: { tone: 'warn', label: 'Not in Govee account' },
  unknown: { tone: 'neutral', label: 'Unknown' },
  not_monitored: { tone: 'neutral', label: 'Not checked' },
};

const INCIDENT_LABEL: Record<IncidentKind, string> = {
  device_offline: 'Went offline',
  device_missing: 'Left the Govee device list',
  govee_unreachable: 'The app could not reach Govee',
  api_key_rejected: 'Govee rejected the API key',
  api_key_missing: 'No Govee API key set',
  rate_limited: 'Govee limited requests',
};

const DELIVERY_LABEL: Record<MissedDeliveryStatus, string> = {
  waiting: 'Waiting',
  delivering: 'Sending',
  delivered: 'Sent, and accepted by Govee',
  failed: 'Could not send',
  replaced: 'Replaced by something newer',
  expired: 'Too old to send',
  dismissed: 'Dismissed',
};

function minutes(seconds: number): string {
  const value = Math.round(seconds / 60);
  return value <= 1 ? 'about a minute' : `${value} minutes`;
}

function lasted(incident: ConnectionIncidentDto): string {
  if (!incident.closedAt) return 'Still happening';
  const ms = Date.parse(incident.closedAt) - Date.parse(incident.openedAt);
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return 'Lasted under a minute';
  if (mins < 60) return `Lasted ${mins} min`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `Lasted ${hours} hr` : `Lasted ${Math.round(hours / 24)} days`;
}

function AdviceCard({ advice }: { advice: ConnectionAdviceDto }) {
  const tone = advice.severity === 'problem' ? 'bad' : advice.severity === 'attention' ? 'warn' : 'info';
  return (
    <Notice tone={tone} title={advice.title}>
      <p>{advice.explanation}</p>
      {advice.steps.length > 0 ? (
        <>
          <p className="mt-2 font-medium">What to try</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5">
            {advice.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </>
      ) : null}
    </Notice>
  );
}

function LightRow({ device }: { device: DeviceHealthDto }) {
  const badge = STATE_BADGE[device.state];
  return (
    <li className="rounded-lg bg-ink-850 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 font-medium break-words">{device.name}</span>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>
      <p className="mt-1 text-xs text-ink-400">
        {device.problemSince ? `Since ${dateTime(device.problemSince)}. ` : ''}
        {device.state !== 'not_monitored' ? `Last online: ${timeAgo(device.lastOnlineAt)}. Last checked: ${timeAgo(device.lastCheckedAt)}. ` : ''}
        {device.dropsLast7Days > 0 ? `Dropped ${device.dropsLast7Days} time${device.dropsLast7Days === 1 ? '' : 's'} in the last 7 days.` : ''}
      </p>
      {device.note ? <p className="mt-1 text-xs text-ink-400">{device.note}</p> : null}
    </li>
  );
}

function WaitingRow({ delivery, online }: { delivery: MissedDeliveryDto; online: boolean }) {
  const send = useSendMissed();
  const dismiss = useDismissMissed();
  return (
    <li className="rounded-lg bg-ink-850 p-3">
      <p className="font-medium break-words">
        {delivery.deviceName} missed "{delivery.runName}"
      </p>
      <p className="mt-1 text-xs text-ink-400">
        Missed {timeAgo(delivery.createdAt)}. {delivery.stepCount} command{delivery.stepCount === 1 ? '' : 's'}.
        {online ? ' The light is back online.' : ' Waiting for the light to come back online.'}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          size="sm"
          icon={<Send className="size-4" aria-hidden />}
          disabled={!online}
          busy={send.isPending}
          onClick={() => send.mutate(delivery.id)}
        >
          Send now
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<X className="size-4" aria-hidden />}
          busy={dismiss.isPending}
          onClick={() => dismiss.mutate(delivery.id)}
        >
          Dismiss
        </Button>
      </div>
      {send.isError ? (
        <div className="mt-2">
          <ErrorNotice error={send.error} title="Not sent" />
        </div>
      ) : null}
      {dismiss.isError ? (
        <div className="mt-2">
          <ErrorNotice error={dismiss.error} />
        </div>
      ) : null}
    </li>
  );
}

function CatchUp({ report }: { report: ConnectionReportDto }) {
  const update = useUpdateSettings();
  const online = new Set(report.devices.filter((d) => d.state === 'online').map((d) => d.deviceId));
  return (
    <SectionCard
      title="Patterns lights missed"
      description="When a light is offline, the app keeps the latest thing it could not receive."
    >
      <label className="flex min-h-9 items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4"
          checked={report.catchUpEnabled}
          disabled={update.isPending}
          onChange={(event) => update.mutate({ catchUpEnabled: event.target.checked })}
        />
        <span>
          <span className="block font-medium">Resend automatically when a light comes back</span>
          <span className="block text-xs text-ink-400">
            Off by default, because this changes your lights at whatever time they return. Anything older than a day is not
            sent, and nothing overwrites a command you sent after the light came back.
          </span>
        </span>
      </label>
      {update.isError ? (
        <div className="mt-2">
          <ErrorNotice error={update.error} title="The setting was not saved" />
        </div>
      ) : null}
      {report.waiting.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {report.waiting.map((delivery) => (
            <WaitingRow key={delivery.id} delivery={delivery} online={online.has(delivery.deviceId)} />
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-ink-300">Nothing is waiting.</p>
      )}
      {report.recentDeliveries.length > 0 ? (
        <>
          <h3 className="mt-4 text-sm font-medium text-ink-200">Recent</h3>
          <ul className="mt-1 space-y-1 text-xs text-ink-400">
            {report.recentDeliveries.map((delivery) => (
              <li key={delivery.id}>
                {delivery.deviceName}, "{delivery.runName}": {DELIVERY_LABEL[delivery.status]}. {timeAgo(delivery.finishedAt)}.
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </SectionCard>
  );
}

export function ConnectionPage() {
  const report = useConnectionReport();
  const check = useRunConnectionCheck();
  const data = report.data ?? null;

  return (
    <>
      <PageHeader
        title="Connections"
        description="Checks your lights in the background, even with no browser open, and tells you what it finds."
        actions={
          <Button icon={<RefreshCw className="size-4" aria-hidden />} busy={check.isPending} onClick={() => check.mutate(undefined)}>
            Check now
          </Button>
        }
      />
      {report.isPending ? <Loading label="Loading connection status" /> : null}
      {report.isError ? <ErrorNotice error={report.error} title="Could not load connection status" /> : null}
      {check.isError ? <ErrorNotice error={check.error} title="The check did not run" /> : null}
      {data ? (
        <div className="space-y-5">
          <Notice tone={OVERALL[data.overall].tone} title={OVERALL[data.overall].title}>
            {data.monitor.status === 'disabled'
              ? 'Background checks are turned off on this server.'
              : `Last checked ${timeAgo(data.monitor.lastCheckAt)}. Checks about every ${minutes(data.monitor.intervalSeconds)}.`}
          </Notice>

          {data.advice.map((advice) => (
            <AdviceCard key={advice.id} advice={advice} />
          ))}

          <SectionCard title="Your lights" description="Online means Govee reports the light as connected, as of the last check.">
            <ul className="space-y-2">
              {data.devices.map((device) => (
                <LightRow key={device.deviceId} device={device} />
              ))}
            </ul>
          </SectionCard>

          <CatchUp report={data} />

          <SectionCard title="What happened" description="Problems the app saw, and what it did by itself.">
            {data.automaticActions.length === 0 ? (
              <p className="text-sm text-ink-300">No connection events yet.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {data.automaticActions.map((event) => (
                  <li key={event.id}>
                    <span className="text-ink-200">{event.message}</span>{' '}
                    <span className="text-xs text-ink-400">{timeAgo(event.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          {data.incidents.length > 0 ? (
            <SectionCard title="Connection history">
              <ul className="space-y-2 text-sm">
                {data.incidents.map((incident) => (
                  <li key={incident.id} className="rounded-lg bg-ink-850 p-2.5">
                    <p className="font-medium break-words">
                      {incident.deviceName ? `${incident.deviceName}: ` : ''}
                      {INCIDENT_LABEL[incident.kind]}
                    </p>
                    <p className="text-xs text-ink-400">
                      {dateTime(incident.openedAt)}. {lasted(incident)}.
                    </p>
                  </li>
                ))}
              </ul>
            </SectionCard>
          ) : null}

          <Notice title="What this can and cannot fix">
            By itself, the app rechecks your device list, retries through temporary Govee failures, and resends missed patterns
            if you turn that on. It cannot restart a controller, change Wi-Fi settings, read firmware or repair hardware, because
            Govee's public API offers no way to, and this server is not on your home network. The causes above are its best
            reading of what is and is not working. Problems also appear under Notifications, and on your phone if you turn that on. There are no email or text alerts.
          </Notice>
        </div>
      ) : null}
    </>
  );
}
