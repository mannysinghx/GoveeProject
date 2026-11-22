import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MEMBER_LIMITS } from '@glm/shared';
import { ActivityService } from '../activity/activity-service.js';
import { AccountService, readAiLimit } from '../account/account-service.js';
import { PersonalKeys } from '../account/personal-keys.js';
import { AiGate, AiService } from '../ai/ai-service.js';
import { AskTools } from '../ai/ask-tools.js';
import { AiLedger } from '../ai/ledger.js';
import { AuthService } from '../auth/auth-service.js';
import { accountFileFor, cutoverOwner, LegacyOwnerMirror, openControlDatabase, resolveAccountFile } from '../auth/control.js';
import { SignupService } from '../auth/signup-service.js';
import { ActionService } from '../commands/action-service.js';
import { CommandQueue } from '../commands/command-queue.js';
import { CommandStore } from '../commands/command-store.js';
import { MailOutbox, type MailSender } from '../mail/outbox.js';
import { sendSmtp } from '../mail/smtp-client.js';
import { APP_NAME } from '../mail/templates.js';
import { isLoopbackHost, PROJECT_ROOT, type AiProviderConfig, type AppConfig } from '../config/env.js';
import { NotificationService } from '../notifications/notification-service.js';
import { webPushSender, type PushSender } from '../notifications/push-sender.js';
import { BuiltinPresets } from '../presets/builtin-presets.js';
import { DailySchemeService } from '../presets/daily-scheme-service.js';
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
import { CredentialStore } from '../security/credentials.js';
import { RequestRate } from '../security/limits.js';
import { ProofOfWork } from '../security/proof-of-work.js';
import { systemClock, type Clock } from '../shared/clock.js';
import { createLogger, SecretRegistry, type Logger } from '../shared/logger.js';
import { Maintenance } from '../system/maintenance.js';
import { SettingsService } from '../system/settings-service.js';
import { SystemState } from '../system/system-state.js';
import { AccountRegistry } from './accounts.js';

/**
 * One person's part of the app: their database, their Govee connection, and every service
 * and background timer that works on their lights. Nothing in here is shared with another
 * account. Routes never hold one of these: they look it up for each request, through
 * `accountOf` in request-account.ts.
 */
export interface AccountContext {
  /** The user this account belongs to. */
  userId: number;
  config: AppConfig;
  logger: Logger;
  clock: Clock;
  db: Db;
  /** Hides every secret the process knows, including ones added after startup. */
  scrub: (text: string) => string;
  transport: LightTransport;
  limiter: GoveeRateLimiter;
  gateway: GoveeGateway;
  system: SystemState;
  activity: ActivityService;
  settings: SettingsService;
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
  dailyScheme: DailySchemeService;
  notifications: NotificationService;
  ai: AiService;
}

/**
 * What exists once per process. It deliberately has no light, schedule or notification
 * services, so a route given only this cannot reach anyone's data without asking for the
 * signed-in person's account.
 */
export interface PlatformContext {
  config: AppConfig;
  version: string;
  startedAt: number;
  logger: Logger;
  clock: Clock;
  secrets: SecretRegistry;
  /** Users, sessions, login attempts, encrypted credentials and the audit log. */
  control: Db;
  credentials: CredentialStore;
  /** Sign-in and sessions, in the control database. */
  auth: AuthService;
  /** Sign-up, reset and address changes by email. */
  signup: SignupService;
  outbox: MailOutbox;
  pow: ProofOfWork;
  /** Keys, export, delete, and the owner's list of accounts. */
  account: AccountService;
  /** Members' own keys, decrypted when first needed. */
  keys: PersonalKeys;
  /** Signed-in requests a minute, per member. */
  requestRate: RequestRate;
  /** AI requests running at once, across every account. */
  aiGate: AiGate;
  /** Set when setup needs a code and the code was generated rather than configured. */
  generatedSetupCode: string | null;
  accounts: AccountRegistry;
}

export interface ContextOverrides {
  logger?: Logger;
  clock?: Clock;
  /** The registry the logger scrubs with. Tests pass the one their logger was built with. */
  secrets?: SecretRegistry;
  /** The control database. Tests may pass their own. */
  controlDb?: Db;
  /** These apply to the owner's account. */
  transport?: LightTransport;
  db?: Db;
  pushSender?: PushSender;
  /** Stands in for the AI providers in tests. */
  aiFetch?: typeof fetch;
  /** Tests only: a certificate authority the SMTP client trusts, for the local test server. */
  smtpCa?: string | Buffer;
  /** Tests only: replaces the SMTP client. */
  mailSender?: MailSender;
  /** Tests only: replaces the Govee request that checks a key someone connects. */
  checkGoveeKey?: (apiKey: string) => Promise<void>;
}

/** The owner's account belongs to user 1. Everyone else is a member with their own file. */
export const OWNER_USER_ID = 1;

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

/** Every secret the server's own configuration holds, so none can reach a log line or activity record. */
export function configSecrets(config: AppConfig): (string | null)[] {
  return [
    config.govee.apiKey,
    config.setupToken,
    ...config.ai.providers.map((p) => p.apiKey),
    ...(config.credentialKeys?.encoded ?? []),
    config.mail.smtp?.password ?? null,
  ];
}

interface AccountDeps {
  userId: number;
  /** This account's own database file. */
  databasePath: string;
  /**
   * Where this account's Govee key comes from. Required, with no default, so no account can
   * end up using the owner's GOVEE_API_KEY by leaving it out.
   */
  goveeKey: () => string | null;
  /**
   * The AI providers this account may use, asked for on each request. Only the owner's account
   * gets the server's keys. Everyone else's are their own.
   */
  aiProviders: () => AiProviderConfig[];
  /** True for an account whose AI keys and cap are its own, not the server's. */
  personalAi: boolean;
  /** Shared by every account: how many AI requests may run at once on the server. */
  aiGate: AiGate;
  /** Whether holiday shows are set up switched on. Only the owner's are. */
  holidayShowsStartEnabled: boolean;
  logger: Logger;
  clock: Clock;
  secrets: SecretRegistry;
  /** Removes expired sign-in sessions. Only the account that holds sessions does anything. */
  pruneSessions: () => number;
  db?: Db;
  transport?: LightTransport;
  pushSender?: PushSender;
  aiFetch?: typeof fetch;
}

/** Wires one account's services together, exactly as the single-account app always has. */
export function createAccountContext(config: AppConfig, deps: AccountDeps): AccountContext {
  const { userId, logger, clock } = deps;
  const scrub = deps.secrets.scrub;

  const db = deps.db ?? openDatabase(deps.databasePath);
  runMigrations(db, config.migrationsDir, logger);

  const system = new SystemState(db, clock);
  const activity = new ActivityService(db, clock, scrub);
  const settings = new SettingsService(db, activity, clock);

  const transport =
    deps.transport ??
    new GoveeCloudTransport({
      apiKey: deps.goveeKey,
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
  const presets = new PresetService(db, devices.repository, scenes, groups, actions, activity, clock, () => settings.get().defaultTimeZone);
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
  const maintenance = new Maintenance(db, deps.pruneSessions, activity, commands, devices, system, logger, clock, {
    historyRetentionDays: config.historyRetentionDays,
    discoveryRefreshHours: config.discoveryRefreshHours,
    apiKeyConfigured: () => transport.isConfigured(),
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
  const dailyScheme = new DailySchemeService(db, devices.repository, groups, presets, schedules, activity, () => settings.get(), clock);
  // Web Push needs a contact address for the app. Its own address is the natural one.
  const pushSubject = config.allowedHosts?.[0]
    ? `https://${config.allowedHosts[0]}`
    : 'https://github.com/mannysinghx/GoveeProject';
  const notifications = new NotificationService(
    db,
    activity,
    () => settings.get(),
    deps.pushSender ?? webPushSender,
    pushSubject,
    logger,
    clock,
    String(userId),
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
    deps.holidayShowsStartEnabled,
  );

  const ai = new AiService(
    new AiLedger(db, clock),
    new AskTools({ devices, schedules, commands, connection, activity }),
    () => settings.get(),
    scrub,
    logger,
    clock,
    {
      config: config.ai,
      providers: deps.aiProviders,
      ...(deps.personalAi ? { monthlyLimitUsd: () => readAiLimit(db), missingReason: 'no_key' as const } : {}),
      gate: deps.aiGate,
      drafts: { devices, groups, presets },
      ...(deps.aiFetch ? { fetchImpl: deps.aiFetch } : {}),
    },
  );

  return {
    userId,
    config,
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
    dailyScheme,
    notifications,
    ai,
  };
}

/**
 * Where the owner's Govee key comes from, during the move from a Railway variable to an
 * encrypted credential:
 * - While GOVEE_API_KEY is set it is used, and the stored copy is kept the same, so changing
 *   the variable in Railway still works as it always has, and removing it later is safe.
 * - Without it, the stored copy is used, if CREDENTIAL_KEYS can read it.
 * sync() runs once the owner exists in the control database: after the cutover at startup,
 * and after first-run setup, because a stored key belongs to a user row.
 */
class OwnerGoveeKey {
  private current: string | null;

  constructor(
    private readonly config: AppConfig,
    private readonly credentials: CredentialStore,
    private readonly secrets: SecretRegistry,
    private readonly control: Db,
    private readonly logger: Logger,
    private readonly clock: Clock,
  ) {
    this.current = config.govee.apiKey;
  }

  readonly get = (): string | null => this.current;

  sync(): void {
    const fromVariable = this.config.govee.apiKey;
    const ownerExists = this.control.prepare('SELECT 1 FROM users WHERE id = ?').get(OWNER_USER_ID) !== undefined;
    if (!this.credentials.enabled()) {
      if (fromVariable) this.logger.warn('CREDENTIAL_KEYS is not set, so the Govee key is not stored encrypted. It stays in GOVEE_API_KEY.');
      this.current = fromVariable;
      return;
    }
    if (!ownerExists) {
      // Nothing to store a key against until setup makes the owner.
      this.current = fromVariable;
      return;
    }
    const stored = this.credentials.get(OWNER_USER_ID, 'govee');
    if (fromVariable) {
      if (!stored || 'error' in stored || stored.secret !== fromVariable) {
        try {
          this.credentials.put(OWNER_USER_ID, 'govee', fromVariable);
          this.control
            .prepare("INSERT INTO audit_events (created_at, user_id, event, ip, details_json) VALUES (?, 1, 'govee_key_stored', NULL, ?)")
            .run(this.clock.nowIso(), JSON.stringify({ replaced: stored !== null }));
          this.logger.info({ replaced: stored !== null }, 'Stored the Govee key encrypted, from GOVEE_API_KEY');
        } catch (error) {
          this.logger.warn({ err: error }, 'Could not store the Govee key encrypted. GOVEE_API_KEY is still used.');
        }
      }
      this.current = fromVariable;
      return;
    }
    if (!stored) {
      this.current = null;
      return;
    }
    if ('error' in stored) {
      this.logger.error({ problem: stored.error }, 'The stored Govee key cannot be read. Set GOVEE_API_KEY, or restore CREDENTIAL_KEYS.');
      this.current = null;
      return;
    }
    this.secrets.add(stored.secret);
    this.logger.info('Using the stored, encrypted Govee key');
    this.current = stored.secret;
  }
}

/**
 * Builds the platform, the control database and the owner's account, which uses the existing
 * database file at DATABASE_PATH, unchanged. On first start after this version, the owner's
 * sign-in moves into the control database (see cutoverOwner). Tests pass overrides.
 */
export function createPlatform(config: AppConfig, overrides: ContextOverrides = {}): PlatformContext {
  const secrets = overrides.secrets ?? new SecretRegistry();
  for (const secret of configSecrets(config)) secrets.add(secret);
  const logger = overrides.logger ?? createLogger({ level: config.logLevel, secrets });
  const clock = overrides.clock ?? systemClock;
  const setup = resolveSetupCode(config);

  const control = openControlDatabase(config, logger, overrides.controlDb);
  const credentials = new CredentialStore(control, config.credentialKeys, clock);

  const goveeKey = new OwnerGoveeKey(config, credentials, secrets, control, logger, clock);
  const keys = new PersonalKeys(credentials, secrets, logger);
  const aiGate = new AiGate(8);

  // Sessions are in the control database, and the owner's maintenance prunes them hourly.
  let auth: AuthService | null = null;
  let signup: SignupService | null = null;
  const pruneSessions = () => {
    signup?.prune();
    return auth?.pruneExpiredSessions() ?? 0;
  };
  const owner = createAccountContext(config, {
    userId: OWNER_USER_ID,
    databasePath: config.databasePath,
    logger,
    clock,
    secrets,
    pruneSessions,
    goveeKey: goveeKey.get,
    // Decided 21 November 2026 (P3): the server's AI keys are for the owner only.
    aiProviders: () => config.ai.providers,
    personalAi: false,
    aiGate,
    holidayShowsStartEnabled: true,
    ...(overrides.db ? { db: overrides.db } : {}),
    ...(overrides.transport ? { transport: overrides.transport } : {}),
    ...(overrides.pushSender ? { pushSender: overrides.pushSender } : {}),
    ...(overrides.aiFetch ? { aiFetch: overrides.aiFetch } : {}),
  });

  const ownerAccountFile = accountFileFor(config);
  cutoverOwner(control, owner.db, ownerAccountFile, clock, logger);
  goveeKey.sync();

  /**
   * A member's account: their own file, the Govee key they connect, and AI only with their own
   * key. Nothing here comes from the owner's configuration.
   */
  const loadMember = (userId: number): AccountContext | null => {
    const row = control.prepare("SELECT account_file FROM users WHERE id = ? AND role = 'member' AND status = 'active'").get(userId) as
      | { account_file: string }
      | undefined;
    if (!row) return null;
    return createAccountContext(config, {
      userId,
      databasePath: resolveAccountFile(config, row.account_file),
      logger: logger.child({ account: userId }),
      clock,
      secrets,
      // Only the owner's account prunes the control database's sessions.
      pruneSessions: () => 0,
      goveeKey: () => keys.govee(userId),
      aiProviders: () => keys.ai(userId),
      personalAi: true,
      aiGate,
      holidayShowsStartEnabled: false,
      ...(overrides.pushSender ? { pushSender: overrides.pushSender } : {}),
      ...(overrides.aiFetch ? { aiFetch: overrides.aiFetch } : {}),
    });
  };

  const accounts = new AccountRegistry(loadMember, logger);
  accounts.add(owner);
  const members = control.prepare("SELECT id FROM users WHERE role = 'member' AND status = 'active' ORDER BY id").all() as { id: number }[];
  for (const member of members) accounts.ensure(member.id);

  auth = new AuthService(
    control,
    // An attempt under a name nobody has goes to the owner's activity, as it always has.
    (userId) => accounts.forUser(userId ?? OWNER_USER_ID)?.activity ?? null,
    logger,
    clock,
    { sessionTtlHours: config.sessionTtlHours, setupCode: setup.code, ownerAccountFile, onOwnerCreated: () => goveeKey.sync() },
    new LegacyOwnerMirror(owner.db),
  );

  const smtp = config.mail.smtp;
  const heloName = config.mail.from?.split('@')[1] ?? 'localhost';
  const sender: MailSender | null =
    overrides.mailSender ??
    (smtp ? (envelope, data) => sendSmtp({ ...smtp, heloName, ...(overrides.smtpCa ? { ca: overrides.smtpCa } : {}) }, envelope, data) : null);
  const outbox = new MailOutbox(control, sender, clock, logger, {
    from: config.mail.from,
    fromName: APP_NAME,
    hourlyLimit: config.mail.hourlyLimit,
    pollMs: 5_000,
  });
  const pow = new ProofOfWork(clock, config.signup.powDifficulty);
  signup = new SignupService({
    control,
    auth,
    outbox,
    pow,
    clock,
    logger,
    publicUrl: config.publicUrl,
    legacy: new LegacyOwnerMirror(owner.db),
    onAccountCreated: (userId) => {
      accounts.ensure(userId);
    },
  });

  const checkGoveeKey =
    overrides.checkGoveeKey ??
    (async (apiKey: string) => {
      const probe = new GoveeCloudTransport({ apiKey, baseUrl: config.govee.baseUrl, timeoutMs: config.govee.timeoutMs });
      await probe.discoverDevices();
    });
  const account = new AccountService({
    config,
    control,
    credentials,
    secrets,
    keys,
    auth,
    accounts,
    clock,
    logger,
    ownerGoveeChanged: () => goveeKey.sync(),
    checkGoveeKey,
    ...(overrides.aiFetch ? { aiFetch: overrides.aiFetch } : {}),
  });

  return {
    config,
    version: readVersion(),
    startedAt: clock.nowMs(),
    logger,
    clock,
    secrets,
    control,
    credentials,
    auth,
    signup,
    outbox,
    pow,
    account,
    keys,
    requestRate: new RequestRate(MEMBER_LIMITS.requestsPerMinute),
    aiGate,
    generatedSetupCode: setup.generated ? setup.code : null,
    accounts,
  };
}
