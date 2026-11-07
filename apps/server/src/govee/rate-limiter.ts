import type { AppConfig } from '../config/env.js';
import type { Clock } from '../shared/clock.js';
import { TransportError } from './transport.js';

export type GoveeEndpoint = 'list' | 'control' | 'state' | 'scenes';

/** Refills continuously up to capacity. A single JS thread makes check-then-take atomic. */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly clock: Clock,
  ) {
    this.tokens = capacity;
    this.lastRefill = clock.nowMs();
  }

  private refill(): void {
    const now = this.clock.nowMs();
    const elapsed = Math.max(0, now - this.lastRefill);
    this.tokens = Math.min(this.capacity, this.tokens + (elapsed / 1000) * this.refillPerSecond);
    this.lastRefill = now;
  }

  msUntilAvailable(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    return Math.ceil(((1 - this.tokens) / this.refillPerSecond) * 1000);
  }

  take(): void {
    this.refill();
    this.tokens -= 1;
  }
}

/**
 * Client-side limits so the app stays below Govee's. Buckets are per account or
 * per device to match how Govee documents each endpoint. A 429 from Govee pauses
 * every endpoint until the time Govee asked for.
 */
export class GoveeRateLimiter {
  private readonly accountBuckets = new Map<string, TokenBucket>();
  private readonly deviceBuckets = new Map<string, TokenBucket>();
  private pausedUntilMs = 0;
  private dayKey = '';
  private dayCount = 0;

  constructor(
    private readonly limits: AppConfig['limits'],
    private readonly clock: Clock,
  ) {}

  private accountBucket(key: string, capacity: number, perSecond: number): TokenBucket {
    let bucket = this.accountBuckets.get(key);
    if (!bucket) {
      bucket = new TokenBucket(capacity, perSecond, this.clock);
      this.accountBuckets.set(key, bucket);
    }
    return bucket;
  }

  private deviceBucket(key: string, capacity: number, perSecond: number): TokenBucket {
    let bucket = this.deviceBuckets.get(key);
    if (!bucket) {
      bucket = new TokenBucket(capacity, perSecond, this.clock);
      this.deviceBuckets.set(key, bucket);
    }
    return bucket;
  }

  private bucketsFor(endpoint: GoveeEndpoint, deviceId?: string): TokenBucket[] {
    const { listPerMinute, controlAccountPerSecond, controlDevicePerSecond, statePerMinute, scenesPerMinute } =
      this.limits;
    switch (endpoint) {
      case 'list':
        return [this.accountBucket('list', Math.max(1, Math.floor(listPerMinute / 4)), listPerMinute / 60)];
      case 'control': {
        const buckets = [
          this.accountBucket('control', Math.max(1, Math.ceil(controlAccountPerSecond * 2)), controlAccountPerSecond),
        ];
        if (deviceId) {
          buckets.push(
            this.deviceBucket(
              `control:${deviceId}`,
              Math.max(1, Math.ceil(controlDevicePerSecond * 2)),
              controlDevicePerSecond,
            ),
          );
        }
        return buckets;
      }
      case 'state':
        return [
          this.deviceBucket(
            `state:${deviceId ?? 'unknown'}`,
            Math.max(1, Math.floor(statePerMinute / 4)),
            statePerMinute / 60,
          ),
        ];
      case 'scenes':
        return [
          this.deviceBucket(
            `scenes:${deviceId ?? 'unknown'}`,
            Math.max(1, Math.floor(scenesPerMinute / 4)),
            scenesPerMinute / 60,
          ),
        ];
    }
  }

  private rollDay(): void {
    const key = this.clock.nowIso().slice(0, 10);
    if (key !== this.dayKey) {
      this.dayKey = key;
      this.dayCount = 0;
    }
  }

  /**
   * Waits for permission to call an endpoint. Throws rate_limited rather than
   * wait longer than maxWaitMs, so a request cannot hang behind a long pause.
   */
  async acquire(endpoint: GoveeEndpoint, deviceId: string | undefined, maxWaitMs: number): Promise<void> {
    const buckets = this.bucketsFor(endpoint, deviceId);
    const deadline = this.clock.nowMs() + maxWaitMs;

    for (;;) {
      this.rollDay();
      if (this.dayCount >= this.limits.dailyBudget) {
        throw new TransportError(
          'rate_limited',
          `The app's daily Govee request budget (${this.limits.dailyBudget}) is used up. It resets at 00:00 UTC.`,
        );
      }
      const now = this.clock.nowMs();
      const pauseWait = Math.max(0, this.pausedUntilMs - now);
      const wait = Math.max(pauseWait, ...buckets.map((b) => b.msUntilAvailable()));
      if (wait <= 0) {
        for (const bucket of buckets) bucket.take();
        this.dayCount += 1;
        return;
      }
      if (now + wait > deadline) {
        throw new TransportError(
          'rate_limited',
          'The Govee rate limit means this request cannot be sent right now. Try again shortly.',
          { retryAfterMs: wait },
        );
      }
      await this.clock.sleep(wait);
    }
  }

  /** Stops all Govee traffic for a while. Only ever extends an existing pause. */
  pause(ms: number): void {
    this.pausedUntilMs = Math.max(this.pausedUntilMs, this.clock.nowMs() + ms);
  }

  pausedUntil(): string | null {
    return this.pausedUntilMs > this.clock.nowMs() ? new Date(this.pausedUntilMs).toISOString() : null;
  }

  requestsToday(): number {
    this.rollDay();
    return this.dayCount;
  }
}

/** Exponential backoff with equal jitter. Honours a server-requested delay when longer. */
export function computeBackoffMs(
  attempt: number,
  options: { baseMs: number; maxMs: number; retryAfterMs?: number },
  random: () => number = Math.random,
): number {
  const exponential = Math.min(options.maxMs, options.baseMs * 2 ** Math.max(0, attempt - 1));
  const jittered = exponential / 2 + random() * (exponential / 2);
  return Math.ceil(Math.max(jittered, options.retryAfterMs ?? 0));
}
