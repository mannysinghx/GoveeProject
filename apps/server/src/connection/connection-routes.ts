import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { accountOf } from '../app/request-account.js';
import { parseInput } from '../shared/validation.js';

const missedParamSchema = z.object({ id: z.coerce.number().int().min(1) });

export function registerConnectionRoutes(api: FastifyInstance): void {
  api.get('/connection/report', async (request) => accountOf(request).connection.report());

  api.post('/connection/check', async (request) => {
    const { connection } = accountOf(request);
    const ran = await connection.checkNow();
    return { ran, report: connection.report() };
  });

  api.post('/connection/missed/:id/send', async (request) => {
    const { connection } = accountOf(request);
    const { id } = parseInput(missedParamSchema, request.params);
    await connection.sendNow(id);
    return connection.report();
  });

  api.post('/connection/missed/:id/dismiss', async (request) => {
    const { connection } = accountOf(request);
    const { id } = parseInput(missedParamSchema, request.params);
    connection.dismiss(id);
    return connection.report();
  });
}
