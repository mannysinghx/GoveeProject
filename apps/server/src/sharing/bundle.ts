import crypto from 'node:crypto';
import {
  builtinPresetByKey,
  containsLink,
  sharedBundleSchema,
  type DeviceAction,
  type PresetDto,
  type Recurrence,
  type ScheduleDto,
  type SharedBundle,
  type SharedKind,
  type SharedSlot,
} from '@glm/shared';
import type { AccountContext } from '../app/context.js';
import type { DeviceRecord } from '../devices/device-repository.js';
import { AppError } from '../shared/errors.js';

/*
 * Builds the snapshot that a share holds. Nothing in it identifies the sharer's account: lights
 * become slots (model, segment numbers, a label), presets and groups get refs, and sunrise and
 * sunset schedules lose their place. Refs are hashes of ids, so the same light or preset gets
 * the same ref in every share from one person, and an import of several items matches it once.
 */

/** The id of the account's own "All light strings" group, which the app makes in every account. */
export function builtinGroupId(account: AccountContext): string | null {
  const row = account.db.prepare("SELECT value FROM builtin_installs WHERE install_key = 'group:all-strings'").get() as { value: string | null } | undefined;
  return row?.value ?? null;
}

export function refOf(kind: 'slot' | 'preset' | 'group', id: string): string {
  return crypto.createHash('sha256').update(`${kind}:${id}`).digest('hex').slice(0, 12);
}

export function segmentsOf(device: DeviceRecord): number[] {
  const capability = device.capabilities.find((c) => c.kind === 'segmentedColor');
  return capability && 'segments' in capability ? [...capability.segments] : [];
}

export function hasColor(device: DeviceRecord): boolean {
  return device.capabilities.some((c) => c.kind === 'color' || c.kind === 'segmentedColor');
}

/** Removes the place from a sunrise or sunset schedule. Every other kind has none. */
export function withoutPlace(recurrence: Recurrence): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...recurrence };
  delete copy.latitude;
  delete copy.longitude;
  return copy;
}

export interface BuiltShare {
  bundle: SharedBundle;
  title: string;
  description: string;
}

class Builder {
  private readonly slots = new Map<string, SharedSlot>();
  private readonly bundle: SharedBundle = { version: 1, slots: [], groups: [], presets: [], schedules: [] };

  constructor(private readonly account: AccountContext) {}

  slot(deviceId: string, what: string): string {
    const key = refOf('slot', deviceId);
    if (this.slots.has(key)) return key;
    const device = this.account.devices.repository.get(deviceId);
    if (!device) throw new AppError(409, 'share_missing_light', `${what} uses a light that is no longer in your account. Fix it, then share it.`);
    const slot: SharedSlot = {
      key,
      label: `Light ${this.slots.size + 1} (${device.sku})`,
      sku: device.sku,
      segments: segmentsOf(device),
      hasColor: hasColor(device),
    };
    this.slots.set(key, slot);
    this.bundle.slots.push(slot);
    return key;
  }

  group(id: string): string {
    const ref = refOf('group', id);
    if (this.bundle.groups.some((g) => g.ref === ref)) return ref;
    const group = this.account.groups.get(id);
    const builtin = builtinGroupId(this.account) === group.id;
    this.bundle.groups.push({
      ref,
      name: group.name,
      slots: group.deviceIds.map((deviceId) => this.slot(deviceId, `The group "${group.name}"`)),
      ...(builtin ? { builtin: true } : {}),
    });
    return ref;
  }

  preset(preset: PresetDto): string {
    if (preset.builtin) throw new AppError(409, 'share_builtin', `"${preset.name}" comes with the app, so everyone already has it.`);
    const ref = refOf('preset', preset.id);
    if (this.bundle.presets.some((p) => p.ref === ref)) return ref;
    this.bundle.presets.push({
      ref,
      name: preset.name,
      description: preset.description,
      actions: preset.actions.map((entry) => ({
        slot: entry.deviceId ? this.slot(entry.deviceId, `The preset "${preset.name}"`) : null,
        action: entry.action,
        ...(entry.action.type === 'scene' ? { sceneKind: this.sceneKind(entry.deviceId, entry.action) } : {}),
      })),
    });
    return ref;
  }

  private sceneKind(deviceId: string | null, action: Extract<DeviceAction, { type: 'scene' }>): 'dynamic' | 'static' | 'diy' | 'snapshot' {
    const found = deviceId ? this.account.scenes.find(deviceId, action.sceneKey) : null;
    if (found) return found.kind;
    // Keys start with their kind, such as "dynamic-4280-3853". An unknown one is treated as private.
    const prefix = action.sceneKey.split('-')[0];
    return prefix === 'dynamic' || prefix === 'static' ? prefix : 'diy';
  }

  schedule(schedule: ScheduleDto): void {
    if (schedule.builtinShow) throw new AppError(409, 'share_builtin', `"${schedule.name}" is part of a holiday show, which everyone already has.`);
    const target =
      schedule.target.type === 'device'
        ? { type: 'slot' as const, slot: this.slot(schedule.target.deviceId, `The schedule "${schedule.name}"`) }
        : { type: 'group' as const, group: this.group(schedule.target.groupId) };
    let action: SharedBundle['schedules'][number]['action'];
    if (schedule.action.type === 'power') {
      action = { type: 'power', on: schedule.action.on };
    } else {
      const preset = this.account.presets.get(schedule.action.presetId);
      action = preset.builtin ? { type: 'builtinPreset', key: preset.builtin.key } : { type: 'preset', preset: this.preset(preset) };
    }
    this.bundle.schedules.push({
      name: schedule.name,
      recurrence: withoutPlace(schedule.recurrence) as SharedBundle['schedules'][number]['recurrence'],
      target,
      action,
      missedRunPolicy: schedule.missedRunPolicy,
    });
  }

  finish(labels: Record<string, string> | undefined): SharedBundle {
    for (const slot of this.bundle.slots) {
      const label = labels?.[slot.key];
      if (label) slot.label = label;
    }
    return this.bundle;
  }
}

/** Every piece of text that a share makes public, with where it came from. */
export function publicTexts(bundle: SharedBundle, title: string, description: string): { where: string; text: string }[] {
  return [
    { where: 'The title', text: title },
    { where: 'The description', text: description },
    ...bundle.slots.map((s) => ({ where: `The light name "${s.label}"`, text: s.label })),
    ...bundle.groups.map((g) => ({ where: `The group name "${g.name}"`, text: g.name })),
    ...bundle.presets.flatMap((p) => [
      { where: `The preset name "${p.name}"`, text: p.name },
      { where: `The description of "${p.name}"`, text: p.description },
    ]),
    ...bundle.schedules.map((s) => ({ where: `The schedule name "${s.name}"`, text: s.name })),
  ];
}

export function assertNoLinks(bundle: SharedBundle, title: string, description: string): void {
  const found = publicTexts(bundle, title, description).find((entry) => containsLink(entry.text));
  if (found) throw new AppError(422, 'share_has_link', `${found.where} looks like a web address. Shared items cannot hold links.`);
}

/** Builds a share of one preset, group or schedule from the sharer's own account. */
export function buildShare(
  account: AccountContext,
  kind: SharedKind,
  sourceId: string,
  options: { title?: string | undefined; description?: string | undefined; slotLabels?: Record<string, string> | undefined },
): BuiltShare {
  const builder = new Builder(account);
  let name: string;
  let fallbackDescription = '';
  if (kind === 'preset') {
    const preset = account.presets.get(sourceId);
    builder.preset(preset);
    name = preset.name;
    fallbackDescription = preset.description;
  } else if (kind === 'group') {
    const group = account.groups.get(sourceId);
    if (builtinGroupId(account) === group.id) {
      throw new AppError(409, 'share_builtin', `"${group.name}" is made by the app in every account, so everyone already has it.`);
    }
    builder.group(group.id);
    name = group.name;
  } else {
    const schedule = account.schedules.get(sourceId);
    builder.schedule(schedule);
    name = schedule.name;
  }
  const bundle = builder.finish(options.slotLabels);
  const title = options.title ?? name;
  const description = options.description ?? fallbackDescription;
  assertNoLinks(bundle, title, description);
  // The stored form is always checked against the shared rules, so nothing else can slip in.
  return { bundle: sharedBundleSchema.parse(bundle), title, description };
}

/** What a card shows, worked out from the bundle alone. */
export function summarize(bundle: SharedBundle): {
  colors: string[];
  slots: { key: string; label: string; sku: string; segmentCount: number }[];
  counts: { presets: number; groups: number; schedules: number };
  recurrence: Record<string, unknown> | null;
  scheduleAction: string | null;
} {
  const colors = new Set<string>();
  for (const preset of bundle.presets) {
    for (const { action } of preset.actions) {
      if (action.type === 'color' || action.type === 'segmentColor') colors.add(action.hex.toLowerCase());
    }
  }
  const first = bundle.schedules[0];
  if (first?.action.type === 'builtinPreset') {
    for (const hex of builtinPresetByKey(first.action.key)?.colors ?? []) colors.add(hex.toLowerCase());
  }
  let scheduleAction: string | null = null;
  if (first) {
    if (first.action.type === 'power') scheduleAction = first.action.on ? 'Turn on' : 'Turn off';
    else if (first.action.type === 'builtinPreset') scheduleAction = builtinPresetByKey(first.action.key)?.name ?? 'A built-in preset';
    else {
      const ref = first.action.preset;
      scheduleAction = bundle.presets.find((p) => p.ref === ref)?.name ?? null;
    }
  }
  return {
    colors: [...colors].slice(0, 12),
    slots: bundle.slots.map((s) => ({ key: s.key, label: s.label, sku: s.sku, segmentCount: s.segments.length })),
    counts: { presets: bundle.presets.length, groups: bundle.groups.length, schedules: bundle.schedules.length },
    recurrence: first ? { ...first.recurrence } : null,
    scheduleAction,
  };
}
