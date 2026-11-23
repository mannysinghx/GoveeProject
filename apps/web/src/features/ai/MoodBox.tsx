import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Info, Play, RotateCcw, Save, Send, Sparkles } from 'lucide-react';
import { AI_QUESTION_MAX_LENGTH, type AiMoodDto, type AiMoodLightDto, type AiMoodResultDto, type AiStatusDto, type RunResultDto, type Target } from '@glm/shared';
import { Spectrum } from '../../components/light';
import { RunResults } from '../../components/status';
import { Button, ErrorNotice, Field, inputClass, Notice } from '../../components/ui';
import { usePreference } from '../../lib/preference-store';
import { useAiStatus, useApplyDraft, useSavePreset, useSetMood } from '../../lib/queries';
import { parseTarget, TargetOptions } from '../presets/ApplyPresetDialog';
import {
  acceptedSummary,
  checkRows,
  describeColors,
  holdReason,
  MOOD_SUGGESTIONS,
  presetDescription,
  previewFirstStore,
  shouldApplyNow,
  type CheckState,
} from './mood-model';

type Phase = 'idle' | 'working' | 'done' | 'failed';

interface Entry {
  id: number;
  words: string;
  target: Target | undefined;
  design: { phase: 'working' | 'ready' | 'failed'; dto?: AiMoodDto; error?: unknown };
  apply: { phase: Phase; run?: RunResultDto; error?: unknown };
  save: { phase: 'idle' | 'naming' | 'saving' | 'done' | 'failed'; name: string; error?: unknown };
}

/** The newest few stay on the page. */
const KEEP_ENTRIES = 6;

const UNAVAILABLE: Record<NonNullable<AiStatusDto['reason']>, string | null> = {
  disabled: null,
  no_providers: 'AI is not set up on this server yet.',
  no_key: null,
  limit_reached: "This month's AI spending limit has been reached. It resets on the 1st.",
};

const CHECK_ICON: Record<CheckState, { icon: typeof CheckCircle2; className: string; word: string }> = {
  pass: { icon: CheckCircle2, className: 'text-good', word: 'Passed' },
  adjusted: { icon: CheckCircle2, className: 'text-good', word: 'Adjusted and passed' },
  self: { icon: Info, className: 'text-warn', word: 'Not independent' },
  concern: { icon: AlertTriangle, className: 'text-warn', word: 'Needs a look' },
  unavailable: { icon: Info, className: 'text-fg-4', word: 'Not available' },
};

function LightRow({ light }: { light: AiMoodLightDto }) {
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate font-medium">{light.name}</span>
        <span className="shrink-0 text-xs text-fg-4 tabular-nums">{light.brightness === null ? 'brightness not adjustable' : `${light.brightness}% bright`}</span>
      </div>
      {light.colors.length > 0 ? (
        <>
          <Spectrum colors={light.colors} height="h-4" />
          <span className="sr-only">
            {light.colors.length === 1 ? 'Colour' : 'Colours along it'}: {describeColors(light.colors)}.
          </span>
        </>
      ) : (
        <p className="text-xs text-fg-3">Turns on. This light has no colour control.</p>
      )}
    </li>
  );
}

function Checks({ mood }: { mood: AiMoodResultDto }) {
  return (
    <ul aria-label="Checks" className="space-y-2.5">
      {checkRows(mood).map((row) => {
        const { icon: Icon, className, word } = CHECK_ICON[row.state];
        return (
          <li key={row.key} className="flex items-start gap-2.5 text-sm">
            <Icon className={`mt-0.5 size-4 shrink-0 ${className}`} aria-hidden />
            <div className="min-w-0">
              <p className="font-medium">
                {row.label}
                <span className="sr-only">: {word}</span>
              </p>
              <p className="text-fg-3">{row.detail}</p>
              {row.notes.length > 0 ? (
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-fg-3">
                  {row.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

interface ReplyProps {
  entry: Entry;
  previewFirst: boolean;
  busy: boolean;
  onApply: (entry: Entry, mood: AiMoodResultDto) => void;
  onTryAgain: (entry: Entry) => void;
  onSaveStart: (entry: Entry, mood: AiMoodResultDto) => void;
  onSaveName: (entry: Entry, name: string) => void;
  onSave: (entry: Entry, mood: AiMoodResultDto) => void;
}

function Reply({ entry, previewFirst, busy, onApply, onTryAgain, onSaveStart, onSaveName, onSave }: ReplyProps) {
  const { design, apply, save } = entry;
  if (design.phase === 'working') {
    return (
      <div className="rounded-3xl bg-inset p-4 text-sm text-fg-3" role="status">
        <p className="flex items-center gap-2 font-medium text-fg">
          <Sparkles className="size-4 animate-pulse text-accent-text" aria-hidden />
          Designing your mood
        </p>
        <p className="mt-1">The colours are made, checked against your lights and the mood, then looked over by a second model. This takes 10 to 30 seconds. Nothing changes on your lights yet.</p>
      </div>
    );
  }
  if (design.phase === 'failed') return <ErrorNotice error={design.error} title="No mood this time" />;
  const dto = design.dto;
  if (!dto) return null;
  if (!dto.isMood || !dto.mood) {
    return (
      <div className="rounded-3xl bg-inset p-4 text-sm" role="status">
        <p>{dto.reply}</p>
        <p className="mt-1 text-xs text-fg-4">Nothing was changed on your lights.</p>
      </div>
    );
  }

  const { mood } = dto;
  const held = apply.phase === 'idle' ? holdReason(mood, previewFirst) : '';
  return (
    <article className="space-y-4 rounded-3xl bg-inset p-4 sm:p-5" aria-label={`Mood: ${mood.name}`}>
      <div>
        <h3 className="font-display text-xl font-semibold tracking-tight break-words">{mood.name}</h3>
        <p className="mt-1 text-sm text-fg-2">{mood.summary}</p>
        {mood.note ? <p className="mt-1 text-xs text-fg-3">{mood.note}</p> : null}
      </div>

      <ul aria-label="What each light shows" className="space-y-3">
        {mood.lights.map((light) => (
          <LightRow key={light.deviceId} light={light} />
        ))}
      </ul>

      <Checks mood={mood} />

      <div aria-live="polite" className="space-y-3">
        {apply.phase === 'working' ? <p className="text-sm text-fg-3">Setting your lights…</p> : null}
        {apply.phase === 'failed' ? <ErrorNotice error={apply.error} title="Your lights were not set" /> : null}
        {apply.phase === 'done' && apply.run ? (
          <div className="space-y-2">
            <Notice tone={apply.run.status === 'all_accepted' ? 'good' : 'warn'} title={apply.run.status === 'all_accepted' ? 'Set on your lights' : 'Only partly set'}>
              {acceptedSummary(apply.run.outcomes)}. Accepted means Govee took the request. It does not prove the lights changed.
            </Notice>
            <details className="text-sm">
              <summary className="cursor-pointer text-fg-3">What was sent</summary>
              <div className="mt-2">
                <RunResults run={apply.run} />
              </div>
            </details>
          </div>
        ) : null}
        {held ? <p className="text-sm text-fg-3">{held}</p> : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {apply.phase === 'idle' || apply.phase === 'failed' ? (
          <Button variant="primary" size="sm" icon={<Play className="size-4" aria-hidden />} onClick={() => onApply(entry, mood)}>
            {mood.clean ? 'Set my lights' : 'Set my lights anyway'}
          </Button>
        ) : null}
        <Button size="sm" icon={<RotateCcw className="size-4" aria-hidden />} disabled={busy} onClick={() => onTryAgain(entry)}>
          Try another take
        </Button>
        {save.phase === 'idle' ? (
          <Button size="sm" icon={<Save className="size-4" aria-hidden />} onClick={() => onSaveStart(entry, mood)}>
            Save as preset
          </Button>
        ) : null}
      </div>

      {save.phase === 'naming' || save.phase === 'saving' || save.phase === 'failed' ? (
        <form
          className="space-y-2"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (save.name.trim() !== '' && save.phase !== 'saving') onSave(entry, mood);
          }}
        >
          <Field label="Preset name">
            {(props) => <input {...props} className={inputClass} maxLength={80} value={save.name} onChange={(event) => onSaveName(entry, event.target.value)} />}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" variant="primary" busy={save.phase === 'saving'} disabled={save.name.trim() === ''}>
              Save preset
            </Button>
          </div>
          {save.phase === 'failed' ? <ErrorNotice error={save.error} title="Not saved" /> : null}
        </form>
      ) : null}
      {save.phase === 'done' ? (
        <Notice tone="good">
          Saved as the preset “{save.name.trim()}”. You will find it under App presets below.
        </Notice>
      ) : null}
    </article>
  );
}

/**
 * Set the mood from words. The look is designed and checked three ways on the server, and only then sent to the
 * lights through the same apply route as any preset. A look that passed every check is set at once, unless
 * "Preview first" is on. One that did not waits for a press. Nothing changes on the lights while it is designed.
 */
export function MoodBox() {
  const status = useAiStatus();
  const setMood = useSetMood();
  const applyDraft = useApplyDraft();
  const savePreset = useSavePreset();
  const [previewFirst, setPreviewFirst] = usePreference(previewFirstStore, 'off');
  const previewRef = useRef(previewFirst === 'on');
  previewRef.current = previewFirst === 'on';

  const [words, setWords] = useState('');
  const [targetValue, setTargetValue] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const nextId = useRef(1);
  // A look designed after the owner has left this page is never sent on its own: nobody would see it happen.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const busy = entries.some((e) => e.design.phase === 'working');

  const patch = (id: number, change: (entry: Entry) => Entry) =>
    setEntries((all) => all.map((entry) => (entry.id === id ? change(entry) : entry)));

  const apply = async (id: number, mood: AiMoodResultDto) => {
    patch(id, (e) => ({ ...e, apply: { phase: 'working' } }));
    try {
      const run = await applyDraft.mutateAsync({ name: mood.name, actions: mood.actions });
      patch(id, (e) => ({ ...e, apply: { phase: 'done', run } }));
    } catch (error) {
      patch(id, (e) => ({ ...e, apply: { phase: 'failed', error } }));
    }
  };

  const design = async (id: number, text: string, target: Target | undefined) => {
    try {
      const dto = await setMood.mutateAsync({ description: text, ...(target ? { target } : {}) });
      patch(id, (e) => ({ ...e, design: { phase: 'ready', dto }, save: { ...e.save, name: dto.mood?.name ?? '' } }));
      if (dto.mood && mounted.current && shouldApplyNow(dto, previewRef.current)) await apply(id, dto.mood);
    } catch (error) {
      patch(id, (e) => ({ ...e, design: { phase: 'failed', error } }));
    }
  };

  const start = (text: string, target: Target | undefined) => {
    const trimmed = text.trim();
    if (trimmed.length < 3 || busy) return;
    const id = nextId.current++;
    const entry: Entry = { id, words: trimmed, target, design: { phase: 'working' }, apply: { phase: 'idle' }, save: { phase: 'idle', name: '' } };
    setEntries((all) => [entry, ...all].slice(0, KEEP_ENTRIES));
    setWords('');
    void design(id, trimmed, target);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    start(words, parseTarget(targetValue));
  };

  const saveNow = async (entry: Entry, mood: AiMoodResultDto) => {
    patch(entry.id, (e) => ({ ...e, save: { ...e.save, phase: 'saving' } }));
    try {
      const saved = await savePreset.mutateAsync({
        create: { name: entry.save.name.trim(), description: presetDescription(mood, entry.words), actions: mood.actions },
      });
      patch(entry.id, (e) => ({ ...e, save: { phase: 'done', name: saved.name } }));
    } catch (error) {
      patch(entry.id, (e) => ({ ...e, save: { ...e.save, phase: 'failed', error } }));
    }
  };

  const reason = status.data?.reason ?? null;
  if (!status.data) return null;
  if (reason === 'disabled') return null;

  const unavailable = reason === 'no_key' ? (
    <Notice tone="info">
      Add your own DeepSeek, Gemini or GLM key in{' '}
      <Link to="/settings" className="font-medium underline underline-offset-2">
        Settings, under AI
      </Link>{' '}
      to set moods with words.
    </Notice>
  ) : reason ? (
    <Notice tone="info">{UNAVAILABLE[reason]}</Notice>
  ) : null;

  return (
    <section aria-labelledby="mood-heading" className="card rounded-3xl p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent-wash text-accent-text">
          <Sparkles className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 id="mood-heading" className="font-display text-xl font-semibold tracking-tight">
            Set the mood
          </h2>
          <p className="mt-1 text-sm text-fg-3">
            Describe a mood, a place or an occasion. It is designed, checked three ways, and set on your lights.
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        {unavailable ?? (
          <form onSubmit={submit} className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <label htmlFor="mood-words" className="sr-only">
                Describe the mood
              </label>
              <input
                id="mood-words"
                className={`${inputClass} flex-1 rounded-full`}
                placeholder="Cozy fireside, calm ocean, spooky night…"
                value={words}
                maxLength={AI_QUESTION_MAX_LENGTH}
                autoComplete="off"
                onChange={(event) => setWords(event.target.value)}
              />
              <Button type="submit" variant="primary" busy={busy} disabled={words.trim().length < 3} icon={<Send className="size-4" aria-hidden />}>
                Set the mood
              </Button>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="sm:w-64">
                <Field label="Which lights">
                  {(props) => (
                    <select {...props} className={inputClass} value={targetValue} onChange={(event) => setTargetValue(event.target.value)}>
                      <option value="">All my lights</option>
                      <TargetOptions />
                    </select>
                  )}
                </Field>
              </div>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" className="size-5" checked={previewFirst === 'on'} onChange={(event) => setPreviewFirst(event.target.checked ? 'on' : 'off')} />
                <span>
                  Preview first
                  <span className="block text-xs text-fg-4">Show the look before any light changes.</span>
                </span>
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              {MOOD_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={busy}
                  className="rounded-full border border-line px-3 py-1.5 text-xs text-fg-3 transition-colors hover:border-fg-4 hover:text-fg disabled:opacity-50"
                  onClick={() => start(suggestion, parseTarget(targetValue))}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </form>
        )}

        {entries.length > 0 ? (
          <div aria-label="Your moods, newest first" className="space-y-5">
            {entries.map((entry) => (
              <div key={entry.id} className="space-y-3">
                <p className="ml-auto w-fit max-w-[88%] rounded-3xl rounded-br-lg bg-accent-wash px-4 py-2 text-sm break-words text-fg">{entry.words}</p>
                <Reply
                  entry={entry}
                  previewFirst={previewFirst === 'on'}
                  busy={busy}
                  onApply={(e, mood) => void apply(e.id, mood)}
                  onTryAgain={(e) => start(e.words, e.target)}
                  onSaveStart={(e, mood) => patch(e.id, (x) => ({ ...x, save: { phase: 'naming', name: x.save.name || mood.name } }))}
                  onSaveName={(e, name) => patch(e.id, (x) => ({ ...x, save: { ...x.save, name } }))}
                  onSave={(e, mood) => void saveNow(e, mood)}
                />
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
