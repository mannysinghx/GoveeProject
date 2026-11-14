import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  allBrightnessRequestSchema,
  brightnessRequestSchema,
  colorRequestSchema,
  colorTemperatureRequestSchema,
  idParamSchema,
  powerRequestSchema,
  segmentsRequestSchema,
  type DeviceAction,
} from '@glm/shared';
import type { AppContext } from '../app/context.js';
import { AppError, notFound } from '../shared/errors.js';
import { parseInput } from '../shared/validation.js';
import { buildCommand } from './command-builder.js';
import { isGoveeGroup } from './device-service.js';

const sceneParamSchema = idParamSchema.extend({ sceneId: z.string().min(1).max(64) });
const limitQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

export function registerDeviceRoutes(api: FastifyInstance, ctx: AppContext): void {
  const { devices, actions, commands, scenes } = ctx;

  /** The client names a device by internal id. Its Govee address always comes from the database. */
  const dispatch = async (id: string, action: DeviceAction, correlationId: string, reply: FastifyReply) => {
    const device = devices.getRecord(id);
    const { command, settled } = await actions.dispatchDirect(device, action, correlationId);
    return reply.status(settled ? 200 : 202).send({ command, device: devices.get(id) });
  };

  api.get('/devices', async () => ({ devices: devices.list() }));

  api.post('/devices/discover', async (request) => devices.discover(request.id));

  api.post('/devices/refresh-due', async (request) => ({ devices: await devices.refreshDue(request.id) }));

  api.post('/devices/refresh-all', async (request) => {
    const result = await devices.refreshAll(request.id);
    // So the Connections page and any alerts catch up with what was just read. Not awaited:
    // confirming a light that has just dropped takes a little while.
    void ctx.connection.check();
    return result;
  });

  /**
   * One brightness for every light, so the whole display dims and brightens as a unit. Govee
   * keeps brightness apart from color, so it stays as set when a pattern or scheme changes.
   */
  api.post('/lights/brightness', async (request) => {
    const { value } = parseInput(allBrightnessRequestSchema, request.body);
    const plans = devices.repository
      .list()
      .filter((d) => d.discoveryStatus === 'present' && !isGoveeGroup(d))
      .flatMap((device) => {
        const range = device.capabilities.find((c) => c.kind === 'brightness');
        if (!range) return [];
        // A percentage of each light's own range, in case one does not go from 1 to 100.
        const scaled = Math.round(range.min + ((value - 1) / 99) * (range.max - range.min));
        return [{ device, actions: [{ type: 'brightness', value: Math.min(range.max, Math.max(range.min, scaled)) } as DeviceAction] }];
      });
    if (plans.length === 0) {
      throw new AppError(422, 'unsupported_capability', 'No light here reports brightness control through the Govee API.');
    }
    return actions.runPlan({ type: 'manual', id: null, name: `Brightness ${value}% for all lights`, correlationId: request.id }, plans);
  });

  api.get('/devices/:id', async (request) => {
    const { id } = parseInput(idParamSchema, request.params);
    return devices.getDetail(id);
  });

  api.post('/devices/:id/refresh', async (request) => {
    const { id } = parseInput(idParamSchema, request.params);
    return devices.refreshState(id, 'manual', request.id);
  });

  api.get('/devices/:id/commands', async (request) => {
    const { id } = parseInput(idParamSchema, request.params);
    const { limit } = parseInput(limitQuerySchema, request.query);
    return { commands: devices.commandHistory(id, limit) };
  });

  api.post('/devices/:id/power', async (request, reply) => {
    const { id } = parseInput(idParamSchema, request.params);
    const { on } = parseInput(powerRequestSchema, request.body);
    return dispatch(id, { type: 'power', on }, request.id, reply);
  });

  api.post('/devices/:id/brightness', async (request, reply) => {
    const { id } = parseInput(idParamSchema, request.params);
    const { value } = parseInput(brightnessRequestSchema, request.body);
    return dispatch(id, { type: 'brightness', value }, request.id, reply);
  });

  api.post('/devices/:id/color', async (request, reply) => {
    const { id } = parseInput(idParamSchema, request.params);
    const { hex } = parseInput(colorRequestSchema, request.body);
    return dispatch(id, { type: 'color', hex }, request.id, reply);
  });

  api.post('/devices/:id/color-temperature', async (request, reply) => {
    const { id } = parseInput(idParamSchema, request.params);
    const { kelvin } = parseInput(colorTemperatureRequestSchema, request.body);
    return dispatch(id, { type: 'colorTemperature', kelvin }, request.id, reply);
  });

  api.post('/devices/:id/segments', async (request) => {
    const { id } = parseInput(idParamSchema, request.params);
    const { operations } = parseInput(segmentsRequestSchema, request.body);
    const device = devices.getRecord(id);

    const steps: DeviceAction[] = [];
    for (const op of operations) {
      if (op.hex !== undefined) steps.push({ type: 'segmentColor', segments: op.segments, hex: op.hex });
      if (op.brightness !== undefined) {
        steps.push({ type: 'segmentBrightness', segments: op.segments, value: op.brightness });
      }
    }
    // Reject invalid input as a whole. Partial results are only for delivery failures.
    for (const step of steps) {
      const built = buildCommand(device, step, scenes);
      if (!built.ok) throw new AppError(built.code === 'device_missing' ? 409 : 422, built.code, built.message);
    }
    return actions.runPlan(
      { type: 'manual', id, name: `${device.name} segments`, correlationId: request.id },
      [{ device, actions: steps }],
    );
  });

  api.get('/devices/:id/scenes', async (request) => {
    const { id } = parseInput(idParamSchema, request.params);
    return devices.getScenes(id);
  });

  api.post('/devices/:id/scenes/refresh', async (request) => {
    const { id } = parseInput(idParamSchema, request.params);
    return devices.refreshScenes(id, request.id);
  });

  api.post('/devices/:id/scenes/:sceneId/apply', async (request, reply) => {
    const { id, sceneId } = parseInput(sceneParamSchema, request.params);
    return dispatch(id, { type: 'scene', sceneKey: sceneId }, request.id, reply);
  });

  api.get('/commands/:id', async (request) => {
    const { id } = parseInput(idParamSchema, request.params);
    const command = commands.get(id);
    if (!command) throw notFound('That command');
    return { command };
  });
}
