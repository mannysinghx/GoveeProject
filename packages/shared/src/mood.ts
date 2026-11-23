import { z } from 'zod';
import { AI_QUESTION_MAX_LENGTH, type AiProviderId } from './ai.js';
import { targetSchema, type PresetActionInput } from './schemas.js';

/* -------------------------------------------------------------------------- */
/* Set the mood                                                               */
/* -------------------------------------------------------------------------- */

/** Control characters and runs of spaces are cleaned out of the owner's words before anything reads them. */
function tidy(words: string): string {
  // eslint-disable-next-line no-control-regex
  return words.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export const aiMoodRequestSchema = z.object({
  description: z
    .string()
    .max(AI_QUESTION_MAX_LENGTH * 2)
    .transform(tidy)
    .pipe(z.string().min(3, 'Describe the mood').max(AI_QUESTION_MAX_LENGTH, 'Keep it under 500 characters')),
  /** A light or a group to set. Left out, every light that is part of the display is set. */
  target: targetSchema.optional(),
});
export type AiMoodRequest = z.infer<typeof aiMoodRequestSchema>;

/** What a light can show, which decides what the mood can ask of it. */
export type AiMoodLightKind =
  /** Many segments, each its own colour. */
  | 'segments'
  /** One colour at a time. */
  | 'color'
  /** White at a chosen temperature only. */
  | 'white'
  /** Power and brightness only. */
  | 'power';

export interface AiMoodLightDto {
  deviceId: string;
  name: string;
  kind: AiMoodLightKind;
  /** Percent, or null when the light has no brightness control. */
  brightness: number | null;
  /** The colour of each segment in on-screen order for "segments", one colour for "color" and "white", none for "power". */
  colors: string[];
  /** When the light shows white light, its temperature in kelvin. `colors` then holds only how that white is drawn. */
  kelvin: number | null;
}

/** Check 3: a second look, by a different model when one is available. */
export type AiMoodReviewStatus =
  /** The reviewer scored it 8 or more. */
  | 'passed'
  /**
   * The reviewer scored it lower and made a corrected look. That look passed checks 1 and 2, and was then scored 8 or
   * more in a second review, so it is what is shown.
   */
  | 'adjusted'
  /** The reviewer still has concerns, and no corrected look both passed the checks and scored 8 or more. */
  | 'concerns'
  /** No reviewer could answer. */
  | 'unavailable';

export interface AiMoodChecksDto {
  /** Check 1: every light is covered, and each command is one that light accepts. */
  lights: { passed: boolean; notes: string[] };
  /** Check 2: the colours and brightness follow the design brief written from the owner's words. */
  palette: { passed: boolean; notes: string[] };
  /** Check 3: a review of the finished look against the owner's words. */
  review: {
    status: AiMoodReviewStatus;
    /** The first reviewer's score, 1 to 10. */
    score: number | null;
    /** The provider that reviewed, such as "Google Gemini". */
    by: string | null;
    notes: string[];
    /**
     * True when the deciding score came from a different model than the one whose work it judged: the reviewer for a
     * pass, and the second scorer for a corrected look. A model reviewing itself is shown, and never sets the lights alone.
     */
    independent: boolean;
    /** For a corrected look: who scored it in the second review, and what score it got. */
    confirmation: { by: string; score: number } | null;
  };
}

export interface AiMoodResultDto {
  /** A short title for the look. */
  name: string;
  /** One or two plain sentences on how the colours give the mood. */
  summary: string;
  /** Something the owner should know, such as a still look standing in for movement. */
  note: string | null;
  lights: AiMoodLightDto[];
  /** Ready to send through the preset apply route, or to save as a preset. */
  actions: PresetActionInput[];
  checks: AiMoodChecksDto;
  /**
   * True when all three checks came out clean and the review was independent. Only then does the app set the lights
   * without asking again.
   */
  clean: boolean;
}

export interface AiMoodDto {
  /** False when the words were not a request for a look. Nothing was designed, and `reply` says what to try. */
  isMood: boolean;
  reply: string | null;
  mood: AiMoodResultDto | null;
  provider: AiProviderId;
  model: string;
  costUsd: number;
}
