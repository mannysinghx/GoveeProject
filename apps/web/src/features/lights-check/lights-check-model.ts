import type { PresetActionInput } from '@glm/shared';
import { ledsInSegment, type PatternString } from '../patterns/pattern-model';

/**
 * Govee's API cannot report what color a segment or an LED is showing, so nothing here
 * can read one. These tests send something distinctive, the owner looks at the lights,
 * and comparing the answers narrows down the cause.
 */
export type TestKey = 'whole' | 'segments' | 'blocks';
export type TestAnswer = 'good' | 'bad';

const RED = '#ff0000';
const BLUE = '#0000ff';
const BLOCK_COLORS = ['#ff0000', '#00c000', '#0000ff'];

export const TEST_ORDER: TestKey[] = ['whole', 'segments', 'blocks'];

/** The same physical sections another project reports for this model: 12 LEDs each. */
const SECTION_LEDS = 12;

function sortedSegments(string: PatternString): number[] {
  return [...string.segments].sort((a, b) => a - b);
}

/**
 * Test 1: one whole-string command. No segment commands are involved.
 * Test 2: one command naming every segment. It follows test 1, so an LED that does not
 * take the command stays red. The server's base color is turned off for this test,
 * because it would otherwise hide the very thing being tested.
 * Test 3: three repeating colors, one per segment, to show how many LEDs one segment covers.
 */
export function testActions(test: TestKey, strings: PatternString[]): PresetActionInput[] {
  return strings.flatMap((string) => {
    const power: PresetActionInput = { deviceId: string.deviceId, action: { type: 'power', on: true } };
    if (test === 'whole') {
      return [power, { deviceId: string.deviceId, action: { type: 'color', hex: RED } }];
    }
    const segments = sortedSegments(string);
    if (test === 'segments') {
      const limit = Math.max(1, string.maxSelect);
      const steps: PresetActionInput[] = [power];
      for (let i = 0; i < segments.length; i += limit) {
        steps.push({ deviceId: string.deviceId, action: { type: 'segmentColor', hex: BLUE, segments: segments.slice(i, i + limit) } });
      }
      return steps;
    }
    return [
      power,
      ...BLOCK_COLORS.map((hex, color) => ({
        deviceId: string.deviceId,
        action: { type: 'segmentColor' as const, hex, segments: segments.filter((_, i) => i % BLOCK_COLORS.length === color) },
      })),
    ];
  });
}

/** Marks are "deviceId:led". */
export function markKey(deviceId: string, led: number): string {
  return `${deviceId}:${led}`;
}

function ledNumbers(string: PatternString): number[] {
  return sortedSegments(string).flatMap((segment) => [...ledsInSegment(string, segment)].sort((a, b) => a - b));
}

/** Marked LEDs on one string, in order. */
export function markedLeds(string: PatternString, marks: ReadonlySet<string>): number[] {
  return ledNumbers(string).filter((led) => marks.has(markKey(string.deviceId, led)));
}

/** Which segments the marked LEDs belong to, in number order. */
export function markedSegments(string: PatternString, marks: ReadonlySet<string>): number[] {
  return sortedSegments(string).filter((segment) => ledsInSegment(string, segment).some((led) => marks.has(markKey(string.deviceId, led))));
}

/** "13 to 16, 21" */
export function describeRanges(values: number[]): string {
  const ranges: [number, number][] = [];
  for (const value of values) {
    const last = ranges.at(-1);
    if (last && last[1] === value - 1) last[1] = value;
    else ranges.push([value, value]);
  }
  return ranges.map(([from, to]) => (from === to ? String(from) : `${from} to ${to}`)).join(', ');
}

export interface MarkPattern {
  /** Every LED in each marked segment is marked, so the fault follows segment boundaries. */
  wholeSegments: boolean;
  /** The marks run unbroken to the far end of the string. */
  reachesEnd: boolean;
  /** All marks fall within one physical section. */
  oneSection: boolean;
  /** Only the higher segment numbers are affected, from this one up. */
  fromSegment: number | null;
}

export function markPattern(string: PatternString, marks: ReadonlySet<string>): MarkPattern | null {
  const leds = markedLeds(string, marks);
  const first = leds[0];
  const last = leds.at(-1);
  if (first === undefined || last === undefined) return null;
  const segments = markedSegments(string, marks);
  const all = ledNumbers(string);
  const contiguousTail = leds.length === all.filter((led) => led >= first).length;
  const sorted = sortedSegments(string);
  const firstSegment = segments[0] as number;
  const segmentTail = segments.length === sorted.filter((s) => s >= firstSegment).length;
  return {
    wholeSegments: segments.every((segment) => ledsInSegment(string, segment).every((led) => marks.has(markKey(string.deviceId, led)))),
    reachesEnd: contiguousTail && first > 1,
    oneSection: Math.floor((first - 1) / SECTION_LEDS) === Math.floor((last - 1) / SECTION_LEDS),
    fromSegment: segmentTail && firstSegment > 0 ? firstSegment : null,
  };
}

export interface Diagnosis {
  title: string;
  explanation: string;
  steps: string[];
}

/**
 * The likely cause from comparing the tests. It is a best reading, not a measurement: the
 * app only knows what the owner reported seeing.
 */
export function diagnoseLights(
  answers: Partial<Record<TestKey, TestAnswer>>,
  blockLeds: number | null,
  strings: PatternString[],
  marks: ReadonlySet<string>,
): Diagnosis | null {
  const patterns = strings.flatMap((string) => {
    const pattern = markPattern(string, marks);
    return pattern ? [pattern] : [];
  });

  if (answers.whole === 'bad') {
    const tail = patterns.some((p) => p.reachesEnd);
    const section = patterns.some((p) => p.oneSection);
    return {
      title: "Those LEDs don't respond even when the whole string is set",
      explanation:
        "This test sends no segment commands, so the app's pattern isn't the likely cause. Try the same color in the Govee Home app. If those LEDs stay wrong there too, the problem is in the lights or their connections.",
      steps: [
        ...(tail ? ['Every LED from that point to the end is affected, so check the connector just before the first wrong LED.'] : []),
        ...(section && !tail ? ['The wrong LEDs sit within one 12-LED section, so check that section and its connectors.'] : []),
        'Turn the string off and on at its power adapter, then repeat this test.',
        "If they stay wrong in the Govee Home app, contact Govee. The app can't repair this.",
      ],
    };
  }
  if (answers.segments === 'bad') {
    const high = patterns.find((p) => p.fromSegment !== null);
    return {
      title: 'A whole-string color works, but the segment command misses some LEDs',
      explanation:
        'The LEDs themselves work, because they took the whole-string color. They stayed red when told to turn blue with a segment command, so the problem is in how the segment command is applied. The app has already slowed down its commands, and a base color now covers this case in your patterns.',
      steps: [
        ...(high?.fromSegment ? [`Only segment ${high.fromSegment} and above are affected. Similar Govee lights have an API limit on higher segment numbers, so this may be one.`] : []),
        'Use Resend marked segments below to see whether a second try reaches them.',
        'Copy the report below and share it, because it says exactly which segments missed.',
      ],
    };
  }
  if (answers.blocks === 'bad' || (blockLeds !== null && answers.blocks !== undefined && blockLeds !== 4)) {
    return {
      title: "The color blocks don't match what the app shows",
      explanation:
        blockLeds !== null && blockLeds !== 4
          ? `You counted ${blockLeds} LEDs per block, and the app assumes 4. Its boxes don't line up with your lights until that's corrected.`
          : "The LEDs respond, but the colors don't land where the boxes say. The app's LED count or direction may be wrong for this string.",
      steps: [
        ...(blockLeds !== null && blockLeds !== 4 ? [`Set this string's LED count to ${blockLeds * 27} on the Paint a pattern page, if it reports 27 segments.`] : []),
        'If the pattern runs from the wrong end, use Flip on the Paint a pattern page.',
      ],
    };
  }
  if (answers.whole === 'good' && answers.segments === 'good' && answers.blocks === 'good') {
    return {
      title: 'Everything responded in these tests',
      explanation:
        "Every LED took all three commands, so the lights and the commands can work. The white LEDs you saw weren't reproduced here. They may have come from commands sent too close together, or from the lights' earlier state, which this version changes. That isn't proven, so tell me if they come back.",
      steps: ['Send your pattern again and check it. If LEDs stay white, run these tests right away and mark them.'],
    };
  }
  return null;
}

/** Plain text to paste into a message. Contains no account or device identifiers. */
export function lightsReport(
  answers: Partial<Record<TestKey, TestAnswer>>,
  blockLeds: number | null,
  strings: PatternString[],
  marks: ReadonlySet<string>,
): string {
  const label = (answer: TestAnswer | undefined) => (answer === undefined ? 'not run' : answer === 'good' ? 'all correct' : 'some wrong');
  const lines = [
    `Whole-string red: ${label(answers.whole)}`,
    `Segment blue: ${label(answers.segments)}`,
    `Color blocks: ${label(answers.blocks)}${blockLeds !== null ? `, ${blockLeds} LEDs per block` : ''}`,
  ];
  for (const string of strings) {
    const leds = markedLeds(string, marks);
    lines.push(
      leds.length === 0
        ? `${string.name} (${string.sku}, ${string.ledCount ?? 'unknown'} LEDs, flipped: ${string.reversed ? 'yes' : 'no'}): none marked`
        : `${string.name} (${string.sku}, ${string.ledCount ?? 'unknown'} LEDs, flipped: ${string.reversed ? 'yes' : 'no'}): LEDs ${describeRanges(leds)}, segments ${describeRanges(markedSegments(string, marks))}`,
    );
  }
  return lines.join('\n');
}
