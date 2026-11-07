import crypto from 'node:crypto';
import type { DeviceAction, GroupCreate, GroupDto, GroupUpdate, RunResultDto } from '@glm/shared';
import type { ActivityService } from '../activity/activity-service.js';
import type { ActionService } from '../commands/action-service.js';
import type { Db } from '../database/database.js';
import type { DeviceRepository } from '../devices/device-repository.js';
import type { Clock } from '../shared/clock.js';
import { conflict, notFound, unprocessable } from '../shared/errors.js';

interface GroupRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

/** Groups exist only in this app. No Govee group capability is used. */
export class GroupService {
  constructor(
    private readonly db: Db,
    private readonly devices: DeviceRepository,
    private readonly actions: ActionService,
    private readonly activity: ActivityService,
    private readonly clock: Clock,
  ) {}

  private toDto(row: GroupRow): GroupDto {
    const members = this.db.prepare('SELECT device_id FROM group_devices WHERE group_id = ?').all(row.id) as {
      device_id: string;
    }[];
    return {
      id: row.id,
      name: row.name,
      deviceIds: members.map((m) => m.device_id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  list(): GroupDto[] {
    const rows = this.db.prepare('SELECT * FROM groups ORDER BY name COLLATE NOCASE').all() as GroupRow[];
    return rows.map((r) => this.toDto(r));
  }

  find(id: string): GroupDto | null {
    const row = this.db.prepare('SELECT * FROM groups WHERE id = ?').get(id) as GroupRow | undefined;
    return row ? this.toDto(row) : null;
  }

  get(id: string): GroupDto {
    const group = this.find(id);
    if (!group) throw notFound('That group');
    return group;
  }

  private assertDevicesExist(ids: string[]): void {
    const missing = ids.filter((id) => !this.devices.get(id));
    if (missing.length > 0) {
      throw unprocessable('unknown_device', 'A selected device does not exist.', { deviceIds: missing });
    }
  }

  private assertNameFree(name: string, exceptId?: string): void {
    const row = this.db.prepare('SELECT id FROM groups WHERE name = ? COLLATE NOCASE').get(name) as
      | { id: string }
      | undefined;
    if (row && row.id !== exceptId) {
      throw conflict('name_taken', `A group named "${name}" already exists.`);
    }
  }

  create(input: GroupCreate): GroupDto {
    this.assertNameFree(input.name);
    this.assertDevicesExist(input.deviceIds);
    const id = crypto.randomUUID();
    const now = this.clock.nowIso();
    this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO groups (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(id, input.name, now, now);
      this.setMembers(id, input.deviceIds);
    })();
    this.activity.record({ eventType: 'group', outcome: 'info', message: `Created group "${input.name}".` });
    return this.get(id);
  }

  update(id: string, input: GroupUpdate): GroupDto {
    this.get(id);
    if (input.name !== undefined) this.assertNameFree(input.name, id);
    if (input.deviceIds !== undefined) this.assertDevicesExist(input.deviceIds);
    this.db.transaction(() => {
      if (input.name !== undefined) {
        this.db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(input.name, id);
      }
      if (input.deviceIds !== undefined) this.setMembers(id, input.deviceIds);
      this.db.prepare('UPDATE groups SET updated_at = ? WHERE id = ?').run(this.clock.nowIso(), id);
    })();
    return this.get(id);
  }

  private setMembers(id: string, deviceIds: string[]): void {
    this.db.prepare('DELETE FROM group_devices WHERE group_id = ?').run(id);
    const insert = this.db.prepare('INSERT INTO group_devices (group_id, device_id) VALUES (?, ?)');
    for (const deviceId of new Set(deviceIds)) insert.run(id, deviceId);
  }

  delete(id: string): void {
    const group = this.get(id);
    const users = this.schedulesUsing(id);
    if (users.length > 0) {
      throw conflict(
        'group_in_use',
        `This group is used by ${users.length} schedule(s): ${users.join(', ')}. Change or delete them first.`,
      );
    }
    this.db.prepare('DELETE FROM groups WHERE id = ?').run(id);
    this.activity.record({ eventType: 'group', outcome: 'info', message: `Deleted group "${group.name}".` });
  }

  private schedulesUsing(groupId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT name FROM schedules
         WHERE json_extract(target_json, '$.type') = 'group' AND json_extract(target_json, '$.groupId') = ?`,
      )
      .all(groupId) as { name: string }[];
    return rows.map((r) => r.name);
  }

  /** Applies one action to every member, checking each device's capabilities on its own. */
  async applyAction(id: string, action: DeviceAction, correlationId?: string): Promise<RunResultDto> {
    const group = this.get(id);
    const members = this.devices.getMany(group.deviceIds);
    return this.actions.runPlan(
      { type: 'group', id, name: group.name, correlationId },
      members.map((device) => ({ device, actions: [action] })),
    );
  }
}
