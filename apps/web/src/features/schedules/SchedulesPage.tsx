import { HolidayCalendar } from './HolidayCalendar';
import { CalendarClock, History, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { describeRecurrence, type ScheduleDto } from '@glm/shared';
import { RunStatusBadge } from '../../components/status';
import { Badge, Button, Card, Dialog, EmptyState, ErrorNotice, Loading, Notice, PageHeader } from '../../components/ui';
import { dateTime } from '../../lib/format';
import { useDeleteSchedule, useScheduleExecutions, useSchedules, useToggleSchedule } from '../../lib/queries';
import { ScheduleEditor } from './ScheduleEditor';

function HistoryDialog({ schedule, onClose }: { schedule: ScheduleDto; onClose: () => void }) {
  const executions = useScheduleExecutions(schedule.id);
  return (
    <Dialog title={`History: ${schedule.name}`} open onClose={onClose} wide>
      {executions.isPending ? <Loading /> : null}
      {executions.isError ? <ErrorNotice error={executions.error} /> : null}
      {executions.data?.length === 0 ? <p className="text-sm text-ink-300">This schedule has not run yet.</p> : null}
      {executions.data && executions.data.length > 0 ? (
        <ul className="divide-y divide-ink-700/60">
          {executions.data.map((execution) => (
            <li key={execution.id} className="py-3 first:pt-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">{dateTime(execution.scheduledFor)}</span>
                <span className="flex flex-wrap items-center gap-1.5">
                  {execution.isRecovery ? <Badge tone="info">Recovered</Badge> : null}
                  <RunStatusBadge status={execution.status} />
                </span>
              </div>
              {execution.errorSummary ? <p className="mt-1 text-xs break-words text-ink-400">{execution.errorSummary}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Dialog>
  );
}

function ScheduleCard({
  schedule,
  onEdit,
  onHistory,
}: {
  schedule: ScheduleDto;
  onEdit: () => void;
  onHistory: () => void;
}) {
  const toggle = useToggleSchedule();
  const remove = useDeleteSchedule();
  const [confirming, setConfirming] = useState(false);
  const finished = schedule.enabled && !schedule.nextRun;

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold break-words">{schedule.name}</h3>
          <p className="mt-0.5 text-sm text-ink-300">
            {schedule.actionSummary} <span className="text-ink-400">· {schedule.targetName}</span>
          </p>
        </div>
        {schedule.enabled ? (
          finished ? <Badge>Finished</Badge> : <Badge tone="good">Enabled</Badge>
        ) : (
          <Badge>Disabled</Badge>
        )}
      </div>

      <p className="text-sm text-ink-200">{describeRecurrence(schedule.recurrence)}</p>
      <p className="text-xs text-ink-400">{schedule.timeZone}</p>

      {schedule.nextRun ? (
        <div className="rounded-lg bg-ink-850 p-3 text-sm">
          <p className="text-xs text-ink-400">Next run</p>
          <p className="mt-0.5">{schedule.nextRun.local}</p>
          {schedule.nextRun.note === 'dst_gap_moved_forward' ? (
            <p className="mt-1 text-xs text-warn">Moved later because clocks go forward that day.</p>
          ) : null}
          {schedule.nextRun.note === 'dst_repeated_time_first_used' ? (
            <p className="mt-1 text-xs text-warn">That time happens twice that day. It runs the first time only.</p>
          ) : null}
        </div>
      ) : null}

      {schedule.problem ? <Notice tone="warn">{schedule.problem}</Notice> : null}

      {schedule.lastExecution ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-400">
          Last: {dateTime(schedule.lastExecution.scheduledFor)}
          <RunStatusBadge status={schedule.lastExecution.status} />
        </div>
      ) : null}

      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <Button
          size="sm"
          busy={toggle.isPending}
          onClick={() => toggle.mutate({ id: schedule.id, enabled: !schedule.enabled })}
        >
          {schedule.enabled ? 'Disable' : 'Enable'}
        </Button>
        <Button size="sm" icon={<Pencil className="size-4" aria-hidden />} onClick={onEdit}>
          Edit
        </Button>
        <Button size="sm" icon={<History className="size-4" aria-hidden />} onClick={onHistory}>
          History
        </Button>
        {confirming ? (
          <>
            <Button size="sm" variant="danger" busy={remove.isPending} onClick={() => remove.mutate(schedule.id)}>
              Confirm delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" aria-label={`Delete ${schedule.name}`} icon={<Trash2 className="size-4" aria-hidden />} onClick={() => setConfirming(true)} />
        )}
      </div>
      {toggle.isError ? <ErrorNotice error={toggle.error} /> : null}
      {remove.isError ? <ErrorNotice error={remove.error} /> : null}
    </Card>
  );
}

export function SchedulesPage() {
  const schedules = useSchedules();
  const [editing, setEditing] = useState<ScheduleDto | 'new' | null>(null);
  const [history, setHistory] = useState<ScheduleDto | null>(null);
  const yours = schedules.data?.filter((schedule) => !schedule.builtinShow);
  const holidaySteps = schedules.data?.filter((schedule) => schedule.builtinShow) ?? [];
  const cardProps = (schedule: ScheduleDto) => ({
    schedule,
    onEdit: () => setEditing(schedule),
    onHistory: () => setHistory(schedule),
  });

  return (
    <>
      <PageHeader
        title="Schedules"
        description="Schedules run from this app, whether or not a browser is open. They do not run if the app is stopped, or if the internet or the Govee service is unavailable."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" aria-hidden />} onClick={() => setEditing('new')}>
            New schedule
          </Button>
        }
      />
      <div className="mb-5">
        <HolidayCalendar />
      </div>
      <h2 className="mb-3 text-lg font-semibold">Your schedules</h2>
      {schedules.isPending ? <Loading label="Loading schedules" /> : null}
      {schedules.isError ? <ErrorNotice error={schedules.error} /> : null}
      {yours?.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="size-8" aria-hidden />}
          title="No schedules yet"
          action={
            <Button variant="primary" onClick={() => setEditing('new')}>
              Create a schedule
            </Button>
          }
        >
          Turn lights on at sunset, off at midnight, or apply a preset on weekends.
        </EmptyState>
      ) : null}
      {yours && yours.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {yours.map((schedule) => (
            <ScheduleCard key={schedule.id} {...cardProps(schedule)} />
          ))}
        </div>
      ) : null}
      {holidaySteps.length > 0 ? (
        <details className="mt-6">
          <summary className="min-h-9 cursor-pointer py-2 text-sm font-medium text-ink-200">
            See each holiday step ({holidaySteps.length} schedules, with their history)
          </summary>
          <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {holidaySteps.map((schedule) => (
              <ScheduleCard key={schedule.id} {...cardProps(schedule)} />
            ))}
          </div>
        </details>
      ) : null}
      {editing ? <ScheduleEditor schedule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
      {history ? <HistoryDialog schedule={history} onClose={() => setHistory(null)} /> : null}
    </>
  );
}
