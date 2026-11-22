import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  changePasswordRequestSchema,
  loginRequestSchema,
  setupRequestSchema,
  type SessionDto,
} from '@glm/shared';
import type { PlatformContext } from '../app/context.js';
import { parseInput } from '../shared/validation.js';
import type { SessionInfo } from './auth-service.js';
import { clearSessionCookie, setSessionCookie } from './cookies.js';

function sessionDto(platform: PlatformContext, session: SessionInfo | null): SessionDto {
  return {
    setupRequired: platform.auth.setupRequired(),
    setupCodeRequired: platform.auth.setupRequired() && platform.auth.setupCodeRequired(),
    authenticated: session !== null,
    username: session?.username ?? null,
    csrfToken: session?.csrfToken ?? null,
    expiresAt: session?.expiresAt ?? null,
  };
}

const clientIp = (request: FastifyRequest) => request.ip;

export function registerAuthRoutes(api: FastifyInstance, platform: PlatformContext): void {
  const { auth, config } = platform;

  api.get('/auth/session', { config: { public: true } }, async (request) => {
    return sessionDto(platform, request.session);
  });

  api.post('/auth/setup', { config: { public: true } }, async (request, reply) => {
    const body = parseInput(setupRequestSchema, request.body);
    const { token, session } = await auth.setup(body.username, body.password, body.setupCode, clientIp(request));
    setSessionCookie(reply, request, config, token, session.expiresAt);
    return reply.status(201).send(sessionDto(platform, session));
  });

  api.post('/auth/login', { config: { public: true } }, async (request, reply) => {
    const body = parseInput(loginRequestSchema, request.body);
    const { token, session } = await auth.login(body.username, body.password, clientIp(request));
    setSessionCookie(reply, request, config, token, session.expiresAt);
    return sessionDto(platform, session);
  });

  api.post('/auth/logout', async (request, reply) => {
    if (request.session) auth.logout(request.session.tokenHash);
    clearSessionCookie(reply, request, config);
    return reply.status(204).send();
  });

  api.post('/auth/change-password', async (request, reply) => {
    const body = parseInput(changePasswordRequestSchema, request.body);
    const { token, session } = await auth.changePassword(
      body.currentPassword,
      body.newPassword,
      clientIp(request),
    );
    setSessionCookie(reply, request, config, token, session.expiresAt);
    return sessionDto(platform, session);
  });
}
