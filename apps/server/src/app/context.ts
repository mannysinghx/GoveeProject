import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ActivityService } from '../activity/activity-service.js';
import { AuthService } from '../auth/auth-service.js';
import { ActionService } from '../commands/action-service.js';
import { CommandQueue } from '../commands/command-queue.js';
import { CommandStore } from '../commands/command-store.js';
import { isLoopbackHost, PROJECT_ROOT, type AppConfig } from '../config/env.js';
import { NotificationService } from '../notifications/notification-service.js';
import { webPushSender, type PushSender } from '../notifications/push-sender.js';
import { BuiltinPresets } from '../presets/builtin-presets.js';
import { HolidayCalendar } from '../presets/holiday-calendar.js';
import { ConnectionMonitor } from '../connection/connection-monitor.js';
import { MissedDeliveryStore } from '../connection/missed-delivery-store.js';
import { openDatabase, runMigrations, type Db } from '../database/database.js';
import { DeviceService } from '../devices/device-service.js';
import { SceneStore } from '../devices/scene-store.js';
import { GoveeCloudTransport } from '../govee/cloud-transport.js';
import { GoveeGateway } from '../govee/gateway.js';
import { GoveeRateLimiter } from '../govee/rate-limiter.js';
import type { LightTransport } from '../govee/transport.js';
import { GroupService } from '../groups/group-service.js';
import { PresetService } from '../presets/preset-service.js';
import { ScheduleService } from '../scheduler/schedule-service.js';
import { Scheduler } from '../scheduler/scheduler.js';
import { systemClock, type Clock } from '../shared/clock.js';
import { createLogger, createSecretScrubber, type Logger } from '../shared/logger.js';
import { Maintenance } from '../system/maintenance.js';
import { SettingsService } from '../system/settings-service.js';
import { SystemState } from '../system/system-state.js';

export interface AppContext {
  config: AppConfig;
  version: string;
  startedAt: number;
  logger: Logger;
  clock: Clock;
  db: Db;
  scrub: (text: string) => string;
  transport: LightTransport;
  limiter: GoveeRateLimiter;
  gateway: GoveeGateway;
  system: SystemState;
  activity: ActivityService;
  settings: SettingsService;
  auth: AuthService;
  /** Set when setup needs a code and the code was generated rather than configured. */
  generatedSetupCode: string | null;
  commands: CommandStore;
  queue: CommandQueue;
  scenes: SceneStore;
  devices: DeviceService;
  actions: ActionService;
  groups: GroupService;
  presets: PresetService;
  schedules: ScheduleService;
  scheduler: Scheduler;
  maintenance: Maintenance;
  missed: MissedDeliveryStore;
  connection: ConnectionMonitor;
  builtins: BuiltinPresets;
  holidays: HolidayCalendar;
  notifications: NotificationService;
}

export interface ContextOverrides {
  logger?: Logger;
  clock?: Clock;
  transport?: LightTransport;
  db?: Db;
  pushSender?: PushSender;
}

export function readVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * If anyone else could reach setup first, a code is required. That covers a non-loopback
 * bind, and a loopback bind behind a reverse proxy, where the bind address says nothing
 * about who can connect.
 */
function resolveSetupCode(config: AppConfig): { code: string | null; generated: boolean } {
  if (config.setupToken) return { code: config.setupToken, generated: false };
  const reachableByOthers =
    !isLoopbackHost(config.host) ||
    config.trustProxy ||
    (config.allowedHosts ?? []).some((host) => !isLoopbackHost(host));
  if (!reachableByOthers) return { code: null, generated: false };
  return { code: crypto.randomBytes(9).toString('base64url'), generated: true };
}

/** Wires every service together. Tests pass overrides for the clock and transport. */
export function createContext(config: AppConfig, overrides: ContextOverrides = {}): AppContext {
  const secrets = [config.govee.apiKey, config.setupToken];
  const logger = overrides.logger ?? createLogger({ level: config.logLevel, secrets });
  const clock = overrides.clock ?? systemClock;
  const scrub = createSecretScrubber(secrets);

  const db = overrides.db ?? openDatabase(config.databasePath);
  runMigrations(db, config.migrationsDir, logger);

  const system = new SystemState(db, clock);
  const activity = new ActivityService(db, clock, scrub);
  const settings = new SettingsService(db, activity, clock);
  const setup = resolveSetupCode(config);
  const auth = new AuthService(db, activity, logger, clock, {
    sessionTtlHours: config.sessionTtlHours,
    setupCode: setup.code,
  });

  const transport =
    overrides.transport ??
    new GoveeCloudTransport({
      apiKey: config.govee.apiKey,
      baseUrl: config.govee.baseUrl,
      timeoutMs: config.govee.timeoutMs,
    });
  const limiter = new GoveeRateLimiter(config.limits, clock);
  const gateway = new GoveeGateway(transport, limiter, system, activity, logger, clock, config.govee);

  const commands = new CommandStore(db, clock);
  const queue = new CommandQueue(transport, limiter, gateway, commands, activity, logger, clock, {
    govee: config.govee,
    queue: config.queue,
  });
  const scenes = new SceneStore(db);
  const devices = new DeviceService(
    db,
    gateway,
    scenes,
    commands,
    queue,
    activity,
    system,
    logger,
    clock,
    () => settings.get(),
    {
      stateMinRefreshSeconds: config.stateMinRefreshSeconds,
      postCommandRefreshMs: config.queue.postCommandRefreshMs,
    },
  );
  const missed = new MissedDeliveryStore(db, clock);
  const actions = new ActionService(db, scenes, queue, commands, activity, clock, missed);
  const groups = new GroupService(db, devices.repository, actions, activity, clock);
  const presets = new PresetService(db, devices.repository, scenes, groups, actions, activity, clock);
  const schedules = new ScheduleService(db, devices.repository, groups, presets, activity, clock);
  const scheduler = new Scheduler(
    db,
    devices.repository,
    groups,
    presets,
    actions,
    activity,
    logger,
    clock,
    config.scheduler,
  );
  const maintenance = new Maintenance(db, auth, activity, commands, devices, system, logger, clock, {
    historyRetentionDays: config.historyRetentionDays,
    discoveryRefreshHours: config.discoveryRefreshHours,
    apiKeyConfigured: transport.isConfigured(),
  });

  const connection = new ConnectionMonitor(
    db,
    devices,
    actions,
    missed,
    activity,
    () => settings.get(),
    () => transport.isConfigured(),
    logger,
    clock,
    { ...config.connection, dailyBudget: config.limits.dailyBudget },
  );

  const holidays = new HolidayCalendar(db, schedules, presets, activity, clock);
  // Web Push needs a contact address for the app. Its own address is the natural one.
  const pushSubject = config.allowedHosts?.[0]
    ? `https://${config.allowedHosts[0]}`
    : 'https://github.com/mannysinghx/GoveeProject';
  const notifications = new NotificationService(
    db,
    activity,
    () => settings.get(),
    overrides.pushSender ?? webPushSender,
    pushSubject,
    logger,
    clock,
  );
  actions.onRunFinished(
    (run) => notifications.handleRun(run),
    (error) => logger.warn({ err: error }, 'Could not notify about a run'),
  );
  connection.onIncident((event, kind, deviceName) => notifications.handleIncident(event, kind, deviceName));
  notifications.onDidntChange(() => void connection.check());

  const builtins = new BuiltinPresets(
    db,
    devices,
    scenes,
    groups,
    schedules,
    activity,
    () => settings.get(),
    () => transport.isConfigured(),
    logger,
    clock,
  );

  return {
    config,
    version: readVersion(),
    startedAt: clock.nowMs(),
    logger,
    clock,
    db,
    scrub,
    transport,
    limiter,
    gateway,
    system,
    activity,
    settings,
    auth,
    generatedSetupCode: setup.generated ? setup.code : null,
    commands,
    queue,
    scenes,
    devices,
    actions,
    groups,
    presets,
    schedules,
    scheduler,
    maintenance,
    missed,
    connection,
    builtins,
    holidays,
    notifications,
  };
}
