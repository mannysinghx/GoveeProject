import type {
  ActivityEventType,
  ActivityOutcome,
  AppSettings,
  DeviceAction,
  MissedRunPolicy,
  Recurrence,
  ScheduleAction,
  Target,
} from './schemas.js';

/* -------------------------------------------------------------------------- */
/* API errors                                                                 */
/* -------------------------------------------------------------------------- */

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
  };
}

/* -------------------------------------------------------------------------- */
/* Authentication                                                             */
/* -------------------------------------------------------------------------- */

export interface SessionDto {
  setupRequired: boolean;
  setupCodeRequired: boolean;
  authenticated: boolean;
  username: string | null;
  csrfToken: string | null;
  expiresAt: string | null;
}

/* -------------------------------------------------------------------------- */
/* Capabilities                                                               */
/* -------------------------------------------------------------------------- */

interface CapabilityBase {
  /** Capability type exactly as Govee returned it. */
  type: string;
  instance: string;
}

export interface PowerCapability extends CapabilityBase {
  kind: 'power';
  onValue: number;
  offValue: number;
}

interface RangeBase extends CapabilityBase {
  min: number;
  max: number;
  step: number;
  unit: string | null;
}

export interface BrightnessCapability extends RangeBase {
  kind: 'brightness';
}

export interface ColorTemperatureCapability extends RangeBase {
  kind: 'colorTemperature';
}

export interface ColorCapability extends CapabilityBase {
  kind: 'color';
  min: number;
  max: number;
}

interface SegmentedBase extends CapabilityBase {
  /** Segment indexes Govee reported. A segment is not necessarily one bulb. */
  segments: number[];
  minSelect: number;
  maxSelect: number;
}

export interface SegmentedColorCapability extends SegmentedBase {
  kind: 'segmentedColor';
}

export interface SegmentedBrightnessCapability extends SegmentedBase {
  kind: 'segmentedBrightness';
  min: number;
  max: number;
  step: number;
}

export type SceneKind = 'static' | 'dynamic' | 'diy' | 'snapshot';

export interface SceneCapability extends CapabilityBase {
  kind: 'scene';
  sceneKind: Exclude<SceneKind, 'dynamic'>;
  /** Options listed in the device list response. More may come from the scene endpoints. */
  listedOptionCount: number;
}

/** A capability Govee reported that this version of the app has no control for. */
export interface OtherCapability extends CapabilityBase {
  kind: 'other';
  dataType: string | null;
  reason: 'not_controlled_by_app' | 'malformed_metadata';
}

export type NormalizedCapability =
  | PowerCapability
  | BrightnessCapability
  | ColorTemperatureCapability
  | ColorCapability
  | SegmentedColorCapability
  | SegmentedBrightnessCapability
  | SceneCapability
  | OtherCapability;

/* -------------------------------------------------------------------------- */
/* Commands                                                                   */
/* -------------------------------------------------------------------------- */

export type CommandStatus =
  | 'queued'
  | 'sending'
  /** Govee accepted the request. This does not prove the lights changed. */
  | 'accepted'
  /** Govee refused the request, or it can never succeed as sent. */
  | 'rejected'
  /** The request could not be delivered after bounded retries. Outcome unknown. */
  | 'failed'
  /** A newer command for the same setting replaced this one before it was sent. */
  | 'superseded'
  /** The app stopped before this command finished. */
  | 'interrupted';

export type Verification =
  /** No later report from Govee has been seen yet. */
  | 'unverified'
  /** A later report from Govee shows the requested value. */
  | 'confirmed'
  /** A later report from Govee shows a different value. */
  | 'mismatch'
  /** Govee returned nothing for this setting, so it cannot be checked. */
  | 'not_reported'
  /** The command never reached the accepted state. */
  | 'not_applicable';

export type CommandSourceType = 'manual' | 'preset' | 'group' | 'schedule';

export type ErrorCategory =
  | 'not_configured'
  | 'auth'
  | 'rate_limited'
  | 'timeout'
  | 'network'
  | 'bad_request'
  | 'not_found'
  | 'server_error'
  | 'invalid_response'
  | 'application_error'
  | 'queue_stopped'
  | 'unknown';

export interface CommandDto {
  id: string;
  deviceId: string;
  actionType: string;
  instance: string;
  summary: string;
  sourceType: CommandSourceType;
  status: CommandStatus;
  verification: Verification;
  attempts: number;
  errorCategory: ErrorCategory | null;
  errorMessage: string | null;
  requestId: string;
  createdAt: string;
  acceptedAt: string | null;
  completedAt: string | null;
}

export type OutcomeStatus = CommandStatus | 'skipped';

/** What happened to one action on one device during a preset, group or schedule run. */
export interface ActionOutcomeDto {
  deviceId: string | null;
  deviceName: string;
  actionType: string;
  summary: string;
  status: OutcomeStatus;
  commandId: string | null;
  verification: Verification;
  reason: string | null;
  errorCategory: ErrorCategory | null;
}

/** Deliberately not called "success": Govee accepting a request proves no physical change. */
export type RunStatus = 'running' | 'all_accepted' | 'partial' | 'failed' | 'skipped';

export interface RunResultDto {
  runId: string;
  sourceType: CommandSourceType;
  sourceId: string | null;
  sourceName: string;
  status: RunStatus;
  startedAt: string;
  completedAt: string | null;
  outcomes: ActionOutcomeDto[];
}

/* -------------------------------------------------------------------------- */
/* Devices                                                                    */
/* -------------------------------------------------------------------------- */

export type Connectivity = 'online' | 'offline' | 'unknown';
export type Freshness = 'fresh' | 'stale' | 'never';

export interface CapabilityStateDto {
  instance: string;
  requested: { value: unknown; at: string } | null;
  accepted: { value: unknown; at: string } | null;
  /** historical is true when Govee said the device was offline at report time. */
  reported: { value: unknown; at: string; historical: boolean } | null;
  /** Govee returned an empty value for this setting: it does not support being queried. */
  notQueryable: boolean;
  verification: Verification | null;
}

export interface StatusErrorDto {
  category: ErrorCategory;
  message: string;
  at: string;
}

export interface DeviceDto {
  id: string;
  goveeDeviceId: string;
  sku: string;
  name: string;
  deviceType: string | null;
  /** The model this project targets first. A highlight only, never a restriction. */
  isPrimaryModel: boolean;
  discoveryStatus: 'present' | 'missing';
  lastDiscoveredAt: string;
  missingSince: string | null;
  capabilities: NormalizedCapability[];
  connectivity: Connectivity;
  freshness: Freshness;
  lastStatusRefreshAt: string | null;
  lastOnlineAt: string | null;
  lastRequestAt: string | null;
  lastAcceptedAt: string | null;
  lastStatusError: StatusErrorDto | null;
  states: CapabilityStateDto[];
  pendingCommands: CommandDto[];
}

export interface DeviceDetailDto extends DeviceDto {
  /** Capability JSON as Govee returned it. Contains no credentials. */
  rawCapabilities: unknown;
  recentCommands: CommandDto[];
}

export interface DiscoveryResultDto {
  total: number;
  added: number;
  updated: number;
  noLongerDiscovered: number;
  discoveredAt: string;
  devices: DeviceDto[];
}

export interface RefreshResultDto {
  device: DeviceDto;
  /** True when the request was served from cache to respect rate limits. */
  throttled: boolean;
}

/* -------------------------------------------------------------------------- */
/* Scenes                                                                     */
/* -------------------------------------------------------------------------- */

export interface SceneDto {
  /** Stable key used to activate the scene. */
  key: string;
  name: string;
  kind: SceneKind;
  instance: string;
  fetchedAt: string;
}

export interface ScenesDto {
  /** False when the device reports no scene capability at all. */
  supported: boolean;
  fetchedAt: string | null;
  scenes: SceneDto[];
  lastRefreshErrors: { source: string; category: ErrorCategory; message: string }[];
}

/* -------------------------------------------------------------------------- */
/* Groups and presets                                                         */
/* -------------------------------------------------------------------------- */

export interface GroupDto {
  id: string;
  name: string;
  deviceIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PresetActionDto {
  id: number;
  deviceId: string | null;
  deviceName: string | null;
  action: DeviceAction;
  summary: string;
  order: number;
}

export interface PresetDto {
  id: string;
  name: string;
  description: string;
  actions: PresetActionDto[];
  /** True when at least one action needs a device or group picked when applying. */
  needsTarget: boolean;
  createdAt: string;
  updatedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Schedules                                                                  */
/* -------------------------------------------------------------------------- */

export type ExecutionStatus =
  | 'running'
  | 'all_accepted'
  | 'partial'
  | 'failed'
  | 'skipped'
  | 'missed'
  | 'interrupted';

export interface ScheduleExecutionDto {
  id: string;
  scheduleId: string;
  occurrenceKey: string;
  scheduledFor: string;
  startedAt: string | null;
  completedAt: string | null;
  status: ExecutionStatus;
  /** True when a missed run was recovered by the "run latest" policy. */
  isRecovery: boolean;
  errorSummary: string | null;
  runId: string | null;
}

/** Why a run does not happen at the plain wall-clock time. */
export type OccurrenceNote =
  | 'dst_gap_moved_forward'
  | 'dst_repeated_time_first_used';

export interface NextRunDto {
  at: string;
  /** Wall-clock time in the schedule's zone, for example "2026-11-07 18:30 EST". */
  local: string;
  note: OccurrenceNote | null;
}

export interface SchedulePreviewDto {
  nextRuns: NextRunDto[];
  /** Local dates skipped because the sun does not rise or set on them. */
  datesWithoutSolarEvent: string[];
  warning: string | null;
}

export interface ScheduleDto {
  id: string;
  name: string;
  enabled: boolean;
  timeZone: string;
  recurrence: Recurrence;
  target: Target;
  targetName: string;
  action: ScheduleAction;
  actionSummary: string;
  missedRunPolicy: MissedRunPolicy;
  nextRun: NextRunDto | null;
  /** The target or preset this schedule points to no longer exists. */
  problem: string | null;
  lastExecution: ScheduleExecutionDto | null;
  createdAt: string;
  updatedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Activity and diagnostics                                                   */
/* -------------------------------------------------------------------------- */

export interface ActivityEventDto {
  id: number;
  createdAt: string;
  eventType: ActivityEventType;
  outcome: ActivityOutcome;
  deviceId: string | null;
  deviceName: string | null;
  correlationId: string | null;
  message: string;
  details: unknown;
}

export interface ActivityListDto {
  events: ActivityEventDto[];
  nextBeforeId: number | null;
}

export interface HealthDto {
  status: 'ok' | 'degraded';
  database: 'ok' | 'error';
  scheduler: 'running' | 'stopped' | 'disabled';
  version: string;
}

export interface DiagnosticsDto {
  version: string;
  nodeVersion: string;
  uptimeSeconds: number;
  backend: 'ok';
  database: { status: 'ok' | 'error'; schemaVersion: string | null; path: string };
  govee: {
    keyConfigured: boolean;
    /** Only true when the base URL was overridden for local testing. */
    usingLocalTestEndpoint: boolean;
    baseUrl: string;
    lastSuccessfulConnectionAt: string | null;
    lastErrorCategory: ErrorCategory | null;
    lastErrorAt: string | null;
    lastRateLimitAt: string | null;
    requestsToday: number;
    dailyBudget: number;
  };
  devices: { discovered: number; noLongerDiscovered: number; lastDiscoveryAt: string | null };
  scheduler: {
    status: 'running' | 'stopped' | 'disabled';
    lastTickAt: string | null;
    enabledSchedules: number;
  };
  queue: { pending: number; pausedUntil: string | null };
}

export interface DashboardSummaryDto {
  upcoming: { scheduleId: string; scheduleName: string; targetName: string; actionSummary: string; run: NextRunDto }[];
  recentFailures: ActivityEventDto[];
}

export type { AppSettings };
