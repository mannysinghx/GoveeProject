import { CheckCircle2, ExternalLink, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, ErrorNotice, Loading, Notice, PageHeader } from '../../components/ui';
import { useDiagnostics, useDiscover, useSettings, useUpdateSettings } from '../../lib/queries';
import { GOVEE_KEY_HELP, GoveeKeyForm } from '../account/GoveeKey';
import { GoveeKeySteps } from '../account/KeyGuide';
import { useGoveeKey } from '../account/queries';
import { useSession } from '../auth/useSession';

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-100">
        <span className="flex size-6 items-center justify-center rounded-full bg-ink-800 text-xs text-amber-soft">{number}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * Getting started: connect a Govee key, find the lights, and, for a new account, the few
 * choices worth making first. Also reachable later from the dashboard.
 */
export function ConnectPage() {
  const diagnostics = useDiagnostics();
  const key = useGoveeKey();
  const discover = useDiscover();
  const settings = useSettings();
  const updateSettings = useUpdateSettings();
  const isMember = useSession().data?.role === 'member';
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  if (diagnostics.isPending || key.isPending) return <Loading />;
  if (diagnostics.isError) return <ErrorNotice error={diagnostics.error} />;
  if (key.isError) return <ErrorNotice error={key.error} />;
  const { govee } = diagnostics.data;
  const status = key.data;

  return (
    <>
      <PageHeader title="Connect to Govee" description="Connect your Govee API key, then find your lights." />
      <Card className="max-w-2xl space-y-6 p-5">
        <Step number={1} title="Your Govee API key">
          {govee.keyConfigured ? (
            <Notice tone="good" title={status.source === 'server' ? 'A key is set on the server' : 'Your key is connected'}>
              It is never shown here or sent to this browser. To change it, go to Settings.
            </Notice>
          ) : status.canChange ? (
            <>
              <div className="space-y-2 text-sm text-ink-300">
                <GoveeKeySteps />
                <p>Paste it below. It is checked with Govee before it is saved, and stored encrypted.</p>
              </div>
              <GoveeKeyForm onConnected={() => discover.mutate()} />
            </>
          ) : (
            <Notice tone="warn" title="A key cannot be connected here yet">
              {status.note ?? 'This server cannot store keys.'}{' '}
              {!isMember ? (
                <>
                  Or add <code className="font-mono">GOVEE_API_KEY=your-key</code> to the server&apos;s environment and restart.{' '}
                </>
              ) : null}
              <a href={GOVEE_KEY_HELP} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">
                How to get a key
                <ExternalLink className="size-3" aria-hidden />
              </a>
            </Notice>
          )}
        </Step>

        <Step number={2} title="Find your lights">
          {govee.usingLocalTestEndpoint ? (
            <Notice tone="warn" title="Test mode">
              This server points at a local test endpoint, not the Govee cloud. Nothing here says anything about real lights.
            </Notice>
          ) : null}
          <Button
            variant="primary"
            icon={<RefreshCw className="size-4" aria-hidden />}
            busy={discover.isPending}
            disabled={!govee.keyConfigured && !discover.isPending}
            onClick={() => discover.mutate()}
          >
            Test connection and find devices
          </Button>
          {discover.isError ? <ErrorNotice error={discover.error} title="The connection test failed" /> : null}
          {discover.data ? (
            <div className="space-y-3">
              <Notice tone="good" title={`Connected. Govee returned ${discover.data.total} device(s).`}>
                {discover.data.total === 0
                  ? 'Your account has no supported devices. Add your lights in the Govee Home app, then try again.'
                  : 'Being in this list does not mean a device is online. Open one to check its status.'}
              </Notice>
              {discover.data.devices.length > 0 ? (
                <ul className="space-y-2">
                  {discover.data.devices.map((device) => (
                    <li key={device.id}>
                      <Link
                        to={`/devices/${device.id}`}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-ink-850 p-3 hover:bg-ink-800"
                      >
                        <span className="font-medium">{device.name}</span>
                        <span className="flex items-center gap-2 text-sm text-ink-300">
                          {device.sku}
                          {device.isPrimaryModel ? (
                            <Badge tone="amber" icon={<CheckCircle2 className="size-3" aria-hidden />}>
                              Permanent Outdoor Lights Elite
                            </Badge>
                          ) : null}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </Step>

        {isMember ? (
          <>
            <Step number={3} title="Your time zone">
              <p className="text-sm text-ink-300">
                Schedules use {settings.data ? <span className="font-medium text-ink-100">{settings.data.defaultTimeZone}</span> : 'your time zone'}.{' '}
                <Link to="/settings" className="text-amber-soft underline underline-offset-2">
                  Change it in Settings
                </Link>{' '}
                if that is not where your lights are.
              </p>
              {settings.data && browserZone && settings.data.defaultTimeZone !== browserZone ? (
                <Button busy={updateSettings.isPending} onClick={() => updateSettings.mutate({ defaultTimeZone: browserZone })}>
                  Use {browserZone}, this browser&apos;s time zone
                </Button>
              ) : null}
              {updateSettings.isError ? <ErrorNotice error={updateSettings.error} /> : null}
            </Step>
            <Step number={4} title="Holiday shows">
              <p className="text-sm text-ink-300">
                Light shows for holidays such as Diwali, Christmas and New Year are set up for your lights, switched off. Nothing
                runs until you turn on the ones you want in{' '}
                <Link to="/schedules" className="text-amber-soft underline underline-offset-2">
                  Schedules
                </Link>
                .
              </p>
            </Step>
            <Step number={5} title="AI, if you want it">
              <p className="text-sm text-ink-300">
                Ask and Describe use an AI provider with your own key, and are off without one. Add a key in{' '}
                <Link to="/settings" className="text-amber-soft underline underline-offset-2">
                  Settings, under AI
                </Link>
                .
              </p>
            </Step>
          </>
        ) : null}

        <Link to="/" className="inline-block text-sm text-amber-soft underline underline-offset-2">
          Go to the dashboard
        </Link>
      </Card>
    </>
  );
}
