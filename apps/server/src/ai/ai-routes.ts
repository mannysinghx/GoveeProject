import type { FastifyInstance } from 'fastify';
import {
  aiAskRequestSchema,
  aiMoodRequestSchema,
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

  /**
   * A look for the owner's words, designed and checked three ways. Nothing is sent to the lights here: the
   * result is steps for the preset apply route, which the owner's own press (or a clean result) sends.
   */
  api.post('/ai/mood', async (request) => accountOf(request).ai.setMood(parseInput(aiMoodRequestSchema, request.body)));

  api.get('/ai/questions', async (request): Promise<AiQuestionListDto> => {
    const { ai } = accountOf(request);
    const { limit } = parseInput(aiQuestionsQuerySchema, request.query);
    return { questions: ai.recentQuestions(limit) };
  });
}
