import type { DeviceAction, MissedDeliveryDto, MissedDeliveryStatus } from '@glm/shared';
import type { Db } from '../database/database.js';
import type { Clock } from '../shared/clock.js';

interface Row {
  id: number;
  device_id: string;
  device_name: string;
  run_name: string;
  actions_json: string;
  status: MissedDeliveryStatus;
  detail: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface WaitingDelivery {
  id: number;
  deviceId: string;
  runName: string;
  actions: DeviceAction[];
  createdAt: string;
}

const CATCH_UP_PREFIX = 'Catch-up: ';

export function catchUpName(runName: string): string {
  return `${CATCH_UP_PREFIX}${runName}`;
}

const SELECT = `SELECT m.*, d.name AS device_name FROM missed_deliveries m JOIN devices d ON d.id = m.device_id`;

function toDto(row: Row): MissedDeliveryDto {
  return {
    id: row.id,
    deviceId: row.device_id,
    deviceName: row.device_name,
    runName: row.run_name,
    stepCount: (JSON.parse(row.actions_json) as unknown[]).length,
    status: row.status,
    detail: row.detail,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

function toWaiting(row: Row): WaitingDelivery {
  return {
    id: row.id,
    deviceId: row.device_id,
    runName: row.run_name,
    actions: JSON.parse(row.actions_json) as DeviceAction[],
    createdAt: row.created_at,
  };
}

/**
 * What each light missed while offline. Only the newest is kept per light, so catching
 * up reaches the latest intended state and never replays a backlog of old commands.
 */
export class MissedDeliveryStore {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  record(deviceId: string, runName: string, actions: DeviceAction[]): void {
    const now = this.clock.nowIso();
    // A failed catch-up that misses again keeps the original name, not a growing prefix.
    const name = runName.startsWith(CATCH_UP_PREFIX) ? runName.slice(CATCH_UP_PREFIX.length) : runName;
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE missed_deliveries SET status = 'replaced', detail = 'A newer command took its place.', finished_at = ?
           WHERE device_id = ? AND status = 'waiting'`,
        )
        .run(now, deviceId);
      this.db
        .prepare(
          `INSERT INTO missed_deliveries (device_id, run_name, actions_json, status, created_at)
           VALUES (?, ?, ?, 'waiting', ?)`,
        )
        .run(deviceId, name, JSON.stringify(actions), now);
    })();
  }

  waiting(): WaitingDelivery[] {
    const rows = this.db.prepare(`${SELECT} WHERE m.status = 'waiting' ORDER BY m.created_at`).all() as Row[];
    return rows.map(toWaiting);
  }

  findWaiting(id: number): WaitingDelivery | null {
    const row = this.db.prepare(`${SELECT} WHERE m.id = ? AND m.status = 'waiting'`).get(id) as Row | undefined;
    return row ? toWaiting(row) : null;
  }

  /**
   * Claims a delivery so it cannot be sent twice. False means something else got there
   * first. The status changes before anything is sent, so a crash cannot cause a resend.
   */
  claim(id: number): boolean {
    return (
      this.db.prepare(`UPDATE missed_deliveries SET status = 'delivering' WHERE id = ? AND status = 'waiting'`).run(id)
        .changes === 1
    );
  }

  finish(id: number, status: Exclude<MissedDeliveryStatus, 'waiting' | 'delivering'>, detail: string | null): void {
    this.db
      .prepare(`UPDATE missed_deliveries SET status = ?, detail = ?, finished_at = ? WHERE id = ?`)
      .run(status, detail, this.clock.nowIso(), id);
  }

  /** Closes anything left mid-delivery by a restart. It is not resent. */
  recoverInterrupted(): number {
    return this.db
      .prepare(
        `UPDATE missed_deliveries SET status = 'failed', detail = 'The app stopped during this delivery. It was not repeated.', finished_at = ?
         WHERE status = 'delivering'`,
      )
      .run(this.clock.nowIso()).changes;
  }

  listWaiting(): MissedDeliveryDto[] {
    const rows = this.db.prepare(`${SELECT} WHERE m.status = 'waiting' ORDER BY m.created_at DESC`).all() as Row[];
    return rows.map(toDto);
  }

  recentFinished(limit: number): MissedDeliveryDto[] {
    const rows = this.db
      .prepare(`${SELECT} WHERE m.finished_at IS NOT NULL ORDER BY m.finished_at DESC, m.id DESC LIMIT ?`)
      .all(limit) as Row[];
    return rows.map(toDto);
  }
}
