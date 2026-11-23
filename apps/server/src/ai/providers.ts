import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { AI_PROVIDER_LABELS, type AiProviderId } from '@glm/shared';
import type { AiProviderConfig } from '../config/env.js';

/**
 * Every provider but Anthropic accepts the same OpenAI-style chat completions request, so one small client covers
 * them with no SDK. Anthropic is called through its official SDK, set up the same way: a fixed host, redirects
 * refused, and no retries of its own, so the app's failover decides. Hosts are fixed here, never configurable, so a
 * key can only ever be sent to its own provider.
 *
 * Checked against each provider's own documentation on 22 November 2026 (see docs/ai-features-plan.md, "The
 * providers", for the sources): models, prices, endpoints, token fields and how to keep thinking low.
 */
interface ProviderSpec {
  /** "openai" for an OpenAI-style chat completions endpoint, "anthropic" for the Messages API through its SDK. */
  adapter: 'openai' | 'anthropic';
  /** The chat completions URL, or for Anthropic the API's base URL. */
  url: string;
  /** Whether the provider documents `response_format: {type: 'json_object'}` on this endpoint. */
  jsonObject: boolean;
  /** OpenAI's reasoning models refuse `max_tokens` and take `max_completion_tokens`. */
  tokensField: 'max_tokens' | 'max_completion_tokens';
  /** Extra request fields for a model. Thinking is turned off or kept low: these answers are short. */
  extra: (model: string) => Record<string, unknown>;
  /**
   * Tokens added to the reply limit for a model that always thinks, since its thinking counts against the same limit
   * and could otherwise leave no room for the answer. It is billed only as used.
   */
  thinkingRoom?: (model: string) => number;
}

const PROVIDERS: Record<AiProviderId, ProviderSpec> = {
  deepseek: {
    adapter: 'openai',
    url: 'https://api.deepseek.com/chat/completions',
    jsonObject: true,
    tokensField: 'max_tokens',
    // Thinking is on by default, and with tools its reasoning would have to be sent back each round.
    extra: () => ({ thinking: { type: 'disabled' } }),
  },
  gemini: {
    adapter: 'openai',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    // Its compatible endpoint documents schema-based structured output, not json_object, so JSON is asked for in the prompt.
    jsonObject: false,
    tokensField: 'max_tokens',
    // Gemini 3.x Flash-Lite cannot turn thinking off, and thinks at its lowest level, "minimal", unless asked for more,
    // so nothing is sent. (Sending reasoning_effort "low" would raise it.) Gemini 2.5 Flash-Lite does not think by default.
    extra: () => ({}),
  },
  glm: {
    adapter: 'openai',
    url: 'https://api.z.ai/api/paas/v4/chat/completions',
    jsonObject: true,
    tokensField: 'max_tokens',
    // The GLM-5.3 series can only think, and defaults to maximum effort. Older models can turn it off.
    extra: (model) =>
      model.toLowerCase().startsWith('glm-5.3')
        ? { thinking: { type: 'enabled' }, reasoning_effort: 'low' }
        : { thinking: { type: 'disabled' } },
    thinkingRoom: (model) => (model.toLowerCase().startsWith('glm-5.3') ? 1_024 : 0),
  },
  openai: {
    adapter: 'openai',
    url: 'https://api.openai.com/v1/chat/completions',
    // GPT-6 Luna's page lists structured outputs but not JSON mode, so JSON is asked for in the prompt.
    jsonObject: false,
    tokensField: 'max_completion_tokens',
    // GPT-6 Luna and GPT-5.6 Luna reason at "medium" unless told otherwise, and on Chat Completions they accept tools only
    // with reasoning turned off.
    extra: () => ({ reasoning_effort: 'none' }),
  },
  anthropic: {
    adapter: 'anthropic',
    url: 'https://api.anthropic.com',
    // Claude has no schema-free JSON mode, so JSON is asked for in the prompt, which it follows closely.
    jsonObject: false,
    tokensField: 'max_tokens',
    // Claude Haiku 5.5 thinks by default. These answers are short, so it is turned off, as for the other providers.
    extra: () => ({ thinking: { type: 'disabled' } }),
  },
  meta: {
    adapter: 'openai',
    url: 'https://api.meta.ai/v1/chat/completions',
    // The Model API constrains JSON only through a schema, so JSON is asked for in the prompt.
    jsonObject: false,
    tokensField: 'max_completion_tokens',
    // Muse models always reason, at "max" by default on Muse Ember. "low" is the lowest documented setting short of
    // "minimal", whose support on Chat Completions is not confirmed.
    extra: () => ({ reasoning_effort: 'low' }),
    thinkingRoom: () => 2_048,
  },
};

export function providerLabel(id: AiProviderId): string {
  return AI_PROVIDER_LABELS[id];
}

/** The extra fields a request to this provider and model carries. Exported for tests. */
export function requestExtras(id: AiProviderId, model: string): Record<string, unknown> {
  return PROVIDERS[id].extra(model);
}

/**
 * Listed paid prices in USD per million tokens, for each provider's cheap models, cheapest reliable one first: it is
 * the one a person is offered first. Free tiers are still counted at the paid price, so the monthly cap never relies
 * on a free allowance that may change. DeepSeek is counted at its peak rate, which is double its off-peak rate.
 */
const MODELS: { provider: AiProviderId; model: string; input: number; output: number; offered: boolean }[] = [
  { provider: 'deepseek', model: 'deepseek-flash', input: 0.3, output: 1.2, offered: true },
  // A legacy name for the same model. Still priced, for keys saved with it, and no longer offered.
  { provider: 'deepseek', model: 'deepseek-v4-flash', input: 0.3, output: 1.2, offered: false },
  // 3.5 Flash-Lite has no shutdown date. 3.1 shuts down on 7 May 2027, and new keys cannot use 2.5, so neither is offered;
  // both stay priced for keys saved with them.
  { provider: 'gemini', model: 'gemini-3.5-flash-lite', input: 0.3, output: 2.5, offered: true },
  { provider: 'gemini', model: 'gemini-3.1-flash-lite', input: 0.25, output: 1.5, offered: false },
  { provider: 'gemini', model: 'gemini-2.5-flash-lite', input: 0.1, output: 0.4, offered: false },
  // GLM-4.7-Flash is free, but Z.ai has moved it out of its API reference and does not publish its limits.
  { provider: 'glm', model: 'glm-5.3-flash', input: 0.15, output: 0.5, offered: true },
  { provider: 'glm', model: 'glm-4.7-flash', input: 0, output: 0, offered: true },
  { provider: 'glm', model: 'glm-4.5-flash', input: 0, output: 0, offered: false },
  // gpt-5-nano and gpt-5-mini shut down on 11 December 2026, so they are not listed.
  { provider: 'openai', model: 'gpt-6-luna', input: 0.1, output: 0.5, offered: true },
  { provider: 'openai', model: 'gpt-5.6-luna', input: 0.2, output: 1.2, offered: true },
  // Prices up to 100,000 tokens of input; these prompts are far below that.
  { provider: 'anthropic', model: 'claude-haiku-5-5', input: 0.1, output: 0.5, offered: true },
  // Standard models only: the cheaper "contributor" ones let Meta use what is sent. Prices up to 200,000 tokens of input.
  { provider: 'meta', model: 'muse-ember-1.0', input: 0.1, output: 0.5, offered: true },
  { provider: 'meta', model: 'muse-spark-1.3', input: 1.25, output: 4.25, offered: true },
];
/** For a model not listed above. Deliberately high, so an unknown price cannot slip past the cap. */
const UNKNOWN_PRICE = { input: 2, output: 10 };

function priceOf(model: string): { input: number; output: number } | undefined {
  return MODELS.find((m) => m.model === model.toLowerCase());
}

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = priceOf(model) ?? UNKNOWN_PRICE;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

export function knownPrice(model: string): boolean {
  return priceOf(model) !== undefined;
}

/**
 * The models a person may pick with their own key: those with a listed price, so what they spend is always counted
 * against their cap at a known rate. The cheapest reliable one comes first; a cheaper one later in the list, such as a
 * free model with unpublished limits, is there for whoever wants it.
 */
export function modelsFor(id: AiProviderId): string[] {
  return MODELS.filter((m) => m.provider === id && m.offered).map((m) => m.model);
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

/** One chat request, to whichever provider. Throws AiProviderError for every kind of failure. */
export async function chat(provider: AiProviderConfig, options: ChatOptions): Promise<ChatResult> {
  const spec = PROVIDERS[provider.id];
  if (spec.adapter === 'anthropic') return chatAnthropic(provider, options, spec);
  const label = providerLabel(provider.id);
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const body = JSON.stringify({
    model: provider.model,
    messages: options.messages,
    ...(options.tools.length > 0 ? { tools: options.tools, tool_choice: 'auto' } : {}),
    [spec.tokensField]: options.maxTokens + (spec.thinkingRoom?.(provider.model) ?? 0),
    stream: false,
    ...(options.jsonOutput && spec.jsonObject ? { response_format: { type: 'json_object' } } : {}),
    ...spec.extra(provider.model),
  });
  const sentTokens = estimateTokens(body);
  const fail = (
    category: AiErrorCategory,
    message: string,
    extra: { retry?: number | undefined; billed?: { inputTokens: number; outputTokens: number } } = {},
  ) => new AiProviderError(provider.id, category, `${label}: ${message}`, extra.retry, extra.billed);

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

/* -------------------------------- Anthropic -------------------------------- */

type AnthropicMessage = Anthropic.MessageParam;

/**
 * The app's OpenAI-style conversation as Messages API turns: system text goes in `system`, a tool call becomes a
 * `tool_use` block, and the tool results that answer one reply go back together, in one user turn. With `withTools`
 * false (Ask's last step, which must answer), earlier tool turns are written out as text, because the Messages API
 * refuses tool blocks in a request that defines no tools.
 */
export function toAnthropicMessages(messages: ChatMessage[], withTools = true): { system: string; messages: AnthropicMessage[] } {
  const system: string[] = [];
  const out: AnthropicMessage[] = [];
  for (const message of messages) {
    if (message.role === 'assistant') {
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (message.content && message.content.trim() !== '') blocks.push({ type: 'text', text: message.content });
      for (const call of message.tool_calls ?? []) {
        if (!withTools) {
          blocks.push({ type: 'text', text: `(Looked up ${call.function.name} with ${call.function.arguments || '{}'}.)` });
          continue;
        }
        let input: unknown = {};
        try {
          input = JSON.parse(call.function.arguments || '{}');
        } catch {
          // The model's own arguments did not parse. An empty object keeps the turn valid; the tool already said why.
        }
        blocks.push({ type: 'tool_use', id: call.id, name: call.function.name, input: input as Record<string, unknown> });
      }
      // An empty reply cannot be sent back, and leaving it out keeps the turns in order.
      if (blocks.length > 0) out.push({ role: 'assistant', content: blocks });
    } else if (message.role === 'system') {
      system.push(message.content);
    } else if (message.role === 'user') {
      out.push({ role: 'user', content: message.content });
    } else if (message.role === 'tool' && !withTools) {
      out.push({ role: 'user', content: `Result of that lookup: ${message.content}` });
    } else if (message.role === 'tool') {
      const result: Anthropic.ToolResultBlockParam = { type: 'tool_result', tool_use_id: message.tool_call_id, content: message.content };
      const last = out.at(-1);
      if (last && last.role === 'user' && Array.isArray(last.content) && last.content.every((b) => b.type === 'tool_result')) {
        last.content.push(result);
      } else {
        out.push({ role: 'user', content: [result] });
      }
    }
  }
  return { system: system.join('\n\n'), messages: out };
}

/** Messages API stop reasons in the app's words, so a reply cut short is caught the same way for every provider. */
function finishFrom(reason: Anthropic.StopReason | null): string | null {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'tool_use':
      return 'tool_calls';
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'length';
    case null:
      return null;
    default:
      return reason;
  }
}

async function chatAnthropic(provider: AiProviderConfig, options: ChatOptions, spec: ProviderSpec): Promise<ChatResult> {
  const label = providerLabel(provider.id);
  const fetchImpl = options.fetchImpl ?? fetch;
  const client = new Anthropic({
    apiKey: provider.apiKey,
    // Never a token or a base URL from this process's environment: only the key this account saved, sent to Anthropic.
    authToken: null,
    baseURL: spec.url,
    maxRetries: 0,
    timeout: options.timeoutMs,
    // Redirects are refused, as for every provider, so the key cannot follow one somewhere else.
    fetch: ((url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => fetchImpl(url, { ...init, redirect: 'error' })) as typeof fetch,
  });
  const { system, messages } = toAnthropicMessages(options.messages, options.tools.length > 0);
  const tools = options.tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters as Anthropic.Tool.InputSchema,
  }));
  const sentTokens = estimateTokens(JSON.stringify({ system, messages, tools }));
  const fail = (category: AiErrorCategory, message: string, extra: { retry?: number | undefined; billed?: { inputTokens: number; outputTokens: number } } = {}) =>
    new AiProviderError(provider.id, category, `${label}: ${message}`, extra.retry, extra.billed);

  let reply: Anthropic.Message;
  try {
    reply = await client.messages.create({
      model: provider.model,
      max_tokens: options.maxTokens,
      ...(system ? { system } : {}),
      messages,
      ...(tools.length > 0 ? { tools, tool_choice: { type: 'auto' as const } } : {}),
      ...(spec.extra(provider.model) as Partial<Anthropic.MessageCreateParamsNonStreaming>),
    });
  } catch (error) {
    if (error instanceof Anthropic.APIConnectionTimeoutError) {
      // The provider may have read the whole request before the time ran out, so it is counted.
      throw fail('timeout', `no reply within ${Math.round(options.timeoutMs / 1000)} seconds.`, { billed: { inputTokens: sentTokens, outputTokens: 0 } });
    }
    if (error instanceof Anthropic.APIConnectionError) throw fail('network', 'could not be reached.');
    if (error instanceof Anthropic.APIError && typeof error.status === 'number') {
      const said = error.message ? ` It said: ${error.message.split(provider.apiKey).join('[REDACTED]').slice(0, 200)}` : '';
      throw fail(categoryFor(error.status), `the request was refused (HTTP ${error.status}).${said}`, {
        retry: error.headers ? retryAfterMs(error.headers, options.nowMs) : undefined,
      });
    }
    throw fail('bad_response', 'the reply was not in the expected format.', { billed: { inputTokens: sentTokens, outputTokens: 0 } });
  }

  if (reply.stop_reason === 'refusal') {
    // The model declined. That is its answer, not an outage, so the provider is not rested; the request moves on.
    throw fail('invalid_output', 'declined to answer this request.', {
      billed: { inputTokens: reply.usage.input_tokens, outputTokens: reply.usage.output_tokens },
    });
  }
  const text = reply.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
  const toolCalls: ToolCall[] = reply.content.flatMap((block) =>
    block.type === 'tool_use' ? [{ id: block.id, type: 'function' as const, function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) } }] : [],
  );
  return {
    content: text === '' ? null : text,
    toolCalls,
    finishReason: finishFrom(reply.stop_reason),
    inputTokens: reply.usage.input_tokens + (reply.usage.cache_creation_input_tokens ?? 0) + (reply.usage.cache_read_input_tokens ?? 0),
    outputTokens: reply.usage.output_tokens,
  };
}
