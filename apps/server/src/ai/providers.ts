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
  /** Whether the provider documents `response_format: {type: 'json_object'}` on this endpoint. */
  jsonObject: boolean;
  /** Extra request fields for a model. Thinking is turned off or kept low: these answers are short. */
  extra: (model: string) => Record<string, unknown>;
}

const PROVIDERS: Record<AiProviderId, ProviderSpec> = {
  deepseek: {
    label: 'DeepSeek',
    url: 'https://api.deepseek.com/chat/completions',
    jsonObject: true,
    // Thinking is on by default, and with tools its reasoning would have to be sent back each round.
    extra: () => ({ thinking: { type: 'disabled' } }),
  },
  gemini: {
    label: 'Google Gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    // Its compatible endpoint documents schema-based structured output, not json_object, so JSON is asked for in the prompt.
    jsonObject: false,
    // Gemini 3 models cannot turn thinking off. This keeps it low.
    extra: () => ({ reasoning_effort: 'low' }),
  },
  glm: {
    label: 'Z.ai GLM',
    url: 'https://api.z.ai/api/paas/v4/chat/completions',
    jsonObject: true,
    // The GLM-5.3 series can only think, and defaults to maximum effort. Older models can turn it off.
    extra: (model) =>
      model.toLowerCase().startsWith('glm-5.3')
        ? { thinking: { type: 'enabled' }, reasoning_effort: 'low' }
        : { thinking: { type: 'disabled' } },
  },
};

export function providerLabel(id: AiProviderId): string {
  return PROVIDERS[id].label;
}

/** The extra fields a request to this provider and model carries. Exported for tests. */
export function requestExtras(id: AiProviderId, model: string): Record<string, unknown> {
  return PROVIDERS[id].extra(model);
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

/** A rough token count for text, at about 3 characters a token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
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
  /**
   * Provider data that must go back unchanged. Gemini 3 puts its thought signature here,
   * and refuses the next request if it is missing.
   */
  extra_content?: unknown;
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ChatResult {
  content: string | null;
  toolCalls: ToolCall[];
  /** Why the provider stopped. Null when it did not say. */
  finishReason: string | null;
  inputTokens: number;
  outputTokens: number;
}

export type AiErrorCategory =
  | 'auth'
  | 'rate_limited'
  | 'bad_request'
  | 'server'
  | 'network'
  | 'timeout'
  | 'bad_response'
  /** The provider worked, but the model's output was unusable. Not a reason to rest the provider. */
  | 'invalid_output';

/** A failed provider request. The message is safe to show and log: it never holds the key. */
export class AiProviderError extends Error {
  constructor(
    readonly provider: AiProviderId,
    readonly category: AiErrorCategory,
    message: string,
    readonly retryAfterMs?: number,
    /**
     * Tokens the provider may have billed although the reply was unusable, such as a timeout
     * after it started, or a reply that would not parse. Counted against the cap.
     */
    readonly possiblyBilled?: { inputTokens: number; outputTokens: number },
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

const responseSchema = z.looseObject({
  choices: z
    .array(
      z.looseObject({
        finish_reason: z.string().nullable().optional(),
        message: z.looseObject({
          content: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.looseObject({
                id: z.string().optional(),
                function: z.looseObject({ name: z.string(), arguments: z.string().optional() }),
                extra_content: z.unknown().optional(),
              }),
            )
            .nullable()
            .optional(),
        }),
      }),
    )
    .min(1),
  usage: z
    .looseObject({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
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

/** Longest rest a provider can ask for, so a strange header cannot switch it off for days. */
const MAX_RETRY_AFTER_MS = 6 * 3600 * 1000;

/** Retry-After is either seconds or an HTTP date. */
export function retryAfterMs(headers: Headers, nowMs: number): number | undefined {
  const raw = headers.get('retry-after');
  if (raw === null) return undefined;
  const seconds = Number(raw);
  let ms: number | undefined;
  if (raw.trim() !== '' && Number.isFinite(seconds) && seconds >= 0) ms = seconds * 1000;
  else {
    const date = Date.parse(raw);
    if (!Number.isNaN(date)) ms = Math.max(0, date - nowMs);
  }
  return ms === undefined ? undefined : Math.min(ms, MAX_RETRY_AFTER_MS);
}

export interface ChatOptions {
  messages: ChatMessage[];
  tools: ToolDefinition[];
  maxTokens: number;
  timeoutMs: number;
  nowMs: number;
  /** Ask for a JSON object reply, where the provider supports it. */
  jsonOutput?: boolean;
  fetchImpl?: typeof fetch;
}

/** One chat completions request. Throws AiProviderError for every kind of failure. */
export async function chat(provider: AiProviderConfig, options: ChatOptions): Promise<ChatResult> {
  const spec = PROVIDERS[provider.id];
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const body = JSON.stringify({
    model: provider.model,
    messages: options.messages,
    ...(options.tools.length > 0 ? { tools: options.tools, tool_choice: 'auto' } : {}),
    max_tokens: options.maxTokens,
    stream: false,
    ...(options.jsonOutput && spec.jsonObject ? { response_format: { type: 'json_object' } } : {}),
    ...spec.extra(provider.model),
  });
  const sentTokens = estimateTokens(body);
  const fail = (
    category: AiErrorCategory,
    message: string,
    extra: { retry?: number | undefined; billed?: { inputTokens: number; outputTokens: number } } = {},
  ) => new AiProviderError(provider.id, category, `${spec.label}: ${message}`, extra.retry, extra.billed);

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
    if (controller.signal.aborted) {
      // The provider may have read the whole request before the time ran out, so it is counted.
      throw fail('timeout', `no reply within ${Math.round(options.timeoutMs / 1000)} seconds.`, {
        billed: { inputTokens: sentTokens, outputTokens: 0 },
      });
    }
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
    // Gemini's compatible endpoint can wrap its error in a one-item array.
    const unwrapped = Array.isArray(json) && json.length === 1 ? json[0] : json;
    const errorBody = errorBodySchema.safeParse(unwrapped);
    const said = errorBody.success
      ? typeof errorBody.data.error === 'string'
        ? errorBody.data.error
        : (errorBody.data.error?.message ?? errorBody.data.message)
      : undefined;
    // The provider's own words help with troubleshooting. The key is never in the request
    // body, but it is stripped anyway in case a provider echoes the header back.
    const detail = said ? ` It said: ${said.split(provider.apiKey).join('[REDACTED]').slice(0, 200)}` : '';
    throw fail(categoryFor(response.status), `the request was refused (HTTP ${response.status}).${detail}`, {
      retry: retryAfterMs(response.headers, options.nowMs),
    });
  }

  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) {
    throw fail('bad_response', 'the reply was not in the expected format.', {
      billed: { inputTokens: sentTokens, outputTokens: estimateTokens(text) },
    });
  }
  const choice = parsed.data.choices[0]!;
  const message = choice.message;
  const toolCalls: ToolCall[] = (message.tool_calls ?? []).map((call, index) => ({
    id: call.id && call.id.length > 0 ? call.id : `call_${index}`,
    type: 'function',
    function: { name: call.function.name, arguments: call.function.arguments ?? '{}' },
    // Only this field is carried over, not the whole object, so nothing else is echoed back.
    ...(call.extra_content !== undefined ? { extra_content: call.extra_content } : {}),
  }));
  const content = message.content ?? null;
  const usage = parsed.data.usage;
  const replyText = (content ?? '') + toolCalls.map((c) => c.function.arguments).join('');
  const inputTokens = usage?.prompt_tokens ?? sentTokens;
  // Some providers leave thinking out of completion_tokens but include it in total_tokens.
  const fromTotal = usage?.total_tokens !== undefined ? usage.total_tokens - inputTokens : 0;
  const outputTokens = Math.max(usage?.completion_tokens ?? estimateTokens(replyText), fromTotal);
  return { content, toolCalls, finishReason: choice.finish_reason ?? null, inputTokens, outputTokens };
}
