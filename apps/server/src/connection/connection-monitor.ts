import type { Logger } from 'pino';
import type {
  AppSettings,
  ConnectionIncidentDto,
  ConnectionReportDto,
  DeviceHealthDto,
  ErrorCategory,
  IncidentKind,
} from '@glm/shared';
import type { ActivityService } from '../activity/activity-service.js';
import type { ActionService } from '../commands/action-service.js';
import type { Db } from '../database/database.js';
import type { DeviceRecord } from '../devices/device-repository.js';
import { isGoveeGroup, type DeviceService } from '../devices/device-service.js';
import type { Clock } from '../shared/clock.js';
import { AppError, notFound } from '../shared/errors.js';
import { diagnose, overallStatus } from './diagnosis.js';
import { catchUpName, type MissedDeliveryStore, type WaitingDelivery } from './missed-delivery-store.js';

const HOUR_MS = 3600 * 1000;
const WEEK_MS = 7 * 24 * HOUR_MS;
/** Background checks may use at most this share of the daily request budget. */
const BUDGET_SHARE = 0.25;
/** Rechecking the device list as a repair is cheap, but not worth doing constantly. */
const HEAL_DISCOVERY_EVERY_MS = HOUR_MS;
const MANUAL_CHECK_MIN_MS = 15_000;

const CONNECTIVITY_FAILURES: ReadonlySet<ErrorCategory> = new Set(['network', 'timeout', 'server_error']);
const CATEGORY_FROM_CODE = /^govee_(.+)$/;

const INCIDENT_LABEL: Record<IncidentKind, string> = {
  device_offline: 'went offline',
  device_missing: 'left the Govee device list',
  govee_unreachable: 'The app could not reach Govee',
  api_key_rejected: 'Govee rejected the API key',
  api_key_missing: 'No Govee API key is set',
  rate_limited: 'Govee started limiting requests',
};

interface IncidentRow {
  id: number;
  kind: IncidentKind;
  device_id: string | null;
  device_name: string | null;
  opened_at: string;
  last_seen_at: string;
  closed_at: string | null;
}

function incidentToDto(row: IncidentRow): ConnectionIncidentDto {
  return {
    id: row.id,
    kind: row.kind,
    deviceId: row.device_id,
    deviceName: row.device_name,
    openedAt: row.opened_at,
    lastSeenAt: row.last_seen_at,
    closedAt: row.closed_at,
  };
}

function durationText(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hr`;
  return `${Math.round(hours / 24)} days`;
}

export interface ConnectionConfig {
  enabled: boolean;
  checkSeconds: number;
  missedMaxHours: number;
  dailyBudget: number;
}

/**
 * Watches every light in the background, whether or not a browser is open.
 *
 * It repairs only what software can reach: rechecking the device list, retrying through
 * temporary failures, and resending what a light missed if the owner has turned that on.
 * It cannot restart a controller, change Wi-Fi settings or read firmware, because
 * Govee's public API offers no way to, so for those it says what to try.
 */
export class ConnectionMonitor {
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private lastCheckAt: string | null = null;
  private lastManualCheckMs = 0;
  private lastHealDiscoveryMs = 0;
  private current: Promise<void> | null = null;

  constructor(
    private readonly db: Db,
    private readonly devices: DeviceService,
    private readonly actions: ActionService,
    private readonly missed: MissedDeliveryStore,
    private readonly activity: ActivityService,
    private readonly getSettings: () => AppSettings,
    private readonly isConfigured: () => boolean,
    private readonly logger: Logger,
    private readonly clock: Clock,
    private readonly config: ConnectionConfig,
  ) {}

  start(): void {
    if (!this.config.enabled) {
      this.logger.warn('Connection monitor is disabled by CONNECTION_MONITOR_ENABLED=false');
      return;
    }
    this.stopped = false;
    this.missed.recoverInterrupted();
    this.schedule(0);
    this.logger.info({ intervalSeconds: this.intervalSeconds() }, 'Connection monitor started');
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.current;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.check().finally(() => this.schedule(this.intervalSeconds() * 1000));
    }, delayMs);
    this.timer.unref?.();
  }

  /** More lights are checked less often, so monitoring cannot eat the daily request budget. */
  intervalSeconds(): number {
    const count = this.monitorable().length;
    const budgetFloor = Math.ceil((86_400 * count) / (this.config.dailyBudget * BUDGET_SHARE));
    return Math.max(this.config.checkSeconds, budgetFloor);
  }

  private monitorable(): DeviceRecord[] {
    return this.devices.repository.list().filter((d) => this.devices.statusAvailable(d));
  }

  /** Overlapping requests share one check. Never rejects. */
  check(): Promise<void> {
    if (this.current) return this.current;
    this.current = this.runCheck()
      .catch((error: unknown) => {
        // The next check tries again. Called from a timer, so nothing else would catch this.
        this.logger.error({ err: error }, 'Connection check failed');
      })
      .finally(() => {
        this.current = null;
      });
    return this.current;
  }

  async checkNow(): Promise<boolean> {
    const now = this.clock.nowMs();
    if (now - this.lastManualCheckMs < MANUAL_CHECK_MIN_MS) return false;
    this.lastManualCheckMs = now;
    await this.check();
    return true;
  }

  private async runCheck(): Promise<void> {
    this.lastCheckAt = this.clock.nowIso();
    this.expireOldDeliveries();

    if (!this.isConfigured()) {
      this.open('api_key_missing', null);
      return;
    }
    this.close('api_key_missing', null);

    const failures = new Map<string, ErrorCategory>();
    const targets = this.monitorable();
    let refused = false;
    for (const device of targets) {
      if (this.stopped) return;
      try {
        await this.devices.refreshState(device.id, 'poll');
      } catch (error) {
        const category = this.categoryOf(error);
        failures.set(device.id, category);
        if (category === 'bad_request' || category === 'not_found') refused = true;
      }
    }

    const categories = [...failures.values()];
    this.setOpen('api_key_rejected', categories.includes('auth'));
    this.setOpen(
      'govee_unreachable',
      targets.length > 0 && failures.size === targets.length && categories.every((c) => CONNECTIVITY_FAILURES.has(c)),
    );
    this.setOpen('rate_limited', categories.includes('rate_limited'));

    const fresh = this.devices.repository.list();
    for (const device of fresh) {
      if (isGoveeGroup(device)) continue;
      this.setOpen('device_missing', device.discoveryStatus === 'missing', device);
      if (device.discoveryStatus !== 'present') continue;
      // Govee can answer a status request by refusing it because the light is offline.
      if (failures.get(device.id) === 'device_offline') {
        this.open('device_offline', device.id, device.name);
        continue;
      }
      if (failures.has(device.id)) continue;
      if (device.online === false) this.open('device_offline', device.id, device.name);
      if (device.online === true) this.close('device_offline', device.id, device.name);
    }

    await this.healDeviceList(refused || fresh.some((d) => d.discoveryStatus === 'missing'));
    await this.deliverCaughtUp();
  }

  private categoryOf(error: unknown): ErrorCategory {
    if (error instanceof AppError) {
      const match = CATEGORY_FROM_CODE.exec(error.code);
      if (match?.[1]) return match[1] as ErrorCategory;
    }
    return 'unknown';
  }

  /** A light that vanished may only need the list rechecked. It costs one request an hour. */
  private async healDeviceList(needed: boolean): Promise<void> {
    if (!needed) return;
    const now = this.clock.nowMs();
    if (now - this.lastHealDiscoveryMs < HEAL_DISCOVERY_EVERY_MS) return;
    this.lastHealDiscoveryMs = now;
    try {
      const result = await this.devices.discover();
      this.activity.record({
        eventType: 'connection',
        outcome: 'info',
        message: `Rechecked the device list with Govee: ${result.total} device(s), ${result.noLongerDiscovered} no longer listed.`,
      });
    } catch (error) {
      this.logger.warn({ err: error }, 'Could not recheck the device list');
    }
  }

  /* ------------------------------- incidents ------------------------------- */

  private setOpen(kind: IncidentKind, isOpen: boolean, device?: DeviceRecord): void {
    if (isOpen) this.open(kind, device?.id ?? null, device?.name);
    else this.close(kind, device?.id ?? null, device?.name);
  }

  private findOpen(kind: IncidentKind, deviceId: string | null): IncidentRow | undefined {
    return this.db
      .prepare(
        `SELECT i.*, NULL AS device_name FROM connection_incidents i
         WHERE i.kind = ? AND COALESCE(i.device_id, '') = ? AND i.closed_at IS NULL`,
      )
      .get(kind, deviceId ?? '') as IncidentRow | undefined;
  }

  private open(kind: IncidentKind, deviceId: string | null, deviceName?: string): void {
    const now = this.clock.nowIso();
    const existing = this.findOpen(kind, deviceId);
    if (existing) {
      this.db.prepare('UPDATE connection_incidents SET last_seen_at = ? WHERE id = ?').run(now, existing.id);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO connection_incidents (kind, device_id, opened_at, last_seen_at) VALUES (?, ?, ?, ?)`,
      )
      .run(kind, deviceId, now, now);
    const label = deviceName ? `${deviceName} ${INCIDENT_LABEL[kind]}` : INCIDENT_LABEL[kind];
    this.activity.record({ eventType: 'connection', outcome: 'warning', deviceId, message: `${label}.` });
    this.logger.warn({ kind, deviceId }, 'Connection problem detected');
  }

  private close(kind: IncidentKind, deviceId: string | null, deviceName?: string): void {
    const existing = this.findOpen(kind, deviceId);
    if (!existing) return;
    const now = this.clock.nowIso();
    this.db.prepare('UPDATE connection_incidents SET closed_at = ?, last_seen_at = ? WHERE id = ?').run(now, now, existing.id);
    const lasted = durationText(this.clock.nowMs() - Date.parse(existing.opened_at));
    const message =
      kind === 'device_offline'
        ? `${deviceName ?? 'A light'} is back online after ${lasted}.`
        : kind === 'device_missing'
          ? `${deviceName ?? 'A light'} is back in the Govee device list.`
          : `Resolved after ${lasted}: ${INCIDENT_LABEL[kind]}.`;
    this.activity.record({ eventType: 'connection', outcome: 'success', deviceId, message });
    this.logger.info({ kind, deviceId }, 'Connection problem resolved');
  }

  /* -------------------------------- catch-up ------------------------------- */

  private expireOldDeliveries(): void {
    const cutoff = this.clock.nowMs() - this.config.missedMaxHours * HOUR_MS;
    for (const delivery of this.missed.waiting()) {
      if (Date.parse(delivery.createdAt) < cutoff) {
        this.missed.finish(
          delivery.id,
          'expired',
          `Older than ${this.config.missedMaxHours} hours, so it was not sent. Lights should not change unexpectedly for something this old.`,
        );
      }
    }
  }

  /** When on, sends each light that is back online the latest thing it missed. */
  private async deliverCaughtUp(): Promise<void> {
    const enabled = this.getSettings().catchUpEnabled;
    for (const delivery of this.missed.waiting()) {
      const device = this.devices.repository.get(delivery.deviceId);
      if (!device || device.online !== true) continue;
      // The owner already sent this light something newer, which must not be overwritten.
      if (device.lastAcceptedAt && device.lastAcceptedAt > delivery.createdAt) {
        this.missed.finish(delivery.id, 'replaced', 'The light received a newer command after coming back online.');
        continue;
      }
      if (enabled) await this.deliver(delivery, device, 'automatic');
    }
  }

  private async deliver(delivery: WaitingDelivery, device: DeviceRecord, trigger: 'automatic' | 'manual'): Promise<void> {
    if (!this.missed.claim(delivery.id)) return;
    const run = await this.actions.runPlan({ type: 'preset', id: null, name: catchUpName(delivery.runName) }, [
      { device, actions: delivery.actions },
    ]);
    const accepted = run.status === 'all_accepted';
    this.missed.finish(
      delivery.id,
      accepted ? 'delivered' : 'failed',
      accepted ? 'Accepted by Govee.' : `Result: ${run.status}. See activity for details.`,
    );
    this.activity.record({
      eventType: 'connection',
      outcome: accepted ? 'success' : 'warning',
      deviceId: device.id,
      message: accepted
        ? `Caught ${device.name} up with "${delivery.runName}" (${trigger}). Govee accepted it, but cannot confirm the colors.`
        : `Could not catch ${device.name} up with "${delivery.runName}".`,
    });
  }

  async sendNow(id: number): Promise<void> {
    const delivery = this.missed.findWaiting(id);
    if (!delivery) throw notFound('That missed delivery');
    const device = this.devices.getRecord(delivery.deviceId);
    if (device.online !== true) {
      throw new AppError(409, 'device_offline', `${device.name} is not online yet, so this cannot be sent.`);
    }
    await this.deliver(delivery, device, 'manual');
  }

  dismiss(id: number): void {
    if (!this.missed.findWaiting(id)) throw notFound('That missed delivery');
    this.missed.finish(id, 'dismissed', 'Dismissed by the owner.');
  }

  /* --------------------------------- report -------------------------------- */

  private openIncident(kind: IncidentKind, deviceId: string): IncidentRow | undefined {
    return this.findOpen(kind, deviceId);
  }

  private dropsSince(deviceId: string, sinceIso: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM connection_incidents WHERE kind = 'device_offline' AND device_id = ? AND opened_at >= ?`,
      )
      .get(deviceId, sinceIso) as { n: number };
    return row.n;
  }

  private deviceHealth(device: DeviceRecord): DeviceHealthDto {
    const since = new Date(this.clock.nowMs() - WEEK_MS).toISOString();
    const base = {
      deviceId: device.id,
      name: device.name,
      sku: device.sku,
      lastOnlineAt: device.lastOnlineAt,
      lastCheckedAt: device.lastStatusRefreshAt,
      dropsLast7Days: this.dropsSince(device.id, since),
    };
    if (device.discoveryStatus === 'missing') {
      return { ...base, state: 'missing', problemSince: device.missingSince, note: null };
    }
    if (isGoveeGroup(device)) {
      return {
        ...base,
        state: 'not_monitored',
        problemSince: null,
        note: 'A group made in the Govee Home app. Govee provides no status for groups, so its lights are checked individually.',
      };
    }
    if (!this.devices.statusAvailable(device)) {
      return { ...base, state: 'unknown', problemSince: null, note: device.lastStatusError?.message ?? null };
    }
    const incident = this.openIncident('device_offline', device.id);
    if (device.online === false || incident) {
      return { ...base, state: 'offline', problemSince: incident?.opened_at ?? null, note: null };
    }
    return { ...base, state: device.online === true ? 'online' : 'unknown', problemSince: null, note: null };
  }

  report(): ConnectionReportDto {
    const devices = this.devices.repository.list().map((d) => this.deviceHealth(d));
    const openGlobal = this.db
      .prepare(`SELECT kind FROM connection_incidents WHERE device_id IS NULL AND closed_at IS NULL`)
      .all() as { kind: IncidentKind }[];
    const advice = diagnose(devices, new Set(openGlobal.map((row) => row.kind)));
    const waiting = this.missed.listWaiting();
    const incidents = this.db
      .prepare(
        `SELECT i.*, d.name AS device_name FROM connection_incidents i
         LEFT JOIN devices d ON d.id = i.device_id
         ORDER BY i.opened_at DESC, i.id DESC LIMIT 50`,
      )
      .all() as IncidentRow[];

    return {
      overall: overallStatus(devices, advice, waiting.length),
      monitor: {
        status: !this.config.enabled ? 'disabled' : this.timer || this.current ? 'running' : 'stopped',
        lastCheckAt: this.lastCheckAt,
        intervalSeconds: this.intervalSeconds(),
      },
      catchUpEnabled: this.getSettings().catchUpEnabled,
      advice,
      devices,
      waiting,
      recentDeliveries: this.missed.recentFinished(10),
      incidents: incidents.map(incidentToDto),
      automaticActions: this.activity.list({ eventType: 'connection', limit: 15 }).events,
    };
  }
}
