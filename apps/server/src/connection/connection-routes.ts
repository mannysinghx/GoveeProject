import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app/context.js';
import { parseInput } from '../shared/validation.js';

const missedParamSchema = z.object({ id: z.coerce.number().int().min(1) });

export function registerConnectionRoutes(api: FastifyInstance, ctx: AppContext): void {
  const { connection } = ctx;

  api.get('/connection/report', async () => connection.report());

  api.post('/connection/check', async () => {
    const ran = await connection.checkNow();
    return { ran, report: connection.report() };
  });

  api.post('/connection/missed/:id/send', async (request) => {
    const { id } = parseInput(missedParamSchema, request.params);
    await connection.sendNow(id);
    return connection.report();
  });

  api.post('/connection/missed/:id/dismiss', async (request) => {
    const { id } = parseInput(missedParamSchema, request.params);
    connection.dismiss(id);
    return connection.report();
  });
}
