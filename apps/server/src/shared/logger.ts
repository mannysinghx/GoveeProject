import { pino, type DestinationStream, type Logger } from 'pino';

const CENSOR = '[REDACTED]';

/**
 * Replaces any configured secret wherever it appears in a string. This is the
 * last line of defence: code should already avoid logging secrets, and this
 * still catches one that ends up inside an error message or a nested object.
 */
export function createSecretScrubber(secrets: (string | null | undefined)[]): (text: string) => string {
  const values = secrets.filter((s): s is string => typeof s === 'string' && s.length >= 4);
  if (values.length === 0) return (text) => text;
  return (text) => {
    let out = text;
    for (const secret of values) {
      if (out.includes(secret)) out = out.split(secret).join(CENSOR);
    }
    return out;
  };
}

/**
 * Every secret the process knows, including ones that arrive after startup, such as a key
 * a person connects later. The logger and every account's scrubber read it on each use, so a
 * secret added once is hidden everywhere from then on. Values are never listed or returned.
 */
export class SecretRegistry {
  private readonly values = new Set<string>();

  constructor(initial: (string | null | undefined)[] = []) {
    for (const secret of initial) this.add(secret);
  }

  /** Secrets shorter than 4 characters are ignored, as by createSecretScrubber. */
  add(secret: string | null | undefined): void {
    if (typeof secret === 'string' && secret.length >= 4) this.values.add(secret);
  }

  remove(secret: string): void {
    this.values.delete(secret);
  }

  /** Longest first, so a secret that contains another is hidden whole. */
  readonly scrub = (text: string): string => {
    if (this.values.size === 0) return text;
    let out = text;
    for (const secret of [...this.values].sort((a, b) => b.length - a.length)) {
      if (out.includes(secret)) out = out.split(secret).join(CENSOR);
    }
    return out;
  };
}

export interface LoggerOptions {
  level: string;
  /** A fixed list, or a registry that can grow while the app runs. */
  secrets: (string | null | undefined)[] | SecretRegistry;
  destination?: DestinationStream;
}

export function createLogger({ level, secrets, destination }: LoggerOptions): Logger {
  const scrub = secrets instanceof SecretRegistry ? secrets.scrub : createSecretScrubber(secrets);
  return pino(
    {
      level,
      redact: {
        paths: [
          'password',
          'newPassword',
          'currentPassword',
          'passwordHash',
          'apiKey',
          'token',
          'cookie',
          'authorization',
          '*.password',
          '*.apiKey',
          '*.token',
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-csrf-token"]',
          'req.headers["govee-api-key"]',
          'headers["govee-api-key"]',
          'res.headers["set-cookie"]',
        ],
        censor: CENSOR,
      },
      hooks: {
        streamWrite: (line) => scrub(line),
      },
    },
    destination,
  );
}

export type { Logger };
