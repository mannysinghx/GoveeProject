import type { CommandDto } from '@glm/shared';
import { CommandStatusBadge, VerificationBadge } from '../../components/status';
import { SectionCard } from '../../components/ui';
import { ERROR_CATEGORY_LABEL, timeAgo } from '../../lib/format';

export function PendingCommands({ commands }: { commands: CommandDto[] }) {
  if (commands.length === 0) return null;
  return (
    <SectionCard title={`Pending commands (${commands.length})`}>
      <ul className="space-y-2" aria-live="polite">
        {commands.map((command) => (
          <li key={command.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-inset p-3 text-sm">
            <span>{command.summary}</span>
            <CommandStatusBadge status={command.status} />
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

export function CommandHistory({ commands }: { commands: CommandDto[] }) {
  return (
    <SectionCard title="Recent commands">
      {commands.length === 0 ? (
        <p className="text-sm text-fg-3">No commands sent to this device yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {commands.map((command) => (
            <li key={command.id} className="py-2.5 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 text-sm break-words">{command.summary}</span>
                <span className="text-xs text-fg-4">
                  {command.sourceType} · {timeAgo(command.createdAt)}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <CommandStatusBadge status={command.status} />
                {command.status === 'accepted' ? <VerificationBadge verification={command.verification} /> : null}
                {command.errorCategory ? (
                  <span className="text-xs text-bad">{ERROR_CATEGORY_LABEL[command.errorCategory]}</span>
                ) : null}
              </div>
              {command.errorMessage ? <p className="mt-1 text-xs break-words text-fg-4">{command.errorMessage}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
