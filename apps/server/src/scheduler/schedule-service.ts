import crypto from 'node:crypto';
import type {
  DashboardSummaryDto,
  ExecutionStatus,
  MissedRunPolicy,
  Recurrence,
  ScheduleAction,
  ScheduleCreate,
  ScheduleDto,
  ScheduleExecutionDto,
  SchedulePreviewDto,
  SchedulePreviewRequest,
  ScheduleUpdate,
  Target,
} from '@glm/shared';
import { describeScheduleAction } from '@glm/shared';
import type { ActivityService } from '../activity/activity-service.js';
import type { Db } from '../database/database.js';
import type { DeviceRepository } from '../devices/device-repository.js';
import type { GroupService } from '../groups/group-service.js';
import type { PresetService } from '../presets/preset-service.js';
import type { Clock } from '../shared/clock.js';
import { notFound, unprocessable } from '../shared/errors.js';
import { nextOccurrence, previewSchedule, toNextRunDto } from './occurrences.js';

export interface ScheduleRow {
  id: string;
  name: string;
  enabled: number;
  time_zone: string;
  recurrence_json: string;
  target_json: string;
  action_json: string;
  missed_run_policy: MissedRunPolicy;
  next_run_at: string | null;
  last_evaluated_at: string;
  created_at: string;
  updated_at: string;
}

interface ExecutionRow {
  id: string;
  schedule_id: string;
  occurrence_key: string;
  scheduled_for: string;
  started_at: string | null;
  completed_at: string | null;
  status: ExecutionStatus;
  is_recovery: number;
  error_summary: string | null;
  run_id: string | null;
}

function executionToDto(row: ExecutionRow): ScheduleExecutionDto {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    occurrenceKey: row.occurrence_key,
    scheduledFor: row.scheduled_for,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    status: row.status,
    isRecovery: row.is_recovery === 1,
    errorSummary: row.error_summary,
    runId: row.run_id,
  };
}

/** Definitions and history. Scheduler decides when things run. */
export class ScheduleService {
  constructor(
    private readonly db: Db,
    private readonly devices: DeviceRepository,
    private readonly groups: GroupService,
    private readonly presets: PresetService,
    private readonly activity: ActivityService,
    private readonly clock: Clock,
  ) {}

  private describeTarget(target: Target): { name: string; problem: string | null } {
    if (target.type === 'device') {
      const device = this.devices.get(target.deviceId);
      if (!device) return { name: 'Deleted device', problem: 'The target device no longer exists.' };
      if (device.discoveryStatus === 'missing') {
        return { name: device.name, problem: `${device.name} was not in the last Govee device list.` };
      }
      return { name: device.name, problem: null };
    }
    const group = this.groups.find(target.groupId);
    if (!group) return { name: 'Deleted group', problem: 'The target group no longer exists.' };
    if (group.deviceIds.length === 0) return { name: group.name, problem: `Group "${group.name}" has no devices.` };
    return { name: group.name, problem: null };
  }

  private describeAction(action: ScheduleAction): { summary: string; problem: string | null } {
    if (action.type === 'power') return { summary: describeScheduleAction(action), problem: null };
    const preset = this.presets.find(action.presetId);
    if (!preset) return { summary: 'Apply a deleted preset', problem: 'The preset no longer exists.' };
    return { summary: describeScheduleAction(action, preset.name), problem: null };
  }

  private toDto(row: ScheduleRow): ScheduleDto {
    const recurrence = JSON.parse(row.recurrence_json) as Recurrence;
    const target = JSON.parse(row.target_json) as Target;
    const action = JSON.parse(row.action_json) as ScheduleAction;
    const enabled = row.enabled === 1;
    const targetInfo = this.describeTarget(target);
    const actionInfo = this.describeAction(action);
    const next = enabled ? nextOccurrence(recurrence, row.time_zone, this.clock.nowMs()) : null;
    const last = this.db
      .prepare('SELECT * FROM schedule_executions WHERE schedule_id = ? ORDER BY scheduled_for DESC LIMIT 1')
      .get(row.id) as ExecutionRow | undefined;

    return {
      id: row.id,
      name: row.name,
      enabled,
      timeZone: row.time_zone,
      recurrence,
      target,
      targetName: targetInfo.name,
      action,
      actionSummary: actionInfo.summary,
      missedRunPolicy: row.missed_run_policy,
      nextRun: next ? toNextRunDto(next, row.time_zone) : null,
      problem: targetInfo.problem ?? actionInfo.problem,
      lastExecution: last ? executionToDto(last) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private row(id: string): ScheduleRow {
    const row = this.db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as ScheduleRow | undefined;
    if (!row) throw notFound('That schedule');
    return row;
  }

  list(): ScheduleDto[] {
    const rows = this.db.prepare('SELECT * FROM schedules ORDER BY name COLLATE NOCASE').all() as ScheduleRow[];
    return rows.map((r) => this.toDto(r));
  }

  get(id: string): ScheduleDto {
    return this.toDto(this.row(id));
  }

  private assertTargetAndAction(target: Target, action: ScheduleAction): void {
    if (target.type === 'device' && !this.devices.get(target.deviceId)) {
      throw unprocessable('unknown_target', 'That device does not exist.');
    }
    if (target.type === 'group' && !this.groups.find(target.groupId)) {
      throw unprocessable('unknown_target', 'That group does not exist.');
    }
    if (action.type === 'preset' && !this.presets.find(action.presetId)) {
      throw unprocessable('unknown_preset', 'That preset does not exist.');
    }
  }

  private nextRunIso(recurrence: Recurrence, zone: string): string | null {
    return nextOccurrence(recurrence, zone, this.clock.nowMs())?.at.toUTC().toISO() ?? null;
  }

  private assertWillRun(recurrence: Recurrence, zone: string): string {
    const next = this.nextRunIso(recurrence, zone);
    if (!next) {
      throw unprocessable(
        'schedule_never_runs',
        recurrence.kind === 'once'
          ? 'That date and time has already passed.'
          : 'This schedule would never run with these dates and settings.',
      );
    }
    return next;
  }

  create(input: ScheduleCreate): ScheduleDto {
    this.assertTargetAndAction(input.target, input.action);
    const next = this.assertWillRun(input.recurrence, input.timeZone);
    const id = crypto.randomUUID();
    const now = this.clock.nowIso();
    this.db
      .prepare(
        `INSERT INTO schedules
           (id, name, enabled, time_zone, recurrence_json, target_json, action_json, missed_run_policy,
            next_run_at, last_evaluated_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.enabled ? 1 : 0,
        input.timeZone,
        JSON.stringify(input.recurrence),
        JSON.stringify(input.target),
        JSON.stringify(input.action),
        input.missedRunPolicy,
        input.enabled ? next : null,
        now,
        now,
        now,
      );
    this.activity.record({ eventType: 'schedule', outcome: 'info', message: `Created schedule "${input.name}".` });
    return this.get(id);
  }

  update(id: string, input: ScheduleUpdate): ScheduleDto {
    const row = this.row(id);
    const recurrence = input.recurrence ?? (JSON.parse(row.recurrence_json) as Recurrence);
    const target = input.target ?? (JSON.parse(row.target_json) as Target);
    const action = input.action ?? (JSON.parse(row.action_json) as ScheduleAction);
    const timeZone = input.timeZone ?? row.time_zone;
    this.assertTargetAndAction(target, action);

    const timingChanged = input.recurrence !== undefined || input.timeZone !== undefined;
    const now = this.clock.nowIso();
    let nextRunAt = row.next_run_at;
    let lastEvaluatedAt = row.last_evaluated_at;
    if (timingChanged) {
      const next = this.assertWillRun(recurrence, timeZone);
      nextRunAt = row.enabled === 1 ? next : null;
      // Runs under the old timing are not "missed" under the new one.
      lastEvaluatedAt = now;
    }

    this.db
      .prepare(
        `UPDATE schedules
         SET name = ?, time_zone = ?, recurrence_json = ?, target_json = ?, action_json = ?,
             missed_run_policy = ?, next_run_at = ?, last_evaluated_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.name ?? row.name,
        timeZone,
        JSON.stringify(recurrence),
        JSON.stringify(target),
        JSON.stringify(action),
        input.missedRunPolicy ?? row.missed_run_policy,
        nextRunAt,
        lastEvaluatedAt,
        now,
        id,
      );
    return this.get(id);
  }

  setEnabled(id: string, enabled: boolean): ScheduleDto {
    const row = this.row(id);
    const now = this.clock.nowIso();
    const recurrence = JSON.parse(row.recurrence_json) as Recurrence;
    const next = enabled ? this.nextRunIso(recurrence, row.time_zone) : null;
    // Time spent disabled is not an outage, so re-enabling never reports missed runs.
    this.db
      .prepare(
        `UPDATE schedules SET enabled = ?, next_run_at = ?, last_evaluated_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(enabled ? 1 : 0, next, enabled ? now : row.last_evaluated_at, now, id);
    this.activity.record({
      eventType: 'schedule',
      outcome: 'info',
      message: `${enabled ? 'Enabled' : 'Disabled'} schedule "${row.name}".`,
    });
    return this.get(id);
  }

  delete(id: string): void {
    const row = this.row(id);
    this.db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
    this.activity.record({ eventType: 'schedule', outcome: 'info', message: `Deleted schedule "${row.name}".` });
  }

  executions(id: string, limit: number): ScheduleExecutionDto[] {
    this.row(id);
    const rows = this.db
      .prepare('SELECT * FROM schedule_executions WHERE schedule_id = ? ORDER BY scheduled_for DESC LIMIT ?')
      .all(id, limit) as ExecutionRow[];
    return rows.map(executionToDto);
  }

  preview(request: SchedulePreviewRequest): SchedulePreviewDto {
    return previewSchedule(request.recurrence, request.timeZone, this.clock.nowMs(), request.count);
  }

  upcoming(limit: number): DashboardSummaryDto['upcoming'] {
    const upcoming: DashboardSummaryDto['upcoming'] = [];
    for (const schedule of this.list()) {
      if (!schedule.nextRun) continue;
      upcoming.push({
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        targetName: schedule.targetName,
        actionSummary: schedule.actionSummary,
        run: schedule.nextRun,
      });
    }
    upcoming.sort((a, b) => a.run.at.localeCompare(b.run.at));
    return upcoming.slice(0, limit);
  }

  enabledCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM schedules WHERE enabled = 1').get() as { n: number };
    return row.n;
  }
}
