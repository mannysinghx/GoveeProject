import crypto from 'node:crypto';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import type { ActivityService } from '../activity/activity-service.js';
import type { Clock } from '../shared/clock.js';
import type { SystemState } from '../system/system-state.js';
import { computeBackoffMs, type GoveeEndpoint, type GoveeRateLimiter } from './rate-limiter.js';
import { TransportError, type DeviceAddress, type LightTransport, type RawCapability } from './transport.js';

/** Longest a read will wait for rate-limit room before reporting back to the caller. */
const READ_MAX_WAIT_MS = 15_000;

/**
 * Rate limiting, bounded retries and connection bookkeeping for read requests.
 * Commands take the same limiter but go through the dispatch queue instead.
 */
export class GoveeGateway {
  constructor(
    private readonly transport: LightTransport,
    private readonly limiter: GoveeRateLimiter,
    private readonly system: SystemState,
    private readonly activity: ActivityService,
    private readonly logger: Logger,
    private readonly clock: Clock,
    private readonly config: AppConfig['govee'],
  ) {}

  isConfigured(): boolean {
    return this.transport.isConfigured();
  }

  discoverDevices() {
    return this.run('list', undefined, () => this.transport.discoverDevices());
  }

  getDeviceState(deviceId: string, address: DeviceAddress) {
    return this.run('state', deviceId, () =>
      this.transport.getDeviceState(address, { requestId: crypto.randomUUID() }),
    );
  }

  getDynamicScenes(deviceId: string, address: DeviceAddress): Promise<RawCapability[]> {
    return this.run('scenes', deviceId, () => this.transport.getDynamicScenes(address));
  }

  getDiyScenes(deviceId: string, address: DeviceAddress): Promise<RawCapability[]> {
    return this.run('scenes', deviceId, () => this.transport.getDiyScenes(address));
  }

  /** Called for every Govee response, including those made by the command queue. */
  noteSuccess(): void {
    this.system.setLastSuccessfulConnection(this.clock.nowIso());
  }

  noteFailure(error: TransportError, context: { deviceId?: string | undefined; endpoint: string }): void {
    this.system.setLastError(error.category, this.clock.nowIso());
    this.logger.warn(
      {
        endpoint: context.endpoint,
        deviceId: context.deviceId,
        category: error.category,
        httpStatus: error.options.httpStatus,
        goveeCode: error.options.goveeCode,
      },
      'Govee request failed',
    );
    if (error.category === 'rate_limited') {
      this.system.setLastRateLimit(this.clock.nowIso());
      this.activity.record({
        eventType: 'rate_limit',
        outcome: 'warning',
        deviceId: context.deviceId,
        message: `Rate limit on ${context.endpoint}: ${error.message}`,
        details: { retryAfterMs: error.retryAfterMs ?? null },
      });
    }
  }

  private async run<T>(endpoint: GoveeEndpoint, deviceId: string | undefined, fn: () => Promise<T>): Promise<T> {
    const { maxAttempts, retryBaseMs, retryMaxMs } = this.config;
    let lastError: TransportError | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.limiter.acquire(endpoint, deviceId, READ_MAX_WAIT_MS);
      } catch (error) {
        if (error instanceof TransportError) this.noteFailure(error, { deviceId, endpoint });
        throw error;
      }
      try {
        const result = await fn();
        this.noteSuccess();
        return result;
      } catch (error) {
        const failure =
          error instanceof TransportError
            ? error
            : new TransportError('unknown', 'Unexpected error while calling Govee.');
        this.noteFailure(failure, { deviceId, endpoint });
        lastError = failure;

        if (failure.category === 'rate_limited' && failure.retryAfterMs !== undefined) {
          this.limiter.pause(failure.retryAfterMs);
        }
        if (!failure.retryable || attempt === maxAttempts) throw failure;

        const backoff = computeBackoffMs(attempt, {
          baseMs: retryBaseMs,
          maxMs: retryMaxMs,
          retryAfterMs: failure.retryAfterMs,
        });
        // Someone is waiting on this request, so report a long wait instead of sitting through it.
        if (backoff > READ_MAX_WAIT_MS) throw failure;
        await this.clock.sleep(backoff);
      }
    }
    throw lastError ?? new TransportError('unknown', 'Unexpected error while calling Govee.');
  }
}
