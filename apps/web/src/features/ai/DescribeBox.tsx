import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { AI_QUESTION_MAX_LENGTH } from '@glm/shared';
import { Button, ErrorNotice, inputClass, Notice } from '../../components/ui';
import { useAiStatus } from '../../lib/queries';

interface DescribeBoxProps {
  label: string;
  placeholder: string;
  busy: boolean;
  error: unknown;
  /** Shown after a draft arrives: what to check, and any note from the model. */
  result: { message: string; note: string | null } | null;
  onDescribe: (description: string) => void;
}

/**
 * Describe something in words and get a draft in the editor. Hidden when AI is not set up,
 * so the editors look as they always did. The draft is only ever shown, never sent or saved.
 */
export function DescribeBox({ label, placeholder, busy, error, result, onDescribe }: DescribeBoxProps) {
  const status = useAiStatus();
  const [text, setText] = useState('');
  if (!status.data || status.data.reason !== null) return null;

  // A button, not a form, because this sits inside the schedule editor's own form.
  const submit = (event: { preventDefault: () => void; stopPropagation: () => void }) => {
    event.preventDefault();
    event.stopPropagation();
    const trimmed = text.trim();
    if (trimmed.length >= 3 && !busy) onDescribe(trimmed);
  };

  return (
    <div className="space-y-2 rounded-lg border border-ink-700/70 bg-ink-850 p-3">
      <label htmlFor="ai-describe" className="block text-sm font-medium text-ink-200">
        {label}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="ai-describe"
          className={`${inputClass} flex-1`}
          placeholder={placeholder}
          value={text}
          maxLength={AI_QUESTION_MAX_LENGTH}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit(e);
          }}
        />
        <Button
          type="button"
          variant="primary"
          busy={busy}
          disabled={text.trim().length < 3}
          icon={<Sparkles className="size-4" aria-hidden />}
          onClick={(e) => submit(e)}
        >
          Draft it
        </Button>
      </div>
      <div aria-live="polite" className="space-y-2">
        {busy ? <p className="text-xs text-ink-300">Drafting…</p> : null}
        {error ? <ErrorNotice error={error} title="No draft this time" /> : null}
        {result ? (
          <Notice tone="info">
            {result.message}
            {result.note ? <span className="mt-1 block">{result.note}</span> : null}
          </Notice>
        ) : null}
      </div>
    </div>
  );
}
