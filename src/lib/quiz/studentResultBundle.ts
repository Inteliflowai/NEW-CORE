// src/lib/quiz/studentResultBundle.ts
// Pure server helper — turns an internal score_pct + mastery_band into the
// student-safe result bundle returned by the submit + student-quiz routes.
//
// Option-D boundary: this is the ONLY place that converts a raw number/enum
// into student copy. The routes call this server-side and ship the bundle, so
// the runner never receives a percentage or a raw band over the wire.
//
// Framework-agnostic: no React, no Next.js, no Supabase, no browser globals.

import { getScoreMessage, type Tier } from '@/lib/quiz/scoreMessage';
import { masteryDisplayLabel } from '@/lib/utils/masteryLabel';

// grade_level is TEXT on public.users (migration 0001). Parse the leading
// integer; K–5 → elementary, 6–8 → middle, 9–12 → high. Unparseable → middle.
export function gradeTextToTier(gradeLevel: string | null): Tier {
  if (!gradeLevel) return 'middle';
  const n = parseInt(gradeLevel.replace(/[^0-9]/g, ''), 10);
  if (Number.isNaN(n)) return 'middle';
  if (n <= 5) return 'elementary';
  if (n <= 8) return 'middle';
  return 'high';
}

export interface StudentResultBundleInput {
  scorePct: number;
  masteryBand: string | null;
  tier: Tier;
  firstName: string | null;
  attemptId: string;
  locale?: 'en' | 'pt';
}

export interface StudentResultBundle {
  scoreMessage: { message: string; teliMsg: string; teliState: 'celebrating' | 'idle' | 'speaking' };
  masteryLabel: string;
  needsStudyGuide: boolean;
}

export function studentResultBundle(input: StudentResultBundleInput): StudentResultBundle {
  const { scorePct, masteryBand, tier, firstName, attemptId, locale = 'en' } = input;
  // getScoreMessage(pct, seed, locale, tier, firstName) — attemptId is the seed.
  const scoreMessage = getScoreMessage(scorePct, attemptId, locale, tier, firstName);
  const masteryLabel = masteryDisplayLabel(masteryBand);
  const needsStudyGuide = scorePct < 80;
  return { scoreMessage, masteryLabel, needsStudyGuide };
}
