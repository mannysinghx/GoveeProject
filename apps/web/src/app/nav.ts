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
