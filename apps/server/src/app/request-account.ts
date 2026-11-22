import type { FastifyRequest } from 'fastify';
import { AppError } from '../shared/errors.js';
import type { AccountContext } from './context.js';

/**
 * The signed-in person's account, for this request only. Every route that touches lights,
 * schedules, notifications or history gets its services from here, never from a variable
 * captured when the routes were registered.
 */
export function accountOf(request: FastifyRequest): AccountContext {
  if (!request.account) throw new AppError(401, 'unauthenticated', 'Sign in to continue.');
  return request.account;
}
