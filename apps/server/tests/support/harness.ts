import { Writable } from 'node:stream';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app/build-app.js';
import { configSecrets, createContext, type AppContext, type ContextOverrides } from '../../src/app/context.js';
import { loadConfig, PROJECT_ROOT, type AppConfig } from '../../src/config/env.js';
import type { Clock } from '../../src/shared/clock.js';
import { createLogger } from '../../src/shared/logger.js';
import { MockGovee, TEST_API_KEY } from './mock-govee.js';

/** Time only moves when told to. sleep() advances it, so nothing waits on real time. */
export class FakeClock implements Clock {
  readonly sleeps: number[] = [];

  constructor(private ms: number = Date.parse('2026-06-15T12:00:00.000Z')) {}

  now(): Date {
    return new Date(this.ms);
  }
  nowMs(): number {
    return this.ms;
  }
  nowIso(): string {
    return new Date(this.ms).toISOString();
  }
  async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.ms += ms;
    await Promise.resolve();
  }
  set(iso: string): void {
    this.ms = Date.parse(iso);
  }
  advance(ms: number): void {
    this.ms += ms;
  }
}

export function testConfig(overrides: NodeJS.ProcessEnv = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    DATABASE_PATH: ':memory:',
    MIGRATIONS_DIR: path.join(PROJECT_ROOT, 'migrations'),
    WEB_DIST_DIR: path.join(PROJECT_ROOT, 'does-not-exist'),
    GOVEE_API_KEY: TEST_API_KEY,
    LOG_LEVEL: 'info',
    GOVEE_RETRY_BASE_MS: '1',
    GOVEE_RETRY_MAX_MS: '4',
    GOVEE_REQUEST_TIMEOUT_MS: '500',
    // Never fires during a test. Tests call refreshState directly.
    POST_COMMAND_REFRESH_MS: '1000000000',
    STATE_MIN_REFRESH_SECONDS: '1',
    ...overrides,
  });
}

export interface Harness {
  ctx: AppContext;
  app: FastifyInstance;
  mock: MockGovee;
  clock: FakeClock;
  logs: () => string;
  close: () => Promise<void>;
}

export async function createHarness(
  options: { env?: NodeJS.ProcessEnv; overrides?: ContextOverrides; startMock?: boolean } = {},
): Promise<Harness> {
  const mock = new MockGovee();
  if (options.startMock !== false) await mock.start();

  const logBuffer: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      logBuffer.push(chunk.toString('utf8'));
      callback();
    },
  });

  const config = testConfig({
    ...(options.startMock !== false ? { GOVEE_API_BASE_URL: mock.url } : {}),
    ...options.env,
  });
  const clock = new FakeClock();
  const logger = createLogger({
    level: config.logLevel,
    secrets: configSecrets(config),
    destination,
  });
  const ctx = createContext(config, { clock, logger, ...options.overrides });
  const app = await buildApp(ctx);
  await app.ready();

  return {
    ctx,
    app,
    mock,
    clock,
    logs: () => logBuffer.join(''),
    close: async () => {
      ctx.devices.stop();
      await ctx.queue.stop(100);
      await ctx.scheduler.stop();
      await app.close();
      ctx.db.close();
      await mock.stop();
    },
  };
}

/** Signs up an owner and returns a client that sends the cookie and CSRF header. */
export async function authedClient(app: FastifyInstance, password = 'correct-horse-battery') {
  const setup = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/setup',
    payload: { username: 'owner', password },
  });
  if (setup.statusCode !== 201) throw new Error(`Setup failed: ${setup.body}`);
  const cookie = setup.cookies.find((c) => c.name === 'glm_session');
  const body = setup.json() as { csrfToken: string };
  const cookies = { glm_session: cookie?.value ?? '' };
  const headers = { 'x-csrf-token': body.csrfToken };

  return {
    cookies,
    csrfToken: body.csrfToken,
    get: (url: string) => app.inject({ method: 'GET', url, cookies }),
    post: (url: string, payload?: object) =>
      app.inject({ method: 'POST', url, cookies, headers, ...(payload ? { payload } : {}) }),
    patch: (url: string, payload: object) => app.inject({ method: 'PATCH', url, cookies, headers, payload }),
    delete: (url: string) => app.inject({ method: 'DELETE', url, cookies, headers }),
  };
}
