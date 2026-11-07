import type { z } from 'zod';
import { AppError } from './errors.js';

/** Parses untrusted input. Invalid input becomes a 400 naming each bad field. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
  const first = issues[0];
  const message = first
    ? first.path
      ? `${first.path}: ${first.message}`
      : first.message
    : 'The request was not valid.';
  throw new AppError(400, 'validation_error', message, { issues });
}
