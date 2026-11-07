import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type CommandDto } from '@glm/shared';
import { capabilities, device, mockApi, renderApp, settingsRoute } from '../../test/fixtures';
import { CapabilityPanel } from './CapabilityPanel';
import { DeviceControls } from './DeviceControls';

afterEach(() => vi.unstubAllGlobals());

const command = (overrides: Partial<CommandDto> = {}): CommandDto => ({
  id: 'c1',
  deviceId: 'dev-1',
  actionType: 'power',
  instance: 'powerSwitch',
  summary: 'Turn on',
  sourceType: 'manual',
  status: 'accepted',
  verification: 'unverified',
  attempts: 1,
  errorCategory: null,
  errorMessage: null,
  requestId: 'r1',
  createdAt: '2026-11-01T10:00:00.000Z',
  acceptedAt: '2026-11-01T10:00:00.000Z',
  completedAt: '2026-11-01T10:00:00.000Z',
  ...overrides,
});

describe('capabilities drive the visible controls', () => {
  it('shows only power on a device that reports only power', () => {
    mockApi(settingsRoute);
    renderApp(<DeviceControls device={device({ capabilities: [capabilities.power] })} />);
    expect(screen.getByRole('button', { name: 'On' })).toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: 'Brightness' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply colour' })).not.toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: 'Colour temperature' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Segment 0/ })).not.toBeInTheDocument();
  });

  it('shows each control when the device reports it', () => {
    mockApi({ ...settingsRoute, 'GET /devices/dev-1/scenes': { json: { supported: true, fetchedAt: null, scenes: [], lastRefreshErrors: [] } } });
    renderApp(
      <DeviceControls
        device={device({
          capabilities: [
            capabilities.power,
            capabilities.brightness,
            capabilities.color,
            capabilities.temperature,
            capabilities.segments,
            capabilities.scene,
          ],
        })}
      />,
    );
    expect(screen.getByRole('slider', { name: 'Brightness' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply colour' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Colour temperature' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Segment 0' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh scenes' })).toBeInTheDocument();
  });

  it('marks what is unavailable and says why', () => {
    mockApi(settingsRoute);
    renderApp(<DeviceControls device={device({ capabilities: [capabilities.power] })} />);
    expect(screen.getByText(/Segment control is not exposed by this device through the official API/)).toBeInTheDocument();
    expect(screen.getByText(/Scenes are not exposed by this device/)).toBeInTheDocument();
    expect(screen.getByText(/RGB colour control is not exposed/)).toBeInTheDocument();
  });

  it('does not depend on the model number', () => {
    mockApi(settingsRoute);
    renderApp(
      <DeviceControls device={device({ sku: 'H9999', isPrimaryModel: false, capabilities: [capabilities.brightness] })} />,
    );
    expect(screen.getByRole('slider', { name: 'Brightness' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'On' })).not.toBeInTheDocument();
  });

  it('uses the range this device reports', () => {
    mockApi(settingsRoute);
    renderApp(<DeviceControls device={device({ capabilities: [capabilities.temperature] })} />);
    const slider = screen.getByRole('slider', { name: 'Colour temperature' });
    expect(slider).toHaveAttribute('min', '2700');
    expect(slider).toHaveAttribute('max', '6500');
    expect(slider).toHaveAttribute('step', '100');
  });
});

describe('honest command feedback', () => {
  const powerOn = (status: Partial<CommandDto>) => ({
    ...settingsRoute,
    'POST /devices/dev-1/power': { json: { command: command(status), device: device() } },
    'GET /devices': { json: { devices: [] } },
    'GET /devices/dev-1': { json: device() },
    'GET /dashboard/summary': { json: { upcoming: [], recentFailures: [] } },
  });

  it('labels an accepted command as accepted and not yet confirmed', async () => {
    mockApi(powerOn({ status: 'accepted', verification: 'unverified' }));
    renderApp(<DeviceControls device={device()} />);
    await userEvent.click(screen.getByRole('button', { name: 'On' }));

    expect(await screen.findByText('Accepted by Govee')).toBeInTheDocument();
    expect(screen.getByText('Not yet confirmed')).toBeInTheDocument();
    expect(screen.queryByText(/^Confirmed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/success/i)).not.toBeInTheDocument();
  });

  it('updates to confirmed when a later Govee report matches', async () => {
    let read = 0;
    mockApi({
      ...powerOn({ status: 'accepted', verification: 'unverified' }),
      'GET /commands/c1': () => {
        read += 1;
        return { json: { command: command({ verification: 'confirmed' }) } };
      },
    });
    renderApp(<DeviceControls device={device()} />);
    await userEvent.click(screen.getByRole('button', { name: 'On' }));
    expect(await screen.findByText('Not yet confirmed')).toBeInTheDocument();

    expect(await screen.findByText('Confirmed by a later Govee report', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText('Not yet confirmed')).not.toBeInTheDocument();
    const reads = read;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(read).toBe(reads); // Settled commands are not polled any further.
  });

  it('shows a rejection with Govee\'s reason', async () => {
    mockApi(
      powerOn({
        status: 'rejected',
        verification: 'not_applicable',
        errorCategory: 'bad_request',
        errorMessage: 'Govee refused the request as invalid.',
      }),
    );
    renderApp(<DeviceControls device={device()} />);
    await userEvent.click(screen.getByRole('button', { name: 'On' }));

    expect(await screen.findByText('Rejected by Govee')).toBeInTheDocument();
    expect(screen.getByText('Govee refused the request as invalid.')).toBeInTheDocument();
    expect(screen.queryByText('Not yet confirmed')).not.toBeInTheDocument();
  });

  it('shows a pending state while sending', async () => {
    let release!: (value: Response) => void;
    mockApi({ ...settingsRoute, 'GET /devices': { json: { devices: [] } } });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('/settings')) {
          return new Response('{}', { status: 200 });
        }
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      }),
    );
    renderApp(<DeviceControls device={device()} />);
    await userEvent.click(screen.getByRole('button', { name: 'On' }));
    expect(await screen.findByText('Sending to Govee...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'On' })).toBeDisabled();
    release(new Response(JSON.stringify({ command: command(), device: device() }), { status: 200 }));
  });

  it('shows an actionable error when the server refuses', async () => {
    mockApi({
      ...settingsRoute,
      'POST /devices/dev-1/power': {
        status: 409,
        json: { error: { code: 'device_missing', message: 'Front Eaves was not in the last Govee device list.', requestId: 'ref-123' } },
      },
      'GET /devices': { json: { devices: [] } },
      'GET /devices/dev-1': { json: device() },
      'GET /dashboard/summary': { json: { upcoming: [], recentFailures: [] } },
    });
    renderApp(<DeviceControls device={device()} />);
    await userEvent.click(screen.getByRole('button', { name: 'On' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not in the last Govee device list');
    expect(screen.getByRole('alert')).toHaveTextContent('ref-123');
  });
});

describe('sending limits', () => {
  const brightnessRoutes = (settings = DEFAULT_SETTINGS) => ({
    'GET /settings': { json: settings },
    'POST /devices/dev-1/brightness': { json: { command: command({ summary: 'Set brightness' }), device: device() } },
    'GET /devices': { json: { devices: [] } },
    'GET /devices/dev-1': { json: device() },
    'GET /dashboard/summary': { json: { upcoming: [], recentFailures: [] } },
  });
  const sends = (calls: { path: string; body: unknown }[]) => calls.filter((c) => c.path.endsWith('/brightness'));

  it('sends brightness once on release, not per movement', async () => {
    const { calls } = mockApi(brightnessRoutes());
    renderApp(<DeviceControls device={device({ capabilities: [capabilities.brightness] })} />);
    const slider = screen.getByRole('slider', { name: 'Brightness' });

    for (const value of ['10', '20', '30', '40']) fireEvent.change(slider, { target: { value } });
    expect(sends(calls)).toHaveLength(0);

    fireEvent.pointerUp(slider);
    await waitFor(() => expect(sends(calls)).toHaveLength(1));
    expect(sends(calls)[0]?.body).toEqual({ value: 40 });
  });

  it('commits on key release for keyboard users, and does not resend an unchanged value', async () => {
    const { calls } = mockApi(brightnessRoutes());
    renderApp(<DeviceControls device={device({ capabilities: [capabilities.brightness] })} />);
    const slider = screen.getByRole('slider', { name: 'Brightness' });

    fireEvent.change(slider, { target: { value: '55' } });
    fireEvent.keyUp(slider, { key: 'ArrowRight' });
    fireEvent.keyUp(slider, { key: 'ArrowRight' });
    fireEvent.pointerUp(slider);
    await waitFor(() => expect(sends(calls)).toHaveLength(1));
    expect(sends(calls)[0]?.body).toEqual({ value: 55 });
  });

  it('in interval mode, sends while dragging but no faster than the interval', async () => {
    const { calls } = mockApi(brightnessRoutes({ ...DEFAULT_SETTINGS, sliderSendMode: 'interval', sliderIntervalMs: 5000 }));
    renderApp(<DeviceControls device={device({ capabilities: [capabilities.brightness] })} />);
    await waitFor(() => expect(calls.some((c) => c.path === '/settings')).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const slider = screen.getByRole('slider', { name: 'Brightness' });

    for (const value of ['10', '20', '30', '40', '50']) fireEvent.change(slider, { target: { value } });
    await waitFor(() => expect(sends(calls)).toHaveLength(1));
    expect(sends(calls)[0]?.body).toEqual({ value: 10 });

    fireEvent.pointerUp(slider); // Releasing still sends the final value right away.
    await waitFor(() => expect(sends(calls)).toHaveLength(2));
    expect(sends(calls)[1]?.body).toEqual({ value: 50 });
  });

  it('shows Unknown rather than a made-up value when nothing is known', () => {
    mockApi(settingsRoute);
    renderApp(<DeviceControls device={device({ capabilities: [capabilities.brightness] })} />);
    expect(screen.getByRole('slider', { name: 'Brightness' })).toHaveAttribute('aria-valuetext', 'Unknown');
    expect(screen.getByText('Current value: unknown.')).toBeInTheDocument();
  });

  it('labels the seed value with where it came from and when', () => {
    mockApi(settingsRoute);
    renderApp(
      <DeviceControls
        device={device({
          capabilities: [capabilities.brightness],
          states: [
            {
              instance: 'brightness',
              requested: null,
              accepted: null,
              reported: { value: 42, at: new Date(Date.now() - 300_000).toISOString(), historical: true },
              notQueryable: false,
              verification: null,
            },
          ],
        })}
      />,
    );
    expect(screen.getByRole('slider', { name: 'Brightness' })).toHaveValue('42');
    expect(screen.getByText(/42%\. Last reported while offline/)).toBeInTheDocument();
  });
});

describe('colour control', () => {
  const routes = {
    ...settingsRoute,
    'POST /devices/dev-1/color': { json: { command: command({ summary: 'Set colour to #123456' }), device: device() } },
    'GET /devices': { json: { devices: [] } },
    'GET /devices/dev-1': { json: device() },
    'GET /dashboard/summary': { json: { upcoming: [], recentFailures: [] } },
  };

  it('sends only when applied, with the typed hex', async () => {
    const { calls } = mockApi(routes);
    renderApp(<DeviceControls device={device({ capabilities: [capabilities.color] })} />);
    const hex = screen.getByLabelText('Hex');
    await userEvent.clear(hex);
    await userEvent.type(hex, '#123456');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Apply colour' }));
    await waitFor(() => expect(calls.find((c) => c.path.endsWith('/color'))?.body).toEqual({ hex: '#123456' }));
  });

  it('blocks an invalid hex and explains', async () => {
    mockApi(routes);
    renderApp(<DeviceControls device={device({ capabilities: [capabilities.color] })} />);
    const hex = screen.getByLabelText('Hex');
    await userEvent.clear(hex);
    await userEvent.type(hex, '#12');
    expect(screen.getByText('Use a colour in #rrggbb form.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply colour' })).toBeDisabled();
  });

  it('updates the preview and hex from the RGB fields', async () => {
    mockApi(routes);
    renderApp(<DeviceControls device={device({ capabilities: [capabilities.color] })} />);
    const red = screen.getByLabelText('Red');
    await userEvent.clear(red);
    await userEvent.type(red, '255');
    await waitFor(() => expect((screen.getByLabelText('Hex') as HTMLInputElement).value.startsWith('#ff')).toBe(true));
  });
});

describe('segment control', () => {
  it('warns that a segment is not necessarily a bulb', () => {
    mockApi(settingsRoute);
    renderApp(<DeviceControls device={device({ capabilities: [capabilities.segments] })} />);
    expect(screen.getByText(/One segment is not necessarily one bulb/)).toBeInTheDocument();
  });

  it('shows exactly the segments reported, and submits the selection', async () => {
    const { calls } = mockApi({
      ...settingsRoute,
      'POST /devices/dev-1/segments': {
        json: {
          runId: 'r',
          sourceType: 'manual',
          sourceId: 'dev-1',
          sourceName: 'x',
          status: 'partial',
          startedAt: '2026-11-01T10:00:00.000Z',
          completedAt: '2026-11-01T10:00:01.000Z',
          outcomes: [
            { deviceId: 'dev-1', deviceName: 'Front Eaves', actionType: 'segmentColor', summary: 'Set segments 0, 2 to #f2b45a', status: 'accepted', commandId: 'c', verification: 'unverified', reason: null, errorCategory: null },
            { deviceId: 'dev-1', deviceName: 'Front Eaves', actionType: 'segmentColor', summary: 'next', status: 'failed', commandId: 'd', verification: 'not_applicable', reason: 'Timed out', errorCategory: 'timeout' },
          ],
        },
      },
      'GET /devices': { json: { devices: [] } },
      'GET /devices/dev-1': { json: device() },
      'GET /dashboard/summary': { json: { upcoming: [], recentFailures: [] } },
    });
    renderApp(<DeviceControls device={device({ capabilities: [capabilities.segments] })} />);

    expect(screen.getAllByRole('button', { name: /^Segment \d/ })).toHaveLength(3);
    const apply = screen.getByRole('button', { name: 'Apply to selected' });
    expect(apply).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Segment 0' }));
    await userEvent.click(screen.getByRole('button', { name: 'Segment 2' }));
    expect(screen.getByRole('button', { name: 'Segment 0' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(apply);

    await waitFor(() => expect(calls.find((c) => c.path.endsWith('/segments'))).toBeTruthy());
    expect(calls.find((c) => c.path.endsWith('/segments'))?.body).toEqual({
      operations: [{ segments: [0, 2], hex: '#f2b45a' }],
    });
    expect(await screen.findByText('Partly accepted')).toBeInTheDocument();
    expect(screen.getByText(/pattern may be incomplete/)).toBeInTheDocument();
  });
});

describe('capability panel', () => {
  it('lists reported capabilities, marks read-only ones, and names what is absent', () => {
    renderApp(
      <CapabilityPanel capabilities={[capabilities.power, capabilities.music]} rawCapabilities={[{ instance: 'powerSwitch' }]} />,
    );
    expect(screen.getByText('Power')).toBeInTheDocument();
    expect(screen.getByText('Music mode')).toBeInTheDocument();
    expect(screen.getByText('Read only')).toBeInTheDocument();
    expect(screen.getByText(/Segment control/)).toBeInTheDocument();
    expect(screen.getByText(/Developer diagnostics/)).toBeInTheDocument();
  });
});
