import type { FastifyInstance } from 'fastify';
import { activityQuerySchema } from '@glm/shared';
import type { AppContext } from '../app/context.js';
import { parseInput } from '../shared/validation.js';

export function registerActivityRoutes(api: FastifyInstance, ctx: AppContext): void {
  api.get('/activity', async (request) => {
    return ctx.activity.list(parseInput(activityQuerySchema, request.query));
  });
}
