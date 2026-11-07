import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A local stand-in for the Govee cloud API, over real HTTP, so tests exercise
 * headers, JSON handling and timeouts. It follows the documented response shapes,
 * including the differences between endpoints.
 *
 * The H805C capabilities below are invented test data. They exercise every control
 * in the app and are NOT a claim about what a real H805C reports.
 */

export const TEST_API_KEY = 'test-key-5c1f0e8e-do-not-use';

export interface MockDevice {
  sku: string;
  device: string;
  deviceName?: string;
  type?: string;
  capabilities: unknown[];
}

const power = {
  type: 'devices.capabilities.on_off',
  instance: 'powerSwitch',
  parameters: {
    dataType: 'ENUM',
    options: [
      { name: 'on', value: 1 },
      { name: 'off', value: 0 },
    ],
  },
};

const brightness = {
  type: 'devices.capabilities.range',
  instance: 'brightness',
  parameters: { unit: 'unit.percent', dataType: 'INTEGER', range: { min: 1, max: 100, precision: 1 } },
};

const colorRgb = {
  type: 'devices.capabilities.color_setting',
  instance: 'colorRgb',
  parameters: { dataType: 'INTEGER', range: { min: 0, max: 16777215, precision: 1 } },
};

const colorTemperature = {
  type: 'devices.capabilities.color_setting',
  instance: 'colorTemperatureK',
  parameters: { dataType: 'INTEGER', range: { min: 2000, max: 9000, precision: 1 } },
};

const segmentedColor = {
  type: 'devices.capabilities.segment_color_setting',
  instance: 'segmentedColorRgb',
  parameters: {
    dataType: 'STRUCT',
    fields: [
      {
        fieldName: 'segment',
        dataType: 'Array',
        size: { min: 1, max: 15 },
        elementRange: { min: 0, max: 14 },
        elementType: 'INTEGER',
        required: true,
      },
      { fieldName: 'rgb', dataType: 'INTEGER', range: { min: 0, max: 16777215, precision: 1 }, required: true },
    ],
  },
};

const segmentedBrightness = {
  type: 'devices.capabilities.segment_color_setting',
  instance: 'segmentedBrightness',
  parameters: {
    dataType: 'STRUCT',
    fields: [
      {
        fieldName: 'segment',
        dataType: 'Array',
        size: { min: 1, max: 15 },
        elementRange: { min: 0, max: 14 },
        elementType: 'INTEGER',
        required: true,
      },
      { fieldName: 'brightness', dataType: 'INTEGER', range: { min: 0, max: 100, precision: 1 }, required: true },
    ],
  },
};

const lightScene = {
  type: 'devices.capabilities.dynamic_scene',
  instance: 'lightScene',
  parameters: {
    dataType: 'ENUM',
    options: [
      { name: 'Tudum', value: 3054 },
      { name: 'Card Playing', value: 3095 },
    ],
  },
};

const diyScene = {
  type: 'devices.capabilities.dynamic_scene',
  instance: 'diyScene',
  parameters: { dataType: 'ENUM', options: [{ name: 'Fade', value: 8216567 }] },
};

/** Fully featured test device: invented data, see the note at the top of this file. */
export const mockFullDevice = (): MockDevice => ({
  sku: 'H805C',
  device: 'AA:BB:CC:DD:EE:FF:00:01',
  deviceName: 'Front Eaves (test data)',
  type: 'devices.types.light',
  capabilities: [power, brightness, colorRgb, colorTemperature, segmentedColor, segmentedBrightness, lightScene, diyScene],
});

/** A basic device: power and brightness only, to prove controls follow capabilities. */
export const mockBasicDevice = (): MockDevice => ({
  sku: 'H6001',
  device: 'AA:BB:CC:DD:EE:FF:00:02',
  deviceName: 'Porch Light (test data)',
  type: 'devices.types.light',
  capabilities: [power, brightness],
});

export interface RecordedRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: unknown;
}

type Handler = (request: RecordedRequest, res: http.ServerResponse) => boolean;

export class MockGovee {
  readonly requests: RecordedRequest[] = [];
  devices: MockDevice[] = [];
  /** Values reported by device/state, keyed by device address. */
  state = new Map<string, Record<string, unknown>>();
  online = new Map<string, boolean>();
  dynamicScenes: unknown[] = [
    { name: 'Sunrise', value: { paramId: 4280, id: 3853 } },
    { name: 'Milky Way', value: { paramId: 4333, id: 3906 } },
  ];
  diyScenes: unknown[] = [{ name: 'Xmas lights 2', value: 8216931 }];
  /** Runs before normal handling. Return true after writing a response to intercept. */
  intercept: Handler | null = null;
  /** When true, control commands update the reported state like a real device might. */
  applyCommands = true;

  private server: http.Server | null = null;

  constructor(private readonly apiKey: string = TEST_API_KEY) {}

  get url(): string {
    const address = this.server?.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

  controlRequests(): { sku: string; device: string; capability: { type: string; instance: string; value: unknown } }[] {
    return this.requests
      .filter((r) => r.path === '/router/api/v1/device/control')
      .map((r) => (r.body as { payload: never }).payload);
  }

  async start(port = 0): Promise<void> {
    this.server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => {
        raw += chunk.toString('utf8');
      });
      req.on('end', () => this.handle(req, res, raw));
    });
    await new Promise<void>((resolve) => this.server!.listen(port, '127.0.0.1', resolve));
  }

  async stop(): Promise<void> {
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
    this.server = null;
  }

  private json(res: http.ServerResponse, status: number, body: unknown, headers: http.OutgoingHttpHeaders = {}): void {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse, raw: string): void {
    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = raw;
    }
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    const recorded: RecordedRequest = { method: req.method ?? 'GET', path, headers: req.headers, body };
    this.requests.push(recorded);

    if (this.intercept?.(recorded, res)) return;

    if (req.headers['govee-api-key'] !== this.apiKey) {
      return this.json(res, 401, { code: 401, message: 'Unauthorized. check you apiKey' });
    }

    const payload = (body as { payload?: { sku?: string; device?: string; capability?: { type: string; instance: string; value: unknown } }; requestId?: string } | null)?.payload;
    const requestId = (body as { requestId?: string } | null)?.requestId;

    if (req.method === 'GET' && path === '/router/api/v1/user/devices') {
      return this.json(res, 200, { code: 200, message: 'success', data: this.devices });
    }

    if (req.method === 'POST' && path === '/router/api/v1/device/state') {
      const address = payload?.device ?? '';
      const values = this.state.get(address) ?? {};
      const capabilities: unknown[] = [
        { type: 'devices.capabilities.online', instance: 'online', state: { value: this.online.get(address) ?? true } },
      ];
      const device = this.devices.find((d) => d.device === address);
      for (const capability of (device?.capabilities ?? []) as { type: string; instance: string }[]) {
        const value = values[capability.instance];
        capabilities.push({
          type: capability.type,
          instance: capability.instance,
          // An empty value is how Govee says a setting cannot be queried.
          state: { value: value === undefined ? '' : value },
        });
      }
      return this.json(res, 200, {
        requestId,
        msg: 'success',
        code: 200,
        payload: { sku: payload?.sku, device: address, capabilities },
      });
    }

    if (req.method === 'POST' && path === '/router/api/v1/device/control') {
      const known = this.devices.find((d) => d.device === payload?.device);
      if (!known) return this.json(res, 200, { code: 404, msg: 'device not found' });
      const capability = payload?.capability;
      if (capability && this.applyCommands) {
        const values = this.state.get(known.device) ?? {};
        if (!capability.instance.startsWith('segmented') && !capability.instance.endsWith('Scene')) {
          values[capability.instance] = capability.value;
        }
        this.state.set(known.device, values);
      }
      return this.json(res, 200, {
        requestId,
        msg: 'success',
        code: 200,
        capability: { ...capability, state: { status: 'success' } },
      });
    }

    if (req.method === 'POST' && path === '/router/api/v1/device/scenes') {
      return this.json(res, 200, {
        requestId,
        msg: 'success',
        code: 200,
        payload: {
          sku: payload?.sku,
          device: payload?.device,
          capabilities: [
            {
              type: 'devices.capabilities.dynamic_scene',
              instance: 'lightScene',
              parameters: { dataType: 'ENUM', options: this.dynamicScenes },
            },
          ],
        },
      });
    }

    if (req.method === 'POST' && path === '/router/api/v1/device/diy-scenes') {
      return this.json(res, 200, {
        requestId,
        msg: 'success',
        code: 200,
        payload: {
          sku: payload?.sku,
          device: payload?.device,
          capabilities: [
            {
              type: 'devices.capabilities.diy_color_setting',
              instance: 'diyScene',
              parameters: { dataType: 'ENUM', options: this.diyScenes },
            },
          ],
        },
      });
    }

    return this.json(res, 404, { code: 404, message: 'Not Found' });
  }
}
