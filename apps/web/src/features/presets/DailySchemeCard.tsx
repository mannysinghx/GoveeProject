import { CalendarSync, Play } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { DailySchemeDayDto, PresetDto } from '@glm/shared';
import { Spectrum } from '../../components/light';
import { Button, ErrorNotice, SectionCard } from '../../components/ui';
import { useDailyScheme, useSetDailyScheme } from '../../lib/queries';

const SHORT_LIST = 7;

/** "Sat, Nov 14", from a plain date, without shifting it into another time zone. */
function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function DayRow({ day }: { day: DailySchemeDayDto }) {
  return (
    <li className="flex flex-col gap-2 rounded-2xl bg-inset p-3.5">
      <span className="text-xs font-medium text-fg-4 tabular-nums">{dayLabel(day.date)}</span>
      <span className="min-w-0 text-sm font-medium break-words">{day.name}</span>
      <Spectrum colors={day.colors} height="h-3" className="mt-auto" />
    </li>
  );
}

/**
 * Today's still color scheme, and the switch that changes it every day. The switch is an
 * ordinary schedule underneath, so it also shows, and can be edited, under Schedules.
 */
export function DailySchemeCard({ presets, onApply }: { presets: PresetDto[]; onApply: (preset: PresetDto) => void }) {
  const status = useDailyScheme();
  const set = useSetDailyScheme();
  const [showAll, setShowAll] = useState(false);
  const [draftTime, setDraftTime] = useState<string | null>(null);

  if (status.isError) return <ErrorNotice error={status.error} title="Could not load the color scheme of the day" />;
  if (!status.data) return null;
  const { today, upcoming, autoChange, presetId } = status.data;
  const todaysPreset = presets.find((p) => p.id === today.presetId);
  const time = draftTime ?? autoChange.time;
  const shown = showAll ? upcoming : upcoming.slice(0, SHORT_LIST);

  return (
    <SectionCard
      title="Color scheme of the day"
      description="A different still color scheme every day in November and December. Fixed colors, no movement."
    >
      <div className="space-y-4">
        <div className="rounded-3xl bg-inset p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-[0.12em] text-accent-text uppercase">Today, {dayLabel(today.date)}</p>
              <p className="mt-1 font-display text-2xl font-semibold tracking-tight break-words">{today.name}</p>
              <p className="mt-1 text-sm text-fg-3">{today.description}</p>
            </div>
            {todaysPreset ? (
              <Button
                size="sm"
                variant="primary"
                aria-label={`Show it now: ${today.name}`}
                icon={<Play className="size-4" aria-hidden />}
                onClick={() => onApply(todaysPreset)}
              >
                Show it now
              </Button>
            ) : null}
          </div>
          <div className="mt-5 mb-3">
            <Spectrum colors={today.colors} height="h-14" />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="size-5"
                checked={autoChange.enabled}
                disabled={set.isPending || presetId === null}
                onChange={(event) => set.mutate({ enabled: event.target.checked, time })}
              />
              Change automatically every day
            </label>
            <label className="flex items-center gap-2 text-sm text-fg-3">
              at
              <input
                type="time"
                aria-label="Time the color scheme changes each day"
                className="min-h-9 rounded-xl border border-field-line bg-inset px-2.5 text-fg"
                value={time}
                disabled={set.isPending || presetId === null}
                onChange={(event) => setDraftTime(event.target.value)}
                onBlur={() => {
                  // Saved when the field is left, and only if it is switched on and really changed.
                  if (draftTime && draftTime !== autoChange.time && autoChange.enabled) {
                    set.mutate({ enabled: true, time: draftTime }, { onSuccess: () => setDraftTime(null) });
                  }
                }}
              />
            </label>
          </div>
          <p className="text-xs text-fg-4" role="status">
            {presetId === null
              ? 'This becomes available once your lights have been found.'
              : autoChange.enabled
                ? `On. Next change: ${autoChange.nextRun?.local ?? 'not scheduled'}, on ${autoChange.targetName ?? 'your lights'}. It turns the lights on and shows that day's scheme.`
                : 'Off. The lights change only when you apply something.'}{' '}
            {autoChange.scheduleId ? (
              <>
                It is the "Daily color scheme" schedule, which you can also change under{' '}
                <Link to="/schedules" className="underline underline-offset-2">
                  Schedules
                </Link>
                .
              </>
            ) : null}
          </p>
          {autoChange.enabled ? (
            <p className="text-xs text-fg-4">
              If another schedule changes the lights later the same day, that one shows instead. Holiday shows still run at
              their own times.
            </p>
          ) : null}
          {set.isError ? <ErrorNotice error={set.error} title="That was not saved" /> : null}
        </div>

        {upcoming.length > 0 ? (
          <div>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg-2">
              <CalendarSync className="size-4" aria-hidden />
              Coming up
            </h3>
            <ol className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {shown.map((day) => (
                <DayRow key={day.date} day={day} />
              ))}
            </ol>
            {upcoming.length > SHORT_LIST ? (
              <Button size="sm" variant="ghost" className="mt-2" onClick={() => setShowAll((value) => !value)}>
                {showAll ? 'Show fewer days' : `Show all ${upcoming.length} days to December 31`}
              </Button>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-fg-4">
            There is a scheme for every day in November and December. In other months this shows a plain warm white.
          </p>
        )}
      </div>
    </SectionCard>
  );
}
