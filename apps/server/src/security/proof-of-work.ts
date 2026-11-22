import crypto from 'node:crypto';
import type { Clock } from '../shared/clock.js';

/**
 * A puzzle the browser solves before a sign-up or reset form is accepted, in place of a
 * third-party captcha. The server signs a challenge; the browser finds a number such that
 * SHA-256("<challenge>:<number>") starts with `difficulty` zero bits, which takes about 2^n
 * tries. Checking an answer takes one hash.
 *
 * Challenges are signed with a key made at startup, so nothing is stored for them, and they
 * stop working on restart. Each can be used once.
 */

const TTL_MS = 10 * 60_000;

export function leadingZeroBits(digest: Uint8Array): number {
  let bits = 0;
  for (const byte of digest) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    return bits + Math.clz32(byte) - 24;
  }
  return bits;
}

export class ProofOfWork {
  private readonly key = crypto.randomBytes(32);
  /** Challenges already answered, until they expire. */
  private readonly used = new Map<string, number>();

  constructor(
    private readonly clock: Clock,
    private readonly difficulty: number,
  ) {}

  private sign(body: string): string {
    return crypto.createHmac('sha256', this.key).update(`glm-pow:v1:${body}`).digest('base64url').slice(0, 32);
  }

  issue(): { challenge: string; difficulty: number; expiresAt: string } {
    const expires = this.clock.nowMs() + TTL_MS;
    const body = `v1.${expires}.${this.difficulty}.${crypto.randomBytes(12).toString('base64url')}`;
    return { challenge: `${body}.${this.sign(body)}`, difficulty: this.difficulty, expiresAt: new Date(expires).toISOString() };
  }

  /** True once, for a real, unexpired challenge with a correct answer. */
  verify(challenge: string, nonce: string): boolean {
    const now = this.clock.nowMs();
    this.forgetExpired(now);
    const parts = challenge.split('.');
    if (parts.length !== 5 || parts[0] !== 'v1') return false;
    const body = parts.slice(0, 4).join('.');
    const signature = Buffer.from(parts[4]!);
    const expected = Buffer.from(this.sign(body));
    if (signature.length !== expected.length || !crypto.timingSafeEqual(signature, expected)) return false;
    const expires = Number(parts[1]);
    const difficulty = Number(parts[2]);
    if (!Number.isFinite(expires) || expires <= now) return false;
    // A challenge issued before the difficulty was raised still has to meet the current one.
    if (difficulty < this.difficulty) return false;
    if (!/^\d{1,16}$/.test(nonce)) return false;
    if (this.used.has(challenge)) return false;
    const digest = crypto.createHash('sha256').update(`${challenge}:${nonce}`).digest();
    if (leadingZeroBits(digest) < difficulty) return false;
    this.used.set(challenge, expires);
    return true;
  }

  private forgetExpired(now: number): void {
    for (const [challenge, expires] of this.used) if (expires <= now) this.used.delete(challenge);
  }
}

/** Finds an answer. Used by tests and the development tools; the browser has its own copy. */
export function solveChallenge(challenge: string, difficulty: number): string {
  for (let nonce = 0; ; nonce += 1) {
    const digest = crypto.createHash('sha256').update(`${challenge}:${nonce}`).digest();
    if (leadingZeroBits(digest) >= difficulty) return String(nonce);
  }
}
