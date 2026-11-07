import { intToHex, type CommandStatus, type ErrorCategory, type Verification } from '@glm/shared';

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' });

/** "3 min. ago". Time always appears next to any value that could be out of date. */
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return 'never';
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 10) return 'just now';
  if (abs < 60) return RELATIVE.format(seconds, 'second');
  if (abs < 3600) return RELATIVE.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return RELATIVE.format(Math.round(seconds / 3600), 'hour');
  return RELATIVE.format(Math.round(seconds / 86400), 'day');
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return 'Not yet';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export const STATUS_LABEL: Record<CommandStatus | 'skipped', string> = {
  queued: 'Queued',
  sending: 'Sending',
  accepted: 'Accepted by Govee',
  rejected: 'Rejected by Govee',
  failed: 'Not delivered',
  superseded: 'Replaced by newer command',
  interrupted: 'Interrupted',
  skipped: 'Skipped',
};

export const VERIFICATION_LABEL: Record<Verification, string> = {
  unverified: 'Not yet confirmed',
  confirmed: 'Confirmed by a later Govee report',
  mismatch: 'Later Govee report shows a different value',
  not_reported: 'Govee does not report this setting',
  not_applicable: '',
};

export const ERROR_CATEGORY_LABEL: Record<ErrorCategory, string> = {
  not_configured: 'API key not set',
  auth: 'API key rejected',
  rate_limited: 'Rate limited',
  timeout: 'Timed out',
  network: 'Network error',
  bad_request: 'Invalid request',
  not_found: 'Not found',
  server_error: 'Govee service error',
  invalid_response: 'Unreadable response',
  application_error: 'Govee reported an error',
  queue_stopped: 'App was stopping',
  unknown: 'Unknown error',
};

/** Shows a reported value in the terms the UI uses, without guessing at unknown shapes. */
export function formatStateValue(instance: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Not reported';
  if (instance === 'powerSwitch') {
    if (value === 1) return 'On';
    if (value === 0) return 'Off';
  }
  if (instance === 'brightness' && typeof value === 'number') return `${value}%`;
  if (instance === 'colorRgb' && typeof value === 'number') return intToHex(value);
  if (instance === 'colorTemperatureK' && typeof value === 'number') {
    return value === 0 ? 'Not active' : `${value} K`;
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Readable names for the capability list. Unknown instances show as Govee named them. */
const INSTANCE_LABELS: Record<string, string> = {
  powerSwitch: 'Power',
  brightness: 'Brightness',
  colorRgb: 'RGB colour',
  colorTemperatureK: 'Colour temperature',
  segmentedColorRgb: 'Segment colour',
  segmentedBrightness: 'Segment brightness',
  lightScene: 'Scenes',
  diyScene: 'DIY scenes',
  snapshot: 'Snapshots',
  musicMode: 'Music mode',
  online: 'Online status',
};

export function instanceLabel(instance: string): string {
  return INSTANCE_LABELS[instance] ?? instance;
}

/** Time zones for a picker: the browser's list, plus UTC and whatever is already selected. */
export function timeZoneOptions(current: string): string[] {
  const known = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return [...new Set(['UTC', current, ...known])].sort();
}
