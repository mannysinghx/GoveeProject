import type { AiAnswerDto, AiProviderId, AiReferenceDto } from '@glm/shared';
import type { Db } from '../database/database.js';
import type { Clock } from '../shared/clock.js';

export interface UsageInput {
  feature: string;
  provider: AiProviderId;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  outcome: 'ok' | 'error';
  error?: string | null;
}

interface QuestionRow {
  id: number;
  created_at: string;
  question: string;
  answer: string;
  references_json: string;
  provider: AiProviderId;
  model: string;
  cost_usd: number;
}

function toDto(row: QuestionRow): AiAnswerDto {
  let references: AiReferenceDto[] = [];
  try {
    references = JSON.parse(row.references_json) as AiReferenceDto[];
  } catch {
    // A damaged row still shows its answer.
  }
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    references,
    provider: row.provider,
    model: row.model,
    costUsd: row.cost_usd,
    createdAt: row.created_at,
  };
}

/** What AI requests have cost, and the questions asked. Prompts sent to providers are never stored. */
export class AiLedger {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  record(input: UsageInput): void {
    this.db
      .prepare(
        `INSERT INTO ai_usage (created_at, feature, provider, model, input_tokens, output_tokens, cost_usd, outcome, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.clock.nowIso(),
        input.feature,
        input.provider,
        input.model,
        input.inputTokens,
        input.outputTokens,
        input.costUsd,
        input.outcome,
        input.error?.slice(0, 500) ?? null,
      );
  }

  /** Spend since 00:00 UTC on the first of this month. */
  monthSpentUsd(): number {
    const now = this.clock.now();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const row = this.db.prepare('SELECT COALESCE(SUM(cost_usd), 0) AS total FROM ai_usage WHERE created_at >= ?').get(start) as {
      total: number;
    };
    return row.total;
  }

  saveQuestion(input: Omit<AiAnswerDto, 'id' | 'createdAt'>): AiAnswerDto {
    const createdAt = this.clock.nowIso();
    const result = this.db
      .prepare(
        `INSERT INTO ai_questions (created_at, question, answer, references_json, provider, model, cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(createdAt, input.question, input.answer, JSON.stringify(input.references), input.provider, input.model, input.costUsd);
    return { ...input, id: Number(result.lastInsertRowid), createdAt };
  }

  recentQuestions(limit: number): AiAnswerDto[] {
    const rows = this.db
      .prepare('SELECT * FROM ai_questions ORDER BY id DESC LIMIT ?')
      .all(limit) as QuestionRow[];
    return rows.map(toDto);
  }
}
