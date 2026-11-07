import { CalendarClock, Info } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import {
  HOLIDAYS,
  recurrenceSchema,
  type MissedRunPolicy,
  type Recurrence,
  type ScheduleAction,
  type ScheduleDto,
  type Target,
} from '@glm/shared';
import { Button, Dialog, ErrorNotice, Field, inputClass, Loading, Notice } from '../../components/ui';
import { timeZoneOptions } from '../../lib/format';
import { useDebounced } from '../../lib/hooks';
import { usePresets, useSaveSchedule, useSchedulePreview, useSettings } from '../../lib/queries';
import { parseTarget, TargetOptions } from '../presets/ApplyPresetDialog';

type RepeatMode = 'once' | 'daily' | 'weekdays' | 'weekends' | 'custom' | 'solar' | 'yearly' | 'holiday';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const WEEKDAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
];

const WEEKDAY_SET = [1, 2, 3, 4, 5];
const WEEKEND_SET = [6, 7];

function modeFromRecurrence(recurrence: Recurrence | undefined): RepeatMode {
  if (!recurrence) return 'daily';
  if (recurrence.kind === 'once') return 'once';
  if (recurrence.kind === 'daily') return 'daily';
  if (recurrence.kind === 'solar') return 'solar';
  if (recurrence.kind === 'yearly') return 'yearly';
  if (recurrence.kind === 'holiday') return 'holiday';
  const key = [...recurrence.weekdays].sort((a, b) => a - b).join(',');
  if (key === WEEKDAY_SET.join(',')) return 'weekdays';
  if (key === WEEKEND_SET.join(',')) return 'weekends';
  return 'custom';
}

function targetValue(target: Target | undefined): string {
  if (!target) return '';
  return target.type === 'device' ? `device:${target.deviceId}` : `group:${target.groupId}`;
}

function tomorrowLocal(): string {
  const date = new Date(Date.now() + 24 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function ScheduleEditor({ schedule, onClose }: { schedule: ScheduleDto | null; onClose: () => void }) {
  const settings = useSettings();
  const presets = usePresets();
  const save = useSaveSchedule();
  const existing = schedule?.recurrence;

  const [name, setName] = useState(schedule?.name ?? '');
  const [timeZone, setTimeZone] = useState(schedule?.timeZone ?? settings.data?.defaultTimeZone ?? 'UTC');
  const [mode, setMode] = useState<RepeatMode>(modeFromRecurrence(existing));
  const [date, setDate] = useState(existing?.kind === 'once' ? existing.date : tomorrowLocal());
  const [month, setMonth] = useState(existing?.kind === 'yearly' ? existing.month : 1);
  const [day, setDay] = useState(existing?.kind === 'yearly' ? existing.day : 1);
  const [holiday, setHoliday] = useState(existing?.kind === 'holiday' ? existing.holiday : 'thanksgiving');
  const [time, setTime] = useState(existing && 'time' in existing ? existing.time : '18:00');
  const [customDays, setCustomDays] = useState<number[]>(existing?.kind === 'weekly' ? existing.weekdays : [1, 2, 3, 4, 5]);
  const [startDate, setStartDate] = useState(existing && 'startDate' in existing ? (existing.startDate ?? '') : '');
  const [endDate, setEndDate] = useState(existing && 'endDate' in existing ? (existing.endDate ?? '') : '');
  const [solarEvent, setSolarEvent] = useState<'sunrise' | 'sunset'>(existing?.kind === 'solar' ? existing.event : 'sunset');
  const [offset, setOffset] = useState(existing?.kind === 'solar' ? existing.offsetMinutes : 0);
  const [latitude, setLatitude] = useState(
    existing?.kind === 'solar' ? String(existing.latitude) : (settings.data?.latitude?.toString() ?? ''),
  );
  const [longitude, setLongitude] = useState(
    existing?.kind === 'solar' ? String(existing.longitude) : (settings.data?.longitude?.toString() ?? ''),
  );
  const [target, setTarget] = useState(targetValue(schedule?.target));
  const [actionKind, setActionKind] = useState<'on' | 'off' | 'preset'>(
    schedule?.action.type === 'preset' ? 'preset' : schedule?.action.on === false ? 'off' : 'on',
  );
  const [presetId, setPresetId] = useState(schedule?.action.type === 'preset' ? schedule.action.presetId : '');
  const [policy, setPolicy] = useState<MissedRunPolicy>(schedule?.missedRunPolicy ?? 'skip');

  const zones = useMemo(() => timeZoneOptions(timeZone), [timeZone]);

  const recurrenceInput = useMemo<unknown>(() => {
    const bounds = { ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}) };
    switch (mode) {
      case 'once':
        return { kind: 'once', date, time };
      case 'yearly':
        return { kind: 'yearly', month, day, time, ...bounds };
      case 'holiday':
        return { kind: 'holiday', holiday, time, ...bounds };
      case 'daily':
        return { kind: 'daily', time, ...bounds };
      case 'weekdays':
        return { kind: 'weekly', time, weekdays: WEEKDAY_SET, ...bounds };
      case 'weekends':
        return { kind: 'weekly', time, weekdays: WEEKEND_SET, ...bounds };
      case 'custom':
        return { kind: 'weekly', time, weekdays: customDays, ...bounds };
      case 'solar':
        return {
          kind: 'solar',
          event: solarEvent,
          offsetMinutes: offset,
          latitude: latitude === '' ? Number.NaN : Number(latitude),
          longitude: longitude === '' ? Number.NaN : Number(longitude),
          ...bounds,
        };
    }
  }, [mode, date, month, day, holiday, time, customDays, startDate, endDate, solarEvent, offset, latitude, longitude]);

  const parsed = recurrenceSchema.safeParse(recurrenceInput);
  const recurrenceError = parsed.success ? null : (parsed.error.issues[0]?.message ?? 'Check the schedule timing.');

  const previewRequest = useDebounced(
    parsed.success ? { timeZone, recurrence: parsed.data, count: 5 } : null,
    300,
  );
  const preview = useSchedulePreview(previewRequest);

  const parsedTarget = parseTarget(target);
  const action: ScheduleAction | null =
    actionKind === 'preset' ? (presetId ? { type: 'preset', presetId } : null) : { type: 'power', on: actionKind === 'on' };

  const canSave = parsed.success && parsedTarget !== undefined && action !== null && name.trim() !== '';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!parsed.success || !parsedTarget || !action) return;
    const body = {
      name,
      timeZone,
      recurrence: parsed.data,
      target: parsedTarget,
      action,
      missedRunPolicy: policy,
    };
    if (schedule) save.mutate({ id: schedule.id, update: body }, { onSuccess: onClose });
    else save.mutate({ create: { ...body, enabled: true } }, { onSuccess: onClose });
  };

  const showTime = mode !== 'solar';
  const showBounds = mode !== 'once';

  return (
    <Dialog title={schedule ? `Edit "${schedule.name}"` : 'New schedule'} open onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-5">
        <Field label="Name">
          {(props) => (
            <input {...props} className={inputClass} required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Target">
            {(props) => (
              <select {...props} className={inputClass} required value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Choose a device or group</option>
                <TargetOptions />
              </select>
            )}
          </Field>
          <Field label="Action">
            {(props) => (
              <select
                {...props}
                className={inputClass}
                value={actionKind}
                onChange={(e) => setActionKind(e.target.value as 'on' | 'off' | 'preset')}
              >
                <option value="on">Turn on</option>
                <option value="off">Turn off</option>
                <option value="preset">Apply a preset</option>
              </select>
            )}
          </Field>
          {actionKind === 'preset' ? (
            <Field label="Preset" hint={presets.data?.length === 0 ? 'No presets yet. Create one first.' : undefined}>
              {(props) => (
                <select {...props} className={inputClass} required value={presetId} onChange={(e) => setPresetId(e.target.value)}>
                  <option value="">Choose a preset</option>
                  {presets.data?.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Repeat">
            {(props) => (
              <select {...props} className={inputClass} value={mode} onChange={(e) => setMode(e.target.value as RepeatMode)}>
                <option value="once">One time</option>
                <option value="daily">Every day</option>
                <option value="weekdays">Weekdays</option>
                <option value="weekends">Weekends</option>
                <option value="custom">Specific days</option>
                <option value="yearly">Every year</option>
                <option value="holiday">A holiday, every year</option>
                <option value="solar">Sunrise or sunset</option>
              </select>
            )}
          </Field>
          <Field label="Time zone">
            {(props) => (
              <select {...props} className={inputClass} value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
                {zones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {mode === 'once' ? (
            <Field label="Date">
              {(props) => (
                <input {...props} type="date" className={inputClass} required value={date} onChange={(e) => setDate(e.target.value)} />
              )}
            </Field>
          ) : null}
          {mode === 'holiday' ? (
            <Field label="Holiday">
              {(props) => (
                <select {...props} className={inputClass} value={holiday} onChange={(e) => setHoliday(e.target.value)}>
                  {HOLIDAYS.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : null}
          {mode === 'yearly' ? (
            <>
              <Field label="Month">
                {(props) => (
                  <select {...props} className={inputClass} value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                    {MONTHS.map((label, index) => (
                      <option key={label} value={index + 1}>
                        {label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Day">
                {(props) => (
                  <input
                    {...props}
                    type="number"
                    className={inputClass}
                    required
                    min={1}
                    max={31}
                    value={day}
                    onChange={(e) => setDay(Math.floor(Number(e.target.value)) || 1)}
                  />
                )}
              </Field>
            </>
          ) : null}
          {showTime ? (
            <Field label="Time">
              {(props) => (
                <input {...props} type="time" className={inputClass} required value={time} onChange={(e) => setTime(e.target.value)} />
              )}
            </Field>
          ) : null}
        </div>

        {mode === 'custom' ? (
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-ink-200">Days</legend>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((day) => {
                const on = customDays.includes(day.value);
                return (
                  <button
                    key={day.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setCustomDays((current) => (on ? current.filter((d) => d !== day.value) : [...current, day.value]))
                    }
                    className={`min-h-11 min-w-12 rounded-lg border px-2 text-sm ${
                      on ? 'border-amber-glow bg-amber-wash text-amber-soft' : 'border-ink-700 bg-ink-850 text-ink-200'
                    }`}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        {mode === 'solar' ? (
          <div className="grid gap-3 rounded-lg border border-ink-700 p-3 sm:grid-cols-2">
            <Field label="Event">
              {(props) => (
                <select {...props} className={inputClass} value={solarEvent} onChange={(e) => setSolarEvent(e.target.value as 'sunrise' | 'sunset')}>
                  <option value="sunset">Sunset</option>
                  <option value="sunrise">Sunrise</option>
                </select>
              )}
            </Field>
            <Field label="Offset in minutes" hint="Negative is before the event. -30 means 30 minutes before.">
              {(props) => (
                <input
                  {...props}
                  type="number"
                  className={inputClass}
                  min={-240}
                  max={240}
                  value={offset}
                  onChange={(e) => setOffset(Number.parseInt(e.target.value, 10) || 0)}
                />
              )}
            </Field>
            <Field label="Latitude" hint="Entered by hand and calculated on this server. No location service is used.">
              {(props) => (
                <input {...props} type="number" step="any" min={-90} max={90} className={inputClass} required value={latitude} onChange={(e) => setLatitude(e.target.value)} />
              )}
            </Field>
            <Field label="Longitude">
              {(props) => (
                <input {...props} type="number" step="any" min={-180} max={180} className={inputClass} required value={longitude} onChange={(e) => setLongitude(e.target.value)} />
              )}
            </Field>
          </div>
        ) : null}

        {showBounds ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Start date (optional)">
              {(props) => <input {...props} type="date" className={inputClass} value={startDate} onChange={(e) => setStartDate(e.target.value)} />}
            </Field>
            <Field label="End date (optional)">
              {(props) => <input {...props} type="date" className={inputClass} value={endDate} onChange={(e) => setEndDate(e.target.value)} />}
            </Field>
          </div>
        ) : null}

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-ink-200">If a run is missed because the app was not running</legend>
          <div className="space-y-2">
            <label className="flex items-start gap-3 rounded-lg border border-ink-700 p-3">
              <input type="radio" name="missed" className="mt-0.5 size-4" checked={policy === 'skip'} onChange={() => setPolicy('skip')} />
              <span className="text-sm">
                <span className="font-medium">Record it and do nothing</span>
                <span className="block text-ink-300">The safest choice. Missed runs appear in the history.</span>
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-lg border border-ink-700 p-3">
              <input type="radio" name="missed" className="mt-0.5 size-4" checked={policy === 'run_latest'} onChange={() => setPolicy('run_latest')} />
              <span className="text-sm">
                <span className="font-medium">Catch up with the latest one</span>
                <span className="block text-ink-300">
                  When the app returns, run only the most recent missed run, if it is recent enough. Older ones are never replayed.
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        <div className="rounded-lg border border-ink-700 p-3" aria-live="polite">
          <p className="mb-2 flex items-center gap-2 text-sm font-medium">
            <CalendarClock className="size-4 text-ink-400" aria-hidden />
            Next runs
          </p>
          {recurrenceError ? <p className="text-sm text-bad">{recurrenceError}</p> : null}
          {!recurrenceError && preview.isFetching && !preview.data ? <Loading label="Working out run times" /> : null}
          {preview.isError ? <ErrorNotice error={preview.error} /> : null}
          {!recurrenceError && preview.data ? (
            <>
              <ol className="space-y-1 text-sm text-ink-200">
                {preview.data.nextRuns.map((run) => (
                  <li key={run.at}>
                    {run.local}
                    {run.note === 'dst_gap_moved_forward' ? (
                      <span className="block text-xs text-warn">
                        The set time does not exist this day because clocks go forward, so it runs later by the size of the change.
                      </span>
                    ) : null}
                    {run.note === 'dst_repeated_time_first_used' ? (
                      <span className="block text-xs text-warn">
                        The set time happens twice this day because clocks go back. It runs once, the first time.
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
              {preview.data.warning ? <p className="mt-2 text-sm text-warn">{preview.data.warning}</p> : null}
            </>
          ) : null}
        </div>

        <Notice tone="info">
          <span className="inline-flex items-start gap-1">
            <Info className="sr-only" aria-hidden />
            This schedule lives in this app, not in the lights. It only runs while the app is running and can reach Govee.
          </span>
        </Notice>

        {save.isError ? <ErrorNotice error={save.error} title="The schedule was not saved" /> : null}

        <div className="flex gap-2">
          <Button type="submit" variant="primary" busy={save.isPending} disabled={!canSave}>
            Save schedule
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
