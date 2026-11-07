import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { DEFAULT_SETTINGS, type DeviceDetailDto, type NormalizedCapability } from '@glm/shared';

export const capabilities = {
  power: { kind: 'power', type: 'devices.capabilities.on_off', instance: 'powerSwitch', onValue: 1, offValue: 0 },
  brightness: {
    kind: 'brightness',
    type: 'devices.capabilities.range',
    instance: 'brightness',
    min: 1,
    max: 100,
    step: 1,
    unit: 'percent',
  },
  color: { kind: 'color', type: 'devices.capabilities.color_setting', instance: 'colorRgb', min: 0, max: 16777215 },
  temperature: {
    kind: 'colorTemperature',
    type: 'devices.capabilities.color_setting',
    instance: 'colorTemperatureK',
    min: 2700,
    max: 6500,
    step: 100,
    unit: null,
  },
  segments: {
    kind: 'segmentedColor',
    type: 'devices.capabilities.segment_color_setting',
    instance: 'segmentedColorRgb',
    segments: [0, 1, 2],
    minSelect: 1,
    maxSelect: 3,
  },
  scene: {
    kind: 'scene',
    type: 'devices.capabilities.dynamic_scene',
    instance: 'lightScene',
    sceneKind: 'static',
    listedOptionCount: 1,
  },
  music: {
    kind: 'other',
    type: 'devices.capabilities.music_setting',
    instance: 'musicMode',
    dataType: 'STRUCT',
    reason: 'not_controlled_by_app',
  },
} satisfies Record<string, NormalizedCapability>;

export function device(overrides: Partial<DeviceDetailDto> = {}): DeviceDetailDto {
  return {
    id: 'dev-1',
    goveeDeviceId: 'AA:BB:CC:DD:EE:FF:00:01',
    sku: 'H805C',
    name: 'Front Eaves',
    deviceType: 'devices.types.light',
    isPrimaryModel: true,
    discoveryStatus: 'present',
    lastDiscoveredAt: '2026-11-01T10:00:00.000Z',
    missingSince: null,
    capabilities: [capabilities.power],
    connectivity: 'unknown',
    freshness: 'never',
    lastStatusRefreshAt: null,
    lastOnlineAt: null,
    lastRequestAt: null,
    lastAcceptedAt: null,
    lastStatusError: null,
    states: [],
    pendingCommands: [],
    rawCapabilities: [],
    recentCommands: [],
    ...overrides,
  };
}

export type Route = (body: unknown, init: RequestInit) => { status?: number; json?: unknown } | undefined;

/** Stubs fetch with a table of "METHOD /path" handlers, and fails loudly on anything else. */
export function mockApi(routes: Record<string, Route | { status?: number; json?: unknown }>) {
  const calls: { method: string; path: string; body: unknown; headers: HeadersInit | undefined }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.pathname.replace('/api/v1', '');
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body, headers: init.headers });

    const handler = routes[`${method} ${path}`];
    const result = typeof handler === 'function' ? handler(body, init) : handler;
    if (!result) {
      throw new Error(`No mock for ${method} ${path}`);
    }
    const status = result.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(result.json ?? {}), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

export const settingsRoute = { 'GET /settings': { json: DEFAULT_SETTINGS } };

export function renderApp(ui: ReactElement, { route = '/' }: { route?: string } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}
