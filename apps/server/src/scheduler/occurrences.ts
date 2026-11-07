import type { NextRunDto, OccurrenceNote, Recurrence, SchedulePreviewDto } from '@glm/shared';
import { DateTime } from 'luxon';
import { getTimes } from 'suncalc';

/**
 * Turns a recurrence and an IANA zone into exact instants.
 *
 * Daylight-saving policy (also in docs/architecture.md and the schedule screen):
 *  - Spring forward: a wall-clock time that does not exist moves forward by the
 *    size of the gap. 02:30 on a day where 02:00 jumps to 03:00 runs at 03:30.
 *  - Fall back: a wall-clock time that happens twice runs once, at the first
 *    (earlier) instant. The occurrence key holds the wall-clock time rather than
 *    the instant, so the repeated hour cannot produce a second run.
 */

export interface Occurrence {
  /** Durable identity. The same occurrence always has the same key. */
  key: string;
  at: DateTime;
  localDate: string;
  note: OccurrenceNote | null;
}

/** How far ahead to search for the next run before concluding there is none. */
const SEARCH_LIMIT_DAYS = 800;

function zoneOrThrow(dt: DateTime, zone: string): DateTime {
  if (!dt.isValid) throw new RangeError(`Invalid date or time zone: ${zone}`);
  return dt;
}

/** Applies the daylight-saving policy to one wall-clock time. */
export function resolveLocalTime(
  date: string,
  time: string,
  zone: string,
): { at: DateTime; note: OccurrenceNote | null } {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  const dt = zoneOrThrow(DateTime.fromObject({ year, month, day, hour, minute }, { zone }), zone);

  // Luxon pushes a nonexistent time forward by the size of the gap, which is the
  // documented policy. Detect it so the schedule can say so.
  if (dt.hour !== hour || dt.minute !== minute) {
    return { at: dt.toUTC(), note: 'dst_gap_moved_forward' };
  }
  // Luxon does not promise which instant an ambiguous time resolves to, so choose explicitly.
  const possible = dt.getPossibleOffsets();
  if (possible.length > 1) {
    const earliest = possible.reduce((a, b) => (a.toMillis() <= b.toMillis() ? a : b));
    return { at: earliest.toUTC(), note: 'dst_repeated_time_first_used' };
  }
  return { at: dt.toUTC(), note: null };
}

function withinBounds(date: string, startDate: string | undefined, endDate: string | undefined): boolean {
  if (startDate && date < startDate) return false;
  if (endDate && date > endDate) return false;
  return true;
}

function weekdayOf(date: string, zone: string): number {
  return DateTime.fromISO(date, { zone }).weekday;
}

/** The occurrence on a local date, or null if the recurrence has none that day. */
export function occurrenceOnDate(recurrence: Recurrence, zone: string, date: string): Occurrence | null {
  switch (recurrence.kind) {
    case 'once': {
      if (date !== recurrence.date) return null;
      const { at, note } = resolveLocalTime(date, recurrence.time, zone);
      return { key: `once:${date}T${recurrence.time}`, at, localDate: date, note };
    }
    case 'daily': {
      if (!withinBounds(date, recurrence.startDate, recurrence.endDate)) return null;
      const { at, note } = resolveLocalTime(date, recurrence.time, zone);
      return { key: `${date}T${recurrence.time}`, at, localDate: date, note };
    }
    case 'weekly': {
      if (!withinBounds(date, recurrence.startDate, recurrence.endDate)) return null;
      if (!recurrence.weekdays.includes(weekdayOf(date, zone))) return null;
      const { at, note } = resolveLocalTime(date, recurrence.time, zone);
      return { key: `${date}T${recurrence.time}`, at, localDate: date, note };
    }
    case 'solar': {
      if (!withinBounds(date, recurrence.startDate, recurrence.endDate)) return null;
      if (recurrence.weekdays && !recurrence.weekdays.includes(weekdayOf(date, zone))) return null;
      const instant = solarEvent(recurrence, zone, date);
      if (!instant) return null;
      return {
        key: `${date}:${recurrence.event}:${recurrence.offsetMinutes}`,
        at: instant,
        localDate: date,
        note: null,
      };
    }
  }
}

/** Calculated locally by suncalc. Null when the sun does not rise or set that day. */
function solarEvent(recurrence: Extract<Recurrence, { kind: 'solar' }>, zone: string, date: string): DateTime | null {
  const noon = zoneOrThrow(DateTime.fromISO(`${date}T12:00:00`, { zone }), zone);
  const times = getTimes(noon.toJSDate(), recurrence.latitude, recurrence.longitude, 0, noon.offset);
  const event = times[recurrence.event];
  if (!(event instanceof Date) || Number.isNaN(event.getTime())) return null;
  return DateTime.fromJSDate(event, { zone: 'utc' }).plus({ minutes: recurrence.offsetMinutes });
}

function solarEventMissing(recurrence: Recurrence, zone: string, date: string): boolean {
  if (recurrence.kind !== 'solar') return false;
  if (!withinBounds(date, recurrence.startDate, recurrence.endDate)) return false;
  if (recurrence.weekdays && !recurrence.weekdays.includes(weekdayOf(date, zone))) return false;
  return solarEvent(recurrence, zone, date) === null;
}

function lastPossibleDate(recurrence: Recurrence): string | null {
  if (recurrence.kind === 'once') return recurrence.date;
  return recurrence.endDate ?? null;
}

function firstPossibleDate(recurrence: Recurrence): string | null {
  if (recurrence.kind === 'once') return recurrence.date;
  return recurrence.startDate ?? null;
}

/**
 * Walks local dates forward. It starts a day early because a moved time or a solar
 * offset can put an occurrence on the far side of a date boundary.
 */
function* walkOccurrences(recurrence: Recurrence, zone: string, afterMs: number): Generator<Occurrence> {
  let cursor = zoneOrThrow(DateTime.fromMillis(afterMs, { zone }), zone).startOf('day').minus({ days: 1 });
  const first = firstPossibleDate(recurrence);
  if (first && cursor.toISODate()! < first) {
    cursor = DateTime.fromISO(first, { zone });
  }
  const last = lastPossibleDate(recurrence);

  for (let i = 0; i < SEARCH_LIMIT_DAYS; i++) {
    const date = cursor.toISODate()!;
    if (last && date > last) return;
    const occurrence = occurrenceOnDate(recurrence, zone, date);
    if (occurrence && occurrence.at.toMillis() > afterMs) yield occurrence;
    cursor = cursor.plus({ days: 1 });
  }
}

export function nextOccurrence(recurrence: Recurrence, zone: string, afterMs: number): Occurrence | null {
  const { value } = walkOccurrences(recurrence, zone, afterMs).next();
  return value ?? null;
}

/**
 * Occurrences in (fromMs, toMs], oldest first. With more than the cap, only the
 * newest are returned and truncated is set: a long outage should not write a
 * history row for every run it covered.
 */
export function occurrencesBetween(
  recurrence: Recurrence,
  zone: string,
  fromMs: number,
  toMs: number,
  cap: number,
): { occurrences: Occurrence[]; truncated: boolean } {
  const out: Occurrence[] = [];
  let truncated = false;
  for (const occurrence of walkOccurrences(recurrence, zone, fromMs)) {
    if (occurrence.at.toMillis() > toMs) break;
    out.push(occurrence);
    if (out.length > cap) {
      out.shift();
      truncated = true;
    }
  }
  return { occurrences: out, truncated };
}

export function formatLocal(at: DateTime, zone: string): string {
  return at.setZone(zone).toFormat('yyyy-MM-dd HH:mm ZZZZ');
}

export function toNextRunDto(occurrence: Occurrence, zone: string): NextRunDto {
  return {
    at: occurrence.at.toUTC().toISO()!,
    local: formatLocal(occurrence.at, zone),
    note: occurrence.note,
  };
}

/** Upcoming runs for the schedule screen, and any dates with no sunrise or sunset. */
export function previewSchedule(
  recurrence: Recurrence,
  zone: string,
  afterMs: number,
  count: number,
): SchedulePreviewDto {
  const nextRuns: NextRunDto[] = [];
  const generator = walkOccurrences(recurrence, zone, afterMs);
  for (let i = 0; i < count; i++) {
    const { value, done } = generator.next();
    if (done || !value) break;
    nextRuns.push(toNextRunDto(value, zone));
  }

  const datesWithoutSolarEvent: string[] = [];
  if (recurrence.kind === 'solar') {
    let cursor = DateTime.fromMillis(afterMs, { zone }).startOf('day');
    const horizon = nextRuns.at(-1)
      ? DateTime.fromISO(nextRuns.at(-1)!.at).setZone(zone).startOf('day')
      : cursor.plus({ days: 30 });
    while (cursor <= horizon && datesWithoutSolarEvent.length < 30) {
      const date = cursor.toISODate()!;
      if (solarEventMissing(recurrence, zone, date)) datesWithoutSolarEvent.push(date);
      cursor = cursor.plus({ days: 1 });
    }
  }

  let warning: string | null = null;
  if (nextRuns.length === 0) {
    warning =
      recurrence.kind === 'solar'
        ? `No ${recurrence.event} is expected in the coming ${SEARCH_LIMIT_DAYS} days within these dates at this location.`
        : 'This schedule has no future runs with these settings.';
  } else if (datesWithoutSolarEvent.length > 0) {
    warning = `The sun does not ${recurrence.kind === 'solar' && recurrence.event === 'sunset' ? 'set' : 'rise'} on ${datesWithoutSolarEvent.length} upcoming date(s). Those dates are skipped.`;
  }
  return { nextRuns, datesWithoutSolarEvent, warning };
}
