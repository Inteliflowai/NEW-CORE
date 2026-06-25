// src/lib/insights/classComprehension.ts
// Pure roll-up helpers for the class-level Comprehension Level view (the moat).
// No I/O. CL verbs come from the single source of truth in clVerbs.ts.
import { CL_VERB_BY_STATE, type SkillLearningState } from '@/lib/skills/clVerbs';

export type CLBucket = 'reinforce' | 'on_track' | 'enrich' | null;

/** Map a skill_learning_state to a class-tally bucket. null = not-yet-assessed/insufficient. */
export function clBucketOf(state: SkillLearningState): CLBucket {
  const verb = CL_VERB_BY_STATE[state] ?? null;
  if (verb === 'Reinforce') return 'reinforce';
  if (verb === 'On Track') return 'on_track';
  if (verb === 'Enrich') return 'enrich';
  return null;
}

/** Share (0-100) of ASSESSED states that are solid (on_track|enrich). null when none assessed. */
export function classComprehensionIndex(states: SkillLearningState[]): number | null {
  let assessed = 0;
  let solid = 0;
  for (const s of states) {
    const b = clBucketOf(s);
    if (b === null) continue; // not assessed → excluded from the denominator
    assessed++;
    if (b === 'on_track' || b === 'enrich') solid++;
  }
  if (assessed === 0) return null;
  return Math.round((100 * solid) / assessed);
}

const DIRECTION_THRESHOLD = 3; // mirrors loadStudentGradeTrend's head→tail mean shift

/** climbing/steady/sliding from weekly indices (oldest→newest). null when < 3 points. */
export function classTrendDirection(indices: number[]): 'climbing' | 'steady' | 'sliding' | null {
  if (indices.length < 3) return null;
  const third = Math.max(1, Math.floor(indices.length / 3));
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const delta = mean(indices.slice(-third)) - mean(indices.slice(0, third));
  if (delta > DIRECTION_THRESHOLD) return 'climbing';
  if (delta < -DIRECTION_THRESHOLD) return 'sliding';
  return 'steady';
}
