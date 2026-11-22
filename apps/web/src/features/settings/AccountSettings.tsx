import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import type { SignupSettingsDto, SignupSettingsUpdate } from '@glm/shared';
import { Button, ErrorNotice, Field, inputClass, Loading, Notice, SectionCard } from '../../components/ui';
import { api } from '../../lib/api';
import { keys } from '../../lib/queries';
import { useChangeEmail, useSession } from '../auth/useSession';

/** The address this person signs in with, and changing it, verified at the new address. */
export function EmailSettings() {
  const session = useSession();
  const change = useChangeEmail();
  const [newEmail, setNewEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const current = session.data?.email ?? null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    change.mutate(
      { newEmail, currentPassword },
      {
        onSuccess: () => {
          setSentTo(newEmail.trim());
          setNewEmail('');
          setCurrentPassword('');
        },
      },
    );
  };

  return (
    <SectionCard
      title="Sign-in email"
      description={
        current
          ? `You sign in with ${current}. A new address is used only after you confirm it from its inbox.`
          : 'Add an address to sign in with it, and to reset your password by email.'
      }
    >
      <form onSubmit={submit} className="max-w-md space-y-4">
        <Field label={current ? 'New email' : 'Email'}>
          {(props) => (
            <input
              {...props}
              type="email"
              autoComplete="email"
              maxLength={254}
              className={inputClass}
              required
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
          )}
        </Field>
        <Field label="Current password">
          {(props) => (
            <input
              {...props}
              type="password"
              autoComplete="current-password"
              className={inputClass}
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          )}
        </Field>
        {change.isError ? <ErrorNotice error={change.error} /> : null}
        {sentTo ? (
          <Notice tone="good">
            If {sentTo} can be used, a link to confirm it is on its way. Nothing changes until you open it and confirm.
          </Notice>
        ) : null}
        <Button type="submit" busy={change.isPending}>
          {current ? 'Change email' : 'Add email'}
        </Button>
      </form>
    </SectionCard>
  );
}

const signupKey = ['admin', 'signup'] as const;

/** For the owner: whether strangers can sign up, and how many. */
export function SignupSettings() {
  const client = useQueryClient();
  const settings = useQuery({ queryKey: signupKey, queryFn: () => api<SignupSettingsDto>('/admin/signup') });
  const update = useMutation({
    mutationFn: (body: SignupSettingsUpdate) => api<SignupSettingsDto>('/admin/signup', { method: 'PATCH', body }),
    onSuccess: (data) => {
      client.setQueryData(signupKey, data);
      void client.invalidateQueries({ queryKey: keys.session });
    },
  });
  const [dailyCap, setDailyCap] = useState('');
  const [totalCap, setTotalCap] = useState('');
  useEffect(() => {
    if (!settings.data) return;
    setDailyCap(String(settings.data.dailyCap));
    setTotalCap(String(settings.data.totalCap));
  }, [settings.data]);

  if (settings.isPending) return <Loading label="Loading sign-up settings" />;
  if (settings.isError) return <ErrorNotice error={settings.error} />;
  const data = settings.data;

  return (
    <SectionCard title="Sign-up" description="Only you see this. People who sign up get their own, separate account.">
      <div className="space-y-4">
        {!data.mailConfigured ? (
          <Notice tone="warn">
            Email is not set up yet, so sign-up cannot be turned on.
          </Notice>
        ) : null}
        <p className="text-sm text-ink-300">
          {data.enabled ? 'Sign-up is on.' : 'Sign-up is off.'} {data.createdLastDay} accounts made in the last day,{' '}
          {data.createdTotal} in total. {data.mailQueued} emails waiting, {data.mailFailedLastDay} not delivered in the last day.
        </p>
        <Button
          variant={data.enabled ? 'secondary' : 'primary'}
          busy={update.isPending}
          disabled={!data.enabled && !data.mailConfigured}
          onClick={() => update.mutate({ enabled: !data.enabled })}
        >
          {data.enabled ? 'Turn sign-up off' : 'Turn sign-up on'}
        </Button>
        <form
          className="flex max-w-md flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            update.mutate({ dailyCap: Number(dailyCap), totalCap: Number(totalCap) });
          }}
        >
          <Field label="New accounts a day">
            {(props) => (
              <input {...props} type="number" min={0} className={`${inputClass} w-32`} required value={dailyCap} onChange={(e) => setDailyCap(e.target.value)} />
            )}
          </Field>
          <Field label="Accounts in total">
            {(props) => (
              <input {...props} type="number" min={0} className={`${inputClass} w-32`} required value={totalCap} onChange={(e) => setTotalCap(e.target.value)} />
            )}
          </Field>
          <Button type="submit" busy={update.isPending}>
            Save limits
          </Button>
        </form>
        {update.isError ? <ErrorNotice error={update.error} /> : null}
      </div>
    </SectionCard>
  );
}
