import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type CapabilityStateDto, type PresetDto, type RunResultDto } from '@glm/shared';
import { PrivacyPage } from '../features/legal/LegalPages';
import { Appearance } from '../features/settings/Appearance';
import { glowStore, THEME_COLOR, THEME_STORAGE_KEY, themeStore } from '../lib/theme';
import { device, mockApi, renderApp } from '../test/fixtures';
import { AppShell } from './AppShell';

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.title = 'Govee Light Manager';
  // The choices live in module-level stores, so a cleared storage has to be read again.
  themeStore.reload();
  glowStore.reload();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

/** Shows where the router is and what it was told, so a test can see where an action sent it. */
function Where() {
  const location = useLocation();
  return <output data-testid="where">{`${location.pathname} ${JSON.stringify(location.state)}`}</output>;
}

function shell(route = '/', page = <Where />) {
  return renderApp(<AppShell username="owner">{page}</AppShell>, { route });
}

const SEARCH = { name: 'Search pages, scenes and actions' };
const openPalette = () => userEvent.keyboard('{Control>}k{/Control}');

describe('the command palette', () => {
  it('opens with Ctrl+K, lists the pages, and closes again on the same keys', async () => {
    mockApi(routes());
    shell();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    await openPalette();
    const input = await screen.findByRole('combobox', SEARCH);
    const pages = within(screen.getByRole('group', { name: 'Go to' })).getAllByRole('option');
    expect(pages.map((option) => option.textContent)).toContain('Scenes & Presets');
    expect(input).toHaveFocus();
    await openPalette();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('does not take the / key, which would catch speech input and switch users, anywhere on the page', async () => {
    mockApi(routes());
    shell();
    await userEvent.keyboard('/');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('ignores Ctrl+Shift+K and Ctrl+Alt+K, which are other shortcuts and, on some keyboards, typing', async () => {
    mockApi(routes());
    shell();
    await userEvent.keyboard('{Control>}{Shift>}k{/Shift}{/Control}');
    await userEvent.keyboard('{Control>}{Alt>}k{/Alt}{/Control}');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('does not flicker when the keys are held down', async () => {
    mockApi(routes());
    shell();
    await openPalette();
    await screen.findByRole('combobox');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, repeat: true, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, repeat: true, bubbles: true }));
    });
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('uses Command+K on a Mac, where Ctrl+K deletes to the end of a line in a text field', async () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    mockApi(routes());
    shell();
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    expect(await screen.findByRole('combobox')).toBeInTheDocument();
    expect(screen.getByText('⌘K')).toBeInTheDocument();
  });

  it('finds a scene by what it is called, and by words from its description, and says when nothing matches', async () => {
    mockApi(routes([preset('Christmas: Candy Cane', { description: 'Red and white stripes.' }), preset('Halloween: Pumpkin')]));
    shell();
    await openPalette();
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

  it('moves with the arrow keys, Home and End, and keeps aria-activedescendant pointing at the highlighted option', async () => {
    mockApi(routes([preset('Aurora One'), preset('Aurora Two'), preset('Aurora Three')]));
    shell();
    await openPalette();
    const input = await screen.findByRole('combobox');
    await userEvent.type(input, 'aurora');
    const options = () => screen.getAllByRole('option');
    const selected = () => options().findIndex((option) => option.getAttribute('aria-selected') === 'true');
    const activeIsSelected = () => expect(input.getAttribute('aria-activedescendant')).toBe(options()[selected()]?.id);

    expect(options()).toHaveLength(3);
    expect(selected()).toBe(0);
    activeIsSelected();
    await userEvent.keyboard('{ArrowDown}');
    expect(selected()).toBe(1);
    activeIsSelected();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(selected()).toBe(0); // wraps round
    await userEvent.keyboard('{ArrowUp}');
    expect(selected()).toBe(2); // and back
    await userEvent.keyboard('{Home}');
    expect(selected()).toBe(0);
    await userEvent.keyboard('{End}');
    expect(selected()).toBe(2);
    activeIsSelected();
  });

  it('Enter on a scene asks before applying it, like every other way in', async () => {
    const { calls } = mockApi(routes([preset('Aurora One'), preset('Aurora Two')]));
    shell();
    await openPalette();
    await userEvent.type(await screen.findByRole('combobox'), 'aurora');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(await screen.findByRole('dialog', { name: 'Apply "Aurora Two"' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('starts a fresh dialog when a second scene is chosen, and does not show the first one\'s result under it', async () => {
    const run: RunResultDto = {
      runId: 'r1',
      sourceType: 'preset',
      sourceId: 'aurora-one',
      sourceName: 'Aurora One',
      status: 'all_accepted',
      startedAt: '2026-11-01T10:00:00.000Z',
      completedAt: '2026-11-01T10:00:01.000Z',
      outcomes: [
        { deviceId: 'dev-1', deviceName: 'Front Eaves', actionType: 'power', summary: 'Turn on', status: 'accepted', commandId: 'c1', verification: 'unverified', reason: null, errorCategory: null },
      ],
    };
    mockApi({ ...routes([preset('Aurora One', { id: 'aurora-one' }), preset('Aurora Two', { id: 'aurora-two' })]), 'POST /presets/aurora-one/apply': { json: run } });
    shell();

    await openPalette();
    await userEvent.type(await screen.findByRole('combobox'), 'aurora one');
    await userEvent.keyboard('{Enter}');
    await userEvent.click(await screen.findByRole('button', { name: 'Apply preset' }));
    expect(await screen.findByText(/All accepted by Govee/)).toBeInTheDocument();

    await openPalette();
    await userEvent.type(await screen.findByRole('combobox'), 'aurora two');
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: 'Apply "Aurora Two"' })).toBeInTheDocument();
    expect(screen.queryByText(/All accepted by Govee/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply preset' })).toBeEnabled();
  });

  it('runs an action from the list: here, signing out', async () => {
    const { calls } = mockApi(routes());
    shell();
    await openPalette();
    await userEvent.type(await screen.findByRole('combobox'), 'sign out');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(calls.some((c) => c.path === '/auth/logout')).toBe(true));
  });

  it('sends "Check lights now" to the dashboard, which runs it where its progress, result and errors show', async () => {
    mockApi(routes());
    shell('/settings');
    await openPalette();
    await userEvent.type(await screen.findByRole('combobox'), 'check lights');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/ {"checkNow":true}'));
  });

  it('can be opened from the search button, which is how a phone reaches it', async () => {
    mockApi(routes());
    shell();
    // The phone's icon button has the full name. The wide screen's bar names itself by what it says.
    await userEvent.click(screen.getByRole('button', SEARCH));
    expect(await screen.findByRole('combobox')).toBeInTheDocument();
  });

  it("opens from the wide screen's search bar too, which is named by the words on it so a voice command for them works", async () => {
    mockApi(routes());
    shell();
    await userEvent.click(screen.getByRole('button', { name: /^Search or jump to/ }));
    expect(await screen.findByRole('combobox')).toBeInTheDocument();
  });
});

describe('where focus goes when a dialog closes', () => {
  it('returns to the button that opened the command palette', async () => {
    mockApi(routes());
    shell();
    const button = screen.getByRole('button', SEARCH);
    await userEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'Search and commands' });
    await userEvent.click(dialog);
    await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument());
    expect(button).toHaveFocus();
  });

  it('returns to the More button after the More sheet', async () => {
    mockApi(routes());
    shell();
    const more = screen.getByRole('button', { name: 'More' });
    await userEvent.click(more);
    const sheet = await screen.findByRole('dialog', { name: 'More' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'More' })).not.toBeInTheDocument());
    expect(more).toHaveFocus();
  });
});

describe('closing a dialog from the dim area around it', () => {
  it('closes when the dim area is clicked', async () => {
    mockApi(routes());
    shell();
    await openPalette();
    const dialog = await screen.findByRole('dialog', { name: 'Search and commands' });
    await userEvent.click(dialog);
    await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument());
  });

  it('stays open when a drag starts inside it and lets go on the dim area, as selecting text does', async () => {
    mockApi(routes());
    shell();
    await openPalette();
    const dialog = await screen.findByRole('dialog', { name: 'Search and commands' });
    await userEvent.pointer([{ keys: '[MouseLeft>]', target: screen.getByRole('combobox') }, { keys: '[/MouseLeft]', target: dialog }]);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});

describe('the phone dock', () => {
  it('names each place with the word on it, so "Home" and "Timers" work as voice commands', () => {
    mockApi(routes());
    shell();
    const dock = screen.getAllByRole('navigation', { name: 'Main' }).at(-1)!;
    expect(within(dock).getByRole('link', { name: 'Home, Dashboard' })).toHaveAttribute('href', '/');
    expect(within(dock).getByRole('link', { name: 'Timers, Schedules' })).toHaveAttribute('href', '/schedules');
    expect(within(dock).getByRole('link', { name: 'Scenes & Presets' })).toHaveAttribute('href', '/presets');
    expect(within(dock).getByRole('link', { name: 'Groups' })).toHaveAttribute('href', '/groups');
  });

  it('says how many notifications are unread on the More sheet too, like the other bells', async () => {
    mockApi({ ...routes(), 'GET /notifications': { json: { items: [], unread: 3 } } });
    shell();
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    const sheet = await screen.findByRole('dialog', { name: 'More' });
    expect(await within(sheet).findByRole('link', { name: 'Notifications, 3 unread' })).toHaveAttribute('href', '/notifications');
  });
});

describe('the sidebar', () => {
  const rail = () => screen.getAllByRole('navigation', { name: 'Main' })[0]!;

  it('names each place with the word beside it too, and shows a caption under each icon where the sidebar is narrow', () => {
    mockApi(routes());
    shell();
    const links = within(rail());
    expect(links.getByRole('link', { name: 'Home, Dashboard' })).toHaveAttribute('href', '/');
    expect(links.getByRole('link', { name: 'Timers, Schedules' })).toHaveAttribute('href', '/schedules');
    expect(links.getByRole('link', { name: 'Health, Connections' })).toHaveAttribute('href', '/connections');
    // The caption is the short word, the wide label is the full one.
    expect(within(links.getByRole('link', { name: 'Home, Dashboard' })).getByText('Home')).toBeInTheDocument();
    expect(within(links.getByRole('link', { name: 'Home, Dashboard' })).getByText('Dashboard')).toBeInTheDocument();
  });

  it('says who is signed in to a screen reader at every width, and has a tooltip on the icon-only sign out', () => {
    mockApi(routes());
    shell();
    expect(screen.getAllByText(/Signed in as/)[0]).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Sign out' })[0]).toHaveAttribute('title', 'Sign out');
  });

  it('marks More as the current place, for those who cannot see its colour, when the page is one of its places', () => {
    mockApi(routes());
    shell('/settings');
    expect(screen.getByRole('button', { name: 'More' })).toHaveAttribute('aria-current', 'true');
  });

  it('does not mark More as current on a page that has its own place on the dock', () => {
    mockApi(routes());
    shell('/presets');
    expect(screen.getByRole('button', { name: 'More' })).not.toHaveAttribute('aria-current');
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

  it('names pages that are not in the menu: a light, painting a pattern, connecting', async () => {
    mockApi(routes());
    const { unmount } = shell('/devices/abc');
    await waitFor(() => expect(document.title).toBe('Light · Light Manager'));
    unmount();
    shell('/patterns/new');
    await waitFor(() => expect(document.title).toBe('Paint a pattern · Light Manager'));
  });

  it('goes back to what it was when the shell goes away, so the sign-in page is not left with the last page\'s name', async () => {
    mockApi(routes());
    const { unmount } = shell('/settings');
    await waitFor(() => expect(document.title).toBe('Settings · Light Manager'));
    unmount();
    expect(document.title).toBe('Govee Light Manager');
  });
});

describe('pages that email links open', () => {
  it('draw only their card inside the shell: one page landmark, not two', async () => {
    mockApi(routes());
    shell('/privacy', <PrivacyPage />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Privacy' })).toBeInTheDocument();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(document.querySelectorAll('.ambient')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^Theme:/ })).toHaveLength(1);
  });

  it('bring their own landmark, glow and title when seen signed out', async () => {
    mockApi(routes());
    renderApp(<PrivacyPage />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Privacy' })).toBeInTheDocument();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(document.querySelectorAll('.ambient')).toHaveLength(1);
    await waitFor(() => expect(document.title).toBe('Privacy · Light Manager'));
  });
});

describe('the theme', () => {
  const deviceSays = (light: boolean) =>
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: light && query.includes('light'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));

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

  it('on Auto, follows what the device says: Day on a light device, Night on a dark one', async () => {
    deviceSays(true);
    mockApi(routes());
    const first = shell();
    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-theme', 'light'));
    first.unmount();

    deviceSays(false);
    shell();
    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-theme', 'dark'));
  });

  it('follows the device while the page is open: a change to a dark device turns Auto to Night', async () => {
    const listeners = new Set<() => void>();
    let light = true;
    vi.stubGlobal('matchMedia', (query: string) => ({
      get matches() {
        return light && query.includes('light');
      },
      media: query,
      addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
    }));
    mockApi(routes());
    shell();
    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-theme', 'light'));
    light = false;
    act(() => listeners.forEach((listener) => listener()));
    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-theme', 'dark'));
  });

  it("paints the browser's own bar to match: its theme-color follows Day and Night", async () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.append(meta);
    try {
      mockApi(routes());
      shell();
      const cycle = () => screen.getByRole('button', { name: /^Theme:/ });
      await userEvent.click(cycle()); // Day
      expect(meta.content).toBe(THEME_COLOR.light);
      await userEvent.click(cycle()); // Night
      expect(meta.content).toBe(THEME_COLOR.dark);
    } finally {
      meta.remove();
    }
  });

  it('agrees with public/theme-init.js, which sets the theme before the first paint: same key, same colours', () => {
    const script = readFileSync(join(import.meta.dirname, '../../public/theme-init.js'), 'utf8');
    expect(script).toContain(`'${THEME_STORAGE_KEY}'`);
    expect(script).toContain(`'${THEME_COLOR.light}'`);
    expect(script).toContain(`'${THEME_COLOR.dark}'`);
    for (const value of ['light', 'dark', 'auto']) expect(script).toContain(`'${value}'`);
  });

  it('a choice beats the device: Night stays Night on a light device', async () => {
    deviceSays(true);
    window.localStorage.setItem('glm.theme', 'dark');
    themeStore.reload();
    mockApi(routes());
    shell();
    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-theme', 'dark'));
  });

  it('works when storage is blocked: the choice applies, it just is not kept', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    mockApi(routes());
    shell();
    await userEvent.click(screen.getByRole('button', { name: /^Theme:/ }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
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
