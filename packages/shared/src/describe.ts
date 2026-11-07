import type { DeviceAction, Recurrence, ScheduleAction } from './schemas.js';

/** "0-4, 7, 9-10". Sorted and collapsed so long selections stay readable. */
export function formatSegmentList(segments: number[]): string {
  const sorted = [...new Set(segments)].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    const start = sorted[i] as number;
    let end = start;
    while (i + 1 < sorted.length && sorted[i + 1] === end + 1) {
      i += 1;
      end = sorted[i] as number;
    }
    parts.push(start === end ? `${start}` : `${start}-${end}`);
    i += 1;
  }
  return parts.join(', ');
}

export function describeAction(action: DeviceAction): string {
  switch (action.type) {
    case 'power':
      return action.on ? 'Turn on' : 'Turn off';
    case 'brightness':
      return `Set brightness to ${action.value}`;
    case 'color':
      return `Set colour to ${action.hex.toLowerCase()}`;
    case 'colorTemperature':
      return `Set colour temperature to ${action.kelvin} K`;
    case 'scene':
      return `Activate scene "${action.sceneName ?? action.sceneKey}"`;
    case 'segmentColor':
      return `Set segments ${formatSegmentList(action.segments)} to ${action.hex.toLowerCase()}`;
    case 'segmentBrightness':
      return `Set brightness of segments ${formatSegmentList(action.segments)} to ${action.value}`;
  }
}

export function describeScheduleAction(action: ScheduleAction, presetName?: string | null): string {
  if (action.type === 'power') return action.on ? 'Turn on' : 'Turn off';
  return `Apply preset "${presetName ?? 'unknown'}"`;
}

const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function describeWeekdays(weekdays: number[]): string {
  const sorted = [...weekdays].sort((a, b) => a - b);
  const key = sorted.join(',');
  if (key === '1,2,3,4,5,6,7') return 'every day';
  if (key === '1,2,3,4,5') return 'weekdays';
  if (key === '6,7') return 'weekends';
  return sorted.map((d) => WEEKDAY_NAMES[d - 1]).join(', ');
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function describeRecurrence(recurrence: Recurrence): string {
  const bounds = (r: { startDate?: string | undefined; endDate?: string | undefined }) => {
    if (r.startDate && r.endDate) return ` from ${r.startDate} to ${r.endDate}`;
    if (r.startDate) return ` from ${r.startDate}`;
    if (r.endDate) return ` until ${r.endDate}`;
    return '';
  };
  switch (recurrence.kind) {
    case 'once':
      return `Once on ${recurrence.date} at ${recurrence.time}`;
    case 'daily':
      return `Every day at ${recurrence.time}${bounds(recurrence)}`;
    case 'weekly':
      return `${describeWeekdays(recurrence.weekdays).replace(/^./, (c) => c.toUpperCase())} at ${recurrence.time}${bounds(recurrence)}`;
    case 'yearly':
      return `Every year on ${MONTHS[recurrence.month - 1]} ${recurrence.day} at ${recurrence.time}${bounds(recurrence)}`;
    case 'solar': {
      const offset = recurrence.offsetMinutes;
      const when =
        offset === 0
          ? `At ${recurrence.event}`
          : `${Math.abs(offset)} min ${offset < 0 ? 'before' : 'after'} ${recurrence.event}`;
      const days = recurrence.weekdays ? `, ${describeWeekdays(recurrence.weekdays)}` : '';
      return `${when}${days}${bounds(recurrence)}`;
    }
  }
}
