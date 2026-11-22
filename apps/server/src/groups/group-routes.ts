import type { FastifyInstance } from 'fastify';
import { groupActionRequestSchema, groupCreateSchema, groupUpdateSchema, idParamSchema } from '@glm/shared';
import { accountOf, assertRoomFor } from '../app/request-account.js';
import { parseInput } from '../shared/validation.js';

export function registerGroupRoutes(api: FastifyInstance): void {
  api.get('/groups', async (request) => ({ groups: accountOf(request).groups.list() }));

  api.post('/groups', async (request, reply) => {
    const { groups } = accountOf(request);
    const body = parseInput(groupCreateSchema, request.body);
    assertRoomFor(request, 'groups');
    return reply.status(201).send(groups.create(body));
  });

  api.get('/groups/:id', async (request) => {
    const { groups } = accountOf(request);
    const { id } = parseInput(idParamSchema, request.params);
    return groups.get(id);
  });

  api.patch('/groups/:id', async (request) => {
    const { groups } = accountOf(request);
    const { id } = parseInput(idParamSchema, request.params);
    return groups.update(id, parseInput(groupUpdateSchema, request.body));
  });

  api.delete('/groups/:id', async (request, reply) => {
    const { groups } = accountOf(request);
    const { id } = parseInput(idParamSchema, request.params);
    groups.delete(id);
    return reply.status(204).send();
  });

  api.post('/groups/:id/apply', async (request) => {
    const { groups } = accountOf(request);
    const { id } = parseInput(idParamSchema, request.params);
    const { action } = parseInput(groupActionRequestSchema, request.body);
    return groups.applyAction(id, action, request.id);
  });
}
