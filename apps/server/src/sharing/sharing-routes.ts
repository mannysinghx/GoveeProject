import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  adminSharedUpdateSchema,
  adminSharingBlockSchema,
  displayNameRequestSchema,
  idParamSchema,
  importPreviewRequestSchema,
  importRequestSchema,
  shareRequestSchema,
  shareUpdateSchema,
} from '@glm/shared';
import type { PlatformContext } from '../app/context.js';
import { parseInput } from '../shared/validation.js';

const userParamSchema = z.object({ id: z.coerce.number().int().positive() });

/**
 * The Shared space. Every route works on the signed-in person's own account and shares; the
 * owner's moderation routes are marked owner-only.
 */
export function registerSharingRoutes(api: FastifyInstance, platform: PlatformContext): void {
  const { sharing } = platform;

  api.put('/account/display-name', async (request) => {
    const { displayName } = parseInput(displayNameRequestSchema, request.body);
    return sharing.setDisplayName(request.session!, displayName, request.ip);
  });

  api.get('/shared', async (request) => sharing.list(request.session!));

  api.post('/shared', async (request, reply) => {
    const body = parseInput(shareRequestSchema, request.body);
    return reply.status(201).send(sharing.share(request.session!, body, request.ip));
  });

  api.post('/shared/share-all', { config: { owner: true } }, async (request) => sharing.shareAll(request.session!, request.ip));

  api.put('/shared/:id', async (request) => {
    const { id } = parseInput(idParamSchema, request.params);
    return sharing.update(request.session!, id, parseInput(shareUpdateSchema, request.body), request.ip);
  });

  api.delete('/shared/:id', async (request, reply) => {
    const { id } = parseInput(idParamSchema, request.params);
    sharing.stop(request.session!, id, request.ip);
    return reply.status(204).send();
  });

  api.post('/shared/import/preview', async (request) => {
    const { itemIds } = parseInput(importPreviewRequestSchema, request.body);
    return sharing.preview(request.session!, itemIds);
  });

  api.post('/shared/import', async (request) => sharing.import(request.session!, parseInput(importRequestSchema, request.body), request.ip));

  /* ---------------------------------- owner ----------------------------------- */

  api.get('/admin/shared', { config: { owner: true } }, async (request) => ({ items: sharing.adminList(request.session!.userId) }));

  api.patch('/admin/shared/:id', { config: { owner: true } }, async (request) => {
    const { id } = parseInput(idParamSchema, request.params);
    const { hidden } = parseInput(adminSharedUpdateSchema, request.body);
    return { items: sharing.setHidden(request.session!.userId, id, hidden, request.ip) };
  });

  api.delete('/admin/shared/:id', { config: { owner: true } }, async (request) => {
    const { id } = parseInput(idParamSchema, request.params);
    return { items: sharing.remove(request.session!.userId, id, request.ip) };
  });

  api.put('/admin/accounts/:id/sharing', { config: { owner: true } }, async (request) => {
    const { id } = parseInput(userParamSchema, request.params);
    const { blocked } = parseInput(adminSharingBlockSchema, request.body);
    sharing.setSharingBlocked(request.session!.userId, id, blocked, request.ip);
    return { accounts: platform.account.listAccounts() };
  });

  api.delete('/admin/accounts/:id/display-name', { config: { owner: true } }, async (request) => {
    const { id } = parseInput(userParamSchema, request.params);
    sharing.resetDisplayName(request.session!.userId, id, request.ip);
    return { accounts: platform.account.listAccounts() };
  });
}
