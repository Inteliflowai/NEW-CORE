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

const dirty = (s: string) => hasLeak(s) || hasBannedWord(s);
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
