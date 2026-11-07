import { Activity, CalendarClock, Layers, Lightbulb, LogOut, Settings, Sparkles, Wifi } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Button } from '../components/ui';
import { useLogout } from '../features/auth/useSession';

const NAV = [
  { to: '/', label: 'Dashboard', short: 'Home', icon: Lightbulb, end: true },
  { to: '/presets', label: 'Scenes & Presets', short: 'Presets', icon: Sparkles },
  { to: '/groups', label: 'Groups', icon: Layers },
  { to: '/schedules', label: 'Schedules', short: 'Timers', icon: CalendarClock },
  { to: '/connections', label: 'Connections', short: 'Health', icon: Wifi },
  { to: '/activity', label: 'Activity', icon: Activity },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function AppShell({ username, children }: { username: string; children: ReactNode }) {
  const logout = useLogout();

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded focus:bg-ink-800 focus:p-2"
      >
        Skip to content
      </a>

      <aside className="hidden flex-col border-r border-ink-700/70 bg-ink-900 md:sticky md:top-0 md:flex md:h-dvh">
        <div className="flex items-center gap-2 px-5 py-5">
          <Lightbulb className="size-5 text-amber-glow" aria-hidden />
          <span className="font-semibold tracking-tight">Light Manager</span>
        </div>
        <nav aria-label="Main" className="flex-1 space-y-1 px-3">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end ?? false}
              className={({ isActive }) =>
                `flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm transition-colors ${
                  isActive
                    ? 'bg-amber-wash font-medium text-amber-soft'
                    : 'text-ink-300 hover:bg-ink-800 hover:text-ink-100'
                }`
              }
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-ink-700/70 p-3">
          <p className="truncate px-2 pb-2 text-xs text-ink-400">Signed in as {username}</p>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            icon={<LogOut className="size-4" aria-hidden />}
            busy={logout.isPending}
            onClick={() => logout.mutate()}
          >
            Sign out
          </Button>
        </div>
      </aside>

      <main id="main" className="min-w-0 px-4 pt-5 pb-24 sm:px-6 md:pb-10 lg:px-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-7 border-t border-ink-700 bg-ink-900 pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {NAV.map(({ to, label, short, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end ?? false}
            aria-label={label}
            className={({ isActive }) =>
              `flex min-h-14 flex-col items-center justify-center gap-1 text-[10px] ${
                isActive ? 'text-amber-soft' : 'text-ink-300'
              }`
            }
          >
            <Icon className="size-5" aria-hidden />
            <span className="max-w-full truncate px-0.5">{short ?? label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
