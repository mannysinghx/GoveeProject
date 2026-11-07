import type { FastifyInstance } from 'fastify';
import { groupActionRequestSchema, groupCreateSchema, groupUpdateSchema, idParamSchema } from '@glm/shared';
import type { AppContext } from '../app/context.js';
import { parseInput } from '../shared/validation.js';

export function registerGroupRoutes(api: FastifyInstance, ctx: AppContext): void {
  const { groups } = ctx;

  api.get('/groups', async () => ({ groups: groups.list() }));

  api.post('/groups', async (request, reply) => {
    const body = parseInput(groupCreateSchema, request.body);
    return reply.status(201).send(groups.create(body));
  });

  api.get('/groups/:id', async (request) => {
    const { id } = parseInput(idParamSchema, request.params);
    return groups.get(id);
  });

  api.patch('/groups/:id', async (request) => {
    const { id } = parseInput(idParamSchema, request.params);
    return groups.update(id, parseInput(groupUpdateSchema, request.body));
  });

  api.delete('/groups/:id', async (request, reply) => {
    const { id } = parseInput(idParamSchema, request.params);
    groups.delete(id);
    return reply.status(204).send();
  });

  api.post('/groups/:id/apply', async (request) => {
    const { id } = parseInput(idParamSchema, request.params);
    const { action } = parseInput(groupActionRequestSchema, request.body);
    return groups.applyAction(id, action, request.id);
  });
}
