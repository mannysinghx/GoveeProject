import type { FastifyInstance } from 'fastify';
import { settingsUpdateSchema, type DashboardSummaryDto, type DiagnosticsDto, type HealthDto } from '@glm/shared';
import type { AppContext } from '../app/context.js';
import { checkDatabase, currentSchemaVersion } from '../database/database.js';
import { parseInput } from '../shared/validation.js';

export function registerSystemRoutes(api: FastifyInstance, ctx: AppContext): void {
  const { config, db, scheduler, settings, system, queue, limiter, devices, schedules, activity, clock, version } = ctx;

  /** Public on purpose, for container health checks. Reveals nothing sensitive. */
  api.get('/health', { config: { public: true, anyHost: true } }, async (_request, reply) => {
    const databaseOk = checkDatabase(db);
    const body: HealthDto = {
      status: databaseOk ? 'ok' : 'degraded',
      database: databaseOk ? 'ok' : 'error',
      scheduler: scheduler.status(),
      version,
    };
    return reply.status(databaseOk ? 200 : 503).send(body);
  });

  api.get('/system/status', async (): Promise<DiagnosticsDto> => {
    const databaseOk = checkDatabase(db);
    const counts = devices.repository.counts();
    return {
      version,
      nodeVersion: process.version,
      uptimeSeconds: Math.floor((clock.nowMs() - ctx.startedAt) / 1000),
      backend: 'ok',
      database: {
        status: databaseOk ? 'ok' : 'error',
        schemaVersion: databaseOk ? currentSchemaVersion(db) : null,
        path: config.databasePath,
      },
      govee: {
        keyConfigured: ctx.transport.isConfigured(),
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

  api.get('/dashboard/summary', async (): Promise<DashboardSummaryDto> => ({
    upcoming: schedules.upcoming(5),
    recentFailures: activity.recentFailures(5),
  }));

  api.get('/settings', async () => settings.get());

  api.patch('/settings', async (request) => {
    const updated = settings.update(parseInput(settingsUpdateSchema, request.body));
    ctx.builtins.changed();
    return updated;
  });
}
