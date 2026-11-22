import crypto from 'node:crypto';
import type { CredentialKeys } from '../config/env.js';
import type { Db } from '../database/database.js';
import type { Clock } from '../shared/clock.js';
import { AppError } from '../shared/errors.js';

/**
 * Secrets people connect, such as a Govee key, encrypted at rest with AES-256-GCM from
 * node:crypto. The master keys live in CREDENTIAL_KEYS, never in a database or backup.
 *
 * What this protects: a leaked database file, backup or SQL dump. What it does not: someone
 * with both the Railway variables and the volume, or code running inside the live process.
 */

export type CredentialKind = 'govee';
export type CredentialStatus = 'active' | 'rejected' | 'needs_reentry';

interface CredentialRow {
  user_id: number;
  kind: CredentialKind;
  key_version: number;
  iv: string;
  ciphertext: string;
  auth_tag: string;
  fingerprint: string;
  status: CredentialStatus;
}

/** Binds a ciphertext to one user and kind, so a row copied elsewhere fails to decrypt. */
const additionalData = (userId: number, kind: CredentialKind) => Buffer.from(`glm-credential:v1:user=${userId}:kind=${kind}`);

export class CredentialStore {
  private readonly fingerprintKey: Buffer | null;

  constructor(
    private readonly db: Db,
    private readonly keys: CredentialKeys | null,
    private readonly clock: Clock,
  ) {
    // Derived from the current master key. Rotating the master key re-fingerprints every row.
    this.fingerprintKey = keys
      ? Buffer.from(crypto.hkdfSync('sha256', keys.keys.get(keys.current)!, Buffer.alloc(0), 'glm credential fingerprint v1', 32))
      : null;
  }

  /** False when CREDENTIAL_KEYS is not set: nothing can be stored encrypted. */
  enabled(): boolean {
    return this.keys !== null;
  }

  fingerprint(kind: CredentialKind, secret: string): string {
    if (!this.fingerprintKey) throw new Error('Credential keys are not configured.');
    return crypto.createHmac('sha256', this.fingerprintKey).update(`${kind}:${secret}`).digest('hex');
  }

  /** Stores or replaces a user's secret of this kind. One secret can belong to one user only. */
  put(userId: number, kind: CredentialKind, secret: string): void {
    if (!this.keys) throw new AppError(503, 'credentials_unavailable', 'Keys cannot be stored on this server yet.');
    const version = this.keys.current;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.keys.keys.get(version)!, iv);
    cipher.setAAD(additionalData(userId, kind));
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const fingerprint = this.fingerprint(kind, secret);
    const now = this.clock.nowIso();

    const owner = this.db.prepare('SELECT user_id FROM credentials WHERE kind = ? AND fingerprint = ?').get(kind, fingerprint) as
      | { user_id: number }
      | undefined;
    if (owner && owner.user_id !== userId) {
      throw new AppError(409, 'credential_in_use', 'That key is already connected to another account.');
    }
    this.db
      .prepare(
        `INSERT INTO credentials (user_id, kind, key_version, iv, ciphertext, auth_tag, fingerprint, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
         ON CONFLICT (user_id, kind) DO UPDATE SET
           key_version = excluded.key_version, iv = excluded.iv, ciphertext = excluded.ciphertext,
           auth_tag = excluded.auth_tag, fingerprint = excluded.fingerprint, status = 'active', updated_at = excluded.updated_at`,
      )
      .run(userId, kind, version, iv.toString('base64'), ciphertext.toString('base64'), tag.toString('base64'), fingerprint, now, now);
  }

  /**
   * The decrypted secret, or null when there is none. A row that will not decrypt (a missing
   * master key version, or a row tampered with or moved) is reported, never returned partly.
   */
  get(userId: number, kind: CredentialKind): { secret: string; status: CredentialStatus } | { error: string } | null {
    const row = this.db.prepare('SELECT * FROM credentials WHERE user_id = ? AND kind = ?').get(userId, kind) as CredentialRow | undefined;
    if (!row) return null;
    if (!this.keys) return { error: 'CREDENTIAL_KEYS is not set, so stored keys cannot be read.' };
    const key = this.keys.keys.get(row.key_version);
    if (!key) return { error: `Master key version ${row.key_version} is not in CREDENTIAL_KEYS.` };
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(row.iv, 'base64'));
      decipher.setAAD(additionalData(userId, kind));
      decipher.setAuthTag(Buffer.from(row.auth_tag, 'base64'));
      const secret = Buffer.concat([decipher.update(Buffer.from(row.ciphertext, 'base64')), decipher.final()]).toString('utf8');
      return { secret, status: row.status };
    } catch {
      return { error: 'A stored key could not be decrypted. It may have been changed or copied from another account.' };
    }
  }

  setStatus(userId: number, kind: CredentialKind, status: CredentialStatus): void {
    this.db
      .prepare('UPDATE credentials SET status = ?, updated_at = ? WHERE user_id = ? AND kind = ?')
      .run(status, this.clock.nowIso(), userId, kind);
  }

  remove(userId: number, kind: CredentialKind): void {
    this.db.prepare('DELETE FROM credentials WHERE user_id = ? AND kind = ?').run(userId, kind);
  }
}
