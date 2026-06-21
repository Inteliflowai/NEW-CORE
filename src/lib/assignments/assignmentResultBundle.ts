// src/lib/assignments/assignmentResultBundle.ts
// Assignments are GRADED → the student SEES the grade (gradePct, allow-listed). Every OTHER
// string passes BOTH guards (assertNoLeak digit/% guard + assertNoBannedWord). The shared
// scoreMessage pools contain the banned word "score" in some variants, so we re-guard the
// picked message and fall back to a clean generic line if it trips.
import { getScoreMessage } from '@/lib/quiz/scoreMessage';
import { masteryDisplayLabel } from '@/lib/utils/masteryLabel';
import { hasLeak, hasBannedWord } from '@/lib/copy/leakGuard';

const GENERIC_FEEDBACK = 'Nice effort here — keep building on your thinking.';
const GENERIC_MESSAGE = 'Nice work on this one. Keep it up!';

// Teacher-only diagnostic band / Comprehension-Level (CL) vocabulary that the shared
// getScoreMessage pool leaks into some variants (e.g. "Reteach mode", "Partial mastery",
// "Strong mastery", "Top-band", "Mid-band", "Above grade level", "Reteach scope"). These
// are four-audience / COACH-POSTURE violations ("Mastery not Band"; CL verbs are teacher-only)
// and must NOT reach the student. hasLeak/hasBannedWord catch digits + "score" but not these
// CONCEPT terms, so this local guard does. CALIBRATION: the approved soft labels
// 'Building' / 'On Track' / 'Strong' (and encouragement like "Strong work", "on track")
// are deliberately NOT caught — only the clearly teacher-only terms below are.
const DIAGNOSTIC_VOCAB_RE =
  /\b(?:reteach|re-teach|reinforce|enrich|partial mastery|strong mastery|(?:top|mid|low|high)-band|\bband\b|above grade level|grade level)\b/i;

const hasDiagnosticVocab = (s: string) => DIAGNOSTIC_VOCAB_RE.test(s);
const dirty = (s: string) => hasLeak(s) || hasBannedWord(s) || hasDiagnosticVocab(s);
const clean = (s: string, fallback: string) => (dirty(s) ? fallback : s);

export interface AssignmentResultBundle {
  gradePct: number;
  masteryLabel: string;
  message: { message: string; teliMsg: string; teliState: 'celebrating' | 'idle' | 'speaking' };
  overallFeedback: string;
  taskFeedback: Array<{ step: number; feedback: string }>;
}

export function assignmentResultBundle(input: {
  scorePct: number;
  masteryBand: 'reteach' | 'grade_level' | 'advanced';
  tier: 'elementary' | 'middle' | 'high';
  firstName: string | null;
  attemptId: string;
  rawOverallFeedback: string;
  rawTaskFeedback: Array<{ step: number; feedback: string }>;
  locale?: string;
}): AssignmentResultBundle {
  const { scorePct, masteryBand, tier, firstName, attemptId, rawOverallFeedback, rawTaskFeedback, locale = 'en' } = input;

  const picked = getScoreMessage(scorePct, attemptId, locale as 'en' | 'pt', tier, firstName);
  const message = {
    message: clean(picked.message, GENERIC_MESSAGE),
    teliMsg: clean(picked.teliMsg, GENERIC_MESSAGE),
    teliState: picked.teliState,
  };

  return {
    gradePct: scorePct,
    masteryLabel: masteryDisplayLabel(masteryBand),
    message,
    overallFeedback: clean(rawOverallFeedback, GENERIC_FEEDBACK),
    taskFeedback: rawTaskFeedback.map(({ step, feedback }) => ({ step, feedback: clean(feedback, GENERIC_FEEDBACK) })),
  };
}
