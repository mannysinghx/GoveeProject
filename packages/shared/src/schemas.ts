import { z } from 'zod';

/* -------------------------------------------------------------------------- */
/* Primitives                                                                 */
/* -------------------------------------------------------------------------- */

export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour in #rrggbb form');

export const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time in HH:mm form');

function isRealDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return (
    date.getUTCFullYear() === Number(y) &&
    date.getUTCMonth() === Number(m) - 1 &&
    date.getUTCDate() === Number(d)
  );
}

export const localDateSchema = z
  .string()
  .refine(isRealDate, 'Use a real calendar date in YYYY-MM-DD form');

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return value.length > 0;
  } catch {
    return false;
  }
}

export const timeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, 'Use an IANA time zone such as America/New_York');

const nameSchema = z.string().trim().min(1, 'Enter a name').max(80, 'Keep the name to 80 characters');

export const idParamSchema = z.object({ id: z.string().min(1).max(64) });

/* -------------------------------------------------------------------------- */
/* Authentication                                                             */
/* -------------------------------------------------------------------------- */

export const PASSWORD_MIN_LENGTH = 12;

const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(256, 'Use at most 256 characters');

export const usernameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a username')
  .max(64, 'Use at most 64 characters');

export const setupRequestSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  setupCode: z.string().max(256).optional(),
});
export type SetupRequest = z.infer<typeof setupRequestSchema>;

export const loginRequestSchema = z.object({
  username: z.string().max(64),
  password: z.string().max(256),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().max(256),
  newPassword: passwordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

/* -------------------------------------------------------------------------- */
/* Device actions                                                             */
/* -------------------------------------------------------------------------- */

export const MAX_SEGMENTS_IN_REQUEST = 256;

const segmentIndexesSchema = z
  .array(z.number().int().min(0))
  .min(1, 'Select at least one segment')
  .max(MAX_SEGMENTS_IN_REQUEST);

export const powerActionSchema = z.object({ type: z.literal('power'), on: z.boolean() });
export const brightnessActionSchema = z.object({
  type: z.literal('brightness'),
  value: z.number().int(),
});
export const colorActionSchema = z.object({ type: z.literal('color'), hex: hexColorSchema });
export const colorTemperatureActionSchema = z.object({
  type: z.literal('colorTemperature'),
  kelvin: z.number().int(),
});
export const sceneActionSchema = z.object({
  type: z.literal('scene'),
  /** Server-issued key such as "dynamic-4280-3853". The server resolves the Govee value. */
  sceneKey: z.string().min(1).max(64),
  /** Display copy only. Never sent to Govee. */
  sceneName: z.string().max(120).optional(),
});
export const segmentColorActionSchema = z.object({
  type: z.literal('segmentColor'),
  segments: segmentIndexesSchema,
  hex: hexColorSchema,
});
export const segmentBrightnessActionSchema = z.object({
  type: z.literal('segmentBrightness'),
  segments: segmentIndexesSchema,
  value: z.number().int(),
});

export const deviceActionSchema = z.discriminatedUnion('type', [
  powerActionSchema,
  brightnessActionSchema,
  colorActionSchema,
  colorTemperatureActionSchema,
  sceneActionSchema,
  segmentColorActionSchema,
  segmentBrightnessActionSchema,
]);
export type DeviceAction = z.infer<typeof deviceActionSchema>;

export const powerRequestSchema = z.object({ on: z.boolean() });
export const brightnessRequestSchema = z.object({ value: z.number().int() });
export const colorRequestSchema = z.object({ hex: hexColorSchema });
export const colorTemperatureRequestSchema = z.object({ kelvin: z.number().int() });

export const segmentOperationSchema = z
  .object({
    segments: segmentIndexesSchema,
    hex: hexColorSchema.optional(),
    brightness: z.number().int().optional(),
  })
  .refine((op) => op.hex !== undefined || op.brightness !== undefined, {
    message: 'Choose a colour or a brightness for the selected segments',
  });
export type SegmentOperation = z.infer<typeof segmentOperationSchema>;

export const segmentsRequestSchema = z.object({
  operations: z.array(segmentOperationSchema).min(1).max(32),
});
export type SegmentsRequest = z.infer<typeof segmentsRequestSchema>;

/* -------------------------------------------------------------------------- */
/* Targets, groups, presets                                                   */
/* -------------------------------------------------------------------------- */

export const targetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('device'), deviceId: z.string().min(1).max(64) }),
  z.object({ type: z.literal('group'), groupId: z.string().min(1).max(64) }),
]);
export type Target = z.infer<typeof targetSchema>;

export const groupCreateSchema = z.object({
  name: nameSchema,
  deviceIds: z.array(z.string().min(1).max(64)).max(200).default([]),
});
export type GroupCreate = z.infer<typeof groupCreateSchema>;

export const groupUpdateSchema = z
  .object({
    name: nameSchema.optional(),
    deviceIds: z.array(z.string().min(1).max(64)).max(200).optional(),
  })
  .refine((v) => v.name !== undefined || v.deviceIds !== undefined, {
    message: 'Nothing to update',
  });
export type GroupUpdate = z.infer<typeof groupUpdateSchema>;

export const groupActionRequestSchema = z.object({ action: deviceActionSchema });

export const presetActionInputSchema = z.object({
  /** null means "whichever device or group the preset is applied to". */
  deviceId: z.string().min(1).max(64).nullable(),
  action: deviceActionSchema,
});
export type PresetActionInput = z.infer<typeof presetActionInputSchema>;

const presetDescriptionSchema = z.string().trim().max(500);
// Large enough for a gradient across many strings, at one step per segment.
const presetActionsSchema = z
  .array(presetActionInputSchema)
  .min(1, 'Add at least one action')
  .max(500, 'A preset can hold at most 500 actions');

export const presetCreateSchema = z.object({
  name: nameSchema,
  description: presetDescriptionSchema.default(''),
  actions: presetActionsSchema,
});
export type PresetCreate = z.infer<typeof presetCreateSchema>;

// Spelled out rather than presetCreateSchema.partial(): Zod applies .default() even inside
// optional fields, so a partial would reset the description on every update.
export const presetUpdateSchema = z
  .object({
    name: nameSchema.optional(),
    description: presetDescriptionSchema.optional(),
    actions: presetActionsSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type PresetUpdate = z.infer<typeof presetUpdateSchema>;

export const presetApplyRequestSchema = z.object({ target: targetSchema.optional() });
export type PresetApplyRequest = z.infer<typeof presetApplyRequestSchema>;

/** Tries out unsaved steps, such as a pattern in the editor. Nothing is stored as a preset. */
export const presetDraftApplySchema = z.object({
  name: nameSchema.default('Pattern preview'),
  target: targetSchema.optional(),
  actions: presetActionsSchema,
});
export type PresetDraftApply = z.infer<typeof presetDraftApplySchema>;

/* -------------------------------------------------------------------------- */
/* Schedules                                                                  */
/* -------------------------------------------------------------------------- */

/** ISO weekdays: 1 is Monday, 7 is Sunday. */
const weekdaysSchema = z
  .array(z.number().int().min(1).max(7))
  .min(1, 'Pick at least one day')
  .max(7)
  .refine((days) => new Set(days).size === days.length, 'Each day can appear once');

const dateBoundsShape = {
  startDate: localDateSchema.optional(),
  endDate: localDateSchema.optional(),
};

const onceRecurrenceSchema = z.object({
  kind: z.literal('once'),
  date: localDateSchema,
  time: timeOfDaySchema,
});

const dailyRecurrenceSchema = z.object({
  kind: z.literal('daily'),
  time: timeOfDaySchema,
  ...dateBoundsShape,
});

const weeklyRecurrenceSchema = z.object({
  kind: z.literal('weekly'),
  time: timeOfDaySchema,
  weekdays: weekdaysSchema,
  ...dateBoundsShape,
});

const solarRecurrenceSchema = z.object({
  kind: z.literal('solar'),
  event: z.enum(['sunrise', 'sunset']),
  offsetMinutes: z.number().int().min(-240).max(240).default(0),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  weekdays: weekdaysSchema.optional(),
  ...dateBoundsShape,
});

export const recurrenceSchema = z
  .discriminatedUnion('kind', [
    onceRecurrenceSchema,
    dailyRecurrenceSchema,
    weeklyRecurrenceSchema,
    solarRecurrenceSchema,
  ])
  .superRefine((value, ctx) => {
    if ('startDate' in value && value.startDate && value.endDate && value.endDate < value.startDate) {
      ctx.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'The end date is before the start date',
      });
    }
  });
export type Recurrence = z.infer<typeof recurrenceSchema>;

export const scheduleActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('power'), on: z.boolean() }),
  z.object({ type: z.literal('preset'), presetId: z.string().min(1).max(64) }),
]);
export type ScheduleAction = z.infer<typeof scheduleActionSchema>;

/**
 * skip: record the missed run and do nothing else.
 * run_latest: record every missed run, then run only the most recent one so the
 * lights reach the latest intended state. Older runs are never replayed.
 */
export const missedRunPolicySchema = z.enum(['skip', 'run_latest']);
export type MissedRunPolicy = z.infer<typeof missedRunPolicySchema>;

const scheduleBaseSchema = z.object({
  name: nameSchema,
  enabled: z.boolean().default(true),
  timeZone: timeZoneSchema,
  recurrence: recurrenceSchema,
  target: targetSchema,
  action: scheduleActionSchema,
  missedRunPolicy: missedRunPolicySchema.default('skip'),
});

export const scheduleCreateSchema = scheduleBaseSchema;
export type ScheduleCreate = z.infer<typeof scheduleCreateSchema>;

export const scheduleUpdateSchema = z
  .object({
    name: nameSchema.optional(),
    timeZone: timeZoneSchema.optional(),
    recurrence: recurrenceSchema.optional(),
    target: targetSchema.optional(),
    action: scheduleActionSchema.optional(),
    missedRunPolicy: missedRunPolicySchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type ScheduleUpdate = z.infer<typeof scheduleUpdateSchema>;

export const schedulePreviewRequestSchema = z.object({
  timeZone: timeZoneSchema,
  recurrence: recurrenceSchema,
  count: z.number().int().min(1).max(20).default(5),
});
export type SchedulePreviewRequest = z.infer<typeof schedulePreviewRequestSchema>;

/* -------------------------------------------------------------------------- */
/* Activity and settings                                                      */
/* -------------------------------------------------------------------------- */

export const activityEventTypes = [
  'command',
  'discovery',
  'state',
  'scene',
  'preset',
  'group',
  'schedule',
  'auth',
  'rate_limit',
  'settings',
  'system',
] as const;
export type ActivityEventType = (typeof activityEventTypes)[number];

export const activityOutcomes = ['success', 'failure', 'warning', 'info'] as const;
export type ActivityOutcome = (typeof activityOutcomes)[number];

export const activityQuerySchema = z.object({
  deviceId: z.string().max(64).optional(),
  eventType: z.enum(activityEventTypes).optional(),
  outcome: z.enum(activityOutcomes).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  beforeId: z.coerce.number().int().min(1).optional(),
});
export type ActivityQuery = z.infer<typeof activityQuerySchema>;

export const patternStringSettingSchema = z.object({
  deviceId: z.string().min(1).max(64),
  included: z.boolean(),
  reversed: z.boolean(),
});
export type PatternStringSetting = z.infer<typeof patternStringSettingSchema>;

export const settingsSchema = z.object({
  defaultTimeZone: timeZoneSchema,
  /** How often an open dashboard asks for a status refresh. */
  statusPollSeconds: z.number().int().min(30).max(3600),
  /** A reported value older than this is shown as stale. */
  staleAfterSeconds: z.number().int().min(60).max(86400),
  /** release: send when the slider is let go. interval: also send while dragging. */
  sliderSendMode: z.enum(['release', 'interval']),
  sliderIntervalMs: z.number().int().min(500).max(5000),
  /** Optional defaults for sunrise and sunset schedules. Entered by hand. */
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  /** How the owner's light strings are arranged in the pattern editor, in order. */
  patternStrings: z.array(patternStringSettingSchema).max(200),
});
export type AppSettings = z.infer<typeof settingsSchema>;

export const settingsUpdateSchema = settingsSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;

export const DEFAULT_SETTINGS: AppSettings = {
  defaultTimeZone: 'UTC',
  statusPollSeconds: 60,
  staleAfterSeconds: 300,
  sliderSendMode: 'release',
  sliderIntervalMs: 1000,
  latitude: null,
  longitude: null,
  patternStrings: [],
};
