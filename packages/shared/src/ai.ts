import { z } from 'zod';

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
