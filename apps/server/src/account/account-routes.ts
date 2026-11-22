import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  adminAccountUpdateSchema,
  aiLimitUpdateSchema,
  aiProviderIdSchema,
  connectAiKeyRequestSchema,
  connectGoveeKeyRequestSchema,
  deleteAccountRequestSchema,
  exportAccountRequestSchema,
  type AdminAccountListDto,
} from '@glm/shared';
import type { PlatformContext } from '../app/context.js';
import { clearSessionCookie } from '../auth/cookies.js';
import { parseInput } from '../shared/validation.js';

const providerParamSchema = z.object({ provider: aiProviderIdSchema });
const userParamSchema = z.object({ id: z.coerce.number().int().positive() });

/**
 * The signed-in person's own account. Every route here works on request.session's own user:
 * none takes a user id from the request, so nobody can reach another person's keys or data.
 */
export function registerAccountRoutes(api: FastifyInstance, platform: PlatformContext): void {
  const { account, config } = platform;

  /* --------------------------------- Govee key -------------------------------- */

  api.get('/account/govee', async (request) => account.goveeStatus(request.session!));

  // Checked with Govee before it is kept. The key is never sent back.
  api.put('/account/govee', async (request) => {
    const { apiKey } = parseInput(connectGoveeKeyRequestSchema, request.body);
    return account.connectGovee(request.session!, apiKey, request.ip);
  });

  api.delete('/account/govee', async (request) => account.removeGovee(request.session!, request.ip));

  /* ---------------------------------- AI keys --------------------------------- */

  api.get('/account/ai', async (request) => account.personalAi(request.session!));

  api.put('/account/ai/keys/:provider', async (request) => {
    const { provider } = parseInput(providerParamSchema, request.params);
    const { model, apiKey } = parseInput(connectAiKeyRequestSchema, request.body);
    return account.connectAi(request.session!, provider, model, apiKey, request.ip);
  });

  api.delete('/account/ai/keys/:provider', async (request) => {
    const { provider } = parseInput(providerParamSchema, request.params);
    return account.removeAi(request.session!, provider, request.ip);
  });

  api.patch('/account/ai', async (request) => {
    const { monthlyLimitUsd } = parseInput(aiLimitUpdateSchema, request.body);
    return account.setAiLimit(request.session!, monthlyLimitUsd, request.ip);
  });

  /* ----------------------------- export and delete ---------------------------- */

  // POST, with the password, rather than a link: the file holds the person's location and routines.
  api.post('/account/export', async (request, reply) => {
    const { currentPassword } = parseInput(exportAccountRequestSchema, request.body);
    const { filename, body } = await account.exportData(request.session!, currentPassword, request.ip);
    return reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .header('cache-control', 'no-store')
      .send(body);
  });

  api.post('/account/delete', async (request, reply) => {
    const { currentPassword } = parseInput(deleteAccountRequestSchema, request.body);
    await account.deleteAccount(request.session!, currentPassword, request.ip);
    clearSessionCookie(reply, request, config);
    return reply.status(204).send();
  });

  /* ------------------------------ owner: accounts ----------------------------- */

  api.get('/admin/accounts', { config: { owner: true } }, async (): Promise<AdminAccountListDto> => ({ accounts: account.listAccounts() }));

  api.patch('/admin/accounts/:id', { config: { owner: true } }, async (request): Promise<AdminAccountListDto> => {
    const { id } = parseInput(userParamSchema, request.params);
    const { status } = parseInput(adminAccountUpdateSchema, request.body);
    return { accounts: await account.setStatus(request.session!.userId, id, status, request.ip) };
  });
}
