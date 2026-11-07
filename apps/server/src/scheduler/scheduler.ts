import crypto from 'node:crypto';
import type { Logger } from 'pino';
import type { DeviceAction, Recurrence, RunResultDto, ScheduleAction, Target } from '@glm/shared';
import type { ActivityService } from '../activity/activity-service.js';
import type { ActionService } from '../commands/action-service.js';
import type { AppConfig } from '../config/env.js';
import type { Db } from '../database/database.js';
import type { DeviceRecord, DeviceRepository } from '../devices/device-repository.js';
import type { GroupService } from '../groups/group-service.js';
import type { PresetService } from '../presets/preset-service.js';
import type { Clock } from '../shared/clock.js';
import { nextOccurrence, occurrencesBetween, type Occurrence } from './occurrences.js';
import type { ScheduleRow } from './schedule-service.js';

/** Most missed runs itemized per schedule after an outage. */
const MAX_ITEMIZED_OCCURRENCES = 100;

export type SchedulerStatus = 'running' | 'stopped' | 'disabled';

/**
 * Runs schedules from durable state, so nothing depends on an in-memory timer.
 *
 * Each tick reads due schedules from SQLite and, in one transaction per schedule,
 * records what happened to each occurrence and moves the schedule forward. A row
 * in schedule_executions is created before anything is sent, and its unique
 * (schedule_id, occurrence_key) constraint means an occurrence can be claimed once
 * no matter how often the process restarts.
 *
 * Crash policy: a run still marked 'running' at startup is marked 'interrupted'
 * and not retried. It may have partly executed, and repeating lighting commands
 * blindly is worse than reporting it.
 *
 * Only one instance should run against a database. Unique occurrence keys stop a
 * second instance from double-firing, but other in-memory state is not shared.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private lastTickAt: string | null = null;
  private readonly running = new Set<Promise<void>>();

  constructor(
    private readonly db: Db,
    private readonly devices: DeviceRepository,
    private readonly groups: GroupService,
    private readonly presets: PresetService,
    private readonly actions: ActionService,
    private readonly activity: ActivityService,
    private readonly logger: Logger,
    private readonly clock: Clock,
    private readonly config: AppConfig['scheduler'],
  ) {}

  status(): SchedulerStatus {
    if (!this.config.enabled) return 'disabled';
    return this.timer ? 'running' : 'stopped';
  }

  lastTick(): string | null {
    return this.lastTickAt;
  }

  start(): void {
    if (!this.config.enabled) {
      this.logger.warn('Scheduler is disabled by SCHEDULER_ENABLED=false');
      return;
    }
    this.recoverInterrupted();
    // This first tick is the restart-recovery pass: it finds runs missed while the app was down.
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.config.tickSeconds * 1000);
    this.timer.unref?.();
    this.logger.info({ tickSeconds: this.config.tickSeconds }, 'Scheduler started');
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.idle();
    this.logger.info('Scheduler stopped');
  }

  /** Resolves once no scheduled run is in progress. */
  async idle(): Promise<void> {
    while (this.running.size > 0) {
      await Promise.all(this.running);
    }
  }

  recoverInterrupted(): number {
    const rows = this.db
      .prepare(
        `SELECT e.id, s.name FROM schedule_executions e
         JOIN schedules s ON s.id = e.schedule_id
         WHERE e.status = 'running'`,
      )
      .all() as { id: string; name: string }[];
    const now = this.clock.nowIso();
    for (const row of rows) {
      this.db
        .prepare(
          `UPDATE schedule_executions
           SET status = 'interrupted', completed_at = ?,
               error_summary = 'The app stopped during this run. It was not repeated, so it may be incomplete.'
           WHERE id = ?`,
        )
        .run(now, row.id);
      this.activity.record({
        eventType: 'schedule',
        outcome: 'warning',
        message: `Schedule "${row.name}": a run was interrupted when the app stopped. It was not repeated.`,
        details: { executionId: row.id },
      });
    }
    return rows.length;
  }

  /** Public for tests and for the startup pass. Overlapping ticks do nothing. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const nowMs = this.clock.nowMs();
      this.lastTickAt = new Date(nowMs).toISOString();
      const due = this.db
        .prepare(
          `SELECT * FROM schedules
           WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?
           ORDER BY next_run_at`,
        )
        .all(new Date(nowMs).toISOString()) as ScheduleRow[];

      for (const row of due) {
        try {
          this.process(row, nowMs);
        } catch (error) {
          // One broken schedule must not stop the others.
          this.logger.error({ err: error, scheduleId: row.id }, 'Could not process schedule');
          this.activity.record({
            eventType: 'schedule',
            outcome: 'failure',
            message: `Schedule "${row.name}" could not be processed. See the server log.`,
          });
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  private process(row: ScheduleRow, nowMs: number): void {
    const recurrence = JSON.parse(row.recurrence_json) as Recurrence;
    const fromMs = Date.parse(row.last_evaluated_at);
    const { occurrences, truncated } = occurrencesBetween(
      recurrence,
      row.time_zone,
      fromMs,
      nowMs,
      MAX_ITEMIZED_OCCURRENCES,
    );
    const next = nextOccurrence(recurrence, row.time_zone, nowMs);

    // Only the newest occurrence can ever run. Anything older stays recorded as missed.
    const latest = occurrences.at(-1) ?? null;
    let toRun: Occurrence | null = null;
    let isRecovery = false;
    if (latest) {
      const lateMs = nowMs - latest.at.toMillis();
      if (lateMs <= this.config.graceSeconds * 1000) {
        toRun = latest;
      } else if (
        row.missed_run_policy === 'run_latest' &&
        lateMs <= this.config.catchUpMaxHours * 3600 * 1000
      ) {
        toRun = latest;
        isRecovery = true;
      }
    }

    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO schedule_executions
         (id, schedule_id, occurrence_key, scheduled_for, started_at, status, is_recovery, created_at, error_summary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const nowIso = new Date(nowMs).toISOString();
    let claimedId: string | null = null;
    let missedCount = 0;

    this.db.transaction(() => {
      for (const occurrence of occurrences) {
        const id = crypto.randomUUID();
        const scheduledFor = occurrence.at.toUTC().toISO()!;
        if (occurrence === toRun) {
          const changes = insert.run(
            id,
            row.id,
            occurrence.key,
            scheduledFor,
            nowIso,
            'running',
            isRecovery ? 1 : 0,
            nowIso,
            null,
          ).changes;
          // Zero changes means this occurrence was already claimed, so it must not run again.
          if (changes === 1) claimedId = id;
        } else {
          missedCount += insert.run(
            id,
            row.id,
            occurrence.key,
            scheduledFor,
            null,
            'missed',
            0,
            nowIso,
            'The app was not running, or this run was too late to start.',
          ).changes;
        }
      }
      this.db
        .prepare('UPDATE schedules SET last_evaluated_at = ?, next_run_at = ? WHERE id = ?')
        .run(nowIso, next?.at.toUTC().toISO() ?? null, row.id);
    })();

    if (missedCount > 0) {
      this.activity.record({
        eventType: 'schedule',
        outcome: 'warning',
        message:
          `Schedule "${row.name}": ${missedCount} missed run(s) recorded${truncated ? ' (older ones not itemized)' : ''}.` +
          (row.missed_run_policy === 'run_latest' && claimedId ? ' Recovering with the latest one.' : ''),
      });
      this.logger.warn({ scheduleId: row.id, missedCount, truncated }, 'Recorded missed schedule runs');
    }

    if (claimedId && toRun) {
      const run = this.execute(row, toRun, claimedId, isRecovery).finally(() => {
        this.running.delete(run);
      });
      this.running.add(run);
    }
  }

  private async execute(row: ScheduleRow, occurrence: Occurrence, executionId: string, isRecovery: boolean): Promise<void> {
    const finish = this.db.prepare(
      `UPDATE schedule_executions SET status = ?, completed_at = ?, error_summary = ?, run_id = ? WHERE id = ?`,
    );
    try {
      const target = JSON.parse(row.target_json) as Target;
      const action = JSON.parse(row.action_json) as ScheduleAction;
      const result = await this.runAction(row, target, action);

      const problems = result.outcomes
        .filter((o) => o.status !== 'accepted')
        .map((o) => `${o.deviceName}: ${o.reason ?? o.status}`);
      const summary = problems.length > 0 ? problems.join(' | ').slice(0, 1000) : null;
      finish.run(result.status, this.clock.nowIso(), summary, result.runId, executionId);
      this.logger.info(
        { scheduleId: row.id, occurrence: occurrence.key, status: result.status, isRecovery },
        'Schedule run finished',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The run failed unexpectedly.';
      finish.run('failed', this.clock.nowIso(), message.slice(0, 1000), null, executionId);
      this.activity.record({
        eventType: 'schedule',
        outcome: 'failure',
        message: `Schedule "${row.name}" failed: ${message}`,
        details: { executionId, occurrence: occurrence.key },
      });
      this.logger.warn({ scheduleId: row.id, occurrence: occurrence.key, err: error }, 'Schedule run failed');
    }
  }

  private resolveDevices(target: Target): DeviceRecord[] {
    if (target.type === 'device') {
      const device = this.devices.get(target.deviceId);
      if (!device) throw new Error('The target device no longer exists.');
      return [device];
    }
    const group = this.groups.find(target.groupId);
    if (!group) throw new Error('The target group no longer exists.');
    return this.devices.getMany(group.deviceIds);
  }

  private runAction(row: ScheduleRow, target: Target, action: ScheduleAction): Promise<RunResultDto> {
    const source = { type: 'schedule' as const, id: row.id, name: row.name };
    if (action.type === 'preset') {
      return this.presets.apply(action.presetId, target, source);
    }
    const power: DeviceAction = { type: 'power', on: action.on };
    const plans = this.resolveDevices(target).map((device) => ({ device, actions: [power] }));
    return this.actions.runPlan(source, plans);
  }
}
