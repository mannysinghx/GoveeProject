import { ArrowLeft, RefreshCw } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { ConnectivityBadge, FreshnessBadge } from '../../components/status';
import { LightStrip, lookOfDevice } from '../../components/light';
import { Badge, Button, Detail, ErrorNotice, Loading, Notice, SectionCard } from '../../components/ui';
import { dateTime, timeAgo } from '../../lib/format';
import { useDevice, useRefreshDevice } from '../../lib/queries';
import { CapabilityPanel } from './CapabilityPanel';
import { CommandHistory, PendingCommands } from './CommandPanels';
import { DeviceControls } from './DeviceControls';
import { ReportedStatePanel } from './ReportedStatePanel';

export function DeviceDetailPage() {
  const { id = '' } = useParams();
  const device = useDevice(id);
  const refresh = useRefreshDevice(id);

  if (device.isPending) return <Loading label="Loading device" />;
  if (device.isError) {
    return (
      <>
        <Link to="/" className="mb-4 inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-fg-3 hover:text-fg">
          <ArrowLeft className="size-4" aria-hidden />
          Dashboard
        </Link>
        <ErrorNotice error={device.error} title="Could not load this device" />
      </>
    );
  }

  const d = device.data;
  const missing = d.discoveryStatus === 'missing';
  const look = lookOfDevice(d);

  return (
    <>
      <Link to="/" className="mb-4 inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-fg-3 hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden />
        Dashboard
      </Link>
      <header
        className="card mb-6 overflow-hidden rounded-[2rem] p-6 sm:p-8"
        style={{ backgroundImage: 'radial-gradient(110% 150% at 0% 0%, color-mix(in oklab, var(--accent) 13%, transparent), transparent 60%)' }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-[0.14em] text-accent-text uppercase">{d.sku}</p>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">{d.name}</h1>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <ConnectivityBadge device={d} />
              {!missing ? <FreshnessBadge device={d} /> : null}
              {d.isPrimaryModel ? <Badge tone="amber">Permanent Outdoor Lights Elite</Badge> : null}
            </div>
          </div>
          <Button
            icon={<RefreshCw className="size-4" aria-hidden />}
            busy={refresh.isPending}
            disabled={missing}
            onClick={() => refresh.mutate()}
          >
            Refresh status
          </Button>
        </div>
        {d.isGoveeGroup ? null : (
          <LightStrip className="mt-7" color={look.color} lit={look.lit} on={look.on === true} live={look.live} count={44} size="0.7rem" />
        )}
      </header>

      <div className="space-y-6">
        {missing ? (
          <Notice tone="warn" title="Govee no longer lists this device">
            It was last listed {dateTime(d.lastDiscoveredAt)}. Its history, presets and schedules are kept, but it cannot
            be controlled. If it was re-added in the Govee app, press Check lights now on the dashboard.
          </Notice>
        ) : null}

        {d.connectivity === 'offline' ? (
          <Notice tone="warn" title="Govee reports this device as offline">
            Values below are historical. Commands may be accepted by Govee and still not reach the lights. Last seen online:{' '}
            {d.lastOnlineAt ? dateTime(d.lastOnlineAt) : 'never, in this app'}.
          </Notice>
        ) : null}

        {d.connectivity === 'checking' ? (
          <Notice tone="warn" title="Govee reported this device as offline once">
            The app is asking again before calling it offline, because a single answer is sometimes wrong. Values below
            may be out of date until then.
          </Notice>
        ) : null}

        {d.isGoveeGroup ? (
          <Notice title="This is a group made in the Govee Home app">
            Govee does not provide status for groups, so what the lights are doing is not reported here, and commands cannot
            show as confirmed. To check on each light, open it from the dashboard. A group in this app can include the
            individual lights instead.
          </Notice>
        ) : null}

        {d.lastStatusError && !d.isGoveeGroup ? (
          <Notice tone="warn" title="The last status refresh failed">
            {d.lastStatusError.message} ({timeAgo(d.lastStatusError.at)}). Values below are from the last successful report.
          </Notice>
        ) : null}

        {refresh.isError ? <ErrorNotice error={refresh.error} title="Could not refresh status" /> : null}
        {refresh.data?.throttled ? (
          <Notice>Refreshed moments ago, so the app reused that report instead of asking Govee again.</Notice>
        ) : null}

        <PendingCommands commands={d.pendingCommands} />

        {!missing ? <DeviceControls device={d} /> : null}

        <div className="grid gap-6 lg:grid-cols-2">
          <ReportedStatePanel device={d} />
          <SectionCard title="Device">
            <dl className="grid grid-cols-2 gap-4">
              <Detail label="Model (SKU)">{d.sku}</Detail>
              <Detail label="Type">{d.deviceType?.replace('devices.types.', '') ?? 'Not reported'}</Detail>
              <div className="col-span-2">
                <Detail label="Device identifier">
                  <code className="font-mono text-xs">{d.goveeDeviceId}</code>
                </Detail>
              </div>
              <Detail label="Last discovered">{dateTime(d.lastDiscoveredAt)}</Detail>
              <Detail label="Last status refresh">{dateTime(d.lastStatusRefreshAt)}</Detail>
              <Detail label="Last request">{dateTime(d.lastRequestAt)}</Detail>
              <Detail label="Last accepted by Govee">{dateTime(d.lastAcceptedAt)}</Detail>
              <Detail label="Last seen online">{dateTime(d.lastOnlineAt)}</Detail>
            </dl>
          </SectionCard>
        </div>

        <CapabilityPanel capabilities={d.capabilities} rawCapabilities={d.rawCapabilities} />
        <CommandHistory commands={d.recentCommands} />
      </div>
    </>
  );
}
