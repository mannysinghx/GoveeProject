import { useCallback, useSyncExternalStore } from 'react';

/**
 * A choice kept in this browser only, such as the theme. Storage can be blocked or empty, so every
 * access is guarded and the choice falls back to its default. Several components can show the same
 * choice and stay in step, including across browser tabs.
 */
export interface PreferenceStore<T extends string> {
  key: string;
  read: () => T;
  write: (next: T) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createPreferenceStore<T extends string>(key: string, allowed: readonly T[], fallback: T): PreferenceStore<T> {
  const listeners = new Set<() => void>();
  let current: T | null = null;

  const isAllowed = (value: unknown): value is T => typeof value === 'string' && (allowed as readonly string[]).includes(value);

  const readStored = (): T => {
    try {
      const stored = window.localStorage.getItem(key);
      return isAllowed(stored) ? stored : fallback;
    } catch {
      return fallback;
    }
  };

  return {
    key,
    read: () => (current ??= readStored()),
    write: (next) => {
      current = next;
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // Not stored. The choice still applies until the page is closed.
      }
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      const onStorage = (event: StorageEvent) => {
        // Another tab changed it.
        if (event.key === key) {
          current = readStored();
          listener();
        }
      };
      window.addEventListener('storage', onStorage);
      return () => {
        listeners.delete(listener);
        window.removeEventListener('storage', onStorage);
      };
    },
  };
}

export function usePreference<T extends string>(store: PreferenceStore<T>, fallback: T): [T, (next: T) => void] {
  const value = useSyncExternalStore(store.subscribe, store.read, () => fallback);
  const set = useCallback((next: T) => store.write(next), [store]);
  return [value, set];
}
