import type { FastifyInstance } from 'fastify';
import { settingsUpdateSchema, type DashboardSummaryDto, type DiagnosticsDto, type HealthDto } from '@glm/shared';
import type { PlatformContext } from '../app/context.js';
import { accountOf } from '../app/request-account.js';
import { checkDatabase, currentSchemaVersion } from '../database/database.js';
import { parseInput } from '../shared/validation.js';

export function registerSystemRoutes(api: FastifyInstance, platform: PlatformContext): void {
  const { config, clock, version } = platform;

  /**
   * Public on purpose, for container health checks. Reveals nothing sensitive. It is healthy
   * only when every account's database answers, and reports the first scheduler that is not
   * running, so one stuck account cannot hide behind the others.
   */
  api.get('/health', { config: { public: true, anyHost: true } }, async (_request, reply) => {
    const accounts = platform.accounts.all();
    const databaseOk = accounts.length > 0 && accounts.every((account) => checkDatabase(account.db));
    const statuses = accounts.map((account) => account.scheduler.status());
    const body: HealthDto = {
      status: databaseOk ? 'ok' : 'degraded',
      database: databaseOk ? 'ok' : 'error',
      scheduler: statuses.find((status) => status !== 'running') ?? statuses[0] ?? 'stopped',
      version,
    };
    return reply.status(databaseOk ? 200 : 503).send(body);
  });

  api.get('/system/status', async (request): Promise<DiagnosticsDto> => {
    const { db, devices, transport, system, limiter, scheduler, schedules, queue } = accountOf(request);
    const databaseOk = checkDatabase(db);
    const counts = devices.repository.counts();
    return {
      version,
      nodeVersion: process.version,
      uptimeSeconds: Math.floor((clock.nowMs() - platform.startedAt) / 1000),
      backend: 'ok',
      database: {
        status: databaseOk ? 'ok' : 'error',
        schemaVersion: databaseOk ? currentSchemaVersion(db) : null,
        // Where the server keeps its files is for the owner, not for every account.
        path: request.session?.role === 'owner' ? config.databasePath : null,
      },
      govee: {
        keyConfigured: transport.isConfigured(),
        usingLocalTestEndpoint: config.govee.usingLocalTestEndpoint,
        baseUrl: config.govee.baseUrl,
        lastSuccessfulConnectionAt: system.lastSuccessfulConnection(),
        lastErrorCategory: system.lastErrorCategory(),
        lastErrorAt: system.lastErrorAt(),
        lastRateLimitAt: system.lastRateLimit(),
        requestsToday: limiter.requestsToday(),
        dailyBudget: config.limits.dailyBudget,
      },
      devices: {
        discovered: counts.present,
        noLongerDiscovered: counts.missing,
        lastDiscoveryAt: system.lastDiscovery(),
      },
      scheduler: {
        status: scheduler.status(),
        lastTickAt: scheduler.lastTick(),
        enabledSchedules: schedules.enabledCount(),
      },
      queue: {
        pending: queue.pendingCount(),
        pausedUntil: limiter.pausedUntil(),
      },
    };
  });

  api.get('/dashboard/summary', async (request): Promise<DashboardSummaryDto> => {
    const { schedules, activity } = accountOf(request);
    return {
      upcoming: schedules.upcoming(5),
      recentFailures: activity.recentFailures(5),
    };
  });

  api.get('/settings', async (request) => accountOf(request).settings.get());

  api.patch('/settings', async (request) => {
    const { settings, builtins } = accountOf(request);
    const updated = settings.update(parseInput(settingsUpdateSchema, request.body));
    builtins.changed();
    return updated;
  });
}
