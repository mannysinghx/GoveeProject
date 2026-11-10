import { z } from 'zod';
import type { AiProviderId } from '@glm/shared';
import type { AiProviderConfig } from '../config/env.js';

/**
 * All three providers accept the same OpenAI-style chat completions request, so one small
 * client covers them, with no SDK. Hosts are fixed here, never configurable, so a key can
 * only ever be sent to its own provider.
 *
 * Checked against each provider's documentation on 9 November 2026:
 *  - DeepSeek: https://api-docs.deepseek.com/quick_start/pricing
 *  - Gemini:   https://ai.google.dev/gemini-api/docs/openai and /docs/pricing
 *  - GLM:      https://docs.z.ai/api-reference/introduction and /guides/overview/pricing
 */
interface ProviderSpec {
  label: string;
  url: string;
  /** Extra request fields. Thinking is turned off or kept low: these answers are short. */
  extra: Record<string, unknown>;
}

const PROVIDERS: Record<AiProviderId, ProviderSpec> = {
  deepseek: {
    label: 'DeepSeek',
    url: 'https://api.deepseek.com/chat/completions',
    extra: { thinking: { type: 'disabled' } },
  },
  gemini: {
    label: 'Google Gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    extra: { reasoning_effort: 'low' },
  },
  glm: {
    label: 'Z.ai GLM',
    url: 'https://api.z.ai/api/paas/v4/chat/completions',
    extra: { thinking: { type: 'disabled' } },
  },
};

export function providerLabel(id: AiProviderId): string {
  return PROVIDERS[id].label;
}

/**
 * Listed paid prices in USD per million tokens. Free tiers are still counted at the paid
 * price, so the monthly cap never relies on a free allowance that may change. DeepSeek is
 * counted at its peak rate, which is double its off-peak rate.
 */
const PRICES: Record<string, { input: number; output: number }> = {
  'deepseek-flash': { input: 0.3, output: 1.2 },
  'deepseek-v4-flash': { input: 0.3, output: 1.2 },
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.5 },
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5 },
  'glm-4.7-flash': { input: 0, output: 0 },
  'glm-4.5-flash': { input: 0, output: 0 },
  'glm-5.3-flash': { input: 0.15, output: 0.5 },
};
/** For a model not listed above. Deliberately high, so an unknown price cannot slip past the cap. */
const UNKNOWN_PRICE = { input: 2, output: 10 };

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICES[model.toLowerCase()] ?? UNKNOWN_PRICE;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

export function knownPrice(model: string): boolean {
  return PRICES[model.toLowerCase()] !== undefined;
}

/* ------------------------------ request shape ------------------------------ */

export interface ToolDefinition {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ChatResult {
  content: string | null;
  toolCalls: ToolCall[];
  inputTokens: number;
  outputTokens: number;
}

export type AiErrorCategory = 'auth' | 'rate_limited' | 'bad_request' | 'server' | 'network' | 'timeout' | 'bad_response';

/** A failed provider request. The message is safe to show and log: it never holds the key. */
export class AiProviderError extends Error {
  constructor(
    readonly provider: AiProviderId,
    readonly category: AiErrorCategory,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

const responseSchema = z.looseObject({
  choices: z
    .array(
      z.looseObject({
        message: z.looseObject({
          content: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.looseObject({
                id: z.string().optional(),
                function: z.looseObject({ name: z.string(), arguments: z.string().optional() }),
              }),
            )
            .nullable()
            .optional(),
        }),
      }),
    )
    .min(1),
  usage: z
    .looseObject({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() })
    .nullable()
    .optional(),
});

const errorBodySchema = z.looseObject({
  error: z.union([z.looseObject({ message: z.string().optional() }), z.string()]).optional(),
  message: z.string().optional(),
});

function categoryFor(status: number): AiErrorCategory {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'bad_request';
}

function retryAfterMs(headers: Headers): number | undefined {
  const raw = headers.get('retry-after');
  if (raw === null) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

export interface ChatOptions {
  messages: ChatMessage[];
  tools: ToolDefinition[];
  maxTokens: number;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/** One chat completions request. Throws AiProviderError for every kind of failure. */
export async function chat(provider: AiProviderConfig, options: ChatOptions): Promise<ChatResult> {
  const spec = PROVIDERS[provider.id];
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const fail = (category: AiErrorCategory, message: string, retry?: number) =>
    new AiProviderError(provider.id, category, `${spec.label}: ${message}`, retry);

  const body = JSON.stringify({
    model: provider.model,
    messages: options.messages,
    ...(options.tools.length > 0 ? { tools: options.tools, tool_choice: 'auto' } : {}),
    max_tokens: options.maxTokens,
    stream: false,
    ...spec.extra,
  });

  let response: Response;
  let text: string;
  try {
    response = await fetchImpl(spec.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${provider.apiKey}` },
      body,
      signal: controller.signal,
      // fetch would otherwise resend the Authorization header to wherever a redirect points.
      redirect: 'error',
    });
    text = await response.text();
  } catch {
    if (controller.signal.aborted) throw fail('timeout', `no reply within ${Math.round(options.timeoutMs / 1000)} seconds.`);
    throw fail('network', 'could not be reached.');
  } finally {
    clearTimeout(timer);
  }

  let json: unknown = null;
  try {
    json = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    // Handled below.
  }

  if (!response.ok) {
    const body = errorBodySchema.safeParse(json);
    const said = body.success
      ? typeof body.data.error === 'string'
        ? body.data.error
        : (body.data.error?.message ?? body.data.message)
      : undefined;
    // The provider's own words help with troubleshooting. The key is never in the request
    // body, but it is stripped anyway in case a provider echoes the header back.
    const detail = said ? ` It said: ${said.split(provider.apiKey).join('[REDACTED]').slice(0, 200)}` : '';
    throw fail(categoryFor(response.status), `the request was refused (HTTP ${response.status}).${detail}`, retryAfterMs(response.headers));
  }

  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) throw fail('bad_response', 'the reply was not in the expected format.');
  const message = parsed.data.choices[0]!.message;
  const toolCalls: ToolCall[] = (message.tool_calls ?? []).map((call, index) => ({
    id: call.id && call.id.length > 0 ? call.id : `call_${index}`,
    type: 'function',
    function: { name: call.function.name, arguments: call.function.arguments ?? '{}' },
  }));
  const content = message.content ?? null;
  // A reply without token counts is estimated at about 3 characters a token, so it still
  // counts against the monthly cap.
  const replyLength = (content?.length ?? 0) + toolCalls.reduce((n, c) => n + c.function.arguments.length, 0);
  return {
    content,
    toolCalls,
    inputTokens: parsed.data.usage?.prompt_tokens ?? Math.ceil(body.length / 3),
    outputTokens: parsed.data.usage?.completion_tokens ?? Math.ceil(replyLength / 3),
  };
}
