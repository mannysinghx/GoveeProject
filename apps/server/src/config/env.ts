import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { aiProviderIds, type AiProviderId } from '@glm/shared';

/**
 * Works from both src/config and dist/config because they share a depth:
 * apps/server/{src,dist}/config/env.* -> project root.
 */
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

export const OFFICIAL_GOVEE_BASE_URL = 'https://openapi.api.govee.com';
const OFFICIAL_GOVEE_HOST = 'openapi.api.govee.com';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase());
}

const emptyToUndefined = (value: unknown) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const booleanString = (fallback: boolean) =>
  z.preprocess(
    emptyToUndefined,
    z
      .enum(['true', 'false'])
      .default(fallback ? 'true' : 'false')
      .transform((v) => v === 'true'),
  );
const positiveNumber = (fallback: number) =>
  z.preprocess(emptyToUndefined, z.coerce.number().positive().default(fallback));
const positiveInt = (fallback: number) =>
  z.preprocess(emptyToUndefined, z.coerce.number().int().positive().default(fallback));

const envSchema = z.object({
  NODE_ENV: z.preprocess(emptyToUndefined, z.enum(['development', 'test', 'production']).default('development')),
  HOST: z.preprocess(emptyToUndefined, z.string().default('127.0.0.1')),
  PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(65535).default(8787)),
  ALLOWED_HOSTS: optionalString,
  COOKIE_SECURE: z.preprocess(emptyToUndefined, z.enum(['auto', 'true', 'false']).default('auto')),
  // true means one proxy. A number says how many sit in front of the app.
  TRUST_PROXY: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^(true|false|\d{1,2})$/, 'Use true, false, or the number of proxies')
      .default('false')
      .transform((v) => (v === 'true' ? 1 : v === 'false' ? 0 : Number(v))),
  ),
  SETUP_TOKEN: optionalString,

  DATABASE_PATH: z.preprocess(emptyToUndefined, z.string().default('./data/govee-light-manager.sqlite')),
  MIGRATIONS_DIR: optionalString,
  WEB_DIST_DIR: optionalString,
  LOG_LEVEL: z.preprocess(
    emptyToUndefined,
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ),
  SESSION_TTL_HOURS: positiveInt(168),

  GOVEE_API_KEY: optionalString,
  GOVEE_API_BASE_URL: z.preprocess(emptyToUndefined, z.string().default(OFFICIAL_GOVEE_BASE_URL)),
  GOVEE_REQUEST_TIMEOUT_MS: positiveInt(10_000),
  GOVEE_MAX_ATTEMPTS: positiveInt(3),
  GOVEE_RETRY_BASE_MS: positiveInt(500),
  GOVEE_RETRY_MAX_MS: positiveInt(8_000),

  // Conservative defaults, below the documented maxima (see docs/govee-integration.md).
  GOVEE_LIMIT_LIST_PER_MINUTE: positiveNumber(20),
  GOVEE_LIMIT_CONTROL_ACCOUNT_PER_SECOND: positiveNumber(8),
  GOVEE_LIMIT_CONTROL_DEVICE_PER_SECOND: positiveNumber(1),
  GOVEE_LIMIT_STATE_PER_MINUTE: positiveNumber(20),
  GOVEE_LIMIT_SCENES_PER_MINUTE: positiveNumber(10),
  GOVEE_DAILY_REQUEST_BUDGET: positiveInt(8_000),

  QUEUE_MAX_PER_DEVICE: positiveInt(100),
  QUEUE_MAX_WAIT_MS: positiveInt(60_000),
  POST_COMMAND_REFRESH_MS: positiveInt(2_500),
  STATE_MIN_REFRESH_SECONDS: positiveInt(5),
  DISCOVERY_REFRESH_HOURS: z.preprocess(emptyToUndefined, z.coerce.number().min(0).default(24)),

  SCHEDULER_ENABLED: booleanString(true),
  SCHEDULER_TICK_SECONDS: positiveInt(15),
  SCHEDULE_GRACE_SECONDS: positiveInt(120),
  SCHEDULE_CATCHUP_MAX_HOURS: positiveInt(12),

  HISTORY_RETENTION_DAYS: positiveInt(90),

  CONNECTION_MONITOR_ENABLED: booleanString(true),
  CONNECTION_CHECK_SECONDS: positiveInt(120),
  MISSED_DELIVERY_MAX_HOURS: positiveInt(24),

  // AI features. Each provider is used only when its key is set. See docs/ai-features-plan.md.
  AI_ENABLED: booleanString(true),
  AI_PROVIDERS: z.preprocess(emptyToUndefined, z.string().default(aiProviderIds.join(','))),
  AI_MONTHLY_LIMIT_USD: positiveNumber(5),
  AI_TIMEOUT_MS: positiveInt(45_000),
  DEEPSEEK_API_KEY: optionalString,
  DEEPSEEK_MODEL: z.preprocess(emptyToUndefined, z.string().default('deepseek-flash')),
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: z.preprocess(emptyToUndefined, z.string().default('gemini-3.1-flash-lite')),
  GLM_API_KEY: optionalString,
  GLM_MODEL: z.preprocess(emptyToUndefined, z.string().default('glm-4.7-flash')),
});

export interface AiProviderConfig {
  id: AiProviderId;
  apiKey: string;
  model: string;
}

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  host: string;
  port: number;
  allowedHosts: string[] | null;
  cookieSecure: 'auto' | boolean;
  trustProxy: boolean;
  /** How many proxies are in front of the app. The client address is taken from that far along. */
  trustProxyHops: number;
  setupToken: string | null;
  databasePath: string;
  migrationsDir: string;
  webDistDir: string;
  logLevel: string;
  sessionTtlHours: number;
  govee: {
    apiKey: string | null;
    baseUrl: string;
    usingLocalTestEndpoint: boolean;
    timeoutMs: number;
    maxAttempts: number;
    retryBaseMs: number;
    retryMaxMs: number;
  };
  limits: {
    listPerMinute: number;
    controlAccountPerSecond: number;
    controlDevicePerSecond: number;
    statePerMinute: number;
    scenesPerMinute: number;
    dailyBudget: number;
  };
  queue: {
    maxPerDevice: number;
    maxWaitMs: number;
    postCommandRefreshMs: number;
  };
  stateMinRefreshSeconds: number;
  discoveryRefreshHours: number;
  scheduler: {
    enabled: boolean;
    tickSeconds: number;
    graceSeconds: number;
    catchUpMaxHours: number;
  };
  historyRetentionDays: number;
  connection: {
    enabled: boolean;
    checkSeconds: number;
    missedMaxHours: number;
  };
  ai: {
    enabled: boolean;
    /** Providers with a key, in round-robin order. Empty means AI features are off. */
    providers: AiProviderConfig[];
    monthlyLimitUsd: number;
    timeoutMs: number;
  };
}

/** Keeps the order given in AI_PROVIDERS, drops unknown names and providers with no key. */
function resolveAiProviders(e: z.infer<typeof envSchema>): AiProviderConfig[] {
  const keys: Record<AiProviderId, { apiKey: string | undefined; model: string }> = {
    deepseek: { apiKey: e.DEEPSEEK_API_KEY, model: e.DEEPSEEK_MODEL },
    gemini: { apiKey: e.GEMINI_API_KEY, model: e.GEMINI_MODEL },
    glm: { apiKey: e.GLM_API_KEY, model: e.GLM_MODEL },
  };
  const wanted = e.AI_PROVIDERS.split(',')
    .map((name) => name.trim().toLowerCase())
    .filter((name): name is AiProviderId => (aiProviderIds as readonly string[]).includes(name));
  const providers: AiProviderConfig[] = [];
  for (const id of new Set(wanted)) {
    const entry = keys[id];
    if (entry.apiKey) providers.push({ id, apiKey: entry.apiKey, model: entry.model });
  }
  return providers;
}

export class ConfigError extends Error {}

/**
 * The API key is sent to whatever base URL is configured, so only the official
 * host is accepted, plus loopback for the local test server. A typo or a hostile
 * environment variable cannot send the key anywhere else.
 */
function validateGoveeBaseUrl(raw: string): { baseUrl: string; local: boolean } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError('GOVEE_API_BASE_URL is not a valid URL.');
  }
  if (url.protocol === 'https:' && url.hostname === OFFICIAL_GOVEE_HOST) {
    return { baseUrl: url.origin, local: false };
  }
  if (isLoopbackHost(url.hostname)) {
    return { baseUrl: url.origin, local: true };
  }
  throw new ConfigError(
    `GOVEE_API_BASE_URL must be ${OFFICIAL_GOVEE_BASE_URL} or a loopback address used for local testing.`,
  );
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // Report variable names and problems only. Values may be secrets.
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new ConfigError(`Invalid configuration. ${problems}`);
  }
  const e = parsed.data;
  const { baseUrl, local } = validateGoveeBaseUrl(e.GOVEE_API_BASE_URL);

  const resolveFromRoot = (p: string) => (path.isAbsolute(p) ? p : path.resolve(PROJECT_ROOT, p));

  return {
    env: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    allowedHosts: e.ALLOWED_HOSTS
      ? e.ALLOWED_HOSTS.split(',')
          .map((h) => h.trim().toLowerCase())
          .filter(Boolean)
      : null,
    cookieSecure: e.COOKIE_SECURE === 'auto' ? 'auto' : e.COOKIE_SECURE === 'true',
    trustProxy: e.TRUST_PROXY > 0,
    trustProxyHops: e.TRUST_PROXY,
    setupToken: e.SETUP_TOKEN ?? null,
    databasePath: e.DATABASE_PATH === ':memory:' ? ':memory:' : resolveFromRoot(e.DATABASE_PATH),
    migrationsDir: resolveFromRoot(e.MIGRATIONS_DIR ?? './migrations'),
    webDistDir: resolveFromRoot(e.WEB_DIST_DIR ?? './apps/web/dist'),
    logLevel: e.LOG_LEVEL,
    sessionTtlHours: e.SESSION_TTL_HOURS,
    govee: {
      apiKey: e.GOVEE_API_KEY ?? null,
      baseUrl,
      usingLocalTestEndpoint: local,
      timeoutMs: e.GOVEE_REQUEST_TIMEOUT_MS,
      maxAttempts: e.GOVEE_MAX_ATTEMPTS,
      retryBaseMs: e.GOVEE_RETRY_BASE_MS,
      retryMaxMs: e.GOVEE_RETRY_MAX_MS,
    },
    limits: {
      listPerMinute: e.GOVEE_LIMIT_LIST_PER_MINUTE,
      controlAccountPerSecond: e.GOVEE_LIMIT_CONTROL_ACCOUNT_PER_SECOND,
      controlDevicePerSecond: e.GOVEE_LIMIT_CONTROL_DEVICE_PER_SECOND,
      statePerMinute: e.GOVEE_LIMIT_STATE_PER_MINUTE,
      scenesPerMinute: e.GOVEE_LIMIT_SCENES_PER_MINUTE,
      dailyBudget: e.GOVEE_DAILY_REQUEST_BUDGET,
    },
    queue: {
      maxPerDevice: e.QUEUE_MAX_PER_DEVICE,
      maxWaitMs: e.QUEUE_MAX_WAIT_MS,
      postCommandRefreshMs: e.POST_COMMAND_REFRESH_MS,
    },
    stateMinRefreshSeconds: e.STATE_MIN_REFRESH_SECONDS,
    discoveryRefreshHours: e.DISCOVERY_REFRESH_HOURS,
    scheduler: {
      enabled: e.SCHEDULER_ENABLED,
      tickSeconds: e.SCHEDULER_TICK_SECONDS,
      graceSeconds: e.SCHEDULE_GRACE_SECONDS,
      catchUpMaxHours: e.SCHEDULE_CATCHUP_MAX_HOURS,
    },
    historyRetentionDays: e.HISTORY_RETENTION_DAYS,
    connection: {
      enabled: e.CONNECTION_MONITOR_ENABLED,
      checkSeconds: e.CONNECTION_CHECK_SECONDS,
      missedMaxHours: e.MISSED_DELIVERY_MAX_HOURS,
    },
    ai: {
      enabled: e.AI_ENABLED,
      providers: resolveAiProviders(e),
      monthlyLimitUsd: e.AI_MONTHLY_LIMIT_USD,
      timeoutMs: e.AI_TIMEOUT_MS,
    },
  };
}

/** Loads the project .env if there is one. Real environment variables win. */
export function loadDotEnv(): void {
  const candidates = [path.resolve(process.cwd(), '.env'), path.resolve(PROJECT_ROOT, '.env')];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      process.loadEnvFile(file);
      return;
    }
  }
}
