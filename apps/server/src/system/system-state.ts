import type { ErrorCategory } from '@glm/shared';
import type { Db } from '../database/database.js';
import type { Clock } from '../shared/clock.js';

const KEYS = {
  lastConnection: '_system.lastSuccessfulConnectionAt',
  lastErrorCategory: '_system.lastErrorCategory',
  lastErrorAt: '_system.lastErrorAt',
  lastRateLimitAt: '_system.lastRateLimitAt',
  lastDiscoveryAt: '_system.lastDiscoveryAt',
} as const;

/** Connection bookkeeping that survives restarts. Stored apart from user settings. */
export class SystemState {
  private readonly upsert;
  private readonly select;

  constructor(db: Db, private readonly clock: Clock) {
    this.upsert = db.prepare(
      `INSERT INTO application_settings (setting_key, setting_value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at`,
    );
    this.select = db.prepare('SELECT setting_value FROM application_settings WHERE setting_key = ?');
  }

  private get(key: string): string | null {
    const row = this.select.get(key) as { setting_value: string } | undefined;
    return row?.setting_value ?? null;
  }

  private set(key: string, value: string): void {
    this.upsert.run(key, value, this.clock.nowIso());
  }

  setLastSuccessfulConnection(at: string): void {
    this.set(KEYS.lastConnection, at);
  }
  lastSuccessfulConnection(): string | null {
    return this.get(KEYS.lastConnection);
  }

  setLastError(category: ErrorCategory, at: string): void {
    this.set(KEYS.lastErrorCategory, category);
    this.set(KEYS.lastErrorAt, at);
  }
  lastErrorCategory(): ErrorCategory | null {
    return this.get(KEYS.lastErrorCategory) as ErrorCategory | null;
  }
  lastErrorAt(): string | null {
    return this.get(KEYS.lastErrorAt);
  }

  setLastRateLimit(at: string): void {
    this.set(KEYS.lastRateLimitAt, at);
  }
  lastRateLimit(): string | null {
    return this.get(KEYS.lastRateLimitAt);
  }

  setLastDiscovery(at: string): void {
    this.set(KEYS.lastDiscoveryAt, at);
  }
  lastDiscovery(): string | null {
    return this.get(KEYS.lastDiscoveryAt);
  }
}
