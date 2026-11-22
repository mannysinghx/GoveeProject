import path from 'node:path';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import { openDatabase, runMigrations, type Db } from '../database/database.js';
import type { Clock } from '../shared/clock.js';

/** Control migrations live in their own folder. The account runner ignores subfolders. */
export function controlMigrationsDir(config: AppConfig): string {
  return path.join(config.migrationsDir, 'control');
}

export function openControlDatabase(config: AppConfig, logger?: Logger, db?: Db): Db {
  const control = db ?? openDatabase(config.controlDatabasePath);
  runMigrations(control, controlMigrationsDir(config), logger);
  return control;
}

/** Where the control database records an account's file: relative to its own folder when it can. */
export function accountFileFor(config: AppConfig): string {
  if (config.databasePath === ':memory:' || config.controlDatabasePath === ':memory:') return config.databasePath;
  return path.relative(path.dirname(config.controlDatabasePath), config.databasePath) || config.databasePath;
}

/**
 * Where a member's account file is on disk. Recorded paths are relative to the control
 * database's folder. With an in-memory control database (tests), accounts are in memory too.
 * A recorded path cannot climb out of that folder.
 */
export function resolveAccountFile(config: AppConfig, accountFile: string): string {
  if (config.controlDatabasePath === ':memory:') return ':memory:';
  const base = path.dirname(config.controlDatabasePath);
  const resolved = path.resolve(base, accountFile);
  if (path.isAbsolute(accountFile) || !resolved.startsWith(base + path.sep)) {
    throw new Error('An account file path in the control database points outside its folder.');
  }
  return resolved;
}

interface LegacyUser {
  id: number;
  username: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

interface ControlUser {
  id: number;
  password_hash: string;
  updated_at: string;
}

export type CutoverResult =
  | { kind: 'fresh' }
  | { kind: 'already_done' }
  | { kind: 'copied'; sessions: number }
  | { kind: 'adopted_newer_password'; sessions: number };

function legacyOwner(ownerDb: Db): LegacyUser | null {
  return (ownerDb.prepare('SELECT id, username, password_hash, created_at, updated_at FROM users WHERE id = 1').get() as LegacyUser | undefined) ?? null;
}

/** Copies the owner's live sessions from their file, so nobody is signed out by the move. */
function copySessions(control: Db, ownerDb: Db, nowIso: string): number {
  const rows = ownerDb.prepare('SELECT token_hash, csrf_token, expires_at, created_at FROM sessions WHERE user_id = 1 AND expires_at > ?').all(nowIso) as {
    token_hash: string;
    csrf_token: string;
    expires_at: string;
    created_at: string;
  }[];
  const insert = control.prepare(
    'INSERT OR IGNORE INTO sessions (token_hash, user_id, csrf_token, expires_at, created_at) VALUES (?, 1, ?, ?, ?)',
  );
  for (const row of rows) insert.run(row.token_hash, row.csrf_token, row.expires_at, row.created_at);
  return rows.length;
}

/**
 * Moves the owner's sign-in from their own file into the control database. It runs on every
 * start and is safe to repeat. The owner's file is only read: its users and sessions tables
 * stay as they are, so the previous version of the app still works after a rollback.
 *
 * - No owner in the control database, but one in the file: copy the owner and their live
 *   sessions, in one transaction.
 * - Both, and the file's password is newer: the previous version changed it after a rollback,
 *   so its password and sessions win. Otherwise rolling forward would bring back an old password.
 * - Neither: a fresh install. Setup creates the owner in the control database.
 */
export function cutoverOwner(control: Db, ownerDb: Db, accountFile: string, clock: Clock, logger?: Logger): CutoverResult {
  const legacy = legacyOwner(ownerDb);
  const current = (control.prepare('SELECT id, password_hash, updated_at FROM users WHERE id = 1').get() as ControlUser | undefined) ?? null;
  const now = clock.nowIso();

  if (!legacy) return current ? { kind: 'already_done' } : { kind: 'fresh' };

  if (!current) {
    const sessions = control.transaction(() => {
      control
        .prepare(
          `INSERT INTO users (id, username, email, email_verified_at, password_hash, role, status, account_file, created_at, updated_at)
           VALUES (1, ?, NULL, NULL, ?, 'owner', 'active', ?, ?, ?)`,
        )
        .run(legacy.username, legacy.password_hash, accountFile, legacy.created_at, legacy.updated_at);
      const copied = copySessions(control, ownerDb, now);
      control
        .prepare("INSERT INTO audit_events (created_at, user_id, event, ip, details_json) VALUES (?, 1, 'cutover', NULL, ?)")
        .run(now, JSON.stringify({ sessions: copied, accountFile }));
      return copied;
    })();
    logger?.info({ sessions, accountFile }, 'Moved the owner account into the control database');
    return { kind: 'copied', sessions };
  }

  if (legacy.password_hash !== current.password_hash && legacy.updated_at > current.updated_at) {
    const sessions = control.transaction(() => {
      control.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = 1').run(legacy.password_hash, legacy.updated_at);
      // The previous version signed everyone out when it changed the password. So does this.
      control.prepare('DELETE FROM sessions WHERE user_id = 1').run();
      const copied = copySessions(control, ownerDb, now);
      control
        .prepare("INSERT INTO audit_events (created_at, user_id, event, ip, details_json) VALUES (?, 1, 'cutover_newer_password', NULL, ?)")
        .run(now, JSON.stringify({ sessions: copied }));
      return copied;
    })();
    logger?.warn({ sessions }, "The owner's password was changed by a previous version of the app, so that password is used");
    return { kind: 'adopted_newer_password', sessions };
  }
  return { kind: 'already_done' };
}

/**
 * Keeps the owner's old users and sessions tables in their file in step, for as long as they
 * exist, so rolling back to the previous version never accepts an old password or a session
 * that was signed out. Every method does nothing if the tables are gone.
 */
export class LegacyOwnerMirror {
  constructor(private readonly ownerDb: Db) {}

  private exists(): boolean {
    return this.ownerDb.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get() !== undefined;
  }

  passwordChanged(passwordHash: string, updatedAt: string): void {
    if (!this.exists()) return;
    this.ownerDb.transaction(() => {
      this.ownerDb.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = 1').run(passwordHash, updatedAt);
      this.ownerDb.prepare('DELETE FROM sessions').run();
      this.ownerDb.prepare('DELETE FROM login_attempts').run();
    })();
  }

  signedOut(tokenHash: string): void {
    if (!this.exists()) return;
    this.ownerDb.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  pruneExpired(nowIso: string): void {
    if (!this.exists()) return;
    this.ownerDb.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso);
  }
}
