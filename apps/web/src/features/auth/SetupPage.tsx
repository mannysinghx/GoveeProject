import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, KeyRound, Lightbulb, Smartphone } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, ErrorNotice, Field, inputClass } from '../../components/ui';
import { api } from '../../lib/api';
import { keys } from '../../lib/queries';
import { PASSWORD_MIN_LENGTH, useSetup } from './useSession';

const API_KEY_DOCS = 'https://developer.govee.com/reference/apply-you-govee-api-key';

function Welcome({ onContinue }: { onContinue: () => void }) {
  return (
    <>
      <h1 className="text-xl font-semibold">Welcome to Light Manager</h1>
      <p className="mt-2 text-sm text-ink-300">
        This app runs on your own computer and controls your Govee lights through the official Govee API. Before you
        start, you need two things.
      </p>
      <ol className="mt-5 space-y-4">
        <li className="flex gap-3">
          <Smartphone className="mt-0.5 size-5 shrink-0 text-amber-glow" aria-hidden />
          <div>
            <p className="font-medium">Add your lights in the Govee Home app</p>
            <p className="mt-0.5 text-sm text-ink-300">
              This app can only see lights already linked to your Govee account.
            </p>
          </div>
        </li>
        <li className="flex gap-3">
          <KeyRound className="mt-0.5 size-5 shrink-0 text-amber-glow" aria-hidden />
          <div>
            <p className="font-medium">Get a Govee developer API key</p>
            <p className="mt-0.5 text-sm text-ink-300">
              In the Govee Home app, open Settings and choose Apply for API Key.{' '}
              <a
                href={API_KEY_DOCS}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-amber-soft underline underline-offset-2"
              >
                Govee's instructions
                <ExternalLink className="size-3" aria-hidden />
              </a>
            </p>
            <p className="mt-2 text-sm text-ink-300">
              Set it on the server as <code className="font-mono text-ink-100">GOVEE_API_KEY</code> in your{' '}
              <code className="font-mono text-ink-100">.env</code> file, then restart the app. You never paste the key
              into this browser.
            </p>
          </div>
        </li>
      </ol>
      <Button variant="primary" className="mt-6 w-full" onClick={onContinue}>
        Create the owner account
      </Button>
    </>
  );
}

function OwnerForm({ setupCodeRequired }: { setupCodeRequired: boolean }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const setup = useSetup();
  const navigate = useNavigate();
  const client = useQueryClient();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    if (password.length < PASSWORD_MIN_LENGTH) {
      setLocalError(`Use at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setLocalError('The two passwords do not match.');
      return;
    }
    setup.mutate(
      { username, password, ...(setupCodeRequired ? { setupCode } : {}) },
      {
        onSuccess: () => {
          // Schedules should default to this browser's zone rather than the server's.
          const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
          void api('/settings', { method: 'PATCH', body: { defaultTimeZone: zone } })
            .catch(() => undefined)
            .finally(() => client.invalidateQueries({ queryKey: keys.settings }));
          navigate('/connect', { replace: true });
        },
      },
    );
  };

  return (
    <>
      <h1 className="text-xl font-semibold">Create the owner account</h1>
      <p className="mt-2 text-sm text-ink-300">
        This is the only account. It stays on this server and needs no email or outside sign-in. It can only be created
        once.
      </p>
      <form onSubmit={submit} className="mt-5 space-y-4">
        {setupCodeRequired ? (
          <Field
            label="Setup code"
            hint="This app is reachable from other computers, so a code is required. Find it in the server log, or use your SETUP_TOKEN."
          >
            {(props) => (
              <input
                {...props}
                className={`${inputClass} font-mono`}
                autoComplete="off"
                required
                value={setupCode}
                onChange={(e) => setSetupCode(e.target.value)}
              />
            )}
          </Field>
        ) : null}
        <Field label="Username">
          {(props) => (
            <input
              {...props}
              className={inputClass}
              autoComplete="username"
              required
              maxLength={64}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          )}
        </Field>
        <Field label="Password" hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}>
          {(props) => (
            <input
              {...props}
              className={inputClass}
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <Field label="Confirm password">
          {(props) => (
            <input
              {...props}
              className={inputClass}
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          )}
        </Field>
        {localError ? <p role="alert" className="text-sm text-bad">{localError}</p> : null}
        {setup.isError ? <ErrorNotice error={setup.error} /> : null}
        <Button type="submit" variant="primary" className="w-full" busy={setup.isPending}>
          Create account
        </Button>
      </form>
    </>
  );
}

export function SetupPage({ setupCodeRequired }: { setupCodeRequired: boolean }) {
  const [step, setStep] = useState<'welcome' | 'owner'>('welcome');
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-lg p-6">
        <div className="mb-5 flex items-center gap-2 text-sm text-ink-400">
          <Lightbulb className="size-4 text-amber-glow" aria-hidden />
          First-time setup, step {step === 'welcome' ? '1' : '2'} of 3
        </div>
        {step === 'welcome' ? (
          <Welcome onContinue={() => setStep('owner')} />
        ) : (
          <OwnerForm setupCodeRequired={setupCodeRequired} />
        )}
      </Card>
    </main>
  );
}
