import type { SkillLearningState } from '@/lib/skills/clVerbs';

// Student-facing labels for skill states. MUST NOT contain any CL verb
// (reteach/reinforce/on track/enrich/enrichment) — four-audience binding.
const STUDENT_SKILL_LABEL: Record<SkillLearningState, string | null> = {
  needs_different_instruction: 'Building strength',
  needs_more_time:             'Building strength',
  on_track:                    'Solid',
  ready_to_extend:             'Excelling',
  insufficient_data:           null,
  not_attempted:               null,
};

export function studentSkillLabel(state: SkillLearningState): string | null {
  return STUDENT_SKILL_LABEL[state] ?? null;
}

// Deterministic lead sentence based on grade direction. No AI. No numbers.
export function growthLeadSentence(
  direction: 'climbing' | 'steady' | 'sliding' | null,
): string {
  if (direction === 'climbing') return 'You have been putting in real effort lately — it shows.';
  if (direction === 'steady')   return 'You are making progress. Here is where you stand.';
  if (direction === 'sliding')  return 'Things feel a little tricky right now — that is okay.';
  return 'Here is how you are doing.';
}

// One-line direction sentence shown below the sparkline. No digits.
export function growthDirectionCopy(
  direction: 'climbing' | 'steady' | 'sliding' | null,
): string {
  if (direction === 'climbing') return 'Your grades have been climbing.';
  if (direction === 'steady')   return 'Holding steady.';
  if (direction === 'sliding')  return 'A little uneven lately — you have got this.';
  return 'Not enough graded work yet to show a trend.';
}
