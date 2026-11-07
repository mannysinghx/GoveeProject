import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  idParamSchema,
  holidayEnabledSchema,
  holidaySkipSchema,
  scheduleCreateSchema,
  schedulePreviewRequestSchema,
  scheduleUpdateSchema,
} from '@glm/shared';
import type { AppContext } from '../app/context.js';
import { parseInput } from '../shared/validation.js';

const limitQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(500).default(50) });
const holidayParamSchema = z.object({ key: z.string().min(1).max(64) });

export function registerScheduleRoutes(api: FastifyInstance, ctx: AppContext): void {
  const { schedules, holidays } = ctx;

  api.get('/schedules', async () => ({ schedules: schedules.list() }));

  api.get('/holidays', async () => ({ holidays: holidays.list() }));

  api.post('/holidays/:key/enabled', async (request) => {
    const { key } = parseInput(holidayParamSchema, request.params);
    const { enabled } = parseInput(holidayEnabledSchema, request.body);
    return { holidays: holidays.setEnabled(key, enabled) };
  });

  api.post('/holidays/:key/skip', async (request) => {
    const { key } = parseInput(holidayParamSchema, request.params);
    const { skip } = parseInput(holidaySkipSchema, request.body);
    return { holidays: holidays.setSkipped(key, skip) };
  });

  api.post('/schedules', async (request, reply) => {
    const body = parseInput(scheduleCreateSchema, request.body);
    return reply.status(201).send(schedules.create(body));
  });

  api.post('/schedules/preview', async (request) => {
    return schedules.preview(parseInput(schedulePreviewRequestSchema, request.body));
  });

  api.get('/schedules/:id', async (request) => {
    const { id } = parseInput(idParamSchema, request.params);
    return schedules.get(id);
  });

  api.patch('/schedules/:id', async (request) => {
    const { id } = parseInput(idParamSchema, request.params);
    return schedules.update(id, parseInput(scheduleUpdateSchema, request.body));
  });

  api.delete('/schedules/:id', async (request, reply) => {
    const { id } = parseInput(idParamSchema, request.params);
    schedules.delete(id);
    return reply.status(204).send();
  });

  api.post('/schedules/:id/enable', async (request) => {
    const { id } = parseInput(idParamSchema, request.params);
    return schedules.setEnabled(id, true);
  });

  api.post('/schedules/:id/disable', async (request) => {
    const { id } = parseInput(idParamSchema, request.params);
    return schedules.setEnabled(id, false);
  });

  api.get('/schedules/:id/executions', async (request) => {
    const { id } = parseInput(idParamSchema, request.params);
    const { limit } = parseInput(limitQuerySchema, request.query);
    return { executions: schedules.executions(id, limit) };
  });
}
