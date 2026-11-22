import {
  Activity,
  Bell,
  CalendarClock,
  Layers,
  House,
  Settings,
  Share2,
  Sparkles,
  Wifi,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  /** The full name, used by screen readers and the command palette. */
  label: string;
  /** A shorter name for places with little room. */
  short?: string;
  icon: LucideIcon;
  end?: boolean;
  /** Extra words that should find it in the command palette. */
  keywords?: string;
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', short: 'Home', icon: House, end: true, keywords: 'home lights devices overview' },
  { to: '/presets', label: 'Scenes & Presets', short: 'Scenes', icon: Sparkles, keywords: 'festival patterns colours colors christmas halloween paint' },
  { to: '/groups', label: 'Groups', icon: Layers, keywords: 'areas rooms strings' },
  { to: '/schedules', label: 'Schedules', short: 'Timers', icon: CalendarClock, keywords: 'timers holidays calendar automation' },
  { to: '/shared', label: 'Shared', icon: Share2, keywords: 'share import friends designs' },
  { to: '/connections', label: 'Connections', short: 'Health', icon: Wifi, keywords: 'health offline wifi problems diagnose' },
  { to: '/activity', label: 'Activity', icon: Activity, keywords: 'history log commands' },
  { to: '/notifications', label: 'Notifications', icon: Bell, keywords: 'alerts bell push' },
  { to: '/settings', label: 'Settings', icon: Settings, keywords: 'account keys password email appearance theme' },
];

/** Where the phone dock goes directly. Everything else is one tap away under More. */
export const DOCK_PATHS = ['/', '/presets', '/groups', '/schedules'];

export const dockItems = NAV.filter((item) => DOCK_PATHS.includes(item.to));
export const moreItems = NAV.filter((item) => !DOCK_PATHS.includes(item.to));

/** Pages reached from inside other pages or from an email, which have no place in the menu but still need a tab title. */
const OTHER_TITLES: [prefix: string, title: string][] = [
  ['/connect', 'Connect to Govee'],
  ['/devices/', 'Light'],
  ['/patterns/check', 'Check my lights'],
  ['/patterns/', 'Paint a pattern'],
  ['/privacy', 'Privacy'],
  ['/terms', 'Terms'],
  ['/verify', 'Verify your email'],
  ['/reset', 'Choose a new password'],
  ['/confirm-email', 'Confirm your sign-in address'],
];

/** The name of the page at an address, for the tab title. Null for the dashboard, which is the app itself. */
export function pageTitle(pathname: string): string | null {
  const item = NAV.find((entry) => (entry.end ? pathname === entry.to : pathname.startsWith(entry.to)));
  if (item) return item.to === '/' ? null : item.label;
  return OTHER_TITLES.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? null;
}
