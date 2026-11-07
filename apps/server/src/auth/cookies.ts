import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config/env.js';

export const SESSION_COOKIE = 'glm_session';

function useSecure(request: FastifyRequest, config: AppConfig): boolean {
  if (config.cookieSecure === 'auto') return request.protocol === 'https';
  return config.cookieSecure;
}

export function setSessionCookie(
  reply: FastifyReply,
  request: FastifyRequest,
  config: AppConfig,
  token: string,
  expiresAt: string,
): void {
  void reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: useSecure(request, config),
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(reply: FastifyReply, request: FastifyRequest, config: AppConfig): void {
  void reply.clearCookie(SESSION_COOKIE, {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: useSecure(request, config),
  });
}
