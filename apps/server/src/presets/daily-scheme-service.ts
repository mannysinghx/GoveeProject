import {
  addDays,
  DAILY_SCHEME_PRESET,
  dailyScheme,
  hasDailySchemes,
  localDate,
  type AppSettings,
  type DailySchemeDayDto,
  type DailySchemeDto,
  type DailySchemeUpdate,
  type GroupDto,
  type ScheduleDto,
} from '@glm/shared';
import type { ActivityService } from '../activity/activity-service.js';
import type { Db } from '../database/database.js';
import type { DeviceRepository } from '../devices/device-repository.js';
import type { GroupService } from '../groups/group-service.js';
import type { ScheduleService } from '../scheduler/schedule-service.js';
import type { Clock } from '../shared/clock.js';
import { unprocessable } from '../shared/errors.js';
import type { PresetService } from './preset-service.js';

const SCHEDULE_NAME = 'Daily color scheme';
const GROUP_NAME = 'All light strings';
/** The group the built-in presets keep matched to the light strings. */
const INSTALL_GROUP = 'group:all-strings';
/**
 * Just after the owner's usual late-afternoon switch-on, so the day's scheme is what shows
 * for the evening. Whatever runs last wins, and the owner can pick another time.
 */
export const DEFAULT_DAILY_TIME = '16:05';

/**
 * "Change automatically every day" is an ordinary daily schedule that applies "Today's
 * Color Scheme". Nothing is stored apart from that schedule, so it can also be edited,
 * paused or deleted under Schedules, and this reads back whatever it finds there.
 */
export class DailySchemeService {
  constructor(
    private readonly db: Db,
    private readonly devices: DeviceRepository,
    private readonly groups: GroupService,
    private readonly presets: PresetService,
    private readonly schedules: ScheduleService,
    private readonly activity: ActivityService,
    private readonly getSettings: () => AppSettings,
    private readonly clock: Clock,
  ) {}

  private day(date: string): DailySchemeDayDto {
    const scheme = dailyScheme(date);
    return {
      date,
      key: scheme.key,
      name: scheme.name,
      description: scheme.description,
      colors: scheme.colors,
      presetId: this.presets.findByBuiltinKey(scheme.key)?.id ?? null,
    };
  }

  /** The schedule that changes the look each day, if there is one. An enabled one is preferred. */
  private schedule(presetId: string | null): ScheduleDto | null {
    if (!presetId) return null;
    const matches = this.schedules
      .list()
      .filter((s) => s.action.type === 'preset' && s.action.presetId === presetId && s.recurrence.kind === 'daily');
    return matches.find((s) => s.enabled) ?? matches[0] ?? null;
  }

  status(): DailySchemeDto {
    const timeZone = this.getSettings().defaultTimeZone;
    const today = localDate(timeZone, this.clock.nowMs());
    const presetId = this.presets.findByBuiltinKey(DAILY_SCHEME_PRESET.key)?.id ?? null;
    const schedule = this.schedule(presetId);

    const upcoming: DailySchemeDayDto[] = [];
    if (hasDailySchemes(today)) {
      for (let date = addDays(today, 1); hasDailySchemes(date); date = addDays(date, 1)) upcoming.push(this.day(date));
    }

    return {
      presetId,
      timeZone,
      today: this.day(today),
      upcoming,
      autoChange: {
        enabled: schedule?.enabled ?? false,
        time: schedule && 'time' in schedule.recurrence ? schedule.recurrence.time : DEFAULT_DAILY_TIME,
        scheduleId: schedule?.id ?? null,
        nextRun: schedule?.nextRun ?? null,
        targetName: schedule?.targetName ?? null,
      },
    };
  }

  /** Every light string, as one target. Uses the built-in group, or makes one if it was deleted. */
  private allStrings(): GroupDto {
    const row = this.db.prepare('SELECT value FROM builtin_installs WHERE install_key = ?').get(INSTALL_GROUP) as
      | { value: string | null }
      | undefined;
    const existing = row?.value ? this.groups.find(row.value) : null;
    if (existing && existing.deviceIds.length > 0) return existing;

    const strings = this.devices
      .list()
      .filter((d) => d.discoveryStatus === 'present' && d.capabilities.some((c) => c.kind === 'segmentedColor'));
    if (strings.length === 0) {
      throw unprocessable('no_light_strings', 'No light string that can show patterns has been found yet.');
    }
    const byName = this.groups.list().find((g) => g.name.toLowerCase() === GROUP_NAME.toLowerCase());
    if (byName && byName.deviceIds.length > 0) return byName;
    return this.groups.create({ name: byName ? `${GROUP_NAME} (daily scheme)` : GROUP_NAME, deviceIds: strings.map((d) => d.id) });
  }

  set(update: DailySchemeUpdate): DailySchemeDto {
    const presetId = this.presets.findByBuiltinKey(DAILY_SCHEME_PRESET.key)?.id ?? null;
    if (!presetId) {
      throw unprocessable('daily_scheme_not_ready', 'The color schemes are set up once your lights have been found. Try Check lights now on the dashboard.');
    }
    const existing = this.schedule(presetId);

    if (!existing) {
      // Nothing to turn off, and nothing is created just to be disabled.
      if (!update.enabled) return this.status();
      const group = this.allStrings();
      this.schedules.create({
        name: this.schedules.list().some((s) => s.name.toLowerCase() === SCHEDULE_NAME.toLowerCase())
          ? `${SCHEDULE_NAME} (auto-change)`
          : SCHEDULE_NAME,
        enabled: true,
        timeZone: this.getSettings().defaultTimeZone,
        recurrence: { kind: 'daily', time: update.time },
        target: { type: 'group', groupId: group.id },
        action: { type: 'preset', presetId },
        // If the app was down at the time, the day's look should still arrive.
        missedRunPolicy: 'run_latest',
      });
      this.activity.record({
        eventType: 'schedule',
        outcome: 'info',
        message: `Color schemes now change automatically every day at ${update.time}.`,
      });
      return this.status();
    }

    if ('time' in existing.recurrence && existing.recurrence.time !== update.time) {
      this.schedules.update(existing.id, { recurrence: { ...existing.recurrence, time: update.time } });
    }
    if (existing.enabled !== update.enabled) this.schedules.setEnabled(existing.id, update.enabled);
    return this.status();
  }
}
