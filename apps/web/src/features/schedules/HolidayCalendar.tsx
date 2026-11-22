import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { describeTime, type HolidayDto } from '@glm/shared';
import { Spectrum } from '../../components/light';
import { Badge, Button, ErrorNotice, SectionCard } from '../../components/ui';
import { useHolidays, useSetHolidayEnabled, useSetHolidaySkipped } from '../../lib/queries';
import { HolidayEditor } from './HolidayEditor';

/** A date with no time or zone. Noon keeps any time zone from showing the day before. */
function dateLabel(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function HolidayRow({ holiday, onEdit }: { holiday: HolidayDto; onEdit: () => void }) {
  const setEnabled = useSetHolidayEnabled();
  const setSkipped = useSetHolidaySkipped();
  return (
    <li className="rounded-3xl bg-inset p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="min-w-0 font-display text-base font-semibold tracking-tight break-words">{holiday.name}</h3>
        {!holiday.enabled ? <Badge>Off</Badge> : holiday.skipped ? <Badge tone="warn">Skipping next</Badge> : <Badge tone="good">On</Badge>}
      </div>
      <p className="mt-0.5 text-sm text-fg-2">
        {holiday.nextDate ? dateLabel(holiday.nextDate) : 'No date known after 2037'}, {describeTime(holiday.startTime)}
        {holiday.endTime ? ` to ${describeTime(holiday.endTime)}` : ''}
      </p>
      <p className="text-xs text-fg-4">
        {holiday.description}
        {holiday.customized ? ' Changed by you.' : ''}
      </p>
      <Spectrum colors={holiday.colors} height="h-4" className="mt-3 mb-4" />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" aria-label={`Edit ${holiday.name}`} icon={<Pencil className="size-4" aria-hidden />} onClick={onEdit}>
          Edit
        </Button>
        <Button
          size="sm"
          aria-label={`${holiday.enabled ? 'Turn off' : 'Turn on'} ${holiday.name}`}
          busy={setEnabled.isPending}
          onClick={() => setEnabled.mutate({ key: holiday.key, enabled: !holiday.enabled })}
        >
          {holiday.enabled ? 'Turn off' : 'Turn on'}
        </Button>
        {holiday.enabled && holiday.nextDate ? (
          <Button
            size="sm"
            variant="ghost"
            aria-label={`${holiday.skipped ? 'Keep' : 'Skip next'} ${holiday.name}`}
            busy={setSkipped.isPending}
            onClick={() => setSkipped.mutate({ key: holiday.key, skip: !holiday.skipped })}
          >
            {holiday.skipped ? 'Keep it' : 'Skip next'}
          </Button>
        ) : null}
      </div>
      {holiday.problem ? <p className="mt-1 text-xs text-warn">{holiday.problem}</p> : null}
      {setEnabled.isError ? <ErrorNotice error={setEnabled.error} /> : null}
      {setSkipped.isError ? <ErrorNotice error={setSkipped.error} /> : null}
    </li>
  );
}

export function HolidayCalendar() {
  const holidays = useHolidays();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  if (!holidays.data || holidays.data.length === 0) return null;
  const editing = holidays.data.find((holiday) => holiday.key === editingKey);
  return (
    <SectionCard
      title="Holiday calendar"
      description={`Your lights change by themselves on each of these, soonest first (${holidays.data[0]?.timeZone}). Your other schedules still run on these days, so your usual pattern shows until the holiday starts.`}
    >
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {holidays.data.map((holiday) => (
          <HolidayRow key={holiday.key} holiday={holiday} onEdit={() => setEditingKey(holiday.key)} />
        ))}
      </ul>
      <p className="mt-3 text-xs text-fg-4">
        Dates are worked out for each year. Diwali follows the lunar calendar, using Drik Panchang's dates for Los Angeles, and
        other calendars can differ by a day. Many holidays have no official colors, so those are suggestions.
      </p>
      {editing ? <HolidayEditor key={editing.key} holiday={editing} onClose={() => setEditingKey(null)} /> : null}
    </SectionCard>
  );
}
