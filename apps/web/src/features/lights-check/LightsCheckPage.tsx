import { ArrowLeft, RefreshCcw, Send } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RunResults } from '../../components/status';
import { Button, ErrorNotice, Loading, Notice, PageHeader, SectionCard } from '../../components/ui';
import { useApplyDraft, useDevices, useSettings } from '../../lib/queries';
import { ledsInSegment, resolveStrings, type PatternString } from '../patterns/pattern-model';
import {
  describeRanges,
  diagnoseLights,
  lightsReport,
  markedLeds,
  markedSegments,
  markKey,
  testActions,
  TEST_ORDER,
  type TestAnswer,
  type TestKey,
} from './lights-check-model';

const TESTS: Record<TestKey, { title: string; what: string; question: string; bad: string }> = {
  whole: {
    title: 'Test 1: whole string red',
    what: 'Sends one color to each whole string, with no segment commands.',
    question: 'Is every LED red?',
    bad: 'Some are not red',
  },
  segments: {
    title: 'Test 2: every segment blue',
    what: 'Tells every segment to turn blue. Run it after Test 1, so an LED that misses the command stays red.',
    question: 'Is every LED blue?',
    bad: 'Some are not blue',
  },
  blocks: {
    title: 'Test 3: color blocks',
    what: 'Sends red, green and blue, one per segment, repeating. Each block of one color is one segment.',
    question: 'Does each block have the same number of LEDs, repeating red, green, blue from the start of the string?',
    bad: 'Something looks wrong',
  },
};

/** One tappable box per LED, in string order, so the owner can mark what they see. */
function LedMarker({
  string,
  marks,
  onToggle,
}: {
  string: PatternString;
  marks: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) {
  const ordered = [...string.segments].sort((a, b) => a - b);
  const count = markedLeds(string, marks).length;
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-ink-200">
        {string.name} <span className="text-xs font-normal text-ink-400">{count === 0 ? 'none marked' : `${count} marked`}</span>
      </p>
      <div className="flex flex-wrap gap-1">
        {ordered.map((segment) => (
          <div key={segment} className="flex gap-px rounded border border-ink-600 p-px">
            {[...ledsInSegment(string, segment)]
              .sort((a, b) => a - b)
              .map((led) => {
                const key = markKey(string.deviceId, led);
                const marked = marks.has(key);
                return (
                  <button
                    key={led}
                    type="button"
                    aria-pressed={marked}
                    aria-label={`${string.name} LED ${led}, segment ${segment}`}
                    onClick={() => onToggle(key)}
                    className={`h-8 w-6 rounded-sm text-[9px] tabular-nums ${marked ? 'bg-amber-glow font-semibold text-ink-900' : 'bg-ink-800 text-ink-300'}`}
                  >
                    {led}
                  </button>
                );
              })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function LightsCheckPage() {
  const devices = useDevices();
  const settings = useSettings();
  const apply = useApplyDraft();
  const resend = useApplyDraft();

  const strings = useMemo(
    () => resolveStrings(devices.data ?? [], settings.data?.patternStrings ?? []).filter((s) => s.included),
    [devices.data, settings.data?.patternStrings],
  );
  const [running, setRunning] = useState<TestKey | null>(null);
  const [answers, setAnswers] = useState<Partial<Record<TestKey, TestAnswer>>>({});
  const [blockLeds, setBlockLeds] = useState<number | null>(null);
  const [marks, setMarks] = useState<ReadonlySet<string>>(new Set());

  const run = (test: TestKey) => {
    setRunning(test);
    apply.mutate({ name: `Light check: ${TESTS[test].title}`, actions: testActions(test, strings), plainSegments: true });
  };
  const toggleMark = (key: string) =>
    setMarks((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const anyBad = Object.values(answers).includes('bad');
  const diagnosis = diagnoseLights(answers, blockLeds, strings, marks);
  const marked = strings.flatMap((string) => {
    const segments = markedSegments(string, marks);
    return segments.length > 0 ? [{ string, segments }] : [];
  });
  const report = lightsReport(answers, blockLeds, strings, marks);

  const resendMarked = () => {
    const hex = running === 'whole' ? '#ff0000' : '#0000ff';
    resend.mutate({
      name: 'Light check: resend marked segments',
      plainSegments: true,
      actions: marked.flatMap(({ string, segments }) =>
        segments.map((segment) => ({ deviceId: string.deviceId, action: { type: 'segmentColor' as const, hex, segments: [segment] } })),
      ),
    });
  };

  return (
    <>
      <Link to="/patterns/new" className="mb-3 inline-flex min-h-9 items-center gap-1 text-sm text-ink-300 hover:text-ink-100">
        <ArrowLeft className="size-4" aria-hidden />
        Paint a pattern
      </Link>
      <PageHeader
        title="Check my lights"
        description="Finds out why LEDs show the wrong color, using three tests you check by eye."
      />
      {devices.isPending ? <Loading label="Looking for your lights" /> : null}
      {devices.isError ? <ErrorNotice error={devices.error} /> : null}

      <div className="space-y-5">
        <Notice title="Why you have to look">
          Govee's API can't report what color a segment or LED is showing, so the app can't read them. You're the sensor here:
          it sends a test, you say what you see, and comparing the answers points to the likely cause. These tests change your
          real lights straight away, so stand where you can see them. Apply your pattern again when you're done.
        </Notice>

        {devices.data && strings.length === 0 ? <Notice tone="warn">No light strings with segment control are included.</Notice> : null}

        {strings.length > 0
          ? TEST_ORDER.map((test) => {
              const details = TESTS[test];
              const answer = answers[test];
              const isCurrent = running === test;
              return (
                <SectionCard key={test} title={details.title} description={details.what}>
                  <div className="space-y-3">
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<Send className="size-4" aria-hidden />}
                      busy={apply.isPending && isCurrent}
                      disabled={apply.isPending}
                      onClick={() => run(test)}
                    >
                      Send to {strings.length} string{strings.length === 1 ? '' : 's'}
                    </Button>
                    {isCurrent && apply.isError ? <ErrorNotice error={apply.error} /> : null}
                    {isCurrent && apply.data ? <RunResults run={apply.data} /> : null}
                    {(isCurrent && apply.data) || answer ? (
                      <fieldset>
                        <legend className="mb-2 text-sm font-medium text-ink-200">{details.question}</legend>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button size="sm" variant={answer === 'good' ? 'primary' : 'secondary'} aria-pressed={answer === 'good'} onClick={() => setAnswers((a) => ({ ...a, [test]: 'good' }))}>
                            Yes
                          </Button>
                          <Button size="sm" variant={answer === 'bad' ? 'primary' : 'secondary'} aria-pressed={answer === 'bad'} onClick={() => setAnswers((a) => ({ ...a, [test]: 'bad' }))}>
                            {details.bad}
                          </Button>
                          {test === 'blocks' ? (
                            <label className="flex items-center gap-2 text-sm text-ink-300">
                              LEDs in one block
                              <input
                                type="number"
                                aria-label="LEDs in one color block"
                                className="min-h-9 w-16 rounded-lg border border-ink-700 bg-ink-850 px-2 text-ink-100"
                                min={1}
                                max={100}
                                value={blockLeds ?? ''}
                                onChange={(e) => {
                                  const value = Math.floor(Number(e.target.value));
                                  setBlockLeds(e.target.value === '' || !value || value < 1 ? null : value);
                                }}
                              />
                            </label>
                          ) : null}
                        </div>
                      </fieldset>
                    ) : null}
                  </div>
                </SectionCard>
              );
            })
          : null}

        {anyBad ? (
          <SectionCard
            title="Mark the wrong LEDs"
            description="Tap each LED that's the wrong color. Numbers count from the start of each string, and outlined groups change together."
          >
            <div className="space-y-4">
              {strings.map((string) => (
                <LedMarker key={string.deviceId} string={string} marks={marks} onToggle={toggleMark} />
              ))}
              {marked.length > 0 ? (
                <div className="space-y-2 border-t border-ink-700/70 pt-3">
                  {marked.map(({ string, segments }) => (
                    <p key={string.deviceId} className="text-sm text-ink-200">
                      {string.name}: LEDs {describeRanges(markedLeds(string, marks))}, in segment{segments.length === 1 ? '' : 's'} {describeRanges(segments)}
                    </p>
                  ))}
                  <Button size="sm" icon={<RefreshCcw className="size-4" aria-hidden />} busy={resend.isPending} onClick={resendMarked}>
                    Resend marked segments
                  </Button>
                  <p className="text-xs text-ink-400">
                    Sends each marked segment on its own, one a second. Check whether those LEDs change.
                  </p>
                  {resend.isError ? <ErrorNotice error={resend.error} /> : null}
                  {resend.data ? <RunResults run={resend.data} /> : null}
                </div>
              ) : null}
            </div>
          </SectionCard>
        ) : null}

        {diagnosis ? (
          <Notice tone={diagnosis.title.startsWith('Everything') ? 'good' : 'warn'} title={diagnosis.title}>
            <p>{diagnosis.explanation}</p>
            {diagnosis.steps.length > 0 ? (
              <>
                <p className="mt-2 font-medium">What to try</p>
                <ol className="mt-1 list-decimal space-y-1 pl-5">
                  {diagnosis.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </>
            ) : null}
          </Notice>
        ) : null}

        {Object.keys(answers).length > 0 ? (
          <SectionCard title="Your report" description="Copy this into a message to share exactly what you saw. It has no account details or device IDs.">
            <textarea
              readOnly
              aria-label="Light check report"
              rows={Math.min(10, report.split('\n').length + 1)}
              className="w-full rounded-lg border border-ink-700 bg-ink-850 p-2 font-mono text-xs text-ink-200"
              value={report}
            />
          </SectionCard>
        ) : null}
      </div>
    </>
  );
}
