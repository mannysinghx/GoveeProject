import { describeAction, hexToInt, type DeviceAction } from '@glm/shared';
import { findCapability } from '../govee/capabilities.js';
import type { CapabilityCommand } from '../govee/transport.js';
import type { DeviceRecord } from './device-repository.js';
import type { SceneStore } from './scene-store.js';

export type BuildFailureCode =
  | 'device_missing'
  | 'unsupported_capability'
  | 'value_out_of_range'
  | 'invalid_segment'
  | 'scene_not_found';

export interface BuiltCommand {
  capability: CapabilityCommand;
  actionType: DeviceAction['type'];
  summary: string;
  /**
   * Commands with the same key can replace each other while still queued.
   * Colour, temperature and scene share a key because each overrides the others.
   * Segment commands have none: each one touches different segments.
   */
  coalesceKey: string | null;
}

export type BuildResult =
  | { ok: true; command: BuiltCommand }
  | { ok: false; code: BuildFailureCode; message: string };

const fail = (code: BuildFailureCode, message: string): BuildResult => ({ ok: false, code, message });

const unsupported = (device: DeviceRecord, what: string): BuildResult =>
  fail('unsupported_capability', `${device.name} does not report ${what} through the Govee API.`);

function checkRange(label: string, value: number, range: { min: number; max: number; step?: number }): string | null {
  if (!Number.isInteger(value) || value < range.min || value > range.max) {
    return `${label} must be a whole number from ${range.min} to ${range.max}.`;
  }
  if (range.step && range.step > 1 && (value - range.min) % range.step !== 0) {
    return `${label} must move in steps of ${range.step} from ${range.min}.`;
  }
  return null;
}

function checkSegments(
  segments: number[],
  capability: { segments: number[]; minSelect: number; maxSelect: number },
): string | null {
  const unique = new Set(segments);
  if (unique.size !== segments.length) return 'A segment was listed more than once.';
  const known = new Set(capability.segments);
  const bad = segments.filter((s) => !known.has(s));
  if (bad.length > 0) {
    return `This device does not report segment ${bad.join(', ')}. It reports ${capability.segments[0]} to ${capability.segments.at(-1)}.`;
  }
  if (segments.length < capability.minSelect || segments.length > capability.maxSelect) {
    return `Select between ${capability.minSelect} and ${capability.maxSelect} segments.`;
  }
  return null;
}

/**
 * Turns a requested action into the exact capability payload for Govee, or
 * explains why it cannot be sent. Runs server-side on every command, against the
 * capabilities stored from discovery. Limits come from the device, not the client.
 * The client never supplies a device address or a raw capability structure.
 */
export function buildCommand(device: DeviceRecord, action: DeviceAction, scenes: SceneStore): BuildResult {
  if (device.discoveryStatus !== 'present') {
    return fail('device_missing', `${device.name} was not in the last Govee device list, so it cannot be controlled.`);
  }
  const caps = device.capabilities;
  const summary = describeAction(action);

  switch (action.type) {
    case 'power': {
      const cap = findCapability(caps, 'power');
      if (!cap) return unsupported(device, 'on and off control');
      return {
        ok: true,
        command: {
          capability: { type: cap.type, instance: cap.instance, value: action.on ? cap.onValue : cap.offValue },
          actionType: action.type,
          summary,
          coalesceKey: 'power',
        },
      };
    }
    case 'brightness': {
      const cap = findCapability(caps, 'brightness');
      if (!cap) return unsupported(device, 'brightness control');
      const problem = checkRange('Brightness', action.value, cap);
      if (problem) return fail('value_out_of_range', problem);
      return {
        ok: true,
        command: {
          capability: { type: cap.type, instance: cap.instance, value: action.value },
          actionType: action.type,
          summary,
          coalesceKey: 'brightness',
        },
      };
    }
    case 'color': {
      const cap = findCapability(caps, 'color');
      if (!cap) return unsupported(device, 'RGB colour control');
      const value = hexToInt(action.hex);
      if (value < cap.min || value > cap.max) {
        return fail('value_out_of_range', `Colour is outside the range this device reports (${cap.min} to ${cap.max}).`);
      }
      return {
        ok: true,
        command: {
          capability: { type: cap.type, instance: cap.instance, value },
          actionType: action.type,
          summary,
          coalesceKey: 'lightMode',
        },
      };
    }
    case 'colorTemperature': {
      const cap = findCapability(caps, 'colorTemperature');
      if (!cap) return unsupported(device, 'colour temperature control');
      const problem = checkRange('Colour temperature', action.kelvin, cap);
      if (problem) return fail('value_out_of_range', problem);
      return {
        ok: true,
        command: {
          capability: { type: cap.type, instance: cap.instance, value: action.kelvin },
          actionType: action.type,
          summary,
          coalesceKey: 'lightMode',
        },
      };
    }
    case 'scene': {
      if (!caps.some((c) => c.kind === 'scene')) return unsupported(device, 'scenes');
      // The value sent to Govee always comes from the server's scene cache.
      const scene = scenes.find(device.id, action.sceneKey);
      if (!scene) {
        return fail(
          'scene_not_found',
          `${device.name} has no scene "${action.sceneName ?? action.sceneKey}". Refresh its scenes and try again.`,
        );
      }
      return {
        ok: true,
        command: {
          capability: { type: scene.capabilityType, instance: scene.instance, value: scene.value },
          actionType: action.type,
          summary: describeAction({ ...action, sceneName: scene.name }),
          coalesceKey: 'lightMode',
        },
      };
    }
    case 'segmentColor': {
      const cap = findCapability(caps, 'segmentedColor');
      if (!cap) return unsupported(device, 'segment colour control');
      const problem = checkSegments(action.segments, cap);
      if (problem) return fail('invalid_segment', problem);
      return {
        ok: true,
        command: {
          capability: {
            type: cap.type,
            instance: cap.instance,
            value: { segment: action.segments, rgb: hexToInt(action.hex) },
          },
          actionType: action.type,
          summary,
          coalesceKey: null,
        },
      };
    }
    case 'segmentBrightness': {
      const cap = findCapability(caps, 'segmentedBrightness');
      if (!cap) return unsupported(device, 'segment brightness control');
      const segmentProblem = checkSegments(action.segments, cap);
      if (segmentProblem) return fail('invalid_segment', segmentProblem);
      const rangeProblem = checkRange('Segment brightness', action.value, cap);
      if (rangeProblem) return fail('value_out_of_range', rangeProblem);
      return {
        ok: true,
        command: {
          capability: {
            type: cap.type,
            instance: cap.instance,
            value: { segment: action.segments, brightness: action.value },
          },
          actionType: action.type,
          summary,
          coalesceKey: null,
        },
      };
    }
  }
}
