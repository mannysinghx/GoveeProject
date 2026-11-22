import { ExternalLink } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { GOVEE_KEY_HELP_URL } from '@glm/shared';
import { Button, ErrorNotice, Field, inputClass, Loading, Notice, SectionCard } from '../../components/ui';
import { dateTime } from '../../lib/format';
import { useConnectGovee, useGoveeKey, useRemoveGovee } from './queries';

export const GOVEE_KEY_HELP = GOVEE_KEY_HELP_URL;

function HowToGetKey() {
  return (
    <a href={GOVEE_KEY_HELP} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">
      How to get a key
      <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}

/**
 * Sends a key once to be checked with Govee and stored encrypted. The field is emptied and the
 * request forgotten afterwards, whether it worked or not, so the key is not left in the page.
 */
export function GoveeKeyForm({ replacing = false, onConnected }: { replacing?: boolean; onConnected?: () => void }) {
  const connect = useConnectGovee();
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<unknown>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    connect.mutate(apiKey.trim(), {
      onSettled: (_data, failure) => {
        setApiKey('');
        setError(failure ?? null);
        connect.reset();
        if (!failure) onConnected?.();
      },
    });
  };

  return (
    <form onSubmit={submit} className="max-w-md space-y-3">
      <Field label={replacing ? 'New Govee API key' : 'Govee API key'} hint={<HowToGetKey />}>
        {(props) => (
          <input
            {...props}
            type="password"
            autoComplete="off"
            spellCheck={false}
            className={`${inputClass} font-mono`}
            required
            minLength={8}
            maxLength={200}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        )}
      </Field>
      {error ? <ErrorNotice error={error} title="The key was not connected" /> : null}
      <Button type="submit" variant="primary" busy={connect.isPending}>
        {connect.isPending ? 'Checking with Govee…' : replacing ? 'Replace key' : 'Connect'}
      </Button>
    </form>
  );
}

/** Settings: whether a key is connected, and connecting, replacing or removing it. The key is never shown. */
export function GoveeKeySettings() {
  const status = useGoveeKey();
  const remove = useRemoveGovee();
  const [replacing, setReplacing] = useState(false);

  return (
    <SectionCard title="Govee API key" description="Lets this app reach your lights through Govee. It is checked with Govee, then stored encrypted, and never shown again.">
      {status.isPending ? <Loading label="Loading" /> : null}
      {status.isError ? <ErrorNotice error={status.error} /> : null}
      {status.data ? (
        <div className="space-y-4">
          {status.data.source === 'server' ? (
            <Notice tone="good">
              Your key is set in the app&apos;s hosting settings. Change it there. Applying for a new key in the Govee app may
              replace the old one.
            </Notice>
          ) : status.data.connected ? (
            <Notice tone="good">Connected{status.data.connectedAt ? ` on ${dateTime(status.data.connectedAt)}` : ''}.</Notice>
          ) : (
            <Notice tone="warn">No key is connected, so your lights cannot be reached.</Notice>
          )}
          {status.data.note && status.data.source !== 'server' ? <Notice tone="info">{status.data.note}</Notice> : null}
          {status.data.canChange ? (
            status.data.connected && !replacing ? (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setReplacing(true)}>Replace key</Button>
                <Button variant="danger" busy={remove.isPending} onClick={() => remove.mutate()}>
                  Remove key
                </Button>
              </div>
            ) : (
              <GoveeKeyForm replacing={status.data.connected} onConnected={() => setReplacing(false)} />
            )
          ) : null}
          {remove.isError ? <ErrorNotice error={remove.error} /> : null}
        </div>
      ) : null}
    </SectionCard>
  );
}
