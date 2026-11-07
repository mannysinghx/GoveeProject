import crypto from 'node:crypto';
import { z } from 'zod';
import type {
  CapabilityCommand,
  CommandAck,
  CommandContext,
  DeviceAddress,
  LightTransport,
  RateLimitInfo,
  RawCapability,
  RawDevice,
  RawDeviceState,
  RequestContext,
} from './transport.js';
import { TransportError } from './transport.js';

const PATHS = {
  devices: '/router/api/v1/user/devices',
  control: '/router/api/v1/device/control',
  state: '/router/api/v1/device/state',
  scenes: '/router/api/v1/device/scenes',
  diyScenes: '/router/api/v1/device/diy-scenes',
} as const;

export interface CloudTransportOptions {
  apiKey: string | null;
  baseUrl: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  onRateLimitInfo?: (info: RateLimitInfo) => void;
}

/*
 * Response shapes are deliberately loose. The documentation disagrees with itself:
 * the device list uses {code, message, data} while state and scenes use
 * {requestId, msg, code, payload}, and the success body of device/control is not
 * documented at all. Fields we depend on are checked; everything else passes through.
 */
const envelopeSchema = z.looseObject({
  code: z.number().optional(),
  message: z.string().optional(),
  msg: z.string().optional(),
});

const capabilityArray = z.array(z.looseObject({}));

const deviceListSchema = z.looseObject({
  data: z.array(z.unknown()),
});

const rawDeviceSchema = z.looseObject({
  sku: z.string().min(1),
  device: z.string().min(1),
  deviceName: z.string().optional(),
  type: z.string().optional(),
  capabilities: capabilityArray.optional(),
});

const payloadSchema = z.looseObject({
  payload: z.looseObject({
    capabilities: capabilityArray.optional(),
  }),
});

interface HttpResult {
  json: unknown;
  rateLimit: RateLimitInfo | null;
}

function parseIntHeader(value: string | null): number | null {
  if (value === null) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

/** Retry-After is either delta-seconds or an HTTP date. */
export function parseRetryAfter(headers: Headers, nowMs: number): number | undefined {
  const raw = headers.get('retry-after');
  if (raw !== null) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(raw);
    if (!Number.isNaN(date)) return Math.max(0, date - nowMs);
  }
  const reset = parseRateLimitInfo(headers)?.resetAt;
  if (reset) return Math.max(0, Date.parse(reset) - nowMs);
  return undefined;
}

/**
 * Govee documents no rate-limit headers, so several common spellings are checked.
 * Anything found is recorded in diagnostics; nothing depends on them being present.
 */
export function parseRateLimitInfo(headers: Headers): RateLimitInfo | null {
  const pick = (suffix: string) =>
    headers.get(`api-ratelimit-${suffix}`) ??
    headers.get(`x-ratelimit-${suffix}`) ??
    headers.get(`ratelimit-${suffix}`) ??
    headers.get(`rate-limit-${suffix}`);
  const limit = parseIntHeader(pick('limit'));
  const remaining = parseIntHeader(pick('remaining'));
  const reset = parseIntHeader(pick('reset'));
  if (limit === null && remaining === null && reset === null) return null;

  let resetAt: string | null = null;
  if (reset !== null) {
    // Epoch milliseconds, epoch seconds, or seconds from now, depending on the service.
    let ms: number;
    if (reset > 1e12) ms = reset;
    else if (reset > 1e9) ms = reset * 1000;
    else ms = Date.now() + reset * 1000;
    resetAt = new Date(ms).toISOString();
  }
  return { limit, remaining, resetAt };
}

function categoryForCode(status: number): { category: TransportError['category']; message: string } {
  if (status === 401 || status === 403) {
    return { category: 'auth', message: 'Govee rejected the API key. Check GOVEE_API_KEY on the server.' };
  }
  if (status === 429) {
    return { category: 'rate_limited', message: 'Govee rate limit reached. The app will slow down and retry.' };
  }
  if (status === 404) {
    return { category: 'not_found', message: 'Govee could not find that device or capability.' };
  }
  if (status >= 400 && status < 500) {
    return { category: 'bad_request', message: 'Govee refused the request as invalid.' };
  }
  if (status >= 500) {
    return { category: 'server_error', message: 'The Govee service returned an error.' };
  }
  return { category: 'application_error', message: 'Govee returned an unexpected status.' };
}

/** Govee's own text is kept for troubleshooting, trimmed and with the key stripped. */
function withGoveeDetail(base: string, detail: string | undefined, apiKey: string | null): string {
  if (!detail) return base;
  let safe = detail.slice(0, 200);
  if (apiKey) safe = safe.split(apiKey).join('[REDACTED]');
  return `${base} Govee said: ${safe}`;
}

export class GoveeCloudTransport implements LightTransport {
  readonly name = 'govee-cloud';
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: CloudTransportOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  isConfigured(): boolean {
    return this.options.apiKey !== null;
  }

  async discoverDevices(context?: RequestContext): Promise<RawDevice[]> {
    void context;
    const { json } = await this.request('GET', PATHS.devices);
    const parsed = deviceListSchema.safeParse(json);
    if (!parsed.success) {
      throw new TransportError('invalid_response', 'Govee returned a device list in an unexpected format.');
    }
    const devices: RawDevice[] = [];
    for (const entry of parsed.data.data) {
      const device = rawDeviceSchema.safeParse(entry);
      // An unusable row is dropped so one bad device cannot hide the rest.
      if (!device.success) continue;
      devices.push({
        sku: device.data.sku,
        device: device.data.device,
        deviceName: device.data.deviceName ?? null,
        type: device.data.type ?? null,
        capabilities: (device.data.capabilities ?? []) as RawCapability[],
      });
    }
    return devices;
  }

  async getDeviceState(target: DeviceAddress, context?: RequestContext): Promise<RawDeviceState> {
    return { capabilities: await this.payloadCapabilities(PATHS.state, target, context, 'status') };
  }

  async getDynamicScenes(target: DeviceAddress, context?: RequestContext): Promise<RawCapability[]> {
    return this.payloadCapabilities(PATHS.scenes, target, context, 'scene list');
  }

  async getDiyScenes(target: DeviceAddress, context?: RequestContext): Promise<RawCapability[]> {
    return this.payloadCapabilities(PATHS.diyScenes, target, context, 'DIY scene list');
  }

  async sendCommand(
    target: DeviceAddress,
    capability: CapabilityCommand,
    context: CommandContext,
  ): Promise<CommandAck> {
    const { json, rateLimit } = await this.request('POST', PATHS.control, {
      requestId: context.requestId,
      payload: { sku: target.sku, device: target.device, capability },
    });
    // The success body is undocumented. An HTTP 2xx without an error code counts as
    // accepted, and hadExplicitCode records whether Govee actually said so.
    const envelope = envelopeSchema.safeParse(json);
    return {
      hadExplicitCode: envelope.success && envelope.data.code === 200,
      rateLimit,
    };
  }

  private async payloadCapabilities(
    path: string,
    target: DeviceAddress,
    context: RequestContext | undefined,
    what: string,
  ): Promise<RawCapability[]> {
    const { json } = await this.request('POST', path, {
      requestId: context?.requestId ?? crypto.randomUUID(),
      payload: { sku: target.sku, device: target.device },
    });
    const parsed = payloadSchema.safeParse(json);
    if (!parsed.success) {
      throw new TransportError('invalid_response', `Govee returned a ${what} in an unexpected format.`);
    }
    return (parsed.data.payload.capabilities ?? []) as RawCapability[];
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<HttpResult> {
    const { apiKey, baseUrl, timeoutMs, onRateLimitInfo } = this.options;
    if (!apiKey) {
      throw new TransportError(
        'not_configured',
        'No Govee API key is configured. Set GOVEE_API_KEY on the server and restart.',
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    let text: string;
    try {
      response = await this.fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Govee-API-Key': apiKey,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      text = await response.text();
    } catch (error) {
      if (controller.signal.aborted) {
        throw new TransportError('timeout', `Govee did not respond within ${timeoutMs} ms.`);
      }
      // Network errors can carry the URL, never headers. The message stays generic anyway.
      const cause = error instanceof Error && 'cause' in error ? (error.cause as { code?: string })?.code : undefined;
      throw new TransportError(
        'network',
        `Could not reach the Govee service${cause ? ` (${cause})` : ''}. Check this server's internet connection.`,
      );
    } finally {
      clearTimeout(timer);
    }

    const rateLimit = parseRateLimitInfo(response.headers);
    if (rateLimit) onRateLimitInfo?.(rateLimit);

    let json: unknown;
    let isJson = true;
    try {
      json = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      isJson = false;
    }

    const envelope = envelopeSchema.safeParse(json);
    const goveeText = envelope.success ? (envelope.data.message ?? envelope.data.msg) : undefined;
    const retryAfterMs = parseRetryAfter(response.headers, Date.now());

    if (!response.ok) {
      const { category, message } = categoryForCode(response.status);
      throw new TransportError(category, withGoveeDetail(message, goveeText, apiKey), {
        httpStatus: response.status,
        goveeCode: envelope.success ? envelope.data.code : undefined,
        retryAfterMs,
      });
    }

    if (!isJson) {
      throw new TransportError('invalid_response', 'Govee returned a response that was not JSON.', {
        httpStatus: response.status,
      });
    }

    // Govee can report failure inside an HTTP 200 body.
    if (envelope.success && envelope.data.code !== undefined && envelope.data.code !== 200) {
      const code = envelope.data.code;
      const { category, message } = categoryForCode(code);
      const finalCategory = category === 'application_error' ? 'application_error' : category;
      throw new TransportError(finalCategory, withGoveeDetail(message, goveeText, apiKey), {
        httpStatus: response.status,
        goveeCode: code,
        retryAfterMs,
      });
    }

    return { json, rateLimit };
  }
}
