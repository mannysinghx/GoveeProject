import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DeviceRecord } from '../src/devices/device-repository.js';
import { buildCommand } from '../src/devices/command-builder.js';
import type { CapabilityCommand, CommandAck, CommandContext, DeviceAddress, LightTransport } from '../src/govee/transport.js';
import { TransportError } from '../src/govee/transport.js';
import { computeBackoffMs, GoveeRateLimiter, TokenBucket } from '../src/govee/rate-limiter.js';
import { createHarness, FakeClock, type Harness } from './support/harness.js';
import { mockBasicDevice, mockFullDevice } from './support/mock-govee.js';

/** A transport with no network: records calls and fails on demand. */
class FakeTransport implements LightTransport {
  readonly name = 'fake';
  readonly sent: { device: string; instance: string; value: unknown; at: number }[] = [];
  failures: (TransportError | null)[] = [];
  /** Lets a test hold the first send open while more commands are queued. */
  gate: Promise<void> | null = null;
  clock: FakeClock | null = null;

  isConfigured() {
    return true;
  }
  async discoverDevices() {
    return [];
  }
  async getDeviceState() {
    return { capabilities: [] };
  }
  async getDynamicScenes() {
    return [];
  }
  async getDiyScenes() {
    return [];
  }
  async sendCommand(target: DeviceAddress, capability: CapabilityCommand, _context: CommandContext): Promise<CommandAck> {
    this.sent.push({
      device: target.device,
      instance: capability.instance,
      value: capability.value,
      at: this.clock?.nowMs() ?? 0,
    });
    if (this.gate) await this.gate;
    const failure = this.failures.shift();
    if (failure) throw failure;
    return { hadExplicitCode: true, rateLimit: null };
  }
}

describe('command queue', () => {
  let h: Harness;
  let transport: FakeTransport;
  let full: DeviceRecord;
  let basic: DeviceRecord;

  beforeEach(async () => {
    transport = new FakeTransport();
    h = await createHarness({ overrides: { transport } });
    transport.clock = h.clock;
    const now = h.clock.nowIso();
    const insert = h.ctx.db.prepare(
      `INSERT INTO devices (id, govee_device_id, sku, name, device_type, capabilities_json, discovery_status,
         first_discovered_at, last_discovered_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'light', ?, 'present', ?, ?, ?, ?)`,
    );
    for (const [id, source] of [
      ['full', mockFullDevice()],
      ['basic', mockBasicDevice()],
    ] as const) {
      insert.run(id, source.device, source.sku, id, JSON.stringify(source.capabilities), now, now, now, now);
    }
    full = h.ctx.devices.getRecord('full');
    basic = h.ctx.devices.getRecord('basic');
  });

  afterEach(() => h.close());

  function enqueue(device: DeviceRecord, value: number, coalesceKey: string | null = null) {
    const built = buildCommand(device, { type: 'brightness', value }, h.ctx.scenes);
    if (!built.ok) throw new Error(built.message);
    return h.ctx.queue.enqueue({
      deviceId: device.id,
      address: { sku: device.sku, device: device.goveeDeviceId },
      capability: built.command.capability,
      actionType: 'brightness',
      summary: `brightness ${value}`,
      coalesceKey,
      sourceType: 'manual',
    });
  }

  describe('ordering', () => {
    it('sends a device\'s commands strictly in the order they were queued', async () => {
      const results = await Promise.all([enqueue(full, 10).done, enqueue(full, 20).done, enqueue(full, 30).done]);
      expect(results.map((r) => r.status)).toEqual(['accepted', 'accepted', 'accepted']);
      expect(transport.sent.map((s) => s.value)).toEqual([10, 20, 30]);
    });

    it('never sends two commands for one device at the same time', async () => {
      let release!: () => void;
      transport.gate = new Promise((resolve) => {
        release = resolve;
      });
      const first = enqueue(full, 10);
      const second = enqueue(full, 20);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(transport.sent).toHaveLength(1);
      expect(h.ctx.queue.pendingForDevice('full')).toHaveLength(2);
      release();
      await Promise.all([first.done, second.done]);
      expect(transport.sent).toHaveLength(2);
    });

    it('does not let one device hold up another', async () => {
      let release!: () => void;
      transport.gate = new Promise((resolve) => {
        release = resolve;
      });
      const held = enqueue(full, 10);
      await new Promise((resolve) => setTimeout(resolve, 5));
      transport.gate = null;
      const other = await enqueue(basic, 55).done;
      expect(other.status).toBe('accepted');
      release();
      await held.done;
    });
  });

  describe('coalescing', () => {
    it('replaces a queued brightness with a newer one, and reports it as superseded', async () => {
      let release!: () => void;
      transport.gate = new Promise((resolve) => {
        release = resolve;
      });
      const inFlight = enqueue(full, 10, 'brightness');
      await new Promise((resolve) => setTimeout(resolve, 5));
      const replaced = enqueue(full, 20, 'brightness');
      const newest = enqueue(full, 30, 'brightness');
      release();
      const results = await Promise.all([inFlight.done, replaced.done, newest.done]);
      expect(results.map((r) => r.status)).toEqual(['accepted', 'superseded', 'accepted']);
      expect(transport.sent.map((s) => s.value)).toEqual([10, 30]);
    });

    it('coalesces commands queued in the same tick', async () => {
      const a = enqueue(full, 10, 'brightness');
      const b = enqueue(full, 20, 'brightness');
      await Promise.all([a.done, b.done]);
      expect(transport.sent.map((s) => s.value)).toEqual([20]);
    });

    it('does not reorder around a different setting between them', async () => {
      let release!: () => void;
      transport.gate = new Promise((resolve) => {
        release = resolve;
      });
      const inFlight = enqueue(full, 10, 'brightness');
      await new Promise((resolve) => setTimeout(resolve, 5));
      const a = enqueue(full, 20, 'brightness');
      const between = enqueue(full, 25, 'power');
      const b = enqueue(full, 30, 'brightness');
      release();
      await Promise.all([inFlight.done, a.done, between.done, b.done]);
      expect(transport.sent.map((s) => s.value)).toEqual([10, 20, 25, 30]);
    });

    it('never coalesces commands without a key, such as preset steps', async () => {
      await Promise.all([enqueue(full, 10, null).done, enqueue(full, 20, null).done]);
      expect(transport.sent.map((s) => s.value)).toEqual([10, 20]);
    });
  });

  describe('retries', () => {
    it('retries a retryable error and then succeeds', async () => {
      transport.failures = [new TransportError('server_error', 'boom'), new TransportError('timeout', 'slow')];
      const result = await enqueue(full, 10).done;
      expect(result.status).toBe('accepted');
      expect(result.attempts).toBe(3);
      expect(transport.sent).toHaveLength(3);
    });

    it('gives up after the attempt limit and reports failed, not rejected', async () => {
      transport.failures = [
        new TransportError('network', 'down'),
        new TransportError('network', 'down'),
        new TransportError('network', 'down'),
        new TransportError('network', 'down'),
      ];
      const result = await enqueue(full, 10).done;
      expect(result.status).toBe('failed');
      expect(result.errorCategory).toBe('network');
      expect(result.attempts).toBe(3);
      expect(transport.sent).toHaveLength(3);
    });

    it.each(['bad_request', 'auth', 'not_found', 'application_error'] as const)(
      'does not retry %s, and reports it as rejected',
      async (category) => {
        transport.failures = [new TransportError(category, 'nope')];
        const result = await enqueue(full, 10).done;
        expect(result.status).toBe('rejected');
        expect(result.errorCategory).toBe(category);
        expect(transport.sent).toHaveLength(1);
      },
    );

    it.each(['invalid_response', 'not_configured'] as const)(
      'does not retry %s, and does not claim Govee refused it',
      async (category) => {
        transport.failures = [new TransportError(category, 'unclear')];
        const result = await enqueue(full, 10).done;
        expect(result.status).toBe('failed');
        expect(result.errorCategory).toBe(category);
        expect(transport.sent).toHaveLength(1);
      },
    );

    it('keeps processing later commands after one fails', async () => {
      transport.failures = [new TransportError('bad_request', 'nope')];
      const [first, second] = await Promise.all([enqueue(full, 10).done, enqueue(full, 20).done]);
      expect(first.status).toBe('rejected');
      expect(second.status).toBe('accepted');
    });
  });

  describe('rate limits', () => {
    it('honours Retry-After from a 429 before the next attempt', async () => {
      const before = h.clock.nowMs();
      transport.failures = [new TransportError('rate_limited', 'slow down', { retryAfterMs: 5000 })];
      const result = await enqueue(full, 10).done;
      expect(result.status).toBe('accepted');
      expect(transport.sent[1]!.at - before).toBeGreaterThanOrEqual(5000);
    });

    it('applies a 429 pause to every device on the account', async () => {
      // One attempt, so the pause is still in force when the other device's command is sent.
      h.ctx.config.govee.maxAttempts = 1;
      transport.failures = [new TransportError('rate_limited', 'slow down', { retryAfterMs: 8000 })];
      const before = h.clock.nowMs();
      const first = await enqueue(full, 10).done;
      expect(first.status).toBe('failed');
      expect(h.ctx.limiter.pausedUntil()).toBe(new Date(before + 8000).toISOString());

      const other = await enqueue(basic, 20).done;
      expect(other.status).toBe('accepted');
      const basicSend = transport.sent.find((s) => s.device === basic.goveeDeviceId)!;
      expect(basicSend.at - before).toBeGreaterThanOrEqual(8000);
      expect(h.ctx.activity.list({ eventType: 'rate_limit', limit: 10 }).events.length).toBe(1);
    });

    it('spaces commands for one device to the configured per-device rate', async () => {
      await Promise.all(Array.from({ length: 6 }, (_, i) => enqueue(full, i + 1).done));
      const times = transport.sent.map((s) => s.at);
      const elapsed = times.at(-1)! - times[0]!;
      // Default is 1 per second with a burst of 2, so 6 commands take at least 4 seconds.
      expect(elapsed).toBeGreaterThanOrEqual(3900);
    });

    it('fails a command rather than holding it through a very long pause', async () => {
      h.ctx.limiter.pause(10 * 60 * 1000);
      const result = await enqueue(full, 10).done;
      expect(result.status).toBe('failed');
      expect(result.errorCategory).toBe('rate_limited');
      expect(transport.sent).toHaveLength(0);
    });

    it('refuses more work when a device queue is full', async () => {
      let release!: () => void;
      transport.gate = new Promise((resolve) => {
        release = resolve;
      });
      const pending = [enqueue(full, 1)];
      await new Promise((resolve) => setTimeout(resolve, 5));
      for (let i = 0; i < 100; i++) pending.push(enqueue(full, (i % 100) + 1));
      expect(() => enqueue(full, 1)).toThrow(/Too many commands/);
      release();
      await Promise.all(pending.map((p) => p.done));
    });
  });

  describe('honest status', () => {
    it('marks accepted commands as unverified, never as confirmed', async () => {
      const result = await enqueue(full, 10).done;
      expect(result.status).toBe('accepted');
      expect(result.verification).toBe('unverified');
    });

    it('marks commands unfinished at restart as interrupted and does not resend them', async () => {
      h.ctx.db
        .prepare(
          `INSERT INTO command_history (id, device_id, source_type, action_type, instance, request_id, request_summary, status, created_at)
           VALUES ('left', 'full', 'manual', 'power', 'powerSwitch', 'rq', 'x', 'sending', ?)`,
        )
        .run(h.clock.nowIso());
      expect(h.ctx.queue.recoverInterrupted()).toBe(1);
      expect(h.ctx.commands.get('left')?.status).toBe('interrupted');
      expect(transport.sent).toHaveLength(0);
    });

    it('records queued commands as interrupted on shutdown', async () => {
      let release!: () => void;
      transport.gate = new Promise((resolve) => {
        release = resolve;
      });
      const flying = enqueue(full, 1);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const queued = enqueue(full, 2);
      const stopping = h.ctx.queue.stop(1000);
      expect((await queued.done).status).toBe('interrupted');
      release();
      await stopping;
      expect((await flying.done).status).toBe('accepted');
    });
  });
});

describe('token bucket and limiter', () => {
  const limits = {
    listPerMinute: 20,
    controlAccountPerSecond: 8,
    controlDevicePerSecond: 1,
    statePerMinute: 20,
    scenesPerMinute: 10,
    dailyBudget: 5,
  };

  it('refills over time up to capacity', () => {
    const clock = new FakeClock();
    const bucket = new TokenBucket(2, 1, clock);
    bucket.take();
    bucket.take();
    expect(bucket.msUntilAvailable()).toBe(1000);
    clock.advance(500);
    expect(bucket.msUntilAvailable()).toBe(500);
    clock.advance(10_000);
    expect(bucket.msUntilAvailable()).toBe(0);
    bucket.take();
    bucket.take();
    expect(bucket.msUntilAvailable()).toBe(1000);
  });

  it('enforces a separate state budget per device', async () => {
    const clock = new FakeClock();
    const limiter = new GoveeRateLimiter({ ...limits, dailyBudget: 1000 }, clock);
    for (let i = 0; i < 5; i++) await limiter.acquire('state', 'a', 0);
    await expect(limiter.acquire('state', 'a', 0)).rejects.toThrow(/cannot be sent right now/);
    await expect(limiter.acquire('state', 'b', 0)).resolves.toBeUndefined();
  });

  it('stops at the daily budget and resets the next UTC day', async () => {
    const clock = new FakeClock();
    const limiter = new GoveeRateLimiter({ ...limits, statePerMinute: 6000 }, clock);
    for (let i = 0; i < 5; i++) await limiter.acquire('state', `d${i}`, 0);
    expect(limiter.requestsToday()).toBe(5);
    await expect(limiter.acquire('state', 'z', 0)).rejects.toThrow(/budget/);
    clock.advance(24 * 3600 * 1000);
    await expect(limiter.acquire('state', 'z', 0)).resolves.toBeUndefined();
    expect(limiter.requestsToday()).toBe(1);
  });

  it('only ever extends a pause', () => {
    const clock = new FakeClock();
    const limiter = new GoveeRateLimiter(limits, clock);
    limiter.pause(5000);
    const until = limiter.pausedUntil();
    limiter.pause(10);
    expect(limiter.pausedUntil()).toBe(until);
  });

  it('computes bounded exponential backoff with jitter', () => {
    const options = { baseMs: 100, maxMs: 1000 };
    expect(computeBackoffMs(1, options, () => 0)).toBe(50);
    expect(computeBackoffMs(1, options, () => 1)).toBe(100);
    expect(computeBackoffMs(3, options, () => 1)).toBe(400);
    expect(computeBackoffMs(10, options, () => 1)).toBe(1000);
    expect(computeBackoffMs(1, { ...options, retryAfterMs: 5000 }, () => 0)).toBe(5000);
  });
});
