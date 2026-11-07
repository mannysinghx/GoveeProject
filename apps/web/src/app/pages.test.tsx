import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type DiagnosticsDto, type PresetDto, type ScheduleDto, type SessionDto } from '@glm/shared';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { DeviceDetailPage } from '../features/devices/DeviceDetailPage';
import { ActivityPage } from '../features/activity/ActivityPage';
import { GroupsPage } from '../features/groups/GroupsPage';
import { PresetsPage } from '../features/presets/PresetsPage';
import { SchedulesPage } from '../features/schedules/SchedulesPage';
import { capabilities, device, mockApi, renderApp } from '../test/fixtures';
import { App } from './App';

afterEach(() => vi.unstubAllGlobals());

const diagnostics = (overrides: Partial<DiagnosticsDto['govee']> = {}): DiagnosticsDto => ({
  version: '1.0.0',
  nodeVersion: 'v26',
  uptimeSeconds: 5,
  backend: 'ok',
  database: { status: 'ok', schemaVersion: '001_initial.sql', path: '/data/x.sqlite' },
  govee: {
    keyConfigured: true,
    usingLocalTestEndpoint: false,
    baseUrl: 'https://openapi.api.govee.com',
    lastSuccessfulConnectionAt: '2026-11-01T10:00:00.000Z',
    lastErrorCategory: null,
    lastErrorAt: null,
    lastRateLimitAt: null,
    requestsToday: 3,
    dailyBudget: 8000,
    ...overrides,
  },
  devices: { discovered: 1, noLongerDiscovered: 0, lastDiscoveryAt: '2026-11-01T10:00:00.000Z' },
  scheduler: { status: 'running', lastTickAt: '2026-11-01T10:00:00.000Z', enabledSchedules: 0 },
  queue: { pending: 0, pausedUntil: null },
});

const dashboardRoutes = {
  'GET /settings': { json: DEFAULT_SETTINGS },
  'GET /system/status': { json: diagnostics() },
  'GET /dashboard/summary': { json: { upcoming: [], recentFailures: [] } },
  'GET /presets': { json: { presets: [] } },
  'POST /devices/refresh-due': { json: { devices: [] } },
};

const session = (overrides: Partial<SessionDto> = {}): SessionDto => ({
  setupRequired: false,
  setupCodeRequired: false,
  authenticated: true,
  username: 'owner',
  csrfToken: 'csrf-abc',
  expiresAt: '2030-01-01T00:00:00.000Z',
  ...overrides,
});

describe('authentication flow', () => {
  it('shows first-run setup with the API key guidance, and never asks for the key', async () => {
    mockApi({ 'GET /auth/session': { json: session({ setupRequired: true, authenticated: false, username: null, csrfToken: null }) } });
    renderApp(<App />);

    expect(await screen.findByRole('heading', { name: 'Welcome to Light Manager' })).toBeInTheDocument();
    expect(screen.getByText(/Add your lights in the Govee Home app/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Govee's instructions/ })).toHaveAttribute(
      'href',
      'https://developer.govee.com/reference/apply-you-govee-api-key',
    );
    expect(screen.getByText(/You never paste the key/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/api key/i)).not.toBeInTheDocument();
  });

  it('validates the owner form before submitting', async () => {
    const { calls } = mockApi({
      'GET /auth/session': { json: session({ setupRequired: true, authenticated: false, username: null, csrfToken: null }) },
    });
    renderApp(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Create the owner account' }));

    await userEvent.type(screen.getByLabelText('Username'), 'owner');
    await userEvent.type(screen.getByLabelText('Password'), 'short');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('at least 12 characters');

    await userEvent.clear(screen.getByLabelText('Password'));
    await userEvent.type(screen.getByLabelText('Password'), 'long-enough-password');
    await userEvent.clear(screen.getByLabelText('Confirm password'));
    await userEvent.type(screen.getByLabelText('Confirm password'), 'different-password1');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('do not match');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('asks for the setup code when the server requires one', async () => {
    mockApi({
      'GET /auth/session': {
        json: session({ setupRequired: true, setupCodeRequired: true, authenticated: false, username: null, csrfToken: null }),
      },
    });
    renderApp(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Create the owner account' }));
    expect(screen.getByLabelText('Setup code')).toBeInTheDocument();
  });

  it('shows login when signed out, and reports a wrong password', async () => {
    mockApi({
      'GET /auth/session': { json: session({ authenticated: false, username: null, csrfToken: null }) },
      'POST /auth/login': {
        status: 401,
        json: { error: { code: 'invalid_credentials', message: 'That username or password is not correct.' } },
      },
    });
    renderApp(<App />);
    await userEvent.type(await screen.findByLabelText('Username'), 'owner');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not correct');
  });

  it('sends the CSRF token on state changes, and not on reads', async () => {
    const { calls } = mockApi({
      'GET /auth/session': { json: session() },
      ...dashboardRoutes,
      'GET /devices': { json: { devices: [] } },
      'POST /auth/logout': { status: 204 },
    });
    renderApp(<App />);
    await screen.findByRole('heading', { name: 'Dashboard' });
    await userEvent.click(screen.getAllByRole('button', { name: 'Sign out' })[0]!);
    await waitFor(() => expect(calls.find((c) => c.path === '/auth/logout')).toBeTruthy());

    const logout = calls.find((c) => c.path === '/auth/logout');
    expect(logout?.headers).toMatchObject({ 'x-csrf-token': 'csrf-abc' });
    const read = calls.find((c) => c.path === '/devices');
    expect(read?.headers).not.toHaveProperty('x-csrf-token');
  });
});

describe('dashboard', () => {
  it('shows a loading state, then device cards with last-known state', async () => {
    mockApi({
      ...dashboardRoutes,
      'GET /devices': {
        json: {
          devices: [
            device({
              connectivity: 'online',
              freshness: 'fresh',
              lastStatusRefreshAt: new Date().toISOString(),
              states: [
                { instance: 'powerSwitch', requested: null, accepted: null, reported: { value: 1, at: new Date().toISOString(), historical: false }, notQueryable: false, verification: null },
              ],
            }),
          ],
        },
      },
    });
    renderApp(<DashboardPage />);
    expect(screen.getByText('Loading devices')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Front Eaves' })).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
    expect(screen.getByText(/Updated/)).toBeInTheDocument();
    expect(screen.getByText('Reported power').nextElementSibling).toHaveTextContent('On');
    expect(screen.getByText('Reported brightness').nextElementSibling).toHaveTextContent('Unknown');
  });

  it('shows an empty state that leads to setup', async () => {
    mockApi({ ...dashboardRoutes, 'GET /devices': { json: { devices: [] } } });
    renderApp(<DashboardPage />);
    expect(await screen.findByText('No devices yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Connect to Govee' })).toHaveAttribute('href', '/connect');
  });

  it('shows an error state when devices cannot load', async () => {
    mockApi({
      ...dashboardRoutes,
      'GET /devices': { status: 500, json: { error: { code: 'internal_error', message: 'Something went wrong on the server.' } } },
    });
    renderApp(<DashboardPage />);
    expect(await screen.findByText('Could not load devices')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong on the server.');
  });

  it('warns when no API key is configured', async () => {
    mockApi({
      ...dashboardRoutes,
      'GET /system/status': { json: diagnostics({ keyConfigured: false }) },
      'GET /devices': { json: { devices: [] } },
    });
    renderApp(<DashboardPage />);
    expect(await screen.findByText('No Govee API key is set on the server')).toBeInTheDocument();
  });

  it('never presents stale data as live, and flags offline values as historical', async () => {
    mockApi({
      ...dashboardRoutes,
      'GET /devices': {
        json: {
          devices: [
            device({
              connectivity: 'offline',
              freshness: 'stale',
              lastStatusRefreshAt: new Date(Date.now() - 3_600_000).toISOString(),
              states: [
                { instance: 'brightness', requested: null, accepted: null, reported: { value: 80, at: new Date(Date.now() - 3_600_000).toISOString(), historical: true }, notQueryable: false, verification: null },
              ],
            }),
          ],
        },
      },
    });
    renderApp(<DashboardPage />);
    expect(await screen.findByText('Offline')).toBeInTheDocument();
    expect(screen.getByText(/^Stale:/)).toBeInTheDocument();
    expect(screen.getByText('Last reported brightness')).toBeInTheDocument();
  });

  it('hides quick power on a device that does not report it', async () => {
    mockApi({
      ...dashboardRoutes,
      'GET /devices': { json: { devices: [device({ capabilities: [capabilities.brightness] })] } },
    });
    renderApp(<DashboardPage />);
    await screen.findByRole('link', { name: 'Front Eaves' });
    expect(screen.queryByRole('button', { name: /Turn Front Eaves on/ })).not.toBeInTheDocument();
  });

  it('shows test mode prominently when on a local endpoint', async () => {
    mockApi({
      ...dashboardRoutes,
      'GET /system/status': { json: diagnostics({ usingLocalTestEndpoint: true }) },
      'GET /devices': { json: { devices: [] } },
    });
    renderApp(<DashboardPage />);
    expect(await screen.findByText(/not Govee\. The devices below are test data/)).toBeInTheDocument();
  });
});

describe('device page', () => {
  const page = (d: ReturnType<typeof device>) => {
    mockApi({
      'GET /settings': { json: DEFAULT_SETTINGS },
      'GET /devices/dev-1': { json: d },
    });
    renderApp(
      <Routes>
        <Route path="/devices/:id" element={<DeviceDetailPage />} />
      </Routes>,
      { route: '/devices/dev-1' },
    );
  };

  it('keeps requested, accepted and reported apart, and only confirms from a report', async () => {
    page(
      device({
        states: [
          {
            instance: 'brightness',
            requested: { value: 50, at: new Date().toISOString() },
            accepted: { value: 50, at: new Date().toISOString() },
            reported: null,
            notQueryable: false,
            verification: 'unverified',
          },
        ],
      }),
    );
    await screen.findByRole('heading', { name: 'Front Eaves' });
    expect(screen.getByText('Requested')).toBeInTheDocument();
    expect(screen.getByText('Accepted by Govee')).toBeInTheDocument();
    expect(screen.getByText('Reported by Govee')).toBeInTheDocument();
    expect(screen.getByText('Not yet confirmed')).toBeInTheDocument();
    expect(screen.queryByText(/Confirmed by a later Govee report/)).not.toBeInTheDocument();
  });

  it('labels a matching later report as confirmed by a report', async () => {
    page(
      device({
        states: [
          {
            instance: 'brightness',
            requested: null,
            accepted: { value: 50, at: new Date().toISOString() },
            reported: { value: 50, at: new Date().toISOString(), historical: false },
            notQueryable: false,
            verification: 'confirmed',
          },
        ],
      }),
    );
    expect(await screen.findByText('Confirmed by a later Govee report')).toBeInTheDocument();
  });

  it('says "Not reported" when Govee gives no value, with nothing invented', async () => {
    page(
      device({
        states: [
          { instance: 'colorRgb', requested: null, accepted: null, reported: null, notQueryable: true, verification: null },
        ],
      }),
    );
    expect(await screen.findByText(/Not reported by Govee: RGB colour/)).toBeInTheDocument();
  });

  it('explains an offline device and a device Govee no longer lists', async () => {
    page(device({ connectivity: 'offline', lastOnlineAt: null }));
    expect(await screen.findByText('Govee reports this device as offline')).toBeInTheDocument();
    expect(screen.getByText(/Commands may be accepted by Govee and still not reach the lights/)).toBeInTheDocument();
  });

  it('removes controls for a device Govee no longer lists', async () => {
    page(device({ discoveryStatus: 'missing', missingSince: '2026-11-01T10:00:00.000Z' }));
    expect(await screen.findByText('Govee no longer lists this device')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'On' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh status' })).toBeDisabled();
  });

  it('shows pending commands', async () => {
    page(
      device({
        pendingCommands: [
          {
            id: 'c',
            deviceId: 'dev-1',
            actionType: 'power',
            instance: 'powerSwitch',
            summary: 'Turn on',
            sourceType: 'manual',
            status: 'queued',
            verification: 'not_applicable',
            attempts: 0,
            errorCategory: null,
            errorMessage: null,
            requestId: 'r',
            createdAt: new Date().toISOString(),
            acceptedAt: null,
            completedAt: null,
          },
        ],
      }),
    );
    expect(await screen.findByText('Pending commands (1)')).toBeInTheDocument();
    expect(screen.getByText('Queued')).toBeInTheDocument();
  });

  it('shows an error when the device cannot be loaded', async () => {
    mockApi({
      'GET /settings': { json: DEFAULT_SETTINGS },
      'GET /devices/dev-1': { status: 404, json: { error: { code: 'not_found', message: 'That device was not found.' } } },
    });
    renderApp(
      <Routes>
        <Route path="/devices/:id" element={<DeviceDetailPage />} />
      </Routes>,
      { route: '/devices/dev-1' },
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('That device was not found.');
  });
});

describe('presets', () => {
  const preset: PresetDto = {
    id: 'p1',
    name: 'Everyday Warm',
    description: 'Warm white',
    needsTarget: true,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    actions: [
      { id: 1, deviceId: null, deviceName: null, action: { type: 'power', on: true }, summary: 'Turn on', order: 0 },
      { id: 2, deviceId: null, deviceName: null, action: { type: 'color', hex: '#ff8800' }, summary: 'Set colour to #ff8800', order: 1 },
    ],
  };

  it('tells apart app presets, Govee scenes and DIY scenes', async () => {
    mockApi({ 'GET /presets': { json: { presets: [] } }, 'GET /devices': { json: { devices: [] } } });
    renderApp(<PresetsPage />);
    expect(await screen.findByText('No presets yet')).toBeInTheDocument();
    expect(screen.getAllByText('App preset').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Govee scene').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Govee DIY scene').length).toBeGreaterThan(0);
    expect(screen.getByText(/It cannot create or edit them/)).toBeInTheDocument();
  });

  it('shows validation errors from the server when saving', async () => {
    mockApi({
      'GET /presets': { json: { presets: [] } },
      'GET /devices': { json: { devices: [device({ capabilities: [capabilities.power] })] } },
      'POST /presets': {
        status: 422,
        json: { error: { code: 'invalid_preset_action', message: 'Action 1: Front Eaves does not report RGB colour control through the Govee API.' } },
      },
    });
    renderApp(<PresetsPage />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'New preset' }))[0]!);
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Broken');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save preset' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('does not report RGB colour');
    expect(within(dialog).getByText('The preset was not saved')).toBeInTheDocument();
  });

  it('previews the steps before saving, in order', async () => {
    mockApi({ 'GET /presets': { json: { presets: [] } }, 'GET /devices': { json: { devices: [] } } });
    renderApp(<PresetsPage />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'New preset' }))[0]!);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Preview')).toBeInTheDocument();
    expect(within(dialog).getByText('· the chosen target')).toBeInTheDocument();
    expect(within(dialog).getByText(/^Turn on/)).toBeInTheDocument();
    expect(within(dialog).getByText(/not at the same instant/)).toBeInTheDocument();
  });

  it('requires a target for device-independent actions, and shows per-device results', async () => {
    const { calls } = mockApi({
      'GET /presets': { json: { presets: [preset] } },
      'GET /devices': { json: { devices: [device()] } },
      'GET /groups': { json: { groups: [] } },
      'POST /presets/p1/apply': {
        json: {
          runId: 'r',
          sourceType: 'preset',
          sourceId: 'p1',
          sourceName: 'Everyday Warm',
          status: 'partial',
          startedAt: '2026-11-01T10:00:00.000Z',
          completedAt: '2026-11-01T10:00:01.000Z',
          outcomes: [
            { deviceId: 'dev-1', deviceName: 'Front Eaves', actionType: 'power', summary: 'Turn on', status: 'accepted', commandId: 'c', verification: 'unverified', reason: null, errorCategory: null },
            { deviceId: 'dev-1', deviceName: 'Front Eaves', actionType: 'color', summary: 'Set colour', status: 'skipped', commandId: null, verification: 'not_applicable', reason: 'Front Eaves does not report RGB colour control.', errorCategory: null },
          ],
        },
      },
      'GET /dashboard/summary': { json: { upcoming: [], recentFailures: [] } },
    });
    renderApp(<PresetsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Apply' }));
    const dialog = await screen.findByRole('dialog');
    const applyButton = within(dialog).getByRole('button', { name: 'Apply preset' });
    expect(applyButton).toBeDisabled();

    await userEvent.selectOptions(within(dialog).getByLabelText('Apply to'), 'device:dev-1');
    await userEvent.click(applyButton);

    expect(await within(dialog).findByText('Partly accepted')).toBeInTheDocument();
    expect(within(dialog).getByText('1 of 2 actions accepted by Govee')).toBeInTheDocument();
    expect(within(dialog).getByText(/does not report RGB colour control/)).toBeInTheDocument();
    expect(within(dialog).getByText(/does not prove the lights changed/)).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/presets/p1/apply')?.body).toEqual({ target: { type: 'device', deviceId: 'dev-1' } });
  });
});

describe('groups', () => {
  it('states that groups are not synchronized and only exist in the app', async () => {
    mockApi({ 'GET /groups': { json: { groups: [] } }, 'GET /devices': { json: { devices: [] } } });
    renderApp(<GroupsPage />);
    expect(await screen.findByText('No groups yet')).toBeInTheDocument();
    expect(screen.getByText(/not perfectly synchronized/)).toBeInTheDocument();
  });

  it('shows per-device results after applying', async () => {
    mockApi({
      'GET /groups': { json: { groups: [{ id: 'g1', name: 'Backyard', deviceIds: ['dev-1'], createdAt: '', updatedAt: '' }] } },
      'GET /devices': { json: { devices: [device()] } },
      'POST /groups/g1/apply': {
        json: {
          runId: 'r',
          sourceType: 'group',
          sourceId: 'g1',
          sourceName: 'Backyard',
          status: 'failed',
          startedAt: '2026-11-01T10:00:00.000Z',
          completedAt: '2026-11-01T10:00:01.000Z',
          outcomes: [
            { deviceId: 'dev-1', deviceName: 'Front Eaves', actionType: 'power', summary: 'Turn on', status: 'failed', commandId: 'c', verification: 'not_applicable', reason: 'Could not reach the Govee service.', errorCategory: 'network' },
          ],
        },
      },
      'GET /dashboard/summary': { json: { upcoming: [], recentFailures: [] } },
    });
    renderApp(<GroupsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Turn Backyard on' }));
    expect(await screen.findByText('Not delivered')).toBeInTheDocument();
    expect(screen.getByText('Could not reach the Govee service.')).toBeInTheDocument();
  });
});

describe('schedules', () => {
  const schedule: ScheduleDto = {
    id: 's1',
    name: 'Evening',
    enabled: true,
    timeZone: 'America/New_York',
    recurrence: { kind: 'daily', time: '02:30' },
    target: { type: 'device', deviceId: 'dev-1' },
    targetName: 'Front Eaves',
    action: { type: 'power', on: true },
    actionSummary: 'Turn on',
    missedRunPolicy: 'skip',
    nextRun: { at: '2027-03-14T07:30:00.000Z', local: '2027-03-14 03:30 EDT', note: 'dst_gap_moved_forward' },
    problem: null,
    lastExecution: null,
    createdAt: '',
    updatedAt: '',
  };

  it('explains that schedules need the app to be running', async () => {
    mockApi({ 'GET /schedules': { json: { schedules: [] } } });
    renderApp(<SchedulesPage />);
    expect(await screen.findByText('No schedules yet')).toBeInTheDocument();
    expect(screen.getByText(/They do not run if the app is stopped/)).toBeInTheDocument();
  });

  it('shows the next actual run time, and explains a daylight-saving adjustment', async () => {
    mockApi({ 'GET /schedules': { json: { schedules: [schedule] } } });
    renderApp(<SchedulesPage />);
    expect(await screen.findByText('2027-03-14 03:30 EDT')).toBeInTheDocument();
    expect(screen.getByText(/Moved later because clocks go forward/)).toBeInTheDocument();
    expect(screen.getByText('Every day at 02:30')).toBeInTheDocument();
  });

  it('shows missed and recovered runs in history', async () => {
    mockApi({
      'GET /schedules': { json: { schedules: [schedule] } },
      'GET /schedules/s1/executions': {
        json: {
          executions: [
            { id: 'e1', scheduleId: 's1', occurrenceKey: 'a', scheduledFor: '2026-11-02T10:00:00.000Z', startedAt: null, completedAt: null, status: 'all_accepted', isRecovery: true, errorSummary: null, runId: null },
            { id: 'e2', scheduleId: 's1', occurrenceKey: 'b', scheduledFor: '2026-11-01T10:00:00.000Z', startedAt: null, completedAt: null, status: 'missed', isRecovery: false, errorSummary: 'The app was not running.', runId: null },
          ],
        },
      },
    });
    renderApp(<SchedulesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'History' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Recovered')).toBeInTheDocument();
    expect(within(dialog).getByText('All accepted by Govee')).toBeInTheDocument();
    expect(within(dialog).getByText('Missed')).toBeInTheDocument();
    expect(within(dialog).getByText('The app was not running.')).toBeInTheDocument();
  });

  it('shows a preview from the server, and a client validation error for bad dates', async () => {
    mockApi({
      'GET /schedules': { json: { schedules: [] } },
      'GET /settings': { json: DEFAULT_SETTINGS },
      'GET /presets': { json: { presets: [] } },
      'GET /devices': { json: { devices: [device()] } },
      'GET /groups': { json: { groups: [] } },
      'POST /schedules/preview': {
        json: { nextRuns: [{ at: '2027-01-01T18:00:00.000Z', local: '2027-01-01 18:00 UTC', note: null }], datesWithoutSolarEvent: [], warning: null },
      },
    });
    renderApp(<SchedulesPage />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'New schedule' }))[0]!);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('2027-01-01 18:00 UTC')).toBeInTheDocument();
    expect(within(dialog).getByText(/only runs while the app is running/)).toBeInTheDocument();

    await userEvent.type(within(dialog).getByLabelText('Start date (optional)'), '2027-06-02');
    await userEvent.type(within(dialog).getByLabelText('End date (optional)'), '2027-06-01');
    expect(await within(dialog).findByText('The end date is before the start date')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save schedule' })).toBeDisabled();
  });

  it('shows the server\'s reason when a schedule cannot be saved', async () => {
    mockApi({
      'GET /schedules': { json: { schedules: [] } },
      'GET /settings': { json: DEFAULT_SETTINGS },
      'GET /presets': { json: { presets: [] } },
      'GET /devices': { json: { devices: [device()] } },
      'GET /groups': { json: { groups: [] } },
      'POST /schedules/preview': { json: { nextRuns: [], datesWithoutSolarEvent: [], warning: 'This schedule has no future runs with these settings.' } },
      'POST /schedules': { status: 422, json: { error: { code: 'schedule_never_runs', message: 'This schedule would never run with these dates and settings.' } } },
    });
    renderApp(<SchedulesPage />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'New schedule' }))[0]!);
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Never');
    await userEvent.selectOptions(within(dialog).getByLabelText('Target'), 'device:dev-1');
    expect(await within(dialog).findByText(/no future runs/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save schedule' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('would never run');
  });
});

describe('activity and diagnostics', () => {
  it('filters by event type and result, and shows key status without any key', async () => {
    const { calls } = mockApi({
      'GET /devices': { json: { devices: [device()] } },
      'GET /system/status': { json: diagnostics({ lastErrorCategory: 'auth', lastErrorAt: '2026-11-01T11:00:00.000Z' }) },
      'GET /activity': {
        json: {
          events: [
            { id: 1, createdAt: '2026-11-01T10:00:00.000Z', eventType: 'command', outcome: 'failure', deviceId: 'dev-1', deviceName: 'Front Eaves', correlationId: 'corr-1', message: 'Turn on: rejected.', details: null },
          ],
          nextBeforeId: null,
        },
      },
    });
    renderApp(<ActivityPage />);
    expect(await screen.findByText('Turn on: rejected.')).toBeInTheDocument();
    expect(screen.getByText('Ref: corr-1')).toBeInTheDocument();
    expect(await screen.findByText('Configured')).toBeInTheDocument();
    expect(await screen.findByText(/Govee rejected the key/)).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Event type'), 'command');
    await userEvent.selectOptions(screen.getByLabelText('Result'), 'failure');
    await userEvent.selectOptions(screen.getByLabelText('Device'), 'dev-1');
    await waitFor(() => {
      const last = calls.filter((c) => c.path === '/activity').at(-1);
      expect(last).toBeTruthy();
    });
    const queries = (globalThis.fetch as unknown as { mock: { calls: [RequestInfo][] } }).mock.calls.map((c) => String(c[0]));
    expect(queries.some((q) => q.includes('eventType=command') && q.includes('outcome=failure') && q.includes('deviceId=dev-1'))).toBe(true);
  });
});
