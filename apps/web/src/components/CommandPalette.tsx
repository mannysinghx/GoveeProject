import { CornerDownLeft, LogOut, Moon, RefreshCw, Search, Sparkles, Sun, SunMoon, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PresetDto } from '@glm/shared';
import { NAV } from '../app/nav';
import { useLogout } from '../features/auth/useSession';
import { usePresets, useRefreshAll } from '../lib/queries';
import { useTheme } from '../lib/theme';
import { useBackdropClose, useNativeDialog } from './ui';

interface Item {
  id: string;
  group: 'Go to' | 'Scenes' | 'Actions';
  label: string;
  detail?: string;
  icon: LucideIcon;
  /** Extra words that should find it. */
  keywords?: string;
  run: () => void;
}

/** Every word typed must appear somewhere in the item, in any order. */
function matches(item: Item, query: string): boolean {
  const haystack = `${item.label} ${item.detail ?? ''} ${item.keywords ?? ''}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

const GROUPS: Item['group'][] = ['Go to', 'Scenes', 'Actions'];
const SCENES_WITHOUT_A_SEARCH = 5;

/** The shortcut to show, for the platform the person is on. */
export function shortcutLabel(): string {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
  return mac ? '⌘K' : 'Ctrl K';
}

/**
 * Jump anywhere, apply a scene or run an action from the keyboard: press Ctrl+K or Command+K, or
 * press / when no field is focused. It is a second way to do things that all have buttons, so
 * nothing depends on it. On a phone it opens from the search button at the top.
 */
export function CommandPalette({
  open,
  onClose,
  onApplyPreset,
}: {
  open: boolean;
  onClose: () => void;
  onApplyPreset: (preset: PresetDto) => void;
}) {
  const ref = useNativeDialog(open);
  const backdrop = useBackdropClose(ref, onClose);
  const navigate = useNavigate();
  const logout = useLogout();
  const checkAll = useRefreshAll();
  const presets = usePresets();
  const { setPreference } = useTheme();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const optionRefs = useRef(new Map<string, HTMLLIElement>());
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo<Item[]>(() => {
    const go: Item[] = NAV.map((nav) => ({
      id: `go:${nav.to}`,
      group: 'Go to',
      label: nav.label,
      icon: nav.icon,
      ...(nav.keywords ? { keywords: nav.keywords } : {}),
      run: () => navigate(nav.to),
    }));
    const scenes: Item[] = (presets.data ?? []).map((preset) => ({
      id: `scene:${preset.id}`,
      group: 'Scenes',
      label: preset.name,
      detail: preset.builtin ? preset.builtin.occasion : 'Your preset',
      icon: Sparkles,
      keywords: `apply ${preset.description} ${preset.builtin?.when ?? ''}`,
      run: () => onApplyPreset(preset),
    }));
    const actions: Item[] = [
      { id: 'act:check', group: 'Actions', label: 'Check lights now', icon: RefreshCw, keywords: 'refresh status online', run: () => { checkAll.mutate(); navigate('/'); } },
      { id: 'act:night', group: 'Actions', label: 'Theme: Night', icon: Moon, keywords: 'dark appearance', run: () => setPreference('dark') },
      { id: 'act:day', group: 'Actions', label: 'Theme: Day', icon: Sun, keywords: 'light appearance', run: () => setPreference('light') },
      { id: 'act:auto', group: 'Actions', label: 'Theme: match this device', icon: SunMoon, keywords: 'auto appearance system', run: () => setPreference('auto') },
      { id: 'act:out', group: 'Actions', label: 'Sign out', icon: LogOut, keywords: 'log out leave', run: () => logout.mutate() },
    ];
    return [...go, ...scenes, ...actions];
    // The mutations are stable enough for a list that is rebuilt whenever the palette opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presets.data, navigate, onApplyPreset, setPreference]);

  const searching = query.trim().length > 0;
  const results = useMemo(() => {
    if (searching) return items.filter((item) => matches(item, query)).slice(0, 40);
    // With nothing typed, offer pages and actions, and only a taste of the scenes.
    let scenes = 0;
    return items.filter((item) => item.group !== 'Scenes' || ++scenes <= SCENES_WITHOUT_A_SEARCH);
  }, [items, query, searching]);

  const choose = (item: Item) => {
    onClose();
    item.run();
  };

  // A fresh palette every time it opens, ready to type into.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      inputRef.current?.focus();
    }
  }, [open]);

  // Keep the highlighted result in view when moving with the arrow keys.
  const activeItem = results[Math.min(active, results.length - 1)];
  useEffect(() => {
    if (activeItem) optionRefs.current.get(activeItem.id)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeItem]);

  if (!open) return null;

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (results.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => (index + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActive(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActive(results.length - 1);
    } else if (event.key === 'Enter' && activeItem) {
      event.preventDefault();
      choose(activeItem);
    }
  };

  const optionId = (item: Item) => `${listId}-${item.id}`;
  let sections: ReactNode = null;
  if (results.length > 0) {
    sections = GROUPS.map((group) => {
      const inGroup = results.filter((item) => item.group === group);
      if (inGroup.length === 0) return null;
      return (
        <li key={group} role="presentation">
          <p className="px-4 pt-3 pb-1 text-xs font-semibold tracking-[0.12em] text-fg-4 uppercase">{group}</p>
          <ul role="group" aria-label={group}>
            {inGroup.map((item) => {
              const isActive = item === activeItem;
              const Icon = item.icon;
              return (
                <li
                  key={item.id}
                  id={optionId(item)}
                  role="option"
                  aria-selected={isActive}
                  ref={(node) => {
                    if (node) optionRefs.current.set(item.id, node);
                    else optionRefs.current.delete(item.id);
                  }}
                  onMouseMove={() => setActive(results.indexOf(item))}
                  onClick={() => choose(item)}
                  className={`mx-2 flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl px-3 text-sm transition-colors ${
                    isActive ? 'bg-accent-wash text-accent-text ring-1 ring-accent-ui/30' : 'text-fg-2'
                  }`}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.detail ? <span className="shrink-0 text-xs text-fg-4">{item.detail}</span> : null}
                  {isActive ? <CornerDownLeft className="size-3.5 shrink-0 text-fg-4" aria-hidden /> : null}
                </li>
              );
            })}
          </ul>
        </li>
      );
    });
  }

  return (
    <dialog
      ref={ref}
      aria-label="Search and commands"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      {...backdrop}
      className="glass fixed inset-x-0 top-[max(1rem,env(safe-area-inset-top))] bottom-auto m-0 mx-auto w-[calc(100vw-1.5rem)] max-w-xl animate-pop overflow-hidden rounded-[1.75rem] p-0 text-fg sm:top-[12vh]"
    >
      <div className="flex items-center gap-3 border-b border-line px-5">
        <Search className="size-5 shrink-0 text-fg-4" aria-hidden />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          {...(activeItem ? { 'aria-activedescendant': optionId(activeItem) } : {})}
          aria-label="Search pages, scenes and actions"
          placeholder="Search pages, scenes and actions"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="min-h-14 w-full bg-transparent text-base text-fg placeholder:text-fg-4 focus:outline-none"
        />
        <kbd className="hidden shrink-0 rounded-lg border border-line-strong px-1.5 py-0.5 text-[11px] text-fg-4 sm:block">esc</kbd>
      </div>
      <ul id={listId} role="listbox" aria-label="Results" className="max-h-[min(24rem,60dvh)] overflow-y-auto overscroll-contain pb-2">
        {sections}
      </ul>
      {results.length === 0 ? <p className="px-5 py-8 text-center text-sm text-fg-3">Nothing matches “{query}”.</p> : null}
      <p role="status" className="sr-only">
        {results.length} result{results.length === 1 ? '' : 's'}
      </p>
    </dialog>
  );
}
