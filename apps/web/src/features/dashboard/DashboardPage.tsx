import { ArrowRight, CalendarClock, Lightbulb, Power, PowerOff, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DeviceDto, DiagnosticsDto, PresetDto, RefreshAllResultDto } from '@glm/shared';
import { HouseStrip, LightStrip, lookOfDevice, OnlineRing, Spectrum } from '../../components/light';
import { CommandResultLine, ConnectivityBadge, FreshnessBadge } from '../../components/status';
import { Badge, Button, EmptyState, ErrorNotice, Loading, Notice, SectionCard } from '../../components/ui';
import { dateTime, dayPart, formatStateValue, greeting, timeAgo } from '../../lib/format';
import { useNow, useVisibleInterval } from '../../lib/hooks';
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
        title="No Govee API key is connected"
        action={
          <Link to="/connect" className="text-sm font-medium whitespace-nowrap underline underline-offset-2">
            Connect
          </Link>
        }
      >
        Lights cannot be reached until a Govee API key is connected.
      </Notice>
    );
  }
  if (govee.lastErrorCategory === 'auth' && (govee.lastErrorAt ?? '') > (govee.lastSuccessfulConnectionAt ?? '')) {
    return (
      <Notice
        tone="bad"
        title="Govee rejected the API key"
        action={
          <Link to="/settings" className="text-sm font-medium whitespace-nowrap underline underline-offset-2">
            Settings
          </Link>
        }
      >
        Check the key in Settings, under Govee API key. Applying for a new key may have replaced the old one.
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

/** One light string: what it is showing, how it is doing, and the two buttons that matter most. */
function DeviceCard({ device }: { device: DeviceDto }) {
  const control = useDeviceControl(device.id);
  const canPower = device.capabilities.some((c) => c.kind === 'power');
  const missing = device.discoveryStatus === 'missing';
  const power = reportedValue(device, 'powerSwitch');
  const brightness = reportedValue(device, 'brightness');
  const historical = device.connectivity === 'offline' || device.connectivity === 'checking';
  const look = lookOfDevice(device);
  const known = power === 'On' || power === 'Off';

  return (
    <article className="tile flex flex-col gap-4 rounded-3xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to={`/devices/${device.id}`}
            className="block truncate font-display text-lg font-semibold tracking-tight text-fg underline-offset-4 hover:underline"
          >
            {device.name}
          </Link>
          <p className="mt-0.5 text-xs text-fg-4">{device.sku}</p>
        </div>
        {device.isPrimaryModel ? <Badge tone="amber">Outdoor Elite</Badge> : null}
        {device.isGoveeGroup ? <Badge tone="info">Govee group</Badge> : null}
      </div>

      {device.isGoveeGroup ? null : <LightStrip color={look.color} lit={look.lit} on={look.on === true} live={look.live} count={22} />}

      <div className="flex flex-wrap gap-1.5">
        {device.isGoveeGroup ? null : <ConnectivityBadge device={device} />}
        {!missing && !device.isGoveeGroup ? <FreshnessBadge device={device} /> : null}
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs font-medium text-fg-4">{historical ? 'Last reported power' : 'Reported power'}</dt>
          <dd className="mt-0.5 font-medium">{power ?? (device.isGoveeGroup ? 'Not reported' : 'Unknown')}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-fg-4">{historical ? 'Last reported brightness' : 'Reported brightness'}</dt>
          <dd className="mt-0.5 font-medium">{brightness ?? (device.isGoveeGroup ? 'Not reported' : 'Unknown')}</dd>
        </div>
      </dl>

      {canPower && !missing ? (
        <div className="mt-auto grid grid-cols-2 gap-1.5 rounded-full border border-line bg-inset p-1">
          <Button
            variant={known && power === 'On' ? 'primary' : 'ghost'}
            icon={<Power className="size-4" aria-hidden />}
            aria-label={`Turn ${device.name} on`}
            {...(known ? { 'aria-pressed': power === 'On' } : {})}
            disabled={control.isPending}
            onClick={() => control.mutate({ kind: 'power', on: true })}
          >
            On
          </Button>
          <Button
            variant={known && power === 'Off' ? 'secondary' : 'ghost'}
            icon={<PowerOff className="size-4" aria-hidden />}
            aria-label={`Turn ${device.name} off`}
            {...(known ? { 'aria-pressed': power === 'Off' } : {})}
            disabled={control.isPending}
            onClick={() => control.mutate({ kind: 'power', on: false })}
          >
            Off
          </Button>
        </div>
      ) : null}

      {control.isPending ? (
        <p className="text-xs text-fg-3" role="status">
          Sending...
        </p>
      ) : null}
      {control.isError ? <ErrorNotice error={control.error} /> : null}
      {control.data ? <CommandResultLine command={control.data.command} /> : null}
    </article>
  );
}

/** The colours a preset paints, read from its steps. Nothing in a step, nothing to draw. */
function presetColors(preset: PresetDto): string[] {
  return preset.actions.flatMap((step) => ('hex' in step.action ? [step.action.hex] : []));
}

/** The presets the person has made, as tiles of the colours they paint. One tap applies one. */
function QuickScenes({ presets }: { presets: PresetDto[] }) {
  const [applying, setApplying] = useState<PresetDto | null>(null);
  return (
    <section aria-labelledby="scenes-heading">
      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 id="scenes-heading" className="font-display text-xl font-semibold tracking-tight">
          Saved presets
        </h2>
        <Link to="/presets" className="inline-flex items-center gap-1 text-sm font-medium text-accent-text hover:underline">
          Manage
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
      {presets.length === 0 ? (
        <div className="card rounded-3xl p-6 text-sm text-fg-3">
          No presets yet. Create one under{' '}
          <Link to="/presets" className="font-medium text-accent-text underline underline-offset-2">
            Scenes & Presets
          </Link>
          .
        </div>
      ) : (
        <ul className="snap-row">
          {presets.slice(0, 8).map((preset) => (
            <li key={preset.id} className="w-44">
              <button
                type="button"
                onClick={() => setApplying(preset)}
                className="tile group flex h-full w-full flex-col gap-4 rounded-3xl p-4 text-left"
              >
                <Spectrum colors={presetColors(preset)} height="h-10" />
                <span className="flex items-center gap-2 text-sm font-medium text-fg">
                  <Sparkles className="size-4 shrink-0 text-accent-ui transition-transform duration-300 group-hover:rotate-12" aria-hidden />
                  <span className="min-w-0 break-words">{preset.name}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {applying ? <ApplyPresetDialog preset={applying} onClose={() => setApplying(null)} /> : null}
    </section>
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
        <Link to="/connections" className="shrink-0 text-sm font-medium underline underline-offset-2">
          See what to try
        </Link>
      }
    />
  );
}

/** The greeting, how many lights are up, and the whole display drawn as one string of light. */
function Hero({
  devices,
  diagnostics,
  checking,
  onCheck,
}: {
  devices: DeviceDto[];
  diagnostics: DiagnosticsDto | undefined;
  checking: boolean;
  onCheck: () => void;
}) {
  const now = useNow();
  const date = new Date(now);
  const present = devices.filter((d) => d.discoveryStatus === 'present');
  const lights = present.filter((d) => !d.isGoveeGroup);
  const online = present.filter((d) => d.connectivity === 'online').length;
  const looks = lights.map(lookOfDevice);
  const reached = diagnostics?.govee.lastSuccessfulConnectionAt ?? null;

  return (
    <section
      aria-label="Overview"
      className="card relative overflow-hidden rounded-[2rem] p-6 sm:p-8"
      style={{ backgroundImage: 'radial-gradient(120% 140% at 0% 0%, color-mix(in oklab, var(--accent) 14%, transparent), transparent 55%)' }}
    >
      <div className="flex items-start justify-between gap-4 sm:items-center sm:gap-8">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-[0.14em] text-accent-text uppercase">{dayPart(date)}</p>
          <h1 className="sr-only">Dashboard</h1>
          <p aria-hidden className="mt-2 font-display text-3xl leading-tight font-semibold tracking-tight sm:text-5xl">
            <span className="text-spectrum">{greeting(date)}</span>
          </p>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-fg-3 sm:text-base">
            {reached
              ? `${present.length} device(s) discovered. ${online} reported online. Govee last reached ${timeAgo(reached)}.`
              : 'Your lights at a glance.'}
          </p>
          <div className="mt-5">
            <Button variant="primary" icon={<RefreshCw className="size-4" aria-hidden />} busy={checking} onClick={onCheck}>
              Check lights now
            </Button>
          </div>
        </div>
        {present.length > 0 ? <OnlineRing online={online} total={present.length} className="size-[4.75rem] sm:size-32" /> : null}
      </div>
      {looks.length > 0 ? <HouseStrip looks={looks} className="mt-8" /> : null}
    </section>
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

  return (
    <div className="space-y-6">
      <Hero devices={list} diagnostics={diagnostics.data} checking={checkAll.isPending} onCheck={() => checkAll.mutate()} />

      <div className="space-y-4">
        {diagnostics.data ? <ConnectionBanner diagnostics={diagnostics.data} /> : null}
        <ConnectionAlert />
        {diagnostics.data?.govee.usingLocalTestEndpoint ? (
          <Notice tone="warn" title="Test mode">
            Connected to a local test endpoint, not Govee. The devices below are test data.
          </Notice>
        ) : null}
        {checkAll.isError ? <ErrorNotice error={checkAll.error} title="Could not check the lights" /> : null}
        {checkAll.data ? <CheckResult result={checkAll.data} current={list} /> : null}
      </div>

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
        <section aria-label="Devices" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((device) => (
            <DeviceCard key={device.id} device={device} />
          ))}
        </section>
      ) : null}

      {list.length > 0 ? <MasterBrightness devices={list} /> : null}

      {presets.data ? <QuickScenes presets={presets.data.filter((preset) => !preset.builtin)} /> : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard
          title="Upcoming schedules"
          action={
            <Link to="/schedules" className="inline-flex items-center gap-1 text-sm font-medium text-accent-text hover:underline">
              Manage
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          }
        >
          {summary.data && summary.data.upcoming.length > 0 ? (
            <ul className="space-y-2.5">
              {summary.data.upcoming.map((item, index) => (
                <li
                  key={item.scheduleId}
                  className={`flex items-start gap-3 rounded-2xl p-3.5 text-sm ${index === 0 ? 'bg-accent-wash ring-1 ring-accent-ui/20' : 'bg-inset'}`}
                >
                  <span
                    className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full ${index === 0 ? 'bg-accent text-on-accent' : 'bg-raised text-fg-3'}`}
                  >
                    <CalendarClock className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium">{item.scheduleName}</p>
                    <p className="text-fg-3">
                      {item.actionSummary} <span className="text-fg-4">· {item.targetName}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-fg-4">
                      {item.run.local} · {timeAgo(item.run.at)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg-3">Nothing scheduled.</p>
          )}
        </SectionCard>

        <SectionCard
          title="Recent problems"
          action={
            <Link to="/activity" className="inline-flex items-center gap-1 text-sm font-medium text-accent-text hover:underline">
              All activity
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          }
        >
          {summary.data && summary.data.recentFailures.length > 0 ? (
            <ul className="space-y-2.5">
              {summary.data.recentFailures.map((event) => (
                <li key={event.id} className="flex items-start gap-3 rounded-2xl bg-inset p-3.5 text-sm">
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-bad-wash text-bad">
                    <TriangleAlert className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="break-words text-fg-2">{event.message}</p>
                    <p className="text-xs text-fg-4">{timeAgo(event.createdAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg-3">No recent failures.</p>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
