import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  notificationActionTokenSchema,
  notificationRespondSchema,
  pushSubscribeSchema,
  pushUnsubscribeSchema,
} from '@glm/shared';
import type { AppContext } from '../app/context.js';
import { parseInput } from '../shared/validation.js';

const idParamSchema = z.object({ id: z.coerce.number().int().min(1) });
const listQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

export function registerNotificationRoutes(api: FastifyInstance, ctx: AppContext): void {
  const { notifications } = ctx;

  api.get('/notifications', async (request) => {
    const { limit } = parseInput(listQuerySchema, request.query);
    return notifications.list(limit);
  });

  api.post('/notifications/read-all', async () => {
    notifications.markAllRead();
    return notifications.list(50);
  });

  api.post('/notifications/test', async () => notifications.sendTest());

  api.get('/notifications/push', async () => notifications.pushStatus());

  api.post('/notifications/push/subscribe', async (request) =>
    notifications.subscribe(parseInput(pushSubscribeSchema, request.body)),
  );

  api.post('/notifications/push/unsubscribe', async (request) =>
    notifications.unsubscribeEndpoint(parseInput(pushUnsubscribeSchema, request.body).endpoint),
  );

  api.delete('/notifications/push/:id', async (request) => {
    const { id } = parseInput(idParamSchema, request.params);
    return notifications.removeDevice(id);
  });

  api.post('/notifications/:id/respond', async (request) => {
    const { id } = parseInput(idParamSchema, request.params);
    return notifications.respond(id, parseInput(notificationRespondSchema, request.body).action);
  });

  // Called by a button on a phone notification, which has no session or CSRF token. The
  // token is the permission: long, random, single-use, and it can only answer this one
  // notification. It travels in the body so it never appears in a request log.
  api.post('/notification-actions', { config: { public: true } }, async (request) => {
    const { token } = parseInput(notificationActionTokenSchema, request.body);
    notifications.respondWithToken(token);
    return { ok: true };
  });
}
