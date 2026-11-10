import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiAnswerDto, AiStatusDto } from '@glm/shared';
import { mockApi, renderApp } from '../../test/fixtures';
import { AiSettings } from './AiSettings';
import { AskCard } from './AskCard';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const status = (overrides: Partial<AiStatusDto> = {}): AiStatusDto => ({
  enabled: true,
  reason: null,
  providers: [
    { id: 'deepseek', label: 'DeepSeek', model: 'deepseek-flash', available: true, note: null },
    { id: 'glm', label: 'Z.ai GLM', model: 'glm-4.7-flash', available: false, note: 'Z.ai GLM: the request was refused (HTTP 429).' },
  ],
  monthSpentUsd: 0.0123,
  monthlyLimitUsd: 5,
  ...overrides,
});

const answer: AiAnswerDto = {
  id: 7,
  question: 'What happened last night?',
  answer: 'The 6 PM run failed [[run:r1]] because Porch was offline [[light:d1]].',
  references: [
    { ref: 'run:r1', kind: 'run', label: 'Evening on, 2026-11-08 18:00', href: '/schedules' },
    { ref: 'light:d1', kind: 'light', label: 'Porch', href: '/devices/d1' },
  ],
  provider: 'deepseek',
  model: 'deepseek-flash',
  costUsd: 0.0006,
  createdAt: new Date().toISOString(),
};

describe('Ask', () => {
  it('sends the question and shows the answer with links to the records it used', async () => {
    const { calls } = mockApi({
      'GET /ai/status': { json: status() },
      'GET /ai/questions': { json: { questions: [] } },
      'POST /ai/ask': { json: answer },
    });
    renderApp(<AskCard />);
    await userEvent.type(await screen.findByLabelText('Your question'), 'What happened last night?');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

    expect(await screen.findByText(/The 6 PM run failed/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Porch' })).toHaveAttribute('href', '/devices/d1');
    expect(screen.getByRole('link', { name: 'Evening on, 2026-11-08 18:00' })).toHaveAttribute('href', '/schedules');
    expect(screen.queryByText(/\[\[/)).not.toBeInTheDocument();
    expect(screen.getByText(/Answered by DeepSeek \(deepseek-flash\)/)).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ question: 'What happened last night?' });
  });

  it('asks a suggested question in one tap', async () => {
    const { calls } = mockApi({
      'GET /ai/status': { json: status() },
      'GET /ai/questions': { json: { questions: [] } },
      'POST /ai/ask': { json: answer },
    });
    renderApp(<AskCard />);
    await userEvent.click(await screen.findByRole('button', { name: 'Which light drops offline most often?' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ question: 'Which light drops offline most often?' }),
    );
  });

  it('explains why it is unavailable instead of showing the box', async () => {
    mockApi({
      'GET /ai/status': { json: status({ enabled: false, reason: 'no_providers', providers: [] }) },
      'GET /ai/questions': { json: { questions: [] } },
    });
    renderApp(<AskCard />);
    expect(await screen.findByText(/No AI provider is set up yet/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Your question')).not.toBeInTheDocument();
  });

  it('shows the server message when no answer comes back', async () => {
    mockApi({
      'GET /ai/status': { json: status() },
      'GET /ai/questions': { json: { questions: [] } },
      'POST /ai/ask': {
        status: 502,
        json: { error: { code: 'ai_unavailable', message: 'No AI provider could answer right now.', requestId: 'req-1' } },
      },
    });
    renderApp(<AskCard />);
    await userEvent.type(await screen.findByLabelText('Your question'), 'Anything wrong?');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByText('No AI provider could answer right now.')).toBeInTheDocument();
  });
});

describe('AI settings', () => {
  it('lists providers, this month’s spend and what is sent, with no keys', async () => {
    mockApi({ 'GET /ai/status': { json: status() } });
    renderApp(<AiSettings />);
    expect(await screen.findByText('DeepSeek')).toBeInTheDocument();
    expect(screen.getByText('Resting after an error')).toBeInTheDocument();
    expect(screen.getByText(/about \$0\.0123 of the \$5\.00 limit/)).toBeInTheDocument();
    expect(screen.getByText(/DeepSeek processes data in China/)).toBeInTheDocument();
  });
});
