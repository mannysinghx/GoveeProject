import type { Logger } from 'pino';
import type {
  AppSettings,
  CapabilityStateDto,
  CommandDto,
  Connectivity,
  DeviceDetailDto,
  DeviceDto,
  DiscoveryResultDto,
  ErrorCategory,
  Freshness,
  RefreshResultDto,
  ScenesDto,
  Verification,
} from '@glm/shared';
import crypto from 'node:crypto';
import type { ActivityService } from '../activity/activity-service.js';
import type { CommandQueue } from '../commands/command-queue.js';
import type { CommandStore } from '../commands/command-store.js';
import type { Db } from '../database/database.js';
import { normalizeCapabilities, parseSceneOptions, type ParsedSceneOption } from '../govee/capabilities.js';
import type { GoveeGateway } from '../govee/gateway.js';
import { TransportError, type RawCapability } from '../govee/transport.js';
import type { Clock } from '../shared/clock.js';
import { AppError, notFound } from '../shared/errors.js';
import type { SystemState } from '../system/system-state.js';
import { DeviceRepository, type DeviceRecord } from './device-repository.js';
import { sceneToDto, type SceneStore } from './scene-store.js';

/** The model this project targets first. Used for a highlight only. */
const PRIMARY_MODEL = 'H805C';
const STATE_HISTORY_PER_DEVICE = 200;
/**
 * After Govee refuses a status request outright, wait this long before polling again.
 * Govee groups do this every time ("devices not exist"), and a retry cannot change the answer.
 * Asking by hand always goes through, and a successful report clears this at once.
 */
const REFUSED_STATUS_RETRY_MS = 24 * 3600 * 1000;

export type StateSource = 'manual' | 'poll' | 'post_command';

interface CapabilityStateRow {
  device_id: string;
  instance: string;
  requested_value_json: string | null;
  requested_at: string | null;
  accepted_value_json: string | null;
  accepted_at: string | null;
  reported_value_json: string | null;
  reported_at: string | null;
  reported_historical: number;
  not_queryable: number;
  verification: Verification | null;
}

export function isGoveeGroup(device: { sku: string }): boolean {
  return /group/i.test(device.sku);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function toTransportError(error: unknown): TransportError {
  return error instanceof TransportError
    ? error
    : new TransportError('unknown', 'Unexpected error while calling Govee.');
}

const HTTP_FOR_CATEGORY: Partial<Record<ErrorCategory, number>> = {
  not_configured: 503,
  device_offline: 409,
  auth: 502,
  rate_limited: 429,
  timeout: 504,
  network: 502,
  server_error: 502,
  not_found: 404,
  bad_request: 422,
};

/** Maps a Govee failure on a read to an HTTP error the client can show. */
export function httpErrorFromTransport(error: TransportError): AppError {
  return new AppError(
    HTTP_FOR_CATEGORY[error.category] ?? 502,
    `govee_${error.category}`,
    error.message,
    undefined,
    error.retryAfterMs === undefined ? undefined : Math.ceil(error.retryAfterMs / 1000),
  );
}

export class DeviceService {
  readonly repository: DeviceRepository;
  private readonly postCommandTimers = new Map<string, NodeJS.Timeout>();
  private stopped = false;

  constructor(
    private readonly db: Db,
    private readonly gateway: GoveeGateway,
    private readonly scenes: SceneStore,
    private readonly commands: CommandStore,
    private readonly queue: CommandQueue,
    private readonly activity: ActivityService,
    private readonly system: SystemState,
    private readonly logger: Logger,
    private readonly clock: Clock,
    private readonly getSettings: () => AppSettings,
    private readonly config: { stateMinRefreshSeconds: number; postCommandRefreshMs: number },
  ) {
    this.repository = new DeviceRepository(db);
    this.queue.onAccepted((deviceId) => this.schedulePostCommandRefresh(deviceId, 0));
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.postCommandTimers.values()) clearTimeout(timer);
    this.postCommandTimers.clear();
  }

  /* ---------------------------------- reads --------------------------------- */

  list(): DeviceDto[] {
    return this.repository.list().map((device) => this.toDto(device));
  }

  getRecord(id: string): DeviceRecord {
    const device = this.repository.get(id);
    if (!device) throw notFound('That device');
    return device;
  }

  get(id: string): DeviceDto {
    return this.toDto(this.getRecord(id));
  }

  getDetail(id: string): DeviceDetailDto {
    const record = this.getRecord(id);
    return {
      ...this.toDto(record),
      rawCapabilities: record.rawCapabilities,
      recentCommands: this.commands.listForDevice(id, 25),
    };
  }

  private capabilityStates(deviceId: string): CapabilityStateDto[] {
    const rows = this.db
      .prepare('SELECT * FROM capability_states WHERE device_id = ? ORDER BY instance')
      .all(deviceId) as CapabilityStateRow[];
    return rows.map((row) => ({
      instance: row.instance,
      requested:
        row.requested_value_json !== null && row.requested_at
          ? { value: JSON.parse(row.requested_value_json), at: row.requested_at }
          : null,
      accepted:
        row.accepted_value_json !== null && row.accepted_at
          ? { value: JSON.parse(row.accepted_value_json), at: row.accepted_at }
          : null,
      reported:
        row.reported_value_json !== null && row.reported_at
          ? {
              value: JSON.parse(row.reported_value_json),
              at: row.reported_at,
              historical: row.reported_historical === 1,
            }
          : null,
      notQueryable: row.not_queryable === 1,
      verification: row.verification,
    }));
  }

  toDto(device: DeviceRecord): DeviceDto {
    const settings = this.getSettings();
    let freshness: Freshness = 'never';
    if (device.lastStatusRefreshAt) {
      const ageMs = this.clock.nowMs() - Date.parse(device.lastStatusRefreshAt);
      freshness = ageMs > settings.staleAfterSeconds * 1000 ? 'stale' : 'fresh';
    }
    let connectivity: Connectivity = 'unknown';
    if (device.online === true) connectivity = 'online';
    if (device.online === false) connectivity = 'offline';

    return {
      id: device.id,
      goveeDeviceId: device.goveeDeviceId,
      sku: device.sku,
      name: device.name,
      deviceType: device.deviceType,
      isPrimaryModel: device.sku.toUpperCase() === PRIMARY_MODEL,
      isGoveeGroup: isGoveeGroup(device),
      discoveryStatus: device.discoveryStatus,
      lastDiscoveredAt: device.lastDiscoveredAt,
      missingSince: device.missingSince,
      capabilities: device.capabilities,
      connectivity,
      freshness,
      lastStatusRefreshAt: device.lastStatusRefreshAt,
      lastOnlineAt: device.lastOnlineAt,
      lastRequestAt: device.lastRequestAt,
      lastAcceptedAt: device.lastAcceptedAt,
      lastStatusError: device.lastStatusError,
      states: this.capabilityStates(device.id),
      pendingCommands: this.queue.pendingForDevice(device.id),
    };
  }

  /* -------------------------------- discovery ------------------------------- */

  async discover(correlationId?: string): Promise<DiscoveryResultDto> {
    let raw;
    try {
      raw = await this.gateway.discoverDevices();
    } catch (error) {
      const failure = toTransportError(error);
      this.activity.record({
        eventType: 'discovery',
        outcome: 'failure',
        correlationId,
        message: `Device discovery failed: ${failure.message}`,
        details: { category: failure.category },
      });
      throw httpErrorFromTransport(failure);
    }

    const now = this.clock.nowIso();
    let added = 0;
    let updated = 0;
    let noLongerDiscovered = 0;

    this.db.transaction(() => {
      const seen = new Set<string>();
      for (const device of raw) {
        const normalized = normalizeCapabilities(device.capabilities);
        const existing = this.repository.findRowByAddress(device.sku, device.device);
        const name = device.deviceName ?? existing?.name ?? device.sku;
        const capabilitiesJson = JSON.stringify(device.capabilities);
        let id: string;

        if (existing) {
          id = existing.id;
          updated += 1;
          this.db
            .prepare(
              `UPDATE devices
               SET name = ?, device_type = ?, capabilities_json = ?, discovery_status = 'present',
                   last_discovered_at = ?, missing_since = NULL, updated_at = ?
               WHERE id = ?`,
            )
            .run(name, device.type, capabilitiesJson, now, now, id);
        } else {
          id = crypto.randomUUID();
          added += 1;
          this.db
            .prepare(
              `INSERT INTO devices
                 (id, govee_device_id, sku, name, device_type, capabilities_json, discovery_status,
                  first_discovered_at, last_discovered_at, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, 'present', ?, ?, ?, ?)`,
            )
            .run(id, device.device, device.sku, name, device.type, capabilitiesJson, now, now, now, now);
        }
        seen.add(id);
        this.scenes.syncFromDeviceList(id, device.capabilities, normalized, now);
      }

      // Devices that disappeared keep their row, so history, presets and schedules survive.
      const present = this.db.prepare(`SELECT id FROM devices WHERE discovery_status = 'present'`).all() as {
        id: string;
      }[];
      for (const { id } of present) {
        if (seen.has(id)) continue;
        noLongerDiscovered += 1;
        this.db
          .prepare(`UPDATE devices SET discovery_status = 'missing', missing_since = ?, updated_at = ? WHERE id = ?`)
          .run(now, now, id);
      }
    })();

    this.system.setLastDiscovery(now);
    this.activity.record({
      eventType: 'discovery',
      outcome: 'success',
      correlationId,
      message: `Discovered ${raw.length} device(s): ${added} new, ${noLongerDiscovered} no longer listed.`,
      details: { total: raw.length, added, updated, noLongerDiscovered },
    });
    this.logger.info({ total: raw.length, added, updated, noLongerDiscovered }, 'Device discovery succeeded');

    return { total: raw.length, added, updated, noLongerDiscovered, discoveredAt: now, devices: this.list() };
  }

  /* ---------------------------------- state --------------------------------- */

  async refreshState(id: string, source: StateSource, correlationId?: string): Promise<RefreshResultDto> {
    const device = this.getRecord(id);
    if (device.discoveryStatus !== 'present') {
      throw new AppError(
        409,
        'device_missing',
        `${device.name} was not in the last Govee device list, so its status cannot be requested.`,
      );
    }

    if (source !== 'post_command' && device.lastStatusRefreshAt) {
      const ageMs = this.clock.nowMs() - Date.parse(device.lastStatusRefreshAt);
      if (ageMs < this.config.stateMinRefreshSeconds * 1000) {
        return { device: this.toDto(device), throttled: true };
      }
    }

    let capabilities: RawCapability[];
    try {
      const result = await this.gateway.getDeviceState(id, { sku: device.sku, device: device.goveeDeviceId });
      capabilities = result.capabilities;
    } catch (error) {
      const failure = toTransportError(error);
      this.recordStatusError(id, failure);
      // Background checks repeat, so they report through connection incidents rather
      // than adding a line to the activity log every couple of minutes.
      if (source !== 'poll') {
        this.activity.record({
          eventType: 'state',
          outcome: 'failure',
          deviceId: id,
          correlationId,
          message: `Status refresh failed for ${device.name}: ${failure.message}`,
          details: { category: failure.category },
        });
      }
      throw httpErrorFromTransport(failure);
    }

    this.applyReportedState(id, capabilities, source);
    return { device: this.get(id), throttled: false };
  }

  /** Refreshes devices whose report is older than the poll interval. For an open dashboard. */
  async refreshDue(correlationId?: string): Promise<DeviceDto[]> {
    const { statusPollSeconds } = this.getSettings();
    const now = this.clock.nowMs();
    for (const device of this.repository.list()) {
      if (device.discoveryStatus !== 'present' || this.statusRefused(device)) continue;
      const age = device.lastStatusRefreshAt ? now - Date.parse(device.lastStatusRefreshAt) : Infinity;
      if (age < statusPollSeconds * 1000) continue;
      try {
        await this.refreshState(device.id, 'poll', correlationId);
      } catch (error) {
        // Already recorded on the device and in activity. One device must not stop the rest.
        this.logger.debug({ err: error, deviceId: device.id }, 'Status poll failed');
      }
    }
    return this.list();
  }

  /** False for lights Govee gives no status for, so there is nothing to monitor. */
  statusAvailable(device: DeviceRecord): boolean {
    return device.discoveryStatus === 'present' && !isGoveeGroup(device) && !this.statusRefused(device);
  }

  private statusRefused(device: DeviceRecord): boolean {
    const error = device.lastStatusError;
    if (!error || (error.category !== 'bad_request' && error.category !== 'not_found')) return false;
    return this.clock.nowMs() - Date.parse(error.at) < REFUSED_STATUS_RETRY_MS;
  }

  private recordStatusError(id: string, failure: TransportError): void {
    this.db
      .prepare('UPDATE devices SET last_status_error_json = ? WHERE id = ?')
      .run(JSON.stringify({ category: failure.category, message: failure.message, at: this.clock.nowIso() }), id);
  }

  /**
   * Stores a report and compares it with what was accepted. Govee's rules, from its
   * state documentation: an empty value means the setting cannot be queried, and
   * online=false means the values are historical and have no reference significance.
   */
  private applyReportedState(id: string, capabilities: RawCapability[], source: StateSource): void {
    const now = this.clock.nowIso();
    const onlineEntry = capabilities.find((c) => c.instance === 'online');
    const onlineValue = (onlineEntry?.state as { value?: unknown } | undefined)?.value;
    const online = typeof onlineValue === 'boolean' ? onlineValue : null;
    const historical = online === false;

    this.db.transaction(() => {
      const upsert = this.db.prepare(
        `INSERT INTO capability_states
           (device_id, instance, reported_value_json, reported_at, reported_historical, not_queryable)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(device_id, instance) DO UPDATE SET
           reported_value_json = excluded.reported_value_json,
           reported_at = excluded.reported_at,
           reported_historical = excluded.reported_historical,
           not_queryable = excluded.not_queryable`,
      );
      const reportedInstances = new Set<string>();
      for (const capability of capabilities) {
        if (typeof capability.instance !== 'string' || capability.instance === 'online') continue;
        const value = (capability.state as { value?: unknown } | undefined)?.value;
        const empty = value === undefined || value === null || value === '';
        reportedInstances.add(capability.instance);
        upsert.run(id, capability.instance, empty ? null : JSON.stringify(value), empty ? null : now, historical ? 1 : 0, empty ? 1 : 0);
      }

      this.reconcile(id, reportedInstances, online);

      this.db
        .prepare(
          `UPDATE devices
           SET online = ?, last_status_refresh_at = ?,
               last_online_at = CASE WHEN ? = 1 THEN ? ELSE last_online_at END,
               last_status_error_json = NULL
           WHERE id = ?`,
        )
        .run(online === null ? null : online ? 1 : 0, now, online === true ? 1 : 0, now, id);

      this.db
        .prepare(
          `INSERT INTO device_states (device_id, reported_state_json, online, reported_at, source)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(id, JSON.stringify(capabilities), online === null ? null : online ? 1 : 0, now, source);

      this.db
        .prepare(
          `DELETE FROM device_states WHERE device_id = ? AND id NOT IN (
             SELECT id FROM device_states WHERE device_id = ? ORDER BY id DESC LIMIT ?
           )`,
        )
        .run(id, id, STATE_HISTORY_PER_DEVICE);
    })();
  }

  /** Decides what each unverified command's outcome is, given the report just stored. */
  private reconcile(id: string, reportedInstances: Set<string>, online: boolean | null): void {
    // An offline report is historical, so it cannot confirm or contradict anything.
    if (online === false) return;

    const rows = this.db
      // Mismatch is included because reports can lag: a later report may catch up.
      .prepare(`SELECT * FROM capability_states WHERE device_id = ? AND verification IN ('unverified', 'mismatch')`)
      .all(id) as CapabilityStateRow[];

    const setVerification = this.db.prepare(
      'UPDATE capability_states SET verification = ? WHERE device_id = ? AND instance = ?',
    );

    for (const row of rows) {
      let verification: Verification;
      if (!reportedInstances.has(row.instance) || row.not_queryable === 1 || row.reported_value_json === null) {
        verification = 'not_reported';
      } else if (
        row.accepted_value_json !== null &&
        canonical(JSON.parse(row.reported_value_json)) === canonical(JSON.parse(row.accepted_value_json))
      ) {
        verification = 'confirmed';
      } else {
        verification = 'mismatch';
      }
      setVerification.run(verification, id, row.instance);
      this.commands.setVerificationForLatest(id, row.instance, verification);
    }
  }

  private schedulePostCommandRefresh(deviceId: string, followUps: number): void {
    if (this.stopped) return;
    const existing = this.postCommandTimers.get(deviceId);
    if (existing) clearTimeout(existing);
    const delay = this.config.postCommandRefreshMs * (followUps + 1);
    const timer = setTimeout(() => {
      this.postCommandTimers.delete(deviceId);
      // Wait for queued work first, so the report reflects the newest command.
      if (this.queue.pendingForDevice(deviceId).length > 0) return;
      const device = this.repository.get(deviceId);
      if (!device || this.statusRefused(device)) return;
      void this.refreshState(deviceId, 'post_command')
        .then(({ device }) => {
          // Govee's report can lag behind a command. Check once more if something still differs.
          const unsettled = device.states.some(
            (s) => s.verification === 'mismatch' || s.verification === 'unverified',
          );
          if (unsettled && followUps === 0) this.schedulePostCommandRefresh(deviceId, 1);
        })
        .catch((error: unknown) => {
          this.logger.debug({ err: error, deviceId }, 'Post-command status refresh failed');
        });
    }, delay);
    timer.unref?.();
    this.postCommandTimers.set(deviceId, timer);
  }

  /* ---------------------------------- scenes -------------------------------- */

  getScenes(id: string): ScenesDto {
    const device = this.getRecord(id);
    return {
      supported: device.capabilities.some((c) => c.kind === 'scene'),
      fetchedAt: device.scenesFetchedAt,
      scenes: this.scenes.list(id).map(sceneToDto),
      lastRefreshErrors: device.sceneErrors,
    };
  }

  /**
   * Asks the scene endpoints only for what the device says it supports. A failed
   * source keeps its cached scenes and reports its error next to the others.
   */
  async refreshScenes(id: string, correlationId?: string): Promise<ScenesDto> {
    const device = this.getRecord(id);
    if (device.discoveryStatus !== 'present') {
      throw new AppError(409, 'device_missing', `${device.name} was not in the last Govee device list.`);
    }
    const sceneCaps = device.capabilities.filter((c) => c.kind === 'scene');
    if (sceneCaps.length === 0) {
      throw new AppError(
        422,
        'unsupported_capability',
        `${device.name} does not report scenes through the Govee API.`,
      );
    }

    const address = { sku: device.sku, device: device.goveeDeviceId };
    const now = this.clock.nowIso();
    const errors: ScenesDto['lastRefreshErrors'] = [];
    let anySuccess = false;

    const lightCap = sceneCaps.find((c) => c.instance === 'lightScene');
    if (lightCap) {
      try {
        const caps = await this.gateway.getDynamicScenes(id, address);
        const options = this.optionsFrom(caps, 'lightScene', 'dynamic');
        this.scenes.replace(
          id,
          'scenes_endpoint',
          options.map((option) => ({ option, kind: 'dynamic' as const, capabilityType: lightCap.type, instance: 'lightScene' })),
          now,
        );
        anySuccess = true;
      } catch (error) {
        const failure = toTransportError(error);
        errors.push({ source: 'dynamic', category: failure.category, message: failure.message });
      }
    }

    const diyCap = sceneCaps.find((c) => c.instance === 'diyScene');
    if (diyCap) {
      try {
        const caps = await this.gateway.getDiyScenes(id, address);
        const options = this.optionsFrom(caps, 'diyScene', 'diy');
        // Docs list three different types for diyScene. The one from the device list is
        // used because it is what this specific device reported; see docs/govee-integration.md.
        this.scenes.replace(
          id,
          'diy_endpoint',
          options.map((option) => ({ option, kind: 'diy' as const, capabilityType: diyCap.type, instance: 'diyScene' })),
          now,
        );
        anySuccess = true;
      } catch (error) {
        const failure = toTransportError(error);
        errors.push({ source: 'diy', category: failure.category, message: failure.message });
      }
    }

    this.db
      .prepare(
        `UPDATE devices
         SET scenes_fetched_at = CASE WHEN ? = 1 THEN ? ELSE scenes_fetched_at END, scene_errors_json = ?
         WHERE id = ?`,
      )
      .run(anySuccess ? 1 : 0, now, JSON.stringify(errors), id);

    const count = this.scenes.list(id).length;
    this.activity.record({
      eventType: 'scene',
      outcome: errors.length > 0 ? (anySuccess ? 'warning' : 'failure') : 'success',
      deviceId: id,
      correlationId,
      message:
        errors.length > 0
          ? `Scene refresh for ${device.name} had problems: ${errors.map((e) => `${e.source}: ${e.message}`).join(' ')}`
          : `Refreshed scenes for ${device.name}: ${count} available.`,
    });
    return this.getScenes(id);
  }

  private optionsFrom(caps: RawCapability[], instance: string, prefix: string): ParsedSceneOption[] {
    return caps.filter((c) => c.instance === instance).flatMap((c) => parseSceneOptions(prefix, c.parameters));
  }

  /* --------------------------------- commands -------------------------------- */

  commandHistory(id: string, limit: number): CommandDto[] {
    this.getRecord(id);
    return this.commands.listForDevice(id, limit);
  }
}
