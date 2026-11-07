import crypto from 'node:crypto';
import type {
  CommandDto,
  CommandSourceType,
  CommandStatus,
  ErrorCategory,
  Verification,
} from '@glm/shared';
import type { Db } from '../database/database.js';
import type { Clock } from '../shared/clock.js';

interface CommandRow {
  id: string;
  device_id: string;
  source_type: CommandSourceType;
  source_id: string | null;
  run_id: string | null;
  correlation_id: string | null;
  action_type: string;
  instance: string;
  request_id: string;
  request_summary: string;
  status: CommandStatus;
  verification: Verification;
  attempts: number;
  error_category: ErrorCategory | null;
  error_message: string | null;
  created_at: string;
  accepted_at: string | null;
  completed_at: string | null;
}

function toDto(row: CommandRow): CommandDto {
  return {
    id: row.id,
    deviceId: row.device_id,
    actionType: row.action_type,
    instance: row.instance,
    summary: row.request_summary,
    sourceType: row.source_type,
    status: row.status,
    verification: row.verification,
    attempts: row.attempts,
    errorCategory: row.error_category,
    errorMessage: row.error_message,
    requestId: row.request_id,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
    completedAt: row.completed_at,
  };
}

/**
 * These settings each replace the others on the light. When one is accepted, the
 * others' requested and accepted values no longer describe the light, and comparing
 * them against later reports would produce false mismatches.
 */
const LIGHT_MODE_INSTANCES = ['colorRgb', 'colorTemperatureK', 'lightScene', 'diyScene', 'snapshot'];

export interface NewCommand {
  deviceId: string;
  instance: string;
  value: unknown;
  actionType: string;
  summary: string;
  sourceType: CommandSourceType;
  sourceId?: string | null | undefined;
  runId?: string | null | undefined;
  correlationId?: string | null | undefined;
}

export class CommandStore {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  /** Records a command along with what was requested, before anything is sent. */
  create(input: NewCommand): CommandDto {
    const id = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const now = this.clock.nowIso();
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO command_history
             (id, device_id, source_type, source_id, run_id, correlation_id, action_type, instance,
              request_id, request_summary, status, verification, attempts, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 'not_applicable', 0, ?)`,
        )
        .run(
          id,
          input.deviceId,
          input.sourceType,
          input.sourceId ?? null,
          input.runId ?? null,
          input.correlationId ?? null,
          input.actionType,
          input.instance,
          requestId,
          input.summary,
          now,
        );
      this.db
        .prepare(
          `INSERT INTO capability_states (device_id, instance, requested_value_json, requested_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(device_id, instance) DO UPDATE SET
             requested_value_json = excluded.requested_value_json,
             requested_at = excluded.requested_at`,
        )
        .run(input.deviceId, input.instance, JSON.stringify(input.value), now);
      this.db.prepare('UPDATE devices SET last_request_at = ? WHERE id = ?').run(now, input.deviceId);
    })();
    return this.getOrThrow(id);
  }

  markSending(id: string, attempts: number): void {
    this.db.prepare(`UPDATE command_history SET status = 'sending', attempts = ? WHERE id = ?`).run(attempts, id);
  }

  markAccepted(id: string, deviceId: string, instance: string, value: unknown, attempts: number): CommandDto {
    const now = this.clock.nowIso();
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE command_history
           SET status = 'accepted', verification = 'unverified', attempts = ?, accepted_at = ?, completed_at = ?,
               error_category = NULL, error_message = NULL
           WHERE id = ?`,
        )
        .run(attempts, now, now, id);
      this.db
        .prepare(
          `UPDATE capability_states
           SET accepted_value_json = ?, accepted_at = ?, verification = 'unverified'
           WHERE device_id = ? AND instance = ?`,
        )
        .run(JSON.stringify(value), now, deviceId, instance);
      if (LIGHT_MODE_INSTANCES.includes(instance)) {
        const others = LIGHT_MODE_INSTANCES.filter((i) => i !== instance);
        this.db
          .prepare(
            `UPDATE capability_states
             SET requested_value_json = NULL, requested_at = NULL,
                 accepted_value_json = NULL, accepted_at = NULL, verification = NULL
             WHERE device_id = ? AND instance IN (${others.map(() => '?').join(',')})`,
          )
          .run(deviceId, ...others);
      }
      this.db.prepare('UPDATE devices SET last_accepted_at = ? WHERE id = ?').run(now, deviceId);
    })();
    return this.getOrThrow(id);
  }

  markFinished(
    id: string,
    status: Extract<CommandStatus, 'rejected' | 'failed' | 'interrupted'>,
    attempts: number,
    errorCategory: ErrorCategory,
    errorMessage: string,
  ): CommandDto {
    this.db
      .prepare(
        `UPDATE command_history
         SET status = ?, attempts = ?, error_category = ?, error_message = ?, completed_at = ?
         WHERE id = ?`,
      )
      .run(status, attempts, errorCategory, errorMessage, this.clock.nowIso(), id);
    return this.getOrThrow(id);
  }

  markSuperseded(id: string): CommandDto {
    this.db
      .prepare(`UPDATE command_history SET status = 'superseded', completed_at = ? WHERE id = ?`)
      .run(this.clock.nowIso(), id);
    return this.getOrThrow(id);
  }

  /** Commands left unfinished by a previous process. They are recorded, not resent. */
  interruptUnfinished(): number {
    return this.db
      .prepare(
        `UPDATE command_history
         SET status = 'interrupted', error_category = 'queue_stopped',
             error_message = 'The app stopped before this command finished. It was not resent.',
             completed_at = ?
         WHERE status IN ('queued', 'sending')`,
      )
      .run(this.clock.nowIso()).changes;
  }

  /** Applies a verification result to the newest accepted command for one setting. */
  setVerificationForLatest(deviceId: string, instance: string, verification: Verification): void {
    this.db
      .prepare(
        `UPDATE command_history SET verification = ?
         WHERE id = (
           SELECT id FROM command_history
           WHERE device_id = ? AND instance = ? AND status = 'accepted'
           ORDER BY accepted_at DESC, rowid DESC LIMIT 1
         ) AND verification = 'unverified'`,
      )
      .run(verification, deviceId, instance);
  }

  get(id: string): CommandDto | null {
    const row = this.db.prepare('SELECT * FROM command_history WHERE id = ?').get(id) as CommandRow | undefined;
    return row ? toDto(row) : null;
  }

  getOrThrow(id: string): CommandDto {
    const dto = this.get(id);
    if (!dto) throw new Error(`Command ${id} disappeared`);
    return dto;
  }

  listForDevice(deviceId: string, limit: number): CommandDto[] {
    const rows = this.db
      .prepare('SELECT * FROM command_history WHERE device_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
      .all(deviceId, limit) as CommandRow[];
    return rows.map(toDto);
  }

  prune(olderThanIso: string): number {
    return this.db
      .prepare(`DELETE FROM command_history WHERE created_at < ? AND status NOT IN ('queued', 'sending')`)
      .run(olderThanIso).changes;
  }
}
