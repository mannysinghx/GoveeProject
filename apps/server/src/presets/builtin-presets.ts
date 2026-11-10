import crypto from 'node:crypto';
import type { Logger } from 'pino';
import {
  BUILTIN_PRESETS,
  builtinPresetActions,
  FIREWORKS_PRESET,
  HOLIDAYS,
  addMinutesToTime,
  builtinPresetByKey,
  orderLightStrings,
  type HolidayDefinition,
  type AppSettings,
  type BuiltinString,
  type GroupDto,
  type PresetActionInput,
  type SegmentedColorCapability,
} from '@glm/shared';
import type { ActivityService } from '../activity/activity-service.js';
import type { Db } from '../database/database.js';
import type { DeviceRecord } from '../devices/device-repository.js';
import type { DeviceService } from '../devices/device-service.js';
import type { SceneStore } from '../devices/scene-store.js';
import type { GroupService } from '../groups/group-service.js';
import type { ScheduleService } from '../scheduler/schedule-service.js';
import type { Clock } from '../shared/clock.js';

const RESYNC_MS = 3600 * 1000;
const GROUP_NAME = 'All light strings';
const INSTALL_GROUP = 'group:all-strings';
const INSTALL_FIREWORKS = 'schedule:new-year-fireworks';
/** How long the show runs before the lights go off. The owner can change this schedule. */
const FIREWORKS_END_TIME = '00:30';

function segmentCapability(device: DeviceRecord): SegmentedColorCapability | undefined {
  return device.capabilities.find((c) => c.kind === 'segmentedColor') as SegmentedColorCapability | undefined;
}

/**
 * Keeps the built-in presets matched to the lights on the account, and sets up the New
 * Year show once. They are ordinary presets, so they can be applied and scheduled like
 * any other. They are rebuilt when lights or their arrangement change, which is why
 * they are read-only: the owner duplicates one to make it their own.
 */
export class BuiltinPresets {
  private timer: NodeJS.Timeout | null = null;
  private started = false;
  private current: Promise<void> | null = null;

  constructor(
    private readonly db: Db,
    private readonly devices: DeviceService,
    private readonly scenes: SceneStore,
    private readonly groups: GroupService,
    private readonly schedules: ScheduleService,
    private readonly activity: ActivityService,
    private readonly getSettings: () => AppSettings,
    private readonly isConfigured: () => boolean,
    private readonly logger: Logger,
    private readonly clock: Clock,
  ) {}

  start(): void {
    this.started = true;
    this.devices.onDiscovered(() => this.changed());
    this.changed();
    this.timer = setInterval(() => this.changed(), RESYNC_MS);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.current;
  }

  /** Called when lights or their arrangement may have changed. Never throws. */
  changed(): void {
    if (this.started) void this.sync();
  }

  /** Overlapping requests share one run. Never rejects. */
  sync(): Promise<void> {
    if (this.current) return this.current;
    this.current = this.run()
      .catch((error: unknown) => {
        this.logger.error({ err: error }, 'Could not update the built-in presets');
      })
      .finally(() => {
        this.current = null;
      });
    return this.current;
  }

  private async run(): Promise<void> {
    const strings = this.devices.repository
      .list()
      .filter((d) => d.discoveryStatus === 'present' && segmentCapability(d) !== undefined);
    // With no lights known yet, or all temporarily missing, keep whatever is there.
    if (strings.length === 0) return;

    await this.fetchMissingScenes(strings);
    const saved = this.getSettings().patternStrings;
    const ordered = orderLightStrings(strings, saved);
    const reversed = new Set(saved.filter((entry) => entry.reversed).map((entry) => entry.deviceId));
    const inputs: BuiltinString[] = ordered.map((device) => {
      const capability = segmentCapability(device) as SegmentedColorCapability;
      const known = this.scenes.list(device.id).filter((scene) => scene.kind === 'dynamic');
      return {
        deviceId: device.id,
        segments: reversed.has(device.id) ? [...capability.segments].reverse() : capability.segments,
        maxSelect: capability.maxSelect,
        hasBrightness: device.capabilities.some((c) => c.kind === 'brightness'),
        findScene: (name) => {
          const scene = known.find((s) => s.name.toLowerCase() === name.toLowerCase());
          return scene ? { key: scene.key, name: scene.name } : null;
        },
      };
    });

    const added = this.writePresets(inputs);
    if (added > 0) {
      this.activity.record({ eventType: 'preset', outcome: 'info', message: `Added ${added} built-in festival preset(s).` });
    }
    const group = this.syncGroup(ordered);
    this.installFireworks(group);
    this.installHolidays(group);
  }

  /** Scenes are only fetched once per light here. A failure leaves the color fallback, and is retried. */
  private async fetchMissingScenes(strings: DeviceRecord[]): Promise<void> {
    if (!this.isConfigured()) return;
    for (const device of strings) {
      if (device.scenesFetchedAt || !device.capabilities.some((c) => c.kind === 'scene')) continue;
      try {
        await this.devices.refreshScenes(device.id);
      } catch (error) {
        this.logger.warn({ err: error, deviceId: device.id }, 'Could not fetch scenes for built-in presets');
      }
    }
  }

  private presetName(wanted: string, key: string): string {
    const clash = this.db
      .prepare('SELECT 1 FROM presets WHERE name = ? COLLATE NOCASE AND (builtin_key IS NULL OR builtin_key != ?)')
      .get(wanted, key);
    return clash ? `${wanted} (built-in)` : wanted;
  }

  private writePresets(strings: BuiltinString[]): number {
    const now = this.clock.nowIso();
    let added = 0;
    const insertAction = this.db.prepare(
      `INSERT INTO preset_actions (preset_id, device_id, action_type, action_payload_json, execution_order)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const writeActions = (presetId: string, actions: PresetActionInput[]) => {
      this.db.prepare('DELETE FROM preset_actions WHERE preset_id = ?').run(presetId);
      actions.forEach((entry, order) => {
        insertAction.run(presetId, entry.deviceId, entry.action.type, JSON.stringify(entry.action), order);
      });
    };
    this.db.transaction(() => {
      for (const definition of BUILTIN_PRESETS) {
        const actions = builtinPresetActions(definition, strings);
        const row = this.db.prepare('SELECT id FROM presets WHERE builtin_key = ?').get(definition.key) as
          | { id: string }
          | undefined;
        if (!row) {
          const id = crypto.randomUUID();
          this.db
            .prepare(
              `INSERT INTO presets (id, name, description, created_at, updated_at, builtin_key) VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .run(id, this.presetName(definition.name, definition.key), definition.description, now, now, definition.key);
          writeActions(id, actions);
          added += 1;
          continue;
        }
        const existing = this.db
          .prepare('SELECT device_id, action_payload_json FROM preset_actions WHERE preset_id = ? ORDER BY execution_order')
          .all(row.id) as { device_id: string | null; action_payload_json: string }[];
        const same =
          existing.length === actions.length &&
          existing.every(
            (step, i) =>
              step.device_id === actions[i]?.deviceId && step.action_payload_json === JSON.stringify(actions[i]?.action),
          );
        if (!same) {
          writeActions(row.id, actions);
          this.db.prepare('UPDATE presets SET updated_at = ? WHERE id = ?').run(now, row.id);
        }
      }
    })();
    return added;
  }

  private installed(key: string): string | null | undefined {
    const row = this.db.prepare('SELECT value FROM builtin_installs WHERE install_key = ?').get(key) as
      | { value: string | null }
      | undefined;
    return row ? row.value : undefined;
  }

  private markInstalled(key: string, value: string | null): void {
    this.db
      .prepare('INSERT INTO builtin_installs (install_key, value, installed_at) VALUES (?, ?, ?)')
      .run(key, value, this.clock.nowIso());
  }

  /** The group the automatic show targets, kept to the current strings. Removed means left removed. */
  private syncGroup(strings: DeviceRecord[]): GroupDto | null {
    const ids = strings.map((d) => d.id);
    const groupId = this.installed(INSTALL_GROUP);
    if (groupId === undefined) {
      const clash = this.groups.list().find((g) => g.name.toLowerCase() === GROUP_NAME.toLowerCase());
      const group = this.groups.create({ name: clash ? `${GROUP_NAME} (built-in)` : GROUP_NAME, deviceIds: ids });
      this.markInstalled(INSTALL_GROUP, group.id);
      return group;
    }
    const group = groupId ? this.groups.find(groupId) : null;
    if (!group) return null;
    const same = group.deviceIds.length === ids.length && ids.every((id) => group.deviceIds.includes(id));
    return same ? group : this.groups.update(group.id, { deviceIds: ids });
  }

  /** Each show is set up once, and all of it or none of it. Deleted stays deleted. */
  private installHolidays(group: GroupDto | null): void {
    if (!group) return;
    let added = 0;
    for (const holiday of HOLIDAYS) {
      const installKey = `holiday:${holiday.key}`;
      if (this.installed(installKey) !== undefined) continue;
      try {
        this.db.transaction(() => {
          if (holiday.key === FIREWORKS_PRESET.key) this.tagFireworks();
          else this.createShow(holiday, group);
          this.markInstalled(installKey, null);
        })();
        if (holiday.key !== FIREWORKS_PRESET.key) added += 1;
      } catch (error) {
        // One bad show must not stop the others. The next sync tries it again.
        this.logger.error({ err: error, holiday: holiday.key }, 'Could not set up a holiday show');
      }
    }
    if (added > 0) {
      this.activity.record({ eventType: 'schedule', outcome: 'info', message: `Set up ${added} holiday show(s). See Schedules.` });
    }
  }

  private presetId(key: string): string {
    const row = this.db.prepare('SELECT id FROM presets WHERE builtin_key = ?').get(key) as { id: string } | undefined;
    if (!row) throw new Error(`Built-in preset ${key} is missing.`);
    return row.id;
  }

  private createShow(holiday: HolidayDefinition, group: GroupDto): void {
    const timeZone = this.getSettings().defaultTimeZone;
    const target = { type: 'group' as const, groupId: group.id };
    holiday.steps.forEach((step, index) => {
      const time = addMinutesToTime(holiday.startTime, step.minutesAfterStart);
      this.schedules.create(
        {
          name: index === 0 ? holiday.name : `${builtinPresetByKey(step.presetKey)?.name ?? holiday.name} (${time})`,
          enabled: true,
          timeZone,
          recurrence: { kind: 'holiday', holiday: holiday.key, time },
          target,
          action: { type: 'preset', presetId: this.presetId(step.presetKey) },
          missedRunPolicy: 'skip',
        },
        { key: holiday.key, quiet: index > 0 },
      );
    });
    if (holiday.endTime === null) return;
    this.schedules.create(
      {
        name: `${holiday.name}: end`,
        enabled: true,
        timeZone,
        recurrence: { kind: 'holiday', holiday: holiday.key, time: holiday.endTime },
        target,
        action: { type: 'power', on: false },
        // Late is better than lights left running all night.
        missedRunPolicy: 'run_latest',
      },
      { key: holiday.key, quiet: true },
    );
  }

  /** The fireworks schedules came first, so they join the calendar by being tagged. */
  private tagFireworks(): void {
    const key = FIREWORKS_PRESET.key;
    const showId = this.installed(INSTALL_FIREWORKS);
    if (showId) this.db.prepare('UPDATE schedules SET builtin_show = ? WHERE id = ?').run(key, showId);
    this.db
      .prepare(`UPDATE schedules SET builtin_show = ?, quiet = 1 WHERE name = ? AND builtin_show IS NULL`)
      .run(key, `${FIREWORKS_PRESET.name}: end`);
  }

  /** Runs once. If the owner later deletes these schedules, they stay deleted. */
  private installFireworks(group: GroupDto | null): void {
    if (this.installed(INSTALL_FIREWORKS) !== undefined || !group) return;
    const preset = this.db.prepare('SELECT id FROM presets WHERE builtin_key = ?').get(FIREWORKS_PRESET.key) as
      | { id: string }
      | undefined;
    if (!preset) return;
    const timeZone = this.getSettings().defaultTimeZone;
    const target = { type: 'group' as const, groupId: group.id };
    const show = this.schedules.create({
      name: FIREWORKS_PRESET.name,
      enabled: true,
      timeZone,
      recurrence: { kind: 'yearly', month: 1, day: 1, time: '00:00' },
      target,
      action: { type: 'preset', presetId: preset.id },
      // Fireworks at 3 AM after an outage would be worse than none.
      missedRunPolicy: 'skip',
    });
    this.schedules.create({
      name: `${FIREWORKS_PRESET.name}: end`,
      enabled: true,
      timeZone,
      recurrence: { kind: 'yearly', month: 1, day: 1, time: FIREWORKS_END_TIME },
      target,
      action: { type: 'power', on: false },
      // Late is better than lights left running all night.
      missedRunPolicy: 'run_latest',
    });
    this.markInstalled(INSTALL_FIREWORKS, show.id);
    this.activity.record({
      eventType: 'schedule',
      outcome: 'info',
      message: `Set up "${FIREWORKS_PRESET.name}" for 12:00 AM on January 1, ending at 12:30 AM (${timeZone}).`,
    });
  }
}
