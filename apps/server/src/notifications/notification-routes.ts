import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  notificationActionTokenSchema,
  notificationRespondSchema,
  pushSubscribeSchema,
  pushUnsubscribeSchema,
} from '@glm/shared';
import { OWNER_USER_ID, type PlatformContext } from '../app/context.js';
import { accountOf } from '../app/request-account.js';
import { notFound } from '../shared/errors.js';
import { parseInput } from '../shared/validation.js';

const idParamSchema = z.object({ id: z.coerce.number().int().min(1) });
const listQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

export function registerNotificationRoutes(api: FastifyInstance, platform: PlatformContext): void {
  api.get('/notifications', async (request) => {
    const { limit } = parseInput(listQuerySchema, request.query);
    return accountOf(request).notifications.list(limit);
  });

  api.post('/notifications/read-all', async (request) => {
    const { notifications } = accountOf(request);
    notifications.markAllRead();
    return notifications.list(50);
  });

  api.post('/notifications/test', async (request) => accountOf(request).notifications.sendTest());

  api.get('/notifications/push', async (request) => accountOf(request).notifications.pushStatus());

  api.post('/notifications/push/subscribe', async (request) =>
    accountOf(request).notifications.subscribe(parseInput(pushSubscribeSchema, request.body)),
  );

  api.post('/notifications/push/unsubscribe', async (request) =>
    accountOf(request).notifications.unsubscribeEndpoint(parseInput(pushUnsubscribeSchema, request.body).endpoint),
  );

  api.delete('/notifications/push/:id', async (request) => {
    const { id } = parseInput(idParamSchema, request.params);
    return accountOf(request).notifications.removeDevice(id);
  });

  api.post('/notifications/:id/respond', async (request) => {
    const { id } = parseInput(idParamSchema, request.params);
    return accountOf(request).notifications.respond(id, parseInput(notificationRespondSchema, request.body).action);
  });

  // Called by a button on a phone notification, which has no session or CSRF token. The
  // token is the permission: long, random, single-use, and it can only answer this one
  // notification. It travels in the body so it never appears in a request log.
  // With no session, the account comes from the token's prefix, "<user id>.". Tokens sent
  // before prefixes existed have none, and were all the owner's. The token is then checked
  // against that account's own database only, so a prefix naming the wrong account finds
  // nothing, and gets the same answer as a token that does not exist.
  api.post('/notification-actions', { config: { public: true } }, async (request) => {
    const { token } = parseInput(notificationActionTokenSchema, request.body);
    const prefixed = /^(\d{1,10})\.[A-Za-z0-9_-]+$/.exec(token);
    const userId = prefixed ? Number(prefixed[1]) : OWNER_USER_ID;
    const account = platform.accounts.forUser(userId);
    if (!account) throw notFound('That notification action');
    account.notifications.respondWithToken(token);
    return { ok: true };
  });
}
