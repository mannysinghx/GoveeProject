import crypto from 'node:crypto';
import type {
  CommandSourceType,
  DeviceAction,
  PresetActionDto,
  PresetActionInput,
  PresetCreate,
  PresetDto,
  PresetUpdate,
  RunResultDto,
  Target,
} from '@glm/shared';
import { describeAction } from '@glm/shared';
import type { ActivityService } from '../activity/activity-service.js';
import type { ActionService, DevicePlan, PlannedSkip } from '../commands/action-service.js';
import type { Db } from '../database/database.js';
import { buildCommand } from '../devices/command-builder.js';
import type { DeviceRecord, DeviceRepository } from '../devices/device-repository.js';
import type { SceneStore } from '../devices/scene-store.js';
import type { GroupService } from '../groups/group-service.js';
import type { Clock } from '../shared/clock.js';
import { AppError, conflict, notFound, unprocessable } from '../shared/errors.js';

interface PresetRow {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

interface ActionRow {
  id: number;
  preset_id: string;
  device_id: string | null;
  device_name: string | null;
  action_payload_json: string;
  execution_order: number;
}

export class PresetService {
  constructor(
    private readonly db: Db,
    private readonly devices: DeviceRepository,
    private readonly scenes: SceneStore,
    private readonly groups: GroupService,
    private readonly actions: ActionService,
    private readonly activity: ActivityService,
    private readonly clock: Clock,
  ) {}

  private actionsFor(presetId: string): PresetActionDto[] {
    const rows = this.db
      .prepare(
        `SELECT a.*, d.name AS device_name
         FROM preset_actions a LEFT JOIN devices d ON d.id = a.device_id
         WHERE a.preset_id = ?
         ORDER BY a.execution_order`,
      )
      .all(presetId) as ActionRow[];
    return rows.map((row) => {
      const action = JSON.parse(row.action_payload_json) as DeviceAction;
      return {
        id: row.id,
        deviceId: row.device_id,
        deviceName: row.device_name,
        action,
        summary: describeAction(action),
        order: row.execution_order,
      };
    });
  }

  private toDto(row: PresetRow): PresetDto {
    const actions = this.actionsFor(row.id);
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      actions,
      needsTarget: actions.some((a) => a.deviceId === null),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  list(): PresetDto[] {
    const rows = this.db.prepare('SELECT * FROM presets ORDER BY name COLLATE NOCASE').all() as PresetRow[];
    return rows.map((r) => this.toDto(r));
  }

  find(id: string): PresetDto | null {
    const row = this.db.prepare('SELECT * FROM presets WHERE id = ?').get(id) as PresetRow | undefined;
    return row ? this.toDto(row) : null;
  }

  get(id: string): PresetDto {
    const preset = this.find(id);
    if (!preset) throw notFound('That preset');
    return preset;
  }

  private assertNameFree(name: string, exceptId?: string): void {
    const row = this.db.prepare('SELECT id FROM presets WHERE name = ? COLLATE NOCASE').get(name) as
      | { id: string }
      | undefined;
    if (row && row.id !== exceptId) throw conflict('name_taken', `A preset named "${name}" already exists.`);
  }

  /**
   * Actions tied to a device are checked against its current capabilities when
   * saved. Actions with no device are checked at apply time, when the target is known.
   */
  private validateActions(actions: PresetActionInput[]): void {
    const problems: { index: number; message: string }[] = [];
    actions.forEach((entry, index) => {
      if (entry.deviceId === null) return;
      const device = this.devices.get(entry.deviceId);
      if (!device) {
        problems.push({ index, message: 'This device does not exist.' });
        return;
      }
      const built = buildCommand(device, entry.action, this.scenes);
      if (!built.ok) problems.push({ index, message: built.message });
    });
    if (problems.length > 0) {
      const first = problems[0] as { index: number; message: string };
      throw unprocessable(
        'invalid_preset_action',
        `Action ${first.index + 1}: ${first.message}`,
        { problems },
      );
    }
  }

  private insertActions(presetId: string, actions: PresetActionInput[]): void {
    const insert = this.db.prepare(
      `INSERT INTO preset_actions (preset_id, device_id, action_type, action_payload_json, execution_order)
       VALUES (?, ?, ?, ?, ?)`,
    );
    actions.forEach((entry, order) => {
      insert.run(presetId, entry.deviceId, entry.action.type, JSON.stringify(entry.action), order);
    });
  }

  create(input: PresetCreate): PresetDto {
    this.assertNameFree(input.name);
    this.validateActions(input.actions);
    const id = crypto.randomUUID();
    const now = this.clock.nowIso();
    this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO presets (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, input.name, input.description, now, now);
      this.insertActions(id, input.actions);
    })();
    this.activity.record({ eventType: 'preset', outcome: 'info', message: `Created preset "${input.name}".` });
    return this.get(id);
  }

  update(id: string, input: PresetUpdate): PresetDto {
    this.get(id);
    if (input.name !== undefined) this.assertNameFree(input.name, id);
    if (input.actions !== undefined) this.validateActions(input.actions);
    this.db.transaction(() => {
      if (input.name !== undefined) this.db.prepare('UPDATE presets SET name = ? WHERE id = ?').run(input.name, id);
      if (input.description !== undefined) {
        this.db.prepare('UPDATE presets SET description = ? WHERE id = ?').run(input.description, id);
      }
      if (input.actions !== undefined) {
        this.db.prepare('DELETE FROM preset_actions WHERE preset_id = ?').run(id);
        this.insertActions(id, input.actions);
      }
      this.db.prepare('UPDATE presets SET updated_at = ? WHERE id = ?').run(this.clock.nowIso(), id);
    })();
    return this.get(id);
  }

  duplicate(id: string): PresetDto {
    const source = this.get(id);
    let name = `${source.name} copy`;
    for (let n = 2; this.nameTaken(name); n++) name = `${source.name} copy ${n}`;
    return this.create({
      name,
      description: source.description,
      actions: source.actions.map((a) => ({ deviceId: a.deviceId, action: a.action })),
    });
  }

  private nameTaken(name: string): boolean {
    return this.db.prepare('SELECT 1 FROM presets WHERE name = ? COLLATE NOCASE').get(name) !== undefined;
  }

  delete(id: string): void {
    const preset = this.get(id);
    const rows = this.db
      .prepare(
        `SELECT name FROM schedules
         WHERE json_extract(action_json, '$.type') = 'preset' AND json_extract(action_json, '$.presetId') = ?`,
      )
      .all(id) as { name: string }[];
    if (rows.length > 0) {
      throw conflict(
        'preset_in_use',
        `This preset is used by ${rows.length} schedule(s): ${rows.map((r) => r.name).join(', ')}. Change or delete them first.`,
      );
    }
    this.db.prepare('DELETE FROM presets WHERE id = ?').run(id);
    this.activity.record({ eventType: 'preset', outcome: 'info', message: `Deleted preset "${preset.name}".` });
  }

  private resolveTargetDevices(target: Target): DeviceRecord[] {
    if (target.type === 'device') {
      const device = this.devices.get(target.deviceId);
      if (!device) throw notFound('That device');
      return [device];
    }
    const group = this.groups.find(target.groupId);
    if (!group) throw notFound('That group');
    return this.devices.getMany(group.deviceIds);
  }

  /**
   * Builds per-device plans, keeping the preset's order on each device:
   *  - an action with no device applies to every device in the target
   *  - an action tied to a device runs on that device; if a target was chosen and
   *    does not include the device, it is reported as skipped
   * Capabilities are revalidated when each command is built, because they may have
   * changed since the preset was saved.
   */
  private buildPlan(preset: PresetDto, target: Target | undefined): { plans: DevicePlan[]; skipped: PlannedSkip[] } {
    const targetDevices = target ? this.resolveTargetDevices(target) : null;
    if (!target && preset.needsTarget) {
      throw new AppError(
        400,
        'target_required',
        `"${preset.name}" has actions that need a device or group. Pick one to apply it to.`,
      );
    }
    const targetIds = targetDevices ? new Set(targetDevices.map((d) => d.id)) : null;
    const plans = new Map<string, DevicePlan>();
    const skipped: PlannedSkip[] = [];

    const addTo = (device: DeviceRecord, action: DeviceAction) => {
      const plan = plans.get(device.id) ?? { device, actions: [] };
      plan.actions.push(action);
      plans.set(device.id, plan);
    };

    for (const entry of preset.actions) {
      if (entry.deviceId === null) {
        for (const device of targetDevices ?? []) addTo(device, entry.action);
        continue;
      }
      if (targetIds && !targetIds.has(entry.deviceId)) {
        skipped.push({
          deviceId: entry.deviceId,
          deviceName: entry.deviceName ?? 'Unknown device',
          action: entry.action,
          reason: 'This action belongs to a device outside the chosen target.',
        });
        continue;
      }
      const device = this.devices.get(entry.deviceId);
      if (!device) {
        skipped.push({
          deviceId: entry.deviceId,
          deviceName: entry.deviceName ?? 'Unknown device',
          action: entry.action,
          reason: 'This device no longer exists.',
        });
        continue;
      }
      addTo(device, entry.action);
    }
    return { plans: [...plans.values()], skipped };
  }

  /** Runs unsaved steps on a target, in order, with the same checks and reporting as a preset. */
  async applyDraft(name: string, target: Target, actions: DeviceAction[], correlationId?: string): Promise<RunResultDto> {
    const draft: PresetDto = {
      id: 'draft',
      name,
      description: '',
      needsTarget: true,
      createdAt: '',
      updatedAt: '',
      actions: actions.map((action, order) => ({
        id: order,
        deviceId: null,
        deviceName: null,
        action,
        summary: describeAction(action),
        order,
      })),
    };
    const { plans, skipped } = this.buildPlan(draft, target);
    return this.actions.runPlan({ type: 'preset', id: null, name, correlationId }, plans, skipped);
  }

  async apply(
    id: string,
    target: Target | undefined,
    source?: { type: CommandSourceType; id: string; name: string; correlationId?: string | null },
    correlationId?: string,
  ): Promise<RunResultDto> {
    const preset = this.get(id);
    const { plans, skipped } = this.buildPlan(preset, target);
    return this.actions.runPlan(
      source ?? { type: 'preset', id, name: preset.name, correlationId },
      plans,
      skipped,
    );
  }
}
