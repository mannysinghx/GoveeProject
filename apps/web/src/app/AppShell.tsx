import { Bell, Ellipsis, LogOut, Search } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import type { PresetDto } from '@glm/shared';
import { Ambient } from '../components/Ambient';
import { Brand } from '../components/Brand';
import { CommandPalette, shortcutLabel } from '../components/CommandPalette';
import { ThemeChoice, ThemeCycleButton } from '../components/ThemeToggle';
import { Button, Dialog } from '../components/ui';
import { glowColors } from '../components/light';
import { useLogout } from '../features/auth/useSession';
import { ApplyPresetDialog } from '../features/presets/ApplyPresetDialog';
import { useDevices, useNotifications } from '../lib/queries';
import { dockItems, moreItems, NAV, type NavItem } from './nav';

function UnreadCount({ count, className = '', compact = false }: { count: number; className?: string; compact?: boolean }) {
  if (count === 0) return null;
  return (
    <span
      className={`min-w-5 rounded-full bg-accent text-center font-semibold text-on-accent tabular-nums ${compact ? 'px-1 text-[11px]' : 'px-1.5 text-xs'} ${className}`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

/** One place in the desktop rail. Icons only on a narrow desktop, with names beside them when there is room. */
function RailLink({ item, unread }: { item: NavItem; unread: number }) {
  const Icon = item.icon;
  const isBell = item.to === '/notifications';
  const label = isBell && unread > 0 ? `Notifications, ${unread} unread` : item.label;
  return (
    <NavLink
      to={item.to}
      end={item.end ?? false}
      aria-label={label}
      title={item.label}
      className={({ isActive }) =>
        `group relative flex min-h-12 items-center justify-center gap-3 rounded-2xl px-3 text-sm font-medium transition-[background-color,color] duration-200 xl:justify-start ${
          isActive
            ? 'bg-accent-wash text-accent-text ring-1 ring-accent-ui/25'
            : 'text-fg-3 hover:bg-raised/70 hover:text-fg'
        }`
      }
    >
      <span className="relative">
        <Icon className="size-5 transition-transform duration-300 group-hover:scale-110" aria-hidden />
        {isBell && unread > 0 ? (
          <span aria-hidden className="absolute -top-1 -right-1 size-2.5 rounded-full bg-accent ring-2 ring-surface xl:hidden" />
        ) : null}
      </span>
      <span className="hidden xl:inline">{item.label}</span>
      {isBell ? <UnreadCount count={unread} className="ml-auto hidden xl:inline" /> : null}
    </NavLink>
  );
}

function Rail({ username, unread }: { username: string; unread: number }) {
  const logout = useLogout();
  return (
    <aside className="glass fixed top-3 bottom-3 left-3 z-30 hidden w-[4.75rem] flex-col rounded-[2rem] md:flex xl:w-64">
      <div className="flex justify-center px-3 pt-5 pb-4 xl:justify-start xl:px-5">
        <span className="xl:hidden">
          <Brand compact />
        </span>
        <span className="hidden xl:block">
          <Brand />
        </span>
      </div>
      <nav aria-label="Main" className="flex-1 space-y-1 overflow-y-auto px-2.5 xl:px-3">
        {NAV.map((item) => (
          <RailLink key={item.to} item={item} unread={unread} />
        ))}
      </nav>
      <div className="space-y-2 border-t border-line p-2.5 xl:p-3">
        <div className="flex items-center justify-center gap-3 px-1 xl:justify-start xl:px-2">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-raised text-sm font-semibold text-fg-2 uppercase"
          >
            {username.slice(0, 1) || '?'}
          </span>
          <p className="hidden min-w-0 text-xs text-fg-3 xl:block">
            Signed in as <span className="block truncate text-sm font-medium text-fg">{username}</span>
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full xl:justify-start"
          icon={<LogOut className="size-4" aria-hidden />}
          busy={logout.isPending}
          onClick={() => logout.mutate()}
        >
          <span className="sr-only xl:not-sr-only">Sign out</span>
        </Button>
      </div>
    </aside>
  );
}

/** The phone's way around: the four places used most, and one tap to the rest. */
function Dock({ moreActive, onMore }: { moreActive: boolean; onMore: () => void }) {
  const item = 'flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-[1.25rem] text-[11px] font-medium transition-colors duration-200';
  return (
    <nav
      aria-label="Main"
      className="glass fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 grid grid-cols-5 gap-1 rounded-[2rem] p-1.5 md:hidden"
    >
      {dockItems.map(({ to, label, short, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end ?? false}
          aria-label={label}
          className={({ isActive }) =>
            `${item} ${isActive ? 'bg-accent-wash text-accent-text ring-1 ring-accent-ui/25' : 'text-fg-3 active:bg-raised/70'}`
          }
        >
          <Icon className="size-5" aria-hidden />
          <span className="max-w-full truncate px-0.5">{short ?? label}</span>
        </NavLink>
      ))}
      <button
        type="button"
        aria-label="More"
        aria-haspopup="dialog"
        onClick={onMore}
        className={`${item} ${moreActive ? 'bg-accent-wash text-accent-text ring-1 ring-accent-ui/25' : 'text-fg-3 active:bg-raised/70'}`}
      >
        <Ellipsis className="size-5" aria-hidden />
        <span>More</span>
      </button>
    </nav>
  );
}

/** Everything that is not on the dock, plus appearance and signing out. */
function MoreSheet({ open, onClose, username, unread }: { open: boolean; onClose: () => void; username: string; unread: number }) {
  const logout = useLogout();
  return (
    <Dialog title="More" open={open} onClose={onClose}>
      <ul className="grid grid-cols-2 gap-3">
        {moreItems.map(({ to, label, icon: Icon }) => {
          const isBell = to === '/notifications';
          return (
            <li key={to}>
              <NavLink
                to={to}
                onClick={onClose}
                className={({ isActive }) =>
                  `flex min-h-20 flex-col items-start justify-between gap-3 rounded-3xl border p-4 text-sm font-medium transition-colors ${
                    isActive ? 'border-accent-ui/40 bg-accent-wash text-accent-text' : 'border-line bg-inset text-fg-2 active:bg-raised'
                  }`
                }
              >
                <span className="flex w-full items-start justify-between">
                  <Icon className="size-5" aria-hidden />
                  {isBell ? <UnreadCount count={unread} /> : null}
                </span>
                {label}
              </NavLink>
            </li>
          );
        })}
      </ul>
      <div className="mt-6 space-y-3">
        <p className="text-xs font-semibold tracking-[0.12em] text-fg-4 uppercase">Appearance</p>
        <ThemeChoice />
      </div>
      <div className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-4">
        <p className="min-w-0 text-sm text-fg-3">
          Signed in as <span className="font-medium text-fg">{username}</span>
        </p>
        <Button size="sm" icon={<LogOut className="size-4" aria-hidden />} busy={logout.isPending} onClick={() => logout.mutate()}>
          Sign out
        </Button>
      </div>
    </Dialog>
  );
}

export function AppShell({ username, children }: { username: string; children: ReactNode }) {
  const location = useLocation();
  const notifications = useNotifications();
  // The same list the dashboard shows, read here for the colours of the glow. Polled gently.
  const devices = useDevices(20_000);
  const unread = notifications.data?.unread ?? 0;
  const bellLabel = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';

  const [moreOpen, setMoreOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [applying, setApplying] = useState<PresetDto | null>(null);

  // Ctrl+K or Command+K from anywhere, and / when no field has focus.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.matches('input, textarea, select, [contenteditable="true"]') ?? false;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onMoreRoute = moreItems.some((item) => location.pathname.startsWith(item.to));

  // The tab title says where you are, for the tab strip, the history and screen readers.
  const here = NAV.find((item) => (item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)));
  useEffect(() => {
    document.title = here && here.to !== '/' ? `${here.label} · Light Manager` : 'Light Manager';
  }, [here]);

  return (
    <div className="min-h-dvh md:pl-24 xl:pl-[17.5rem]">
      <Ambient colors={devices.data ? glowColors(devices.data) : []} />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-full focus:bg-surface focus:px-4 focus:py-2"
      >
        Skip to content
      </a>

      <Rail username={username} unread={unread} />

      <header className="sticky top-0 z-30 flex items-center gap-3 bg-linear-to-b from-canvas via-canvas/85 to-transparent px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-4 sm:px-6 lg:px-8">
        <span className="md:hidden">
          <Brand />
        </span>
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          aria-label="Search pages, scenes and actions"
          className="glass hidden min-h-11 w-full max-w-md items-center gap-3 rounded-full px-4 text-sm text-fg-4 transition-colors hover:text-fg-2 md:flex"
        >
          <Search className="size-4" aria-hidden />
          <span className="flex-1 text-left">Search or jump to…</span>
          <kbd className="rounded-lg border border-line-strong px-1.5 py-0.5 text-[11px]">{shortcutLabel()}</kbd>
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Search pages, scenes and actions"
            className="flex size-11 items-center justify-center rounded-full border border-line bg-surface/70 text-fg-2 backdrop-blur-md md:hidden"
          >
            <Search className="size-5" aria-hidden />
          </button>
          <ThemeCycleButton />
          {/* The dock is full on a phone, so the bell has its own place. */}
          <NavLink
            to="/notifications"
            aria-label={bellLabel}
            className="relative flex size-11 items-center justify-center rounded-full border border-line bg-surface/70 text-fg-2 backdrop-blur-md md:hidden"
          >
            <Bell className="size-5" aria-hidden />
            {unread > 0 ? (
              <UnreadCount count={unread} compact className="absolute -top-1 -right-1" />
            ) : null}
          </NavLink>
        </div>
      </header>

      <main id="main" className="min-w-0 px-4 pt-2 pb-36 sm:px-6 md:pb-14 lg:px-8">
        <div key={location.pathname} className="mx-auto max-w-6xl animate-rise">
          {children}
        </div>
      </main>

      <Dock moreActive={onMoreRoute} onMore={() => setMoreOpen(true)} />
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} username={username} unread={unread} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onApplyPreset={setApplying} />
      {applying ? <ApplyPresetDialog preset={applying} onClose={() => setApplying(null)} /> : null}
    </div>
  );
}
