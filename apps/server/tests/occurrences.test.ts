import { describe, expect, it } from 'vitest';
import type { Recurrence } from '@glm/shared';
import {
  nextOccurrence,
  occurrencesBetween,
  previewSchedule,
  resolveLocalTime,
} from '../src/scheduler/occurrences.js';

const NY = 'America/New_York';
const ms = (iso: string) => Date.parse(iso);

describe('time zones', () => {
  it('runs at the wall-clock time in the schedule zone, not UTC', () => {
    const daily: Recurrence = { kind: 'daily', time: '18:30' };
    const nyNext = nextOccurrence(daily, NY, ms('2026-06-15T12:00:00Z'));
    expect(nyNext?.at.toISO()).toBe('2026-06-15T22:30:00.000Z'); // EDT is UTC-4.
    const tokyoNext = nextOccurrence(daily, 'Asia/Tokyo', ms('2026-06-15T12:00:00Z'));
    expect(tokyoNext?.at.toISO()).toBe('2026-06-16T09:30:00.000Z'); // JST is UTC+9.
  });

  it('keeps the same wall-clock time when the UTC offset changes through the year', () => {
    const daily: Recurrence = { kind: 'daily', time: '18:00' };
    expect(nextOccurrence(daily, NY, ms('2026-07-01T12:00:00Z'))?.at.toISO()).toBe('2026-07-01T22:00:00.000Z');
    expect(nextOccurrence(daily, NY, ms('2026-12-01T12:00:00Z'))?.at.toISO()).toBe('2026-12-01T23:00:00.000Z');
  });
});

describe('daylight saving: spring forward', () => {
  // In 2026, New York jumps from 02:00 to 03:00 on 8 March.
  it('moves a nonexistent time forward by the size of the gap, and says so', () => {
    const { at, note } = resolveLocalTime('2026-03-08', '02:30', NY);
    expect(at.setZone(NY).toFormat('HH:mm')).toBe('03:30');
    expect(at.toISO()).toBe('2026-03-08T07:30:00.000Z');
    expect(note).toBe('dst_gap_moved_forward');
  });

  it('leaves times outside the gap alone', () => {
    expect(resolveLocalTime('2026-03-08', '01:59', NY).note).toBeNull();
    expect(resolveLocalTime('2026-03-08', '03:00', NY).note).toBeNull();
    expect(resolveLocalTime('2026-03-09', '02:30', NY).note).toBeNull();
  });

  it('runs exactly once on the transition day and returns to normal the next', () => {
    const daily: Recurrence = { kind: 'daily', time: '02:30' };
    const { occurrences } = occurrencesBetween(daily, NY, ms('2026-03-07T12:00:00Z'), ms('2026-03-09T12:00:00Z'), 10);
    expect(occurrences.map((o) => o.key)).toEqual(['2026-03-08T02:30', '2026-03-09T02:30']);
    expect(occurrences[0]?.at.toISO()).toBe('2026-03-08T07:30:00.000Z');
    expect(occurrences[1]?.at.toISO()).toBe('2026-03-09T06:30:00.000Z');
  });

  it('handles a 30 minute gap (Lord Howe Island)', () => {
    // Lord Howe jumps from 02:00 to 02:30 on the first Sunday of October.
    const { at, note } = resolveLocalTime('2026-10-04', '02:15', 'Australia/Lord_Howe');
    expect(at.setZone('Australia/Lord_Howe').toFormat('HH:mm')).toBe('02:45');
    expect(note).toBe('dst_gap_moved_forward');
  });
});

describe('daylight saving: fall back', () => {
  // In 2026, New York repeats 01:00 to 02:00 on 1 November.
  it('uses the first of the two instants', () => {
    const { at, note } = resolveLocalTime('2026-11-01', '01:30', NY);
    expect(at.toISO()).toBe('2026-11-01T05:30:00.000Z'); // 01:30 EDT, not 01:30 EST (06:30Z).
    expect(note).toBe('dst_repeated_time_first_used');
  });

  it('runs once, even across both copies of the repeated hour', () => {
    const daily: Recurrence = { kind: 'daily', time: '01:30' };
    const { occurrences } = occurrencesBetween(daily, NY, ms('2026-11-01T00:00:00Z'), ms('2026-11-01T12:00:00Z'), 10);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]?.key).toBe('2026-11-01T01:30');
  });

  it('does not offer a second run between the two instants', () => {
    const daily: Recurrence = { kind: 'daily', time: '01:30' };
    const next = nextOccurrence(daily, NY, ms('2026-11-01T05:30:00Z'));
    expect(next?.key).toBe('2026-11-02T01:30');
  });
});

describe('recurrence rules', () => {
  it('runs a one-time schedule once and then has no next run', () => {
    const once: Recurrence = { kind: 'once', date: '2026-06-20', time: '07:00' };
    expect(nextOccurrence(once, NY, ms('2026-06-15T00:00:00Z'))?.at.toISO()).toBe('2026-06-20T11:00:00.000Z');
    expect(nextOccurrence(once, NY, ms('2026-06-20T11:00:00Z'))).toBeNull();
  });

  it('honours weekdays. 2026-06-15 is a Monday.', () => {
    const weekends: Recurrence = { kind: 'weekly', time: '09:00', weekdays: [6, 7] };
    const { occurrences } = occurrencesBetween(weekends, 'UTC', ms('2026-06-15T00:00:00Z'), ms('2026-06-29T00:00:00Z'), 10);
    expect(occurrences.map((o) => o.localDate)).toEqual(['2026-06-20', '2026-06-21', '2026-06-27', '2026-06-28']);
  });

  it('honours inclusive start and end dates', () => {
    const bounded: Recurrence = { kind: 'daily', time: '09:00', startDate: '2026-06-17', endDate: '2026-06-18' };
    const { occurrences } = occurrencesBetween(bounded, 'UTC', ms('2026-06-01T00:00:00Z'), ms('2026-07-01T00:00:00Z'), 10);
    expect(occurrences.map((o) => o.localDate)).toEqual(['2026-06-17', '2026-06-18']);
    expect(nextOccurrence(bounded, 'UTC', ms('2026-06-18T10:00:00Z'))).toBeNull();
  });

  it('caps a long backlog to the newest runs and says it did', () => {
    const daily: Recurrence = { kind: 'daily', time: '09:00' };
    const { occurrences, truncated } = occurrencesBetween(daily, 'UTC', ms('2026-01-01T00:00:00Z'), ms('2026-06-01T00:00:00Z'), 5);
    expect(occurrences).toHaveLength(5);
    expect(truncated).toBe(true);
    expect(occurrences.at(-1)?.localDate).toBe('2026-05-31');
  });
});

describe('sunrise and sunset', () => {
  const london = { latitude: 51.5, longitude: -0.12 };

  it('calculates a plausible London sunset and applies the offset', () => {
    const atSunset: Recurrence = { kind: 'solar', event: 'sunset', offsetMinutes: 0, ...london };
    const before: Recurrence = { kind: 'solar', event: 'sunset', offsetMinutes: -30, ...london };
    const plain = nextOccurrence(atSunset, 'Europe/London', ms('2026-06-21T00:00:00Z'));
    const early = nextOccurrence(before, 'Europe/London', ms('2026-06-21T00:00:00Z'));
    // London's midsummer sunset is about 21:20 BST.
    const local = plain?.at.setZone('Europe/London');
    expect(local?.hour).toBe(21);
    expect(plain!.at.toMillis() - early!.at.toMillis()).toBe(30 * 60 * 1000);
  });

  it('builds a stable key from the date, event and offset', () => {
    const rule: Recurrence = { kind: 'solar', event: 'sunrise', offsetMinutes: 15, ...london };
    expect(nextOccurrence(rule, 'Europe/London', ms('2026-06-21T00:00:00Z'))?.key).toBe('2026-06-21:sunrise:15');
  });

  it('skips dates with no sunset (polar day) and resumes when the sun sets again', () => {
    // Tromso has midnight sun from late May to late July.
    const tromso: Recurrence = { kind: 'solar', event: 'sunset', offsetMinutes: 0, latitude: 69.65, longitude: 18.96 };
    const next = nextOccurrence(tromso, 'Europe/Oslo', ms('2026-06-21T00:00:00Z'));
    expect(next).not.toBeNull();
    expect(next!.localDate > '2026-07-15').toBe(true);

    const preview = previewSchedule(tromso, 'Europe/Oslo', ms('2026-06-21T00:00:00Z'), 1);
    expect(preview.datesWithoutSolarEvent.length).toBeGreaterThan(0);
    expect(preview.warning).toContain('do');
  });

  it('skips dates with no sunrise (polar night)', () => {
    const tromso: Recurrence = { kind: 'solar', event: 'sunrise', offsetMinutes: 0, latitude: 69.65, longitude: 18.96 };
    const next = nextOccurrence(tromso, 'Europe/Oslo', ms('2026-12-21T00:00:00Z'));
    expect(next).not.toBeNull();
    expect(next!.localDate > '2027-01-01').toBe(true);
  });
});

describe('preview', () => {
  it('lists the next runs with local time and DST notes', () => {
    const daily: Recurrence = { kind: 'daily', time: '02:30' };
    const preview = previewSchedule(daily, NY, ms('2026-03-07T12:00:00Z'), 2);
    expect(preview.nextRuns[0]).toMatchObject({ note: 'dst_gap_moved_forward', at: '2026-03-08T07:30:00.000Z' });
    expect(preview.nextRuns[0]?.local).toContain('03:30');
    expect(preview.nextRuns[1]?.note).toBeNull();
    expect(preview.warning).toBeNull();
  });

  it('warns when a schedule has no future runs', () => {
    const past: Recurrence = { kind: 'once', date: '2020-01-01', time: '07:00' };
    const preview = previewSchedule(past, 'UTC', ms('2026-06-15T00:00:00Z'), 3);
    expect(preview.nextRuns).toEqual([]);
    expect(preview.warning).toContain('no future runs');
  });
});
