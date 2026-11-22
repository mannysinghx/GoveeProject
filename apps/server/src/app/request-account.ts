import type { FastifyRequest } from 'fastify';
import { MEMBER_LIMITS } from '@glm/shared';
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

/** What counts against a member's caps. Built-in presets and holiday shows do not. */
const CAP_COUNTS = {
  groups: 'SELECT COUNT(*) AS n FROM groups',
  presets: 'SELECT COUNT(*) AS n FROM presets WHERE builtin_key IS NULL',
  schedules: 'SELECT COUNT(*) AS n FROM schedules WHERE builtin_show IS NULL',
} as const;

const CAP_NAMES = { groups: 'groups', presets: 'presets', schedules: 'schedules' } as const;

/**
 * Refuses to make one more of something when a member's account already has its share. The
 * owner has no caps. Called by the routes that create groups, presets and schedules.
 */
export function assertRoomFor(request: FastifyRequest, kind: keyof typeof CAP_COUNTS): void {
  if (request.session?.role !== 'member') return;
  const { n } = accountOf(request).db.prepare(CAP_COUNTS[kind]).get() as { n: number };
  const limit = MEMBER_LIMITS[kind];
  if (n >= limit) {
    throw new AppError(409, 'account_limit_reached', `An account can have at most ${limit} ${CAP_NAMES[kind]}. Delete one to make room.`);
  }
}
