import crypto from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { Logger } from 'pino';
import type { ActivityService } from '../activity/activity-service.js';
import type { Db } from '../database/database.js';
import type { Clock } from '../shared/clock.js';
import { AppError } from '../shared/errors.js';

// OWASP's Argon2id minimum configuration. algorithm 2 is Argon2id.
const ARGON2_OPTIONS = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

const THROTTLE = {
  /** Failures from one address before lockouts begin. */
  perAddressFree: 5,
  /** Failures across all addresses before a shared lockout. Slows distributed guessing. */
  globalFree: 30,
  windowMs: 15 * 60 * 1000,
  baseLockMs: 60 * 1000,
  maxLockMs: 30 * 60 * 1000,
  globalLockMs: 5 * 60 * 1000,
};

export interface SessionInfo {
  tokenHash: string;
  username: string;
  csrfToken: string;
  expiresAt: string;
}

interface OwnerRow {
  id: number;
  username: string;
  password_hash: string;
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

export class AuthService {
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly db: Db,
    private readonly activity: ActivityService,
    private readonly logger: Logger,
    private readonly clock: Clock,
    private readonly config: { sessionTtlHours: number; setupCode: string | null },
  ) {}

  setupRequired(): boolean {
    return this.owner() === null;
  }

  setupCodeRequired(): boolean {
    return this.config.setupCode !== null;
  }

  private owner(): OwnerRow | null {
    const row = this.db.prepare('SELECT id, username, password_hash FROM users WHERE id = 1').get() as
      | OwnerRow
      | undefined;
    return row ?? null;
  }

  /** Can succeed once, ever. The CHECK (id = 1) on users also closes the race. */
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
        this.activity.record({ eventType: 'auth', outcome: 'failure', message: 'Owner setup: wrong setup code.', details: { ip } });
        throw new AppError(403, 'invalid_setup_code', 'That setup code is not correct. It is in the server log.');
      }
    }
    const passwordHash = await hashPassword(password);
    const now = this.clock.nowIso();
    try {
      this.db
        .prepare('INSERT INTO users (id, username, password_hash, created_at, updated_at) VALUES (1, ?, ?, ?, ?)')
        .run(username, passwordHash, now, now);
    } catch {
      throw new AppError(409, 'setup_complete', 'This app already has an owner account.');
    }
    this.activity.record({ eventType: 'auth', outcome: 'success', message: 'Owner account created.', details: { ip } });
    this.logger.info({ ip }, 'Owner account created');
    return this.createSession(username);
  }

  async login(username: string, password: string, ip: string): Promise<{ token: string; session: SessionInfo }> {
    // Counted before the slow password check, with no await in between, so parallel guesses
    // cannot all pass the lock check at once. A successful sign-in clears it again.
    this.assertNotLocked(ip);
    this.recordFailure(ip);
    const owner = this.owner();
    // Verify against a dummy hash when the name is wrong, so timing does not reveal it.
    const stored = owner && owner.username.toLowerCase() === username.toLowerCase() ? owner.password_hash : await this.getDummyHash();
    const matches = await verify(stored, password).catch(() => false);
    if (!owner || owner.username.toLowerCase() !== username.toLowerCase() || !matches) {
      this.activity.record({ eventType: 'auth', outcome: 'failure', message: 'Failed login attempt.', details: { ip } });
      this.logger.warn({ ip }, 'Failed login attempt');
      throw new AppError(401, 'invalid_credentials', 'That username or password is not correct.');
    }
    this.clearFailures(ip);
    this.activity.record({ eventType: 'auth', outcome: 'success', message: 'Owner signed in.', details: { ip } });
    this.logger.info({ ip }, 'Owner signed in');
    return this.createSession(owner.username);
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= hashPassword(crypto.randomBytes(32).toString('hex'));
    return this.dummyHash;
  }

  private createSession(username: string): { token: string; session: SessionInfo } {
    const token = crypto.randomBytes(32).toString('base64url');
    const csrfToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    const now = this.clock.nowMs();
    const expiresAt = new Date(now + this.config.sessionTtlHours * 3600 * 1000).toISOString();
    this.db
      .prepare(
        'INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at, created_at) VALUES (?, 1, ?, ?, ?)',
      )
      .run(tokenHash, csrfToken, expiresAt, new Date(now).toISOString());
    return { token, session: { tokenHash, username, csrfToken, expiresAt } };
  }

  validateSession(token: string | undefined): SessionInfo | null {
    if (!token) return null;
    const tokenHash = hashToken(token);
    const row = this.db
      .prepare(
        `SELECT s.token_hash, s.csrf_token, s.expires_at, u.username
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?`,
      )
      .get(tokenHash) as
      | { token_hash: string; csrf_token: string; expires_at: string; username: string }
      | undefined;
    if (!row) return null;
    if (Date.parse(row.expires_at) <= this.clock.nowMs()) {
      this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
      return null;
    }
    return { tokenHash: row.token_hash, username: row.username, csrfToken: row.csrf_token, expiresAt: row.expires_at };
  }

  logout(tokenHash: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    this.activity.record({ eventType: 'auth', outcome: 'info', message: 'Owner signed out.' });
  }

  async changePassword(
    currentPassword: string,
    newPassword: string,
    ip: string,
  ): Promise<{ token: string; session: SessionInfo }> {
    this.assertNotLocked(ip);
    const owner = this.owner();
    if (!owner) throw new AppError(409, 'setup_required', 'No owner account exists yet.');
    this.recordFailure(ip);
    const matches = await verify(owner.password_hash, currentPassword).catch(() => false);
    if (!matches) {
      throw new AppError(403, 'invalid_credentials', 'The current password is not correct.');
    }
    this.clearFailures(ip);
    const passwordHash = await hashPassword(newPassword);
    this.db.transaction(() => {
      this.db
        .prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = 1')
        .run(passwordHash, this.clock.nowIso());
      // Every other browser is signed out. The caller gets a fresh session.
      this.db.prepare('DELETE FROM sessions').run();
    })();
    this.activity.record({ eventType: 'auth', outcome: 'success', message: 'Owner password changed.', details: { ip } });
    this.logger.info({ ip }, 'Owner password changed');
    return this.createSession(owner.username);
  }

  pruneExpiredSessions(): number {
    return this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(this.clock.nowIso()).changes;
  }

  /* -------------------------------- throttling ------------------------------- */

  private attempt(key: string): AttemptRow | null {
    const row = this.db.prepare('SELECT * FROM login_attempts WHERE throttle_key = ?').get(key) as
      | AttemptRow
      | undefined;
    return row ?? null;
  }

  private assertNotLocked(ip: string): void {
    const now = this.clock.nowMs();
    for (const key of [`ip:${ip}`, 'global']) {
      const row = this.attempt(key);
      if (row?.locked_until && Date.parse(row.locked_until) > now) {
        const retryAfter = Math.ceil((Date.parse(row.locked_until) - now) / 1000);
        throw new AppError(
          429,
          'login_throttled',
          `Too many failed attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`,
          undefined,
          retryAfter,
        );
      }
    }
  }

  private recordFailure(ip: string): void {
    const now = this.clock.nowMs();
    const bump = (key: string, lockFor: (failures: number) => number | null) => {
      const row = this.attempt(key);
      const expired = !row || now - Date.parse(row.window_started) > THROTTLE.windowMs;
      const failures = expired ? 1 : row.failures + 1;
      const windowStarted = expired ? new Date(now).toISOString() : row.window_started;
      const lockMs = lockFor(failures);
      this.db
        .prepare(
          `INSERT INTO login_attempts (throttle_key, failures, window_started, locked_until) VALUES (?, ?, ?, ?)
           ON CONFLICT(throttle_key) DO UPDATE SET
             failures = excluded.failures, window_started = excluded.window_started, locked_until = excluded.locked_until`,
        )
        .run(key, failures, windowStarted, lockMs === null ? null : new Date(now + lockMs).toISOString());
    };
    bump(`ip:${ip}`, (failures) =>
      failures < THROTTLE.perAddressFree
        ? null
        : Math.min(THROTTLE.maxLockMs, THROTTLE.baseLockMs * 2 ** (failures - THROTTLE.perAddressFree)),
    );
    bump('global', (failures) => (failures < THROTTLE.globalFree ? null : THROTTLE.globalLockMs));
  }

  private clearFailures(ip: string): void {
    this.db.prepare('DELETE FROM login_attempts WHERE throttle_key IN (?, ?)').run(`ip:${ip}`, 'global');
  }
}
