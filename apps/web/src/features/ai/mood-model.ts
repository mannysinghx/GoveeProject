import { colorName, type AiMoodDto, type AiMoodResultDto } from '@glm/shared';
import { createPreferenceStore } from '../../lib/preference-store';

/** Starting points for the box. Each is a whole request: one tap sends it. */
export const MOOD_SUGGESTIONS = [
  'Cozy fireside evening',
  'Calm ocean at dusk',
  'Spooky Halloween night',
  'Romantic dinner',
  'Sunrise warm-up',
  'Lively birthday party',
] as const;

/**
 * Whether to show a look before any light changes. Off by default: the box is a chat that sets your lights, and a
 * look that did not pass every check is held for you either way. Kept in this browser only.
 */
export const previewFirstStore = createPreferenceStore<'on' | 'off'>('glm.mood.previewFirst', ['on', 'off'], 'off');

/** True when the app may send the look at once: it passed every check, and the owner has not asked to see it first. */
export function shouldApplyNow(dto: AiMoodDto, previewFirst: boolean): boolean {
  return dto.mood !== null && dto.mood.clean && !previewFirst;
}

/** True when the only thing holding a look back is that its review came from the same model that made it. */
function heldOnlyForIndependence(mood: AiMoodResultDto): boolean {
  const { palette, review } = mood.checks;
  return palette.passed && !review.independent && (review.status === 'passed' || review.status === 'adjusted');
}

/** Why a look is waiting for a press, in words. Empty when it is not waiting. */
export function holdReason(mood: AiMoodResultDto, previewFirst: boolean): string {
  if (!mood.clean) {
    return heldOnlyForIndependence(mood)
      ? 'The second opinion came from the same model that made the look, so this waits for you.'
      : 'A check was not clean, so this waits for you.';
  }
  if (previewFirst) return 'Preview first is on, so this waits for you.';
  return '';
}

/** "2 red, 2 orange": a light's colours in words, in order along it, for anyone who cannot see the strip. */
export function describeColors(colors: string[]): string {
  const runs: { name: string; n: number }[] = [];
  for (const hex of colors) {
    const name = colorName(hex);
    const last = runs.at(-1);
    if (last && last.name === name) last.n += 1;
    else runs.push({ name, n: 1 });
  }
  if (runs.length === 1 && colors.length === 1) return runs[0]!.name;
  return runs.map((r) => `${r.n} ${r.name}`).join(', ');
}

/** "self" is a review by the model that made the look: shown, but never enough to set the lights alone. */
export type CheckState = 'pass' | 'adjusted' | 'self' | 'concern' | 'unavailable';

export interface CheckRow {
  key: 'lights' | 'palette' | 'review';
  label: string;
  state: CheckState;
  detail: string;
  notes: string[];
}

/** The three checks as rows to show, in the order they ran. */
export function checkRows(mood: AiMoodResultDto): CheckRow[] {
  const { lights, palette, review } = mood.checks;
  const score = review.score === null ? '' : `${review.score} of 10`;
  const second = review.confirmation;
  const secondBy = second ? (second.by === review.by ? 'the same model' : second.by) : '';
  let reviewDetail: string;
  let reviewState: CheckState;
  if (review.status === 'passed') {
    reviewDetail = review.independent
      ? `Reviewed by ${review.by}: ${score}.`
      : `Reviewed by ${review.by}, the same model that made it: ${score}. No other provider was free, so it is not an independent review.`;
    reviewState = review.independent ? 'pass' : 'self';
  } else if (review.status === 'adjusted') {
    reviewDetail = `Reviewed by ${review.by}: ${score}. It corrected the look, and ${secondBy} scored the corrected look ${second?.score} of 10.`;
    reviewState = review.independent ? 'adjusted' : 'self';
  } else if (review.status === 'concerns') {
    reviewDetail = second
      ? `Reviewed by ${review.by}: ${score}. It corrected the look, but ${secondBy} scored the corrected look only ${second.score} of 10.`
      : `Reviewed by ${review.by}: ${score}. It still has concerns.`;
    reviewState = 'concern';
  } else {
    reviewDetail = 'No second opinion could be had this time.';
    reviewState = 'unavailable';
  }
  return [
    {
      key: 'lights',
      label: 'Checked against your lights',
      state: lights.passed ? 'pass' : 'concern',
      detail: 'Every light is covered, and each step is one that light accepts.',
      notes: lights.notes,
    },
    {
      key: 'palette',
      label: 'Checked against the mood',
      state: palette.passed ? 'pass' : 'concern',
      detail: palette.passed ? 'The colours and brightness follow the design written from your words.' : 'The colours or brightness drift from the design written from your words.',
      notes: palette.notes,
    },
    { key: 'review', label: 'Second opinion', state: reviewState, detail: reviewDetail, notes: review.notes },
  ];
}

/** What to save a look as: its summary, and the words it came from, kept short enough for a preset. */
export function presetDescription(mood: AiMoodResultDto, words: string): string {
  return `${mood.summary} Made from: "${words}"`.slice(0, 500);
}

/** "5 of 18 steps": how many of the steps Govee took. */
export function acceptedSummary(outcomes: { status: string }[]): string {
  const accepted = outcomes.filter((o) => o.status === 'accepted').length;
  return `${accepted} of ${outcomes.length} step${outcomes.length === 1 ? '' : 's'} accepted by Govee`;
}
