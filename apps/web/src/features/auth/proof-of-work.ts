import type { ChallengeDto } from '@glm/shared';
import { api } from '../../lib/api';

/**
 * Solves the server's sign-up puzzle in this browser, with WebCrypto: finds a number n such
 * that SHA-256("<challenge>:<n>") starts with `difficulty` zero bits. It takes about a second.
 * This stands in for a third-party captcha. See apps/server/src/security/proof-of-work.ts.
 */

const BATCH = 256;

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

export async function solveChallenge(challenge: string, difficulty: number, signal?: AbortSignal): Promise<string> {
  const encoder = new TextEncoder();
  for (let start = 0; ; start += BATCH) {
    if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
    const digests = await Promise.all(
      Array.from({ length: BATCH }, (_, i) => crypto.subtle.digest('SHA-256', encoder.encode(`${challenge}:${start + i}`))),
    );
    const found = digests.findIndex((digest) => leadingZeroBits(new Uint8Array(digest)) >= difficulty);
    if (found !== -1) return String(start + found);
  }
}

/** Fetches a puzzle and solves it, ready to send with a form. */
export async function proveWork(signal?: AbortSignal): Promise<{ challenge: string; nonce: string }> {
  const { challenge, difficulty } = await api<ChallengeDto>('/auth/challenge', signal ? { signal } : {});
  return { challenge, nonce: await solveChallenge(challenge, difficulty, signal) };
}
