import type { NormalizedCapability, StatusErrorDto } from '@glm/shared';
import type { Db } from '../database/database.js';
import { normalizeCapabilities } from '../govee/capabilities.js';
import type { RawCapability } from '../govee/transport.js';

export interface DeviceRow {
  id: string;
  govee_device_id: string;
  sku: string;
  name: string;
  device_type: string | null;
  capabilities_json: string;
  discovery_status: 'present' | 'missing';
  first_discovered_at: string;
  last_discovered_at: string;
  missing_since: string | null;
  online: number | null;
  last_status_refresh_at: string | null;
  last_online_at: string | null;
  last_request_at: string | null;
  last_accepted_at: string | null;
  last_status_error_json: string | null;
  offline_streak: number;
  status_failures: number;
  scenes_fetched_at: string | null;
  scene_errors_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeviceRecord {
  id: string;
  goveeDeviceId: string;
  sku: string;
  name: string;
  deviceType: string | null;
  rawCapabilities: RawCapability[];
  capabilities: NormalizedCapability[];
  discoveryStatus: 'present' | 'missing';
  lastDiscoveredAt: string;
  missingSince: string | null;
  online: boolean | null;
  lastStatusRefreshAt: string | null;
  lastOnlineAt: string | null;
  lastRequestAt: string | null;
  lastAcceptedAt: string | null;
  lastStatusError: StatusErrorDto | null;
  /** Answers in a row that said this light was offline. */
  offlineStreak: number;
  /** Status requests in a row that failed. */
  statusFailures: number;
  scenesFetchedAt: string | null;
  sceneErrors: { source: string; category: StatusErrorDto['category']; message: string }[];
}

function toRecord(row: DeviceRow): DeviceRecord {
  const raw = JSON.parse(row.capabilities_json) as RawCapability[];
  return {
    id: row.id,
    goveeDeviceId: row.govee_device_id,
    sku: row.sku,
    name: row.name,
    deviceType: row.device_type,
    rawCapabilities: raw,
    capabilities: normalizeCapabilities(raw),
    discoveryStatus: row.discovery_status,
    lastDiscoveredAt: row.last_discovered_at,
    missingSince: row.missing_since,
    online: row.online === null ? null : row.online === 1,
    lastStatusRefreshAt: row.last_status_refresh_at,
    lastOnlineAt: row.last_online_at,
    lastRequestAt: row.last_request_at,
    lastAcceptedAt: row.last_accepted_at,
    lastStatusError: row.last_status_error_json ? JSON.parse(row.last_status_error_json) : null,
    offlineStreak: row.offline_streak,
    statusFailures: row.status_failures,
    scenesFetchedAt: row.scenes_fetched_at,
    sceneErrors: row.scene_errors_json ? JSON.parse(row.scene_errors_json) : [],
  };
}

export class DeviceRepository {
  constructor(private readonly db: Db) {}

  list(): DeviceRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM devices
         ORDER BY CASE discovery_status WHEN 'present' THEN 0 ELSE 1 END, name COLLATE NOCASE`,
      )
      .all() as DeviceRow[];
    return rows.map(toRecord);
  }

  get(id: string): DeviceRecord | null {
    const row = this.db.prepare('SELECT * FROM devices WHERE id = ?').get(id) as DeviceRow | undefined;
    return row ? toRecord(row) : null;
  }

  getMany(ids: string[]): DeviceRecord[] {
    return ids.map((id) => this.get(id)).filter((d): d is DeviceRecord => d !== null);
  }

  findRowByAddress(sku: string, goveeDeviceId: string): DeviceRow | undefined {
    return this.db
      .prepare('SELECT * FROM devices WHERE sku = ? AND govee_device_id = ?')
      .get(sku, goveeDeviceId) as DeviceRow | undefined;
  }

  counts(): { present: number; missing: number } {
    const rows = this.db
      .prepare('SELECT discovery_status AS status, COUNT(*) AS n FROM devices GROUP BY discovery_status')
      .all() as { status: 'present' | 'missing'; n: number }[];
    return {
      present: rows.find((r) => r.status === 'present')?.n ?? 0,
      missing: rows.find((r) => r.status === 'missing')?.n ?? 0,
    };
  }
}
