import type { FastifyInstance } from 'fastify';
import {
  aiAskRequestSchema,
  aiPatternDraftRequestSchema,
  aiQuestionsQuerySchema,
  aiScheduleDraftRequestSchema,
  type AiQuestionListDto,
} from '@glm/shared';
import { accountOf } from '../app/request-account.js';
import { parseInput } from '../shared/validation.js';

export function registerAiRoutes(api: FastifyInstance): void {
  /** Which providers are set up and this month's spend. Never includes a key. */
  api.get('/ai/status', async (request) => accountOf(request).ai.status());

  api.post('/ai/ask', async (request) => {
    const { ai } = accountOf(request);
    const { question } = parseInput(aiAskRequestSchema, request.body);
    return ai.ask(question);
  });

  /** A pattern for the pattern editor to show. Nothing is sent to the lights or saved. */
  api.post('/ai/draft-pattern', async (request) =>
    accountOf(request).ai.draftPattern(parseInput(aiPatternDraftRequestSchema, request.body)),
  );

  /** A schedule for the schedule editor to fill in. Nothing is saved. */
  api.post('/ai/draft-schedule', async (request) =>
    accountOf(request).ai.draftSchedule(parseInput(aiScheduleDraftRequestSchema, request.body)),
  );

  api.get('/ai/questions', async (request): Promise<AiQuestionListDto> => {
    const { ai } = accountOf(request);
    const { limit } = parseInput(aiQuestionsQuerySchema, request.query);
    return { questions: ai.recentQuestions(limit) };
  });
}
