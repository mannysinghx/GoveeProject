import type { Logger } from 'pino';
import type { Db } from '../database/database.js';
import type { Clock } from '../shared/clock.js';
import { buildMessage, type MailContent } from './message.js';
import { SmtpError } from './smtp-client.js';

/** Hands one built message to the mail server. Rejects with SmtpError when it cannot. */
export type MailSender = (envelope: { from: string; to: string }, data: string) => Promise<void>;

export interface OutboxOptions {
  /** The sender address. Null when mail is not set up. */
  from: string | null;
  fromName: string;
  /** At most this many sent in any hour. The rest wait. */
  hourlyLimit: number;
  pollMs: number;
}

export type MailKind = 'signup' | 'already_registered' | 'reset' | 'email_change' | 'email_changed_notice';

interface OutboxRow {
  id: number;
  to_address: string;
  kind: MailKind;
  subject: string;
  text_body: string | null;
  html_body: string | null;
  attempts: number;
  expires_at: string;
}

/** Waits before each retry. After the last, the message is given up. */
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
/** When the mail server refuses the app's sign-in, everything waits this long before trying again. */
const AUTH_PAUSE_MS = 15 * 60_000;
const KEEP_ROWS_MS = 30 * 24 * 3600_000;

/**
 * Mail waits in the control database until a worker sends it, one message at a time. A
 * restart loses nothing, and no request waits on the mail server, so how long a form takes
 * says nothing about which addresses have accounts.
 */
export class MailOutbox {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<number> | null = null;
  private pausedUntil = 0;
  private warnedUnconfigured = false;

  constructor(
    private readonly control: Db,
    private readonly sender: MailSender | null,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly options: OutboxOptions,
  ) {}

  configured(): boolean {
    return this.sender !== null && this.options.from !== null;
  }

  /** Queues a message. It is dropped unsent if it cannot go out before `ttlMs` has passed. */
  enqueue(mail: { to: string; kind: MailKind; content: MailContent; ttlMs: number }): void {
    const now = this.clock.nowMs();
    this.control
      .prepare(
        `INSERT INTO mail_outbox (to_address, kind, subject, text_body, html_body, status, attempts, next_attempt_at, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?)`,
      )
      .run(
        mail.to,
        mail.kind,
        mail.content.subject,
        mail.content.text,
        mail.content.html,
        new Date(now).toISOString(),
        new Date(now + mail.ttlMs).toISOString(),
        new Date(now).toISOString(),
      );
    if (!this.configured() && !this.warnedUnconfigured) {
      this.warnedUnconfigured = true;
      this.logger.warn('Mail is not set up (SMTP_HOST), so email is queued but not sent.');
    }
    if (this.timer) setImmediate(() => void this.processDue());
  }

  /** Messages to this address created at or after `sinceMs`, sent or not. */
  countToAddress(address: string, sinceMs: number): number {
    const row = this.control
      .prepare('SELECT COUNT(*) AS n FROM mail_outbox WHERE to_address = ? AND created_at >= ?')
      .get(address, new Date(sinceMs).toISOString()) as { n: number };
    return row.n;
  }

  stats(): { queued: number; failedLastDay: number } {
    const since = new Date(this.clock.nowMs() - 24 * 3600_000).toISOString();
    const queued = (this.control.prepare("SELECT COUNT(*) AS n FROM mail_outbox WHERE status IN ('queued', 'sending')").get() as { n: number }).n;
    const failed = (
      this.control.prepare("SELECT COUNT(*) AS n FROM mail_outbox WHERE status IN ('failed', 'expired') AND created_at >= ?").get(since) as { n: number }
    ).n;
    return { queued, failedLastDay: failed };
  }

  start(): void {
    if (this.timer || !this.configured()) return;
    // A crash mid-send leaves a row marked sending. It is tried again: a rare duplicate beats a lost link.
    this.control.prepare("UPDATE mail_outbox SET status = 'queued' WHERE status = 'sending'").run();
    this.timer = setInterval(() => void this.processDue(), this.options.pollMs);
    this.timer.unref();
    setImmediate(() => void this.processDue());
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running?.catch(() => undefined);
  }

  /** Sends what is due, within the hourly limit. Returns how many were sent. */
  processDue(): Promise<number> {
    if (this.running) return this.running;
    this.running = this.work().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private sentInLastHour(): number {
    const since = new Date(this.clock.nowMs() - 3600_000).toISOString();
    return (this.control.prepare('SELECT COUNT(*) AS n FROM mail_outbox WHERE sent_at >= ?').get(since) as { n: number }).n;
  }

  private finish(id: number, status: 'sent' | 'failed' | 'expired', error: string | null): void {
    const now = this.clock.nowIso();
    // The message text can hold a sign-in link, so it is not kept once it is no longer needed.
    this.control
      .prepare(
        `UPDATE mail_outbox SET status = ?, text_body = NULL, html_body = NULL, last_error = ?, sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END
         WHERE id = ?`,
      )
      .run(status, error, status, now, id);
  }

  private async work(): Promise<number> {
    if (!this.configured()) return 0;
    let sent = 0;
    for (;;) {
      const now = this.clock.nowMs();
      if (now < this.pausedUntil) return sent;
      const nowIso = new Date(now).toISOString();
      // Too late to be useful: the link inside has expired.
      const stale = this.control
        .prepare("SELECT id FROM mail_outbox WHERE status = 'queued' AND expires_at <= ?")
        .all(nowIso) as { id: number }[];
      for (const row of stale) this.finish(row.id, 'expired', 'Not sent before its link expired.');

      if (this.sentInLastHour() >= this.options.hourlyLimit) return sent;
      const row = this.control
        .prepare("SELECT * FROM mail_outbox WHERE status = 'queued' AND next_attempt_at <= ? ORDER BY next_attempt_at, id LIMIT 1")
        .get(nowIso) as OutboxRow | undefined;
      if (!row) return sent;

      this.control.prepare("UPDATE mail_outbox SET status = 'sending', attempts = attempts + 1 WHERE id = ?").run(row.id);
      const attempts = row.attempts + 1;
      try {
        const message = buildMessage(
          { from: this.options.from!, fromName: this.options.fromName, to: row.to_address },
          { subject: row.subject, text: row.text_body ?? '', html: row.html_body ?? '' },
          this.clock.now(),
        );
        await this.sender!({ from: this.options.from!, to: row.to_address }, message.data);
        this.finish(row.id, 'sent', null);
        sent += 1;
        this.logger.info({ mailId: row.id, kind: row.kind, attempts }, 'Sent an email');
      } catch (error) {
        const smtp = error instanceof SmtpError ? error : null;
        const reason = (error instanceof Error ? error.message : String(error)).slice(0, 300);
        const retryAt = this.clock.nowMs() + (RETRY_DELAYS_MS[attempts - 1] ?? 0);
        if (smtp?.transient && attempts < MAX_ATTEMPTS && retryAt < Date.parse(row.expires_at)) {
          this.control
            .prepare("UPDATE mail_outbox SET status = 'queued', next_attempt_at = ?, last_error = ? WHERE id = ?")
            .run(new Date(retryAt).toISOString(), reason, row.id);
          this.logger.warn({ mailId: row.id, kind: row.kind, attempts, reason }, 'Could not send an email. It will be tried again.');
        } else {
          this.finish(row.id, 'failed', reason);
          this.logger.error({ mailId: row.id, kind: row.kind, attempts, reason }, 'Gave up sending an email');
        }
        if (smtp?.authFailed) {
          this.pausedUntil = this.clock.nowMs() + AUTH_PAUSE_MS;
          this.logger.error('The mail server refused the app\'s sign-in. Check SMTP_USER and SMTP_PASSWORD. Sending is paused for 15 minutes.');
          return sent;
        }
        // One failure usually means the server is unreachable. Wait for the next round.
        if (smtp?.transient) return sent;
      }
    }
  }

  /** Rows older than 30 days. Their text was cleared when they were sent or given up. */
  prune(): number {
    const before = new Date(this.clock.nowMs() - KEEP_ROWS_MS).toISOString();
    return this.control.prepare("DELETE FROM mail_outbox WHERE created_at < ? AND status NOT IN ('queued', 'sending')").run(before).changes;
  }
}
