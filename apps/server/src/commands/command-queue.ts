import type { Logger } from 'pino';
import type { CommandDto, CommandSourceType, ErrorCategory } from '@glm/shared';
import type { AppConfig } from '../config/env.js';
import type { ActivityService } from '../activity/activity-service.js';
import type { GoveeGateway } from '../govee/gateway.js';
import { computeBackoffMs, type GoveeRateLimiter } from '../govee/rate-limiter.js';
import {
  TransportError,
  type CapabilityCommand,
  type DeviceAddress,
  type LightTransport,
} from '../govee/transport.js';
import type { Clock } from '../shared/clock.js';
import { AppError } from '../shared/errors.js';
import type { CommandStore } from './command-store.js';

const REFUSED_BY_GOVEE: ReadonlySet<ErrorCategory> = new Set(['auth', 'bad_request', 'not_found', 'application_error']);

export interface EnqueueInput {
  deviceId: string;
  address: DeviceAddress;
  capability: CapabilityCommand;
  actionType: string;
  summary: string;
  coalesceKey: string | null;
  sourceType: CommandSourceType;
  sourceId?: string | null | undefined;
  runId?: string | null | undefined;
  correlationId?: string | null | undefined;
}

interface Entry {
  commandId: string;
  requestId: string;
  input: EnqueueInput;
  command: CommandDto;
  /** A command past this time fails rather than firing long after anyone expected it. */
  deadlineMs: number;
  resolve: (result: CommandDto) => void;
}

export interface Enqueued {
  command: CommandDto;
  /** Resolves when the command reaches a final status. Never rejects. */
  done: Promise<CommandDto>;
}

/**
 * Sends every Govee control request.
 *
 *  - One FIFO per device, one in-flight request per device: later commands for a
 *    device cannot overtake earlier ones. Devices do not block each other.
 *  - Queued commands for the same setting are coalesced, but only when the new
 *    command would be adjacent to the one it replaces, so ordering that a later
 *    command might depend on is never disturbed.
 *  - Retries are bounded, use backoff with jitter, and apply only to errors that
 *    could succeed next time. Commands set absolute values, so a retry after a
 *    timeout cannot compound.
 */
export class CommandQueue {
  private readonly queues = new Map<string, Entry[]>();
  private readonly inFlight = new Map<string, Entry>();
  private readonly drains = new Map<string, Promise<void>>();
  private stopped = false;
  private acceptedListener: ((deviceId: string) => void) | null = null;

  constructor(
    private readonly transport: LightTransport,
    private readonly limiter: GoveeRateLimiter,
    private readonly gateway: GoveeGateway,
    private readonly store: CommandStore,
    private readonly activity: ActivityService,
    private readonly logger: Logger,
    private readonly clock: Clock,
    private readonly config: { govee: AppConfig['govee']; queue: AppConfig['queue'] },
  ) {}

  onAccepted(listener: (deviceId: string) => void): void {
    this.acceptedListener = listener;
  }

  /** Commands left over from before a restart are marked and not replayed. */
  recoverInterrupted(): number {
    const count = this.store.interruptUnfinished();
    if (count > 0) {
      this.logger.warn({ count }, 'Marked unfinished commands from a previous run as interrupted');
      this.activity.record({
        eventType: 'command',
        outcome: 'warning',
        message: `${count} command(s) were unfinished when the app last stopped. They were not resent.`,
      });
    }
    return count;
  }

  enqueue(input: EnqueueInput): Enqueued {
    if (this.stopped) {
      throw new AppError(503, 'queue_stopped', 'The app is shutting down and cannot accept commands.');
    }
    const queue = this.queues.get(input.deviceId) ?? [];
    if (queue.length >= this.config.queue.maxPerDevice) {
      throw new AppError(
        429,
        'queue_full',
        'Too many commands are waiting for this device. Wait for them to finish and try again.',
      );
    }

    const command = this.store.create({
      deviceId: input.deviceId,
      instance: input.capability.instance,
      value: input.capability.value,
      actionType: input.actionType,
      summary: input.summary,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      runId: input.runId,
      correlationId: input.correlationId,
    });

    const tail = queue.at(-1);
    if (tail && input.coalesceKey && tail.input.coalesceKey === input.coalesceKey) {
      queue.pop();
      tail.resolve(this.store.markSuperseded(tail.commandId));
    }

    let resolve!: (result: CommandDto) => void;
    const done = new Promise<CommandDto>((r) => {
      resolve = r;
    });
    queue.push({
      commandId: command.id,
      requestId: command.requestId,
      input,
      command,
      deadlineMs: this.clock.nowMs() + this.config.queue.maxWaitMs,
      resolve,
    });
    this.queues.set(input.deviceId, queue);
    this.startDrain(input.deviceId);
    return { command, done };
  }

  pendingCount(): number {
    let total = this.inFlight.size;
    for (const queue of this.queues.values()) total += queue.length;
    return total;
  }

  pendingForDevice(deviceId: string): CommandDto[] {
    const entries: Entry[] = [];
    const flying = this.inFlight.get(deviceId);
    if (flying) entries.push(flying);
    entries.push(...(this.queues.get(deviceId) ?? []));
    return entries.map((e) => this.store.getOrThrow(e.commandId));
  }

  /**
   * Stops accepting work, lets the in-flight request for each device finish, and
   * records anything still queued as interrupted. Waits at most timeoutMs.
   */
  async stop(timeoutMs = 5_000): Promise<void> {
    this.stopped = true;
    for (const queue of this.queues.values()) {
      for (const entry of queue.splice(0)) {
        entry.resolve(
          this.store.markFinished(
            entry.commandId,
            'interrupted',
            0,
            'queue_stopped',
            'The app shut down before this command was sent.',
          ),
        );
      }
    }
    const drains = Promise.all(this.drains.values());
    await Promise.race([
      drains,
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        timer.unref?.();
      }),
    ]);
  }

  /** Resolves once every queue is empty. Used by tests and shutdown. */
  async idle(): Promise<void> {
    while (this.drains.size > 0) {
      await Promise.all(this.drains.values());
    }
  }

  private startDrain(deviceId: string): void {
    if (this.drains.has(deviceId)) return;
    const drain = this.drain(deviceId)
      .catch((error: unknown) => {
        this.logger.error({ err: error, deviceId }, 'Command queue stopped unexpectedly');
      })
      .finally(() => {
        this.drains.delete(deviceId);
        // A command may have arrived between the last check and this cleanup.
        if ((this.queues.get(deviceId)?.length ?? 0) > 0 && !this.stopped) this.startDrain(deviceId);
      });
    this.drains.set(deviceId, drain);
  }

  private async drain(deviceId: string): Promise<void> {
    // Yield once so commands enqueued in the same tick can coalesce before the first send.
    await Promise.resolve();
    const queue = this.queues.get(deviceId);
    if (!queue) return;
    for (;;) {
      const entry = queue.shift();
      if (!entry) return;
      this.inFlight.set(deviceId, entry);
      try {
        entry.resolve(await this.execute(entry));
      } catch (error) {
        // Execute handles expected failures. Anything else is a bug, and it must not
        // leave the promise hanging or stop later commands for this device.
        this.logger.error({ err: error, commandId: entry.commandId }, 'Unexpected command queue error');
        entry.resolve(this.failSafely(entry));
      } finally {
        this.inFlight.delete(deviceId);
      }
    }
  }

  /** Answers the caller even if the database cannot record the outcome. */
  private failSafely(entry: Entry): CommandDto {
    const message = 'Unexpected error while sending the command.';
    try {
      return this.store.markFinished(entry.commandId, 'failed', 0, 'unknown', message);
    } catch (error) {
      this.logger.error({ err: error, commandId: entry.commandId }, 'Could not record a command outcome');
      return {
        ...entry.command,
        status: 'failed',
        verification: 'not_applicable',
        errorCategory: 'unknown',
        errorMessage: message,
      };
    }
  }

  private async execute(entry: Entry): Promise<CommandDto> {
    const { input, commandId, requestId } = entry;
    const { maxAttempts, retryBaseMs, retryMaxMs } = this.config.govee;
    let attempt = 0;
    let lastError: TransportError | null = null;

    while (attempt < maxAttempts) {
      try {
        await this.limiter.acquire('control', input.deviceId, Math.max(0, entry.deadlineMs - this.clock.nowMs()));
      } catch (error) {
        const failure = this.asTransportError(error);
        this.gateway.noteFailure(failure, { deviceId: input.deviceId, endpoint: 'control' });
        return this.finishFailure(entry, attempt, failure);
      }

      attempt += 1;
      this.store.markSending(commandId, attempt);
      try {
        await this.transport.sendCommand(input.address, input.capability, { requestId });
        this.gateway.noteSuccess();
        return this.finishAccepted(entry, attempt);
      } catch (error) {
        const failure = this.asTransportError(error);
        lastError = failure;
        this.gateway.noteFailure(failure, { deviceId: input.deviceId, endpoint: 'control' });

        if (failure.category === 'rate_limited') {
          this.limiter.pause(failure.retryAfterMs ?? 1_000);
        }
        if (!failure.retryable || attempt >= maxAttempts) {
          return this.finishFailure(entry, attempt, failure);
        }
        const backoff = computeBackoffMs(attempt, {
          baseMs: retryBaseMs,
          maxMs: retryMaxMs,
          retryAfterMs: failure.retryAfterMs,
        });
        if (this.clock.nowMs() + backoff > entry.deadlineMs) {
          return this.finishFailure(entry, attempt, failure);
        }
        await this.clock.sleep(backoff);
      }
    }
    return this.finishFailure(
      entry,
      attempt,
      lastError ?? new TransportError('unknown', 'The command could not be sent.'),
    );
  }

  private asTransportError(error: unknown): TransportError {
    if (error instanceof TransportError) return error;
    this.logger.error({ err: error }, 'Unexpected error from the Govee transport');
    return new TransportError('unknown', 'Unexpected error while sending the command.');
  }

  private finishAccepted(entry: Entry, attempts: number): CommandDto {
    const { input, commandId } = entry;
    const result = this.store.markAccepted(
      commandId,
      input.deviceId,
      input.capability.instance,
      input.capability.value,
      attempts,
    );
    this.activity.record({
      eventType: 'command',
      outcome: 'success',
      deviceId: input.deviceId,
      correlationId: input.correlationId,
      message: `${input.summary}: accepted by Govee, not yet confirmed.`,
      details: { commandId, instance: input.capability.instance, attempts, source: input.sourceType },
    });
    this.logger.info(
      { commandId, deviceId: input.deviceId, instance: input.capability.instance, attempts, result: 'accepted' },
      'Command accepted by Govee',
    );
    try {
      this.acceptedListener?.(input.deviceId);
    } catch (error) {
      this.logger.warn({ err: error }, 'Post-command listener failed');
    }
    return result;
  }

  /**
   * rejected: Govee answered and refused it, so resending will not help.
   * failed: it was not delivered, or the reply could not be understood, so the outcome is unknown.
   */
  private finishFailure(entry: Entry, attempts: number, error: TransportError): CommandDto {
    const { input, commandId } = entry;
    const status = REFUSED_BY_GOVEE.has(error.category) ? 'rejected' : 'failed';
    const result = this.store.markFinished(commandId, status, attempts, error.category, error.message);
    this.activity.record({
      eventType: 'command',
      outcome: 'failure',
      deviceId: input.deviceId,
      correlationId: input.correlationId,
      message: `${input.summary}: ${status}. ${error.message}`,
      details: { commandId, instance: input.capability.instance, attempts, category: error.category },
    });
    this.logger.warn(
      { commandId, deviceId: input.deviceId, category: error.category, attempts, result: status },
      'Command did not go through',
    );
    return result;
  }
}
