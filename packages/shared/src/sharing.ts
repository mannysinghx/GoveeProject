import { z } from 'zod';
import { deviceActionSchema, missedRunPolicySchema } from './schemas.js';

/*
 * Sharing designs between accounts. See docs/sharing-plan.md. A share is a snapshot, a
 * "bundle", that holds no ids from anyone's account: each light becomes a slot, and presets
 * and groups get a ref. Import fills each slot with one of the importer's own lights.
 */

/** Shown as the maker of the owner's shared items. */
export const OFFICIAL_SHARER_NAME = 'Light Manager';

export const SHARE_LIMITS = {
  /** Items one member may have shared at once. The owner has no cap. */
  itemsPerMember: 25,
  titleMax: 80,
  descriptionMax: 500,
  slotLabelMax: 60,
  /** Shares and updates an hour, per member. */
  sharesPerHour: 30,
  /** Items one import may take at once. */
  importItemsMax: 200,
} as const;

export const sharedKinds = ['preset', 'group', 'schedule'] as const;
export type SharedKind = (typeof sharedKinds)[number];

/** Web addresses are refused in anything shared, so the Shared space cannot carry links. */
const LINK = /(https?:\/\/|www\.)|\b[\w-]+\.(com|net|org|io|co|app|xyz|info|biz|ru|cn|ink|me|ly|site|online|top|link)\b/i;
export function containsLink(text: string): boolean {
  return LINK.test(text);
}

const refSchema = z.string().regex(/^[a-f0-9]{12}$/);
const shareNameSchema = z.string().trim().min(1).max(SHARE_LIMITS.titleMax);

export const sharedSlotSchema = z.object({
  key: refSchema,
  label: z.string().trim().min(1).max(SHARE_LIMITS.slotLabelMax),
  sku: z.string().max(40),
  /** The light's segment numbers, in order. Empty when it has no segment colours. */
  segments: z.array(z.number().int().min(0)).max(256),
  hasColor: z.boolean(),
});
export type SharedSlot = z.infer<typeof sharedSlotSchema>;

export const sharedPresetActionSchema = z.object({
  /** Null: "whichever light the preset is applied to", as in the original. */
  slot: refSchema.nullable(),
  action: deviceActionSchema,
  /** For scene actions: Govee's own scenes copy to the same model; DIY scenes and snapshots never do. */
  sceneKind: z.enum(['dynamic', 'static', 'diy', 'snapshot']).optional(),
});

export const sharedPresetSchema = z.object({
  ref: refSchema,
  name: shareNameSchema,
  description: z.string().trim().max(SHARE_LIMITS.descriptionMax),
  actions: z.array(sharedPresetActionSchema).min(1).max(500),
});

export const sharedGroupSchema = z.object({
  ref: refSchema,
  name: shareNameSchema,
  slots: z.array(refSchema).max(200),
  /** The app's own "All light strings" group, which every account has: import uses theirs. */
  builtin: z.boolean().optional(),
});

/**
 * A schedule's timing, without a place: sunrise and sunset schedules lose their latitude and
 * longitude when shared, and get the importer's own on import. Checked in full on import.
 */
export const sharedRecurrenceSchema = z
  .object({ kind: z.enum(['once', 'daily', 'weekly', 'yearly', 'holiday', 'solar']) })
  .passthrough()
  .refine((value) => !('latitude' in value) && !('longitude' in value), 'A shared schedule holds no location');

export const sharedScheduleSchema = z.object({
  name: shareNameSchema,
  recurrence: sharedRecurrenceSchema,
  target: z.discriminatedUnion('type', [
    z.object({ type: z.literal('slot'), slot: refSchema }),
    z.object({ type: z.literal('group'), group: refSchema }),
  ]),
  action: z.discriminatedUnion('type', [
    z.object({ type: z.literal('power'), on: z.boolean() }),
    z.object({ type: z.literal('preset'), preset: refSchema }),
    /** A preset that comes with the app, which every account already has. */
    z.object({ type: z.literal('builtinPreset'), key: z.string().min(1).max(64) }),
  ]),
  missedRunPolicy: missedRunPolicySchema,
});

export const sharedBundleSchema = z.object({
  version: z.literal(1),
  slots: z.array(sharedSlotSchema).max(200),
  groups: z.array(sharedGroupSchema).max(200),
  presets: z.array(sharedPresetSchema).max(200),
  schedules: z.array(sharedScheduleSchema).max(200),
});
export type SharedBundle = z.infer<typeof sharedBundleSchema>;

/* ---------------------------------- requests ---------------------------------- */

const labelsSchema = z.record(refSchema, z.string().trim().min(1).max(SHARE_LIMITS.slotLabelMax)).optional();

export const shareRequestSchema = z.object({
  kind: z.enum(sharedKinds),
  sourceId: z.string().min(1).max(64),
  title: shareNameSchema.optional(),
  description: z.string().trim().max(SHARE_LIMITS.descriptionMax).optional(),
  slotLabels: labelsSchema,
});
export type ShareRequest = z.infer<typeof shareRequestSchema>;

export const shareUpdateSchema = z.object({
  title: shareNameSchema.optional(),
  description: z.string().trim().max(SHARE_LIMITS.descriptionMax).optional(),
  slotLabels: labelsSchema,
  /** Take a new snapshot of the original. On by default. */
  refresh: z.boolean().default(true),
});
export type ShareUpdate = z.infer<typeof shareUpdateSchema>;

const itemIdsSchema = z.array(z.string().min(1).max(64)).min(1).max(SHARE_LIMITS.importItemsMax);

export const importPreviewRequestSchema = z.object({ itemIds: itemIdsSchema });

export const importRequestSchema = z.object({
  itemIds: itemIdsSchema,
  /** Slot key to one of the importer's light ids, or null for "pick a light when applying". */
  slots: z.record(refSchema, z.string().min(1).max(64).nullable()),
  /** "<preset ref>:<action index>" to a scene key on the chosen light. */
  scenes: z.record(z.string().max(40), z.string().min(1).max(64)).default({}),
});
export type ImportRequest = z.infer<typeof importRequestSchema>;

export const displayNameSchema = z
  .string()
  .trim()
  .min(3, 'Use at least 3 characters')
  .max(30, 'Keep it to 30 characters')
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} ._'-]*$/u, 'Use letters, numbers, spaces and . _ \' - only')
  .refine((name) => !containsLink(name), 'A display name cannot be a web address');

export const displayNameRequestSchema = z.object({ displayName: displayNameSchema });

export const adminSharedUpdateSchema = z.object({ hidden: z.boolean() });
export const adminSharingBlockSchema = z.object({ blocked: z.boolean() });

/* ------------------------------------ DTOs ------------------------------------ */

export interface SharedItemDto {
  id: string;
  kind: SharedKind;
  title: string;
  description: string;
  /** The sharer's display name, or Light Manager for the owner. */
  by: string;
  official: boolean;
  mine: boolean;
  /** The original's id in your own account. Only on your own shares, never on anyone else's. */
  sourceId: string | null;
  /** Hidden by the owner. Only the sharer and the owner see hidden items. */
  hidden: boolean;
  /** Colours used, for a preview. */
  colors: string[];
  slots: { key: string; label: string; sku: string; segmentCount: number }[];
  counts: { presets: number; groups: number; schedules: number };
  /** The first schedule's timing, without a place, for a summary line. */
  recurrence: Record<string, unknown> | null;
  /** What the first schedule does, such as "Turn on" or "Diwali". */
  scheduleAction: string | null;
  importedByMe: boolean;
  imports: number;
  createdAt: string;
  updatedAt: string;
}

export interface SharedListDto {
  items: SharedItemDto[];
  displayName: string | null;
  /** False when the owner stopped this person sharing. */
  canShare: boolean;
  /** Null for the owner, who has no cap. */
  shareLimit: number | null;
  sharedCount: number;
}

export interface ShareAllResultDto {
  shared: number;
  skipped: { name: string; reason: string }[];
}

export interface ImportPreviewDto {
  slots: {
    key: string;
    label: string;
    sku: string;
    segmentCount: number;
    needsSegments: boolean;
    needsColor: boolean;
    /** The suggested light, or null when none fits. */
    suggestion: string | null;
  }[];
  devices: { id: string; name: string; sku: string; segmentCount: number; hasColor: boolean }[];
  /** Scene steps, which may need a scene chosen on the matched light. */
  scenes: { choiceKey: string; slot: string | null; presetName: string; sceneKey: string; sceneName: string; portable: boolean }[];
  create: { presets: number; groups: number; schedules: number };
  /** A sunrise or sunset schedule needs the importer's location, which is not set. */
  needsLocation: boolean;
  /** Items already imported once. */
  alreadyImported: string[];
}

export interface ImportResultDto {
  created: { presets: number; groups: number; schedules: number };
  names: string[];
}

export interface AdminSharedItemDto extends SharedItemDto {
  sharerId: number;
  sharerEmail: string | null;
}
