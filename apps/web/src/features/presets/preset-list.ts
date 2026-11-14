import { BUILTIN_PRESETS, type PresetDto } from '@glm/shared';

export type PresetSort = 'calendar' | 'name' | 'name-desc' | 'newest' | 'changed';
export type PresetKind = 'all' | 'pattern' | 'effect';

export const PRESET_SORTS: { value: PresetSort; label: string }[] = [
  { value: 'calendar', label: 'Calendar order' },
  { value: 'name', label: 'Name, A to Z' },
  { value: 'name-desc', label: 'Name, Z to A' },
  { value: 'newest', label: 'Newest first' },
  { value: 'changed', label: 'Recently changed' },
];

/** Lower case with accents removed, so "dia de muertos" finds "Día de Muertos". */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Everything about a preset that a person might type to find it. */
function searchText(preset: PresetDto): string {
  return fold(
    [
      preset.name,
      preset.description,
      preset.builtin?.occasion,
      preset.builtin?.when,
      preset.builtin?.today?.name,
      ...preset.actions.map((a) => a.deviceName),
      ...preset.actions.flatMap((a) => (a.action.type === 'scene' ? [a.action.sceneName] : [])),
    ]
      .filter(Boolean)
      .join(' '),
  );
}

export function usesEffect(preset: PresetDto): boolean {
  return preset.actions.some((a) => a.action.type === 'scene');
}

/** Every word typed must appear somewhere, in any order. An empty search matches everything. */
export function matchesSearch(preset: PresetDto, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = searchText(preset);
  return words.every((word) => text.includes(word));
}

export function matchesKind(preset: PresetDto, kind: PresetKind): boolean {
  if (kind === 'all') return true;
  return usesEffect(preset) === (kind === 'effect');
}

const byName = (a: PresetDto, b: PresetDto) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });

/**
 * Where a built-in preset sits in the calendar: first by where its occasion starts in the
 * catalog, then by its own place. Looks added to an occasion later sit with that occasion,
 * not at the end. Presets that are not built in come last.
 */
function calendarIndex(preset: PresetDto): [number, number] {
  const own = BUILTIN_PRESETS.findIndex((b) => b.key === preset.builtin?.key);
  if (own < 0) return [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
  const occasion = BUILTIN_PRESETS.findIndex((b) => b.occasion === BUILTIN_PRESETS[own]?.occasion);
  return [occasion, own];
}

/** A sorted copy. Presets the owner made have no place in the calendar, so there they go by name. */
export function sortPresets(presets: readonly PresetDto[], sort: PresetSort): PresetDto[] {
  const list = [...presets];
  switch (sort) {
    case 'calendar':
      return list
        .map((preset) => ({ preset, at: calendarIndex(preset) }))
        .sort((a, b) => a.at[0] - b.at[0] || a.at[1] - b.at[1] || byName(a.preset, b.preset))
        .map(({ preset }) => preset);
    case 'name':
      return list.sort(byName);
    case 'name-desc':
      return list.sort((a, b) => byName(b, a));
    case 'newest':
      return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || byName(a, b));
    case 'changed':
      return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || byName(a, b));
  }
}

export interface PresetFilter {
  query: string;
  sort: PresetSort;
  kind: PresetKind;
}

export const NO_FILTER: PresetFilter = { query: '', sort: 'calendar', kind: 'all' };

export function isFiltering(filter: PresetFilter): boolean {
  return filter.query.trim() !== '' || filter.kind !== 'all';
}

export function filterAndSort(presets: readonly PresetDto[], filter: PresetFilter): PresetDto[] {
  return sortPresets(
    presets.filter((p) => matchesSearch(p, filter.query) && matchesKind(p, filter.kind)),
    filter.sort,
  );
}
