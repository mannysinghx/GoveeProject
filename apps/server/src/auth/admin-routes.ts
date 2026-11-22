import type { FastifyInstance } from 'fastify';
import { signupSettingsUpdateSchema } from '@glm/shared';
import type { PlatformContext } from '../app/context.js';
import { parseInput } from '../shared/validation.js';

/**
 * Settings for the whole server, for the owner only. The request hook enforces `owner: true`
 * before any of these run, and answers anyone else as if the route did not exist.
 */
export function registerAdminRoutes(api: FastifyInstance, platform: PlatformContext): void {
  const { signup } = platform;

  api.get('/admin/signup', { config: { owner: true } }, async () => signup.settingsDto());

  api.patch('/admin/signup', { config: { owner: true } }, async (request) => {
    const update = parseInput(signupSettingsUpdateSchema, request.body);
    return signup.updateSettings(update, request.session!.userId, request.ip);
  });
}
