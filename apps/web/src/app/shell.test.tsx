import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type CapabilityStateDto, type PresetDto } from '@glm/shared';
import { Appearance } from '../features/settings/Appearance';
import { device, mockApi, renderApp } from '../test/fixtures';
import { AppShell } from './AppShell';

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});
afterEach(() => vi.unstubAllGlobals());

const preset = (name: string, overrides: Partial<PresetDto> = {}): PresetDto => ({
  id: name,
  name,
  description: '',
  needsTarget: false,
  builtin: null,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
  actions: [{ id: 1, deviceId: 'dev-1', deviceName: 'Front Eaves', action: { type: 'power', on: true }, summary: 'Turn on', order: 0 }],
  ...overrides,
});

const state = (instance: string, value: unknown): CapabilityStateDto => ({
  instance,
  requested: null,
  accepted: null,
  reported: { value, at: '2026-11-01T10:00:00.000Z', historical: false },
  notQueryable: false,
  verification: null,
});

const routes = (presets: PresetDto[] = [], devices = [device()]) => ({
  'GET /notifications': { json: { items: [], unread: 0 } },
  'GET /devices': { json: { devices } },
  'GET /presets': { json: { presets } },
  'GET /settings': { json: DEFAULT_SETTINGS },
  'POST /auth/logout': { status: 204 },
});

function shell(route = '/') {
  return renderApp(
    <AppShell username="owner">
      <p>Page</p>
    </AppShell>,
    { route },
  );
}

describe('the command palette', () => {
  it('opens with Ctrl+K, lists the pages, and closes again on the same keys', async () => {
    mockApi(routes());
    shell();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    await userEvent.keyboard('{Control>}k{/Control}');
    const input = await screen.findByRole('combobox', { name: 'Search pages, scenes and actions' });
    const pages = within(screen.getByRole('group', { name: 'Go to' })).getAllByRole('option');
    expect(pages.map((option) => option.textContent)).toContain('Scenes & Presets');
    expect(input).toHaveFocus();
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('opens with / only when no field has focus', async () => {
    mockApi(routes());
    shell();
    await userEvent.keyboard('/');
    expect(await screen.findByRole('combobox')).toBeInTheDocument();
  });

  it('finds a scene by what it is called, and by words from its description, and says when nothing matches', async () => {
    mockApi(routes([preset('Christmas: Candy Cane', { description: 'Red and white stripes.' }), preset('Halloween: Pumpkin')]));
    shell();
    await userEvent.keyboard('{Control>}k{/Control}');
    const input = await screen.findByRole('combobox');
    await userEvent.type(input, 'candy');
    expect(within(screen.getByRole('group', { name: 'Scenes' })).getAllByRole('option')).toHaveLength(1);
    await userEvent.clear(input);
    await userEvent.type(input, 'stripes');
    expect(screen.getByRole('option', { name: /Christmas: Candy Cane/ })).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, 'zzzz');
    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument();
  });

  it('moves with the arrow keys, and Enter on a scene asks before applying it, like every other way in', async () => {
    mockApi(routes([preset('Halloween: Pumpkin')]));
    shell();
    await userEvent.keyboard('{Control>}k{/Control}');
    const input = await screen.findByRole('combobox');
    await userEvent.type(input, 'pumpkin');
    expect(input).toHaveAttribute('aria-activedescendant');
    expect(screen.getByRole('option', { name: /Halloween: Pumpkin/ })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: 'Apply "Halloween: Pumpkin"' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('runs an action from the list: here, signing out', async () => {
    const { calls } = mockApi(routes());
    shell();
    await userEvent.keyboard('{Control>}k{/Control}');
    await userEvent.type(await screen.findByRole('combobox'), 'sign out');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(calls.some((c) => c.path === '/auth/logout')).toBe(true));
  });

  it('can be opened from the search button, which is how a phone reaches it', async () => {
    mockApi(routes());
    shell();
    await userEvent.click(screen.getAllByRole('button', { name: 'Search pages, scenes and actions' })[0]!);
    expect(await screen.findByRole('combobox')).toBeInTheDocument();
  });
});

describe('closing a dialog from the dim area around it', () => {
  it('closes when the dim area is clicked', async () => {
    mockApi(routes());
    shell();
    await userEvent.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Search and commands' });
    await userEvent.click(dialog);
    await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument());
  });

  it('stays open when a drag starts inside it and lets go on the dim area, as selecting text does', async () => {
    mockApi(routes());
    shell();
    await userEvent.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Search and commands' });
    await userEvent.pointer([{ keys: '[MouseLeft>]', target: screen.getByRole('combobox') }, { keys: '[/MouseLeft]', target: dialog }]);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});

describe('the tab title', () => {
  it('says which page you are on', async () => {
    mockApi(routes());
    shell('/schedules');
    await waitFor(() => expect(document.title).toBe('Schedules · Light Manager'));
  });

  it('is just the app name on the dashboard', async () => {
    mockApi(routes());
    shell('/');
    await waitFor(() => expect(document.title).toBe('Light Manager'));
  });
});

describe('the theme', () => {
  it('cycles from following the device to Day, to Night, and remembers the choice', async () => {
    mockApi(routes());
    shell();
    const cycle = () => screen.getByRole('button', { name: /^Theme:/ });
    expect(cycle()).toHaveAccessibleName('Theme: Match this device. Switch to Day.');
    await userEvent.click(cycle());
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(window.localStorage.getItem('glm.theme')).toBe('light');
    expect(cycle()).toHaveAccessibleName('Theme: Day. Switch to Night.');
    await userEvent.click(cycle());
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    await userEvent.click(cycle());
    expect(window.localStorage.getItem('glm.theme')).toBe('auto');
  });

  it('works when storage is blocked: the choice applies, it just is not kept', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    mockApi(routes());
    shell();
    await userEvent.click(screen.getByRole('button', { name: /^Theme:/ }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    vi.restoreAllMocks();
  });

  it('can be chosen outright in Settings', async () => {
    mockApi(routes());
    renderApp(<Appearance />);
    await userEvent.click(within(screen.getByRole('group', { name: 'Theme' })).getByRole('button', { name: 'Night' }));
    expect(window.localStorage.getItem('glm.theme')).toBe('dark');
    expect(within(screen.getByRole('group', { name: 'Theme' })).getByRole('button', { name: 'Night' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('the glow behind the app', () => {
  const redLight = device({ connectivity: 'online', states: [state('powerSwitch', 1), state('colorRgb', 0xff0000)] });
  const glow = () => document.querySelector('.ambient') as HTMLElement | null;

  it('takes the colour the lights are showing', async () => {
    mockApi(routes([], [redLight]));
    shell();
    await waitFor(() => expect(glow()?.style.getPropertyValue('--glow-1')).toBe('#ff0000'));
  });

  it('stays a steady warm tone when no light is showing a colour', async () => {
    mockApi(routes([], [device()]));
    shell();
    await waitFor(() => expect(glow()).not.toBeNull());
    expect(glow()?.style.getPropertyValue('--glow-1')).toBe('#ffb547');
  });

  it('can be set to steady warm, or switched off, and it is kept for next time', async () => {
    mockApi(routes([], [redLight]));
    const { unmount } = renderApp(
      <>
        <Appearance />
        <AppShell username="owner">
          <p>Page</p>
        </AppShell>
      </>,
    );
    await waitFor(() => expect(glow()?.style.getPropertyValue('--glow-1')).toBe('#ff0000'));
    const choice = within(screen.getByRole('group', { name: 'Glow' }));
    await userEvent.click(choice.getByRole('button', { name: 'Steady warm' }));
    expect(glow()?.style.getPropertyValue('--glow-1')).toBe('#ffb547');
    await userEvent.click(choice.getByRole('button', { name: 'Off' }));
    expect(glow()).toBeNull();
    expect(window.localStorage.getItem('glm.glow')).toBe('off');
    unmount();
  });
});
