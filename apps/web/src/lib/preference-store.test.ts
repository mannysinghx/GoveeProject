import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPreferenceStore, usePreference } from './preference-store';

const VALUES = ['a', 'b', 'c'] as const;
let n = 0;
/** A store of its own for each test, so none can see another's remembered choice. */
const freshStore = () => createPreferenceStore<(typeof VALUES)[number]>(`test.pref.${n++}`, VALUES, 'a');

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('a choice kept in the browser', () => {
  it('starts as its default, and remembers what is written', () => {
    const store = freshStore();
    expect(store.read()).toBe('a');
    store.write('b');
    expect(store.read()).toBe('b');
    expect(window.localStorage.getItem(store.key)).toBe('b');
  });

  it('reads a stored choice that is one of the allowed ones', () => {
    window.localStorage.setItem('test.pref.fixed', 'c');
    expect(createPreferenceStore('test.pref.fixed', VALUES, 'a').read()).toBe('c');
  });

  it('ignores a stored value that is not allowed, such as one left by another version', () => {
    window.localStorage.setItem('test.pref.odd', 'purple');
    expect(createPreferenceStore('test.pref.odd', VALUES, 'a').read()).toBe('a');
  });

  it('falls back to its default when storage cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(freshStore().read()).toBe('a');
  });

  it('keeps the choice for this visit when storage cannot be written', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const store = freshStore();
    expect(() => store.write('b')).not.toThrow();
    expect(store.read()).toBe('b');
  });

  it('tells everyone who is watching when it changes, and stops when they stop', () => {
    const store = freshStore();
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    store.write('b');
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    store.write('c');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('follows another tab: a storage event for its key reads the new value', () => {
    const store = freshStore();
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    expect(store.read()).toBe('a');
    window.localStorage.setItem(store.key, 'c');
    window.dispatchEvent(new StorageEvent('storage', { key: store.key }));
    expect(store.read()).toBe('c');
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it('ignores storage events about other keys, and goes back to its default when storage is cleared', () => {
    const store = freshStore();
    const stop = store.subscribe(() => {});
    store.write('b');
    window.dispatchEvent(new StorageEvent('storage', { key: 'something.else' }));
    expect(store.read()).toBe('b');
    window.localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(store.read()).toBe('a');
    stop();
  });

  it('keeps every component that shows it in step', () => {
    const store = freshStore();
    const first = renderHook(() => usePreference(store, 'a'));
    const second = renderHook(() => usePreference(store, 'a'));
    act(() => first.result.current[1]('c'));
    expect(second.result.current[0]).toBe('c');
  });
});
