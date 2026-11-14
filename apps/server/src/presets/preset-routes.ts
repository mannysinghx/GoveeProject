import type { FastifyInstance } from 'fastify';
import {
  dailySchemeUpdateSchema,
  idParamSchema,
  presetApplyRequestSchema,
  presetCreateSchema,
  presetDraftApplySchema,
  presetUpdateSchema,
} from '@glm/shared';
import type { AppContext } from '../app/context.js';
import { parseInput } from '../shared/validation.js';

export function registerPresetRoutes(api: FastifyInstance, ctx: AppContext): void {
  const { presets, dailyScheme } = ctx;

  api.get('/daily-scheme', async () => dailyScheme.status());

  api.patch('/daily-scheme', async (request) => dailyScheme.set(parseInput(dailySchemeUpdateSchema, request.body)));

  api.get('/presets', async () => ({ presets: presets.list() }));

  api.post('/presets', async (request, reply) => {
    const body = parseInput(presetCreateSchema, request.body);
    return reply.status(201).send(presets.create(body));
  });

  api.post('/presets/apply-draft', async (request) => {
    const body = parseInput(presetDraftApplySchema, request.body);
    return presets.applyDraft(body.name, body.target, body.actions, request.id, body.plainSegments ?? false);
  });

  api.get('/presets/:id', async (request) => {
    const { id } = parseInput(idParamSchema, request.params);
    return presets.get(id);
  });

  api.patch('/presets/:id', async (request) => {
    const { id } = parseInput(idParamSchema, request.params);
    return presets.update(id, parseInput(presetUpdateSchema, request.body));
  });

  api.delete('/presets/:id', async (request, reply) => {
    const { id } = parseInput(idParamSchema, request.params);
    presets.delete(id);
    return reply.status(204).send();
  });

  api.post('/presets/:id/duplicate', async (request, reply) => {
    const { id } = parseInput(idParamSchema, request.params);
    return reply.status(201).send(presets.duplicate(id));
  });

  api.post('/presets/:id/apply', async (request) => {
    const { id } = parseInput(idParamSchema, request.params);
    const { target } = parseInput(presetApplyRequestSchema, request.body ?? {});
    return presets.apply(id, target, undefined, request.id);
  });
}
