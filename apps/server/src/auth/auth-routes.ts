import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  changeEmailRequestSchema,
  changePasswordRequestSchema,
  completeSignupRequestSchema,
  confirmEmailRequestSchema,
  forgotPasswordRequestSchema,
  linkCheckRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  setupRequestSchema,
  type ChallengeDto,
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
    signupOpen: platform.signup.isOpen(),
    email: session?.email ?? null,
    role: session?.role ?? null,
  };
}

const clientIp = (request: FastifyRequest) => request.ip;

/** The same answer for every address, known or not. */
const SENT_IF_POSSIBLE = { ok: true } as const;

export function registerAuthRoutes(api: FastifyInstance, platform: PlatformContext): void {
  const { auth, config, signup, pow } = platform;

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
    if (request.session) auth.logout(request.session);
    clearSessionCookie(reply, request, config);
    return reply.status(204).send();
  });

  api.post('/auth/change-password', async (request, reply) => {
    const body = parseInput(changePasswordRequestSchema, request.body);
    // A signed-in route: the hook has already refused any request without a session.
    const { token, session } = await auth.changePassword(
      request.session!.userId,
      body.currentPassword,
      body.newPassword,
      clientIp(request),
    );
    setSessionCookie(reply, request, config, token, session.expiresAt);
    return sessionDto(platform, session);
  });

  /* ----------------------------- email sign-up ----------------------------- */

  // The browser solves this before sending the register or forgot-password form.
  api.get('/auth/challenge', { config: { public: true } }, async (_request, reply): Promise<ChallengeDto> => {
    void reply.header('cache-control', 'no-store');
    return pow.issue();
  });

  api.post('/auth/register', { config: { public: true } }, async (request, reply) => {
    const body = parseInput(registerRequestSchema, request.body);
    signup.register(body, clientIp(request));
    return reply.status(202).send(SENT_IF_POSSIBLE);
  });

  // Opening a link only asks what it is for. Nothing is used up until the form is sent.
  api.post('/auth/link/check', { config: { public: true } }, async (request) => {
    return signup.checkLink(parseInput(linkCheckRequestSchema, request.body).token);
  });

  // Makes the account. Signs nobody in: the person signs in with their new password next.
  api.post('/auth/register/complete', { config: { public: true } }, async (request, reply) => {
    const body = parseInput(completeSignupRequestSchema, request.body);
    const result = await signup.completeSignup(body.token, body.password, clientIp(request));
    return reply.status(201).send(result);
  });

  api.post('/auth/password/forgot', { config: { public: true } }, async (request, reply) => {
    const body = parseInput(forgotPasswordRequestSchema, request.body);
    signup.forgotPassword(body, clientIp(request));
    return reply.status(202).send(SENT_IF_POSSIBLE);
  });

  api.post('/auth/password/reset', { config: { public: true } }, async (request, reply) => {
    const body = parseInput(resetPasswordRequestSchema, request.body);
    const result = await signup.resetPassword(body.token, body.password, clientIp(request));
    // Every session of this person was ended, including this browser's, if it had one.
    clearSessionCookie(reply, request, config);
    return result;
  });

  // Signed in, with the current password: sends a link to the new address.
  api.post('/auth/email/change', async (request, reply) => {
    const body = parseInput(changeEmailRequestSchema, request.body);
    await signup.requestEmailChange(request.session!.userId, body.newEmail, body.currentPassword, clientIp(request));
    return reply.status(202).send(SENT_IF_POSSIBLE);
  });

  // Public, because the link may be opened in a browser that is not signed in. The token is the permission.
  api.post('/auth/email/confirm', { config: { public: true } }, async (request) => {
    return signup.confirmEmailChange(parseInput(confirmEmailRequestSchema, request.body).token, clientIp(request));
  });
}
