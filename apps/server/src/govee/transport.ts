import type { ErrorCategory } from '@glm/shared';

/**
 * Everything above this line talks to lights through this interface and knows
 * nothing about HTTP. The cloud adapter is the only implementation today. A LAN
 * adapter could be added later; LAN and cloud capabilities must not be assumed
 * to match, so a future adapter would report its own capabilities.
 */
export interface LightTransport {
  readonly name: string;
  isConfigured(): boolean;
  discoverDevices(context?: RequestContext): Promise<RawDevice[]>;
  getDeviceState(target: DeviceAddress, context?: RequestContext): Promise<RawDeviceState>;
  sendCommand(target: DeviceAddress, capability: CapabilityCommand, context: CommandContext): Promise<CommandAck>;
  getDynamicScenes(target: DeviceAddress, context?: RequestContext): Promise<RawCapability[]>;
  getDiyScenes(target: DeviceAddress, context?: RequestContext): Promise<RawCapability[]>;
}

export interface RequestContext {
  requestId?: string;
}

export interface CommandContext extends RequestContext {
  requestId: string;
}

export interface DeviceAddress {
  sku: string;
  device: string;
}

export interface CapabilityCommand {
  type: string;
  instance: string;
  value: unknown;
}

/** A capability as Govee returned it. Treated as untrusted and normalized before use. */
export interface RawCapability {
  type?: unknown;
  instance?: unknown;
  parameters?: unknown;
  state?: unknown;
  [key: string]: unknown;
}

export interface RawDevice {
  sku: string;
  device: string;
  deviceName: string | null;
  type: string | null;
  capabilities: RawCapability[];
}

export interface RawDeviceState {
  capabilities: RawCapability[];
}

export interface CommandAck {
  /** False when Govee returned 2xx without the documented code field. */
  hadExplicitCode: boolean;
  /** Rate-limit details from response headers, when Govee sent any. */
  rateLimit: RateLimitInfo | null;
}

export interface RateLimitInfo {
  limit: number | null;
  remaining: number | null;
  resetAt: string | null;
}

const RETRYABLE: ReadonlySet<ErrorCategory> = new Set(['rate_limited', 'timeout', 'network', 'server_error']);

/**
 * A failed Govee request. The message is safe to show and to log. It never holds
 * the API key, request headers or the raw response body.
 */
export class TransportError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly category: ErrorCategory,
    message: string,
    readonly options: {
      httpStatus?: number;
      goveeCode?: number;
      retryAfterMs?: number;
    } = {},
  ) {
    super(message);
    this.name = 'TransportError';
    this.retryable = RETRYABLE.has(category);
  }

  get retryAfterMs(): number | undefined {
    return this.options.retryAfterMs;
  }
}
