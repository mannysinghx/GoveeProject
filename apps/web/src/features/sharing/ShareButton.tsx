import { Share2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { SHARE_LIMITS, type SharedItemDto, type SharedKind } from '@glm/shared';
import { Button, Dialog, ErrorNotice, Field, inputClass, Notice } from '../../components/ui';
import { useSession } from '../auth/useSession';
import { useSetDisplayName, useShare, useShared, useStopSharing, useUpdateShare } from './queries';

const KIND_WORD: Record<SharedKind, string> = { preset: 'preset', group: 'group', schedule: 'schedule' };

/** Asks for a public display name, the first time a member shares. */
export function DisplayNameForm({ current, onDone }: { current: string | null; onDone?: () => void }) {
  const save = useSetDisplayName();
  const [name, setName] = useState(current ?? '');
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(name.trim(), { onSuccess: () => onDone?.() });
      }}
    >
      <Field label="Display name" hint="Shown on what you share. Your email address is never shown.">
        {(props) => <input {...props} className={inputClass} required minLength={3} maxLength={30} value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
      {save.isError ? <ErrorNotice error={save.error} /> : null}
      <Button type="submit" busy={save.isPending}>
        {current ? 'Change name' : 'Save name'}
      </Button>
    </form>
  );
}

/** After sharing: the lights it uses, which can be renamed for everyone to see. */
function SlotNames({ item }: { item: SharedItemDto }) {
  const update = useUpdateShare();
  const [labels, setLabels] = useState<Record<string, string>>(Object.fromEntries(item.slots.map((s) => [s.key, s.label])));
  if (item.slots.length === 0) return null;
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate({ id: item.id, slotLabels: labels, refresh: false });
      }}
    >
      <p className="text-sm text-fg-3">The lights it uses are shown with these names. Your own light names are not shared.</p>
      {item.slots.map((slot) => (
        <Field key={slot.key} label={`${slot.sku}, ${slot.segmentCount} segments`}>
          {(props) => (
            <input
              {...props}
              className={inputClass}
              maxLength={SHARE_LIMITS.slotLabelMax}
              value={labels[slot.key] ?? ''}
              onChange={(e) => setLabels((current) => ({ ...current, [slot.key]: e.target.value }))}
            />
          )}
        </Field>
      ))}
      {update.isError ? <ErrorNotice error={update.error} /> : null}
      {update.isSuccess ? <Notice tone="good">Names saved.</Notice> : null}
      <Button type="submit" size="sm" busy={update.isPending}>
        Save names
      </Button>
    </form>
  );
}

/**
 * Shares one preset, group or schedule with everyone, or updates or stops a share. What is
 * shared is a copy taken now: later changes to the original are shared only with Update.
 */
export function ShareButton({ kind, sourceId, name }: { kind: SharedKind; sourceId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const session = useSession();
  const shared = useShared();
  const share = useShare();
  const update = useUpdateShare();
  const stop = useStopSharing();
  const [title, setTitle] = useState(name);
  const [description, setDescription] = useState('');
  const existing = shared.data?.items.find((item) => item.mine && item.kind === kind && item.sourceId === sourceId) ?? null;
  const isOwner = session.data?.role === 'owner';
  const needsName = !isOwner && shared.data !== undefined && !shared.data.displayName;
  const latest = share.data ?? update.data ?? existing;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    share.mutate({ kind, sourceId, title: title.trim(), description: description.trim() });
  };

  return (
    <>
      <Button size="sm" variant="ghost" icon={<Share2 className="size-4" aria-hidden />} onClick={() => setOpen(true)}>
        {existing ? 'Shared' : 'Share'}
      </Button>
      <Dialog title={`Share ${KIND_WORD[kind]}`} open={open} onClose={() => setOpen(false)}>
        <div className="space-y-4">
          {shared.data && !shared.data.canShare ? <Notice tone="warn">Sharing is turned off for your account.</Notice> : null}
          {needsName ? (
            <DisplayNameForm current={null} />
          ) : existing || share.data ? (
            <>
              <Notice tone="good" title="Shared with everyone">
                People can import a copy into their own account, onto their own lights. Changes you make to the original are not
                shared until you update the share.
              </Notice>
              {existing?.hidden ? <Notice tone="warn">The owner has hidden this from the Shared space.</Notice> : null}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" busy={update.isPending} onClick={() => latest && update.mutate({ id: latest.id })}>
                  Update share
                </Button>
                <Button size="sm" variant="danger" busy={stop.isPending} onClick={() => latest && stop.mutate(latest.id, { onSuccess: () => share.reset() })}>
                  Stop sharing
                </Button>
              </div>
              {update.isSuccess ? <Notice tone="good">Updated with the latest version.</Notice> : null}
              {update.isError ? <ErrorNotice error={update.error} /> : null}
              {stop.isError ? <ErrorNotice error={stop.error} /> : null}
              {latest ? <SlotNames key={latest.id + latest.updatedAt} item={latest} /> : null}
            </>
          ) : (
            <form className="space-y-3" onSubmit={submit}>
              <p className="text-sm text-fg-3">
                Everyone with an account can see it in Shared{isOwner ? ', under Light Manager' : `, as made by ${shared.data?.displayName ?? 'you'}`}, and
                import a copy. Your lights, their names and your location are not shared.
              </p>
              <Field label="Title">
                {(props) => <input {...props} className={inputClass} required maxLength={SHARE_LIMITS.titleMax} value={title} onChange={(e) => setTitle(e.target.value)} />}
              </Field>
              <Field label="Description" hint="Optional. Links are not allowed.">
                {(props) => (
                  <textarea {...props} className={`${inputClass} min-h-20 py-2`} maxLength={SHARE_LIMITS.descriptionMax} value={description} onChange={(e) => setDescription(e.target.value)} />
                )}
              </Field>
              {share.isError ? <ErrorNotice error={share.error} title="It was not shared" /> : null}
              <Button type="submit" variant="primary" busy={share.isPending} disabled={shared.data ? !shared.data.canShare : false}>
                Share with everyone
              </Button>
            </form>
          )}
        </div>
      </Dialog>
    </>
  );
}

/** "Imported from …", on what came from the Shared space. */
export function ImportedBadge({ from }: { from: string | null | undefined }) {
  if (!from) return null;
  return <span className="self-start rounded-full border border-line bg-inset px-2 py-0.5 text-xs text-fg-3">Imported from {from}</span>;
}
