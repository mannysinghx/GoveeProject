import { z } from 'zod';
import { missedRunPolicySchema, recurrenceSchema } from './schemas.js';
import type { MissedRunPolicy, Recurrence, ScheduleAction, Target } from './schemas.js';

/** The AI providers the app can call, in the default round-robin order. */
export const aiProviderIds = ['deepseek', 'gemini', 'glm'] as const;
export type AiProviderId = (typeof aiProviderIds)[number];

export const AI_QUESTION_MAX_LENGTH = 500;

export const aiAskRequestSchema = z.object({
  question: z.string().trim().min(3, 'Ask a question').max(AI_QUESTION_MAX_LENGTH),
});
export type AiAskRequest = z.infer<typeof aiAskRequestSchema>;

export const aiQuestionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

/** What an answer was based on. The app checks every one against what the tools returned. */
export type AiReferenceKind = 'light' | 'schedule' | 'run' | 'command' | 'incident' | 'activity';

export interface AiReferenceDto {
  /** As written in the answer, such as "run:3f2a…". */
  ref: string;
  kind: AiReferenceKind;
  label: string;
  /** A page in this app to look at it. */
  href: string;
}

export interface AiAnswerDto {
  id: number;
  question: string;
  /** Plain text. References appear as [[kind:id]] and are listed in `references`. */
  answer: string;
  references: AiReferenceDto[];
  provider: AiProviderId;
  model: string;
  costUsd: number;
  createdAt: string;
}

export interface AiProviderStatusDto {
  id: AiProviderId;
  label: string;
  model: string;
  /** False for a while after the provider refused the key or kept failing. */
  available: boolean;
  note: string | null;
}

export interface AiStatusDto {
  /** True when AI features can be used right now. */
  enabled: boolean;
  /** Why not, when they cannot. */
  reason: 'disabled' | 'no_providers' | 'limit_reached' | null;
  providers: AiProviderStatusDto[];
  monthSpentUsd: number;
  monthlyLimitUsd: number;
}

export interface AiQuestionListDto {
  questions: AiAnswerDto[];
}

/* ----------------------------- describe a pattern ----------------------------- */

/** One string in the pattern editor, in on-screen order. Only names and sizes are sent. */
export const aiPatternStringSchema = z.object({
  name: z.string().trim().min(1).max(80),
  /** Segments, which are the cells the editor can colour. */
  cells: z.number().int().min(1).max(300),
  /** LEDs per segment, when known. */
  ledsPerCell: z.number().int().min(1).max(100).nullable(),
});

export const AI_PATTERN_MAX_CELLS = 2_000;

export const aiPatternDraftRequestSchema = z.object({
  description: z.string().trim().min(3, 'Describe the pattern').max(AI_QUESTION_MAX_LENGTH),
  strings: z
    .array(aiPatternStringSchema)
    .min(1, 'There are no strings to paint')
    .max(20)
    .refine((strings) => strings.reduce((n, s) => n + s.cells, 0) <= AI_PATTERN_MAX_CELLS, 'Too many segments'),
});
export type AiPatternDraftRequest = z.infer<typeof aiPatternDraftRequestSchema>;

const draftHex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour in #rrggbb form');
const cellIndex = z.number().int().min(0);

/**
 * Steps for the pattern editor, applied in order to cells numbered from 0 along the whole run.
 * They use the editor's own tools, so nothing here is a light command.
 */
export const patternStepSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('paint'), from: cellIndex, to: cellIndex, color: draftHex }),
  z.object({ op: z.literal('gradient'), from: cellIndex, to: cellIndex, startColor: draftHex, endColor: draftHex }),
  z.object({
    op: z.literal('repeat'),
    from: cellIndex,
    to: cellIndex,
    colors: z.array(draftHex).min(1).max(12),
    run: z.number().int().min(1).max(100),
  }),
]);
export type PatternStep = z.infer<typeof patternStepSchema>;

export const patternDraftSchema = z.object({
  name: z.string().trim().min(1).max(60),
  /** Fills every cell first. */
  background: draftHex,
  steps: z.array(patternStepSchema).max(40),
  /** Anything the owner should know, such as a moving effect turned into a still one. */
  note: z.string().max(300).nullable().optional(),
});
export type PatternDraft = z.infer<typeof patternDraftSchema>;

/** Checks every step stays inside the canvas. Returns the problems, or none. */
export function patternDraftProblems(draft: PatternDraft, totalCells: number): string[] {
  const problems: string[] = [];
  draft.steps.forEach((step, i) => {
    if (step.from > step.to) problems.push(`step ${i + 1}: "from" is after "to"`);
    if (step.to >= totalCells) problems.push(`step ${i + 1}: cell ${step.to} is past the last cell, ${totalCells - 1}`);
  });
  return problems;
}

export interface AiPatternDraftDto {
  draft: PatternDraft;
  provider: AiProviderId;
  model: string;
  costUsd: number;
}

/* ---------------------------- describe a schedule ----------------------------- */

export const aiScheduleDraftRequestSchema = z.object({
  description: z.string().trim().min(3, 'Describe the schedule').max(AI_QUESTION_MAX_LENGTH),
});
export type AiScheduleDraftRequest = z.infer<typeof aiScheduleDraftRequestSchema>;

/**
 * A schedule's timing as drafted. A sunrise or sunset schedule carries no location: the
 * editor adds the one saved in Settings, so the home's position is never sent to a model.
 */
export type RecurrenceDraft =
  | Exclude<Recurrence, { kind: 'solar' }>
  | Omit<Extract<Recurrence, { kind: 'solar' }>, 'latitude' | 'longitude'>;

export function parseRecurrenceDraft(value: unknown): { recurrence: RecurrenceDraft } | { error: string } {
  if (value === null || typeof value !== 'object') return { error: 'recurrence must be an object' };
  const input = value as Record<string, unknown>;
  const isSolar = input.kind === 'solar';
  const candidate = isSolar ? { ...input, latitude: 0, longitude: 0 } : input;
  const parsed = recurrenceSchema.safeParse(candidate);
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => `recurrence.${i.path.join('.')}: ${i.message}`).join('; ') };
  }
  if (parsed.data.kind === 'solar') {
    const { latitude: _lat, longitude: _lon, ...rest } = parsed.data;
    return { recurrence: rest };
  }
  return { recurrence: parsed.data };
}

export const scheduleDraftSchema = z.object({
  name: z.string().trim().min(1).max(80),
  recurrence: z.unknown(),
  target: z.object({ type: z.enum(['device', 'group']), id: z.string().min(1).max(64) }),
  action: z.discriminatedUnion('type', [
    z.object({ type: z.literal('power'), on: z.boolean() }),
    z.object({ type: z.literal('preset'), presetId: z.string().min(1).max(64) }),
  ]),
  missedRunPolicy: missedRunPolicySchema.optional(),
  note: z.string().max(300).nullable().optional(),
});

export interface ScheduleDraft {
  name: string;
  timeZone: string;
  recurrence: RecurrenceDraft;
  target: Target;
  action: ScheduleAction;
  missedRunPolicy: MissedRunPolicy;
  note: string | null;
}

export interface AiScheduleDraftDto {
  draft: ScheduleDraft;
  provider: AiProviderId;
  model: string;
  costUsd: number;
}
