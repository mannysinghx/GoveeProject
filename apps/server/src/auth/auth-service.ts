import crypto from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { Logger } from 'pino';
import type { ActivityService } from '../activity/activity-service.js';
import type { Db } from '../database/database.js';
import type { Clock } from '../shared/clock.js';
import { AppError } from '../shared/errors.js';
import type { LegacyOwnerMirror } from './control.js';

// OWASP's Argon2id minimum configuration. algorithm 2 is Argon2id.
const ARGON2_OPTIONS = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

/**
 * Failures are counted three ways, so no single counter can lock out everyone:
 * - one name from one address ("pair"): the tight limit, which also stops bursts;
 * - one address, any names ("ip"): stops one address trying many accounts;
 * - one name, any addresses ("id"): slows guessing spread across many addresses, for that
 *   name only.
 * A successful sign-in clears only its own pair. There is no counter shared by every account.
 */
const THROTTLE = {
  windowMs: 15 * 60 * 1000,
  pairFree: 5,
  ipFree: 30,
  identityFree: 30,
  baseLockMs: 60 * 1000,
  maxLockMs: 30 * 60 * 1000,
  identityLockMs: 5 * 60 * 1000,
};

/** Each hash takes 19 MiB. More at once than this wait their turn, and a long queue is refused. */
const HASH_CONCURRENCY = 4;
const HASH_MAX_WAITING = 64;

export interface SessionInfo {
  tokenHash: string;
  /** Whose session this is. Requests are served from this user's account. */
  userId: number;
  /** What to show as signed in: the username, or the email when there is none. */
  username: string;
  csrfToken: string;
  expiresAt: string;
}

interface UserRow {
  id: number;
  username: string | null;
  email: string | null;
  password_hash: string;
  role: 'owner' | 'member';
  status: 'active' | 'suspended';
}

interface AttemptRow {
  throttle_key: string;
  failures: number;
  window_started: string;
  locked_until: string | null;
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function constantTimeEqual(a: string, b: string): boolean {
  const left = crypto.createHash('sha256').update(a).digest();
  const right = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(left, right);
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS as never);
}

/** Typed names are kept only as this hash in the throttling table. */
export function identifierHash(identifier: string): string {
  return crypto.createHash('sha256').update(`glm-login:${identifier.trim().toLowerCase()}`).digest('hex').slice(0, 32);
}

const displayName = (user: { username: string | null; email: string | null }) => user.username ?? user.email ?? '';

/** Limits how many password hashes run at once. */
class HashLimiter {
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.running >= HASH_CONCURRENCY) {
      if (this.waiting.length >= HASH_MAX_WAITING) {
        throw new AppError(429, 'auth_busy', 'Too many sign-ins at once. Try again in a moment.', undefined, 5);
      }
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.running += 1;
    try {
      return await work();
    } finally {
      this.running -= 1;
      this.waiting.shift()?.();
    }
  }
}

export interface AuthOptions {
  sessionTtlHours: number;
  setupCode: string | null;
  /** The owner's account file, as recorded on the owner's row at setup. */
  ownerAccountFile: string;
  /** Called once setup has made the owner, for anything that belongs to that user row. */
  onOwnerCreated?: () => void;
}

/**
 * Accounts, sign-in and sessions, in the control database. Activity a person would want to
 * see goes to their own account's activity log; every event also goes to the audit log.
 */
export class AuthService {
  private dummyHash: Promise<string> | null = null;
  private readonly hashes = new HashLimiter();

  constructor(
    private readonly control: Db,
    /** That user's activity log, or the owner's for a sign-in attempt under an unknown name. */
    private readonly activityFor: (userId: number | null) => ActivityService | null,
    private readonly logger: Logger,
    private readonly clock: Clock,
    private readonly config: AuthOptions,
    /** Keeps the owner's old tables in step while they exist, so a rollback stays safe. */
    private readonly legacy: LegacyOwnerMirror | null = null,
  ) {}

  setupRequired(): boolean {
    return this.control.prepare('SELECT 1 FROM users LIMIT 1').get() === undefined;
  }

  setupCodeRequired(): boolean {
    return this.config.setupCode !== null;
  }

  private audit(userId: number | null, event: string, ip: string | null, details?: Record<string, unknown>): void {
    this.control
      .prepare('INSERT INTO audit_events (created_at, user_id, event, ip, details_json) VALUES (?, ?, ?, ?, ?)')
      .run(this.clock.nowIso(), userId, event, ip, details ? JSON.stringify(details) : null);
  }

  private findUser(identifier: string): UserRow | null {
    const name = identifier.trim();
    if (name === '') return null;
    return (
      (this.control
        .prepare(
          'SELECT id, username, email, password_hash, role, status FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE LIMIT 1',
        )
        .get(name, name) as UserRow | undefined) ?? null
    );
  }

  private userById(id: number): UserRow | null {
    return (this.control.prepare('SELECT id, username, email, password_hash, role, status FROM users WHERE id = ?').get(id) as UserRow | undefined) ?? null;
  }

  /** The first account, which can only be made once: the owner, user 1. */
  async setup(
    username: string,
    password: string,
    setupCode: string | undefined,
    ip: string,
  ): Promise<{ token: string; session: SessionInfo }> {
    if (!this.setupRequired()) {
      throw new AppError(409, 'setup_complete', 'This app already has an owner account.');
    }
    if (this.config.setupCode !== null) {
      if (!setupCode || !constantTimeEqual(setupCode.trim(), this.config.setupCode)) {
        this.activityFor(null)?.record({ eventType: 'auth', outcome: 'failure', message: 'Owner setup: wrong setup code.', details: { ip } });
        this.audit(null, 'setup_wrong_code', ip);
        throw new AppError(403, 'invalid_setup_code', 'That setup code is not correct. It is in the server log.');
      }
    }
    const passwordHash = await this.hashes.run(() => hashPassword(password));
    const now = this.clock.nowIso();
    try {
      // id 1 and the owner role, which the table allows only together: a second setup, even
      // one racing this one, fails on the primary key.
      this.control
        .prepare(
          `INSERT INTO users (id, username, password_hash, role, status, account_file, created_at, updated_at)
           VALUES (1, ?, ?, 'owner', 'active', ?, ?, ?)`,
        )
        .run(username, passwordHash, this.config.ownerAccountFile, now, now);
    } catch {
      throw new AppError(409, 'setup_complete', 'This app already has an owner account.');
    }
    this.activityFor(1)?.record({ eventType: 'auth', outcome: 'success', message: 'Owner account created.', details: { ip } });
    this.audit(1, 'setup', ip);
    this.logger.info({ ip }, 'Owner account created');
    try {
      this.config.onOwnerCreated?.();
    } catch (error) {
      this.logger.warn({ err: error }, 'Could not finish setting up the owner account');
    }
    return this.createSession(1, username);
  }

  async login(identifier: string, password: string, ip: string): Promise<{ token: string; session: SessionInfo }> {
    const idHash = identifierHash(identifier);
    const keys = { pair: `pair:${idHash}:${ip}`, ip: `ip:${ip}`, id: `id:${idHash}` };
    // Counted before the slow password check, with no await in between, so parallel guesses
    // cannot all pass the lock check at once. A successful sign-in takes the count back.
    this.assertNotLocked([keys.pair, keys.ip, keys.id]);
    this.recordFailure(keys);
    const user = this.findUser(identifier);
    // Verify against a dummy hash when the name is unknown, so timing does not reveal it.
    const stored = user ? user.password_hash : await this.getDummyHash();
    const matches = await this.hashes.run(() => verify(stored, password).catch(() => false));
    if (!user || !matches) {
      this.activityFor(user?.id ?? null)?.record({ eventType: 'auth', outcome: 'failure', message: 'Failed login attempt.', details: { ip } });
      this.audit(user?.id ?? null, 'login_failed', ip);
      this.logger.warn({ ip }, 'Failed login attempt');
      throw new AppError(401, 'invalid_credentials', 'That username or password is not correct.');
    }
    this.forgive(keys);
    if (user.status !== 'active') {
      this.audit(user.id, 'login_suspended', ip);
      throw new AppError(403, 'account_suspended', 'This account is suspended.');
    }
    const who = user.role === 'owner' ? 'Owner' : 'User';
    this.activityFor(user.id)?.record({ eventType: 'auth', outcome: 'success', message: `${who} signed in.`, details: { ip } });
    this.audit(user.id, 'login', ip);
    this.logger.info({ ip, userId: user.id }, `${who} signed in`);
    return this.createSession(user.id, displayName(user));
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= hashPassword(crypto.randomBytes(32).toString('hex'));
    return this.dummyHash;
  }

  private createSession(userId: number, display: string): { token: string; session: SessionInfo } {
    const token = crypto.randomBytes(32).toString('base64url');
    const csrfToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    const now = this.clock.nowMs();
    const expiresAt = new Date(now + this.config.sessionTtlHours * 3600 * 1000).toISOString();
    this.control
      .prepare('INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(tokenHash, userId, csrfToken, expiresAt, new Date(now).toISOString());
    return { token, session: { tokenHash, userId, username: display, csrfToken, expiresAt } };
  }

  validateSession(token: string | undefined): SessionInfo | null {
    if (!token) return null;
    const tokenHash = hashToken(token);
    const row = this.control
      .prepare(
        `SELECT s.token_hash, s.user_id, s.csrf_token, s.expires_at, u.username, u.email, u.status
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?`,
      )
      .get(tokenHash) as
      | { token_hash: string; user_id: number; csrf_token: string; expires_at: string; username: string | null; email: string | null; status: string }
      | undefined;
    if (!row) return null;
    if (Date.parse(row.expires_at) <= this.clock.nowMs()) {
      this.control.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
      return null;
    }
    if (row.status !== 'active') return null;
    return {
      tokenHash: row.token_hash,
      userId: row.user_id,
      username: displayName(row),
      csrfToken: row.csrf_token,
      expiresAt: row.expires_at,
    };
  }

  logout(session: SessionInfo): void {
    this.control.prepare('DELETE FROM sessions WHERE token_hash = ?').run(session.tokenHash);
    if (session.userId === 1) this.legacy?.signedOut(session.tokenHash);
    const user = this.userById(session.userId);
    this.activityFor(session.userId)?.record({
      eventType: 'auth',
      outcome: 'info',
      message: `${user?.role === 'owner' ? 'Owner' : 'User'} signed out.`,
    });
    this.audit(session.userId, 'logout', null);
  }

  async changePassword(
    userId: number,
    currentPassword: string,
    newPassword: string,
    ip: string,
  ): Promise<{ token: string; session: SessionInfo }> {
    const keys = { pair: `pair:user-${userId}:${ip}`, ip: `ip:${ip}` };
    this.assertNotLocked([keys.pair, keys.ip]);
    const user = this.userById(userId);
    if (!user) throw new AppError(409, 'setup_required', 'No owner account exists yet.');
    this.recordFailure(keys);
    const matches = await this.hashes.run(() => verify(user.password_hash, currentPassword).catch(() => false));
    if (!matches) {
      this.audit(userId, 'password_change_failed', ip);
      throw new AppError(403, 'invalid_credentials', 'The current password is not correct.');
    }
    this.forgive(keys);
    const passwordHash = await this.hashes.run(() => hashPassword(newPassword));
    const now = this.clock.nowIso();
    this.control.transaction(() => {
      this.control.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, now, userId);
      // This person's other browsers are signed out. Nobody else's are. The caller gets a fresh session.
      this.control.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    })();
    if (userId === 1) this.legacy?.passwordChanged(passwordHash, now);
    const who = user.role === 'owner' ? 'Owner' : 'User';
    this.activityFor(userId)?.record({ eventType: 'auth', outcome: 'success', message: `${who} password changed.`, details: { ip } });
    this.audit(userId, 'password_changed', ip);
    this.logger.info({ ip, userId }, `${who} password changed`);
    return this.createSession(userId, displayName(user));
  }

  /** Expired sessions, and throttling rows that no longer lock anything. */
  pruneExpiredSessions(): number {
    const now = this.clock.nowIso();
    const removed = this.control.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now).changes;
    const windowStart = new Date(this.clock.nowMs() - THROTTLE.windowMs).toISOString();
    this.control
      .prepare('DELETE FROM login_attempts WHERE window_started < ? AND (locked_until IS NULL OR locked_until <= ?)')
      .run(windowStart, now);
    this.legacy?.pruneExpired(now);
    return removed;
  }

  /* -------------------------------- throttling ------------------------------- */

  private attempt(key: string): AttemptRow | null {
    const row = this.control.prepare('SELECT * FROM login_attempts WHERE throttle_key = ?').get(key) as AttemptRow | undefined;
    return row ?? null;
  }

  private assertNotLocked(keys: string[]): void {
    const now = this.clock.nowMs();
    let longest = 0;
    for (const key of keys) {
      const row = this.attempt(key);
      if (row?.locked_until && Date.parse(row.locked_until) > now) longest = Math.max(longest, Date.parse(row.locked_until) - now);
    }
    if (longest > 0) {
      const retryAfter = Math.ceil(longest / 1000);
      throw new AppError(
        429,
        'login_throttled',
        `Too many failed attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`,
        undefined,
        retryAfter,
      );
    }
  }

  private bump(key: string, lockFor: (failures: number) => number | null): void {
    const now = this.clock.nowMs();
    const row = this.attempt(key);
    const expired = !row || now - Date.parse(row.window_started) > THROTTLE.windowMs;
    const failures = expired ? 1 : row.failures + 1;
    const windowStarted = expired ? new Date(now).toISOString() : row.window_started;
    const lockMs = lockFor(failures);
    this.control
      .prepare(
        `INSERT INTO login_attempts (throttle_key, failures, window_started, locked_until) VALUES (?, ?, ?, ?)
         ON CONFLICT(throttle_key) DO UPDATE SET
           failures = excluded.failures, window_started = excluded.window_started, locked_until = excluded.locked_until`,
      )
      .run(key, failures, windowStarted, lockMs === null ? null : new Date(now + lockMs).toISOString());
  }

  private recordFailure(keys: { pair: string; ip: string; id?: string }): void {
    const escalating = (free: number) => (failures: number) =>
      failures < free ? null : Math.min(THROTTLE.maxLockMs, THROTTLE.baseLockMs * 2 ** (failures - free));
    this.control.transaction(() => {
      this.bump(keys.pair, escalating(THROTTLE.pairFree));
      this.bump(keys.ip, escalating(THROTTLE.ipFree));
      if (keys.id) this.bump(keys.id, (failures) => (failures < THROTTLE.identityFree ? null : THROTTLE.identityLockMs));
    })();
  }

  /** Takes back the count made before a check that then succeeded. Only this pair is cleared. */
  private forgive(keys: { pair: string; ip: string; id?: string }): void {
    this.control.transaction(() => {
      this.control.prepare('DELETE FROM login_attempts WHERE throttle_key = ?').run(keys.pair);
      const others = [keys.ip, ...(keys.id ? [keys.id] : [])];
      for (const key of others) {
        this.control.prepare('UPDATE login_attempts SET failures = MAX(0, failures - 1) WHERE throttle_key = ? AND locked_until IS NULL').run(key);
      }
    })();
  }
}
