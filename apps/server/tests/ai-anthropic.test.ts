import { afterEach, describe, expect, it } from 'vitest';
import type { AiAnswerDto, AiMoodDto, AiStatusDto, DiscoveryResultDto } from '@glm/shared';
import { toAnthropicMessages } from '../src/ai/providers.js';
import { authedClient, createHarness, type Harness } from './support/harness.js';
import { mockFullDevice } from './support/mock-govee.js';

/*
 * Claude through Anthropic's official SDK, with the SDK's network calls answered by a stand-in for the Messages API.
 * Nothing here contacts Anthropic, and the key is fake.
 */
const KEY = 'sk-ant-test-key-7c41e2';

interface Seen {
  url: string;
  headers: Headers;
  redirect: RequestInit['redirect'];
  hasSignal: boolean;
  body: {
    model: string;
    max_tokens: number;
    system?: string;
    thinking?: unknown;
    tools?: { name: string; input_schema: unknown }[];
    tool_choice?: unknown;
    messages: { role: string; content: unknown }[];
    [key: string]: unknown;
  };
}

class FakeAnthropic {
  readonly seen: Seen[] = [];
  readonly replies: { status?: number; json: unknown; headers?: Record<string, string> }[] = [];
  readonly fetch: typeof fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (new URL(url).hostname !== 'api.anthropic.com') throw new Error(`Unexpected host: ${url}`);
    this.seen.push({
      url,
      headers: new Headers(init?.headers),
      redirect: init?.redirect,
      hasSignal: init?.signal instanceof AbortSignal,
      body: JSON.parse(String(init?.body)) as Seen['body'],
    });
    const next = this.replies.shift() ?? { status: 500, json: { type: 'error', error: { type: 'api_error', message: 'no scripted reply' } } };
    return new Response(JSON.stringify(next.json), { status: next.status ?? 200, headers: { 'content-type': 'application/json', ...next.headers } });
  };
}

const message = (content: unknown[], stop: string = 'end_turn', usage = { input_tokens: 1000, output_tokens: 100 }) => ({
  json: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content, stop_reason: stop, stop_sequence: null, usage },
});
const text = (value: string) => message([{ type: 'text', text: value }]);

const harnesses: Harness[] = [];
const savedEnv = { base: process.env.ANTHROPIC_BASE_URL, token: process.env.ANTHROPIC_AUTH_TOKEN };
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.close();
  if (savedEnv.base === undefined) delete process.env.ANTHROPIC_BASE_URL;
  else process.env.ANTHROPIC_BASE_URL = savedEnv.base;
  if (savedEnv.token === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
  else process.env.ANTHROPIC_AUTH_TOKEN = savedEnv.token;
});

async function setup(env: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: KEY, AI_PROVIDERS: 'anthropic' }) {
  // The SDK would otherwise read these from the environment. The app must ignore both.
  process.env.ANTHROPIC_BASE_URL = 'https://proxy.invalid';
  process.env.ANTHROPIC_AUTH_TOKEN = 'environment-token-that-must-not-be-sent';
  const fake = new FakeAnthropic();
  const h = await createHarness({ env, overrides: { aiFetch: fake.fetch } });
  harnesses.push(h);
  h.mock.devices = [{ ...mockFullDevice(), deviceName: 'Porch' }];
  const client = await authedClient(h.app);
  const { devices } = (await client.post('/api/v1/devices/discover')).json() as DiscoveryResultDto;
  return { h, fake, client, light: devices[0]! };
}

describe('Claude, through the official SDK', () => {
  it('uses Claude Haiku 5.5 by default, with thinking off, the key in its own header and redirects refused', async () => {
    const { h, fake, client } = await setup();
    const status = (await client.get('/api/v1/ai/status')).json() as AiStatusDto;
    expect(status.providers).toEqual([{ id: 'anthropic', label: 'Anthropic Claude', model: 'claude-haiku-5-5', available: true, note: null }]);

    fake.replies.push(text('All four lights answered today.'));
    const answer = (await client.post('/api/v1/ai/ask', { question: 'Is everything fine?' })).json() as AiAnswerDto;
    expect(answer).toMatchObject({ answer: 'All four lights answered today.', provider: 'anthropic', model: 'claude-haiku-5-5' });
    // Claude Haiku 5.5's listed price: (1000 x 0.10 + 100 x 0.50) per million.
    expect(answer.costUsd).toBeCloseTo(0.00015, 9);

    const [request] = fake.seen;
    // The fixed host, whatever ANTHROPIC_BASE_URL says, and only this account's key: the SDK sends it as a Bearer token.
    expect(request!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(request!.headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(JSON.stringify([...request!.headers.entries()])).not.toContain('environment-token-that-must-not-be-sent');
    expect(request!.headers.get('anthropic-version')).toBeTruthy();
    expect(request!.redirect).toBe('error');
    expect(request!.hasSignal).toBe(true);
    expect(request!.body).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 1500, thinking: { type: 'disabled' }, tool_choice: { type: 'auto' } });
    // The instructions go in `system`, and only the question is a user turn.
    expect(request!.body.system).toContain('Govee Light Manager');
    expect(request!.body.messages).toEqual([{ role: 'user', content: 'Is everything fine?' }]);
    expect(request!.body.tools!.map((t) => t.name)).toContain('list_lights');
    // The key never reaches a body, a log line or the ledger.
    expect(JSON.stringify(fake.seen.map((s) => s.body))).not.toContain(KEY);
    expect(h.logs()).not.toContain(KEY);
  });

  it('runs Ask\'s tools: a tool call goes back as tool_use, and its result as tool_result in one user turn', async () => {
    const { fake, client, light } = await setup();
    fake.replies.push(
      message([{ type: 'text', text: 'Let me look.' }, { type: 'tool_use', id: 'toolu_1', name: 'list_lights', input: {} }], 'tool_use', { input_tokens: 800, output_tokens: 40 }),
      text(`Porch is online [[light:${light.id}]].`),
    );
    const answer = (await client.post('/api/v1/ai/ask', { question: 'Is the porch on?' })).json() as AiAnswerDto;
    expect(answer.answer).toBe(`Porch is online [[light:${light.id}]].`);
    expect(answer.references).toHaveLength(1);

    const second = fake.seen[1]!.body.messages;
    expect(second[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me look.' },
        { type: 'tool_use', id: 'toolu_1', name: 'list_lights', input: {} },
      ],
    });
    expect(second[2]!.role).toBe('user');
    const results = second[2]!.content as { type: string; tool_use_id: string; content: string }[];
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_1' });
    expect(results[0]!.content).toContain('Porch');
    // A Govee address never leaves the server, for Claude as for the others.
    expect(JSON.stringify(fake.seen)).not.toContain('AA:BB:CC');
  });

  it('designs a mood with Claude, and says the review came from the same model when it is the only provider', async () => {
    const { fake, client } = await setup();
    const brief = {
      isMood: true,
      mood: 'Cozy fireside',
      feeling: ['warm'],
      temperature: 'warm',
      energy: 'calm',
      palette: [
        { name: 'ember', hex: '#ff7a1a', role: 'main' },
        { name: 'red', hex: '#ff3b1f', role: 'accent' },
      ],
      brightness: { min: 20, max: 40 },
      motifs: [],
      motionNote: null,
    };
    const plan = { name: 'Fireside', why: 'Warm embers.', lights: [{ light: 'L1', brightness: 30, look: { type: 'gradient', stops: ['#ff3b1f', '#ff7a1a'] } }], note: null };
    fake.replies.push(text(JSON.stringify(brief)), text(JSON.stringify(plan)), text(JSON.stringify({ score: 9, matches: true, problems: [], summary: 'Warm.', corrected: null })));
    const dto = (await client.post('/api/v1/ai/mood', { description: 'cozy fireside evening' })).json() as AiMoodDto;
    expect(dto).toMatchObject({ isMood: true, provider: 'anthropic' });
    expect(dto.mood!.checks.review).toMatchObject({ status: 'passed', by: 'Anthropic Claude', independent: false });
    expect(dto.mood!.clean).toBe(false);
    expect(fake.seen).toHaveLength(3);
  });

  it('rests Claude after a refused key, and never shows the key in the error', async () => {
    const { h, fake, client } = await setup();
    fake.replies.push({ status: 401, json: { type: 'error', error: { type: 'authentication_error', message: `invalid x-api-key ${KEY}` } } });
    const response = await client.post('/api/v1/ai/ask', { question: 'Anything wrong?' });
    expect(response.statusCode).toBe(502);
    expect(response.json().error.message).toContain('Anthropic Claude: the request was refused (HTTP 401)');
    expect(response.body).not.toContain(KEY);
    const status = (await client.get('/api/v1/ai/status')).json() as AiStatusDto;
    expect(status.providers[0]).toMatchObject({ available: false });
    expect(JSON.stringify(status)).not.toContain(KEY);
    expect(h.logs()).not.toContain(KEY);
    // The failed request is still recorded against the cap.
    expect(h.ctx.db.prepare("SELECT COUNT(*) AS n FROM ai_usage WHERE provider = 'anthropic' AND outcome = 'error'").get()).toEqual({ n: 1 });
  });

  it('follows a rate limit\'s Retry-After, and treats a reply cut short as a failure', async () => {
    const { fake, client } = await setup();
    fake.replies.push({ status: 429, json: { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }, headers: { 'retry-after': '120' } });
    expect((await client.post('/api/v1/ai/ask', { question: 'Busy?' })).statusCode).toBe(502);
    const rested = (await client.get('/api/v1/ai/status')).json() as AiStatusDto;
    expect(rested.providers[0]!.available).toBe(false);

    const { fake: fake2, client: client2 } = await setup();
    fake2.replies.push(message([{ type: 'text', text: 'Half an ans' }], 'max_tokens'));
    const cut = await client2.post('/api/v1/ai/ask', { question: 'Long one?' });
    expect(cut.statusCode).toBe(502);
    expect(cut.json().error.message).toContain('cut short (length)');
  });
});

describe('Claude: the last step and refusals', () => {
  it('writes earlier tool turns as text on a step with no tools, so the request stays valid', () => {
    const { messages } = toAnthropicMessages(
      [
        { role: 'user', content: 'Question?' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'a', type: 'function', function: { name: 'list_lights', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'a', content: 'Porch is online' },
      ],
      false,
    );
    expect(JSON.stringify(messages)).not.toMatch(/tool_use|tool_result/);
    expect(messages[1]).toEqual({ role: 'assistant', content: [{ type: 'text', text: '(Looked up list_lights with {}.)' }] });
    expect(messages[2]).toEqual({ role: 'user', content: 'Result of that lookup: Porch is online' });
  });

  it('does not rest Claude when it declines to answer', async () => {
    const { fake, client } = await setup();
    fake.replies.push(message([], 'refusal'));
    expect((await client.post('/api/v1/ai/ask', { question: 'Something?' })).statusCode).toBe(502);
    const status = (await client.get('/api/v1/ai/status')).json() as AiStatusDto;
    expect(status.providers[0]!.available).toBe(true);
  });
});

describe('the app\'s conversation in Messages API form', () => {
  it('moves system text out, merges tool results that answer one reply, and keeps the order', () => {
    const { system, messages } = toAnthropicMessages([
      { role: 'system', content: 'Rules.' },
      { role: 'user', content: 'Question?' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'a', type: 'function', function: { name: 'one', arguments: '{"x":1}' } },
          { id: 'b', type: 'function', function: { name: 'two', arguments: 'not json' } },
        ],
      },
      { role: 'tool', tool_call_id: 'a', content: 'first' },
      { role: 'tool', tool_call_id: 'b', content: 'second' },
      { role: 'assistant', content: '' },
      { role: 'user', content: 'Thanks.' },
    ]);
    expect(system).toBe('Rules.');
    expect(messages).toEqual([
      { role: 'user', content: 'Question?' },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'a', name: 'one', input: { x: 1 } },
          // Arguments that did not parse become an empty object, so the turn stays valid.
          { type: 'tool_use', id: 'b', name: 'two', input: {} },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'a', content: 'first' },
          { type: 'tool_result', tool_use_id: 'b', content: 'second' },
        ],
      },
      // An empty reply is left out rather than sent empty.
      { role: 'user', content: 'Thanks.' },
    ]);
  });
});
