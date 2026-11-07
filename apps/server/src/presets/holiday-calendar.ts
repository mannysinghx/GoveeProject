import { DateTime } from 'luxon';
import {
  HOLIDAYS,
  builtinPresetByKey,
  holidayByKey,
  type HolidayDefinition,
  type HolidayDto,
  type Recurrence,
} from '@glm/shared';
import type { ActivityService } from '../activity/activity-service.js';
import type { Db } from '../database/database.js';
import { nextOccurrence } from '../scheduler/occurrences.js';
import type { ScheduleService } from '../scheduler/schedule-service.js';
import type { Clock } from '../shared/clock.js';
import { notFound } from '../shared/errors.js';

/** Lets the owner see, turn off or skip each holiday show as one thing. */
export class HolidayCalendar {
  constructor(
    private readonly db: Db,
    private readonly schedules: ScheduleService,
    private readonly activity: ActivityService,
    private readonly clock: Clock,
  ) {}

  private showSchedules(key: string) {
    return this.schedules.list().filter((schedule) => schedule.builtinShow === key);
  }

  private describe(holiday: HolidayDefinition): HolidayDto | null {
    const rows = this.showSchedules(holiday.key);
    // Earliest first, so the first is the start and the last is the end.
    const timed = rows
      .filter((row) => 'time' in row.recurrence)
      .sort((a, b) => ('time' in a.recurrence && 'time' in b.recurrence ? a.recurrence.time.localeCompare(b.recurrence.time) : 0));
    const first = timed[0];
    if (!first) return null;
    const last = timed.at(-1);
    const next = nextOccurrence(first.recurrence as Recurrence, first.timeZone, this.clock.nowMs());
    const skipped = next
      ? this.db.prepare('SELECT 1 FROM show_skips WHERE show_key = ? AND local_date = ?').get(holiday.key, next.localDate) !== undefined
      : false;
    const colors = holiday.steps.flatMap((step) => builtinPresetByKey(step.presetKey)?.colors ?? []);
    return {
      key: holiday.key,
      name: holiday.name,
      group: holiday.group,
      description: holiday.description,
      enabled: rows.some((row) => row.enabled),
      nextDate: next?.localDate ?? null,
      startTime: 'time' in first.recurrence ? first.recurrence.time : holiday.startTime,
      endTime: last && last !== first && last.action.type === 'power' && 'time' in last.recurrence ? last.recurrence.time : null,
      timeZone: first.timeZone,
      skipped,
      colors: [...new Set(colors)],
      problem: rows.find((row) => row.problem)?.problem ?? null,
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
