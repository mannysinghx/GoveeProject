import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GoveeCloudTransport, parseRateLimitInfo, parseRetryAfter } from '../src/govee/cloud-transport.js';
import { TransportError } from '../src/govee/transport.js';
import { MockGovee, mockFullDevice, TEST_API_KEY } from './support/mock-govee.js';

const address = { sku: 'H805C', device: 'AA:BB:CC:DD:EE:FF:00:01' };

describe('Govee cloud transport', () => {
  let mock: MockGovee;
  let transport: GoveeCloudTransport;

  beforeEach(async () => {
    mock = new MockGovee();
    mock.devices = [mockFullDevice()];
    await mock.start();
    transport = new GoveeCloudTransport({ apiKey: TEST_API_KEY, baseUrl: mock.url, timeoutMs: 300 });
  });

  afterEach(() => mock.stop());

  async function expectFailure(promise: Promise<unknown>): Promise<TransportError> {
    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(TransportError);
      return error as TransportError;
    }
    throw new Error('Expected the call to fail');
  }

  describe('discovery', () => {
    it('returns devices from the documented code/message/data envelope', async () => {
      const devices = await transport.discoverDevices();
      expect(devices).toHaveLength(1);
      expect(devices[0]).toMatchObject({ sku: 'H805C', device: address.device, type: 'devices.types.light' });
      expect(devices[0]?.capabilities.length).toBeGreaterThan(0);
    });

    it('sends the API key as the documented header, on the documented path', async () => {
      await transport.discoverDevices();
      const request = mock.requests[0];
      expect(request?.method).toBe('GET');
      expect(request?.path).toBe('/router/api/v1/user/devices');
      expect(request?.headers['govee-api-key']).toBe(TEST_API_KEY);
    });

    it('classifies a bad key as auth, not retryable, with no key in the message', async () => {
      const bad = new GoveeCloudTransport({ apiKey: 'wrong-key-value', baseUrl: mock.url, timeoutMs: 300 });
      const error = await expectFailure(bad.discoverDevices());
      expect(error.category).toBe('auth');
      expect(error.retryable).toBe(false);
      expect(error.message).not.toContain('wrong-key-value');
    });

    it('reports not_configured without making a request when no key is set', async () => {
      const none = new GoveeCloudTransport({ apiKey: null, baseUrl: mock.url, timeoutMs: 300 });
      expect(none.isConfigured()).toBe(false);
      const error = await expectFailure(none.discoverDevices());
      expect(error.category).toBe('not_configured');
      expect(mock.requests).toHaveLength(0);
    });

    it('classifies a slow response as a retryable timeout', async () => {
      mock.intercept = () => true; // Never responds.
      const error = await expectFailure(transport.discoverDevices());
      expect(error.category).toBe('timeout');
      expect(error.retryable).toBe(true);
    });

    it('classifies a refused connection as a retryable network failure', async () => {
      const url = mock.url;
      await mock.stop();
      const offline = new GoveeCloudTransport({ apiKey: TEST_API_KEY, baseUrl: url, timeoutMs: 300 });
      const error = await expectFailure(offline.discoverDevices());
      expect(error.category).toBe('network');
      expect(error.retryable).toBe(true);
      await mock.start();
    });

    it('parses HTTP 429 and its Retry-After header', async () => {
      mock.intercept = (_request, res) => {
        res.writeHead(429, { 'retry-after': '7', 'content-type': 'application/json' });
        res.end(JSON.stringify({ code: 429, message: 'too many request, request limits' }));
        return true;
      };
      const error = await expectFailure(transport.discoverDevices());
      expect(error.category).toBe('rate_limited');
      expect(error.retryable).toBe(true);
      expect(error.retryAfterMs).toBe(7000);
    });

    it('treats a failure code inside an HTTP 200 body as an error', async () => {
      mock.intercept = (_request, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code: 400, msg: 'Parameter value out of range' }));
        return true;
      };
      const error = await expectFailure(transport.discoverDevices());
      expect(error.category).toBe('bad_request');
      expect(error.retryable).toBe(false);
      expect(error.message).toContain('Parameter value out of range');
    });

    it('treats an unknown body code as an application error', async () => {
      mock.intercept = (_request, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code: 123, message: 'odd' }));
        return true;
      };
      const error = await expectFailure(transport.discoverDevices());
      expect(error.category).toBe('application_error');
    });

    it('rejects a 200 response with no device array', async () => {
      mock.intercept = (_request, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code: 200, message: 'success' }));
        return true;
      };
      const error = await expectFailure(transport.discoverDevices());
      expect(error.category).toBe('invalid_response');
    });

    it('rejects a body that is not JSON', async () => {
      mock.intercept = (_request, res) => {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html>gateway</html>');
        return true;
      };
      const error = await expectFailure(transport.discoverDevices());
      expect(error.category).toBe('invalid_response');
    });

    it('drops unusable entries and keeps the rest', async () => {
      mock.intercept = (_request, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            code: 200,
            message: 'success',
            data: [{ sku: 'H805C' }, null, { sku: 'H6001', device: 'AA', capabilities: [] }],
          }),
        );
        return true;
      };
      const devices = await transport.discoverDevices();
      expect(devices.map((d) => d.sku)).toEqual(['H6001']);
    });

    it('classifies a 5xx as retryable', async () => {
      mock.intercept = (_request, res) => {
        res.writeHead(503);
        res.end();
        return true;
      };
      const error = await expectFailure(transport.discoverDevices());
      expect(error.category).toBe('server_error');
      expect(error.retryable).toBe(true);
    });
  });

  describe('state', () => {
    it('reads capabilities from the requestId/msg/code/payload envelope', async () => {
      mock.state.set(address.device, { powerSwitch: 1, brightness: 50 });
      const state = await transport.getDeviceState(address);
      expect(state.capabilities.find((c) => c.instance === 'online')?.state).toEqual({ value: true });
      expect(state.capabilities.find((c) => c.instance === 'brightness')?.state).toEqual({ value: 50 });
    });

    it('rejects a response with no payload', async () => {
      mock.intercept = (_request, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code: 200, msg: 'success' }));
        return true;
      };
      const error = await expectFailure(transport.getDeviceState(address));
      expect(error.category).toBe('invalid_response');
    });
  });

  describe('control', () => {
    const capability = { type: 'devices.capabilities.on_off', instance: 'powerSwitch', value: 1 };

    it('sends the documented body shape with a real JSON integer', async () => {
      await transport.sendCommand(address, { ...capability, instance: 'colorRgb', value: 16711680 }, { requestId: 'req-1' });
      const raw = mock.requests[0];
      expect(raw?.path).toBe('/router/api/v1/device/control');
      expect(raw?.body).toEqual({
        requestId: 'req-1',
        payload: {
          sku: 'H805C',
          device: address.device,
          capability: { type: 'devices.capabilities.on_off', instance: 'colorRgb', value: 16711680 },
        },
      });
    });

    it('accepts a 200 with code 200 and notes the explicit code', async () => {
      const ack = await transport.sendCommand(address, capability, { requestId: 'r' });
      expect(ack.hadExplicitCode).toBe(true);
    });

    it('accepts an undocumented bare 2xx body, but records there was no explicit code', async () => {
      mock.intercept = (_request, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
        return true;
      };
      const ack = await transport.sendCommand(address, capability, { requestId: 'r' });
      expect(ack.hadExplicitCode).toBe(false);
    });

    it('reports "device not found" from an HTTP 200 body', async () => {
      const error = await expectFailure(
        transport.sendCommand({ sku: 'H805C', device: 'nope' }, capability, { requestId: 'r' }),
      );
      expect(error.category).toBe('not_found');
      expect(error.retryable).toBe(false);
    });
  });

  describe('scenes', () => {
    it('reads both scene endpoints', async () => {
      const dynamic = await transport.getDynamicScenes(address);
      expect(dynamic[0]?.instance).toBe('lightScene');
      expect(mock.requests.at(-1)?.path).toBe('/router/api/v1/device/scenes');
      const diy = await transport.getDiyScenes(address);
      expect(diy[0]?.instance).toBe('diyScene');
      expect(mock.requests.at(-1)?.path).toBe('/router/api/v1/device/diy-scenes');
    });
  });
});

describe('rate limit headers', () => {
  it('parses Retry-After in seconds and as an HTTP date', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfter(new Headers({ 'retry-after': '30' }), now)).toBe(30_000);
    expect(parseRetryAfter(new Headers({ 'retry-after': 'Thu, 01 Jan 2026 00:01:00 GMT' }), now)).toBe(60_000);
    expect(parseRetryAfter(new Headers(), now)).toBeUndefined();
  });

  it('reads common rate-limit header spellings, since Govee documents none', () => {
    expect(parseRateLimitInfo(new Headers())).toBeNull();
    const info = parseRateLimitInfo(
      new Headers({ 'api-ratelimit-limit': '100', 'api-ratelimit-remaining': '3', 'api-ratelimit-reset': '1893456000' }),
    );
    expect(info).toEqual({ limit: 100, remaining: 3, resetAt: '2030-01-01T00:00:00.000Z' });
    expect(parseRateLimitInfo(new Headers({ 'x-ratelimit-remaining': '9' }))?.remaining).toBe(9);
  });
});
