import { useState } from 'react';
import { Badge, Button, ErrorNotice, Loading, SectionCard } from '../../components/ui';
import { dateTime } from '../../lib/format';
import { useAdminShared, useModerateShared } from './queries';

/** The owner's view of everything shared, with Hide, Show and Remove. */
export function SharedModeration() {
  const list = useAdminShared();
  const { hide, remove } = useModerateShared();
  const [confirming, setConfirming] = useState<string | null>(null);
  return (
    <SectionCard
      title="Shared items"
      description="Only you see this. Hidden and removed items leave the Shared space at once. Copies people already imported stay theirs."
    >
      {list.isPending ? <Loading label="Loading shared items" /> : null}
      {list.isError ? <ErrorNotice error={list.error} /> : null}
      {list.data && list.data.length === 0 ? <p className="text-sm text-ink-300">Nothing has been shared yet.</p> : null}
      {list.data && list.data.length > 0 ? (
        <ul className="space-y-2">
          {list.data.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-ink-850 p-3 text-sm">
              <span className="min-w-0 font-medium break-words text-ink-100">{item.title}</span>
              {item.hidden ? <Badge tone="warn">Hidden</Badge> : null}
              <span className="w-full text-xs text-ink-400">
                {item.kind} by {item.by}
                {item.official ? '' : ` (${item.sharerEmail ?? `account ${item.sharerId}`})`}, updated {dateTime(item.updatedAt)}, imported {item.imports} time(s).
                {item.description ? ` "${item.description}"` : ''}
              </span>
              <Button size="sm" busy={hide.isPending && hide.variables?.id === item.id} onClick={() => hide.mutate({ id: item.id, hidden: !item.hidden })}>
                {item.hidden ? 'Show' : 'Hide'}
              </Button>
              {confirming === item.id ? (
                <>
                  <Button size="sm" variant="danger" busy={remove.isPending} onClick={() => remove.mutate(item.id, { onSuccess: () => setConfirming(null) })}>
                    Confirm remove
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                    Keep
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setConfirming(item.id)}>
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {hide.isError ? <ErrorNotice error={hide.error} /> : null}
      {remove.isError ? <ErrorNotice error={remove.error} /> : null}
    </SectionCard>
  );
}
