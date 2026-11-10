import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { addMinutesToTime, BUILTIN_PRESETS, holidayByKey, holidayUpdateSchema, type HolidayDto, type PresetDto } from '@glm/shared';
import { Button, Dialog, ErrorNotice, Field, inputClass, Notice } from '../../components/ui';
import { usePresets, useUpdateHoliday } from '../../lib/queries';
import { parseTarget, TargetOptions } from '../presets/ApplyPresetDialog';

interface StepForm {
  /** Only for React, so a row keeps its identity when another is removed. */
  id: number;
  time: string;
  presetId: string;
}

/** Festival and holiday presets are many, so they are grouped to keep the list usable. */
function PresetOptions({ presets }: { presets: PresetDto[] }) {
  const yours = presets.filter((preset) => !preset.builtin);
  const builtIn = presets.filter((preset) => preset.builtin);
  // Calendar order, as the catalog lists them, rather than by name.
  const available = new Set(builtIn.map((preset) => preset.builtin?.occasion));
  const occasions = [...new Set(BUILTIN_PRESETS.map((preset) => preset.occasion))].filter((occasion) => available.has(occasion));
  return (
    <>
      {yours.length > 0 ? (
        <optgroup label="Your presets">
          {yours.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </optgroup>
      ) : null}
      {occasions.map((occasion) => (
        <optgroup key={occasion} label={occasion}>
          {builtIn
            .filter((preset) => preset.builtin?.occasion === occasion)
            .map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
        </optgroup>
      ))}
    </>
  );
}

export function HolidayEditor({ holiday, onClose }: { holiday: HolidayDto; onClose: () => void }) {
  const presets = usePresets();
  const update = useUpdateHoliday();
  const [steps, setSteps] = useState<StepForm[]>(() => holiday.steps.map((step, id) => ({ id, time: step.time, presetId: step.presetId })));
  const [nextId, setNextId] = useState(holiday.steps.length);
  const [hasEnd, setHasEnd] = useState(holiday.endTime !== null);
  const [endTime, setEndTime] = useState(holiday.endTime ?? '23:00');
  const [target, setTarget] = useState(holiday.target.type === 'device' ? `device:${holiday.target.deviceId}` : `group:${holiday.target.groupId}`);
  const original = holidayByKey(holiday.key);

  const change = (id: number, values: Partial<StepForm>) =>
    setSteps((rows) => rows.map((row) => (row.id === id ? { ...row, ...values } : row)));

  const addStep = () => {
    const last = steps.at(-1);
    if (!last) return;
    // Half an hour on, but staying within the day. The form says so if it clashes with the end.
    const next = last.time >= '23:30' ? last.time : addMinutesToTime(last.time, 30);
    setSteps((rows) => [...rows, { id: nextId, time: next, presetId: last.presetId }]);
    setNextId((id) => id + 1);
  };

  const useOriginal = () => {
    if (!original || !presets.data) return;
    const rows = original.steps.map((step, id) => ({
      id: nextId + id,
      time: addMinutesToTime(original.startTime, step.minutesAfterStart),
      presetId: presets.data.find((preset) => preset.builtin?.key === step.presetKey)?.id ?? '',
    }));
    setSteps(rows);
    setNextId(nextId + rows.length);
    setHasEnd(original.endTime !== null);
    if (original.endTime) setEndTime(original.endTime);
  };

  const parsed = holidayUpdateSchema.safeParse({
    steps: steps.map(({ time, presetId }) => ({ time, presetId })),
    endTime: hasEnd ? endTime : null,
    target: parseTarget(target),
  });
  const problem = parsed.success ? null : (parsed.error.issues[0]?.message ?? 'Check these settings.');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (parsed.success) update.mutate({ key: holiday.key, update: parsed.data }, { onSuccess: onClose });
  };

  return (
    <Dialog title={`Edit ${holiday.name}`} open onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <p className="text-sm text-ink-300">
          These changes apply every year, in {holiday.timeZone}. The date is worked out for each year.
        </p>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium text-ink-200">What it shows, and when</legend>
          {steps.map((step, index) => (
            <div key={step.id} className="flex flex-wrap items-end gap-2 rounded-lg bg-ink-850 p-2.5">
              <div className="w-32">
                <Field label={index === 0 ? 'Starts at' : `Step ${index + 1} at`}>
                  {(props) => (
                    <input {...props} type="time" className={inputClass} required value={step.time} onChange={(e) => change(step.id, { time: e.target.value })} />
                  )}
                </Field>
              </div>
              <div className="min-w-48 flex-1">
                <Field label={steps.length === 1 ? 'Shows' : `Step ${index + 1} shows`}>
                  {(props) => (
                    <select {...props} className={inputClass} required value={step.presetId} onChange={(e) => change(step.id, { presetId: e.target.value })}>
                      {presets.data ? <PresetOptions presets={presets.data} /> : null}
                    </select>
                  )}
                </Field>
              </div>
              {steps.length > 1 ? (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove step ${index + 1}`}
                  icon={<Trash2 className="size-4" aria-hidden />}
                  onClick={() => setSteps((rows) => rows.filter((row) => row.id !== step.id))}
                />
              ) : null}
            </div>
          ))}
          <Button size="sm" icon={<Plus className="size-4" aria-hidden />} disabled={steps.length >= 12} onClick={addStep}>
            Add a step
          </Button>
          <p className="text-xs text-ink-400">Add steps to change what the lights show during the evening. They run in time order.</p>
        </fieldset>

        <div className="rounded-lg bg-ink-850 p-2.5">
          <label className="flex min-h-9 items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={hasEnd} onChange={(e) => setHasEnd(e.target.checked)} />
            Turn the lights off afterward
          </label>
          {hasEnd ? (
            <div className="mt-2 w-32">
              <Field label="Off at">
                {(props) => <input {...props} type="time" className={inputClass} required value={endTime} onChange={(e) => setEndTime(e.target.value)} />}
              </Field>
            </div>
          ) : (
            <p className="text-xs text-ink-400">The lights stay on until something else turns them off, such as your own schedule.</p>
          )}
        </div>

        <Field label="Which lights">
          {(props) => (
            <select {...props} className={inputClass} required value={target} onChange={(e) => setTarget(e.target.value)}>
              <TargetOptions />
            </select>
          )}
        </Field>
        <p className="text-xs text-ink-400">A preset made for specific strings only changes those strings, even if you choose more lights here.</p>

        {problem ? <Notice tone="warn">{problem}</Notice> : null}
        {presets.isError ? <ErrorNotice error={presets.error} title="Could not load your presets" /> : null}
        {update.isError ? <ErrorNotice error={update.error} title="The changes were not saved" /> : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" busy={update.isPending} disabled={!parsed.success}>
            Save changes
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {original && presets.data ? (
            <Button variant="ghost" className="sm:ml-auto" icon={<RotateCcw className="size-4" aria-hidden />} onClick={useOriginal}>
              Fill in original settings
            </Button>
          ) : null}
        </div>
      </form>
    </Dialog>
  );
}
