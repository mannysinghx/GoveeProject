import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminSharedItemDto, ImportPreviewDto, SessionDto, SharedItemDto, SharedListDto } from '@glm/shared';
import { mockApi, renderApp } from '../../test/fixtures';
import { SharedModeration } from './SharedModeration';
import { SharedPage } from './SharedPage';
import { ShareButton } from './ShareButton';

afterEach(() => vi.unstubAllGlobals());

const session = (role: 'owner' | 'member'): { 'GET /auth/session': { json: SessionDto } } => ({
  'GET /auth/session': {
    json: {
      setupRequired: false,
      setupCodeRequired: false,
      authenticated: true,
      username: role === 'owner' ? 'owner' : 'me@example.com',
      csrfToken: 'csrf',
      expiresAt: '2030-01-01T00:00:00Z',
      signupOpen: false,
      email: role === 'owner' ? null : 'me@example.com',
      role,
    },
  },
});

const item = (overrides: Partial<SharedItemDto> = {}): SharedItemDto => ({
  id: 'share-1',
  kind: 'schedule',
  title: 'Evening pattern',
  description: 'Red and blue at sunset',
  by: 'Light Manager',
  official: true,
  mine: false,
  sourceId: null,
  hidden: false,
  colors: ['#ff0000', '#0000ff'],
  slots: [{ key: 'aaaaaaaaaaaa', label: 'Light 1 (H805C)', sku: 'H805C', segmentCount: 27 }],
  counts: { presets: 1, groups: 1, schedules: 1 },
  recurrence: { kind: 'solar', event: 'sunset', offsetMinutes: 0 },
  scheduleAction: 'Red and blue',
  importedByMe: false,
  imports: 3,
  createdAt: '2026-11-22T10:00:00Z',
  updatedAt: '2026-11-22T10:00:00Z',
  ...overrides,
});

const list = (overrides: Partial<SharedListDto> = {}): SharedListDto => ({
  items: [item(), item({ id: 'share-2', title: 'Morning off', kind: 'schedule', colors: [], recurrence: { kind: 'daily', time: '07:00' }, scheduleAction: 'Turn off' })],
  displayName: 'Maker Jo',
  canShare: true,
  shareLimit: 25,
  sharedCount: 0,
  ...overrides,
});

const preview = (overrides: Partial<ImportPreviewDto> = {}): ImportPreviewDto => ({
  slots: [{ key: 'aaaaaaaaaaaa', label: 'Light 1 (H805C)', sku: 'H805C', segmentCount: 27, needsSegments: true, needsColor: true, suggestion: 'dev-roof' }],
  devices: [
    { id: 'dev-porch', name: 'Porch', sku: 'H6199', segmentCount: 20, hasColor: true },
    { id: 'dev-roof', name: 'Roof', sku: 'H805C', segmentCount: 27, hasColor: true },
  ],
  scenes: [],
  create: { presets: 1, groups: 1, schedules: 2 },
  needsLocation: false,
  alreadyImported: [],
  ...overrides,
});

describe('the Shared page', () => {
  it('shows the official section with a summary, and imports everything onto the suggested lights', async () => {
    const { calls } = mockApi({
      ...session('member'),
      'GET /shared': { json: list() },
      'POST /shared/import/preview': { json: preview() },
      'POST /shared/import': { json: { created: { presets: 1, groups: 1, schedules: 2 }, names: [] } },
    });
    renderApp(<SharedPage />);
    expect(await screen.findByRole('heading', { name: 'Light Manager' })).toBeInTheDocument();
    expect(screen.getByText(/At sunset · Red and blue · 1 light \(H805C\)/)).toBeInTheDocument();
    expect(screen.getByText(/Every day at 07:00 · Turn off/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Import everything from Light Manager' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/makes 1 preset\(s\), 1 group\(s\) and 2 schedule\(s\)/)).toBeInTheDocument();
    const select = within(dialog).getByLabelText('Light 1 (H805C)');
    await waitFor(() => expect(select).toHaveValue('dev-roof'));
    await userEvent.selectOptions(select, 'dev-porch');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Import' }));

    expect(await within(dialog).findByText(/Schedules start switched off/)).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/shared/import')?.body).toEqual({
      itemIds: ['share-1', 'share-2'],
      slots: { aaaaaaaaaaaa: 'dev-porch' },
      scenes: {},
    });
  });

  it('stops an import that needs the person\'s location', async () => {
    mockApi({ ...session('member'), 'GET /shared': { json: list() }, 'POST /shared/import/preview': { json: preview({ needsLocation: true }) } });
    renderApp(<SharedPage />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'Import' }))[0]!);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Your location is needed')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Import' })).toBeDisabled();
  });

  it('asks for a scene when the chosen light does not have it', async () => {
    const { calls } = mockApi({
      ...session('member'),
      'GET /shared': { json: list({ items: [item({ kind: 'preset', title: 'Party', recurrence: null, scheduleAction: null })] }) },
      'POST /shared/import/preview': {
        json: preview({ scenes: [{ choiceKey: 'bbbbbbbbbbbb:0', slot: 'aaaaaaaaaaaa', presetName: 'Party', sceneKey: 'dynamic-1-2', sceneName: 'Fireworks', portable: true }] }),
      },
      'GET /devices/dev-roof/scenes': { json: { scenes: [{ key: 'dynamic-9-9', name: 'Aurora', kind: 'dynamic', instance: 'lightScene', fetchedAt: '2026-11-22T10:00:00Z' }], supported: true, lastRefreshErrors: [], fetchedAt: null } },
      'POST /shared/import': { json: { created: { presets: 1, groups: 0, schedules: 0 }, names: [] } },
    });
    renderApp(<SharedPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Import' }));
    const dialog = await screen.findByRole('dialog');
    const scene = await within(dialog).findByLabelText('Scene for "Party"');
    await userEvent.selectOptions(scene, 'dynamic-9-9');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    await within(dialog).findByText(/Schedules start switched off/);
    expect(calls.find((c) => c.path === '/shared/import')?.body).toMatchObject({ scenes: { 'bbbbbbbbbbbb:0': 'dynamic-9-9' } });
  });

  it('lets the owner share everything at once', async () => {
    const { calls } = mockApi({ ...session('owner'), 'GET /shared': { json: list({ items: [], displayName: 'Light Manager', shareLimit: null }) }, 'POST /shared/share-all': { json: { shared: 5, skipped: [] } } });
    renderApp(<SharedPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Share all my lights and schedules' }));
    expect(await screen.findByText('Shared 5 more item(s).')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.path === '/shared/share-all')).toBe(true);
    expect(screen.queryByText('Your display name')).not.toBeInTheDocument();
  });
});

describe('the Share button', () => {
  it('asks a member for a display name first, then shares a copy', async () => {
    let named = false;
    const shared = item({ id: 'share-9', kind: 'preset', title: 'Warm', by: 'Maker Jo', official: false, mine: true, sourceId: 'preset-1' });
    const { calls } = mockApi({
      ...session('member'),
      'GET /shared': () => ({ json: list({ items: [], displayName: named ? 'Maker Jo' : null }) }),
      'PUT /account/display-name': () => {
        named = true;
        return { json: { displayName: 'Maker Jo' } };
      },
      'POST /shared': { status: 201, json: shared },
    });
    renderApp(<ShareButton kind="preset" sourceId="preset-1" name="Warm" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Share' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(await within(dialog).findByLabelText('Display name'), 'Maker Jo');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save name' }));
    expect(await within(dialog).findByLabelText('Title')).toHaveValue('Warm');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Share with everyone' }));
    expect(await within(dialog).findByText('Shared with everyone')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST' && c.path === '/shared')?.body).toEqual({ kind: 'preset', sourceId: 'preset-1', title: 'Warm', description: '' });
    expect(within(dialog).getByRole('button', { name: 'Stop sharing' })).toBeInTheDocument();
  });
});

describe('the owner\'s moderation', () => {
  it('hides an item, and removes one only after confirming', async () => {
    const admin = (hidden: boolean): AdminSharedItemDto[] => [
      { ...item({ id: 'share-5', title: 'Rude', by: 'Someone', official: false, hidden }), sharerId: 4, sharerEmail: 'someone@example.com' },
    ];
    const { calls } = mockApi({
      ...session('owner'),
      'GET /admin/shared': { json: { items: admin(false) } },
      'PATCH /admin/shared/share-5': { json: { items: admin(true) } },
      'DELETE /admin/shared/share-5': { json: { items: [] } },
    });
    renderApp(<SharedModeration />);
    await userEvent.click(await screen.findByRole('button', { name: 'Hide' }));
    expect(await screen.findByText('Hidden')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ hidden: true });
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm remove' }));
    expect(await screen.findByText('Nothing has been shared yet.')).toBeInTheDocument();
  });
});
