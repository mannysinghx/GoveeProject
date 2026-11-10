import { DateTime } from 'luxon';
import {
  HOLIDAYS,
  addMinutesToTime,
  describeTime,
  holidayByKey,
  type HolidayDefinition,
  type HolidayDto,
  type HolidayStepDto,
  type HolidayUpdate,
  type PresetDto,
  type Recurrence,
  type ScheduleDto,
} from '@glm/shared';
import type { ActivityService } from '../activity/activity-service.js';
import type { Db } from '../database/database.js';
import { nextOccurrence } from '../scheduler/occurrences.js';
import type { ScheduleService } from '../scheduler/schedule-service.js';
import type { Clock } from '../shared/clock.js';
import { notFound, unprocessable } from '../shared/errors.js';
import type { PresetService } from './preset-service.js';

type TimedRecurrence = Extract<Recurrence, { time: string }>;

function timeOf(schedule: ScheduleDto): string | null {
  return 'time' in schedule.recurrence ? schedule.recurrence.time : null;
}

function byTime(a: ScheduleDto, b: ScheduleDto): number {
  return (timeOf(a) ?? '').localeCompare(timeOf(b) ?? '');
}

/** The colors a preset shows, for the calendar's color strip. */
function presetColors(preset: PresetDto | null): string[] {
  if (!preset) return [];
  if (preset.builtin) return preset.builtin.colors;
  return preset.actions.flatMap(({ action }) => (action.type === 'segmentColor' || action.type === 'color' ? [action.hex] : []));
}

/** Lets the owner see, change, turn off or skip each holiday show as one thing. */
export class HolidayCalendar {
  constructor(
    private readonly db: Db,
    private readonly schedules: ScheduleService,
    private readonly presets: PresetService,
    private readonly activity: ActivityService,
    private readonly clock: Clock,
  ) {}

  private showSchedules(key: string): ScheduleDto[] {
    return this.schedules.list().filter((schedule) => schedule.builtinShow === key);
  }

  /** The schedules that show something, and the ones that turn the lights off, earliest first. */
  private parts(key: string): { steps: ScheduleDto[]; ends: ScheduleDto[]; all: ScheduleDto[] } {
    const all = this.showSchedules(key);
    const timed = all.filter((row) => timeOf(row) !== null).sort(byTime);
    return {
      all,
      steps: timed.filter((row) => row.action.type === 'preset'),
      ends: timed.filter((row) => row.action.type === 'power' && !row.action.on),
    };
  }

  /** True when the show is no longer what the app first set up, so its description may not fit. */
  private isCustomized(holiday: HolidayDefinition, steps: HolidayStepDto[], endTime: string | null): boolean {
    const original = holiday.steps.map((step) => ({
      time: addMinutesToTime(holiday.startTime, step.minutesAfterStart),
      key: step.presetKey,
    }));
    return (
      endTime !== holiday.endTime ||
      steps.length !== original.length ||
      steps.some((step, i) => step.time !== original[i]?.time || this.presets.find(step.presetId)?.builtin?.key !== original[i]?.key)
    );
  }

  private describe(holiday: HolidayDefinition): HolidayDto | null {
    const { all, steps, ends } = this.parts(holiday.key);
    const first = steps[0];
    if (!first) return null;
    const next = nextOccurrence(first.recurrence, first.timeZone, this.clock.nowMs());
    const skipped = next
      ? this.db.prepare('SELECT 1 FROM show_skips WHERE show_key = ? AND local_date = ?').get(holiday.key, next.localDate) !== undefined
      : false;
    const stepDtos: HolidayStepDto[] = steps.map((row) => {
      const presetId = row.action.type === 'preset' ? row.action.presetId : '';
      return { time: timeOf(row) as string, presetId, presetName: this.presets.find(presetId)?.name ?? 'Deleted preset' };
    });
    const endTime = ends[0] ? timeOf(ends[0]) : null;
    const customized = this.isCustomized(holiday, stepDtos, endTime);
    return {
      key: holiday.key,
      name: holiday.name,
      group: holiday.group,
      description: customized ? `Shows ${[...new Set(stepDtos.map((step) => step.presetName))].join(', then ')}.` : holiday.description,
      enabled: all.some((row) => row.enabled),
      customized,
      nextDate: next?.localDate ?? null,
      startTime: stepDtos[0]?.time as string,
      endTime,
      timeZone: first.timeZone,
      skipped,
      colors: [...new Set(stepDtos.flatMap((step) => presetColors(this.presets.find(step.presetId))))],
      steps: stepDtos,
      target: first.target,
      targetName: first.targetName,
      problem: all.find((row) => row.problem)?.problem ?? null,
    };
  }

  list(): HolidayDto[] {
    const items = HOLIDAYS.flatMap((holiday) => {
      const item = this.describe(holiday);
      return item ? [item] : [];
    });
    // Soonest first, with any that have no known next date at the end.
    return items.sort((a, b) => (a.nextDate ?? '9999').localeCompare(b.nextDate ?? '9999') || a.startTime.localeCompare(b.startTime));
  }

  private definition(key: string): HolidayDefinition {
    const holiday = holidayByKey(key);
    if (!holiday || this.showSchedules(key).length === 0) throw notFound('That holiday');
    return holiday;
  }

  /**
   * Changes a show's times, what it shows, and which lights it uses. Existing schedules are
   * updated where they are, rather than replaced, so their history survives and a step that
   * has already run today cannot run a second time. Only a real change of time can make a
   * step run again, and a time already past today waits for the next date.
   */
  update(key: string, input: HolidayUpdate): HolidayDto[] {
    const holiday = this.definition(key);
    for (const step of input.steps) {
      if (!this.presets.find(step.presetId)) throw unprocessable('unknown_preset', 'One of those presets no longer exists.');
    }
    const steps = [...input.steps].sort((a, b) => a.time.localeCompare(b.time));
    const nameFor = (index: number, step: (typeof steps)[number]) =>
      index === 0 ? holiday.name : `${this.presets.get(step.presetId).name} (${step.time})`;

    this.db.transaction(() => {
      const { all, steps: stepRows, ends } = this.parts(key);
      const template = stepRows[0] ?? ends[0];
      // Keeps each show's kind of date, such as "every January 1" for the fireworks.
      const recurrenceAt = (time: string): TimedRecurrence =>
        template ? ({ ...(template.recurrence as TimedRecurrence), time } as TimedRecurrence) : { kind: 'holiday', holiday: key, time };
      const enabled = all.some((row) => row.enabled);
      const timeZone = template?.timeZone ?? all[0]?.timeZone ?? 'UTC';
      const setQuiet = this.db.prepare('UPDATE schedules SET quiet = ? WHERE id = ?');

      steps.forEach((step, index) => {
        const row = stepRows[index];
        const action = { type: 'preset' as const, presetId: step.presetId };
        if (row) {
          // Only touch the timing if it changed: that also resets what counts as a missed run.
          const sameTime = timeOf(row) === step.time;
          this.schedules.update(row.id, {
            name: nameFor(index, step),
            target: input.target,
            action,
            ...(sameTime ? {} : { recurrence: recurrenceAt(step.time) }),
          });
          setQuiet.run(index === 0 ? 0 : 1, row.id);
        } else {
          this.schedules.create(
            {
              name: nameFor(index, step),
              enabled,
              timeZone,
              recurrence: recurrenceAt(step.time),
              target: input.target,
              action,
              missedRunPolicy: 'skip',
            },
            { key, quiet: index > 0 },
          );
        }
      });
      for (const extra of stepRows.slice(steps.length)) this.schedules.delete(extra.id);

      const [end, ...extraEnds] = ends;
      for (const extra of extraEnds) this.schedules.delete(extra.id);
      if (input.endTime === null) {
        if (end) this.schedules.delete(end.id);
      } else if (end) {
        this.schedules.update(end.id, {
          target: input.target,
          ...(timeOf(end) === input.endTime ? {} : { recurrence: recurrenceAt(input.endTime) }),
        });
      } else {
        this.schedules.create(
          {
            name: `${holiday.name}: end`,
            enabled,
            timeZone,
            recurrence: recurrenceAt(input.endTime),
            target: input.target,
            action: { type: 'power', on: false },
            missedRunPolicy: 'run_latest',
          },
          { key, quiet: true },
        );
      }
    })();

    const window = `${describeTime(steps[0]?.time as string)}${input.endTime ? ` to ${describeTime(input.endTime)}` : ''}`;
    this.activity.record({ eventType: 'schedule', outcome: 'info', message: `Changed ${holiday.name}: ${window}, ${steps.length} step(s).` });
    return this.list();
  }

  setEnabled(key: string, enabled: boolean): HolidayDto[] {
    this.definition(key);
    for (const schedule of this.showSchedules(key)) {
      if (schedule.enabled !== enabled) this.schedules.setEnabled(schedule.id, enabled);
    }
    return this.list();
  }

  /** Skips, or un-skips, the next date only. Later years are not affected. */
  setSkipped(key: string, skip: boolean): HolidayDto[] {
    const holiday = this.definition(key);
    const date = this.describe(holiday)?.nextDate;
    if (!date) return this.list();
    if (skip) {
      this.db
        .prepare('INSERT OR IGNORE INTO show_skips (show_key, local_date, created_at) VALUES (?, ?, ?)')
        .run(key, date, this.clock.nowIso());
    } else {
      this.db.prepare('DELETE FROM show_skips WHERE show_key = ? AND local_date = ?').run(key, date);
    }
    this.activity.record({
      eventType: 'schedule',
      outcome: 'info',
      message: `${skip ? 'Skipping' : 'No longer skipping'} ${holiday.name} on ${DateTime.fromISO(date).toLocaleString(DateTime.DATE_MED)}.`,
    });
    return this.list();
  }
}
