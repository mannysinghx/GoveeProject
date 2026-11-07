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

export interface LoggerOptions {
  level: string;
  secrets: (string | null | undefined)[];
  destination?: DestinationStream;
}

export function createLogger({ level, secrets, destination }: LoggerOptions): Logger {
  const scrub = createSecretScrubber(secrets);
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
