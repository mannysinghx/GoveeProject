import { CheckCircle2, ExternalLink, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, ErrorNotice, Loading, Notice, PageHeader } from '../../components/ui';
import { useDiagnostics, useDiscover } from '../../lib/queries';

/** Final setup step: confirms the server has a key and that Govee answers. Also reachable later. */
export function ConnectPage() {
  const diagnostics = useDiagnostics();
  const discover = useDiscover();

  if (diagnostics.isPending) return <Loading />;
  if (diagnostics.isError) return <ErrorNotice error={diagnostics.error} />;
  const { govee } = diagnostics.data;

  return (
    <>
      <PageHeader
        title="Connect to Govee"
        description="This asks Govee for your device list using the key configured on the server."
      />
      <Card className="max-w-2xl space-y-4 p-5">
        {govee.keyConfigured ? (
          <Notice tone="good" title="An API key is configured on the server">
            The key stays on the server. This page can only tell you whether one is set.
          </Notice>
        ) : (
          <Notice tone="warn" title="No API key is configured yet">
            Add <code className="font-mono">GOVEE_API_KEY=your-key</code> to the <code className="font-mono">.env</code>{' '}
            file on the server, then restart the app.{' '}
            <a
              href="https://developer.govee.com/reference/apply-you-govee-api-key"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 underline underline-offset-2"
            >
              How to get a key
              <ExternalLink className="size-3" aria-hidden />
            </a>
          </Notice>
        )}

        {govee.usingLocalTestEndpoint ? (
          <Notice tone="warn" title="Test mode">
            This server points at a local test endpoint, not the Govee cloud. Nothing here says anything about real
            lights.
          </Notice>
        ) : null}

        <Button
          variant="primary"
          icon={<RefreshCw className="size-4" aria-hidden />}
          busy={discover.isPending}
          disabled={!govee.keyConfigured}
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
            <Link to="/" className="inline-block text-sm text-amber-soft underline underline-offset-2">
              Go to the dashboard
            </Link>
          </div>
        ) : null}
      </Card>
    </>
  );
}
