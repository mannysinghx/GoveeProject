import crypto from 'node:crypto';
import type { Logger } from 'pino';
import { DateTime } from 'luxon';
import {
  colorEmoji,
  holidayByKey,
  type AppSettings,
  type DeviceAction,
  type IncidentKind,
  type NotificationAction,
  type NotificationDto,
  type NotificationListDto,
  type PushDeviceDto,
  type PushStatusDto,
} from '@glm/shared';
import type { ActivityService } from '../activity/activity-service.js';
import type { DevicePlan, RunFinished } from '../commands/action-service.js';
import type { Db } from '../database/database.js';
import type { Clock } from '../shared/clock.js';
import { notFound, unprocessable } from '../shared/errors.js';
import {
  generatePushKeys,
  isAllowedPushEndpoint,
  PushDeliveryError,
  type PushSender,
  type VapidDetails,
} from './push-sender.js';

const HEADS_UP_MS = 15 * 60 * 1000;
const HEADS_UP_CHECK_MS = 30 * 1000;
const TOKEN_LIFETIME_MS = 7 * 24 * 3600 * 1000;
const MAX_DEVICES = 20;
const MAX_PREVIEW_SQUARES = 12;
const GONE_STATUSES = new Set([404, 410]);

const ACTION_LABEL: Record<NotificationAction, string> = {
  looks_right: 'Looks right',
  didnt_change: "Didn't change",
  skip: 'Skip this one',
};

interface NotificationRow {
  id: number;
  kind: NotificationDto['kind'];
  severity: NotificationDto['severity'];
  title: string;
  body: string;
  link: string;
  actions_json: string;
  show_key: string | null;
  show_date: string | null;
  answer: NotificationAction | null;
  answered_at: string | null;
  read_at: string | null;
  created_at: string;
}

interface SubscriptionRow {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  label: string;
  created_at: string;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
}

interface NewNotification {
  kind: NotificationDto['kind'];
  severity: NotificationDto['severity'];
  title: string;
  body: string;
  link: string;
  actions?: NotificationAction[];
  dedupeKey?: string;
  runId?: string;
  showKey?: string;
  showDate?: string;
  ttlSeconds?: number;
  urgency?: 'normal' | 'high';
}

function toDto(row: NotificationRow): NotificationDto {
  const actions = JSON.parse(row.actions_json) as NotificationAction[];
  return {
    id: row.id,
    kind: row.kind,
    severity: row.severity,
    title: row.title,
    body: row.body,
    link: row.link,
    actions: actions.map((action) => ({ action, label: ACTION_LABEL[action] })),
    answer: row.answer,
    answeredAt: row.answered_at,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

/**
 * Shows what a run sends as colored squares, so the notification itself shows what the
 * lights should look like. It is the intent, not a reading from the lights: Govee does
 * not report segment colors back.
 */
export function previewOfPlans(plans: readonly DevicePlan[]): string {
  const first = plans.find((plan) => plan.actions.some((a) => a.type !== 'power')) ?? plans[0];
  if (!first) return '';
  const scene = first.actions.find((a) => a.type === 'scene');
  if (scene && scene.type === 'scene') return `✨ ${scene.sceneName ?? 'Govee effect'}`;
  const bySegment = new Map<number, string>();
  for (const action of first.actions as DeviceAction[]) {
    if (action.type === 'segmentColor') for (const segment of action.segments) bySegment.set(segment, action.hex);
    if (action.type === 'color') return colorEmoji(action.hex).repeat(MAX_PREVIEW_SQUARES);
  }
  if (bySegment.size > 0) {
    const ordered = [...bySegment.entries()].sort((a, b) => a[0] - b[0]).map(([, hex]) => colorEmoji(hex));
    const shown = ordered.slice(0, MAX_PREVIEW_SQUARES).join('');
    return ordered.length > MAX_PREVIEW_SQUARES ? `${shown}…` : shown;
  }
  const power = first.actions.find((a) => a.type === 'power');
  return power && power.type === 'power' ? (power.on ? '💡 On' : '🌑 Off') : '';
}

function strings(count: number): string {
  return `${count} string${count === 1 ? '' : 's'}`;
}

/**
 * Keeps the owner informed. Every notification is stored and shown in the app, and sent
 * to any phone or browser that has turned on push. Nothing here can stop a schedule from
 * running: a failure to notify is logged and that is all.
 */
export class NotificationService {
  private timer: NodeJS.Timeout | null = null;
  private readonly pending = new Set<Promise<void>>();
  private didntChangeListener: (() => void) | null = null;

  constructor(
    private readonly db: Db,
    private readonly activity: ActivityService,
    private readonly getSettings: () => AppSettings,
    private readonly sender: PushSender,
    private readonly subject: string,
    private readonly logger: Logger,
    private readonly clock: Clock,
  ) {}

  start(): void {
    this.getKeys();
    this.timer = setInterval(() => {
      try {
        this.sendHeadsUps();
      } catch (error) {
        this.logger.warn({ err: error }, 'Could not send holiday reminders');
      }
    }, HEADS_UP_CHECK_MS);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.idle();
  }

  /** Resolves when every push under way has finished. */
  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.all(this.pending);
  }

  /** Called when the owner says the lights did not change. */
  onDidntChange(listener: () => void): void {
    this.didntChangeListener = listener;
  }

  /* ------------------------------- creating ------------------------------- */

  /** Returns null if this was already sent. */
  notify(input: NewNotification): NotificationDto | null {
    const now = this.clock.nowIso();
    const actions = input.actions ?? [];
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO notifications
           (kind, severity, title, body, link, actions_json, dedupe_key, run_id, show_key, show_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.kind,
        input.severity,
        input.title,
        input.body,
        input.link,
        JSON.stringify(actions),
        input.dedupeKey ?? null,
        input.runId ?? null,
        input.showKey ?? null,
        input.showDate ?? null,
        now,
      );
    if (result.changes === 0) return null;
    const id = Number(result.lastInsertRowid);
    const tokens = this.createTokens(id, actions);
    this.track(this.push(id, input, tokens));
    return this.get(id);
  }

  private track(work: Promise<void>): void {
    const running = work
      .catch((error: unknown) => {
        this.logger.warn({ err: error }, 'Could not send a push notification');
      })
      .finally(() => {
        this.pending.delete(running);
      });
    this.pending.add(running);
  }

  private createTokens(id: number, actions: NotificationAction[]): Map<NotificationAction, string> {
    const tokens = new Map<NotificationAction, string>();
    const expires = new Date(this.clock.nowMs() + TOKEN_LIFETIME_MS).toISOString();
    for (const action of actions) {
      const token = crypto.randomBytes(32).toString('base64url');
      this.db
        .prepare('INSERT INTO notification_tokens (token_hash, notification_id, action, expires_at) VALUES (?, ?, ?, ?)')
        .run(hashToken(token), id, action, expires);
      tokens.set(action, token);
    }
    return tokens;
  }

  private async push(id: number, input: NewNotification, tokens: Map<NotificationAction, string>): Promise<void> {
    const rows = this.db.prepare('SELECT * FROM push_subscriptions').all() as SubscriptionRow[];
    if (rows.length === 0) return;
    const payload = JSON.stringify({
      id,
      title: input.title,
      body: input.body,
      link: input.link,
      tag: input.dedupeKey ?? `notification-${id}`,
      actions: [...tokens.entries()].map(([action, token]) => ({ action, title: ACTION_LABEL[action], token })),
    });
    const vapid = this.vapid();
    await Promise.all(
      rows.map(async (row) => {
        try {
          await this.sender.send(
            { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
            payload,
            vapid,
            { ttlSeconds: input.ttlSeconds ?? 6 * 3600, urgency: input.urgency ?? 'normal' },
          );
          this.db
            .prepare('UPDATE push_subscriptions SET last_success_at = ?, last_error = NULL, last_error_at = NULL WHERE id = ?')
            .run(this.clock.nowIso(), row.id);
        } catch (error) {
          this.recordPushFailure(row, error);
        }
      }),
    );
  }

  private recordPushFailure(row: SubscriptionRow, error: unknown): void {
    const status = error instanceof PushDeliveryError ? error.statusCode : null;
    if (status !== null && GONE_STATUSES.has(status)) {
      // The push service says this device has turned notifications off or gone away.
      this.db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(row.id);
      this.logger.info({ subscriptionId: row.id }, 'Removed a push subscription that no longer exists');
      return;
    }
    const message = error instanceof PushDeliveryError ? error.message : 'The notification could not be sent.';
    this.db
      .prepare('UPDATE push_subscriptions SET last_error = ?, last_error_at = ? WHERE id = ?')
      .run(message, this.clock.nowIso(), row.id);
    this.logger.warn({ subscriptionId: row.id, status }, 'A push notification failed');
  }

  /* --------------------------------- runs --------------------------------- */

  /** One notification when sending finishes, with what really happened. */
  handleRun(run: RunFinished): void {
    const { source, plans, outcomes, status, runId } = run;
    if (source.type !== 'schedule' && source.type !== 'preset') return;
    const settings = this.getSettings();
    const refused = outcomes.filter((o) => o.status !== 'accepted');
    const accepted = plans.filter((plan) =>
      outcomes.some((o) => o.deviceId === plan.device.id && o.status === 'accepted'),
    ).length;

    if (status !== 'all_accepted') {
      if (!settings.notifyProblems) return;
      const names = [...new Set(refused.map((o) => o.deviceName))];
      const offline = refused.some((o) => o.errorCategory === 'device_offline');
      const reason = refused.find((o) => o.reason)?.reason;
      this.notify({
        kind: 'run_problem',
        severity: status === 'failed' ? 'bad' : 'warn',
        title: status === 'failed' ? `${source.name} didn't start` : `${source.name} only partly started`,
        body: `${names.join(', ') || 'Some lights'}: ${offline ? 'offline.' : (reason ?? 'not accepted by Govee.')}`,
        link: offline ? '/connections' : '/activity',
        runId,
        urgency: 'high',
      });
      return;
    }

    if (source.quiet) return;
    const wanted = source.type === 'schedule' ? settings.notifyScheduleStarts : settings.notifyPatternStarts;
    if (!wanted) return;
    const preview = previewOfPlans(plans);
    this.notify({
      kind: 'run',
      severity: 'info',
      title: `${source.name} started`,
      // Accepted is all anyone can know here. The owner's eyes are the only way to confirm it.
      body: `${preview ? `${preview}\n` : ''}Govee accepted it on ${strings(accepted)}. Did the lights change?`,
      link: '/notifications',
      actions: ['looks_right', 'didnt_change'],
      runId,
    });
  }

  /* ------------------------------ connections ----------------------------- */

  handleIncident(event: 'opened' | 'closed', kind: IncidentKind, deviceName: string | undefined): void {
    if (!this.getSettings().notifyProblems) return;
    const name = deviceName ?? 'A light';
    const messages: Partial<Record<IncidentKind, { opened: string; closed: string }>> = {
      device_offline: { opened: `${name} went offline`, closed: `${name} is back online` },
      device_missing: { opened: `${name} left your Govee account`, closed: `${name} is back in your Govee account` },
      govee_unreachable: { opened: "The app can't reach Govee", closed: 'The app can reach Govee again' },
      api_key_rejected: { opened: 'Govee rejected the API key', closed: 'Govee accepted the API key again' },
    };
    const message = messages[kind];
    if (!message) return;
    this.notify({
      kind: event === 'opened' ? 'problem' : 'recovered',
      severity: event === 'opened' ? 'warn' : 'good',
      title: message[event],
      body: event === 'opened' ? 'See Connections for the likely cause and what to try.' : 'No action needed.',
      link: '/connections',
      urgency: event === 'opened' ? 'high' : 'normal',
    });
  }

  /* ------------------------------- reminders ------------------------------ */

  /** A reminder before each holiday show, while there is still time to skip it. */
  sendHeadsUps(): void {
    if (!this.getSettings().notifyHeadsUp) return;
    const now = this.clock.nowMs();
    const rows = this.db
      .prepare(
        `SELECT builtin_show, next_run_at, time_zone FROM schedules
         WHERE enabled = 1 AND quiet = 0 AND builtin_show IS NOT NULL
           AND next_run_at > ? AND next_run_at <= ?`,
      )
      .all(new Date(now).toISOString(), new Date(now + HEADS_UP_MS).toISOString()) as {
      builtin_show: string;
      next_run_at: string;
      time_zone: string;
    }[];
    for (const row of rows) {
      const start = DateTime.fromISO(row.next_run_at, { zone: row.time_zone });
      const date = start.toISODate();
      if (!date) continue;
      const skipped = this.db
        .prepare('SELECT 1 FROM show_skips WHERE show_key = ? AND local_date = ?')
        .get(row.builtin_show, date);
      if (skipped) continue;
      const minutes = Math.max(1, Math.round((Date.parse(row.next_run_at) - now) / 60_000));
      this.notify({
        kind: 'heads_up',
        severity: 'info',
        title: `${holidayByKey(row.builtin_show)?.name ?? row.builtin_show} starts in ${minutes} min`,
        body: `Your lights change at ${start.toLocaleString(DateTime.TIME_SIMPLE)}. Skip it if tonight's not the night.`,
        link: '/schedules',
        actions: ['skip'],
        dedupeKey: `heads-up:${row.builtin_show}:${date}`,
        showKey: row.builtin_show,
        showDate: date,
        ttlSeconds: 15 * 60,
        urgency: 'high',
      });
    }
  }

  /* ------------------------------- answers -------------------------------- */

  /** From a button on a phone notification, which has no session. Each token works once. */
  respondWithToken(token: string): NotificationDto {
    const row = this.db
      .prepare('SELECT notification_id, action, expires_at FROM notification_tokens WHERE token_hash = ?')
      .get(hashToken(token)) as { notification_id: number; action: NotificationAction; expires_at: string } | undefined;
    if (!row || row.expires_at <= this.clock.nowIso()) throw notFound('That notification action');
    return this.answer(row.notification_id, row.action);
  }

  /** From the buttons in the app. */
  respond(id: number, action: NotificationAction): NotificationDto {
    const notification = this.get(id);
    if (!notification.actions.some((a) => a.action === action)) {
      throw unprocessable('invalid_notification_action', 'That answer does not apply to this notification.');
    }
    return this.answer(id, action);
  }

  private answer(id: number, action: NotificationAction): NotificationDto {
    const now = this.clock.nowIso();
    // Removing every token for this notification makes all of its buttons single-use.
    const claimed = this.db.transaction(() => {
      const changes = this.db
        .prepare('UPDATE notifications SET answer = ?, answered_at = ?, read_at = COALESCE(read_at, ?) WHERE id = ? AND answer IS NULL')
        .run(action, now, now, id).changes;
      this.db.prepare('DELETE FROM notification_tokens WHERE notification_id = ?').run(id);
      return changes === 1;
    })();
    const row = this.row(id);
    if (claimed) this.applyAnswer(row, action);
    return toDto(row);
  }

  private applyAnswer(row: NotificationRow, action: NotificationAction): void {
    const name = row.title.replace(/ started$/, '');
    if (action === 'looks_right') {
      this.activity.record({ eventType: 'notification', outcome: 'success', message: `You confirmed the lights changed for "${name}".` });
    } else if (action === 'didnt_change') {
      this.activity.record({
        eventType: 'notification',
        outcome: 'warning',
        message: `You said the lights did not change for "${name}", though Govee accepted it. Running a connection check.`,
      });
      this.didntChangeListener?.();
    } else if (action === 'skip' && row.show_key && row.show_date) {
      this.db
        .prepare('INSERT OR IGNORE INTO show_skips (show_key, local_date, created_at) VALUES (?, ?, ?)')
        .run(row.show_key, row.show_date, this.clock.nowIso());
      this.activity.record({
        eventType: 'notification',
        outcome: 'info',
        message: `Skipped ${holidayByKey(row.show_key)?.name ?? row.show_key} on ${row.show_date}.`,
      });
    }
  }

  /* -------------------------------- lists --------------------------------- */

  private row(id: number): NotificationRow {
    const row = this.db.prepare('SELECT * FROM notifications WHERE id = ?').get(id) as NotificationRow | undefined;
    if (!row) throw notFound('That notification');
    return row;
  }

  get(id: number): NotificationDto {
    return toDto(this.row(id));
  }

  list(limit: number): NotificationListDto {
    const rows = this.db
      .prepare('SELECT * FROM notifications ORDER BY created_at DESC, id DESC LIMIT ?')
      .all(limit) as NotificationRow[];
    const unread = this.db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL').get() as { n: number };
    return { items: rows.map(toDto), unread: unread.n };
  }

  markAllRead(): void {
    this.db.prepare('UPDATE notifications SET read_at = ? WHERE read_at IS NULL').run(this.clock.nowIso());
  }

  sendTest(): NotificationDto {
    return this.notify({
      kind: 'test',
      severity: 'info',
      title: 'Test notification',
      body: '🟥🟧🟨🟩🟦🟪 Notifications are working on this device.',
      link: '/notifications',
      urgency: 'high',
    }) as NotificationDto;
  }

  /* ------------------------------ push devices ---------------------------- */

  private getKeys(): { public_key: string; private_key: string } {
    const existing = this.db.prepare('SELECT public_key, private_key FROM push_keys WHERE id = 1').get() as
      | { public_key: string; private_key: string }
      | undefined;
    if (existing) return existing;
    const keys = generatePushKeys();
    this.db
      .prepare('INSERT OR IGNORE INTO push_keys (id, public_key, private_key, created_at) VALUES (1, ?, ?, ?)')
      .run(keys.publicKey, keys.privateKey, this.clock.nowIso());
    return this.db.prepare('SELECT public_key, private_key FROM push_keys WHERE id = 1').get() as {
      public_key: string;
      private_key: string;
    };
  }

  private vapid(): VapidDetails {
    const keys = this.getKeys();
    return { subject: this.subject, publicKey: keys.public_key, privateKey: keys.private_key };
  }

  pushStatus(): PushStatusDto {
    const rows = this.db.prepare('SELECT * FROM push_subscriptions ORDER BY created_at DESC, id DESC').all() as SubscriptionRow[];
    const devices: PushDeviceDto[] = rows.map((row) => ({
      id: row.id,
      label: row.label,
      createdAt: row.created_at,
      lastSuccessAt: row.last_success_at,
      lastError: row.last_error,
    }));
    return { publicKey: this.getKeys().public_key, devices };
  }

  subscribe(input: { endpoint: string; keys: { p256dh: string; auth: string }; label: string }): PushStatusDto {
    if (!isAllowedPushEndpoint(input.endpoint)) {
      throw unprocessable('push_endpoint_not_allowed', 'That address is not a known browser push service.');
    }
    const now = this.clock.nowIso();
    this.db
      .prepare(
        `INSERT INTO push_subscriptions (endpoint, p256dh, auth, label, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label`,
      )
      .run(input.endpoint, input.keys.p256dh, input.keys.auth, input.label, now);
    this.db
      .prepare(
        `DELETE FROM push_subscriptions WHERE id NOT IN
           (SELECT id FROM push_subscriptions ORDER BY created_at DESC, id DESC LIMIT ?)`,
      )
      .run(MAX_DEVICES);
    this.activity.record({ eventType: 'notification', outcome: 'info', message: `Turned on notifications for ${input.label}.` });
    return this.pushStatus();
  }

  unsubscribeEndpoint(endpoint: string): PushStatusDto {
    this.db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
    return this.pushStatus();
  }

  removeDevice(id: number): PushStatusDto {
    this.db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(id);
    return this.pushStatus();
  }
}

