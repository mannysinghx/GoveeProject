import fs from 'node:fs';
import {
  AI_PERSONAL_LIMIT_DEFAULT_USD,
  aiProviderIds,
  MEMBER_LIMITS,
  type AdminAccountDto,
  type AiProviderId,
  type GoveeKeyStatusDto,
  type PersonalAiDto,
} from '@glm/shared';
import type { Logger } from 'pino';
import { AiProviderError, chat, modelsFor, providerLabel } from '../ai/providers.js';
import type { AccountRegistry } from '../app/accounts.js';
import type { AuthService, SessionInfo } from '../auth/auth-service.js';
import { resolveAccountFile } from '../auth/control.js';
import type { AppConfig } from '../config/env.js';
import type { Db } from '../database/database.js';
import { TransportError } from '../govee/transport.js';
import type { CredentialStore } from '../security/credentials.js';
import { hitLimit } from '../security/limits.js';
import type { Clock } from '../shared/clock.js';
import { AppError } from '../shared/errors.js';
import type { SecretRegistry } from '../shared/logger.js';
import type { PersonalKeys, StoredAiKey } from './personal-keys.js';

/** Where a member's own AI cap is kept, in their account's database. SettingsService does not read it. */
const AI_LIMIT_KEY = 'ai.monthly_limit_usd';

export function readAiLimit(db: Db): number {
  const row = db.prepare('SELECT setting_value FROM application_settings WHERE setting_key = ?').get(AI_LIMIT_KEY) as
    | { setting_value: string }
    | undefined;
  const value = row ? Number(JSON.parse(row.setting_value)) : NaN;
  return Number.isFinite(value) && value >= 0 ? value : AI_PERSONAL_LIMIT_DEFAULT_USD;
}

function writeAiLimit(db: Db, value: number, nowIso: string): void {
  db.prepare(
    `INSERT INTO application_settings (setting_key, setting_value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at`,
  ).run(AI_LIMIT_KEY, JSON.stringify(value), nowIso);
}

/** Tables never exported: sign-in data from before the control database, and the server's own push keys and tokens. */
const NOT_EXPORTED = new Set(['schema_migrations', 'users', 'sessions', 'login_attempts', 'push_keys', 'notification_tokens']);
/** Columns never exported: the browser's push secrets. The person keeps the subscription's address and label. */
const NOT_EXPORTED_COLUMNS: Record<string, string[]> = { push_subscriptions: ['p256dh', 'auth'] };

export interface AccountServiceDeps {
  config: AppConfig;
  control: Db;
  credentials: CredentialStore;
  secrets: SecretRegistry;
  keys: PersonalKeys;
  auth: AuthService;
  accounts: AccountRegistry;
  clock: Clock;
  logger: Logger;
  /** Re-reads the owner's stored Govee key after it changes from the browser. */
  ownerGoveeChanged: () => void;
  /** Asks Govee for the device list with this key. Throws TransportError when it fails. */
  checkGoveeKey: (apiKey: string) => Promise<void>;
  /** Stands in for the AI providers in tests. */
  aiFetch?: typeof fetch;
}

/**
 * A person's own account: connecting keys, their AI cap, exporting and deleting it, and the
 * owner's list of accounts. Keys go in, and never come back out of any method here.
 */
export class AccountService {
  constructor(private readonly deps: AccountServiceDeps) {}

  private get control(): Db {
    return this.deps.control;
  }

  private audit(userId: number | null, event: string, ip: string | null, details?: Record<string, unknown>): void {
    this.deps.auth.audit(userId, event, ip, details);
  }

  /** At most a few key checks an hour per account, Govee and AI together, so stolen keys cannot be tested here. */
  private limitKeyChecks(userId: number): void {
    if (!hitLimit(this.control, `keycheck:user:${userId}`, MEMBER_LIMITS.keyChecksPerHour, 3600_000, this.deps.clock.nowMs())) {
      throw new AppError(429, 'too_many_key_checks', 'Too many keys tried in the last hour. Try again later.', undefined, 3600);
    }
  }

  private requireStorage(): void {
    if (!this.deps.credentials.enabled()) {
      throw new AppError(503, 'credentials_unavailable', 'Keys cannot be added right now. Please try again later.');
    }
  }

  private fileOf(userId: number): { account_file: string; created_at: string } {
    const row = this.control.prepare('SELECT account_file, created_at FROM users WHERE id = ?').get(userId) as
      | { account_file: string; created_at: string }
      | undefined;
    if (!row) throw new AppError(404, 'not_found', 'There is no such account.');
    return row;
  }

  private account(userId: number) {
    const account = this.deps.accounts.forUser(userId);
    if (!account) throw new AppError(503, 'account_unavailable', 'Your account is not available right now. Try again in a minute.');
    return account;
  }

  /* -------------------------------- Govee key -------------------------------- */

  goveeStatus(session: SessionInfo): GoveeKeyStatusDto {
    const isOwner = session.role === 'owner';
    if (isOwner && this.deps.config.govee.apiKey) {
      return {
        connected: true,
        source: 'server',
        connectedAt: null,
        canChange: false,
        note: "Your key is set in the app's hosting settings. Change it there.",
      };
    }
    const stored = this.deps.credentials.list(session.userId).find((info) => info.kind === 'govee');
    const canChange = this.deps.credentials.enabled();
    return {
      connected: stored !== undefined,
      source: stored ? 'account' : null,
      connectedAt: stored?.updatedAt ?? null,
      canChange,
      note: canChange ? null : 'Keys cannot be added right now. Please try again later.',
    };
  }

  async connectGovee(session: SessionInfo, apiKey: string, ip: string): Promise<GoveeKeyStatusDto> {
    const { userId } = session;
    if (session.role === 'owner' && this.deps.config.govee.apiKey) {
      throw new AppError(409, 'govee_key_on_server', "Your key is set in the app's hosting settings. Change it there.");
    }
    this.requireStorage();
    this.limitKeyChecks(userId);
    // Scrubbed from here on, even if the check fails, because it was typed into this server.
    this.deps.secrets.add(apiKey);
    try {
      await this.deps.checkGoveeKey(apiKey);
    } catch (error) {
      this.audit(userId, 'govee_key_check_failed', ip, { category: error instanceof TransportError ? error.category : 'unknown' });
      if (error instanceof TransportError && error.category === 'auth') {
        throw new AppError(422, 'govee_key_rejected', 'Govee did not accept that key. Check it, or apply for a new one in the Govee Home app.');
      }
      throw new AppError(502, 'govee_check_failed', 'Govee could not be reached to check the key. Try again in a few minutes.');
    }
    const replaced = this.deps.credentials.list(userId).some((info) => info.kind === 'govee');
    this.deps.credentials.put(userId, 'govee', apiKey);
    this.keyChanged(session);
    this.audit(userId, 'govee_key_connected', ip, { replaced });
    this.deps.logger.info({ userId, replaced }, 'Govee key connected from the browser');
    return this.goveeStatus(session);
  }

  removeGovee(session: SessionInfo, ip: string): GoveeKeyStatusDto {
    if (session.role === 'owner' && this.deps.config.govee.apiKey) {
      throw new AppError(409, 'govee_key_on_server', "Your key is set in the app's hosting settings. Remove it there.");
    }
    this.deps.credentials.remove(session.userId, 'govee');
    this.keyChanged(session);
    this.audit(session.userId, 'govee_key_removed', ip);
    return this.goveeStatus(session);
  }

  private keyChanged(session: SessionInfo): void {
    if (session.role === 'owner') this.deps.ownerGoveeChanged();
    else this.deps.keys.forget(session.userId);
  }

  /* ---------------------------------- AI keys --------------------------------- */

  personalAi(session: SessionInfo): PersonalAiDto {
    const isMember = session.role === 'member';
    const models = Object.fromEntries(aiProviderIds.map((id) => [id, modelsFor(id)])) as Record<AiProviderId, string[]>;
    const infos = new Map(this.deps.credentials.list(session.userId).map((info) => [info.kind, info]));
    const keys = isMember
      ? this.deps.keys.ai(session.userId).map((provider) => ({
          provider: provider.id,
          label: providerLabel(provider.id),
          model: provider.model,
          connectedAt: infos.get(`ai:${provider.id}`)?.updatedAt ?? '',
        }))
      : [];
    return {
      canAddKeys: isMember && this.deps.credentials.enabled(),
      keys,
      models,
      monthlyLimitUsd: isMember ? readAiLimit(this.account(session.userId).db) : this.deps.config.ai.monthlyLimitUsd,
      monthlyLimitMaxUsd: 100,
    };
  }

  private requireMember(session: SessionInfo): void {
    if (session.role !== 'member') {
      throw new AppError(409, 'ai_keys_on_server', "Your AI keys and limit are set in the app's hosting settings.");
    }
  }

  async connectAi(session: SessionInfo, provider: AiProviderId, model: string, apiKey: string, ip: string): Promise<PersonalAiDto> {
    this.requireMember(session);
    this.requireStorage();
    if (!modelsFor(provider).includes(model.toLowerCase())) {
      throw new AppError(422, 'ai_model_unknown', `Pick one of the listed ${providerLabel(provider)} models.`);
    }
    this.limitKeyChecks(session.userId);
    this.deps.secrets.add(apiKey);
    await this.checkAiKey(session.userId, provider, model.toLowerCase(), apiKey, ip);
    const stored: StoredAiKey = { apiKey, model: model.toLowerCase() };
    // The fingerprint is of the key alone, so one key cannot be connected to two accounts.
    this.deps.credentials.put(session.userId, `ai:${provider}`, JSON.stringify(stored), apiKey);
    this.deps.keys.forget(session.userId);
    this.audit(session.userId, 'ai_key_connected', ip, { provider, model: stored.model });
    return this.personalAi(session);
  }

  /** One tiny request. Its cost is a few tokens, and it is not counted against the cap. */
  private async checkAiKey(userId: number, provider: AiProviderId, model: string, apiKey: string, ip: string): Promise<void> {
    try {
      await chat(
        { id: provider, apiKey, model },
        {
          messages: [{ role: 'user', content: 'Reply with the word OK.' }],
          tools: [],
          maxTokens: 16,
          timeoutMs: Math.min(this.deps.config.ai.timeoutMs, 20_000),
          nowMs: this.deps.clock.nowMs(),
          ...(this.deps.aiFetch ? { fetchImpl: this.deps.aiFetch } : {}),
        },
      );
    } catch (error) {
      const category = error instanceof AiProviderError ? error.category : 'unknown';
      this.audit(userId, 'ai_key_check_failed', ip, { provider, category });
      if (category === 'auth') {
        throw new AppError(422, 'ai_key_rejected', `${providerLabel(provider)} did not accept that key.`);
      }
      const reason = error instanceof AiProviderError ? ` ${this.deps.secrets.scrub(error.message)}` : '';
      throw new AppError(502, 'ai_check_failed', `The key could not be checked right now.${reason}`.slice(0, 400));
    }
  }

  removeAi(session: SessionInfo, provider: AiProviderId, ip: string): PersonalAiDto {
    this.requireMember(session);
    this.deps.credentials.remove(session.userId, `ai:${provider}`);
    this.deps.keys.forget(session.userId);
    this.audit(session.userId, 'ai_key_removed', ip, { provider });
    return this.personalAi(session);
  }

  setAiLimit(session: SessionInfo, monthlyLimitUsd: number, ip: string): PersonalAiDto {
    this.requireMember(session);
    writeAiLimit(this.account(session.userId).db, monthlyLimitUsd, this.deps.clock.nowIso());
    this.audit(session.userId, 'ai_limit_changed', ip, { monthlyLimitUsd });
    return this.personalAi(session);
  }

  /* ----------------------------- export and delete ---------------------------- */

  /** Everything in the person's account file, and what the control database holds about them. Never a key. */
  async exportData(session: SessionInfo, currentPassword: string, ip: string): Promise<{ filename: string; body: string }> {
    const user = await this.deps.auth.confirmPassword(session.userId, currentPassword, ip, 'export');
    const { db } = this.account(session.userId);
    const { created_at: createdAt } = this.fileOf(session.userId);
    const tables: Record<string, unknown[]> = {};
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[];
    for (const { name } of names) {
      if (NOT_EXPORTED.has(name)) continue;
      const rows = db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all() as Record<string, unknown>[];
      const drop = NOT_EXPORTED_COLUMNS[name] ?? [];
      tables[name] = drop.length === 0 ? rows : rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !drop.includes(key))));
    }
    const audit = this.control
      .prepare('SELECT created_at AS createdAt, event, ip FROM audit_events WHERE user_id = ? ORDER BY id DESC LIMIT 1000')
      .all(session.userId);
    const body = JSON.stringify(
      {
        exportedAt: this.deps.clock.nowIso(),
        account: {
          email: user.email,
          username: user.username,
          role: user.role,
          createdAt,
          connectedKeys: this.deps.credentials.list(session.userId).map(({ kind, updatedAt }) => ({ kind, connectedAt: updatedAt })),
        },
        signInHistory: audit,
        tables,
      },
      null,
      2,
    );
    this.audit(session.userId, 'account_exported', ip);
    const date = this.deps.clock.nowIso().slice(0, 10);
    return { filename: `light-manager-export-${date}.json`, body };
  }

  /**
   * Deletes a member's account: their sign-in, keys, links, and their account file. The owner's
   * account cannot be deleted here. Order matters: sign-in is stopped first, so nothing can load
   * the account again while it is being taken apart.
   */
  async deleteAccount(session: SessionInfo, currentPassword: string, ip: string): Promise<void> {
    if (session.role === 'owner') {
      throw new AppError(403, 'owner_cannot_delete', "The owner's account cannot be deleted from the app.");
    }
    const user = await this.deps.auth.confirmPassword(session.userId, currentPassword, ip, 'delete');
    const { userId } = session;
    const file = resolveAccountFile(this.deps.config, this.fileOf(userId).account_file);
    const now = this.deps.clock.nowIso();

    this.control.transaction(() => {
      this.control.prepare("UPDATE users SET status = 'suspended', updated_at = ? WHERE id = ?").run(now, userId);
      this.control.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    })();
    await this.deps.accounts.unload(userId);

    this.control.transaction(() => {
      if (user.email) this.control.prepare("DELETE FROM mail_outbox WHERE to_address = ? AND status = 'queued'").run(user.email);
      // Their sign-in history goes too. Only the fact that an account was deleted is kept.
      this.control.prepare('DELETE FROM audit_events WHERE user_id = ?').run(userId);
      // Sessions, keys and email links go with the row (ON DELETE CASCADE).
      this.control.prepare('DELETE FROM users WHERE id = ?').run(userId);
      this.control
        .prepare("INSERT INTO audit_events (created_at, user_id, event, ip, details_json) VALUES (?, NULL, 'account_deleted', NULL, ?)")
        .run(now, JSON.stringify({ deletedUserId: userId }));
    })();
    this.deps.keys.forget(userId);

    if (file !== ':memory:') {
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          fs.rmSync(file + suffix, { force: true });
        } catch (error) {
          this.deps.logger.error({ err: error, userId, file: file + suffix }, 'Could not delete a deleted account’s file. Remove it by hand.');
        }
      }
    }
    this.deps.logger.info({ userId }, 'Account deleted');
  }

  /* ---------------------------------- admin ---------------------------------- */

  listAccounts(): AdminAccountDto[] {
    const rows = this.control
      .prepare(
        `SELECT u.id, u.email, u.username, u.role, u.status, u.created_at,
                (SELECT MAX(created_at) FROM audit_events a WHERE a.user_id = u.id AND a.event IN ('login', 'setup')) AS last_login
         FROM users u ORDER BY u.id`,
      )
      .all() as {
      id: number;
      email: string | null;
      username: string | null;
      role: 'owner' | 'member';
      status: 'active' | 'suspended';
      created_at: string;
      last_login: string | null;
    }[];
    return rows.map((row) => {
      const kinds = this.deps.credentials.list(row.id).map((info) => info.kind);
      const loaded = this.deps.accounts.forUser(row.id);
      return {
        id: row.id,
        email: row.email ?? row.username,
        role: row.role,
        status: row.status,
        createdAt: row.created_at,
        lastSignInAt: row.last_login,
        goveeConnected: row.role === 'owner' ? (loaded?.transport.isConfigured() ?? false) : kinds.includes('govee'),
        aiKeys: kinds.filter((kind) => kind.startsWith('ai:')).length,
        devices: loaded ? loaded.devices.repository.counts().present : null,
      };
    });
  }

  /** Suspending signs the person out and stops their account's timers. Reactivating loads it again. */
  async setStatus(adminId: number, userId: number, status: 'active' | 'suspended', ip: string): Promise<AdminAccountDto[]> {
    const row = this.control.prepare('SELECT role, status FROM users WHERE id = ?').get(userId) as
      | { role: 'owner' | 'member'; status: string }
      | undefined;
    if (!row) throw new AppError(404, 'not_found', 'There is no such account.');
    if (row.role === 'owner') throw new AppError(409, 'owner_account', "The owner's account cannot be suspended.");
    if (row.status !== status) {
      const now = this.deps.clock.nowIso();
      this.control.transaction(() => {
        this.control.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').run(status, now, userId);
        if (status === 'suspended') this.control.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
      })();
      if (status === 'suspended') await this.deps.accounts.unload(userId);
      else this.deps.accounts.ensure(userId);
      this.audit(adminId, status === 'suspended' ? 'account_suspended' : 'account_reactivated', ip, { userId });
    }
    return this.listAccounts();
  }
}
