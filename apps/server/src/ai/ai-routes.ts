import type { FastifyInstance } from 'fastify';
import { aiAskRequestSchema, aiQuestionsQuerySchema, type AiQuestionListDto } from '@glm/shared';
import type { AppContext } from '../app/context.js';
import { parseInput } from '../shared/validation.js';

export function registerAiRoutes(api: FastifyInstance, ctx: AppContext): void {
  const { ai } = ctx;

  /** Which providers are set up and this month's spend. Never includes a key. */
  api.get('/ai/status', async () => ai.status());

  api.post('/ai/ask', async (request) => {
    const { question } = parseInput(aiAskRequestSchema, request.body);
    return ai.ask(question);
  });

  api.get('/ai/questions', async (request): Promise<AiQuestionListDto> => {
    const { limit } = parseInput(aiQuestionsQuerySchema, request.query);
    return { questions: ai.recentQuestions(limit) };
  });
}
