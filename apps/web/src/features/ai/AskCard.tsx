import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { AI_QUESTION_MAX_LENGTH, type AiAnswerDto, type AiReferenceDto, type AiStatusDto } from '@glm/shared';
import { Button, ErrorNotice, inputClass, Notice, SectionCard } from '../../components/ui';
import { timeAgo } from '../../lib/format';
import { useAiQuestions, useAiStatus, useAskAi } from '../../lib/queries';

const SUGGESTIONS = [
  'What happened with my lights last night?',
  'Why did my last schedule not work?',
  'Which light drops offline most often?',
];

const UNAVAILABLE: Record<NonNullable<AiStatusDto['reason']>, string> = {
  disabled: 'AI is turned off on this server.',
  no_providers: 'No AI provider is set up yet. Add a DeepSeek, Gemini or GLM key on the server to turn this on.',
  limit_reached: "This month's AI spending limit has been reached. It resets on the 1st.",
};

const REFERENCE = /\[\[((?:light|schedule|run|command|incident|activity):[A-Za-z0-9_-]{1,64})\]\]/g;

/** Shows an answer's text, with each cited record as a small link to where it is in the app. */
export function AnswerText({ answer }: { answer: AiAnswerDto }) {
  const byRef = new Map<string, AiReferenceDto>(answer.references.map((r) => [r.ref, r]));
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of answer.answer.matchAll(REFERENCE)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(answer.answer.slice(last, index));
    const ref = byRef.get(match[1]!);
    if (ref) {
      parts.push(
        <Link
          key={`${ref.ref}-${index}`}
          to={ref.href}
          title={ref.label}
          className="mx-0.5 inline-block max-w-56 truncate rounded bg-ink-800 px-1.5 align-baseline text-xs text-amber-soft hover:underline"
        >
          {ref.label}
        </Link>,
      );
    }
    last = index + match[0].length;
  }
  if (last < answer.answer.length) parts.push(answer.answer.slice(last));
  return <p className="whitespace-pre-line text-sm leading-relaxed text-ink-100">{parts}</p>;
}

function AnswerMeta({ answer, provider }: { answer: AiAnswerDto; provider: string }) {
  return (
    <p className="mt-2 text-xs text-ink-400">
      Answered by {provider} ({answer.model}) · {answer.costUsd > 0 ? `about $${answer.costUsd.toFixed(4)}` : 'no charge'} ·{' '}
      {timeAgo(answer.createdAt)}
    </p>
  );
}

/** Ask about what happened. Answers come from this app's records, and Ask cannot change anything. */
export function AskCard() {
  const status = useAiStatus();
  const ask = useAskAi();
  const history = useAiQuestions(4);
  const [question, setQuestion] = useState('');
  const providerLabel = (id: string) => status.data?.providers.find((p) => p.id === id)?.label ?? id;

  const submit = (event?: FormEvent, text = question) => {
    event?.preventDefault();
    const trimmed = text.trim();
    if (trimmed.length < 3 || ask.isPending) return;
    setQuestion(trimmed);
    ask.mutate(trimmed);
  };

  const latest = ask.data ?? null;
  const earlier = (history.data?.questions ?? []).filter((q) => q.id !== latest?.id).slice(0, 3);
  const reason = status.data?.reason ?? null;

  return (
    <SectionCard
      title="Ask"
      description="Questions about what your lights and schedules did. Answers come from this app's records, and Ask cannot change anything."
    >
      {reason ? (
        <Notice tone="info">{UNAVAILABLE[reason]}</Notice>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <label htmlFor="ai-question" className="sr-only">
            Your question
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="ai-question"
              className={`${inputClass} flex-1`}
              placeholder="Why didn't my lights come on last night?"
              value={question}
              maxLength={AI_QUESTION_MAX_LENGTH}
              onChange={(e) => setQuestion(e.target.value)}
            />
            <Button
              type="submit"
              variant="primary"
              busy={ask.isPending}
              disabled={question.trim().length < 3}
              icon={<Sparkles className="size-4" aria-hidden />}
            >
              Ask
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                className="rounded-full border border-ink-700 px-3 py-1 text-xs text-ink-300 hover:border-ink-500 hover:text-ink-100"
                onClick={() => submit(undefined, s)}
                disabled={ask.isPending}
              >
                {s}
              </button>
            ))}
          </div>
        </form>
      )}

      <div aria-live="polite">
        {ask.isPending ? <p className="mt-3 text-sm text-ink-300">Looking through the records…</p> : null}
        {ask.isError ? (
          <div className="mt-3">
            <ErrorNotice error={ask.error} title="No answer this time" />
          </div>
        ) : null}
        {latest ? (
          <div className="mt-4 rounded-lg bg-ink-850 p-3">
            <p className="mb-1 text-xs font-medium text-ink-300">{latest.question}</p>
            <AnswerText answer={latest} />
            <AnswerMeta answer={latest} provider={providerLabel(latest.provider)} />
          </div>
        ) : null}
      </div>

      {earlier.length > 0 ? (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-ink-300">Earlier questions</summary>
          <ul className="mt-2 space-y-3">
            {earlier.map((q) => (
              <li key={q.id} className="rounded-lg bg-ink-850 p-3">
                <p className="mb-1 text-xs font-medium text-ink-300">{q.question}</p>
                <AnswerText answer={q} />
                <AnswerMeta answer={q} provider={providerLabel(q.provider)} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </SectionCard>
  );
}
