import type { FastifyInstance } from 'fastify';
import { activityQuerySchema } from '@glm/shared';
import { accountOf } from '../app/request-account.js';
import { parseInput } from '../shared/validation.js';

export function registerActivityRoutes(api: FastifyInstance): void {
  api.get('/activity', async (request) => {
    return accountOf(request).activity.list(parseInput(activityQuerySchema, request.query));
  });
}
