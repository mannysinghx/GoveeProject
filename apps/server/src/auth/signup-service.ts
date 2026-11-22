import crypto from 'node:crypto';
import type { Logger } from 'pino';
import type { LinkCheckDto, SignupSettingsDto, SignupSettingsUpdate } from '@glm/shared';
import type { Db } from '../database/database.js';
import type { MailOutbox } from '../mail/outbox.js';
import { alreadyRegisteredMail, emailChangedNotice, emailChangeMail, resetMail, signupMail } from '../mail/templates.js';
import type { ProofOfWork } from '../security/proof-of-work.js';
import type { Clock } from '../shared/clock.js';
import { AppError } from '../shared/errors.js';
import { hashToken, type AuthService } from './auth-service.js';
import type { LegacyOwnerMirror } from './control.js';

/** How long a link from an email works. */
export const LINK_TTL_MINUTES = 30;
const LINK_TTL_MS = LINK_TTL_MINUTES * 60_000;

/**
 * Per address, whoever asks: at most one email a minute and five a day, so the forms cannot be
 * used to flood someone's inbox. Per network address: at most ten requests an hour per form.
 */
export const MAIL_LIMITS = { perMinute: 1, perDay: 5, perIpPerHour: 10 } as const;

const SIGNUP_DEFAULTS = { enabled: false, dailyCap: 50, totalCap: 500 };
type SignupSettings = typeof SIGNUP_DEFAULTS;

type Purpose = LinkCheckDto['purpose'];

interface TokenRow {
  token_hash: string;
  purpose: Purpose;
  email: string;
  user_id: number | null;
  expires_at: string;
  used_at: string | null;
}

const LINK_INVALID = () =>
  new AppError(400, 'link_invalid', 'This link has expired or has already been used. Ask for a new one.');

export interface SignupDeps {
  control: Db;
  auth: AuthService;
  outbox: MailOutbox;
  pow: ProofOfWork;
  clock: Clock;
  logger: Logger;
  publicUrl: string;
  /** Keeps the owner's old tables in step after a reset, so a rollback stays safe. */
  legacy: LegacyOwnerMirror | null;
  /** Makes the new person's account file and loads it. Called after the user row is committed. */
  onAccountCreated: (userId: number, accountFile: string) => void;
}

/**
 * Sign-up by email, password reset by email, and changing the sign-in address. The answers
 * to register and forgot-password are the same whether or not an address has an account, and
 * the mail goes out from the outbox afterwards, so neither the answer nor its timing tells.
 */
export class SignupService {
  constructor(private readonly deps: SignupDeps) {}

  private get control(): Db {
    return this.deps.control;
  }

  /* ------------------------------- settings -------------------------------- */

  settings(): SignupSettings {
    const row = this.control.prepare("SELECT value_json FROM platform_settings WHERE key = 'signup'").get() as { value_json: string } | undefined;
    if (!row) return { ...SIGNUP_DEFAULTS };
    try {
      return { ...SIGNUP_DEFAULTS, ...(JSON.parse(row.value_json) as Partial<SignupSettings>) };
    } catch {
      return { ...SIGNUP_DEFAULTS };
    }
  }

  settingsDto(): SignupSettingsDto {
    const settings = this.settings();
    const counts = this.memberCounts();
    const mail = this.deps.outbox.stats();
    return {
      ...settings,
      mailConfigured: this.deps.outbox.configured(),
      createdLastDay: counts.lastDay,
      createdTotal: counts.total,
      mailQueued: mail.queued,
      mailFailedLastDay: mail.failedLastDay,
    };
  }

  updateSettings(update: SignupSettingsUpdate, userId: number, ip: string): SignupSettingsDto {
    const next = { ...this.settings(), ...update };
    if (next.enabled && !this.deps.outbox.configured()) {
      throw new AppError(409, 'mail_not_configured', 'Sign-up needs email, which is not set up yet.');
    }
    this.control
      .prepare(
        `INSERT INTO platform_settings (key, value_json, updated_at) VALUES ('signup', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run(JSON.stringify(next), this.deps.clock.nowIso());
    this.deps.auth.audit(userId, 'signup_settings_changed', ip, next);
    this.deps.logger.info({ ...next }, 'Sign-up settings changed');
    return this.settingsDto();
  }

  private memberCounts(): { lastDay: number; total: number } {
    const since = new Date(this.deps.clock.nowMs() - 24 * 3600_000).toISOString();
    const total = (this.control.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'member'").get() as { n: number }).n;
    const lastDay = (
      this.control.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'member' AND created_at >= ?").get(since) as { n: number }
    ).n;
    return { lastDay, total };
  }

  /** Open only when switched on, mail is set up, and both caps have room. */
  isOpen(): boolean {
    return this.closedReason() === null;
  }

  private closedReason(): AppError | null {
    const settings = this.settings();
    if (!settings.enabled || !this.deps.outbox.configured()) {
      return new AppError(403, 'signup_closed', 'New accounts cannot be created right now.');
    }
    const counts = this.memberCounts();
    if (counts.total >= settings.totalCap) {
      return new AppError(403, 'signup_full', 'This site has all the accounts it can take for now. Try again later.');
    }
    if (counts.lastDay >= settings.dailyCap) {
      return new AppError(403, 'signup_full', 'Enough accounts have been made today. Try again tomorrow.');
    }
    return null;
  }

  /* ------------------------------- abuse limits ----------------------------- */

  /** Counts a request against a limit. False once the limit is reached in this window. */
  private hit(key: string, limit: number, windowMs: number): boolean {
    const now = this.deps.clock.nowMs();
    return this.control.transaction(() => {
      const row = this.control.prepare('SELECT window_started, count FROM request_limits WHERE limit_key = ?').get(key) as
        | { window_started: string; count: number }
        | undefined;
      const fresh = !row || now - Date.parse(row.window_started) >= windowMs;
      const count = fresh ? 1 : row.count + 1;
      this.control
        .prepare(
          `INSERT INTO request_limits (limit_key, window_started, count) VALUES (?, ?, ?)
           ON CONFLICT(limit_key) DO UPDATE SET window_started = excluded.window_started, count = excluded.count`,
        )
        .run(key, fresh ? new Date(now).toISOString() : row.window_started, count);
      return count <= limit;
    })();
  }

  private limitIp(form: string, ip: string): void {
    if (!this.hit(`${form}:ip:${ip}`, MAIL_LIMITS.perIpPerHour, 3600_000)) {
      throw new AppError(429, 'too_many_requests', 'Too many requests from your network. Try again in an hour.', undefined, 3600);
    }
  }

  private checkProof(challenge: string, nonce: string): void {
    if (!this.deps.pow.verify(challenge, nonce)) {
      throw new AppError(400, 'challenge_failed', 'The browser check did not finish. Reload the page and try again.');
    }
  }

  /** False when this address has had its share of email, whoever asked. Nothing says so to the caller. */
  private addressHasRoom(email: string): boolean {
    const now = this.deps.clock.nowMs();
    const outbox = this.deps.outbox;
    return outbox.countToAddress(email, now - 60_000) < MAIL_LIMITS.perMinute && outbox.countToAddress(email, now - 24 * 3600_000) < MAIL_LIMITS.perDay;
  }

  /* --------------------------------- tokens --------------------------------- */

  private issueToken(purpose: Purpose, email: string, userId: number | null): string {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = this.deps.clock.nowMs();
    this.control.transaction(() => {
      // A new link replaces any unused one for the same purpose, so old links stop working.
      if (purpose === 'signup') {
        this.control.prepare("DELETE FROM email_tokens WHERE purpose = 'signup' AND email = ? AND used_at IS NULL").run(email);
      } else {
        this.control.prepare('DELETE FROM email_tokens WHERE purpose = ? AND user_id = ? AND used_at IS NULL').run(purpose, userId);
      }
      this.control
        .prepare('INSERT INTO email_tokens (token_hash, purpose, email, user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(hashToken(token), purpose, email, userId, new Date(now).toISOString(), new Date(now + LINK_TTL_MS).toISOString());
    })();
    return token;
  }

  /** The token's row while it can still be used. Opening a link only ever calls this. */
  private liveToken(token: string, purpose?: Purpose): TokenRow | null {
    const row = this.control
      .prepare('SELECT token_hash, purpose, email, user_id, expires_at, used_at FROM email_tokens WHERE token_hash = ?')
      .get(hashToken(token)) as TokenRow | undefined;
    if (!row || row.used_at !== null || Date.parse(row.expires_at) <= this.deps.clock.nowMs()) return null;
    if (purpose && row.purpose !== purpose) return null;
    return row;
  }

  /** Marks the token used, inside the caller's transaction. False if someone got there first. */
  private useToken(row: TokenRow): boolean {
    return (
      this.control
        .prepare('UPDATE email_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?')
        .run(this.deps.clock.nowIso(), row.token_hash, this.deps.clock.nowIso()).changes === 1
    );
  }

  private link(path: string, token: string): string {
    return `${this.deps.publicUrl}${path}#t=${token}`;
  }

  /** Says what a link is for. Changes nothing, so a mail scanner opening it is harmless. */
  checkLink(token: string): LinkCheckDto {
    const row = this.liveToken(token);
    if (!row) throw LINK_INVALID();
    return { purpose: row.purpose, email: row.email };
  }

  private userByEmail(email: string): { id: number; email: string | null; role: string; status: string } | null {
    return (
      (this.control.prepare('SELECT id, email, role, status FROM users WHERE email = ? OR username = ? LIMIT 1').get(email, email) as
        | { id: number; email: string | null; role: string; status: string }
        | undefined) ?? null
    );
  }

  /* --------------------------------- sign-up -------------------------------- */

  /**
   * Always ends the same way for the caller. A new address gets a link to choose a password; an
   * address with an account gets a note saying so. No account is made until the link is used.
   */
  register(input: { email: string; challenge: string; nonce: string; website?: string | undefined }, ip: string): void {
    const closed = this.closedReason();
    if (closed) throw closed;
    this.limitIp('register', ip);
    this.checkProof(input.challenge, input.nonce);
    if (input.website) {
      this.deps.auth.audit(null, 'register_honeypot', ip);
      return;
    }
    const email = input.email;
    if (!this.addressHasRoom(email)) {
      this.deps.auth.audit(null, 'register_address_limited', ip);
      return;
    }
    const existing = this.userByEmail(email);
    if (existing) {
      this.deps.outbox.enqueue({
        to: email,
        kind: 'already_registered',
        content: alreadyRegisteredMail(`${this.deps.publicUrl}/login`, `${this.deps.publicUrl}/forgot`),
        ttlMs: 24 * 3600_000,
      });
      this.deps.auth.audit(existing.id, 'register_existing_address', ip);
      return;
    }
    const token = this.issueToken('signup', email, null);
    this.deps.outbox.enqueue({ to: email, kind: 'signup', content: signupMail(this.link('/verify', token), LINK_TTL_MINUTES), ttlMs: LINK_TTL_MS });
    this.deps.auth.audit(null, 'register_link_sent', ip);
  }

  /**
   * Makes the account, with the address marked verified, and signs nobody in. The token is used
   * up and the user row made in one transaction, so two submissions at once make one account.
   */
  async completeSignup(token: string, password: string, ip: string): Promise<{ email: string }> {
    if (!this.liveToken(token, 'signup')) throw LINK_INVALID();
    const passwordHash = await this.deps.auth.hashNewPassword(password);
    const accountFile = `accounts/${crypto.randomBytes(12).toString('hex')}.sqlite`;
    const now = this.deps.clock.nowIso();
    const created = this.control.transaction(() => {
      const row = this.liveToken(token, 'signup');
      if (!row || !this.useToken(row)) throw LINK_INVALID();
      const closed = this.closedReason();
      if (closed) throw closed;
      if (this.userByEmail(row.email)) {
        throw new AppError(409, 'email_in_use', 'This address already has an account. Sign in instead.');
      }
      const result = this.control
        .prepare(
          `INSERT INTO users (username, email, email_verified_at, password_hash, role, status, account_file, created_at, updated_at)
           VALUES (NULL, ?, ?, ?, 'member', 'active', ?, ?, ?)`,
        )
        .run(row.email, now, passwordHash, accountFile, now, now);
      this.control.prepare("DELETE FROM email_tokens WHERE purpose = 'signup' AND email = ? AND used_at IS NULL").run(row.email);
      return { userId: Number(result.lastInsertRowid), email: row.email };
    })();
    this.deps.auth.audit(created.userId, 'signup_complete', ip);
    this.deps.logger.info({ userId: created.userId }, 'New account created');
    try {
      this.deps.onAccountCreated(created.userId, accountFile);
    } catch (error) {
      // The person can still sign in. Their account is loaded on first use, or on the next start.
      this.deps.logger.error({ err: error, userId: created.userId }, 'Could not set up the new account file yet');
    }
    return { email: created.email };
  }

  /* ------------------------------ password reset ---------------------------- */

  /** Always ends the same way. Only an address with an account gets mail. */
  forgotPassword(input: { email: string; challenge: string; nonce: string; website?: string | undefined }, ip: string): void {
    this.limitIp('forgot', ip);
    this.checkProof(input.challenge, input.nonce);
    if (input.website) {
      this.deps.auth.audit(null, 'forgot_honeypot', ip);
      return;
    }
    const user = this.userByEmail(input.email);
    // Only a verified address can receive a reset. A username that looks like an address cannot.
    if (!user || user.email !== input.email || user.status !== 'active') {
      this.deps.auth.audit(null, 'forgot_unknown_address', ip);
      return;
    }
    if (!this.addressHasRoom(input.email)) {
      this.deps.auth.audit(user.id, 'forgot_address_limited', ip);
      return;
    }
    const token = this.issueToken('reset', input.email, user.id);
    this.deps.outbox.enqueue({ to: input.email, kind: 'reset', content: resetMail(this.link('/reset', token), LINK_TTL_MINUTES), ttlMs: LINK_TTL_MS });
    this.deps.auth.audit(user.id, 'forgot_link_sent', ip);
  }

  /** Sets the new password and signs that person out everywhere. Nobody else is touched. */
  async resetPassword(token: string, password: string, ip: string): Promise<{ email: string }> {
    if (!this.liveToken(token, 'reset')) throw LINK_INVALID();
    const passwordHash = await this.deps.auth.hashNewPassword(password);
    const now = this.deps.clock.nowIso();
    const userId = this.control.transaction(() => {
      const row = this.liveToken(token, 'reset');
      if (!row || row.user_id === null || !this.useToken(row)) throw LINK_INVALID();
      const changed = this.control
        .prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ? AND email = ? AND status = 'active'")
        .run(passwordHash, now, row.user_id, row.email).changes;
      if (changed !== 1) throw LINK_INVALID();
      this.control.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
      this.control.prepare("DELETE FROM email_tokens WHERE purpose = 'reset' AND user_id = ? AND used_at IS NULL").run(row.user_id);
      return row.user_id;
    })();
    if (userId === 1) this.deps.legacy?.passwordChanged(passwordHash, now);
    this.deps.auth.audit(userId, 'password_reset', ip);
    this.deps.logger.info({ userId }, 'Password reset by email');
    const email = (this.control.prepare('SELECT email FROM users WHERE id = ?').get(userId) as { email: string }).email;
    return { email };
  }

  /* ------------------------------ address change ---------------------------- */

  /**
   * Sends a link to the new address. The answer is the same if the address is already taken,
   * and then nothing is sent. For the owner, who has no address yet, this adds one.
   */
  async requestEmailChange(userId: number, newEmail: string, currentPassword: string, ip: string): Promise<void> {
    const user = await this.deps.auth.confirmPassword(userId, currentPassword, ip, 'email_change');
    if (!this.hit(`email_change:user:${userId}`, 5, 3600_000)) {
      throw new AppError(429, 'too_many_requests', 'Too many address changes. Try again in an hour.', undefined, 3600);
    }
    if (user.email === newEmail) throw new AppError(422, 'email_unchanged', 'That is already your sign-in address.');
    if (this.userByEmail(newEmail) || !this.addressHasRoom(newEmail)) {
      this.deps.auth.audit(userId, 'email_change_not_sent', ip);
      return;
    }
    const token = this.issueToken('email_change', newEmail, userId);
    this.deps.outbox.enqueue({
      to: newEmail,
      kind: 'email_change',
      content: emailChangeMail(this.link('/confirm-email', token), LINK_TTL_MINUTES),
      ttlMs: LINK_TTL_MS,
    });
    this.deps.auth.audit(userId, 'email_change_link_sent', ip);
  }

  /** Switches the sign-in address, and tells the old address, if there was one. Sessions stay. */
  confirmEmailChange(token: string, ip: string): { email: string } {
    const now = this.deps.clock.nowIso();
    const result = this.control.transaction(() => {
      const row = this.liveToken(token, 'email_change');
      if (!row || row.user_id === null || !this.useToken(row)) throw LINK_INVALID();
      const before = this.control.prepare("SELECT email FROM users WHERE id = ? AND status = 'active'").get(row.user_id) as
        | { email: string | null }
        | undefined;
      if (!before) throw LINK_INVALID();
      if (this.userByEmail(row.email)) throw new AppError(409, 'email_in_use', 'Another account now uses this address.');
      this.control.prepare('UPDATE users SET email = ?, email_verified_at = ?, updated_at = ? WHERE id = ?').run(row.email, now, now, row.user_id);
      // A reset link sent to the old address must not work any more.
      this.control.prepare("DELETE FROM email_tokens WHERE purpose = 'reset' AND user_id = ? AND used_at IS NULL").run(row.user_id);
      return { userId: row.user_id, email: row.email, previous: before.email };
    })();
    if (result.previous) {
      this.deps.outbox.enqueue({ to: result.previous, kind: 'email_changed_notice', content: emailChangedNotice(result.email), ttlMs: 24 * 3600_000 });
    }
    this.deps.auth.audit(result.userId, 'email_changed', ip, { hadAddress: result.previous !== null });
    return { email: result.email };
  }

  /* -------------------------------- upkeep ---------------------------------- */

  /** Expired links, old counters and old outbox rows. Runs hourly. */
  prune(): void {
    const now = this.deps.clock.nowMs();
    this.control.prepare('DELETE FROM email_tokens WHERE expires_at < ?').run(new Date(now - 24 * 3600_000).toISOString());
    this.control.prepare('DELETE FROM request_limits WHERE window_started < ?').run(new Date(now - 24 * 3600_000).toISOString());
    this.deps.outbox.prune();
  }
}
