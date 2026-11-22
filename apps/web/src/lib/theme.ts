import { useEffect, useSyncExternalStore } from 'react';
import { createPreferenceStore, usePreference } from './preference-store';

/**
 * Night and Day, or whichever the device is using. The choice is a per-browser convenience, kept
 * in local storage. public/theme-init.js applies the same choice before the first paint, so the
 * storage key and the colours below must stay in step with it.
 */
export type ThemePreference = 'auto' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const THEME_COLOR: Record<ResolvedTheme, string> = { dark: '#0a0a14', light: '#f5f2ec' };

export const THEME_VALUES = ['auto', 'light', 'dark'] as const;
const themeStore = createPreferenceStore<ThemePreference>('glm.theme', THEME_VALUES, 'auto');

export function resolveTheme(preference: ThemePreference, deviceIsLight: boolean): ResolvedTheme {
  if (preference === 'auto') return deviceIsLight ? 'light' : 'dark';
  return preference;
}

/** Paints the chosen theme on the page and on the browser's own chrome. */
export function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
}

const lightQuery = () => (typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: light)') : null);

function subscribeDevice(listener: () => void): () => void {
  const query = lightQuery();
  query?.addEventListener('change', listener);
  return () => query?.removeEventListener('change', listener);
}

const deviceIsLight = () => lightQuery()?.matches ?? false;

export function useTheme(): {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
} {
  const [preference, setPreference] = usePreference(themeStore, 'auto');
  const light = useSyncExternalStore(subscribeDevice, deviceIsLight, () => false);
  const resolved = resolveTheme(preference, light);

  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  return { preference, resolved, setPreference };
}

/** What colours the glow behind the app: the lights themselves, a steady warm tone, or nothing. */
export type GlowPreference = 'lights' | 'warm' | 'off';
export const GLOW_VALUES = ['lights', 'warm', 'off'] as const;
const glowStore = createPreferenceStore<GlowPreference>('glm.glow', GLOW_VALUES, 'lights');

export function useGlowPreference(): [GlowPreference, (next: GlowPreference) => void] {
  return usePreference(glowStore, 'lights');
}
