import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type HolidayDto, type NotificationDto, type ScheduleDto } from '@glm/shared';
import { AppShell } from '../../app/AppShell';
import { deviceLabel, pushSupport } from '../../lib/push';
import { mockApi, renderApp } from '../../test/fixtures';
import { HolidayCalendar } from '../schedules/HolidayCalendar';
import { ScheduleEditor } from '../schedules/ScheduleEditor';
import { SchedulesPage } from '../schedules/SchedulesPage';
import { NotificationsPage } from './NotificationsPage';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (navigator as { serviceWorker?: unknown }).serviceWorker;
});

const notification = (overrides: Partial<NotificationDto> = {}): NotificationDto => ({
  id: 1,
  kind: 'run',
  severity: 'info',
  title: 'Diwali started',
  body: '🟧🟧🟥\nGovee accepted it on 3 strings. Did the lights change?',
  link: '/notifications',
  actions: [
    { action: 'looks_right', label: 'Looks right' },
    { action: 'didnt_change', label: "Didn't change" },
  ],
  answer: null,
  answeredAt: null,
  readAt: null,
  createdAt: '2026-11-09T01:00:00.000Z',
  ...overrides,
});

const routes = (items: NotificationDto[]) => ({
  'GET /notifications': { json: { items, unread: items.filter((n) => !n.readAt).length } },
  'GET /notifications/push': { json: { publicKey: 'BKey', devices: [] } },
  'GET /settings': { json: DEFAULT_SETTINGS },
});

describe('the notification center', () => {
  it('shows what was sent and asks, with buttons that record the answer', async () => {
    const { calls } = mockApi({
      ...routes([notification()]),
      'POST /notifications/1/respond': { json: notification({ answer: 'looks_right' }) },
    });
    renderApp(<NotificationsPage />);
    expect(await screen.findByRole('heading', { name: 'Diwali started' })).toBeInTheDocument();
    expect(screen.getByText(/🟧🟧🟥/)).toBeInTheDocument();
    expect(screen.getByText(/Govee accepted it on 3 strings/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Looks right: Diwali started' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/notifications/1/respond')?.body).toEqual({ action: 'looks_right' }));
  });

  it('shows the answer instead of the buttons once answered', async () => {
    mockApi(routes([notification({ answer: 'didnt_change', answeredAt: '2026-11-09T01:01:00.000Z', readAt: '2026-11-09T01:01:00.000Z' })]));
    renderApp(<NotificationsPage />);
    expect(await screen.findByText("You said it didn't change")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Looks right/ })).not.toBeInTheDocument();
  });

  it('offers a Skip on a holiday heads-up', async () => {
    mockApi(routes([notification({ kind: 'heads_up', title: 'Diwali starts in 15 min', link: '/schedules', actions: [{ action: 'skip', label: 'Skip this one' }] })]));
    renderApp(<NotificationsPage />);
    expect(await screen.findByRole('button', { name: 'Skip this one: Diwali starts in 15 min' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/schedules');
  });

  it('marks everything read', async () => {
    const { calls } = mockApi({ ...routes([notification()]), 'POST /notifications/read-all': { json: { items: [], unread: 0 } } });
    renderApp(<NotificationsPage />);
    await screen.findByRole('heading', { name: 'Diwali started' });
    await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/notifications/read-all')).toBe(true));
  });

  it('explains why it asks, without claiming the lights changed', async () => {
    mockApi(routes([]));
    renderApp(<NotificationsPage />);
    expect(await screen.findByText('Nothing yet')).toBeInTheDocument();
    expect(screen.getByText(/Govee can only say it accepted a command/)).toBeInTheDocument();
  });

  it('saves each choice separately, so nothing else is overwritten', async () => {
    const { calls } = mockApi({ ...routes([]), 'PATCH /settings': { json: { ...DEFAULT_SETTINGS, notifyHeadsUp: false } } });
    renderApp(<NotificationsPage />);
    const toggle = await screen.findByRole('checkbox', { name: /Holiday heads-up/ });
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ notifyHeadsUp: false }));
  });

  it('lists devices with alerts on, and says when delivery fails', async () => {
    mockApi({
      ...routes([]),
      'GET /notifications/push': {
        json: { publicKey: 'BKey', devices: [{ id: 3, label: 'iPhone', createdAt: '', lastSuccessAt: null, lastError: 'The push service answered 503.' }] },
      },
    });
    renderApp(<NotificationsPage />);
    expect(await screen.findByText('iPhone')).toBeInTheDocument();
    expect(screen.getByText('The push service answered 503.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove iPhone' })).toBeInTheDocument();
  });
});

describe('turning on alerts', () => {
  const asDevice = (userAgent: string) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  };
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';

  it('on an iPhone not added to the Home Screen, explains that step first', async () => {
    asDevice(IPHONE);
    mockApi(routes([]));
    renderApp(<NotificationsPage />);
    expect(await screen.findByText('On iPhone, add this app to your Home Screen first')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn on for this device' })).not.toBeInTheDocument();
    expect(pushSupport()).toBe('needs_install');
    expect(deviceLabel()).toBe('iPhone');
  });

  it('says so when a browser cannot do it', async () => {
    mockApi(routes([]));
    renderApp(<NotificationsPage />);
    expect(await screen.findByText(/can't receive push notifications/)).toBeInTheDocument();
  });

  it('only asks for permission when the button is pressed', async () => {
    const requestPermission = vi.fn(async () => 'denied' as const);
    vi.stubGlobal('Notification', Object.assign(function Notification() {}, { permission: 'default', requestPermission }));
    vi.stubGlobal('PushManager', function PushManager() {});
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: async () => undefined } });
    mockApi(routes([]));
    renderApp(<NotificationsPage />);
    const button = await screen.findByRole('button', { name: 'Turn on for this device' });
    await waitFor(() => expect(button).toBeEnabled());
    expect(requestPermission).not.toHaveBeenCalled();
    await userEvent.click(button);
    await waitFor(() => expect(requestPermission).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/were not allowed on this device/)).toBeInTheDocument();
  });
});

describe('the bell', () => {
  it('shows how many are unread, in the sidebar and on a phone', async () => {
    mockApi({ ...routes([notification(), notification({ id: 2 })]), 'POST /auth/logout': { json: {} } });
    renderApp(
      <AppShell username="owner">
        <p>Page</p>
      </AppShell>,
    );
    const links = await screen.findAllByRole('link', { name: 'Notifications, 2 unread' });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute('href', '/notifications');
  });

  it('keeps the phone bar at seven items, with the bell apart from it', async () => {
    mockApi(routes([]));
    renderApp(
      <AppShell username="owner">
        <p>Page</p>
      </AppShell>,
    );
    const bars = screen.getAllByRole('navigation', { name: 'Main' });
    expect(bars.at(-1)?.querySelectorAll('a')).toHaveLength(7);
    expect(await screen.findAllByRole('link', { name: 'Notifications' })).toHaveLength(2);
  });
});

const holiday = (overrides: Partial<HolidayDto> = {}): HolidayDto => ({
  key: 'diwali',
  name: 'Diwali',
  group: 'cultural',
  description: "Diwali colors and Govee's Fireworks effect, taking turns every 30 minutes.",
  enabled: true,
  nextDate: '2026-11-08',
  startTime: '17:00',
  endTime: '20:00',
  timeZone: 'America/Los_Angeles',
  skipped: false,
  colors: ['#ffaa00', '#e6007e'],
  problem: null,
  ...overrides,
});

describe('the holiday calendar', () => {
  it('shows the next date and window, and says the dates and colors are not official facts', async () => {
    mockApi({ 'GET /holidays': { json: { holidays: [holiday()] } } });
    renderApp(<HolidayCalendar />);
    expect(await screen.findByRole('heading', { name: 'Diwali' })).toBeInTheDocument();
    expect(screen.getByText(/Nov 8, 2026, 5:00 PM to 8:00 PM/)).toBeInTheDocument();
    expect(screen.getByText(/Your other schedules still run on these days/)).toBeInTheDocument();
    expect(screen.getByText(/other calendars can differ by a day/)).toBeInTheDocument();
    expect(screen.getByText(/those are suggestions/)).toBeInTheDocument();
  });

  it('turns a holiday off, and skips just the next one', async () => {
    const { calls } = mockApi({
      'GET /holidays': { json: { holidays: [holiday()] } },
      'POST /holidays/diwali/enabled': { json: { holidays: [holiday({ enabled: false })] } },
      'POST /holidays/diwali/skip': { json: { holidays: [holiday({ skipped: true })] } },
      'GET /schedules': { json: { schedules: [] } },
    });
    renderApp(<HolidayCalendar />);
    await userEvent.click(await screen.findByRole('button', { name: 'Skip next Diwali' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/holidays/diwali/skip')?.body).toEqual({ skip: true }));
    expect(await screen.findByText('Skipping next')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Turn off Diwali' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/holidays/diwali/enabled')?.body).toEqual({ enabled: false }));
    expect(await screen.findByText('Off')).toBeInTheDocument();
  });

  it('says plainly when no later date is known', async () => {
    mockApi({ 'GET /holidays': { json: { holidays: [holiday({ nextDate: null })] } } });
    renderApp(<HolidayCalendar />);
    expect(await screen.findByText(/No date known after 2037/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip next Diwali' })).not.toBeInTheDocument();
  });

  const step = (overrides: Partial<ScheduleDto>): ScheduleDto => ({
    id: 's',
    name: 'Mine',
    enabled: true,
    timeZone: 'UTC',
    recurrence: { kind: 'daily', time: '16:00' },
    target: { type: 'device', deviceId: 'd' },
    targetName: 'Left',
    action: { type: 'power', on: true },
    actionSummary: 'Turn on',
    missedRunPolicy: 'skip',
    nextRun: null,
    problem: null,
    builtinShow: null,
    quiet: false,
    lastExecution: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  });

  it('keeps holiday steps out of your own schedules, but still editable', async () => {
    mockApi({
      'GET /holidays': { json: { holidays: [holiday()] } },
      'GET /schedules': {
        json: { schedules: [step({ id: 'a', name: 'Switch ON' }), step({ id: 'b', name: 'Diwali: end', builtinShow: 'diwali', quiet: true })] },
      },
    });
    renderApp(<SchedulesPage />);
    expect(await screen.findByRole('heading', { name: 'Switch ON' })).toBeInTheDocument();
    const summary = await screen.findByText('Change holiday times (1 schedules)');
    const details = summary.closest('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details).toContainElement(screen.getByRole('heading', { name: 'Diwali: end', hidden: true }));
    expect(screen.getByRole('heading', { name: 'Switch ON' }).closest('details')).toBeNull();
  });

  it('offers a holiday when editing a schedule, keeping the one it has', async () => {
    mockApi({
      'GET /settings': { json: DEFAULT_SETTINGS },
      'GET /presets': { json: { presets: [] } },
      'GET /devices': { json: { devices: [] } },
      'GET /groups': { json: { groups: [] } },
      'POST /schedules/preview': { json: { nextRuns: [], datesWithoutSolarEvent: [], warning: null } },
    });
    renderApp(
      <ScheduleEditor
        schedule={step({ id: 'b', name: 'Diwali', builtinShow: 'diwali', recurrence: { kind: 'holiday', holiday: 'diwali', time: '17:00' } })}
        onClose={() => {}}
      />,
    );
    expect(await screen.findByLabelText('Repeat')).toHaveValue('holiday');
    expect(screen.getByLabelText('Holiday')).toHaveValue('diwali');
    expect(screen.getByLabelText('Time')).toHaveValue('17:00');
  });
});
