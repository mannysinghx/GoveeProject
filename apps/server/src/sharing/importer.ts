import {
  MEMBER_LIMITS,
  recurrenceSchema,
  type DeviceAction,
  type ImportPreviewDto,
  type ImportResultDto,
  type PresetActionInput,
  type Recurrence,
  type ScheduleAction,
  type SharedBundle,
  type SharedSlot,
  type Target,
} from '@glm/shared';
import type { AccountContext } from '../app/context.js';
import { capCount } from '../app/request-account.js';
import type { DeviceRecord } from '../devices/device-repository.js';
import { isGoveeGroup } from '../devices/device-service.js';
import { AppError } from '../shared/errors.js';
import { builtinGroupId, hasColor, segmentsOf } from './bundle.js';

/*
 * Imports shared bundles into one person's own account. Everything is created new, in their
 * file, pointed at their lights: nothing refers back to the sharer. Schedules come in switched
 * off. The whole import is one transaction: if any part fails, nothing is written.
 */

export interface ImportSource {
  shareId: string;
  /** Shown on what is created: "Light Manager" or the sharer's display name. */
  by: string;
  bundle: SharedBundle;
}

interface Merged {
  slots: SharedSlot[];
  groups: (SharedBundle['groups'][number] & { from: ImportSource })[];
  presets: (SharedBundle['presets'][number] & { from: ImportSource })[];
  schedules: (SharedBundle['schedules'][number] & { from: ImportSource })[];
}

/** One import of several items: the same light, preset or group is matched or made once. */
function merge(sources: ImportSource[], ownBuiltinGroup: string | null): Merged {
  const merged: Merged = { slots: [], groups: [], presets: [], schedules: [] };
  for (const from of sources) {
    for (const slot of from.bundle.slots) if (!merged.slots.some((s) => s.key === slot.key)) merged.slots.push(slot);
    for (const group of from.bundle.groups) {
      // The app's own group: the importer already has one, so nothing is made.
      if (group.builtin && ownBuiltinGroup) continue;
      if (!merged.groups.some((g) => g.ref === group.ref)) merged.groups.push({ ...group, from });
    }
    for (const preset of from.bundle.presets) if (!merged.presets.some((p) => p.ref === preset.ref)) merged.presets.push({ ...preset, from });
    for (const schedule of from.bundle.schedules) merged.schedules.push({ ...schedule, from });
  }
  return merged;
}

function lights(account: AccountContext): DeviceRecord[] {
  return account.devices.repository.list().filter((d) => d.discoveryStatus === 'present');
}

function needs(merged: Merged, key: string): { segments: boolean; color: boolean } {
  let segments = false;
  let color = false;
  for (const preset of merged.presets) {
    for (const { slot, action } of preset.actions) {
      if (slot !== key) continue;
      if (action.type === 'segmentColor' || action.type === 'segmentBrightness') segments = true;
      if (action.type === 'color' || action.type === 'segmentColor') color = true;
    }
  }
  return { segments, color };
}

/**
 * Suggests one light for each slot: the same model first, then the same number of segments,
 * then anything that can show what the slot needs. Each light is suggested once while there
 * are enough to go round.
 */
export function suggestMatches(merged: Pick<Merged, 'slots' | 'presets'>, devices: DeviceRecord[]): Record<string, string | null> {
  const used = new Set<string>();
  const result: Record<string, string | null> = {};
  for (const slot of merged.slots) {
    const need = needs(merged as Merged, slot.key);
    const groupSlot = devices.some((d) => d.sku === slot.sku && isGoveeGroup(d));
    let best: { id: string; score: number } | null = null;
    for (const device of devices) {
      if (isGoveeGroup(device) !== groupSlot) continue;
      const segments = segmentsOf(device);
      if (need.segments && segments.length === 0) continue;
      if (need.color && !hasColor(device)) continue;
      let score = 1;
      if (device.sku === slot.sku) score += 4;
      if (segments.length === slot.segments.length && segments.length > 0) score += 2;
      if (used.has(device.id)) score -= 10;
      if (!best || score > best.score) best = { id: device.id, score };
    }
    result[slot.key] = best ? best.id : null;
    if (best) used.add(best.id);
  }
  return result;
}

/**
 * Fits segment numbers made for one light onto another: each of the target's segments takes
 * whatever the source had at the same relative position. Same count, same positions.
 */
export function fitSegments(chosen: number[], source: number[], target: number[]): number[] {
  if (source.length === 0 || target.length === 0) return [];
  const picked = new Set(chosen);
  const result: number[] = [];
  target.forEach((segment, j) => {
    const from = source[Math.floor((j * source.length) / target.length)];
    if (from !== undefined && picked.has(from)) result.push(segment);
  });
  return result;
}

export function previewImport(account: AccountContext, sources: ImportSource[], alreadyImported: string[]): ImportPreviewDto {
  const merged = merge(sources, builtinGroupId(account));
  const devices = lights(account);
  const suggestions = suggestMatches(merged, devices);
  const settings = account.settings.get();
  return {
    slots: merged.slots.map((slot) => {
      const need = needs(merged, slot.key);
      return {
        key: slot.key,
        label: slot.label,
        sku: slot.sku,
        segmentCount: slot.segments.length,
        needsSegments: need.segments,
        needsColor: need.color,
        suggestion: suggestions[slot.key] ?? null,
      };
    }),
    devices: devices.map((d) => ({ id: d.id, name: d.name, sku: d.sku, segmentCount: segmentsOf(d).length, hasColor: hasColor(d) })),
    scenes: merged.presets.flatMap((preset) =>
      preset.actions.flatMap((entry, index) =>
        entry.action.type === 'scene'
          ? [
              {
                choiceKey: `${preset.ref}:${index}`,
                slot: entry.slot,
                presetName: preset.name,
                sceneKey: entry.action.sceneKey,
                sceneName: entry.action.sceneName ?? 'A scene',
                portable: entry.sceneKind !== 'diy' && entry.sceneKind !== 'snapshot',
              },
            ]
          : [],
      ),
    ),
    create: { presets: merged.presets.length, groups: merged.groups.length, schedules: merged.schedules.length },
    needsLocation: merged.schedules.some((s) => s.recurrence.kind === 'solar') && (settings.latitude === null || settings.longitude === null),
    alreadyImported,
  };
}

function uniqueName(account: AccountContext, table: 'presets' | 'groups', name: string): string {
  const taken = (candidate: string) => account.db.prepare(`SELECT 1 FROM ${table} WHERE name = ? COLLATE NOCASE`).get(candidate) !== undefined;
  if (!taken(name)) return name;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const candidate = `${name.slice(0, 80 - suffix.length)}${suffix}`;
    if (!taken(candidate)) return candidate;
  }
}

/** Members' caps, counted before anything is written. The owner has none. */
function assertRoom(account: AccountContext, role: 'owner' | 'member', merged: Merged): void {
  if (role !== 'member') return;
  const adding = { groups: merged.groups.length, presets: merged.presets.length, schedules: merged.schedules.length };
  for (const kind of ['groups', 'presets', 'schedules'] as const) {
    const have = capCount(account.db, kind);
    if (have + adding[kind] > MEMBER_LIMITS[kind]) {
      throw new AppError(
        409,
        'account_limit_reached',
        `This would make ${have + adding[kind]} ${kind}, and an account can have at most ${MEMBER_LIMITS[kind]}. Nothing was imported. Import fewer items, or delete some ${kind} first.`,
      );
    }
  }
}

export function runImport(
  account: AccountContext,
  role: 'owner' | 'member',
  sources: ImportSource[],
  slotMap: Record<string, string | null>,
  sceneChoices: Record<string, string>,
): ImportResultDto {
  const ownBuiltinGroup = builtinGroupId(account);
  const merged = merge(sources, ownBuiltinGroup);
  assertRoom(account, role, merged);

  const devices = new Map(lights(account).map((d) => [d.id, d]));
  const deviceFor = (slotKey: string): DeviceRecord | null => {
    const id = slotMap[slotKey];
    if (id === undefined || id === null) return null;
    const device = devices.get(id);
    if (!device) throw new AppError(422, 'import_unknown_light', 'One of the chosen lights is not in your account. Refresh and try again.');
    return device;
  };
  const slotByKey = new Map(merged.slots.map((s) => [s.key, s]));
  const settings = account.settings.get();
  const names: string[] = [];

  const mapAction = (presetName: string, presetRef: string, index: number, slotKey: string | null, action: DeviceAction): PresetActionInput | null => {
    if (slotKey === null) return { deviceId: null, action };
    const device = deviceFor(slotKey);
    if (!device) return { deviceId: null, action };
    const slot = slotByKey.get(slotKey);
    if (action.type === 'segmentColor' || action.type === 'segmentBrightness') {
      const segments = fitSegments(action.segments, slot?.segments ?? [], segmentsOf(device));
      // A step that lands on no segment of this light is left out.
      return segments.length === 0 ? null : { deviceId: device.id, action: { ...action, segments } };
    }
    if (action.type === 'scene') {
      const choice = sceneChoices[`${presetRef}:${index}`];
      const key = choice ?? action.sceneKey;
      const scene = account.scenes.find(device.id, key);
      if (!scene || (!choice && (scene.kind === 'diy' || scene.kind === 'snapshot'))) {
        throw new AppError(
          422,
          'import_scene_needed',
          `"${presetName}" uses the scene "${action.sceneName ?? action.sceneKey}", which ${device.name} does not have. Choose a scene for it.`,
          { choiceKey: `${presetRef}:${index}` },
        );
      }
      return { deviceId: device.id, action: { type: 'scene', sceneKey: scene.key, sceneName: scene.name } };
    }
    return { deviceId: device.id, action };
  };

  const builtinRefs = new Set(sources.flatMap((s) => s.bundle.groups.filter((g) => g.builtin).map((g) => g.ref)));
  const created = { presets: 0, groups: 0, schedules: 0 };
  account.db.transaction(() => {
    const groupIds = new Map<string, string>();
    for (const group of merged.groups) {
      const deviceIds = [...new Set(group.slots.map((key) => deviceFor(key)?.id).filter((id): id is string => Boolean(id)))];
      const made = account.groups.create({ name: uniqueName(account, 'groups', group.name), deviceIds });
      account.db.prepare('UPDATE groups SET imported_from = ?, imported_share = ? WHERE id = ?').run(group.from.by, group.from.shareId, made.id);
      groupIds.set(group.ref, made.id);
      names.push(made.name);
      created.groups++;
    }

    const presetIds = new Map<string, string>();
    for (const preset of merged.presets) {
      const seen = new Set<string>();
      const actions = preset.actions
        .map((entry, index) => mapAction(preset.name, preset.ref, index, entry.slot, entry.action))
        .filter((a): a is PresetActionInput => a !== null)
        // Two of the sharer's lights matched to one of yours would repeat each step on it.
        .filter((a) => {
          const key = JSON.stringify(a);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      if (actions.length === 0) {
        throw new AppError(422, 'import_nothing_fits', `None of the steps in "${preset.name}" fit the chosen lights. Choose lights with segment colours for it.`);
      }
      const made = account.presets.create({ name: uniqueName(account, 'presets', preset.name), description: preset.description, actions });
      account.db.prepare('UPDATE presets SET imported_from = ?, imported_share = ? WHERE id = ?').run(preset.from.by, preset.from.shareId, made.id);
      presetIds.set(preset.ref, made.id);
      names.push(made.name);
      created.presets++;
    }

    for (const schedule of merged.schedules) {
      let target: Target;
      if (schedule.target.type === 'slot') {
        const device = deviceFor(schedule.target.slot);
        if (!device) throw new AppError(422, 'import_light_needed', `Choose a light for the schedule "${schedule.name}".`);
        target = { type: 'device', deviceId: device.id };
      } else {
        const id = groupIds.get(schedule.target.group) ?? (builtinRefs.has(schedule.target.group) ? ownBuiltinGroup : undefined);
        if (!id) throw new AppError(422, 'import_broken', `The schedule "${schedule.name}" is missing its group.`);
        target = { type: 'group', groupId: id };
      }
      let action: ScheduleAction;
      if (schedule.action.type === 'power') action = { type: 'power', on: schedule.action.on };
      else if (schedule.action.type === 'preset') {
        const id = presetIds.get(schedule.action.preset);
        if (!id) throw new AppError(422, 'import_broken', `The schedule "${schedule.name}" is missing its preset.`);
        action = { type: 'preset', presetId: id };
      } else {
        const builtin = account.presets.findByBuiltinKey(schedule.action.key);
        if (!builtin) throw new AppError(422, 'import_broken', `The schedule "${schedule.name}" uses a built-in preset this account does not have.`);
        action = { type: 'preset', presetId: builtin.id };
      }
      const timing: Record<string, unknown> = { ...schedule.recurrence };
      if (timing.kind === 'solar') {
        if (settings.latitude === null || settings.longitude === null) {
          throw new AppError(422, 'import_location_needed', `"${schedule.name}" runs at sunrise or sunset. Set your location in Settings first.`);
        }
        timing.latitude = settings.latitude;
        timing.longitude = settings.longitude;
      }
      const recurrence = recurrenceSchema.safeParse(timing);
      if (!recurrence.success) throw new AppError(422, 'import_broken', `The timing of "${schedule.name}" could not be read.`);
      const made = account.schedules.create({
        name: schedule.name,
        enabled: false,
        timeZone: settings.defaultTimeZone,
        recurrence: recurrence.data as Recurrence,
        target,
        action,
        missedRunPolicy: schedule.missedRunPolicy,
      });
      account.db.prepare('UPDATE schedules SET imported_from = ?, imported_share = ? WHERE id = ?').run(schedule.from.by, schedule.from.shareId, made.id);
      names.push(made.name);
      created.schedules++;
    }
  })();

  return { created, names };
}

/** Share ids this account has imported before, of those given. */
export function importedBefore(account: AccountContext, shareIds: string[]): Set<string> {
  if (shareIds.length === 0) return new Set();
  const marks = shareIds.map(() => '?').join(',');
  const rows = account.db
    .prepare(
      `SELECT imported_share AS id FROM presets WHERE imported_share IN (${marks})
       UNION SELECT imported_share FROM groups WHERE imported_share IN (${marks})
       UNION SELECT imported_share FROM schedules WHERE imported_share IN (${marks})`,
    )
    .all(...shareIds, ...shareIds, ...shareIds) as { id: string }[];
  return new Set(rows.map((r) => r.id));
}
