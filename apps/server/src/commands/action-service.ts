import crypto from 'node:crypto';
import type {
  ActionOutcomeDto,
  CommandDto,
  CommandSourceType,
  DeviceAction,
  OutcomeStatus,
  RunResultDto,
  RunStatus,
} from '@glm/shared';
import { describeAction } from '@glm/shared';
import type { ActivityService } from '../activity/activity-service.js';
import type { Db } from '../database/database.js';
import { buildCommand } from '../devices/command-builder.js';
import type { DeviceRecord } from '../devices/device-repository.js';
import type { SceneStore } from '../devices/scene-store.js';
import type { Clock } from '../shared/clock.js';
import { AppError } from '../shared/errors.js';
import type { CommandQueue } from './command-queue.js';
import type { CommandStore } from './command-store.js';
import type { MissedDeliveryStore } from '../connection/missed-delivery-store.js';

export interface DevicePlan {
  device: DeviceRecord;
  actions: DeviceAction[];
}

export interface RunSource {
  type: CommandSourceType;
  id?: string | null;
  name: string;
  correlationId?: string | null;
}

export type PlannedSkip = { deviceName: string; deviceId: string | null; action: DeviceAction; reason: string };

const DIRECT_WAIT_MS = 20_000;

/**
 * Validates and dispatches actions. Direct calls return one command result. Plans
 * are for presets, groups and schedules, and report a result per device and action.
 * Nothing here claims devices changed together: each device runs independently.
 */
export class ActionService {
  constructor(
    private readonly db: Db,
    private readonly scenes: SceneStore,
    private readonly queue: CommandQueue,
    private readonly commands: CommandStore,
    private readonly activity: ActivityService,
    private readonly clock: Clock,
    private readonly missed: MissedDeliveryStore,
  ) {}

  /** Sends one action from the UI. Waits for the outcome, up to a limit. */
  async dispatchDirect(
    device: DeviceRecord,
    action: DeviceAction,
    correlationId?: string,
  ): Promise<{ command: CommandDto; settled: boolean }> {
    const built = buildCommand(device, action, this.scenes);
    if (!built.ok) {
      const status = built.code === 'device_missing' ? 409 : 422;
      throw new AppError(status, built.code, built.message);
    }
    const { command, done } = this.queue.enqueue({
      deviceId: device.id,
      address: { sku: device.sku, device: device.goveeDeviceId },
      capability: built.command.capability,
      actionType: built.command.actionType,
      summary: built.command.summary,
      coalesceKey: built.command.coalesceKey,
      sourceType: 'manual',
      correlationId,
    });
    // A wall-clock limit on the HTTP response. The command keeps going after this.
    let timer: NodeJS.Timeout | undefined;
    const finished = await Promise.race([
      done,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), DIRECT_WAIT_MS);
        timer.unref?.();
      }),
    ]);
    clearTimeout(timer);
    if (finished) return { command: finished, settled: true };
    return { command: this.commands.getOrThrow(command.id), settled: false };
  }

  /**
   * Runs per-device action lists. On each device, actions go one at a time so a
   * failed step can stop those that depend on it: if "turn on" did not go through,
   * sending a colour next is not useful. Unsupported actions are skipped with an
   * explanation and do not block the rest. Devices run independently.
   */
  async runPlan(source: RunSource, plans: DevicePlan[], preSkipped: PlannedSkip[] = []): Promise<RunResultDto> {
    const runId = crypto.randomUUID();
    const startedAt = this.clock.nowIso();
    this.db
      .prepare(
        `INSERT INTO execution_runs (id, source_type, source_id, source_name, status, started_at)
         VALUES (?, ?, ?, ?, 'running', ?)`,
      )
      .run(runId, source.type, source.id ?? null, source.name, startedAt);

    const perDevice = await Promise.all(plans.map((plan) => this.runDevicePlan(plan, source, runId)));
    plans.forEach((plan, index) => {
      if (perDevice[index]?.some((outcome) => outcome.errorCategory === 'device_offline')) {
        this.missed.record(plan.device.id, source.name, plan.actions);
      }
    });
    const skipped: ActionOutcomeDto[] = preSkipped.map((skip) => ({
      deviceId: skip.deviceId,
      deviceName: skip.deviceName,
      actionType: skip.action.type,
      summary: describeAction(skip.action),
      status: 'skipped',
      commandId: null,
      verification: 'not_applicable',
      reason: skip.reason,
      errorCategory: null,
    }));
    const outcomes = [...perDevice.flat(), ...skipped];
    const status = summarizeOutcomes(outcomes.map((o) => o.status));
    const completedAt = this.clock.nowIso();

    this.db
      .prepare(`UPDATE execution_runs SET status = ?, outcomes_json = ?, completed_at = ? WHERE id = ?`)
      .run(status, JSON.stringify(outcomes), completedAt, runId);

    const accepted = outcomes.filter((o) => o.status === 'accepted').length;
    this.activity.record({
      eventType: source.type === 'manual' ? 'command' : source.type,
      outcome: status === 'all_accepted' ? 'success' : status === 'partial' ? 'warning' : status === 'failed' ? 'failure' : 'info',
      correlationId: source.correlationId,
      message: `${source.name}: ${accepted} of ${outcomes.length} action(s) accepted by Govee.`,
      details: { runId, status },
    });

    return {
      runId,
      sourceType: source.type,
      sourceId: source.id ?? null,
      sourceName: source.name,
      status,
      startedAt,
      completedAt,
      outcomes,
    };
  }

  private async runDevicePlan(plan: DevicePlan, source: RunSource, runId: string): Promise<ActionOutcomeDto[]> {
    const { device, actions } = plan;
    const outcomes: ActionOutcomeDto[] = [];
    let blocked = false;

    for (const action of actions) {
      const summary = describeAction(action);
      const base = { deviceId: device.id, deviceName: device.name, actionType: action.type };

      if (blocked) {
        outcomes.push({
          ...base,
          summary,
          status: 'skipped',
          commandId: null,
          verification: 'not_applicable',
          reason: 'Skipped because an earlier action for this device did not go through.',
          errorCategory: null,
        });
        continue;
      }

      const built = buildCommand(device, action, this.scenes);
      if (!built.ok) {
        outcomes.push({
          ...base,
          summary,
          status: 'skipped',
          commandId: null,
          verification: 'not_applicable',
          reason: built.message,
          errorCategory: null,
        });
        continue;
      }

      let result: CommandDto;
      try {
        const { done } = this.queue.enqueue({
          deviceId: device.id,
          address: { sku: device.sku, device: device.goveeDeviceId },
          capability: built.command.capability,
          actionType: built.command.actionType,
          summary: built.command.summary,
          // Plans are ordered on purpose, so their commands are never coalesced.
          coalesceKey: null,
          sourceType: source.type,
          sourceId: source.id,
          runId,
          correlationId: source.correlationId,
        });
        result = await done;
      } catch (error) {
        outcomes.push({
          ...base,
          summary: built.command.summary,
          status: 'failed',
          commandId: null,
          verification: 'not_applicable',
          reason: error instanceof Error ? error.message : 'The command could not be queued.',
          errorCategory: 'unknown',
        });
        blocked = true;
        continue;
      }

      outcomes.push({
        ...base,
        summary: built.command.summary,
        status: result.status,
        commandId: result.id,
        verification: result.verification,
        reason: result.errorMessage,
        errorCategory: result.errorCategory,
      });
      if (result.status !== 'accepted') blocked = true;
    }
    return outcomes;
  }
}

export function summarizeOutcomes(statuses: OutcomeStatus[]): Exclude<RunStatus, 'running'> {
  if (statuses.length === 0) return 'skipped';
  const accepted = statuses.filter((s) => s === 'accepted').length;
  const skipped = statuses.filter((s) => s === 'skipped').length;
  if (accepted === statuses.length) return 'all_accepted';
  if (skipped === statuses.length) return 'skipped';
  if (accepted > 0) return 'partial';
  return 'failed';
}
