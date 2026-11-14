import { CalendarClock, Lightbulb, Power, PowerOff, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DeviceDto, DiagnosticsDto, PresetDto, RefreshAllResultDto } from '@glm/shared';
import {
  CommandResultLine,
  ConnectivityBadge,
  FreshnessBadge,
} from '../../components/status';
import { Badge, Button, Card, EmptyState, ErrorNotice, Loading, Notice, PageHeader, SectionCard } from '../../components/ui';
import { dateTime, formatStateValue, timeAgo } from '../../lib/format';
import { useVisibleInterval } from '../../lib/hooks';
import {
  useConnectionReport,
  useDeviceControl,
  useDevices,
  useDiagnostics,
  usePresets,
  useRefreshAll,
  useRefreshDue,
  useSettings,
  useSummary,
} from '../../lib/queries';
import { ApplyPresetDialog } from '../presets/ApplyPresetDialog';
import { MasterBrightness } from '../presets/MasterBrightness';

function ConnectionBanner({ diagnostics }: { diagnostics: DiagnosticsDto }) {
  const { govee } = diagnostics;
  if (!govee.keyConfigured) {
    return (
      <Notice
        tone="warn"
        title="No Govee API key is set on the server"
        action={
          <Link to="/connect" className="text-sm whitespace-nowrap underline underline-offset-2">
            Set up
          </Link>
        }
      >
        Lights cannot be controlled until <code className="font-mono">GOVEE_API_KEY</code> is set and the app restarted.
      </Notice>
    );
  }
  if (govee.lastErrorCategory === 'auth' && (govee.lastErrorAt ?? '') > (govee.lastSuccessfulConnectionAt ?? '')) {
    return (
      <Notice tone="bad" title="Govee rejected the API key">
        Check <code className="font-mono">GOVEE_API_KEY</code> on the server. Applying for a new key may have replaced the
        old one.
      </Notice>
    );
  }
  if ((govee.lastErrorAt ?? '') > (govee.lastSuccessfulConnectionAt ?? '')) {
    return (
      <Notice tone="warn" title="The last request to Govee failed">
        Last successful connection: {dateTime(govee.lastSuccessfulConnectionAt)}. See Activity for details.
      </Notice>
    );
  }
  return null;
}

function reportedValue(device: DeviceDto, instance: string): string | null {
  const state = device.states.find((s) => s.instance === instance);
  if (!state?.reported) return null;
  return formatStateValue(instance, state.reported.value);
}

function DeviceCard({ device }: { device: DeviceDto }) {
  const control = useDeviceControl(device.id);
  const canPower = device.capabilities.some((c) => c.kind === 'power');
  const missing = device.discoveryStatus === 'missing';
  const power = reportedValue(device, 'powerSwitch');
  const brightness = reportedValue(device, 'brightness');
  const historical = device.connectivity === 'offline' || device.connectivity === 'checking';

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to={`/devices/${device.id}`}
            className="block truncate font-semibold text-ink-100 underline-offset-2 hover:underline"
          >
            {device.name}
          </Link>
          <p className="mt-0.5 text-xs text-ink-400">{device.sku}</p>
        </div>
        {device.isPrimaryModel ? <Badge tone="amber">Outdoor Elite</Badge> : null}
        {device.isGoveeGroup ? <Badge tone="info">Govee group</Badge> : null}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {device.isGoveeGroup ? null : <ConnectivityBadge device={device} />}
        {!missing && !device.isGoveeGroup ? <FreshnessBadge device={device} /> : null}
      </div>

      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-xs text-ink-400">{historical ? 'Last reported power' : 'Reported power'}</dt>
          <dd className="mt-0.5">{power ?? (device.isGoveeGroup ? 'Not reported' : 'Unknown')}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-400">{historical ? 'Last reported brightness' : 'Reported brightness'}</dt>
          <dd className="mt-0.5">{brightness ?? (device.isGoveeGroup ? 'Not reported' : 'Unknown')}</dd>
        </div>
      </dl>

      {canPower && !missing ? (
        <div className="mt-auto grid grid-cols-2 gap-2">
          <Button
            icon={<Power className="size-4" aria-hidden />}
            aria-label={`Turn ${device.name} on`}
            disabled={control.isPending}
            onClick={() => control.mutate({ kind: 'power', on: true })}
          >
            On
          </Button>
          <Button
            icon={<PowerOff className="size-4" aria-hidden />}
            aria-label={`Turn ${device.name} off`}
            disabled={control.isPending}
            onClick={() => control.mutate({ kind: 'power', on: false })}
          >
            Off
          </Button>
        </div>
      ) : null}

      {control.isPending ? <p className="text-xs text-ink-300" role="status">Sending...</p> : null}
      {control.isError ? <ErrorNotice error={control.error} /> : null}
      {control.data ? <CommandResultLine command={control.data.command} /> : null}
    </Card>
  );
}

function QuickPresets({ presets }: { presets: PresetDto[] }) {
  const [applying, setApplying] = useState<PresetDto | null>(null);
  return (
    <SectionCard
      title="Saved presets"
      action={
        <Link to="/presets" className="text-sm text-amber-soft underline underline-offset-2">
          Manage
        </Link>
      }
    >
      {presets.length === 0 ? (
        <p className="text-sm text-ink-300">No presets yet. Create one under Scenes & Presets.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {presets.slice(0, 8).map((preset) => (
            <li key={preset.id}>
              <Button size="sm" icon={<Sparkles className="size-4" aria-hidden />} onClick={() => setApplying(preset)}>
                {preset.name}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {applying ? <ApplyPresetDialog preset={applying} onClose={() => setApplying(null)} /> : null}
    </SectionCard>
  );
}

/** What asking Govee just now found, in words. */
function CheckResult({ result, current }: { result: RefreshAllResultDto; current: DeviceDto[] }) {
  // The second answer about a light arrives a little later, so this follows the live list.
  const devices = current.length > 0 ? current : result.devices;
  const lights = devices.filter((d) => d.discoveryStatus === 'present' && !d.isGoveeGroup);
  const online = lights.filter((d) => d.connectivity === 'online').length;
  const notOnline = lights.filter((d) => d.connectivity === 'offline' || d.connectivity === 'checking');
  const stillChecking = notOnline.some((d) => d.connectivity === 'checking');
  const problems = [
    ...(result.listError ? [`The device list could not be refreshed: ${result.listError}`] : []),
    ...result.failures.map((f) => `${f.name}: ${f.message}`),
  ];
  if (problems.length > 0) {
    return (
      <Notice tone="warn" title="Some checks did not get through">
        <ul className="list-disc pl-5">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
        <p className="mt-1">What is shown for those lights is from their last successful report.</p>
      </Notice>
    );
  }
  if (notOnline.length > 0) {
    return (
      <Notice tone="warn" title={`Asked Govee just now: ${online} of ${lights.length} lights online`}>
        Govee says {notOnline.map((d) => d.name).join(', ')} {notOnline.length === 1 ? 'is' : 'are'} not connected.{' '}
        {stillChecking
          ? 'The app asks once more before calling a light offline, because a single answer is sometimes wrong.'
          : 'A second answer agreed, so check the power and Wi-Fi there. Connections has steps to try.'}
      </Notice>
    );
  }
  return <Notice tone="good">Asked Govee just now: all {lights.length} lights are online.</Notice>;
}

/** Points to the Connections page when the background checks have found something. */
function ConnectionAlert() {
  const report = useConnectionReport();
  if (!report.data || (report.data.overall !== 'problem' && report.data.overall !== 'attention')) return null;
  const first = report.data.advice[0];
  const waiting = report.data.waiting.length;
  return (
    <Notice
      tone={report.data.overall === 'problem' ? 'bad' : 'warn'}
      title={first?.title ?? `${waiting} light${waiting === 1 ? '' : 's'} missed a pattern`}
      action={
        <Link to="/connections" className="shrink-0 text-sm font-medium underline">
          See what to try
        </Link>
      }
    />
  );
}

export function DashboardPage() {
  const devices = useDevices();
  const diagnostics = useDiagnostics();
  const summary = useSummary();
  const presets = usePresets();
  const settings = useSettings();
  const checkAll = useRefreshAll();
  const refreshDue = useRefreshDue();

  // Status is only polled while this page is open and visible, at a modest configurable rate.
  const pollMs = (settings.data?.statusPollSeconds ?? 60) * 1000;
  const hasDevices = (devices.data?.length ?? 0) > 0;
  useVisibleInterval(() => refreshDue.mutate(), hasDevices ? pollMs : null);
  useEffect(() => {
    if (hasDevices) refreshDue.mutate();
    // Once when devices first appear. The interval above handles the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasDevices]);

  const list = devices.data ?? [];
  const present = list.filter((d) => d.discoveryStatus === 'present');
  const online = present.filter((d) => d.connectivity === 'online').length;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={
          diagnostics.data?.govee.lastSuccessfulConnectionAt
            ? `${present.length} device(s) discovered. ${online} reported online. Govee last reached ${timeAgo(diagnostics.data.govee.lastSuccessfulConnectionAt)}.`
            : 'Your lights at a glance.'
        }
        actions={
          <Button
            icon={<RefreshCw className="size-4" aria-hidden />}
            busy={checkAll.isPending}
            onClick={() => checkAll.mutate()}
          >
            Check lights now
          </Button>
        }
      />

      <div className="space-y-5">
        {diagnostics.data ? <ConnectionBanner diagnostics={diagnostics.data} /> : null}
        <ConnectionAlert />
        {diagnostics.data?.govee.usingLocalTestEndpoint ? (
          <Notice tone="warn" title="Test mode">
            Connected to a local test endpoint, not Govee. The devices below are test data.
          </Notice>
        ) : null}
        {checkAll.isError ? <ErrorNotice error={checkAll.error} title="Could not check the lights" /> : null}
        {checkAll.data ? <CheckResult result={checkAll.data} current={list} /> : null}

        {devices.isPending ? <Loading label="Loading devices" /> : null}
        {devices.isError ? <ErrorNotice error={devices.error} title="Could not load devices" /> : null}

        {devices.data && list.length === 0 ? (
          <EmptyState
            icon={<Lightbulb className="size-8" aria-hidden />}
            title="No devices yet"
            action={
              <Link to="/connect">
                <Button variant="primary">Connect to Govee</Button>
              </Link>
            }
          >
            Make sure your lights are in the Govee Home app, then ask Govee for your device list.
          </EmptyState>
        ) : null}

        {list.length > 0 ? (
          <section aria-label="Devices" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((device) => (
              <DeviceCard key={device.id} device={device} />
            ))}
          </section>
        ) : null}

        {list.length > 0 ? <MasterBrightness devices={list} /> : null}

        <div className="grid gap-5 lg:grid-cols-2">
          <SectionCard
            title="Upcoming schedules"
            action={
              <Link to="/schedules" className="text-sm text-amber-soft underline underline-offset-2">
                Manage
              </Link>
            }
          >
            {summary.data && summary.data.upcoming.length > 0 ? (
              <ul className="space-y-2">
                {summary.data.upcoming.map((item) => (
                  <li key={item.scheduleId} className="flex items-start gap-3 rounded-lg bg-ink-850 p-3 text-sm">
                    <CalendarClock className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden />
                    <div className="min-w-0">
                      <p className="font-medium">{item.scheduleName}</p>
                      <p className="text-ink-300">
                        {item.actionSummary} <span className="text-ink-400">· {item.targetName}</span>
                      </p>
                      <p className="text-xs text-ink-400">{item.run.local}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-300">Nothing scheduled.</p>
            )}
          </SectionCard>

          <SectionCard
            title="Recent problems"
            action={
              <Link to="/activity" className="text-sm text-amber-soft underline underline-offset-2">
                All activity
              </Link>
            }
          >
            {summary.data && summary.data.recentFailures.length > 0 ? (
              <ul className="space-y-2">
                {summary.data.recentFailures.map((event) => (
                  <li key={event.id} className="flex items-start gap-3 rounded-lg bg-ink-850 p-3 text-sm">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-bad" aria-hidden />
                    <div className="min-w-0">
                      <p className="break-words text-ink-200">{event.message}</p>
                      <p className="text-xs text-ink-400">{timeAgo(event.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-300">No recent failures.</p>
            )}
          </SectionCard>
        </div>

        {presets.data ? <QuickPresets presets={presets.data.filter((preset) => !preset.builtin)} /> : null}
      </div>
    </>
  );
}
