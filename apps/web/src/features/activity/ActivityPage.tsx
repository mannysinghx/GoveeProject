import { useState } from 'react';
import {
  activityEventTypes,
  activityOutcomes,
  type ActivityEventDto,
  type ActivityEventType,
  type ActivityOutcome,
  type DiagnosticsDto,
} from '@glm/shared';
import { Badge, Button, Detail, ErrorNotice, Field, inputClass, Loading, Notice, PageHeader, SectionCard, type Tone } from '../../components/ui';
import { dateTime, ERROR_CATEGORY_LABEL, timeAgo } from '../../lib/format';
import { useActivity, useDevices, useDiagnostics } from '../../lib/queries';
import { AskCard } from '../ai/AskCard';

const OUTCOME_TONE: Record<ActivityOutcome, Tone> = {
  success: 'good',
  failure: 'bad',
  warning: 'warn',
  info: 'neutral',
};

const OUTCOME_LABEL: Record<ActivityOutcome, string> = {
  success: 'OK',
  failure: 'Failure',
  warning: 'Warning',
  info: 'Info',
};

const TROUBLESHOOTING: Partial<Record<NonNullable<DiagnosticsDto['govee']['lastErrorCategory']>, string>> = {
  auth: 'Govee rejected the key. Check GOVEE_API_KEY on the server. Applying for a new key may replace the old one.',
  not_configured: 'Set GOVEE_API_KEY in the server environment and restart the app.',
  network: "This server could not reach Govee. Check its internet connection and DNS.",
  timeout: 'Govee did not answer in time. This is often temporary. Try again shortly.',
  rate_limited: 'Too many requests. The app slows down by itself. Wait a minute before trying again.',
  server_error: 'The Govee service returned an error. This is usually temporary.',
};

function Diagnostics() {
  const diagnostics = useDiagnostics();
  if (diagnostics.isPending) return <Loading label="Loading diagnostics" />;
  if (diagnostics.isError) return <ErrorNotice error={diagnostics.error} title="Diagnostics are unavailable" />;
  const d = diagnostics.data;
  const hint = d.govee.lastErrorCategory ? TROUBLESHOOTING[d.govee.lastErrorCategory] : undefined;

  return (
    <SectionCard title="Diagnostics">
      {d.govee.usingLocalTestEndpoint ? (
        <div className="mb-4">
          <Notice tone="warn" title="Test mode">
            This server uses a local test endpoint ({d.govee.baseUrl}), not the Govee cloud.
          </Notice>
        </div>
      ) : null}
      <dl className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        <Detail label="Backend">
          <Badge tone="good">Running</Badge>
        </Detail>
        <Detail label="Database">
          <Badge tone={d.database.status === 'ok' ? 'good' : 'bad'}>{d.database.status === 'ok' ? 'Healthy' : 'Error'}</Badge>
        </Detail>
        <Detail label="Govee key">
          <Badge tone={d.govee.keyConfigured ? 'good' : 'warn'}>{d.govee.keyConfigured ? 'Configured' : 'Not configured'}</Badge>
        </Detail>
        <Detail label="Scheduler">
          <Badge tone={d.scheduler.status === 'running' ? 'good' : 'warn'}>{d.scheduler.status}</Badge>
        </Detail>
        <Detail label="Last Govee connection">{dateTime(d.govee.lastSuccessfulConnectionAt)}</Detail>
        <Detail label="Last API error">
          {d.govee.lastErrorCategory
            ? `${ERROR_CATEGORY_LABEL[d.govee.lastErrorCategory]} (${timeAgo(d.govee.lastErrorAt)})`
            : 'None'}
        </Detail>
        <Detail label="Last rate limit">{d.govee.lastRateLimitAt ? timeAgo(d.govee.lastRateLimitAt) : 'None'}</Detail>
        <Detail label="Govee requests today">
          {d.govee.requestsToday} of {d.govee.dailyBudget}
        </Detail>
        <Detail label="Discovered devices">{d.devices.discovered}</Detail>
        <Detail label="No longer discovered">{d.devices.noLongerDiscovered}</Detail>
        <Detail label="Last discovery">{dateTime(d.devices.lastDiscoveryAt)}</Detail>
        <Detail label="Pending commands">{d.queue.pending}</Detail>
        <Detail label="Enabled schedules">{d.scheduler.enabledSchedules}</Detail>
        <Detail label="Scheduler last ran">{d.scheduler.lastTickAt ? timeAgo(d.scheduler.lastTickAt) : 'Not yet'}</Detail>
        <Detail label="App version">{d.version}</Detail>
        <Detail label="Node.js">{d.nodeVersion}</Detail>
      </dl>
      {hint ? (
        <div className="mt-4">
          <Notice tone="info" title="About the last error">
            {hint}
          </Notice>
        </div>
      ) : null}
      {d.queue.pausedUntil ? (
        <div className="mt-4">
          <Notice tone="warn">Requests to Govee are paused until {dateTime(d.queue.pausedUntil)} because of a rate limit.</Notice>
        </div>
      ) : null}
    </SectionCard>
  );
}

function EventRow({ event }: { event: ActivityEventDto }) {
  return (
    <li className="py-3 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={OUTCOME_TONE[event.outcome]}>{OUTCOME_LABEL[event.outcome]}</Badge>
        <span className="text-xs text-ink-400">{event.eventType.replace('_', ' ')}</span>
        {event.deviceName ? <span className="text-xs text-ink-300">{event.deviceName}</span> : null}
        <time className="ml-auto text-xs text-ink-400" dateTime={event.createdAt} title={dateTime(event.createdAt)}>
          {dateTime(event.createdAt)}
        </time>
      </div>
      <p className="mt-1 text-sm break-words text-ink-200">{event.message}</p>
      {event.correlationId ? <p className="mt-0.5 font-mono text-xs break-all text-ink-400">Ref: {event.correlationId}</p> : null}
    </li>
  );
}

export function ActivityPage() {
  const devices = useDevices();
  const [deviceId, setDeviceId] = useState('');
  const [eventType, setEventType] = useState<ActivityEventType | ''>('');
  const [outcome, setOutcome] = useState<ActivityOutcome | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [beforeId, setBeforeId] = useState<number | undefined>(undefined);

  const filters = {
    limit: 100,
    ...(deviceId ? { deviceId } : {}),
    ...(eventType ? { eventType } : {}),
    ...(outcome ? { outcome } : {}),
    ...(from ? { from: new Date(`${from}T00:00:00`).toISOString() } : {}),
    ...(to ? { to: new Date(`${to}T23:59:59.999`).toISOString() } : {}),
    ...(beforeId ? { beforeId } : {}),
  };
  const activity = useActivity(filters);

  const reset = (fn: () => void) => {
    fn();
    setBeforeId(undefined);
  };

  return (
    <>
      <PageHeader title="Activity & Troubleshooting" description="What the app has done, and how its connection to Govee is doing." />
      <div className="space-y-5">
        <AskCard />
        <Diagnostics />

        <SectionCard title="Activity">
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Device">
              {(props) => (
                <select {...props} className={inputClass} value={deviceId} onChange={(e) => reset(() => setDeviceId(e.target.value))}>
                  <option value="">All devices</option>
                  {devices.data?.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Event type">
              {(props) => (
                <select
                  {...props}
                  className={inputClass}
                  value={eventType}
                  onChange={(e) => reset(() => setEventType(e.target.value as ActivityEventType | ''))}
                >
                  <option value="">All types</option>
                  {activityEventTypes.map((type) => (
                    <option key={type} value={type}>
                      {type.replace('_', ' ')}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Result">
              {(props) => (
                <select
                  {...props}
                  className={inputClass}
                  value={outcome}
                  onChange={(e) => reset(() => setOutcome(e.target.value as ActivityOutcome | ''))}
                >
                  <option value="">All results</option>
                  {activityOutcomes.map((value) => (
                    <option key={value} value={value}>
                      {OUTCOME_LABEL[value]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="From">
              {(props) => <input {...props} type="date" className={inputClass} value={from} onChange={(e) => reset(() => setFrom(e.target.value))} />}
            </Field>
            <Field label="To">
              {(props) => <input {...props} type="date" className={inputClass} value={to} onChange={(e) => reset(() => setTo(e.target.value))} />}
            </Field>
          </div>

          {activity.isPending ? <Loading label="Loading activity" /> : null}
          {activity.isError ? <ErrorNotice error={activity.error} /> : null}
          {activity.data?.events.length === 0 ? <p className="text-sm text-ink-300">Nothing matches these filters.</p> : null}
          {activity.data && activity.data.events.length > 0 ? (
            <ul className="divide-y divide-ink-700/60">
              {activity.data.events.map((event) => (
                <EventRow key={event.id} event={event} />
              ))}
            </ul>
          ) : null}
          <div className="mt-4 flex gap-2">
            {beforeId ? (
              <Button size="sm" onClick={() => setBeforeId(undefined)}>
                Back to newest
              </Button>
            ) : null}
            {activity.data?.nextBeforeId ? (
              <Button size="sm" onClick={() => setBeforeId(activity.data?.nextBeforeId ?? undefined)}>
                Older
              </Button>
            ) : null}
          </div>
        </SectionCard>
      </div>
    </>
  );
}
