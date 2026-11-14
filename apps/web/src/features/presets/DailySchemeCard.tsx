import { CalendarSync, Play } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { DailySchemeDayDto, PresetDto } from '@glm/shared';
import { Button, ErrorNotice, SectionCard } from '../../components/ui';
import { useDailyScheme, useSetDailyScheme } from '../../lib/queries';

const SHORT_LIST = 7;

function Swatches({ colors }: { colors: string[] }) {
  return (
    <div aria-hidden className="flex h-5 gap-px overflow-hidden rounded border border-ink-600">
      {colors.map((color, index) => (
        <span key={index} className="min-w-0 flex-1" style={{ backgroundColor: color }} />
      ))}
    </div>
  );
}

/** "Sat, Nov 14", from a plain date, without shifting it into another time zone. */
function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function DayRow({ day }: { day: DailySchemeDayDto }) {
  return (
    <li className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 rounded-lg bg-ink-850 p-2.5 sm:grid-cols-[6.5rem_minmax(0,1fr)_9rem]">
      <span className="text-xs text-ink-400 tabular-nums">{dayLabel(day.date)}</span>
      <span className="min-w-0 text-sm break-words">{day.name}</span>
      <div className="col-span-2 sm:col-span-1">
        <Swatches colors={day.colors} />
      </div>
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
        <div className="rounded-lg bg-ink-850 p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-ink-400">Today, {dayLabel(today.date)}</p>
              <p className="font-semibold break-words">{today.name}</p>
              <p className="mt-0.5 text-sm text-ink-300">{today.description}</p>
            </div>
            {todaysPreset ? (
              <Button
                size="sm"
                variant="primary"
                aria-label={`Show today's scheme now: ${today.name}`}
                icon={<Play className="size-4" aria-hidden />}
                onClick={() => onApply(todaysPreset)}
              >
                Show it now
              </Button>
            ) : null}
          </div>
          <div className="mt-2">
            <Swatches colors={today.colors} />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="size-4"
                checked={autoChange.enabled}
                disabled={set.isPending || presetId === null}
                onChange={(event) => set.mutate({ enabled: event.target.checked, time })}
              />
              Change automatically every day
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-300">
              at
              <input
                type="time"
                aria-label="Time the color scheme changes each day"
                className="min-h-9 rounded-lg border border-ink-700 bg-ink-850 px-2 text-ink-100"
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
          <p className="text-xs text-ink-400" role="status">
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
            <p className="text-xs text-ink-400">
              If another schedule changes the lights later the same day, that one shows instead. Holiday shows still run at
              their own times.
            </p>
          ) : null}
          {set.isError ? <ErrorNotice error={set.error} title="That was not saved" /> : null}
        </div>

        {upcoming.length > 0 ? (
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-ink-200">
              <CalendarSync className="size-4" aria-hidden />
              Coming up
            </h3>
            <ol className="space-y-1.5">
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
          <p className="text-xs text-ink-400">
            There is a scheme for every day in November and December. In other months this shows a plain warm white.
          </p>
        )}
      </div>
    </SectionCard>
  );
}
