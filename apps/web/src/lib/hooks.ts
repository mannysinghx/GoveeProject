import { useEffect, useRef, useState } from 'react';

/** Runs a callback on an interval, but only while this browser tab is visible. */
export function useVisibleInterval(callback: () => void, delayMs: number | null): void {
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delayMs === null) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') latest.current();
    }, delayMs);
    return () => window.clearInterval(timer);
  }, [delayMs]);
}

/** Holds a value until it has stopped changing for delayMs. Keeps previews from firing per keystroke. */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

const RECENT_COLORS_KEY = 'glm.recentColors';
const MAX_RECENT_COLORS = 10;

/**
 * A per-browser convenience. Storage can be blocked or empty, so every access is
 * guarded and the feature simply starts empty in that case.
 */
export function readRecentColors(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_COLORS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === 'string').slice(0, MAX_RECENT_COLORS) : [];
  } catch {
    return [];
  }
}

export function addRecentColor(hex: string): string[] {
  const next = [hex.toLowerCase(), ...readRecentColors().filter((c) => c !== hex.toLowerCase())].slice(0, MAX_RECENT_COLORS);
  try {
    window.localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(next));
  } catch {
    // Not stored. The in-page list still works for this visit.
  }
  return next;
}
