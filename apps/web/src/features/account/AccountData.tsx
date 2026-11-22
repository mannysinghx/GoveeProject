import { useState, type FormEvent } from 'react';
import { DELETE_CONFIRMATION } from '@glm/shared';
import { Badge, Button, ErrorNotice, Field, inputClass, Loading, Notice, SectionCard } from '../../components/ui';
import { dateTime } from '../../lib/format';
import { useModerateAccount } from '../sharing/queries';
import { useAdminAccounts, useDeleteAccount, useExportAccount, useSetAccountStatus } from './queries';

function PasswordField({ value, onChange, label = 'Current password' }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <Field label={label}>
      {(props) => (
        <input
          {...props}
          type="password"
          autoComplete="current-password"
          className={inputClass}
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

/** Download everything in the account, and, for anyone but the owner, delete it. */
export function AccountData({ canDelete }: { canDelete: boolean }) {
  const exporter = useExportAccount();
  const remover = useDeleteAccount();
  const [exportPassword, setExportPassword] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [typed, setTyped] = useState('');

  const exportData = (event: FormEvent) => {
    event.preventDefault();
    exporter.mutate(exportPassword, { onSettled: () => setExportPassword('') });
  };
  const deleteAccount = (event: FormEvent) => {
    event.preventDefault();
    if (typed !== DELETE_CONFIRMATION) return;
    remover.mutate(deletePassword, { onSettled: () => setDeletePassword('') });
  };

  return (
    <SectionCard title="Your data" description="A copy of everything in your account, as a JSON file. Keys and passwords are never in it.">
      <div className="space-y-6">
        <form onSubmit={exportData} className="max-w-md space-y-3">
          <PasswordField value={exportPassword} onChange={setExportPassword} />
          {exporter.isError ? <ErrorNotice error={exporter.error} /> : null}
          {exporter.isSuccess ? <Notice tone="good">Saved {exporter.data}.</Notice> : null}
          <Button type="submit" busy={exporter.isPending}>
            Download my data
          </Button>
        </form>

        {canDelete ? (
          <form onSubmit={deleteAccount} className="max-w-md space-y-3 border-t border-ink-700 pt-5">
            <h3 className="text-sm font-semibold text-bad">Delete my account</h3>
            <p className="text-sm text-ink-300">
              Deletes your sign-in, your keys, and every light, group, preset, schedule and record in your account. It cannot be
              undone. Download your data first if you want a copy.
            </p>
            <PasswordField value={deletePassword} onChange={setDeletePassword} />
            <Field label={`Type ${DELETE_CONFIRMATION} to confirm`}>
              {(props) => (
                <input {...props} className={inputClass} autoComplete="off" required value={typed} onChange={(e) => setTyped(e.target.value)} />
              )}
            </Field>
            {remover.isError ? <ErrorNotice error={remover.error} /> : null}
            <Button type="submit" variant="danger" busy={remover.isPending} disabled={typed !== DELETE_CONFIRMATION}>
              Delete my account
            </Button>
          </form>
        ) : null}
      </div>
    </SectionCard>
  );
}

/** For the owner: everyone with an account, and suspending or reactivating them. */
export function AdminAccounts() {
  const list = useAdminAccounts();
  const setStatus = useSetAccountStatus();
  const moderate = useModerateAccount();
  return (
    <SectionCard title="Accounts" description="Only you see this. Suspending signs a person out and stops their schedules until you reactivate them.">
      {list.isPending ? <Loading label="Loading accounts" /> : null}
      {list.isError ? <ErrorNotice error={list.error} /> : null}
      {list.data ? (
        <ul className="space-y-2">
          {list.data.accounts.map((account) => (
            <li key={account.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-ink-850 p-3 text-sm">
              <span className="min-w-0 truncate font-medium text-ink-100">{account.email ?? `Account ${account.id}`}</span>
              {account.role === 'owner' ? <Badge tone="amber">You</Badge> : null}
              {account.status === 'suspended' ? <Badge tone="warn">Suspended</Badge> : null}
              {account.displayName ? <Badge>{account.displayName}</Badge> : null}
              {account.sharingBlocked ? <Badge tone="warn">Sharing off</Badge> : null}
              <span className="w-full text-xs text-ink-400">
                Joined {dateTime(account.createdAt)}. Last sign-in {account.lastSignInAt ? dateTime(account.lastSignInAt) : 'never'}.{' '}
                {account.goveeConnected ? 'Govee key connected' : 'No Govee key'}
                {account.devices !== null ? `, ${account.devices} light(s)` : ''}, {account.aiKeys} AI key(s).
              </span>
              {account.role === 'member' ? (
                <Button
                  size="sm"
                  variant={account.status === 'active' ? 'danger' : 'secondary'}
                  busy={setStatus.isPending && setStatus.variables?.id === account.id}
                  onClick={() => setStatus.mutate({ id: account.id, status: account.status === 'active' ? 'suspended' : 'active' })}
                >
                  {account.status === 'active' ? 'Suspend' : 'Reactivate'}
                </Button>
              ) : null}
              {account.role === 'member' ? (
                <Button size="sm" variant="ghost" busy={moderate.block.isPending && moderate.block.variables?.id === account.id} onClick={() => moderate.block.mutate({ id: account.id, blocked: !account.sharingBlocked })}>
                  {account.sharingBlocked ? 'Allow sharing' : 'Stop sharing'}
                </Button>
              ) : null}
              {account.role === 'member' && account.displayName ? (
                <Button size="sm" variant="ghost" busy={moderate.resetName.isPending && moderate.resetName.variables === account.id} onClick={() => moderate.resetName.mutate(account.id)}>
                  Reset name
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {setStatus.isError ? <ErrorNotice error={setStatus.error} /> : null}
      {moderate.block.isError ? <ErrorNotice error={moderate.block.error} /> : null}
      {moderate.resetName.isError ? <ErrorNotice error={moderate.resetName.error} /> : null}
    </SectionCard>
  );
}
